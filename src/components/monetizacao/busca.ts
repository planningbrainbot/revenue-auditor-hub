import { hoje } from "@/lib/monetizacao/model";
import type { Filtro } from "@/lib/monetizacao/model";
import { PRE_VENDEDORES, PRODUTOS, PRODUTOS_ROTEIRO } from "@/lib/monetizacao/types";
import type { Produto } from "@/lib/monetizacao/types";
import { SITUACOES_GRAVACAO } from "@/lib/monetizacao/gravacoes";
import type { SituacaoGravacao } from "@/lib/monetizacao/gravacoes";
import type { Regime } from "@/lib/monetizacao/cruzamento-consultoria";

/**
 * Estado de tela de `/monetizacao` na URL (contrato da moldura, "Filtros na URL").
 * Cada chave é validada aqui; valor inválido cai no padrão, e o padrão não precisa ir
 * para a URL (a chave fica `undefined`).
 */
export const ABAS = [
  "operacao",
  // Tela Consultoria: duas visões na mesma aba (`visao`), uma entrada só na lateral.
  "handoff-consultoria",
  "funil",
  "pessoas",
  "roteiros",
  "distribuicao",
  "gravacoes",
] as const;
export type Aba = (typeof ABAS)[number];

/**
 * Telas que saíram do menu em 09/10/2026 (aprovado pelo dono do produto): Temporal e previsão, Projetado × realizado,
 * Capacidade e alocação e Follow Day. O link antigo abre a Operação diária com um aviso (NAVEGACAO.md N14).
 */
export const ABAS_APOSENTADAS = {
  temporal: "Temporal e previsão",
  forecast: "Projetado × realizado",
  capacidade: "Capacidade e alocação",
  "follow-day": "Follow Day",
} as const;
export type AbaAposentada = keyof typeof ABAS_APOSENTADAS;
export const DATA_APOSENTADORIA = "09/10/2026";

/**
 * Dois pré-vendedores desde 08/10/2026 (Matheus e Heloá): o seletor de responsável voltou à barra.
 * Sem `?responsavel=`, o recorte é a pré-venda inteira (os dois); com ele, uma pessoa.
 */
export const PRE_VENDA_IDS = PRE_VENDEDORES.map(([id]) => id);
export const PRODUTOS_URL = [...PRODUTOS, "sem_produto"] as const;
export type ProdutoUrl = (typeof PRODUTOS_URL)[number];
/** O filtro de produto da aba Abordagens aceita também o Caixa inteiro (`caixa`, 09/10/2026); as outras abas, não. */
export const PRODUTOS_ROTEIRO_URL = [...PRODUTOS_ROTEIRO, "sem_produto"] as const;
export type ProdutoRoteiroUrl = (typeof PRODUTOS_ROTEIRO_URL)[number];
/** Lista de atenção da visão "Hoje", aberta num Sheet: o filtro de idade em dias úteis. Ausente = fechada. */
export const FILTROS_ATENCAO = ["todos", "10mais", "3a9"] as const;
export type FiltroAtencao = (typeof FILTROS_ATENCAO)[number];
/** Situação da abordagem (`records.body.status`; sem status = rascunho). */
export const SITUACOES = ["rascunho", "aprovado", "arquivado"] as const;
export type Situacao = (typeof SITUACOES)[number];
/** Chave de uma reunião na tela Gravações: registrada (`pedido-monet-…`) ou do histórico do card (`hist-…`). */
const REUNIAO = /^(pedido-monet-\d{1,12}-\d{8}T\d{4}|hist-\d{1,12}-(levantamento|proposta))$/;

export type BuscaMonetizacao = {
  aba: Aba;
  /** Id do pré-vendedor no Pipedrive (`PRE_VENDEDORES`); ausente = a pré-venda inteira. */
  responsavel?: number;
  /** aaaa-mm-dd; padrão 1º dia do mês corrente (São Paulo). */
  de?: string;
  /** aaaa-mm-dd; padrão hoje (São Paulo). */
  ate?: string;
  /** Produto do recorte; "caixa" só na aba Abordagens (roteiros do Caixa inteiro). */
  produto?: ProdutoRoteiroUrl;
  /** aaaa-mm da tela Gravações (padrão: todos os meses). */
  mes?: string;
  /** Link antigo de uma tela que saiu do menu: a Operação diária abre com o aviso. */
  aposentada?: AbaAposentada;
  arquivados?: "mostrar";
  situacao?: Situacao;
  atencao?: FiltroAtencao;
  /** Gravações: situação da gravação. */
  gravacao?: SituacaoGravacao;
  /** Gravações: busca por empresa, card ou closer. */
  q?: string;
  /** Gravações: a reunião aberta na ficha. */
  reuniao?: string;
  /** Handoff Consultoria: unidade do onboarding (nome em ops.unidades); ausente = todas. */
  unidade?: string;
  /** Gaveta aberta (id do número ou bloco), como o `?grafico=` do Cockpit. */
  grafico?: string;
  /** Tela Consultoria: a visão aberta. Ausente = Handoff e repasse; "cruzamento" = Cruzamento com a call;
   *  "empresa" = Buscar empresa (o texto da busca vai em `q`). */
  visao?: "cruzamento" | "empresa";
  /** Consultoria, Buscar empresa: a ficha aberta (CNPJ, `card:<id>`, `deal:<id>` ou `cliente:<id>`). */
  empresa?: string;
  /** Consultoria, visão Cruzamento: regime tributário da coorte do teste do CEO; ausente = todos. */
  regime?: Regime;
};

