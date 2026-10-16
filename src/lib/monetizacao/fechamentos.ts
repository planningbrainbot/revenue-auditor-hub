/**
 * Régua da tela Forecast da Monetização (`/monetizacao?aba=fechamentos`, 14/10/2026). Pedido do Paulo na call de 14/10
 * (11:35–13:42): forecast de resultado, o que tem expectativa de fechar no dia, na semana e no mês, pela data esperada
 * de fechamento que o time atualiza na daily; e forecast de receita, os contratos fechados e os que devem fechar, pelo
 * valor do card ou pelo ticket médio do produto. PRD: https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4, slide 4.
 *
 * - Universo: abertos da Reunião de proposta em diante (Reunião de proposta, Em negociação, Proposta enviada), sem o
 *   Stand by, que é espera sem data.
 * - Data esperada: `expected_close` do card (Pipedrive), no fuso de São Paulo.
 * - Valor: a Receita prevista total do card; sem ela, o ticket médio dos contratos ganhos do produto no pipe 39, com
 *   receita preenchida. Produto sem contrato ganho com valor não tem ticket medido: o card conta, sem valor.
 *   Nenhuma premissa de forecast entra aqui (a de Finance foi recusada pelo Pedro em 06/10).
 */
import { noProduto, reguaDoPipe, type Etapa } from "./funil-cumulativo.ts";
import { doResponsavel, type RecorteResponsavel } from "./responsavel.ts";
import {
  PRODUTOS,
  produtosDoRecorte,
  type Negocio,
  type Produto,
  type ProdutoDoRecorte,
} from "./types.ts";

export type Horizonte = "atrasado" | "hoje" | "semana" | "mes" | "depois" | "semData";

export const HORIZONTES: { chave: Horizonte; rotulo: string }[] = [
  { chave: "atrasado", rotulo: "Data já passou" },
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "semana", rotulo: "Até domingo" },
  { chave: "mes", rotulo: "Até o fim do mês" },
  { chave: "depois", rotulo: "Depois do mês" },
  { chave: "semData", rotulo: "Sem data nem previsão" },
];

export interface TicketMedido {
  produto: Produto;
  /** Média da receita prevista total dos contratos ganhos do produto; `null` = sem contrato ganho com valor. */
  valor: number | null;
  contratos: number;
}

export interface CardForecast {
  card: Negocio;
  produto: Produto | "sem_produto";
  horizonte: Horizonte;
  /** Receita do card ou ticket médio do produto; `null` sem nenhum dos dois. */
  valor: number | null;
  /** De onde veio o valor. */
  origem: "card" | "ticket" | null;
  /** O horizonte veio da estimativa do Jev, porque o card não tem data esperada (15/10/2026). */
  estimado: boolean;
}

/** `ops.monetizacao_previsao_fechamento()`: o horizonte que o Jev estimou pelas notas do card sem data esperada. */
export interface PrevisaoJev {
  deal_id: number;
  horizonte: "esta_semana" | "este_mes" | "proximo_mes" | "sem_previsao";
  confianca: number | null;
}

const HORIZONTE_DO_JEV: Record<PrevisaoJev["horizonte"], Horizonte> = {
  esta_semana: "semana",
  este_mes: "mes",
  proximo_mes: "depois",
  sem_previsao: "semData",
};

export const normalizarPrevisoes = (linhas: unknown): PrevisaoJev[] =>
  (Array.isArray(linhas) ? linhas : [])
    .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
    .map((l) => ({
      deal_id: Number(l.deal_id) || 0,
      horizonte: String(l.horizonte) as PrevisaoJev["horizonte"],
      confianca:
        typeof l.confianca === "number" ? l.confianca : l.confianca ? Number(l.confianca) : null,
    }))
    .filter((p) => p.deal_id > 0 && p.horizonte in HORIZONTE_DO_JEV);

export interface GrupoForecast {
  chave: Horizonte;
  rotulo: string;
  itens: CardForecast[];
  valor: number;
  semValor: number;
  /** Quantos do grupo estão nele pela estimativa do Jev. */
  estimados: number;
}

export interface LinhaReceita {
  produto: Produto;
  ganhos: Negocio[];
  receitaGanha: number;
  ganhosSemValor: number;
  esperados: CardForecast[];
  receitaEsperada: number;
  esperadosSemValor: number;
  ticket: TicketMedido;
}

export interface Forecast {
  hoje: string;
  fimDaSemana: string;
  fimDoMes: string;
  grupos: GrupoForecast[];
  /** Abertos do universo. */
  total: number;
  receita: LinhaReceita[];
  tickets: TicketMedido[];
}

const DIA_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** "2026-10-20" fica como está; instante vira o dia em São Paulo. */
export const diaSP = (v: string | null | undefined) => {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = Date.parse(v.replace(" ", "T"));
  return Number.isFinite(t) ? DIA_SP.format(new Date(t)) : null;
};

