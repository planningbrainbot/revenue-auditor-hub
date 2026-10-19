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
import {
  PASSOS,
  ROTULO_PASSO,
  URGENCIAS,
} from "../../../supabase/functions/monetizacao-proximo-passo/logica.ts";
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
  /** Os cards do universo, com horizonte e valor (a fila do dia parte deles). */
  itens: CardForecast[];
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
    itens,
  };
}

// ---------------------------------------------------------------------------- fila do dia (19/10/2026)

/**
 * `ops.monetizacao_forecast_fila()`: o próximo passo do Jev, a última nota do dono e o bloqueio da Consultoria de cada
 * card da reta final. Pedido do Pedro em 19/10/2026: a tela abre pelo que fazer hoje (protótipo
 * https://claude.ai/artifact/C2zwdHXMixW8ZdWJd5VfEH; contrato docs/design/contratos/monetizacao-fechamentos.md).
 */
export interface LinhaFilaJev {
  deal_id: number;
  passo: string | null;
  confianca: number | null;
  /** 0 = pode esperar até a semana que vem, 1 = nesta semana, 2 = hoje. */
  urgencia: number | null;
  gerado_em: string | null;
  nota: string | null;
  nota_em: string | null;
  /** Motivo do bloqueio da Consultoria (já é cliente, contrato ou proposta aberta); null = não está na Consultoria. */
  consultoria: string | null;
}

const objeto = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const textoOuNulo = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const numeroOuNulo = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export const normalizarFila = (linhas: unknown): LinhaFilaJev[] =>
  (Array.isArray(linhas) ? linhas : [])
    .map(objeto)
    .map((l) => {
      const passo = textoOuNulo(l.passo);
      return {
        deal_id: numeroOuNulo(l.deal_id) ?? 0,
        passo: passo && passo in ROTULO_PASSO ? passo : null,
        confianca: numeroOuNulo(l.confianca),
        urgencia: numeroOuNulo(l.urgencia),
        gerado_em: textoOuNulo(l.gerado_em),
        nota: textoOuNulo(l.nota),
        nota_em: textoOuNulo(l.nota_em),
        consultoria: textoOuNulo(l.consultoria),
      };
    })
    .filter((l) => l.deal_id > 0);

export type FiltroFila = "hoje" | "semana" | "mes" | "semdata" | "consultoria";
export const FILTROS_FILA: { chave: FiltroFila; rotulo: string }[] = [
  { chave: "hoje", rotulo: "Fazer hoje" },
  { chave: "semana", rotulo: "Nesta semana" },
  { chave: "mes", rotulo: "Fecha no mês" },
  { chave: "semdata", rotulo: "Sem data esperada nem valor" },
  { chave: "consultoria", rotulo: "Também na Consultoria" },
];
/** Ordem dos grupos da fila: do passo que mais move o card ao que encerra. */
export const ORDEM_PASSOS = [
  "ligar_hoje",
  "cobrar_retorno",
  "marcar_especialista",
  "enviar_proposta",
  "agendar_retomada",
  "perder_com_motivo",
] as const;

export interface LinhaFila {
  item: CardForecast;
  jev: LinhaFilaJev | null;
  /** Sem data esperada no card e sem receita prevista. */
  semDataNemValor: boolean;
}
export interface GrupoFila {
  /** O passo do Jev; null = sem sugestão. */
  passo: string | null;
  rotulo: string;
  /** Explicação do passo (o porquê da sugestão), a mesma que o Jev recebe. */
  porque: string;
  linhas: LinhaFila[];
}
export interface FilaDoDia {
  contagem: Record<FiltroFila, number>;
  total: number;
  grupos: GrupoFila[];
  /** Linhas do filtro escolhido. */
  filtradas: number;
  /** A fila do Jev não veio (função ausente ou erro): os cards aparecem sem passo. */
  semJev: boolean;
}

const NO_MES: Horizonte[] = ["atrasado", "hoje", "semana", "mes"];
const PASSA: Record<FiltroFila, (l: LinhaFila) => boolean> = {
  hoje: (l) => l.jev?.urgencia === 2,
  semana: (l) => l.jev?.urgencia === 1,
  mes: (l) => NO_MES.includes(l.item.horizonte),
  semdata: (l) => l.semDataNemValor,
  consultoria: (l) => !!l.jev?.consultoria,
};

/** A fila do dia: os cards do universo do Forecast com o passo do Jev, agrupados pelo passo, no filtro escolhido. */
export function filaDoDia(
  fc: Forecast,
  fila: LinhaFilaJev[] | null,
  filtro: FiltroFila = "hoje",
): FilaDoDia {
  const doJev = new Map((fila ?? []).map((l) => [l.deal_id, l]));
  const linhas: LinhaFila[] = fc.itens.map((item) => ({
    item,
    jev: doJev.get(item.card.id) ?? null,
    semDataNemValor: !diaSP(item.card.expected_close) && valorDoCard(item.card) === null,
  }));
  const contagem = Object.fromEntries(
    FILTROS_FILA.map((f) => [f.chave, linhas.filter(PASSA[f.chave]).length]),
  ) as Record<FiltroFila, number>;
  const escolhidas = linhas.filter(PASSA[filtro]);
  const porPasso = new Map<string | null, LinhaFila[]>();
  for (const l of escolhidas) {
    const k = l.jev?.passo ?? null;
    porPasso.set(k, [...(porPasso.get(k) ?? []), l]);
  }
  const ordem = (l: LinhaFila) => [-(l.jev?.urgencia ?? -1), -(l.jev?.confianca ?? 0)];
  const grupos: GrupoFila[] = [...ORDEM_PASSOS, null]
    .filter((p) => porPasso.has(p))
    .map((p) => ({
      passo: p,
      rotulo: p ? ROTULO_PASSO[p] : "Sem sugestão do Jev",
      porque: p ? PASSOS[p] : "O Jev ainda não sugeriu um passo para este card.",
      linhas: porPasso.get(p)!.sort((a, b) => {
        const [ua, ca] = ordem(a);
        const [ub, cb] = ordem(b);
        return ua - ub || ca - cb;
      }),
    }));
  return {
    contagem,
    total: linhas.length,
    grupos,
    filtradas: escolhidas.length,
    semJev: fila === null,
  };
}

export const rotuloUrgencia = (u: number | null) => (u === null ? "" : (URGENCIAS[u] ?? ""));