const ehData = (v: unknown): v is string =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;

const umDe = <T extends string>(lista: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (lista as readonly string[]).includes(v) ? (v as T) : undefined;

const inteiro = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isInteger(n) ? n : undefined;
};

export function validarBuscaMonetizacao(s: Record<string, unknown>): BuscaMonetizacao {
  // O Cruzamento Consultoria nasceu como aba própria (06/10) e virou visão da tela Consultoria no mesmo dia:
  // o link antigo abre a visão certa.
  const cruzamentoAntigo = s.aba === "cruzamento-consultoria";
  if (cruzamentoAntigo) s = { ...s, aba: "handoff-consultoria", visao: "cruzamento" };
  // Tela que saiu do menu em 09/10/2026: abre a Operação diária e diz por quê (N14), sem redirect silencioso.
  const aposentadas = Object.keys(ABAS_APOSENTADAS) as AbaAposentada[];
  const aba = umDe(ABAS, s.aba) ?? "operacao";
  return {
    aba,
    // O aviso fica até a pessoa fechar ou sair da Operação (a chave vai para a URL na primeira mudança de filtro).
    aposentada:
      aba === "operacao"
        ? (umDe(aposentadas, s.aba) ?? umDe(aposentadas, s.aposentada))
        : undefined,
    responsavel: PRE_VENDA_IDS.find((id) => id === inteiro(s.responsavel)),
    de: ehData(s.de) ? s.de : undefined,
    ate: ehData(s.ate) ? s.ate : undefined,
    produto:
      aba === "roteiros" ? umDe(PRODUTOS_ROTEIRO_URL, s.produto) : umDe(PRODUTOS_URL, s.produto),
    mes: typeof s.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s.mes) ? s.mes : undefined,
    arquivados: s.arquivados === "mostrar" ? "mostrar" : undefined,
    situacao: umDe(SITUACOES, s.situacao),
    atencao: umDe(FILTROS_ATENCAO, s.atencao),
    gravacao: umDe(SITUACOES_GRAVACAO, s.gravacao),
    q: typeof s.q === "string" && s.q.trim() ? s.q.trim().slice(0, 80) : undefined,
    reuniao: typeof s.reuniao === "string" && REUNIAO.test(s.reuniao) ? s.reuniao : undefined,
    unidade:
      typeof s.unidade === "string" && s.unidade.trim() && s.unidade.length <= 60
        ? s.unidade.trim()
        : undefined,
    grafico:
      typeof s.grafico === "string" && /^[a-z0-9-]{1,60}$/.test(s.grafico) ? s.grafico : undefined,
    visao: s.visao === "cruzamento" || s.visao === "empresa" ? s.visao : undefined,
    empresa:
      typeof s.empresa === "string" &&
      /^(\d{11}|\d{14}|(card|deal):\d{1,15}|cliente:[\w-]{1,40})$/.test(s.empresa)
        ? s.empresa
        : undefined,
    regime: umDe(["real", "presumido", "simples", "sem"] as const, s.regime),
  };
}

const LIMITE_DIAS_PERIODO = 1095; // `dias()` do model recusa mais de três anos.

/** Período efetivo: padrão do mês corrente; período inválido (de > até, > 3 anos) cai no padrão. */
export function periodoDaBusca(b: BuscaMonetizacao): { from: string; to: string } {
  const today = hoje();
  const padrao = { from: today.slice(0, 7) + "-01", to: today };
  const from = b.de ?? padrao.from;
  const to = b.ate ?? padrao.to;
  const n = (Date.parse(to) - Date.parse(from)) / 86400000;
  if (!(n >= 0) || n > LIMITE_DIAS_PERIODO) return padrao;
  return { from, to };
}

/**
 * O mesmo `Filtro` que as visões sempre receberam. "sem_produto" passa como está: o model
 * compara `c.route === f.product`, então o recorte "Sem produto" funciona sem mudar cálculo.
 */
export function filtroDaBusca(b: BuscaMonetizacao): Filtro {
  const { from, to } = periodoDaBusca(b);
  return {
    from,
    to,
    owner: b.responsavel ?? null,
    owners: b.responsavel ? undefined : PRE_VENDA_IDS,
    // "caixa" só existe na aba Abordagens, que não usa o filtro: aqui vale como "todos os produtos".
    product: (b.produto === "caixa" ? "" : (b.produto ?? "")) as Produto | "",
  };
}

/** Grava o período sem levar o padrão para a URL. */
export function periodoParaBusca(from: string, to: string): Pick<BuscaMonetizacao, "de" | "ate"> {
  const today = hoje();
  return {
    de: from === today.slice(0, 7) + "-01" ? undefined : from,
    ate: to === today ? undefined : to,
  };
}
