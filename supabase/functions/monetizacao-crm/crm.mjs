import { expectedRevenue } from "./revenue.mjs";
import { PRODUCT_KEY, localDate, today, METRICS } from "./dates.mjs";
export const PRODUCT = PRODUCT_KEY;
const SIGN = "97cd6f5f0f051d7dfd29e709bfde5c048a17cf3e",
  REVENUE = "a62c0a23d29d00e7a314531b1a4f6706a51474bf";
const id = (v) => Number(typeof v === "object" ? (v?.id ?? v?.value) : v) || null;
const route = (v) =>
  ({ 1128: "cella", 1129: "consultoria", 1130: "finance" })[String(v)] || "sem_produto";
const unique = (rows) => [...new Map(rows.map((x) => [x.id, x])).values()];
async function mapLimit(rows, fn, n = 6) {
  const out = [];
  for (let i = 0; i < rows.length; i += n)
    out.push(...(await Promise.all(rows.slice(i, i + n).map(fn))));
  return out;
}
export function summarize(deals, stages, flows, month = today().slice(0, 7)) {
  stages = stages.filter((s) => !/(reciclad|perdid|descart|estacion|parking)/i.test(s.name));
  const first = stages[0].id,
    order = new Map(stages.map((s) => [Number(s.id), s.order_nr]));
  const stageFor = (re) => stages.find((s) => re.test(s.name));
  const scheduled = stageFor(/reuni.*(agend|marc)/i),
    meeting = stageFor(/reuni.*realiz/i),
    negotiation = stageFor(/negocia/i);
  if (!meeting || !negotiation) throw Error("Etapas de reunião e negociação não identificadas");
  const cards = deals.map((d) => {
    const flow = flows[d.id],
      known = Array.isArray(flow);
    const changes = (flow || [])
      .filter((e) => e.object === "dealChange" && e.data)
      .map((e) => e.data)
      .sort((a, b) => String(a.log_time).localeCompare(String(b.log_time)));
    const movements = changes.filter((e) => e.field_key === "stage_id");
    const ownerAt = (at) => {
      let owner = id(d.user_id);
      for (const e of [...changes].reverse())
        if (e.field_key === "user_id" && e.log_time > at) owner = id(e.old_value) || owner;
      return owner;
    };
    const events = Object.fromEntries(METRICS.map((k) => [k, []]));
    const add = (kind, at, actor, source) => {
      const date = localDate(at);
      if (date && !events[kind].some((e) => e.date === date && e.actor_id === actor))
        events[kind].push({ at, date, actor_id: actor, source });
    };
    add("loaded", d.add_time, ownerAt(d.add_time), "created");
    // Entrada em cada etapa do pipe, para o funil da Operação contar por etapa. A criação conta
    // como entrada na etapa em que o card nasceu; cada movimento, como entrada no destino.
    const moves = [];
    if (known) {
      const initial = movements.length
        ? id(movements[0].old_value) || id(movements[0].new_value)
        : d.stage_id;
      if (initial) {
        const at = d.add_time;
        moves.push({
          stage_id: initial,
          at,
          date: localDate(at),
          actor_id: ownerAt(at),
        });
      }
      for (const e of movements) {
        const dest = id(e.new_value);
        if (dest)
          moves.push({
            stage_id: dest,
            at: e.log_time,
            date: localDate(e.log_time),
            actor_id: id(e.user_id) || ownerAt(e.log_time),
          });
      }
      if ((order.get(initial) || 0) > order.get(first))
        add(
          "started",
          d.add_time,
          id(d.creator_user_id) || ownerAt(d.add_time),
          "created_in_stage",
        );
      if ((order.get(initial) || 0) >= negotiation.order_nr)
        add(
          "validated",
          d.add_time,
          id(d.creator_user_id) || ownerAt(d.add_time),
          "created_in_stage",
        );
      for (const e of movements) {
        const dest = id(e.new_value),
          previous = id(e.old_value),
          actor = id(e.user_id) || ownerAt(e.log_time);
        if (
          !events.started.length &&
          (order.get(dest) || 0) > order.get(first) &&
          (previous === first || !order.has(previous))
        )
          add("started", e.log_time, actor, "stage_change");
        if (dest === scheduled?.id) add("scheduled", e.log_time, actor, "stage_change");
        if (dest === meeting.id) add("meeting", e.log_time, actor, "stage_change");
        if ((order.get(dest) || 0) >= negotiation.order_nr && !events.validated.length)
          add("validated", e.log_time, actor, "stage_change");
      }
    }
    // O indicador comercial é ganho no CRM. Assinatura e receita são completudes separadas.
    const wonChange = [...changes]
      .reverse()
      .find((e) => e.field_key === "status" && e.new_value === "won");
    const wonAt = d.status === "won" ? d.won_time || wonChange?.log_time || null : null;
    if (wonAt) add("signed", wonAt, id(wonChange?.user_id) || ownerAt(wonAt), "won_status");
    const revenue = d[REVENUE],
      expected = expectedRevenue(d),
      flags = Object.fromEntries(
        METRICS.map((k) => [k, events[k].some((e) => e.date.startsWith(month))]),
      );
    return {
      metric_version: 4,
      id: d.id,
      title: d.title.replace(/\s*\[(?:CO|HU|AQ):[a-f0-9-]+\]/g, ""),
      org: d.org_id?.name || null,
      org_id: id(d.org_id),
      owner: d.user_id?.name || "Sem responsável",
      owner_id: id(d.user_id),
      creator_id: id(d.creator_user_id),
      route: route(d[PRODUCT]),
      status: d.status,
      stage_id: d.stage_id,
      stage: stages.find((s) => s.id === d.stage_id)?.name || "Etapa não encontrada",
      order: order.get(d.stage_id),
      ...flags,
      events,
      started_at: events.started[0]?.at || null,
      validated_at: events.validated[0]?.at || null,
      signed_on: d[SIGN] || null,
      won_on: localDate(wonAt),
      lost_on: d.status === "lost" ? localDate(d.lost_time) : null,
      moves,
      expected_close: d.expected_close_date || null,
      revenue: expected,
      expected_revenue: expected.total.amount ?? expected.sum,
      contract_revenue:
        revenue === null || revenue === undefined || revenue === "" ? null : Number(revenue),
      created_at: d.add_time,
      updated_at: d.update_time,
      last_activity_date: d.last_activity_date || null,
      lost_reason: d.lost_reason || null,
      next_activity: d.next_activity_date || null,
      history_known: known,
      url: "https://grupoplanning.pipedrive.com/deal/" + d.id,
    };
  });
  const count = (r, k) => cards.filter((c) => (!r || c.route === r) && c[k]).length;
  const routes = Object.fromEntries(
    ["cella", "consultoria", "finance", "sem_produto"].map((r) => [
      r,
      Object.fromEntries(METRICS.map((k) => [k, count(r, k)])),
    ]),
  );
  const potential = cards.filter((c) => c.status === "open" && c.order >= negotiation.order_nr),
    dated = potential.filter((c) => String(c.expected_close || "").slice(0, 7) === month);
  const names = new Map([
    [28381245, "Matheus Carvalho"],
    [27369179, "Samira Vieira"],
  ]);
  for (const d of deals)
    if (id(d.user_id)) names.set(id(d.user_id), d.user_id?.name || "Usuário " + id(d.user_id));
  const allDates = cards
    .flatMap((c) =>
      Object.values(c.events)
        .flat()
        .map((e) => e.date),
    )
    .sort();
  return {
    schema_version: 3,
    month,
    today: today(),
    history_from: allDates[0] || today(),
    measured_at: new Date().toISOString(),
    cards,
    routes,
    totals: Object.fromEntries(METRICS.map((k) => [k, count(null, k)])),
    owners: [...names].map(([id, name]) => ({ id, name })),
    matheus: {
      id: 28381245,
      target: 120,
      loaded: cards.filter((c) => c.owner_id === 28381245 && c.loaded).length,
      started: cards.filter((c) =>
        c.events.started.some((e) => e.actor_id === 28381245 && e.date.startsWith(month)),
      ).length,
      validated: cards.filter((c) =>
        c.events.validated.some((e) => e.actor_id === 28381245 && e.date.startsWith(month)),
      ).length,
    },
    quality: {
      unknown_product: cards.filter((c) => c.loaded && c.route === "sem_produto").length,
      unknown_org: cards.filter((c) => c.loaded && !c.org_id).length,
      unknown_history: cards.filter((c) => !c.history_known).length,
      won_without_signature: cards.filter((c) => c.status === "won" && !c.signed_on).length,
    },
    pipeline: {
      potential: potential.length,
      dated: dated.length,
      no_date: potential.filter((c) => !c.expected_close).length,
      no_revenue: potential.filter((c) => c.expected_revenue === null).length,
      ids: potential.map((c) => c.id),
    },
    forecast: { target: month === "2026-09" ? 8 : null, estimate: null },
    product_field: {
      key: PRODUCT,
      name: "Caixa · Produto",
      options: [
        { id: 1128, label: "Cella" },
        { id: 1129, label: "Consultoria" },
        { id: 1130, label: "Finance" },
      ],
    },
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      order: s.order_nr,
      count: cards.filter((c) => c.status === "open" && c.stage_id === s.id).length,
    })),
  };
}
