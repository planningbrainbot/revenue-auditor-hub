import { NOMES, PRODUTOS } from "./types.ts";
import type { Conta, Metrica, Movimento, Negocio, Oferta, Plano, Produto, Revisao } from "./types";

export const METRICAS: { key: Metrica; label: string }[] = [
  { key: "loaded", label: "Fila carregada" },
  { key: "started", label: "Leads trabalhados" },
  { key: "scheduled", label: "Reuniões marcadas" },
  { key: "meeting", label: "Reuniões realizadas" },
  { key: "validated", label: "Oportunidades validadas" },
  { key: "signed", label: "Contratos ganhos" },
];
export const FAIXAS: Record<string, [number, number | null]> = {
  "Até R$ 500 mil": [0, 0.5],
  "R$ 500 mil até R$ 1 milhão": [0.5, 1],
  "R$ 1 milhão até R$ 2 milhões": [1, 2],
  "R$ 2 milhões até R$ 4,8 milhões": [2, 4.8],
  "R$ 4,8 milhões até R$ 10 milhões": [4.8, 10],
  "R$ 10 milhões até R$ 25 milhões": [10, 25],
  "R$ 25 milhões até R$ 50 milhões": [25, 50],
  "R$ 50 milhões até R$ 78 milhões": [50, 78],
  "Entre R$ 78 milhões e R$ 300 milhões": [78, 300],
  "Acima de R$ 300 milhões": [300, null],
  "[ANTIGO] Acima de R$ 78 milhões": [78, null],
  "[ANTIGO] Entre R$ 4,8 milhões e R$ 78 milhões": [4.8, 78],
};
export const normal = (v: string | null | undefined) =>
  (v || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
// Carga com mais de 30 minutos é "parada": o sync roda a cada 5. Regra da barra de frescor da
// Monetização, também usada pelo Cockpit do CEO para marcar número parcial.
export const LIMITE_CARGA_PARADA_MS = 30 * 60_000;
export const hoje = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function dias(from: string, to: string): string[] {
  const parse = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    Number.isFinite(Date.parse(s)) &&
    new Date(s).toISOString().slice(0, 10) === s;
  if (!parse(from) || !parse(to) || from > to) throw new Error("Informe um período válido.");
  const n = Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
  if (n > 1095) throw new Error("Selecione um período de até três anos.");
  return Array.from({ length: n + 1 }, (_, i) =>
    new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10),
  );
}
export const distancia = (a: string, b: string) =>
  Math.max(0, Math.floor((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000));
export const uteis = (from: string, to: string) =>
  dias(from, to).filter((d) => ![0, 6].includes(new Date(d).getUTCDay())).length;
export const baseRetroativaConsultoria = (a: Conta) =>
  a.old_base === true &&
  !a.new_commercial &&
  a.consultoria_origin?.status === "retroativa" &&
  (!a.base_origin || a.base_origin.status === "antiga");
export const SITUACOES_RECEITA = {
  ativa: "Ativa na Receita",
  baixada: "Baixada na Receita",
  inapta: "Inapta na Receita",
  suspensa: "Suspensa na Receita",
} as const;
// Rótulo único da situação cadastral, para tela e CSV. Estado novo da Receita cai no texto cru em
// vez de sumir: melhor a tela mostrar um código estranho do que fingir que a empresa está ativa.
export const rotuloSituacaoReceita = (a: Conta): string | null =>
  a.situacao_receita
    ? ((SITUACOES_RECEITA as Record<string, string>)[a.situacao_receita] ??
      `${a.situacao_receita} na Receita`)
    : null;
// Empresa fechada não é oportunidade dos produtos; fica na lista separada para uso futuro
// (decisão do dono em 18/09/2026). A situação vem da consulta em lote da Receita — um congelado.
// Quando a inscrição é regularizada, `review.situacao_receita = "ativa"` no editor de lista é o
// caminho de volta dentro do produto, com o mesmo trilho de auditoria do regime.
export function situacaoForaDeOferta(a: Conta, review: Revisao = {}): string | null {
  const s = review.situacao_receita || a.situacao_receita;
  if (!s || s === "ativa") return null;
  return `Empresa ${s} na Receita Federal${a.situacao_receita_fonte ? ` (${a.situacao_receita_fonte})` : ""}. Fora das ofertas; fica na lista de empresas inativas.`;
}
// Teto legal pelo porte quando não há faixa declarada. Um só limite para oferta, filtro e ordenação.
export const limiteFaturamento = (
  a: Conta,
  band = a.band || "",
): [number, number | null] | undefined =>
  FAIXAS[band] ?? (!band && a.faturamento_teto != null ? [0, a.faturamento_teto] : undefined);
export const tetoEmReais = (teto: number) => `R$ ${String(teto).replace(".", ",")} mi`;
// O mesmo texto na linha da tabela e no CSV: sem faixa declarada, o teto do porte é o que se sabe.
export function faturamentoDeclarado(a: Conta): string {
  if (a.band) return a.band;
  if (a.faturamento_teto != null)
    return `Até ${tetoEmReais(a.faturamento_teto)} · teto pelo porte (${a.faturamento_teto_fonte || "Receita"})`;
  return "Declarado não informado";
}
// Faixa declarada acima do teto legal do porte: as duas fontes não podem estar certas. A faixa segue
// mandando (é declaração do sócio), mas o conflito para de ficar escondido.
export function tetoContradizFaixa(a: Conta): string | null {
  const bounds = FAIXAS[a.band || ""];
  if (!bounds || a.faturamento_teto == null || bounds[0] <= a.faturamento_teto) return null;
  return `Faixa declarada acima do teto do porte na Receita (até ${tetoEmReais(a.faturamento_teto)}). Confirmar com o sócio.`;
}
export function oferta(a: Conta, produto: Produto, review: Revisao = {}): Oferta {
  if (a.base?.identity_conflict)
    return {
      status: "revisar",
      reason: "CNPJ divergente entre fontes; revisar a identidade antes de enviar.",
    };
  const regime = normal(review.regime || a.regime);
  const band = review.band || a.band || "";
  // Sem faixa cadastrada, o porte na Receita (ME até R$ 0,36 mi, EPP até R$ 4,8 mi) é teto legal de
  // faturamento: basta para o corte de Finance e para excluir de Cella, sem virar faixa declarada.
  const teto = !band && a.faturamento_teto != null ? a.faturamento_teto : null;
  const bounds = limiteFaturamento(a, band);
  const pelaReceita = teto != null ? " pelo porte na Receita" : "";
  const result = (status: Oferta["status"], reason: string) => ({ status, reason });
  const parada = situacaoForaDeOferta(a, review);
  if (parada) return result("fora_regra", parada);
  if (a.base?.source_status === "absent")
    return result("revisar", "Cadastro ausente no Pipefy; revisar a origem antes de enviar.");
  if (produto === "consultoria") {
    if (a.new_commercial || a.consultoria_origin?.status === "comercial")
      return result(
        "fora_regra",
        "Fechamento pelo comercial identificado. Não pertence ao Aquário retroativo de Consultoria.",
      );
    if (a.base_origin && a.base_origin.status !== "antiga")
      return result(
        a.base_origin.status === "nova" ? "fora_regra" : "revisar",
        a.base_origin.reason,
      );
    if (!baseRetroativaConsultoria(a))
      return result(
        a.old_base ? "revisar" : "fora_regra",
        a.consultoria_origin?.reason || "Origem Base Antiga das unidades não comprovada.",
      );
    if (
      /simples|mei/.test(regime) ||
      (!review.regime && a.consultoria_origin?.non_simples_confirmed === false)
    )
      return result("fora_regra", "Regime Simples Nacional ou MEI.");
    if (!review.regime && a.regime_conflict)
      return result("revisar", "Fontes divergem sobre o regime tributário; confirmar com o sócio.");
    if (
      !["lucro real", "lucro presumido", "lucro arbitrado"].includes(regime) &&
      a.consultoria_origin?.non_simples_confirmed !== true
    )
      return result(
        "revisar",
        "Base retroativa confirmada. Falta comprovar que está fora do Simples.",
      );
    return result(
      "elegivel",
      "Base Antiga das unidades, sem fechamento pelo comercial e fora do Simples. Contato, faturamento e segmento não são vetos.",
    );
  }
  if (produto === "finance" && !a.pipedrive_contract)
    return result("fora_regra", "Sem contrato ganho identificado no Pipedrive.");
  if (/simples|mei/.test(regime) || (!review.regime && a.base?.tax_evidence?.non_simples === false))
    return result("fora_regra", "Regime Simples Nacional ou MEI.");
  if ((!review.regime && a.regime_conflict) || (!review.band && a.band_conflict))
    return result("revisar", "Fontes divergem; confirmar os dados com o sócio.");
  if (
    !["lucro real", "lucro presumido", "lucro arbitrado"].includes(regime) &&
    a.base?.tax_evidence?.non_simples !== true
  )
    return result("revisar", "Regime tributário a confirmar.");
  if (!bounds) return result("revisar", "Faixa de faturamento anual a confirmar.");
  if (produto === "finance") {
    if (bounds[0] >= 25)
      return result(
        "fora_regra",
        "Fora de Finance: faturamento cadastrado a partir de R$ 25 milhões. Finance exige abaixo de R$ 25 milhões; confira Cella.",
      );
    if (bounds[1] === null || bounds[1] > 25)
      return result(
        "revisar",
        "Faixa atravessa R$ 25 milhões; confirmar faturamento abaixo do limite.",
      );
    return result(
      "elegivel",
      `Contrato ganho no Pipedrive, faturamento abaixo de R$ 25 mi${pelaReceita} e regime fora do Simples.`,
    );
  }
  return bounds[0] >= 25
    ? result("elegivel", "Faturamento a partir de R$ 25 mi, fora do Simples.")
    : result(
        "fora_regra",
        `Cella: faturamento a partir de R$ 25 mi${teto != null ? "; porte ME/EPP na Receita fica abaixo" : ""}.`,
      );
}
export function negociosDaConta(a: Conta, cards: Negocio[]) {
  return cards.filter((c) => c.org_id !== null && a.orgs.includes(c.org_id));
}
export function disponibilidade(
  a: Conta,
  produto: Produto,
  cards: Negocio[],
  month = hoje().slice(0, 7),
  reservations: {
    account_key: string;
    product: Produto;
    status: string;
    deal_id: number | null;
  }[] = [],
) {
  const own = negociosDaConta(a, cards).filter((c) => c.route === produto);
  const open = own.find((c) => c.status === "open");
  if (open) return { free: false, reason: "Oportunidade aberta de " + NOMES[produto], deal: open };
  const reserved = reservations.find(
    (r) =>
      r.account_key === a.key &&
      r.product === produto &&
      ["sending", "sent", "uncertain"].includes(r.status),
  );
  if (reserved)
    return {
      free: false,
      reason:
        reserved.status === "uncertain"
          ? "Envio pendente de conferência"
          : "Oferta reservada / enviada ao CRM",
      deal: cards.find((c) => c.id === reserved.deal_id) || null,
    };
  const loaded = own.find((c) => c.events.loaded.some((e) => e.date.startsWith(month)));
  if (loaded)
    return { free: false, reason: "Já carregada neste mês para " + NOMES[produto], deal: loaded };
  return { free: true, reason: "Sem card aberto ou carga no mês · " + NOMES[produto], deal: null };
}
export interface Filtro {
  from: string;
  to: string;
  owner: number | null;
  product: Produto | "";
}
export function operacao(cards: Negocio[], f: Filtro) {
  const period = dias(f.from, f.to),
    pool = cards.filter((c) => !f.product || c.route === f.product);
  const match = (c: Negocio, k: Metrica, day?: string) =>
    c.events[k].some(
      (e) =>
        (day ? e.date === day : e.date >= f.from && e.date <= f.to) &&
        (!f.owner || e.actor_id === f.owner),
    );
  const rows = Object.fromEntries(
    METRICAS.map((m) => [m.key, pool.filter((c) => match(c, m.key))]),
  ) as Record<Metrica, Negocio[]>;
  const series = period.map((date) => {
    const started = pool.filter((c) => match(c, "started", date)).length,
      scheduled = pool.filter((c) => match(c, "scheduled", date)).length;
    return {
      date,
      label: date.slice(8) + "/" + date.slice(5, 7),
      started,
      scheduled,
      meeting: pool.filter((c) => match(c, "meeting", date)).length,
      conversion: started ? Math.round((scheduled / started) * 1000) / 10 : null,
    };
  });
  const current = pool.filter((c) => c.status === "open" && (!f.owner || c.owner_id === f.owner));
  const products = [...PRODUTOS, "sem_produto" as const].map((p) => ({
    product: p,
    ...Object.fromEntries(
      METRICAS.map((m) => [m.key, rows[m.key].filter((c) => c.route === p).length]),
    ),
  })) as ({ product: Produto | "sem_produto" } & Record<Metrica, number>)[];
  const convertedMeetings = rows.meeting.filter((c) =>
    c.events.validated.some(
      (v) =>
        v.date <= f.to &&
        c.events.meeting.some(
          (m) => m.date >= f.from && m.date <= v.date && (!f.owner || m.actor_id === f.owner),
        ),
    ),
  );
  return {
    rows,
    series,
    current,
    products,
    convertedMeetings,
    conversion: rows.meeting.length ? convertedMeetings.length / rows.meeting.length : null,
  };
}
export function quantil(values: number[], q: number): number | null {
  if (!values.length) return null;
  const a = [...values].sort((a, b) => a - b),
    x = (a.length - 1) * q,
    lower = Math.floor(x);
  return a[lower] + (a[Math.ceil(x)] - a[lower]) * (x - lower);
}
export function temporal(cards: Negocio[], f: Filtro) {
  const selected = cards.filter(
    (c) => (!f.product || c.route === f.product) && (!f.owner || c.owner_id === f.owner),
  );
  const signed = selected.filter(
    (c) => c.status === "won" && c.won_on && c.won_on >= f.from && c.won_on <= f.to && c.started_at,
  );
  const cycles = signed.map((c) => distancia(c.started_at!, c.won_on!));
  const open = selected.filter((c) => c.status === "open" && c.validated_at);
  const weeks = new Map<string, Negocio[]>();
  for (const c of open) {
    let key = "Sem data";
    if (c.expected_close) {
      const d = new Date(c.expected_close + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      key = d.toISOString().slice(0, 10);
    }
    weeks.set(key, [...(weeks.get(key) || []), c]);
  }
  return {
    signed,
    median: quantil(cycles, 0.5),
    p90: quantil(cycles, 0.9),
    open,
    weeks: [...weeks]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([week, rows]) => ({ week, rows, revenue: receitaSomada(rows) })),
  };
}
export function receitaSomada(cards: Negocio[]) {
  const totals = { total: 0, partners: 0, unit: 0, known: 0, missing: 0, divergent: 0 };
  for (const c of cards) {
    if (
      ["ok", "calculated"].includes(c.revenue.status) &&
      [c.revenue.total, c.revenue.partners, c.revenue.unit]
        .filter((x) => x.amount !== null)
        .every((x) => x.currency === "BRL")
    ) {
      totals.total += Math.round((c.revenue.total.amount ?? c.revenue.sum ?? 0) * 100);
      totals.partners += Math.round((c.revenue.partners.amount ?? 0) * 100);
      totals.unit += Math.round((c.revenue.unit.amount ?? 0) * 100);
      totals.known++;
    } else {
      totals.missing++;
      if (c.revenue.status === "mismatch") totals.divergent++;
    }
  }
  return {
    ...totals,
    total: totals.total / 100,
    partners: totals.partners / 100,
    unit: totals.unit / 100,
  };
}
export function capacidade(
  plan: Plano,
  accounts: Conta[],
  cards: Negocio[],
  f: Filtro,
  reservations: Parameters<typeof disponibilidade>[4] = [],
) {
  const actual = operacao(cards, f);
  return PRODUTOS.map((product) => {
    const eligible = accounts.filter((a) => oferta(a, product).status === "elegivel");
    const available = eligible.filter(
      (a) => disponibilidade(a, product, cards, plan.month, reservations).free,
    );
    const started = actual.rows.started.filter((c) => c.route === product).length;
    const planned = Math.max(0, plan.allocation[product]);
    const remaining = Math.max(0, planned - started);
    const approved = plan.rates[product];
    return {
      product,
      eligible: eligible.length,
      available: available.length,
      started,
      planned,
      remaining,
      executable: Math.min(remaining, available.length),
      gap: Math.max(0, remaining - available.length),
      estimate:
        approved === null
          ? null
          : actual.rows.validated.filter((c) => c.route === product).length * approved,
    };
  });
}
export function csv(rows: unknown[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((x) => {
            let s = String(x ?? "");
            if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(";"),
      )
      .join("\r\n")
  );
}
// Farmer da Monetização. Único da frente desde set/2026 (decisão do dono em 24/09/2026): a Operação
// mede o trabalho dele e não oferece mais o seletor de responsável.
export const FARMER = { id: 28381245, nome: "Matheus Carvalho" } as const;

/** Conversão de uma etapa para a seguinte, com uma casa. Etapa de cima vazia não tem taxa. */
export function taxa(valor: number, anterior: number): number | null {
  return anterior > 0 ? valor / anterior : null;
}

export interface EtapaFunil {
  key: string;
  nome: string;
  stage_id: number | null;
  /** Cards que entraram na etapa no período. `null` = a carga ainda não mede esta etapa. */
  entraram: Negocio[] | null;
  /** Cards abertos na etapa agora, como no pipe. `null` para Ganho. */
  parados: Negocio[] | null;
}

const standBy = (nome: string) => /stand ?by/i.test(nome);
// Sem `moves` (carga anterior à versão 4) só as etapas com evento próprio são mensuráveis.
const EVENTO_DA_ETAPA: [RegExp, Metrica][] = [
  [/base/i, "loaded"],
  [/reuni.*(agend|marc)/i, "scheduled"],
  [/reuni.*realiz/i, "meeting"],
];

/**
 * Funil da Operação, no molde do painel do Recon: por etapa, quantos entraram no período (filtro de
 * datas, produto e farmer) e quantos estão parados nela hoje (o pipe inteiro, sem filtro de data e
 * sem filtro de dono, para bater com o Pipedrive). Stand by fica fora da sequência: é espera, não
 * passo. Ganho fecha o funil pelo evento de ganho.
 */
export function funil(
  cards: Negocio[],
  stages: { id: number; name: string; order: number }[],
  f: Filtro,
) {
  const pool = cards.filter((c) => !f.product || c.route === f.product);
  const vale = (m: Movimento) =>
    m.date >= f.from && m.date <= f.to && (!f.owner || m.actor_id === f.owner);
  const porEtapa = pool.some((c) => Array.isArray(c.moves));
  const ordenadas = [...stages].sort((a, b) => a.order - b.order);
  const etapa = (s: { id: number; name: string }): EtapaFunil => {
    const evento = EVENTO_DA_ETAPA.find(([re]) => re.test(s.name))?.[1];
    return {
      key: String(s.id),
      nome: s.name,
      stage_id: s.id,
      entraram: porEtapa
        ? pool.filter((c) => c.moves?.some((m) => m.stage_id === s.id && vale(m)))
        : evento
          ? pool.filter((c) => c.events[evento].some(vale))
          : null,
      parados: pool.filter((c) => c.status === "open" && c.stage_id === s.id),
    };
  };
  const etapas = [
    ...ordenadas.filter((s) => !standBy(s.name)).map(etapa),
    {
      key: "ganho",
      nome: "Ganho",
      stage_id: null,
      entraram: pool.filter((c) => c.events.signed.some(vale)),
      parados: null,
    },
  ];
  const espera = ordenadas.filter((s) => standBy(s.name)).map(etapa);
  const medePerda = pool.some((c) => c.lost_on !== undefined);
  const perdidos = medePerda
    ? pool.filter(
        (c) =>
          c.status === "lost" &&
          !!c.lost_on &&
          c.lost_on >= f.from &&
          c.lost_on <= f.to &&
          (!f.owner || c.owner_id === f.owner),
      )
    : null;
  return {
    etapas,
    espera,
    perdidos,
    porEtapa,
    abertos: pool.filter((c) => c.status === "open").length,
  };
}

export type StatusMeta = "na-meta" | "fora" | "dia-em-curso" | "sem-meta";
export interface QuadroMeta {
  chave: "started" | "scheduled" | "meeting" | "validated" | "signed";
  rotulo: string;
  /** Número do quadro: ritmo por dia útil ou total do período. */
  valor: number;
  unidade?: string;
  total: number;
  meta: number | null;
  status: StatusMeta;
  nota: string;
  formula: string;
}

/**
 * Os cinco quadros de meta do farmer, no molde dos quadros de meta do Recon. Ritmo é total do
 * período ÷ dias úteis do período (segunda a sexta, sem feriado), e não depende do tamanho do
 * período. Contrato é total contra a meta mensal proporcional aos dias úteis do período.
 * Abaixo da meta num período que é só hoje é "dia em curso", não "fora".
 */
export function metasOperacao(
  view: ReturnType<typeof operacao>,
  plan: Plano | undefined,
  f: Filtro,
  hojeIso = hoje(),
): { quadros: QuadroMeta[]; uteis: number } {
  const n = uteis(f.from, f.to);
  const soHoje = f.from === hojeIso && f.to === hojeIso;
  const ritmo = (total: number) => (n ? Math.round((total / n) * 10) / 10 : 0);
  const status = (valor: number, meta: number | null): StatusMeta =>
    meta === null ? "sem-meta" : valor >= meta ? "na-meta" : soHoje ? "dia-em-curso" : "fora";
  const emDias = (total: number) => `${total} em ${n} ${n === 1 ? "dia útil" : "dias úteis"}`;
  const mes = f.to.slice(0, 7);
  const uteisMes = uteis(mes + "-01", fimDoMes(mes));
  const metaContratos =
    plan?.target_contracts && uteisMes
      ? Math.round(((plan.target_contracts * Math.min(n, uteisMes)) / uteisMes) * 10) / 10
      : null;
  const t = (k: Metrica) => view.rows[k].length;
  const metaLeads = plan?.daily_target || null;
  const quadros: QuadroMeta[] = [
    {
      chave: "started",
      rotulo: "Leads trabalhados por dia útil",
      valor: ritmo(t("started")),
      total: t("started"),
      meta: metaLeads,
      status: status(ritmo(t("started")), metaLeads),
      nota: emDias(t("started")),
      formula:
        "Cards que saíram da Base elegível no período, pelo movimento do farmer, divididos pelos dias úteis.",
    },
    {
      chave: "scheduled",
      rotulo: "Reuniões marcadas por dia útil",
      valor: ritmo(t("scheduled")),
      total: t("scheduled"),
      meta: null,
      status: "sem-meta",
      nota: emDias(t("scheduled")),
      formula: "Cards movidos para Reunião agendada no período, divididos pelos dias úteis.",
    },
    {
      chave: "meeting",
      rotulo: "Reuniões realizadas por dia útil",
      valor: ritmo(t("meeting")),
      total: t("meeting"),
      meta: null,
      status: "sem-meta",
      nota: emDias(t("meeting")),
      formula: "Cards movidos para Reunião realizada no período, divididos pelos dias úteis.",
    },
    {
      chave: "validated",
      rotulo: "Oportunidades validadas",
      valor: t("validated"),
      total: t("validated"),
      meta: null,
      status: "sem-meta",
      nota: view.rows.meeting.length
        ? `${view.convertedMeetings.length} de ${view.rows.meeting.length} reuniões viraram oportunidade`
        : "Nenhuma reunião realizada no período",
      formula:
        "Primeiro avanço a Em negociação ou etapa posterior no período, atribuído a quem moveu o card.",
    },
    {
      chave: "signed",
      rotulo: "Contratos ganhos",
      valor: t("signed"),
      total: t("signed"),
      meta: metaContratos,
      status: status(t("signed"), metaContratos),
      nota: plan?.target_contracts
        ? `Meta de ${plan.target_contracts} no mês, proporcional a ${n} de ${uteisMes} dias úteis`
        : "Meta do mês a definir",
      formula:
        "Negócios marcados como ganhos no Pipedrive no período, pelo farmer. Card ganho por outra pessoa em outro pipe e trazido depois para cá não conta.",
    },
  ];
  return { quadros, uteis: n };
}
function fimDoMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}
