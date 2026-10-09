/**
 * Régua da tela Pré-venda da Monetização (`/monetizacao?aba=pre-venda`), contrato `docs/design/contratos/monetizacao-pre-venda.md`.
 *
 * A tela consome só as quatro RPCs do contrato de dados de 09/10/2026
 * (`monetizacao/outputs/2026-10-09-pre-venda-v2/contrato-pre-venda.md`): ritmo, atrasados, avaliações e a ficha de uma
 * avaliação. Aqui moram o formato dessas respostas, a normalização (o PostgREST devolve `numeric` e `bigint` como número
 * ou texto, conforme o tamanho) e toda conta que a tela mostra, para o teste conferir sem React.
 *
 * Nota da ligação = 100 × (crédito_abertura×1 + (perguntas_feitas/4)×3 + crédito_fechamento×2) ÷ 6, com sim = 1,
 * parcial = 0,5 e não = 0. Quem calcula é a função de avaliação; a tela lê `nota` e só recalcula no teste.
 */
import { ehDiaUtil } from "./feriados.ts";
import { PRE_VENDEDORES } from "./types.ts";

// ── Formato das RPCs ──────────────────────────────────────────────────────────────────────────────────────────────

export type Executou = "sim" | "parcial" | "nao";
export const STATUS_AVALIACAO = [
  "pendente",
  "transcrevendo",
  "transcrita",
  "avaliada",
  "erro",
] as const;
export type StatusAvaliacao = (typeof STATUS_AVALIACAO)[number];

/** `ops.monetizacao_pre_venda_ritmo(p_de, p_ate)`: uma linha por (dia, pessoa) com algum valor > 0. */
export interface LinhaRitmo {
  dia: string;
  user_id: number | null;
  pessoa: string;
  abordagens: number;
  atividades_previstas: number;
  atividades_feitas: number;
  atividades_vencidas: number;
  ligacoes: number;
  ligacoes_atendidas: number;
  minutos_falados: number;
}

/** `ops.monetizacao_pre_venda_atrasados()`: card com cadência ativa e ao menos uma atividade vencida e não feita. */
export interface Atrasado {
  deal_id: number;
  empresa: string;
  user_id: number | null;
  pessoa: string;
  dia_cadencia: number | null;
  vencidas: number;
  proxima: string | null;
  url: string | null;
}

export interface BlocoAvaliado {
  chave: string;
  titulo: string;
  peso: number;
  executou: Executou;
  trecho: string | null;
  nota_curta: string | null;
  /** A IA marcou sim ou parcial, mas o trecho não foi achado na transcrição: virou "não" (acréscimo de 09/10). */
  rebaixado: boolean;
}
export interface PerguntaAvaliada {
  chave: string;
  titulo: string;
  /** F = Finance, J = Cella, T = todas as frentes. */
  frentes: string[];
  feita: boolean;
  trecho: string | null;
  /** A IA disse que foi feita, mas o trecho não está na transcrição: virou "não feita". */
  rebaixada: boolean;
}
export interface Antipadrao {
  chave: string;
  titulo: string;
  trecho: string | null;
}

/** `ops.monetizacao_pre_venda_avaliacoes(p_de, p_ate)`: uma por card, mais recentes primeiro. */
export interface LinhaAvaliacao {
  deal_id: number;
  empresa: string;
  user_id: number | null;
  pessoa: string;
  inicio: string | null;
  duracao_seg: number | null;
  status: StatusAvaliacao;
  nota: number | null;
  blocos: BlocoAvaliado[];
  perguntas: PerguntaAvaliada[];
  antipadroes: Antipadrao[];
}

export interface Fala {
  falante: string;
  texto: string;
  inicio_seg: number | null;
}
export interface SinalFrente {
  frente: string;
  sinal: string;
  porque: string | null;
  /** A fala do cliente que sustenta o sinal. */
  trecho: string | null;
}
export interface Qualificacao {
  resumo: string | null;
  frentes: SinalFrente[];
  quem_decide: string | null;
  proximo_passo: string | null;
}

