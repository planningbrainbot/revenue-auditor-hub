import { PRODUTOS } from "@/lib/monetizacao/types";
import type { Produto } from "@/lib/monetizacao/types";
import {
  EMPTY_PORTFOLIO_FILTERS,
  ORIGENS_BASE,
  situacoesIniciais,
} from "@/lib/monetizacao/portfolio";
import type { Abordagem, OrigemBase, PortfolioFilters } from "@/lib/monetizacao/portfolio";

/**
 * Estado de tela de `/clientes` na URL (contrato `docs/design/contratos/clientes.md`, moldura).
 *
 * As chaves antigas (`view`, `status`, `unidade`, `q`, `origem`, `gate`) continuam strings com
 * "" de padrão, porque há links de fora que as mandam assim. As chaves da tabela da Base são
 * opcionais: vazio (ou igual ao padrão do produto) não vai para a URL.
 *
 * Busca, unidade e origem existem uma vez só, no topo. A tabela lê as três daqui e não tem
 * controle próprio para elas (antes eram dois campos de busca, dois de unidade e duas origens com
 * valores diferentes na mesma página).
 */
export const VIEWS_CLIENTES = [
  "monetizacao",
  "produtos",
  "pendencias",
  "contratos",
  "gates",
  "contatos",
] as const;

export type BuscaClientes = {
  view: string;
  status: string;
  /**
   * Unidades do topo, múltipla escolha (DECISIONS 18/09): chave de `monetizacao_unidades` ou
   * nome. Link antigo com valor único (`?unidade=abc`) vira lista de um.
   */
  unidade?: string[];
  q: string;
  /** Chaves de `ORIGENS_BASE` (régua `origemBase`), múltipla escolha; valor único antigo aceito. */
  origem?: OrigemBase[];
  gate: string;
  produto?: Produto;
  /** Situação no produto. Ausente = a situação padrão do produto; `["todas"]` = todas. */
  situacao?: string[];
  abordagem?: Abordagem[];
  /** Faturamento anual do cadastro (valores do filtro: "10", "exact:…", "teto:…", "unknown"). */
  faixa?: string[];
  /** Faixa de faturamento estimado do grupo, Driva. */
  driva?: string[];
  segmento?: string[];
  regime?: string[];
  /** Situação cadastral na Receita. */
  receita?: string[];
  /** "true" com contato, "false" sem. */
  contato?: string[];
  /** Só as aderentes a mais de um produto. */
  sobreposicao?: boolean;
  /**
   * Página da tabela da visão (Validar origem, Contratos e churn), a partir de 1. Ausente = 1;
   * trocar de visão ou de filtro volta à primeira.
   */
  pagina?: number;
  /** Contratos e churn: "sim" = só churn, "nao" = só sem churn. */
  churn?: "sim" | "nao";
  /** Contratos e churn: ERP do cadastro (`empresas.erp`). */
  erp?: string;
  /**
   * Contratos e churn: segmento de `empresas.segmento`. Chave própria, porque o `segmento` da
   * Base é outra régua (o segmento da conta conciliada, múltipla escolha).
   */
  segmentoContrato?: string;
  /** Contratos e churn: "com" ou "sem" data de assinatura do contrato. */
  assinatura?: "com" | "sem";
};

const texto = (v: unknown) => (typeof v === "string" ? v : "");
const lista = (v: unknown): string[] | undefined => {
  const l = Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x)
    : typeof v === "string" && v
      ? [v]
      : [];
  return l.length ? l : undefined;
};
const umDe = <T extends string>(opcoes: readonly T[], v: unknown): T | undefined =>
  typeof v === "string" && (opcoes as readonly string[]).includes(v) ? (v as T) : undefined;

const paginaDe = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 1 ? n : undefined;
};

export function validarBuscaClientes(s: Record<string, unknown>): BuscaClientes {
  const chavesOrigem = Object.keys(ORIGENS_BASE);
  const origem = lista(s.origem)?.filter((o): o is OrigemBase => chavesOrigem.includes(o));
  return {
    view: typeof s.view === "string" ? s.view : s.status ? "contratos" : "monetizacao",
    status: texto(s.status),
    unidade: lista(s.unidade),
    q: texto(s.q),
    origem: origem?.length ? origem : undefined,
    gate: umDe(["cnpj", "contato", "ecd"], s.gate) ?? "",
    produto: umDe(PRODUTOS, s.produto),
    situacao: lista(s.situacao),
    abordagem: lista(s.abordagem) as Abordagem[] | undefined,
    faixa: lista(s.faixa),
    driva: lista(s.driva),
    segmento: lista(s.segmento),
    regime: lista(s.regime),
    receita: lista(s.receita),
    contato: lista(s.contato),
    sobreposicao: s.sobreposicao === true || s.sobreposicao === "true" ? true : undefined,
    pagina: paginaDe(s.pagina),
    churn: umDe(["sim", "nao"], s.churn),
    erp: texto(s.erp) || undefined,
    segmentoContrato: texto(s.segmentoContrato) || undefined,
    assinatura: umDe(["com", "sem"], s.assinatura),
  };
}

/**
 * Filtros da tabela da Base a partir da URL. `unidadeKeys` são as unidades do topo já resolvidas
 * (a URL aceita chave ou nome); a busca não entra aqui porque o topo já recorta as contas antes
 * de a tabela recebê-las.
 */
export function filtrosDaBusca(b: BuscaClientes, unidadeKeys: string[]): PortfolioFilters {
  return {
    ...EMPTY_PORTFOLIO_FILTERS,
    unit: unidadeKeys,
    origin: b.origem ?? [],
    product: b.produto ?? "",
    status: b.situacao ?? [],
    approach: b.abordagem ?? [],
    band: b.faixa ?? [],
    drivaBand: b.driva ?? [],
    segment: b.segmento ?? [],
    regime: b.regime ?? [],
    receita: b.receita ?? [],
    contact: b.contato ?? [],
    overlap: !!b.sobreposicao,
  };
}

const vazio = (l: string[]) => (l.length ? l : undefined);

/**
 * O caminho inverso: o que a tabela gravou vira chaves da URL, sem descartar valor (múltipla
 * escolha). Unidade e busca não são escritas (são do topo); a origem é, porque o topo e os
 * atalhos da tabela (KPIs de origem da gaveta, "Conferir regime da base retroativa") mexem no
 * mesmo filtro.
 */
export function buscaDosFiltros(f: PortfolioFilters): Partial<BuscaClientes> {
  const padrao = situacoesIniciais(f.product);
  const situacaoPadrao =
    f.status.length === padrao.length && f.status.every((s, i) => s === padrao[i]);
  return {
    origem: vazio(f.origin) as OrigemBase[] | undefined,
    produto: f.product || undefined,
    situacao: situacaoPadrao ? undefined : vazio(f.status),
    abordagem: vazio(f.approach) as Abordagem[] | undefined,
    faixa: vazio(f.band),
    driva: vazio(f.drivaBand),
    segmento: vazio(f.segment),
    regime: vazio(f.regime),
    receita: vazio(f.receita),
    contato: vazio(f.contact),
    sobreposicao: f.overlap || undefined,
  };
}
