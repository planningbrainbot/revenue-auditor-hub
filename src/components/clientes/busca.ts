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
  unidade: string;
  q: string;
  /** Uma das 4 chaves de `ORIGENS_BASE` (régua `origemBase`), ou "". */
  origem: string;
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

export function validarBuscaClientes(s: Record<string, unknown>): BuscaClientes {
  const origem = umDe(Object.keys(ORIGENS_BASE) as OrigemBase[], s.origem) ?? "";
  return {
    view: typeof s.view === "string" ? s.view : s.status ? "contratos" : "monetizacao",
    status: texto(s.status),
    unidade: texto(s.unidade),
    q: texto(s.q),
    origem,
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
  };
}

/**
 * Filtros da tabela da Base a partir da URL. `unidadeKey` é a unidade do topo já resolvida
 * (a URL aceita chave ou nome); a busca não entra aqui porque o topo já recorta as contas antes
 * de a tabela recebê-las.
 */
export function filtrosDaBusca(b: BuscaClientes, unidadeKey: string | null): PortfolioFilters {
  return {
    ...EMPTY_PORTFOLIO_FILTERS,
    unit: unidadeKey ? [unidadeKey] : [],
    origin: b.origem ? [b.origem as OrigemBase] : [],
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
 * O caminho inverso: o que a tabela gravou vira chaves da URL. Unidade e busca não são escritas
 * (são do topo); a origem é, porque o topo e os atalhos da tabela (KPIs de origem da gaveta,
 * "Conferir regime da base retroativa") mexem no mesmo filtro.
 */
export function buscaDosFiltros(f: PortfolioFilters): Partial<BuscaClientes> {
  const padrao = situacoesIniciais(f.product);
  const situacaoPadrao =
    f.status.length === padrao.length && f.status.every((s, i) => s === padrao[i]);
  return {
    origem: f.origin[0] ?? "",
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