/** `ops.monetizacao_pre_venda_avaliacao(p_deal)`: a linha inteira de `ops.monetizacao_ligacao_avaliacoes` + `url`. */
export interface FichaLigacao {
  deal_id: number;
  activity_id: number | null;
  user_id: number | null;
  pessoa: string;
  empresa: string;
  inicio: string | null;
  duracao_seg: number | null;
  mp3_url: string | null;
  status: StatusAvaliacao;
  erro: string | null;
  transcricao: Fala[];
  avaliacao: {
    blocos: BlocoAvaliado[];
    perguntas: PerguntaAvaliada[];
    antipadroes: Antipadrao[];
    qualificacao: Qualificacao | null;
    oportunidade: "sim" | "nao" | "sem_dado" | null;
  } | null;
  nota: number | null;
  regua_versao: string | null;
  atualizado_em: string | null;
  /** Quando as duas notas (qualificação e avaliação) foram postadas no card. */
  notas_em: string | null;
  tentativas: number | null;
  custo_usd: number | null;
  url: string | null;
}

// ── Normalização ──────────────────────────────────────────────────────────────────────────────────────────────────

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : {};
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
/** Número ou nulo; "12.5" vira 12,5 (o PostgREST manda `numeric` grande como texto). */
const numOuNulo = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const num = (v: unknown): number => numOuNulo(v) ?? 0;
const dia = (v: unknown): string => (typeof v === "string" ? v.slice(0, 10) : "");
const executou = (v: unknown): Executou => (v === "sim" || v === "parcial" ? v : "nao");
const status = (v: unknown): StatusAvaliacao =>
  (STATUS_AVALIACAO as readonly string[]).includes(v as string)
    ? (v as StatusAvaliacao)
    : "pendente";

/**
 * Nome da pessoa pelo `user_id`: as RPCs de lista devolvem o nome do cadastro dos closers ("Matheus Carvalho") e a da
 * ficha devolve o do Pipedrive ("Matheus Pereira de Carvalho"). A tela mostra sempre o do cadastro.
 */
export function nomeDaPessoa(userId: number | null, bruto: unknown): string {
  const cadastro = PRE_VENDEDORES.find(([id]) => id === userId)?.[1];
  return cadastro ?? texto(bruto) ?? "Sem dono";
}

export const normalizarRitmo = (linhas: unknown): LinhaRitmo[] =>
  lista(linhas)
    .map(obj)
    .map((l) => ({
      dia: dia(l.dia),
      user_id: numOuNulo(l.user_id),
      pessoa: nomeDaPessoa(numOuNulo(l.user_id), l.pessoa),
      abordagens: num(l.abordagens),
      atividades_previstas: num(l.atividades_previstas),
      atividades_feitas: num(l.atividades_feitas),
      atividades_vencidas: num(l.atividades_vencidas),
      ligacoes: num(l.ligacoes),
      ligacoes_atendidas: num(l.ligacoes_atendidas),
      minutos_falados: num(l.minutos_falados),
    }))
    .filter((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.dia));

export const normalizarAtrasados = (linhas: unknown): Atrasado[] =>
  lista(linhas)
    .map(obj)
    .map((l) => ({
      deal_id: num(l.deal_id),
      empresa: texto(l.empresa) ?? `Card ${num(l.deal_id)}`,
      user_id: numOuNulo(l.user_id),
      pessoa: nomeDaPessoa(numOuNulo(l.user_id), l.pessoa),
      dia_cadencia: numOuNulo(l.dia_cadencia),
      vencidas: num(l.vencidas),
      proxima: texto(l.proxima),
      url: texto(l.url),
    }));

const blocos = (v: unknown): BlocoAvaliado[] =>
  lista(v)
    .map(obj)
    .map((b) => ({
      chave: texto(b.chave) ?? "",
      titulo: texto(b.titulo) ?? texto(b.chave) ?? "",
      peso: num(b.peso),
      executou: executou(b.executou),
      trecho: texto(b.trecho),
      nota_curta: texto(b.nota_curta),
      rebaixado: b.rebaixado === true,
    }));
const perguntas = (v: unknown): PerguntaAvaliada[] =>
  lista(v)
    .map(obj)
    .map((p) => ({
      chave: texto(p.chave) ?? "",
      titulo: texto(p.titulo) ?? texto(p.chave) ?? "",
      frentes: lista(p.frentes).filter((f): f is string => typeof f === "string"),
      feita: p.feita === true,
      trecho: texto(p.trecho),
      rebaixada: p.rebaixada === true,
    }));
