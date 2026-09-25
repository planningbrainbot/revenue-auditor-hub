// Filtros da conversa: o contexto que a pessoa não precisa repetir (período, unidade, base,
// produto, leitura). É o mesmo objeto nos argumentos das ferramentas, na especificação da visão e
// nos controles editáveis da tela; o servidor valida sempre com este schema.
import { z } from "zod";

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export const PeriodoSchema = z
  .object({
    /**
     * mes / mes_anterior / trimestre / ano: os mesmos atalhos do cockpit (dias, até hoje).
     * ultimos_meses: os N últimos meses FECHADOS (séries mensais). intervalo: de/ate em "AAAA-MM".
     */
    tipo: z.enum(["mes", "mes_anterior", "trimestre", "ano", "ultimos_meses", "intervalo"]),
    meses: z.number().int().min(1).max(24).optional(),
    de: z.string().regex(MES).optional(),
    ate: z.string().regex(MES).optional(),
  })
  .strict();
export type PeriodoFiltro = z.infer<typeof PeriodoSchema>;

export const FiltrosSchema = z
  .object({
    periodo: PeriodoSchema.optional(),
    /** Nomes de unidade da rede, como aparecem no cockpit (ex.: "Curitiba"). No máximo 8. */
    unidades: z.array(z.string().min(1).max(80)).max(8).optional(),
    /** Base da apuração da rede: nova (receita_base), antiga (receita_base_antiga) ou as duas. */
    base: z.enum(["todas", "nova", "antiga"]).optional(),
    produto: z.enum(["consultoria", "finance", "cella"]).optional(),
    /** Leitura de faturamento: grupo (Financeiro) ou rede (apuração das unidades). */
    leitura: z.enum(["grupo", "rede"]).optional(),
  })
  .strict();
export type Filtros = z.infer<typeof FiltrosSchema>;

export const ROTULO_BASE = {
  todas: "Base nova + antiga",
  nova: "Base nova",
  antiga: "Base antiga",
};
export const ROTULO_LEITURA = { grupo: "Grupo (Financeiro)", rede: "Rede (apuração das unidades)" };
export const ROTULO_PRODUTO = { consultoria: "Consultoria", finance: "Finance", cella: "Cella" };

export const somaMeses = (m: string, n: number) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1))
    .toISOString()
    .slice(0, 7);
export const mesBr = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

/**
 * Meses FECHADOS do período, em ordem. O mês corrente nunca entra (não é realizado fechado).
 * Atalhos de dias viram os meses fechados que eles tocam; se nenhum, o último mês fechado.
 */
export function mesesDoPeriodo(p: PeriodoFiltro | undefined, hoje: string, padrao = 6): string[] {
  const ultimoFechado = somaMeses(hoje.slice(0, 7), -1);
  const janela = (ate: string, n: number) =>
    Array.from({ length: n }, (_, i) => somaMeses(ate, i - n + 1));
  if (!p) return janela(ultimoFechado, padrao);
  switch (p.tipo) {
    case "ultimos_meses":
      return janela(ultimoFechado, p.meses ?? padrao);
    case "intervalo": {
      const de = p.de ?? p.ate ?? ultimoFechado;
      let ate = p.ate ?? ultimoFechado;
      if (ate > ultimoFechado) ate = ultimoFechado;
      if (de > ate) return [];
      const out: string[] = [];
      for (let m = de; m <= ate && out.length < 24; m = somaMeses(m, 1)) out.push(m);
      return out;
    }
    case "mes":
    case "mes_anterior":
      return [ultimoFechado];
    case "trimestre": {
      const inicio = `${hoje.slice(0, 4)}-${String(Math.floor((Number(hoje.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}`;
      const meses = [];
      for (let m = inicio; m <= ultimoFechado; m = somaMeses(m, 1)) meses.push(m);
      return meses.length ? meses : [ultimoFechado];
    }
    case "ano": {
      const meses = [];
      for (let m = `${hoje.slice(0, 4)}-01`; m <= ultimoFechado; m = somaMeses(m, 1)) meses.push(m);
      return meses.length ? meses : [ultimoFechado];
    }
  }
}

/** Período em dias, para os números de evento do cockpit (mesmo `resolverPeriodo` da tela). */
export function buscaDoPeriodo(p: PeriodoFiltro | undefined, hoje: string) {
  if (!p) return { periodo: "mes" };
  if (p.tipo === "ultimos_meses" || p.tipo === "intervalo") {
    const meses = mesesDoPeriodo(p, hoje);
    if (!meses.length) return { periodo: "mes" };
    const fim = meses[meses.length - 1];
    const ultimo = new Date(Date.UTC(Number(fim.slice(0, 4)), Number(fim.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10);
    return { periodo: "personalizado", de: `${meses[0]}-01`, ate: ultimo };
  }
  return { periodo: p.tipo };
}

export function rotuloPeriodo(p: PeriodoFiltro | undefined, hoje: string): string {
  if (!p) return "mês atual";
  switch (p.tipo) {
    case "mes":
      return "mês atual";
    case "mes_anterior":
      return "mês anterior";
    case "trimestre":
      return "trimestre atual";
    case "ano":
      return "ano atual";
    default: {
      const m = mesesDoPeriodo(p, hoje);
      if (!m.length) return "período sem mês fechado";
      return m.length === 1 ? mesBr(m[0]) : `${mesBr(m[0])} a ${mesBr(m[m.length - 1])}`;
    }
  }
}

/** Sem acento e sem caixa: "belém" encontra "Belém"; nada de busca aproximada além disso. */
export const normalizar = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Resolve os nomes pedidos contra as unidades que a pessoa enxerga. Nome que não está no escopo
 * volta em `fora`, sem dizer se ele existe em outro lugar.
 */
export function resolverUnidades(pedidas: string[] | undefined, disponiveis: string[]) {
  if (!pedidas?.length) return { unidades: [] as string[], fora: [] as string[] };
  const mapa = new Map(disponiveis.map((d) => [normalizar(d), d]));
  const unidades: string[] = [];
  const fora: string[] = [];
  for (const p of pedidas) {
    const n = normalizar(p);
    const exata = mapa.get(n);
    // Prefixo único ("curitiba" → "Curitiba - PR"), nunca mais de um candidato.
    const prefixo = exata
      ? null
      : [...mapa.entries()].filter(([k]) => k.startsWith(n + " ") || k.startsWith(n + "-"));
    const achada = exata ?? (prefixo && prefixo.length === 1 ? prefixo[0][1] : null);
    if (achada && !unidades.includes(achada)) unidades.push(achada);
    else if (!achada) fora.push(p);
  }
  return { unidades, fora };
}

export const DIA_ISO = DIA;
