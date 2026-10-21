// O Jev no Novo pedido (T5 do plano E1): sugerir o serviço do catálogo pela descrição e avisar quando a
// descrição da nota não combina com o serviço escolhido. Contrato `docs/design/contratos/faturamento-novo.md`
// (Seção 2): a sugestão só escolhe dentro do catálogo da empresa e nunca escolhe sozinha; o aviso não bloqueia.
//
// O que vai ao Jev é só a empresa que fatura, o serviço, a descrição, o projeto e o valor. Nada de CPF, CNPJ,
// e-mail, telefone nem nome do cliente: a descrição e o projeto passam por `limparTexto`, que troca esses
// dados por marcadores antes de sair.
//
// Montagem igual à do E0 (`portal-faturamento-prd-20261013/e0/jev-servicos.py`, 111 cards, 15/10/2026):
// `choice` com os serviços liberados como opções mais `nenhum`; acima de 25 serviços, os 25 mais prováveis
// por palavras da descrição.
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-jev.test.mjs.
import { JEV_MODELO } from "../cockpit-ceo/jev/contrato.ts";
import type { PedidoJev, RespostaJev } from "../cockpit-ceo/jev/contrato.ts";
import { dinheiro } from "./formato.ts";
import type { ServicoCatalogo } from "./tipos.ts";

/** A variável que liga o Jev no portal. Sem ela, o botão e o aviso não aparecem. */
export const jevFaturamentoLigado = (env: Record<string, string | undefined>) =>
  env.FATURAMENTO_JEV === "1";

/** Corte de tempo da chamada ao Jev: passou disso, a tela segue sem sugestão. */
export const TEMPO_JEV_MS = 3_000;
/**
 * Abaixo desta confiança a tela não mostra a sugestão ("não há um serviço claro"). No teste de 20/10/2026, as 9
 * sugestões certas vieram com 0,69 ou mais, e a errada (um distrato, que o E0 também achou ambíguo) com 0,37.
 */
export const LIMIAR_SUGESTAO = 0.5;
/** O aviso de descrição aparece quando o Jev diz "não combina" com pelo menos esta confiança. */
export const LIMIAR_AVISO = 0.7;
export const MAX_OPCOES = 25;
/** Teto do `state` (o OpenRouter recusa pedido grande; a medida do E0 ficou abaixo disso). */
export const MAX_STATE = 12_000;
const MAX_TEXTO = 3_000;

// ------------------------------------------------------------------ dado pessoal fora

const semAcento = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Preposições, artigos e tipos de sociedade que aparecem em razão social e não identificam ninguém. */
const NAO_IDENTIFICAM = new Set([
  "das",
  "dos",
  "del",
  "com",
  "para",
  "por",
  "sem",
  "the",
  "and",
  "ltda",
  "eireli",
  "epp",
]);

/**
 * As palavras de 3 letras ou mais de cada nome (sem acento, minúsculas, sem repetição), da mais longa para a
 * mais curta, para a troca casar primeiro o pedaço maior.
 */
export function pedacosDoNome(nomes: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const nome of nomes)
    for (const p of semAcento(nome ?? "")
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u))
      if ((p.match(/\p{L}/gu)?.length ?? 0) >= 3 && !NAO_IDENTIFICAM.has(p)) out.add(p);
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Tira dado pessoal e de contato do texto antes de ir ao Jev: link, e-mail, CNPJ (inclusive alfanumérico),
 * CPF, telefone, a linha "Empresa do cliente a faturar: …" e os nomes passados (o do cliente do pedido).
 */