const antipadroes = (v: unknown): Antipadrao[] =>
  lista(v)
    .map(obj)
    .map((a) => ({
      chave: texto(a.chave) ?? "",
      titulo: texto(a.titulo) ?? ANTIPADROES[texto(a.chave) ?? ""] ?? texto(a.chave) ?? "",
      trecho: texto(a.trecho),
    }))
    .filter((a) => a.chave);

export const normalizarAvaliacoes = (linhas: unknown): LinhaAvaliacao[] =>
  lista(linhas)
    .map(obj)
    .map((l) => ({
      deal_id: num(l.deal_id),
      empresa: texto(l.empresa) ?? `Card ${num(l.deal_id)}`,
      user_id: numOuNulo(l.user_id),
      pessoa: nomeDaPessoa(numOuNulo(l.user_id), l.pessoa),
      inicio: texto(l.inicio),
      duracao_seg: numOuNulo(l.duracao_seg),
      status: status(l.status),
      nota: numOuNulo(l.nota),
      blocos: blocos(l.blocos),
      perguntas: perguntas(l.perguntas),
      antipadroes: antipadroes(l.antipadroes),
    }));

export function normalizarFicha(v: unknown): FichaLigacao {
  const f = obj(v);
  const a = f.avaliacao && typeof f.avaliacao === "object" ? obj(f.avaliacao) : null;
  const q = a && a.qualificacao && typeof a.qualificacao === "object" ? obj(a.qualificacao) : null;
  return {
    deal_id: num(f.deal_id),
    activity_id: numOuNulo(f.activity_id),
    user_id: numOuNulo(f.user_id),
    pessoa: nomeDaPessoa(numOuNulo(f.user_id), f.pessoa),
    empresa: texto(f.empresa) ?? `Card ${num(f.deal_id)}`,
    inicio: texto(f.inicio),
    duracao_seg: numOuNulo(f.duracao_seg),
    mp3_url: texto(f.mp3_url),
    status: status(f.status),
    erro: texto(f.erro),
    transcricao: lista(f.transcricao)
      .map(obj)
      .map((x) => ({
        falante: texto(x.falante) ?? "",
        texto: texto(x.texto) ?? "",
        inicio_seg: numOuNulo(x.inicio_seg),
      }))
      .filter((x) => x.texto),
    avaliacao: a
      ? {
          blocos: blocos(a.blocos),
          perguntas: perguntas(a.perguntas),
          antipadroes: antipadroes(a.antipadroes),
          qualificacao: q
            ? {
                resumo: texto(q.resumo),
                frentes: lista(q.frentes)
                  .map(obj)
                  .map((s) => ({
                    frente: texto(s.frente) ?? "",
                    sinal: texto(s.sinal) ?? "sem_dado",
                    porque: texto(s.porque),
                    trecho: texto(s.trecho),
                  }))
                  .filter((s) => s.frente),
                quem_decide: texto(q.quem_decide),
                proximo_passo: texto(q.proximo_passo),
              }
            : null,
          oportunidade:
            a.oportunidade === "sim" || a.oportunidade === "nao" || a.oportunidade === "sem_dado"
              ? a.oportunidade
              : null,
        }
      : null,
    nota: numOuNulo(f.nota),
    regua_versao: texto(f.regua_versao),
    atualizado_em: texto(f.atualizado_em),
    notas_em: texto(f.notas_em),
    tentativas: numOuNulo(f.tentativas),
    custo_usd: numOuNulo(f.custo_usd),
    url: texto(f.url),
  };
}

// ── A régua do script de 09/10 ────────────────────────────────────────────────────────────────────────────────────

