import { FARMER, hoje } from "@/lib/monetizacao/model";
import type { Filtro } from "@/lib/monetizacao/model";
import { PRODUTOS } from "@/lib/monetizacao/types";
import type { Produto } from "@/lib/monetizacao/types";

/**
 * Estado de tela de `/monetizacao` na URL (contrato da moldura, "Filtros na URL").
 * Cada chave é validada aqui; valor inválido cai no padrão, e o padrão não precisa ir
 * para a URL (a chave fica `undefined`).
 */
export const ABAS = [
  "operacao",
  "forecast",
  "temporal",
  "capacidade",
  "follow-day",
  "funil",
  "pessoas",
  "roteiros",
  "distribuicao",
] as const;
export type Aba = (typeof ABAS)[number];

/**
 * Matheus Carvalho é o único farmer da frente (fala do dono, 24/09/2026): o seletor de
 * responsável saiu da tela e o recorte é sempre o `FARMER` do model. Não há chave na URL.
 */
export const RESPONSAVEL_PADRAO = FARMER.id;
export const DIAS_PADRAO = 7;
export const SINAIS = ["vencida", "sem_passo", "sem_movimento"] as const;
export type Sinal = (typeof SINAIS)[number];
export const PRODUTOS_URL = [...PRODUTOS, "sem_produto"] as const;
export type ProdutoUrl = (typeof PRODUTOS_URL)[number];
/** Blocos do modelo da planilha (`forecast-model.tsx`, `BLOCKS`). */
export const BLOCOS = ["base", "capacidade", "funil", "receita", "caixa", "margem"] as const;
export type Bloco = (typeof BLOCOS)[number];
/** Situação da abordagem (`records.body.status`; sem status = rascunho). */
export const SITUACOES = ["rascunho", "aprovado", "arquivado"] as const;
export type Situacao = (typeof SITUACOES)[number];

export type BuscaMonetizacao = {
  aba: Aba;
  /** aaaa-mm-dd; padrão 1º dia do mês corrente (São Paulo). */
  de?: string;
  /** aaaa-mm-dd; padrão hoje (São Paulo). */
  ate?: string;
  produto?: ProdutoUrl;
  /** Régua de "sem movimento" do Follow Day, 1–180; padrão 7. */
  dias?: number;
  /** aaaa-mm do Projetado × realizado; padrão mês de `ate`. */
  mes?: string;
  sinal?: Sinal;
  blocos?: Bloco;
  totais?: boolean;
  arquivados?: "mostrar";
  situacao?: Situacao;
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
  const dias = inteiro(s.dias);
  const totais = s.totais === true || s.totais === "true" ? true : undefined;
  return {
    aba: umDe(ABAS, s.aba) ?? "operacao",
    de: ehData(s.de) ? s.de : undefined,
    ate: ehData(s.ate) ? s.ate : undefined,
    produto: umDe(PRODUTOS_URL, s.produto),
    dias: dias !== undefined && dias >= 1 && dias <= 180 && dias !== DIAS_PADRAO ? dias : undefined,
    mes: typeof s.mes === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s.mes) ? s.mes : undefined,
    sinal: umDe(SINAIS, s.sinal),
    blocos: umDe(BLOCOS, s.blocos),
    totais,
    arquivados: s.arquivados === "mostrar" ? "mostrar" : undefined,
    situacao: umDe(SITUACOES, s.situacao),
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
    owner: RESPONSAVEL_PADRAO,
    product: (b.produto ?? "") as Produto | "",
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