export function limparTexto(
  texto: string | null | undefined,
  nomes: (string | null | undefined)[] = [],
): string {
  // NFC: a busca dos nomes compara sem acento posição a posição, e NFD mudaria o tamanho do texto.
  let t = String(texto ?? "").normalize("NFC");
  t = t.replace(/https?:\/\/\S+/gi, "[link]");
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[e-mail]");
  // CNPJ com ou sem máscara (12 letras ou números + 2 dígitos) e CPF.
  // Palavra comum de 14 letras não é CNPJ: exige ao menos 6 dígitos no trecho.
  t = t.replace(/\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}\b/gi, (m) =>
    (m.match(/\d/g)?.length ?? 0) >= 6 ? "[documento]" : m,
  );
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]");
  t = t.replace(/(\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[telefone]");
  t = t.replace(
    /(empresa do cliente( a faturar)?|raz[aã]o social|tomador|cliente)\s*:[^\n]*/gi,
    "$1: [cliente]",
  );
  // O nome do cliente sai inteiro e também aos pedaços: toda palavra de 3 letras ou mais do nome ou da razão
  // social ("Grupo Fortaleza" sai com o tomador FORTALEZA EMPREENDIMENTOS IMOBILIARIOS LTDA). Ficam só as
  // preposições comuns, que não identificam ninguém (achado M6 da revisão de 20/10/2026).
  for (const palavra of pedacosDoNome(nomes)) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapar(palavra)}(?![\\p{L}\\p{N}])`, "giu");
    const base = semAcento(t);
    let saida = "";
    let ultimo = 0;
    for (const m of base.matchAll(re)) {
      saida += t.slice(ultimo, m.index) + "[cliente]";
      ultimo = (m.index ?? 0) + m[0].length;
    }
    t = saida + t.slice(ultimo);
  }
  // "[cliente] [cliente] [cliente]" vira um marcador só.
  t = t.replace(/\[cliente\](?:[\s.,&/-]*\[cliente\])+/g, "[cliente]");
  return t
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, MAX_TEXTO);
}

// ------------------------------------------------------------------ pré-filtro (acima de 25)

const STOP = new Set(
  (
    "de da do das dos e a o as os em para por com sem no na nos nas um uma ao aos que se ou ref referente mes " +
    "servico servicos valor nota fiscal nfe nfse honorario honorarios cliente faturamento vencimento dia competencia"
  ).split(" "),
);

const SINONIMOS: Record<string, string> = {
  contabil: "contabilidade escrituracao balancete contabeis",
  fiscal: "apuracao impostos tributos escrituracao fiscais",
  folha: "pagamento departamento pessoal trabalhista",
  financeiro: "financeira contas pagar receber tesouraria conciliacao",
  societario: "contrato social alteracao abertura baixa junta",
};

function palavras(s: string): string[] {
  return semAcento(s)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 2 && !STOP.has(p));
}

/** Duas palavras "casam" se são iguais ou dividem os 6 primeiros caracteres (contabil × contabeis). */
const casam = (a: string, b: string) =>
  a === b || (a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6));

/**
 * Os `max` serviços mais prováveis pelas palavras do texto (descrição e projeto), na ordem do catálogo no
 * empate. Até `max` serviços, volta o catálogo inteiro.
 */
export function preFiltrar(
  servicos: ServicoCatalogo[],
  texto: string,
  max: number = MAX_OPCOES,
): ServicoCatalogo[] {
  if (servicos.length <= max) return servicos;
  const q = palavras(texto);
  for (const [k, v] of Object.entries(SINONIMOS))
    if (q.some((p) => casam(p, k))) q.push(...v.split(" "));
  const nota = (s: ServicoCatalogo) => {
    const ps = palavras(`${s.descricao} ${s.codigo_lc116 ?? ""}`);
    return ps.reduce((n, p) => n + (q.some((x) => casam(x, p)) ? 1 : 0), 0);
  };
  return servicos
    .map((s, i) => ({ s, i, n: nota(s) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, max)
    .map((x) => x.s);
}

// ------------------------------------------------------------------ sugerir o serviço (choice)

export const INSTRUCOES_SUGESTAO =
  "Você classifica um pedido de faturamento no catálogo de serviços do Omie da empresa que vai emitir a nota " +
  "(`emissora`). `projeto` é o nome do projeto e `descricao` é o texto da nota ou o que a pessoa escreveu sobre o " +
  "trabalho. Escolha o serviço do catálogo em que esse pedido seria faturado. Se o pedido junta vários serviços, " +
  "escolha o que cobre o pacote, ou o principal. Escolha `nenhum` só quando nenhum serviço do catálogo corresponde.";

export const OPCAO_NENHUM = "nenhum";

export interface EntradaSugestao {
  /** "DOC · PLANNING DOC ASSESSORIA PARALEGAL LTDA". */
  emissora: string;
  projeto: string;
  descricao: string;
  valor: number | null;
  servicos: ServicoCatalogo[];
  /** Nomes que não podem sair (o do cliente do pedido): viram "[cliente]". */
  nomesParaTirar?: (string | null | undefined)[];
}

export interface PedidoSugestao {
  pedido: PedidoJev;
  /** opção do Jev → id do serviço. */
  mapa: Record<string, string>;
  /** O catálogo passou de 25 e foi pré-filtrado. */
  filtrado: boolean;
  opcoes: number;
}

/** A chave de cada opção: o código do serviço (SRV00025) quando todos têm um, único; senão s01, s02… */
function chavesDasOpcoes(servicos: ServicoCatalogo[]): string[] {
  const codigos = servicos.map((s) => (s.codigo ?? "").replace(/[^A-Za-z0-9_]/g, "_"));
  const unicos = new Set(codigos);
  const usaCodigo =
    codigos.every(Boolean) && unicos.size === codigos.length && !unicos.has(OPCAO_NENHUM);
  return usaCodigo ? codigos : servicos.map((_, i) => `s${String(i + 1).padStart(2, "0")}`);
}

function stateLimitado(state: Record<string, string>): Record<string, string> {
  // Se passar do teto, encurta a descrição (o campo mais longo) até caber.
  const tamanho = () => JSON.stringify(state).length;
  while (tamanho() > MAX_STATE && state.descricao && state.descricao.length > 200)
    state.descricao = state.descricao.slice(0, Math.floor(state.descricao.length * 0.8));
  return state;
}

/** O pedido `choice` ao Jev, com o mapa de volta para o id do serviço. */
export function pedidoSugestao(e: EntradaSugestao): PedidoSugestao {
  const nomes = e.nomesParaTirar ?? [];
  const descricao = limparTexto(e.descricao, nomes);
  const projeto = limparTexto(e.projeto, nomes);
  const candidatos = preFiltrar(e.servicos, `${projeto} ${descricao}`);
  const chaves = chavesDasOpcoes(candidatos);
  const criteria: Record<string, string> = {};
  const mapa: Record<string, string> = {};
  candidatos.forEach((s, i) => {
    criteria[chaves[i]] = `${s.descricao.slice(0, 160)} [LC 116 ${s.codigo_lc116 ?? "?"}]`;
    mapa[chaves[i]] = s.id;
  });
  criteria[OPCAO_NENHUM] = "Nenhum serviço do catálogo corresponde ao trabalho descrito.";
  const state = stateLimitado({
    emissora: e.emissora,
    projeto: projeto || "(sem projeto)",
    descricao: descricao || "(sem descrição)",
    valor: e.valor === null ? "não informado" : dinheiro(e.valor),
  });
  return {
    pedido: {
      model: JEV_MODELO,
      state,
      questions: { servico: { type: "choice", instructions: INSTRUCOES_SUGESTAO, criteria } },
    },
    mapa,
    filtrado: candidatos.length < e.servicos.length,
    opcoes: Object.keys(criteria).length,
  };
}

export interface Sugestao {
  /** `null` quando o Jev escolheu `nenhum`. */
  servicoId: string | null;
  codigo: string | null;
  confianca: number | null;
  /** As três opções mais prováveis, com o serviço quando há. */
  top3: {
    servicoId: string | null;
    codigo: string | null;
    descricao: string;
    probabilidade: number;
  }[];
}

/** A resposta do Jev → a sugestão (com o id do serviço e o top-3 legível). */
export function lerSugestao(
  r: RespostaJev | undefined,
  mapa: Record<string, string>,
  servicos: ServicoCatalogo[],
): Sugestao | null {
  if (!r || r.type !== "choice") return null;
  const porId = new Map(servicos.map((s) => [s.id, s]));
  const doOpcao = (op: string) => {
    const id = mapa[op] ?? null;
    const s = id ? porId.get(id) : undefined;
    return {
      servicoId: s ? s.id : null,
      codigo: s?.codigo ?? null,
      descricao: s ? s.descricao : "Nenhum serviço do catálogo",
    };
  };
  const top3 = Object.entries(r.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([op, p]) => ({ ...doOpcao(op), probabilidade: Math.round(p * 100) / 100 }));
  const escolhida = doOpcao(r.choice);
  return {
    servicoId: escolhida.servicoId,
    codigo: escolhida.codigo,
    confianca: r.confidence,
    top3,
  };
}

// ------------------------------------------------------------------ a descrição combina? (noul)

// Redação escolhida no teste de 20/10/2026 (e1/jev-no-produto.md): com a lista de tipos de trabalho, os pares
// que combinam ficaram em 0,97+ e o erro mais caro (BPO Financeiro × folha) caiu de 0,91 para 0,54.
export const INSTRUCOES_CONFERENCIA =
  "A descrição da nota em `descricao_nota` descreve o trabalho do serviço em `servico` (a descrição do catálogo do " +
  "Omie da empresa em `emissora`)? Compare o tipo de trabalho: folha de pagamento, contabilidade, fiscal, " +
  "financeiro, societário, legalização, consultoria e reembolso são serviços diferentes, e um serviço só cobre o " +
  "trabalho que o nome dele diz. Não julgue o valor nem a redação.";

export interface EntradaConferencia {
  emissora: string;
  servico: Pick<ServicoCatalogo, "descricao" | "codigo" | "codigo_lc116">;
  descricao: string;
  valor: number | null;
  nomesParaTirar?: (string | null | undefined)[];
}

export function pedidoConferencia(e: EntradaConferencia): PedidoJev {
  const s = e.servico;
  return {
    model: JEV_MODELO,
    state: stateLimitado({
      emissora: e.emissora,
      servico: `${s.descricao}${s.codigo ? ` (${s.codigo})` : ""}${s.codigo_lc116 ? ` [LC 116 ${s.codigo_lc116}]` : ""}`,
      descricao_nota: limparTexto(e.descricao, e.nomesParaTirar ?? []) || "(sem descrição)",
      valor: e.valor === null ? "não informado" : dinheiro(e.valor),
    }),
    questions: {
      combina: {
        type: "noul",
        instructions: INSTRUCOES_CONFERENCIA,
        criteria: {
          true: "Combina: a descrição é do mesmo tipo de trabalho do serviço.",
          false: "Não combina: a descrição é de outro tipo de trabalho.",
        },
      },
    },
  };
}

export interface Conferencia {
  combina: boolean;
  /** A confiança no lado escolhido (0,5 a 1). */
  confianca: number;
  /** A tela avisa (sem bloquear): "não combina" com confiança ≥ 0,7. */
  avisar: boolean;
}

export function lerConferencia(r: RespostaJev | undefined): Conferencia | null {
  if (!r || r.type !== "noul") return null;
  const combina = r.noul >= 0.5;
  const confianca = Math.round((combina ? r.noul : 1 - r.noul) * 100) / 100;
  return { combina, confianca, avisar: !combina && confianca >= LIMIAR_AVISO };
}