export const CREDITO: Record<Executou, number> = { sim: 1, parcial: 0.5, nao: 0 };
export const PESO_BLOCO: Record<string, number> = { abertura: 1, perguntas: 3, fechamento: 2 };
export const CHAVES_PERGUNTA = ["momento", "capital", "porte", "teses"] as const;
export const TITULO_PERGUNTA: Record<string, string> = {
  momento: "Momento e investimento",
  capital: "Estrutura de capital",
  porte: "Porte e regime",
  teses: "Teses na justiça",
};
export const FRENTES_PERGUNTA: Record<string, string[]> = {
  momento: ["T", "F"],
  capital: ["F"],
  porte: ["J", "T"],
  teses: ["J"],
};
/** A letra que acompanha a pergunta: a frente que a resposta alimenta. */
export const NOME_FRENTE_LETRA: Record<string, string> = {
  F: "Finance",
  J: "Cella",
  T: "todas as frentes",
};
export const ANTIPADROES: Record<string, string> = {
  disse_frente: "Disse ao cliente qual é a frente específica",
  falou_preco: "Falou de preço, honorário, êxito ou prazo",
  prometeu_economia: "Prometeu economia de imposto",
  socio_indicou_sem_confirmar: "Disse que o sócio indicou sem ele ter indicado",
};

/** As seis linhas do mapa de calor: os dois blocos de ponta e as quatro perguntas do bloco do meio. */
export const LINHAS_MAPA = [
  { chave: "abertura", tipo: "bloco", rotulo: "1 · Abertura" },
  { chave: "momento", tipo: "pergunta", rotulo: "P1 · Momento e investimento" },
  { chave: "capital", tipo: "pergunta", rotulo: "P2 · Estrutura de capital" },
  { chave: "porte", tipo: "pergunta", rotulo: "P3 · Porte e regime" },
  { chave: "teses", tipo: "pergunta", rotulo: "P4 · Teses na justiça" },
  { chave: "fechamento", tipo: "bloco", rotulo: "3 · Fechamento" },
] as const;
export type ChaveItem = (typeof LINHAS_MAPA)[number]["chave"];
export const CHAVES_ITEM = LINHAS_MAPA.map((l) => l.chave) as ChaveItem[];
export const ROTULO_ITEM = Object.fromEntries(
  LINHAS_MAPA.map((l) => [l.chave, l.rotulo]),
) as Record<ChaveItem, string>;

/** Nota pela fórmula do contrato de dados (0–100, uma casa). `null` sem os três blocos. */
export function notaCalculada(b: BlocoAvaliado[], p: PerguntaAvaliada[]): number | null {
  const ab = b.find((x) => x.chave === "abertura");
  const fe = b.find((x) => x.chave === "fechamento");
  if (!ab || !fe || !p.length) return null;
  const feitas = p.filter((x) => x.feita).length / 4;
  const v = (CREDITO[ab.executou] * 1 + feitas * 3 + CREDITO[fe.executou] * 2) / 6;
  return Math.round(v * 1000) / 10;
}

/** Faixa da cor semântica: ≥ 80 bom, 50 a 79 atenção, < 50 crítico (PRD, slide 6). */
export type Faixa = "bom" | "atencao" | "critico";
export const faixa = (pct: number): Faixa =>
  pct >= 80 ? "bom" : pct >= 50 ? "atencao" : "critico";
export const ROTULO_FAIXA: Record<Faixa, string> = {
  bom: "bom",
  atencao: "atenção",
  critico: "crítico",
};

/** Crédito do item na ligação (0 a 1), ou `null` quando a avaliação não traz o item. */
export function creditoDoItem(
  l: Pick<LinhaAvaliacao, "blocos" | "perguntas">,
  chave: string,
): number | null {
  const linha = LINHAS_MAPA.find((x) => x.chave === chave);
  if (!linha) return null;
  if (linha.tipo === "bloco") {
    const b = l.blocos.find((x) => x.chave === chave);
    return b ? CREDITO[b.executou] : null;
  }
  const p = l.perguntas.find((x) => x.chave === chave);
  return p ? (p.feita ? 1 : 0) : null;
}

/** O item faltou na ligação: bloco que não saiu inteiro (parcial ou não), pergunta não feita. */
export const faltou = (l: Pick<LinhaAvaliacao, "blocos" | "perguntas">, chave: string) => {
  const c = creditoDoItem(l, chave);
  return c !== null && c < 1;
};

/** Só o que entra na conta da aderência: avaliada e com nota. */
export const avaliadas = (linhas: LinhaAvaliacao[]) =>
  linhas.filter((l) => l.status === "avaliada" && l.nota !== null);

// ── Pessoas ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Pessoa {
  id: number;
  nome: string;
}