const somaDias = (dia: string, n: number) =>
  new Date(Date.parse(dia + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
/** Domingo da semana do dia (a semana vai de segunda a domingo). */
export function fimDaSemana(dia: string): string {
  const w = new Date(dia + "T12:00:00Z").getUTCDay(); // 0 = domingo
  return somaDias(dia, w === 0 ? 0 : 7 - w);
}
export function fimDoMes(dia: string): string {
  const [a, m] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export function horizonteDe(data: string | null, hoje: string): Horizonte {
  if (!data) return "semData";
  if (data < hoje) return "atrasado";
  if (data === hoje) return "hoje";
  if (data <= fimDaSemana(hoje)) return "semana";
  if (data <= fimDoMes(hoje)) return "mes";
  return "depois";
}

/** Receita prevista total do contrato (campo do Pipedrive; sem o total, a soma de Partners e unidade). */
export const valorDoCard = (c: Negocio): number | null => {
  const v = c.revenue?.total?.amount ?? c.revenue?.sum ?? null;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
};

/** Ticket médio de cada produto: média dos contratos ganhos do pipe com receita preenchida (medido, nunca premissa). */
export function ticketsMedidos(cards: Negocio[]): TicketMedido[] {
  return PRODUTOS.map((produto) => {
    const valores = cards
      .filter((c) => c.status === "won" && c.route === produto)
      .map(valorDoCard)
      .filter((v): v is number => v !== null);
    return {
      produto,
      valor: valores.length
        ? Math.round(valores.reduce((a, b) => a + b, 0) / valores.length)
        : null,
      contratos: valores.length,
    };
  });
}

export function forecastDeFechamento(
  cards: Negocio[],
  stages: Etapa[],
  hoje: string,
  f: RecorteResponsavel & { product: ProdutoDoRecorte },
  previsoes: PrevisaoJev[] = [],
): Forecast {
  const regua = reguaDoPipe(stages);
  const previsaoDe = new Map(previsoes.map((p) => [p.deal_id, p]));
  const nProposta = regua.nivelDe.reuniaoProposta;
  const nNegociacao = regua.nivelDe.negociacao;
  const desde = Math.min(nProposta ?? Infinity, nNegociacao ?? Infinity);
  const tickets = ticketsMedidos(cards);
  const ticketDe = (p: Produto | "sem_produto") =>
    p === "sem_produto" ? null : (tickets.find((t) => t.produto === p)?.valor ?? null);
  const doRecorte = (c: Negocio) => noProduto(c, f.product) && doResponsavel(f, c.owner_id);
  const universo = cards.filter(
    (c) =>
      c.status === "open" &&
      !regua.standby.has(c.stage_id) &&
      (regua.nivelDaEtapa.get(c.stage_id) ?? -1) >= desde &&
      doRecorte(c),
  );
  const itens: CardForecast[] = universo.map((c) => {
    const produto = c.route;
    const proprio = valorDoCard(c);
    const ticket = proprio === null ? ticketDe(produto) : null;
    const data = diaSP(c.expected_close);
    const jev = data ? undefined : previsaoDe.get(c.id);
    return {
      card: c,
      produto,
      horizonte: jev ? HORIZONTE_DO_JEV[jev.horizonte] : horizonteDe(data, hoje),
      valor: proprio ?? ticket,
      origem: proprio !== null ? "card" : ticket !== null ? "ticket" : null,
      estimado: !!jev && jev.horizonte !== "sem_previsao",
    };
  });
  const grupos: GrupoForecast[] = HORIZONTES.map((h) => {
    const doGrupo = itens.filter((i) => i.horizonte === h.chave);
    return {
      ...h,
      itens: doGrupo,
      valor: doGrupo.reduce((s, i) => s + (i.valor ?? 0), 0),
      semValor: doGrupo.filter((i) => i.valor === null).length,
      estimados: doGrupo.filter((i) => i.estimado).length,
    };
  });
  // Receita do mês: ganhos no mês (pela data do ganho) e esperados até o fim do mês, inclusive os de data vencida,
  // que seguem abertos e ainda podem fechar no mês.
  const mes = hoje.slice(0, 7);
  const noMes: Horizonte[] = ["atrasado", "hoje", "semana", "mes"];
  const marcados = produtosDoRecorte(f.product);
  const receita: LinhaReceita[] = PRODUTOS.filter(
    (p) => !marcados.length || marcados.includes(p),
  ).map((produto) => {
    const ganhos = cards.filter(
      (c) =>
        c.status === "won" &&
        c.route === produto &&
        (c.won_on ?? "").startsWith(mes) &&
        doResponsavel(f, c.owner_id),
    );
    const esperados = itens.filter((i) => i.produto === produto && noMes.includes(i.horizonte));
    return {
      produto,
      ganhos,
      receitaGanha: ganhos.reduce((s, c) => s + (valorDoCard(c) ?? 0), 0),
      ganhosSemValor: ganhos.filter((c) => valorDoCard(c) === null).length,
      esperados,
      receitaEsperada: esperados.reduce((s, i) => s + (i.valor ?? 0), 0),
      esperadosSemValor: esperados.filter((i) => i.valor === null).length,
      ticket: tickets.find((t) => t.produto === produto)!,
    };
  });
  return {
    hoje,
    fimDaSemana: fimDaSemana(hoje),
    fimDoMes: fimDoMes(hoje),
    grupos,
    total: universo.length,
    receita,
    tickets,
  };
}
