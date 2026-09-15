import { NOMES, PRODUTOS } from "./types.ts";
import type { Conta, Metrica, Negocio, Oferta, Plano, Produto, Revisao } from "./types";

export const METRICAS: { key: Metrica; label: string }[] = [
  { key: "loaded", label: "Fila carregada" },
  { key: "started", label: "Leads trabalhados" },
  { key: "scheduled", label: "Reuniões marcadas" },
  { key: "meeting", label: "Reuniões realizadas" },
  { key: "validated", label: "Oportunidades validadas" },
  { key: "signed", label: "Contratos assinados" },
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
export function oferta(a: Conta, produto: Produto, review: Revisao = {}): Oferta {
  const regime = normal(review.regime || a.regime),
    segmento = normal(review.segment || a.segment);
  const band = review.band || a.band || "",
    bounds = FAIXAS[band];
  const result = (status: Oferta["status"], reason: string) => ({ status, reason });
  if (produto === "finance" && !a.pipedrive_contract)
    return result("fora_regra", "Sem contrato ganho identificado no Pipedrive.");
  if (/simples|mei/.test(regime)) return result("fora_regra", "Regime Simples Nacional ou MEI.");
  if (
    (!review.regime && a.regime_conflict) ||
    (!review.band && a.band_conflict) ||
    (produto === "consultoria" && !review.segment && a.segment_conflict)
  )
    return result("revisar", "Fontes divergem; confirmar os dados com o sócio.");
  if (!["lucro real", "lucro presumido", "lucro arbitrado"].includes(regime))
    return result("revisar", "Regime tributário a confirmar.");
  if (produto === "consultoria") {
    if (regime !== "lucro real")
      return result("fora_regra", "Consultoria: perfil definido para Lucro Real.");
    if (!segmento || /nao informado|outros/.test(segmento))
      return result("revisar", "Confirmar segmento: indústria, agro, distribuição ou varejo.");
    if (!/industr|agro|varejo|distribui/.test(segmento))
      return result("fora_regra", "Segmento fora do perfil de Consultoria.");
    if (!bounds)
      return result(
        "revisar",
        "Faturamento a confirmar com o sócio; sem piso adicional de Consultoria.",
      );
    return result(
      "elegivel",
      "Lucro Real e segmento do perfil. Validar origem retroativa e oportunidade com o sócio.",
    );
  }
  if (!bounds) return result("revisar", "Faixa de faturamento anual a confirmar.");
  if (produto === "finance") {
    if (bounds[0] >= 25)
      return result("fora_regra", "Faturamento anual a partir de R$ 25 milhões.");
    if (bounds[1] === null || bounds[1] > 25)
      return result(
        "revisar",
        "Faixa atravessa R$ 25 milhões; confirmar faturamento abaixo do limite.",
      );
    return result(
      "elegivel",
      "Contrato ganho no Pipedrive, faixa abaixo de R$ 25 mi e regime fora do Simples.",
    );
  }
  return bounds[0] >= 25
    ? result("elegivel", "Faturamento a partir de R$ 25 mi, fora do Simples.")
    : result("fora_regra", "Cella: faturamento a partir de R$ 25 mi.");
}
export function negociosDaConta(a: Conta, cards: Negocio[]) {
  return cards.filter((c) => c.org_id !== null && a.orgs.includes(c.org_id));
}
export function disponibilidade(
  a: Conta,
  produto: Produto,
  cards: Negocio[],
  month = hoje().slice(0, 7),
) {
  const own = negociosDaConta(a, cards).filter((c) => c.route === produto);
  const open = own.find((c) => c.status === "open");
  if (open) return { free: false, reason: "Oportunidade aberta de " + NOMES[produto], deal: open };
  const loaded = own.find((c) => c.events.loaded.some((e) => e.date.startsWith(month)));
  if (loaded)
    return { free: false, reason: "Já trabalhada neste mês para " + NOMES[produto], deal: loaded };
  return { free: true, reason: "Disponível para " + NOMES[produto], deal: null };
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
    (c) => c.signed_on && c.signed_on >= f.from && c.signed_on <= f.to && c.started_at,
  );
  const cycles = signed.map((c) => distancia(c.started_at!, c.signed_on!));
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
export function capacidade(plan: Plano, accounts: Conta[], cards: Negocio[], f: Filtro) {
  const actual = operacao(cards, f);
  return PRODUTOS.map((product) => {
    const eligible = accounts.filter((a) => oferta(a, product).status === "elegivel");
    const available = eligible.filter((a) => disponibilidade(a, product, cards, plan.month).free);
    const started = actual.rows.started.filter((c) => c.route === product).length;
    const planned = Math.max(0, plan.allocation[product]);
    const approved = plan.rates[product];
    return {
      product,
      eligible: eligible.length,
      available: available.length,
      started,
      planned,
      executable: Math.min(planned, available.length),
      gap: Math.max(0, planned - available.length),
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