/**
 * As pessoas que a tela mostra: os pré-vendedores do cadastro (Matheus e Heloá, nessa ordem) e quem mais aparecer nos
 * dados; com `pessoa`, só ela. Heloá sem ligação continua na lista: ausência vira "—", não some (N4).
 */
export function pessoasDoRecorte(
  dados: { user_id: number | null; pessoa: string }[],
  pessoa?: number,
): Pessoa[] {
  const todas: Pessoa[] = PRE_VENDEDORES.map(([id, nome]) => ({ id, nome }));
  for (const d of dados)
    if (d.user_id !== null && !todas.some((p) => p.id === d.user_id))
      todas.push({ id: d.user_id, nome: d.pessoa });
  return pessoa ? todas.filter((p) => p.id === pessoa) : todas;
}

export const daPessoa = <T extends { user_id: number | null }>(linhas: T[], pessoa?: number) =>
  pessoa ? linhas.filter((l) => l.user_id === pessoa) : linhas;

/** "Matheus Carvalho" → "Matheus": legenda e cartão. */
export const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] ?? nome;

// ── Datas (São Paulo) ─────────────────────────────────────────────────────────────────────────────────────────────

const DIA_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** Dia (aaaa-mm-dd) de um instante, no fuso de São Paulo. */
export const diaEmSP = (iso: string) => DIA_SP.format(new Date(iso));
export const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function diasEntre(de: string, ate: string): string[] {
  if (!(de <= ate)) return [];
  const n = Math.round((Date.parse(ate) - Date.parse(de)) / 86400000);
  return Array.from({ length: Math.min(n, 1095) + 1 }, (_, i) =>
    new Date(Date.parse(de) + i * 86400000).toISOString().slice(0, 10),
  );
}

/** Dias úteis do período até hoje (o período pode terminar no futuro; o que não passou não divide). */
export const uteisAteHoje = (de: string, ate: string, hoje: string) =>
  diasEntre(de, ate < hoje ? ate : hoje).filter(ehDiaUtil).length;

/** Segunda-feira da semana do dia. */
export function semanaDe(d: string): string {
  const t = Date.parse(d);
  const dow = new Date(t).getUTCDay(); // 0 = domingo
  return new Date(t - ((dow + 6) % 7) * 86400000).toISOString().slice(0, 10);
}

// ── Ritmo ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Periodo {
  de: string;
  ate: string;
  hoje: string;
}

/** Chave da série de uma pessoa nos gráficos (Recharts lê a coluna pelo nome). */
export const serie = (id: number) => `p${id}`;

export interface PontoAbordagem {
  dia: string;
  rotulo: string;
  util: boolean;
  total: number;
  [serie: string]: string | number | boolean;
}

/**
 * Abordagens por dia útil, empilhadas por pessoa. Entram os dias úteis do período até hoje e, fora deles, só o dia que
 * teve abordagem (sábado trabalhado não some da soma). A média divide pelos dias úteis até hoje: é a mesma conta do
 * cartão "Abordagens por dia útil".
 */
export function serieAbordagens(linhas: LinhaRitmo[], pessoas: Pessoa[], p: Periodo) {
  const ids = new Set(pessoas.map((x) => x.id));
  const doRecorte = linhas.filter(
    (l) => l.user_id !== null && ids.has(l.user_id) && l.dia >= p.de && l.dia <= p.ate,
  );
  const fim = p.ate < p.hoje ? p.ate : p.hoje;
  const comValor = new Set(doRecorte.filter((l) => l.abordagens > 0).map((l) => l.dia));
  const dias = diasEntre(p.de, fim).filter((d) => ehDiaUtil(d) || comValor.has(d));
  for (const d of comValor) if (d > fim) dias.push(d);
  dias.sort();
  const pontos: PontoAbordagem[] = dias.map((d) => {
    const ponto: PontoAbordagem = { dia: d, rotulo: ddmm(d), util: ehDiaUtil(d), total: 0 };
    for (const x of pessoas) ponto[serie(x.id)] = 0;
    return ponto;
  });
  const porDia = new Map(pontos.map((x) => [x.dia, x]));
  for (const l of doRecorte) {
    const ponto = porDia.get(l.dia);
    if (!ponto || l.user_id === null) continue;
    ponto[serie(l.user_id)] = Number(ponto[serie(l.user_id)]) + l.abordagens;
    ponto.total += l.abordagens;
  }
  const total = pontos.reduce((s, x) => s + x.total, 0);
  const uteis = uteisAteHoje(p.de, p.ate, p.hoje);
  return { pontos, total, uteis, media: uteis ? total / uteis : null };
}

export interface PontoAtividade {
  dia: string;
  rotulo: string;
  feitas: number;
  vencidas: number;
  /** Previstas no dia que ainda não venceram nem foram feitas (o turno da tarde de hoje). */
  aVencer: number;
  previstas: number;
}

/** Atividades da cadência de uma pessoa por dia de vencimento: feitas, vencidas e a vencer. Só dias com previsão. */
export function serieAtividades(
  linhas: LinhaRitmo[],
  pessoa: number,
  p: Periodo,
): PontoAtividade[] {
  const porDia = new Map<string, PontoAtividade>();
  for (const l of linhas) {
    if (l.user_id !== pessoa || l.dia < p.de || l.dia > p.ate || l.atividades_previstas <= 0)
      continue;
    const x = porDia.get(l.dia) ?? {
      dia: l.dia,
      rotulo: ddmm(l.dia),
      feitas: 0,
      vencidas: 0,
      aVencer: 0,
      previstas: 0,
    };
    x.feitas += l.atividades_feitas;
    x.vencidas += l.atividades_vencidas;
    x.previstas += l.atividades_previstas;
    porDia.set(l.dia, x);
  }
  return [...porDia.values()]
    .map((x) => ({ ...x, aVencer: Math.max(0, x.previstas - x.feitas - x.vencidas) }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Atrasados em ordem de trabalho: mais vencidas primeiro; empate, o card mais adiantado na cadência. */
export const ordenarAtrasados = (a: Atrasado[]) =>
  [...a].sort(
    (x, y) =>
      y.vencidas - x.vencidas ||
      (y.dia_cadencia ?? -1) - (x.dia_cadencia ?? -1) ||
      x.empresa.localeCompare(y.empresa, "pt-BR"),
  );

export interface KpisRitmo {
  abordagens: number;
  uteis: number;
  /** Abordagens ÷ dias úteis até hoje; `null` sem dia útil decorrido. */
  porDiaUtil: number | null;
  feitasHoje: number;
  previstasHoje: number;
  vencidasAgora: number;
  cardsAtrasados: number;
  discadas: number;
  atendidas: number;
  /** Atendidas ÷ discadas (0–1); `null` sem ligação. */
  taxaAtendidas: number | null;
}

export function kpisRitmo(
  linhas: LinhaRitmo[],
  atrasados: Atrasado[],
  pessoas: Pessoa[],
  p: Periodo,
): KpisRitmo {
  const ids = new Set(pessoas.map((x) => x.id));
  const doRecorte = linhas.filter(
    (l) => l.user_id !== null && ids.has(l.user_id) && l.dia >= p.de && l.dia <= p.ate,
  );
  const soma = (k: keyof LinhaRitmo, ls = doRecorte) => ls.reduce((s, l) => s + Number(l[k]), 0);
  const hoje = doRecorte.filter((l) => l.dia === p.hoje);
  const atr = atrasados.filter((a) => a.user_id !== null && ids.has(a.user_id));
  const abordagens = soma("abordagens");
  const uteis = uteisAteHoje(p.de, p.ate, p.hoje);
  const discadas = soma("ligacoes");
  const atendidas = soma("ligacoes_atendidas");
  return {
    abordagens,
    uteis,
    porDiaUtil: uteis ? abordagens / uteis : null,
    feitasHoje: soma("atividades_feitas", hoje),
    previstasHoje: soma("atividades_previstas", hoje),
    vencidasAgora: atr.reduce((s, a) => s + a.vencidas, 0),
    cardsAtrasados: atr.length,
    discadas,
    atendidas,
    taxaAtendidas: discadas ? atendidas / discadas : null,
  };
}

// ── Aderência ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Celula {
  pessoa: number | "todos";
  /** 0–100; `null` sem ligação avaliada (vira "—", nunca 0). */
  valor: number | null;
  /** Ligações avaliadas que trazem o item. */
  n: number;
  /** Ligações em que o item faltou ou saiu parcial (o destino do clique). */
  faltas: number;
}

const media = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function celula(linhas: LinhaAvaliacao[], chave: string, pessoa: number | "todos"): Celula {
  const creditos = linhas
    .map((l) => creditoDoItem(l, chave))
    .filter((c): c is number => c !== null);
  const m = media(creditos);
  return {
    pessoa,
    valor: m === null ? null : m * 100,
    n: creditos.length,
    faltas: creditos.filter((c) => c < 1).length,
  };
}

export interface Aderencia {
  /** Ligações avaliadas no recorte. */
  n: number;
  porPessoa: { pessoa: Pessoa; n: number; media: number | null }[];
  time: { n: number; media: number | null };
  /** Colunas do mapa: as pessoas e, com mais de uma, "Os dois". */
  colunas: (Pessoa | { id: "todos"; nome: string })[];
  mapa: { chave: ChaveItem; rotulo: string; tipo: "bloco" | "pergunta"; celulas: Celula[] }[];
  /** A pergunta (P1–P4) feita no menor % das ligações; empate fica com a de maior número. */
  maisFalta: {
    chave: ChaveItem;
    rotulo: string;
    titulo: string;
    faltas: number;
    n: number;
    frentes: string[];
  } | null;
  antipadroes: { chave: string; titulo: string; n: number }[];
  semanas: { semana: string; rotulo: string; [serie: string]: string | number | null }[];
}

export function aderencia(linhas: LinhaAvaliacao[], pessoas: Pessoa[]): Aderencia {
  const ids = new Set(pessoas.map((x) => x.id));
  const av = avaliadas(linhas).filter((l) => l.user_id !== null && ids.has(l.user_id));
  const de = (id: number) => av.filter((l) => l.user_id === id);
  const porPessoa = pessoas.map((pessoa) => {
    const ls = de(pessoa.id);
    return { pessoa, n: ls.length, media: media(ls.map((l) => l.nota as number)) };
  });
  const colunas: Aderencia["colunas"] =
    pessoas.length > 1 ? [...pessoas, { id: "todos", nome: "Os dois" }] : [...pessoas];
  const mapa = LINHAS_MAPA.map((linha) => ({
    chave: linha.chave,
    rotulo: linha.rotulo,
    tipo: linha.tipo,
    celulas: colunas.map((c) => celula(c.id === "todos" ? av : de(c.id), linha.chave, c.id)),
  }));

  let maisFalta: Aderencia["maisFalta"] = null;
  for (const chave of CHAVES_PERGUNTA) {
    const c = celula(av, chave, "todos");
    if (!c.n || !c.faltas) continue;
    const taxa = (c.n - c.faltas) / c.n;
    const atual = maisFalta ? (maisFalta.n - maisFalta.faltas) / maisFalta.n : Infinity;
    if (taxa <= atual)
      maisFalta = {
        chave,
        rotulo: ROTULO_ITEM[chave],
        titulo: TITULO_PERGUNTA[chave],
        faltas: c.faltas,
        n: c.n,
        frentes: FRENTES_PERGUNTA[chave],
      };
  }

  const contagem = new Map<string, { chave: string; titulo: string; n: number }>();
  for (const l of av)
    for (const chave of new Set(l.antipadroes.map((a) => a.chave))) {
      const a = l.antipadroes.find((x) => x.chave === chave)!;
      const atual = contagem.get(chave) ?? { chave, titulo: ANTIPADROES[chave] ?? a.titulo, n: 0 };
      atual.n += 1;
      contagem.set(chave, atual);
    }
  const antipadroesFreq = [...contagem.values()].sort(
    (a, b) => b.n - a.n || a.titulo.localeCompare(b.titulo, "pt-BR"),
  );

  const porSemana = new Map<string, LinhaAvaliacao[]>();
  for (const l of av) {
    if (!l.inicio) continue;
    const s = semanaDe(diaEmSP(l.inicio));
    porSemana.set(s, [...(porSemana.get(s) ?? []), l]);
  }
  const semanas = [...porSemana.keys()].sort().map((s) => {
    const ponto: Aderencia["semanas"][number] = { semana: s, rotulo: ddmm(s) };
    for (const p of pessoas) {
      const m = media(
        porSemana
          .get(s)!
          .filter((l) => l.user_id === p.id)
          .map((l) => l.nota as number),
      );
      ponto[serie(p.id)] = m === null ? null : Math.round(m * 10) / 10;
    }
    return ponto;
  });

  return {
    n: av.length,
    porPessoa,
    time: { n: av.length, media: media(av.map((l) => l.nota as number)) },
    colunas,
    mapa,
    maisFalta,
    antipadroes: antipadroesFreq,
    semanas,
  };
}

// ── Ficha › Ligações ──────────────────────────────────────────────────────────────────────────────────────────────

export interface FiltroLigacoes {
  pessoa?: number;
  falta?: ChaveItem;
  antipadrao?: string;
}

/**
 * A lista da Ficha. Sem `falta` nem `antipadrao`, todas as ligações do período (inclusive as que estão na fila); com
 * eles, só as avaliadas em que o item faltou ou o antipadrão apareceu: o destino do clique no mapa e nas caixas.
 */
export function filtrarLigacoes(linhas: LinhaAvaliacao[], f: FiltroLigacoes): LinhaAvaliacao[] {
  let ls = daPessoa(linhas, f.pessoa);
  if (f.falta || f.antipadrao) ls = avaliadas(ls);
  if (f.falta) ls = ls.filter((l) => faltou(l, f.falta!));
  if (f.antipadrao) ls = ls.filter((l) => l.antipadroes.some((a) => a.chave === f.antipadrao));
  return ls;
}

/** Situação da ligação na lista: pendente e transcrevendo aparecem como "Na fila" (pedido do dono). */
export type SituacaoLigacao = "na_fila" | "avaliando" | "avaliada" | "erro";
export const situacaoDaLigacao = (s: StatusAvaliacao): SituacaoLigacao =>
  s === "avaliada"
    ? "avaliada"
    : s === "erro"
      ? "erro"
      : s === "transcrita"
        ? "avaliando"
        : "na_fila";
export const ROTULO_SITUACAO_LIGACAO: Record<SituacaoLigacao, string> = {
  na_fila: "Na fila",
  avaliando: "Avaliando",
  avaliada: "Avaliada",
  erro: "Erro",
};

/** "7:10"; `null` vira "—". */
export function duracao(seg: number | null): string {
  if (seg === null || !Number.isFinite(seg)) return "—";
  const s = Math.max(0, Math.round(seg));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Falas em que o trecho citado aparece (a transcrição marca o que a avaliação leu). */
export function falasDoTrecho(falas: Fala[], trecho: string | null): number[] {
  if (!trecho) return [];
  const t = trecho.trim().toLowerCase();
  return falas.flatMap((f, i) => {
    const x = f.texto.toLowerCase();
    return x.includes(t) || (x.length > 20 && t.includes(x)) ? [i] : [];
  });
}

// ── Estados de leitura ────────────────────────────────────────────────────────────────────────────────────────────

const SEM_ACESSO = "Seu acesso não inclui a Monetização.";
const NAO_ATIVADA =
  "A Pré-venda ainda não foi ativada no banco: as funções de ritmo e avaliação de ligações (migration do agente de avaliação) não foram aplicadas.";

/** Mensagem para a tela a partir do erro do PostgREST: sem acesso, função ainda não criada ou falha de leitura. */
export function mensagemDeErroPreVenda(
  erro: { code?: string; message?: string } | null,
  oQue: string,
): string {
  if (erro?.code === "42501") return SEM_ACESSO;
  if (erro?.code === "PGRST202" || erro?.code === "42883") return NAO_ATIVADA;
  return `Não foi possível ler ${oQue}. Atualize para tentar de novo.`;
}

/** O que a tela faz com o erro: sem acesso e "ainda não ativada" não são erro de leitura (N4). */
export const classificarErroPreVenda = (mensagem: string): "sem-acesso" | "nao-ativada" | "erro" =>
  mensagem === SEM_ACESSO || /^Seu acesso não inclui/.test(mensagem)
    ? "sem-acesso"
    : mensagem.startsWith("A Pré-venda ainda não foi ativada")
      ? "nao-ativada"
      : "erro";

/** Texto do estado vazio da avaliação: onde a ligação precisa cair para virar ficha. */
export const COMO_COMECA =
  "A avaliação começa quando a ligação pelo ramal da Api4Com cair no card do pipe 39. Matheus: ramal 1023. Heloá: ramal 1020.";
