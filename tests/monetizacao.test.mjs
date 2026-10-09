import test from "node:test";
import assert from "node:assert/strict";
import {
  oferta,
  disponibilidade,
  operacao,
  receitaSomada,
  dias,
  csv,
  abordagensPorDiaUtil,
  situacaoDoNegocio,
  produtoDoTitulo,
  cadastroACorrigir,
  cargaDoCrm,
  motivoLegivel,
} from "../src/lib/monetizacao/model.ts";
import { funilCumulativo } from "../src/lib/monetizacao/funil-cumulativo.ts";
import {
  summarize,
  PRODUCT,
  OFFERED,
  METRIC_VERSION,
} from "../supabase/functions/monetizacao-crm/crm.mjs";
import {
  expectedRevenue,
  registrarUnidades,
  REVENUE_FIELDS,
} from "../supabase/functions/monetizacao-crm/revenue.mjs";
import {
  cardDaEmpresa,
  orgDaHomonima,
  dealPayload,
  hasCanonicalProduct,
  sameProductDeal,
} from "../supabase/functions/monetizacao-crm/send.mjs";
import {
  escolherForecast,
  forecastComparison,
  opcoesDoForecast,
} from "../src/lib/monetizacao/forecast.ts";

test("Envio preenche o campo canônico de cada produto no pipe 39 e confere o retorno", () => {
  for (const [product, option] of [
    ["cella", 1128],
    ["consultoria", 1129],
    ["finance", 1130],
  ]) {
    const d = dealPayload({
      account: { name: "Empresa sintética" },
      product,
      org: 10,
      owner: 20,
      stage: 1,
      nonce: "teste",
    });
    assert.equal(d[PRODUCT], option);
    assert.equal(d.pipeline_id, 39);
    assert.equal(d.stage_id, 1);
    assert.equal(hasCanonicalProduct(d, product), true);
    assert.equal(hasCanonicalProduct({ ...d, [PRODUCT]: null }, product), false);
    assert.equal(hasCanonicalProduct({ ...d, pipeline_id: 1 }, product), false);
  }
  assert.throws(() => dealPayload({ product: "outro" }));
});

const account = (override = {}) => ({
  consultoria_origin: {
    status: "retroativa",
    non_simples_confirmed: null,
    reason: "Base Antiga comprovada",
  },
  key: "a",
  name: "Empresa sintética",
  units: [],
  unit_label: null,
  orgs: [10],
  contact: false,
  band: "R$ 10 milhões até R$ 25 milhões",
  regime: "Lucro Real",
  segment: "Indústria",
  old_base: true,
  matrix: false,
  new_commercial: false,
  pipedrive_contract: true,
  consultoria_priority: true,
  finance_candidate: true,
  finance: { status: "elegivel", reason: "" },
  ecd: false,
  ...override,
});
const stages = [
  { id: 1, order_nr: 1, name: "Base elegível" },
  { id: 2, order_nr: 2, name: "Abordagem em curso" },
  { id: 3, order_nr: 3, name: "Reunião agendada" },
  { id: 4, order_nr: 4, name: "Reunião realizada" },
  { id: 5, order_nr: 5, name: "Em negociação" },
  { id: 6, order_nr: 6, name: "Proposta enviada" },
  { id: 7, order_nr: 7, name: "Reciclado" },
];
const change = (old, newValue, at, actor = 20, field = "stage_id") => ({
  object: "dealChange",
  data: { field_key: field, old_value: old, new_value: newValue, log_time: at, user_id: actor },
});
const raw = (over = {}) => ({
  id: 100,
  title: "Empresa sintética",
  org_id: { value: 10, name: "Empresa sintética" },
  user_id: { id: 20, name: "Hunter" },
  creator_user_id: { id: 20 },
  stage_id: 5,
  status: "open",
  pipeline_id: 39,
  add_time: "2026-09-01 12:00:00",
  update_time: "2026-09-15 15:00:00",
  [PRODUCT]: 1129,
  ...over,
});
const card = (
  r = raw(),
  flow = [
    change(1, 2, "2026-09-02 12:00:00"),
    change(2, 4, "2026-09-03 12:00:00"),
    change(4, 5, "2026-09-04 12:00:00"),
  ],
) => summarize([r], stages, { [r.id]: flow }, "2026-09").cards[0];
const filter = { from: "2026-09-01", to: "2026-09-15", owner: 20, product: "" };

test("Finance: contrato ganho, menos de 25 mi, fora do Simples; não exige contato, CNPJ ou piso", () => {
  assert.equal(
    oferta(account({ band: "Até R$ 500 mil", regime: "Lucro Arbitrado" }), "finance").status,
    "elegivel",
  );
  assert.equal(oferta(account({ pipedrive_contract: false }), "finance").status, "fora_regra");
  for (const regime of ["Simples Nacional", "MEI"])
    assert.equal(oferta(account({ regime }), "finance").status, "fora_regra");
  assert.equal(
    oferta(account({ band: "R$ 25 milhões até R$ 50 milhões" }), "finance").status,
    "fora_regra",
  );
  assert.equal(
    oferta(account({ band: "[ANTIGO] Entre R$ 4,8 milhões e R$ 78 milhões" }), "finance").status,
    "revisar",
  );
  assert.equal(oferta(account({ regime: null }), "finance").status, "revisar");
  assert.equal(oferta(account({ band_conflict: true }), "finance").status, "revisar");
});
test("Consultoria é base antiga sem comercial e fora do Simples, sem contato, piso ou segmento obrigatório", () => {
  assert.equal(
    oferta(account({ band: null, segment: null, regime: "Lucro Presumido" }), "consultoria").status,
    "elegivel",
  );
  assert.equal(
    oferta(account({ segment_conflict: true, band_conflict: true }), "consultoria").status,
    "elegivel",
  );
  for (const regime of ["Simples Nacional", "MEI"])
    assert.equal(oferta(account({ regime }), "consultoria").status, "fora_regra");
  assert.equal(oferta(account({ regime: null }), "consultoria").status, "revisar");
  assert.equal(oferta(account({ old_base: false }), "consultoria").status, "fora_regra");
  assert.equal(oferta(account({ consultoria_origin: undefined }), "consultoria").status, "revisar");
  for (const fields of [
    { new_commercial: true },
    { consultoria_origin: { status: "comercial" } },
  ]) {
    assert.equal(oferta(account(fields), "consultoria").status, "fora_regra");
    assert.equal(
      oferta(account(fields), "consultoria", {
        regime: "Lucro Real",
        segment: "Indústria",
        band: "R$ 10 milhões até R$ 25 milhões",
      }).status,
      "fora_regra",
    );
  }
  assert.equal(
    oferta(
      account({
        regime: null,
        consultoria_origin: { status: "retroativa", non_simples_confirmed: true },
      }),
      "consultoria",
    ).status,
    "elegivel",
  );
  assert.equal(
    oferta(
      account({ consultoria_origin: { status: "retroativa", non_simples_confirmed: false } }),
      "consultoria",
    ).status,
    "fora_regra",
  );
});
test("Disponibilidade: um card por empresa no Caixa; card aberto de Consultoria ocupa Finance e Cella (01/10)", () => {
  const c = card();
  assert.equal(disponibilidade(account(), "consultoria", [c], "2026-09").free, false);
  const f = disponibilidade(account(), "finance", [c], "2026-09");
  assert.equal(f.free, false);
  assert.match(f.reason, /um card por empresa/);
  assert.equal(disponibilidade(account(), "finance", [{ ...c, status: "lost" }], "2026-10").free, true);
  assert.equal(
    disponibilidade(account(), "consultoria", [{ ...c, status: "lost" }], "2026-09").free,
    false,
  );
  assert.equal(
    disponibilidade(account(), "consultoria", [{ ...c, status: "lost" }], "2026-10").free,
    true,
  );
});
test("Proposta direta valida uma vez; retorno à negociação não duplica", () => {
  const c = card(raw({ stage_id: 6 }), [
    change(1, 6, "2026-09-04 12:00:00"),
    change(6, 5, "2026-09-08 12:00:00"),
  ]);
  assert.equal(c.events.validated.length, 1);
  assert.equal(c.events.validated[0].date, "2026-09-04");
});
test("Reciclado não é oportunidade validada mesmo aparecendo depois de negociação", () => {
  const c = card(raw({ stage_id: 7 }), [change(1, 7, "2026-09-04 12:00:00")]);
  assert.equal(c.events.validated.length, 0);
});
test("Ator do movimento preservado quando dono atual muda", () => {
  const c = card(raw({ user_id: { id: 99, name: "Sistema" } }), [
    change(1, 5, "2026-09-04 12:00:00", 20),
    change(20, 99, "2026-09-05 12:00:00", 99, "user_id"),
  ]);
  assert.equal(operacao([c], filter).rows.validated.length, 1);
  assert.equal(operacao([c], { ...filter, owner: 99 }).rows.validated.length, 0);
  assert.equal(operacao([c], filter).current.length, 0);
});
test("Data local usa São Paulo, com mudança de dia em UTC", () => {
  const c = card(raw(), [change(1, 5, "2026-09-02 01:00:00")]);
  assert.equal(c.events.validated[0].date, "2026-09-01");
  assert.equal(operacao([c], { ...filter, from: "2026-09-02" }).rows.validated.length, 0);
});
test("Título não determina produto canônico", () => {
  const c = card(raw({ title: "Finance oportunidade Cella", [PRODUCT]: null }));
  assert.equal(c.route, "sem_produto");
});
test("Recon vai para o pipe 38, na etapa pedida, sem o campo Caixa · Produto", () => {
  const d = dealPayload({
    account: { name: "Empresa sintética" },
    product: "recon",
    org: 10,
    owner: 24813890,
    stage: 268,
    nonce: "n",
  });
  assert.equal(d.pipeline_id, 38);
  assert.equal(d.stage_id, 268);
  assert.equal(d.user_id, 24813890);
  assert.equal(d[PRODUCT], undefined);
  assert.match(d.title, /· Recon \[AQ:n\]$/);
  assert.equal(hasCanonicalProduct(d, "recon"), true);
  assert.equal(hasCanonicalProduct({ ...d, pipeline_id: 39 }, "recon"), false);
  // Duplicidade: Recon olha o pipe 38; o Caixa olha o pipe 39 com o mesmo Caixa · Produto.
  assert.equal(sameProductDeal({ pipeline_id: 38 }, "recon"), true);
  assert.equal(sameProductDeal({ pipeline_id: 39, [PRODUCT]: 1128 }, "recon"), false);
  assert.equal(sameProductDeal({ pipeline_id: 39, [PRODUCT]: 1128 }, "cella"), true);
  assert.equal(sameProductDeal({ pipeline_id: 38, [PRODUCT]: 1128 }, "cella"), false);
});
test("Forecast compara mês global até a carga, sem fabricar realizado futuro ou aplicar mix", () => {
  const source = {
    months: ["2026-09", "2026-10"],
    rows: [
      { row: 29, values: [120, 240] },
      { row: 41, values: [8, 16] },
      { row: 25, values: [9.2, 15.1] },
      { row: 26, values: [65.9, 151.4] },
      { row: 27, values: [44.9, 73.5] },
    ],
  };
  const rows = forecastComparison(
    source,
    [
      card(),
      card(raw({ id: 101, user_id: { id: 99, name: "Outro" } }), [
        change(1, 5, "2026-09-16 12:00:00", 99),
      ]),
    ],
    "2026-09-15",
  );
  assert.equal(rows[0].actual.rows.started.length, 1);
  assert.equal(rows[0].planned.signed, 8);
  assert.equal(rows[0].partial, true);
  assert.equal(rows[0].products.find((p) => p.product === "finance").actual.started, 0);
  assert.equal(rows[1].actual, null);
  assert.equal(rows[1].planned.signed, 16);
  assert.equal(forecastComparison(source, [], null)[0].actual, null);
});
test("Forecast abre o cenário padrão da versão mais recente e respeita o pedido na URL", () => {
  const fonte = (id, source_date, scenario, padrao) => ({
    id,
    source_date,
    scenario,
    default: padrao,
    version: id,
    months: [],
    rows: [],
  });
  const fontes = [
    fonte("v10-2026-09-09", "2026-09-09"),
    fonte("v12-2026-09-28-otimista", "2026-09-28", "Otimista"),
    fonte("v12-2026-09-28", "2026-09-28", "Estimado", true),
    fonte("v12-2026-09-28-conservador", "2026-09-28", "Conservador"),
  ];
  assert.equal(escolherForecast(fontes).id, "v12-2026-09-28");
  assert.equal(
    escolherForecast(fontes, "v12-2026-09-28-conservador").id,
    "v12-2026-09-28-conservador",
  );
  assert.equal(escolherForecast(fontes, "v10-2026-09-09").id, "v10-2026-09-09");
  // Id desconhecido (link velho) cai no padrão, não em tela vazia.
  assert.equal(escolherForecast(fontes, "v99-inexistente").id, "v12-2026-09-28");
  assert.deepEqual(
    opcoesDoForecast(fontes).map((f) => f.id),
    ["v12-2026-09-28-conservador", "v12-2026-09-28", "v12-2026-09-28-otimista", "v10-2026-09-09"],
  );
  // Só a v10 importada: ela é a fonte, sem cenário.
  assert.equal(escolherForecast([fonte("v10-2026-09-09", "2026-09-09")]).id, "v10-2026-09-09");
  assert.equal(escolherForecast([]), undefined);
});
test("Forecast v12 usa o contrato esperado, fracionário, como meta do mês", () => {
  const source = {
    months: ["2026-09"],
    rows: [
      { row: 29, values: [120] },
      { row: 41, values: [7.8] },
      { row: 38, values: [0.89] },
      { row: 39, values: [4.3] },
      { row: 40, values: [2.61] },
    ],
  };
  const [mes] = forecastComparison(source, [], "2026-09-15");
  assert.equal(mes.planned.signed, 7.8);
  assert.equal(mes.products.find((p) => p.product === "cella").plannedSigned, 0.89);
});
test("Histórico indisponível não vira validação inferida da etapa atual", () => {
  const c = summarize([raw()], stages, {}, "2026-09").cards[0];
  assert.equal(c.history_known, false);
  assert.equal(c.events.validated.length, 0);
});
test("Card distinto no período e por dia; contagem auditável", () => {
  const c = card(raw({ stage_id: 4 }), [
    change(1, 4, "2026-09-03 12:00:00"),
    change(4, 3, "2026-09-04 12:00:00"),
    change(3, 4, "2026-09-06 12:00:00"),
  ]);
  const v = operacao([c], filter);
  assert.equal(v.rows.meeting.length, 1);
  assert.equal(
    v.series.reduce((n, d) => n + d.meeting, 0),
    2,
  );
});
test("Receita nula não vira zero e parcelas divergentes não entram no total conciliado", () => {
  assert.equal(expectedRevenue({}).total.amount, null);
  const r = {};
  for (const [k, v] of [
    [REVENUE_FIELDS.total, 100],
    [REVENUE_FIELDS.partners, 60],
    [REVENUE_FIELDS.unit, 30],
  ]) {
    r[k] = v;
    r[k + "_currency"] = "BRL";
  }
  assert.equal(expectedRevenue(r).status, "mismatch");
  assert.equal(receitaSomada([card(raw(r))]).known, 0);
  r[REVENUE_FIELDS.unit] = 40;
  r[REVENUE_FIELDS.unit_name] = 694;
  const totals = receitaSomada([card(raw(r))]);
  assert.equal(totals.total, 100);
  assert.equal(totals.partners, 60);
  assert.equal(totals.unit, 40);
  r[REVENUE_FIELDS.total] = 0;
  r[REVENUE_FIELDS.partners] = 0;
  r[REVENUE_FIELDS.unit] = 0;
  assert.equal(receitaSomada([card(raw(r))]).known, 1);
});
test("Unidade do cadastro preenche só a opção que o mapa fixo não conhece", () => {
  const r = {};
  for (const [k, v] of [
    [REVENUE_FIELDS.total, 100],
    [REVENUE_FIELDS.partners, 60],
    [REVENUE_FIELDS.unit, 40],
  ]) {
    r[k] = v;
    r[k + "_currency"] = "BRL";
  }
  r[REVENUE_FIELDS.unit_name] = 99001;
  assert.equal(expectedRevenue(r).status, "unit_missing");
  registrarUnidades([
    { pipedrive_opcao_id: 99001, nome_da_praca: "Natal" },
    { pipedrive_opcao_id: 694, nome_da_praca: "Goiânia" },
  ]);
  assert.equal(expectedRevenue(r).status, "ok");
  assert.equal(expectedRevenue(r).unit_name, "Natal");
  r[REVENUE_FIELDS.unit_name] = 694;
  assert.equal(expectedRevenue(r).unit_name, "Matriz");
});
test("Período valida datas reais e limite; CSV neutraliza fórmulas", () => {
  assert.throws(() => dias("2026-02-30", "2026-03-01"));
  assert.throws(() => dias("2026-03-01", "2026-02-01"));
  assert.throws(() => dias("2020-01-01", "2026-01-01"));
  assert.ok(csv([['=IMPORTXML("x")']]).includes("'=IMPORTXML"));
});

test("Reserva compartilhada ocupa só a mesma oferta, inclusive enquanto o CRM ainda sincroniza", () => {
  const reserved = [
    { account_key: "a", product: "consultoria", status: "uncertain", deal_id: null },
  ];
  assert.equal(disponibilidade(account(), "consultoria", [], "2026-09", reserved).free, false);
  assert.equal(disponibilidade(account(), "finance", [], "2026-09", reserved).free, true);
  assert.equal(
    disponibilidade(account(), "consultoria", [], "2026-09", [
      { ...reserved[0], status: "released" },
    ]).free,
    true,
  );
});
test("Distribuição: abordagens por dia útil no mês, do dono atual, no fuso de São Paulo (09/10/2026)", () => {
  const n = (id, owner_id, started_at) => ({ id, owner_id, started_at });
  const cards = [
    n(1, 20, "2026-10-01 02:00:00"), // 30/09 23h em São Paulo: setembro, não conta
    n(2, 20, "2026-10-05 12:00:00"),
    n(3, 20, "2026-10-09T13:00:00Z"),
    n(4, 99, "2026-10-06 12:00:00"), // outro dono
    n(5, 20, null), // nunca abordado
    n(6, 20, "2026-09-15 12:00:00"),
  ];
  // 01 a 09/10/2026: 7 dias úteis (qui, sex, seg a sex). 2 ÷ 7 = 0,29 → 0,3.
  const r = abordagensPorDiaUtil(cards, 20, "2026-10-09");
  assert.deepEqual(
    r.abordados.map((c) => c.id),
    [2, 3],
  );
  assert.equal(r.uteis, 7);
  assert.equal(r.ritmo, 0.3);
  assert.equal(abordagensPorDiaUtil(cards, 99, "2026-10-09").ritmo, 0.1);
  // 01/11/2026 é domingo e 02/11 é feriado: nenhum dia útil decorrido, sem ritmo.
  assert.equal(abordagensPorDiaUtil(cards, 20, "2026-11-02").ritmo, null);
});

test("Ganho do CRM conta sem assinatura ou receita e usa data/ator do ganho", () => {
  const won = card(
    raw({
      status: "won",
      won_time: "2026-09-12 01:00:00",
      user_id: { id: 99, name: "Outro dono" },
    }),
    [change("open", "won", "2026-09-12 01:00:00", 20, "status")],
  );
  assert.equal(won.signed_on, null);
  assert.equal(won.won_on, "2026-09-11");
  assert.equal(operacao([won], filter).rows.signed.length, 1);
  assert.equal(operacao([won], { ...filter, owner: 99 }).rows.signed.length, 0);
  assert.equal(won.expected_revenue, null);
  assert.equal(operacao([won], { ...filter, from: "2026-09-12" }).rows.signed.length, 0);
});
test("Assinatura preenchida não fabrica ganho; reaberto/perdido sai do realizado", () => {
  for (const status of ["open", "lost"]) {
    const c = card(
      raw({
        status,
        won_time: "2026-09-10 12:00:00",
        ["97cd6f5f0f051d7dfd29e709bfde5c048a17cf3e"]: "2026-09-10",
      }),
    );
    assert.equal(c.signed_on, "2026-09-10");
    assert.equal(c.won_on, null);
    assert.equal(c.events.signed.length, 0);
  }
});

test("Carga v4 grava a entrada em cada etapa e a data da perda", () => {
  const c = card();
  assert.equal(c.metric_version, METRIC_VERSION);
  assert.deepEqual(
    c.moves.map((m) => [m.stage_id, m.date, m.actor_id]),
    [
      [1, "2026-09-01", 20],
      [2, "2026-09-02", 20],
      [4, "2026-09-03", 20],
      [5, "2026-09-04", 20],
    ],
  );
  assert.equal(c.lost_on, null);
  const lost = card(raw({ status: "lost", lost_time: "2026-09-10 15:00:00" }));
  assert.equal(lost.lost_on, "2026-09-10");
});

test("Stand by conta como reunião realizada, sem contar em dobro", () => {
  const st = [...stages.slice(0, 6), { id: 8, order_nr: 8, name: "Stand by" }];
  const sum = (flow, id) =>
    summarize([raw({ id, stage_id: 8 })], st, { [id]: flow }, "2026-09").cards[0];
  // agendada direto para Stand by: ganha a reunião no dia da entrada
  const direto = sum(
    [change(1, 3, "2026-09-02 12:00:00"), change(3, 8, "2026-09-05 12:00:00")],
    100,
  );
  assert.deepEqual(
    direto.events.meeting.map((e) => [e.date, e.source]),
    [["2026-09-05", "stand_by"]],
  );
  // já teve reunião: Stand by não cria outra
  const depois = sum(
    [change(3, 4, "2026-09-03 12:00:00"), change(4, 8, "2026-09-06 12:00:00")],
    101,
  );
  assert.deepEqual(
    depois.events.meeting.map((e) => e.date),
    ["2026-09-03"],
  );
});

test("Detalhe diz que o negócio perdido ou ganho está encerrado, e a etapa vira 'estava em'", () => {
  // Bigens · Consultoria (96074): perdido às 10:03 de 28/09 em Gatilho identificado. O detalhe
  // mostrava só a etapa, e o card parecia aberto.
  const lost = card(raw({ status: "lost", stage_id: 3, lost_time: "2026-09-28 13:03:59" }));
  assert.deepEqual(situacaoDoNegocio({ ...lost, stage: "3 · Gatilho identificado" }), {
    encerrado: "lost",
    rotulo: "Perdido em 28/09/2026",
    etapa: "estava em 3 · Gatilho identificado",
  });
  const won = card(raw({ status: "won", won_time: "2026-09-24 20:04:00" }), [
    change("open", "won", "2026-09-24 20:04:00", 20, "status"),
  ]);
  assert.equal(situacaoDoNegocio(won).rotulo, "Ganho em 24/09/2026");
  const aberto = card();
  assert.deepEqual(situacaoDoNegocio(aberto), {
    encerrado: null,
    rotulo: null,
    etapa: aberto.stage,
  });
});

test("Carga v6: nascer adiantado é trabalho de quem criou; a perda é de quem marcou", () => {
  // 95211 e 95196: criados pela API do Ops direto em Gatilho, com o Matheus de dono.
  const api = card(
    raw({ id: 120, stage_id: 3, creator_user_id: { id: 99 }, user_id: { id: 20, name: "Hunter" } }),
    [],
  );
  assert.equal(api.moves[0].actor_id, 99);
  assert.equal(api.events.started[0].actor_id, 99);
  const st = [
    { id: 1, name: "1 · Base elegível", order: 1 },
    { id: 3, name: "3 · Gatilho identificado", order: 3 },
  ];
  // funil (coorte) e trabalhados concordam: nenhum dos dois credita o dono
  assert.equal(funilCumulativo([api], st, filter).coorte.length, 0);
  assert.equal(operacao([api], filter).rows.started.length, 0);
  // nascer na Base continua sendo a fila do dono
  assert.equal(card().moves[0].actor_id, 20);

  // Supermercado JF (94554): dona Samira, perdido pelo Matheus
  const perdidoPeloHunter = card(
    raw({
      id: 121,
      status: "lost",
      lost_time: "2026-09-10 16:42:40",
      user_id: { id: 99, name: "Outra" },
    }),
    [change("open", "lost", "2026-09-10 16:42:40", 20, "status")],
  );
  // cards sem produto perdidos pela API, com o hunter de dono
  const perdidoPelaApi = card(raw({ id: 122, status: "lost", lost_time: "2026-09-10 12:00:00" }), [
    change("open", "lost", "2026-09-10 12:00:00", 99, "status"),
  ]);
  assert.equal(perdidoPeloHunter.lost_by, 20);
  assert.equal(perdidoPelaApi.lost_by, 99);
  assert.deepEqual(
    funilCumulativo([perdidoPeloHunter, perdidoPelaApi], st, filter).perdidos.map((c) => c.id),
    [121],
  );
  // snapshot anterior à v6 (sem lost_by) segue pelo dono atual
  const velho = { ...perdidoPelaApi, lost_by: undefined };
  assert.equal(funilCumulativo([velho], st, filter).perdidos.length, 1);
  assert.equal(card().lost_by, null);
});

test("Cadastro a corrigir: produto do título contra o campo, e a mesma oportunidade em dois cards", () => {
  assert.equal(produtoDoTitulo("Hospitel · CELLA"), "cella");
  assert.equal(produtoDoTitulo("Camianski· Cella"), "cella");
  assert.equal(produtoDoTitulo("NORTH Engenharia e Consultoria · Finance"), "finance");
  assert.equal(produtoDoTitulo("Baliza Construtora"), null);
  // o campo manda na contagem: Hospitel · CELLA com o campo em Consultoria conta em Consultoria
  const hospitel = card(raw({ id: 96070, title: "Hospitel · CELLA", [PRODUCT]: 1129 }));
  assert.equal(hospitel.route, "consultoria");
  const certo = card(raw({ id: 96073, title: "Nutrimilho · Consultoria", [PRODUCT]: 1129 }));
  const semCampo = card(raw({ id: 130, title: "X · Finance", [PRODUCT]: null }));
  const todos = cadastroACorrigir([hospitel, certo, semCampo]);
  assert.deepEqual(
    todos.produtoDivergente.map((c) => c.id),
    [96070, 130],
  );
  // com filtro, entram o que infla o produto e o que falta nele
  assert.deepEqual(
    cadastroACorrigir([hospitel, certo, semCampo], "cella").produtoDivergente.map((c) => c.id),
    [96070],
  );
  assert.deepEqual(
    cadastroACorrigir([hospitel, certo, semCampo], "finance").produtoDivergente.map((c) => c.id),
    [130],
  );

  // Relojoaria cassia: Finance criado em 11/09 e de novo em 15/09 na mesma organização
  const org = { value: 68299, name: "Relojoaria" };
  const a = card(
    raw({
      id: 95200,
      org_id: org,
      [PRODUCT]: 1130,
      status: "lost",
      add_time: "2026-09-11 14:00:00",
    }),
  );
  const b = card(
    raw({
      id: 96081,
      org_id: org,
      [PRODUCT]: 1130,
      status: "lost",
      add_time: "2026-09-15 14:00:00",
    }),
  );
  // outro produto na mesma organização não é duplicado
  const c = card(raw({ id: 96082, org_id: org, [PRODUCT]: 1129, add_time: "2026-09-15 14:00:00" }));
  // perdido em agosto e reofertado em setembro é oportunidade nova
  const velho = card(
    raw({
      id: 90000,
      org_id: org,
      [PRODUCT]: 1128,
      status: "lost",
      add_time: "2026-08-10 14:00:00",
    }),
  );
  const novo = card(
    raw({ id: 96083, org_id: org, [PRODUCT]: 1128, add_time: "2026-09-15 14:00:00" }),
  );
  const dup = cadastroACorrigir([a, b, c, velho, novo]);
  assert.deepEqual(dup.duplicados.map((x) => x.id).sort(), [95200, 96081]);
  assert.equal(dup.oportunidadesDuplicadas, 1);
  // mês da criação em São Paulo: 01/09 01:00 UTC ainda é agosto
  const virada = card(
    raw({
      id: 96084,
      org_id: org,
      [PRODUCT]: 1128,
      status: "lost",
      add_time: "2026-09-01 01:00:00",
    }),
  );
  assert.deepEqual(
    cadastroACorrigir([velho, virada])
      .duplicados.map((x) => x.id)
      .sort(),
    [90000, 96084],
  );
  assert.equal(cadastroACorrigir([a, b], "cella").duplicados.length, 0);

  // aberto sem produto pede ação; fechado sem produto (limpeza da API) não
  const aberto = card(raw({ id: 150, title: "Castropil", [PRODUCT]: null }));
  const fechado = card(raw({ id: 151, title: "Portum", [PRODUCT]: null, status: "lost" }));
  assert.deepEqual(
    cadastroACorrigir([aberto, fechado, semCampo]).semProduto.map((x) => x.id),
    [150],
  );
  assert.equal(cadastroACorrigir([aberto], "finance").semProduto.length, 0);
});

test("Carga parada é medição velha, com ou sem erro; falha isolada com dado fresco não é parada", () => {
  const agora = Date.parse("2026-09-28T15:25:00Z");
  // 28/09 12:20: "Signal timed out." com a carga das 12:15 ainda boa
  const isolada = cargaDoCrm("2026-09-28T15:15:10Z", "Signal timed out.", agora);
  assert.equal(isolada.parada, false);
  assert.equal(isolada.falhouAgora, true);
  assert.equal(
    motivoLegivel("Signal timed out."),
    "o Pipedrive ou o banco demorou demais para responder",
  );
  // cron parado sem erro: antes não avisava
  const semRodar = cargaDoCrm("2026-09-28T14:40:00Z", null, agora);
  assert.equal(semRodar.parada, true);
  assert.match(semRodar.porque, /não concluiu nenhuma carga/);
  // erro persistente e medição velha
  const persistente = cargaDoCrm(
    "2026-09-28T14:40:00Z",
    "canceling statement due to statement timeout",
    agora,
  );
  assert.equal(persistente.parada, true);
  assert.equal(
    persistente.porque,
    "A última tentativa falhou porque o passo passou do tempo limite no banco.",
  );
  assert.equal(persistente.falhouAgora, false);
  const nunca = cargaDoCrm(null, "x", agora);
  assert.equal(nunca.nuncaSincronizou, true);
  assert.equal(nunca.parada, false);
  assert.equal(cargaDoCrm("2026-09-28T15:20:00Z", null, agora).parada, false);
});

test("Clique no dia devolve os cards das barras daquele dia, com o mesmo filtro de ator", () => {
  const st = [...stages.slice(0, 6), { id: 8, order_nr: 8, name: "Stand by" }];
  // reunião no dia 3 por outro usuário e no dia 6 pelo farmer
  const c = summarize(
    [raw({ id: 140, stage_id: 4 })],
    st,
    {
      140: [
        change(1, 4, "2026-09-03 12:00:00", 99),
        change(4, 3, "2026-09-04 12:00:00", 20),
        change(3, 4, "2026-09-06 12:00:00", 20),
      ],
    },
    "2026-09",
  ).cards[0];
  const v = operacao([c], filter);
  const dia = (d) => v.series.find((s) => s.date === d);
  assert.equal(dia("2026-09-03").meeting, 0);
  assert.deepEqual(v.movimentosDoDia("2026-09-03"), []);
  assert.equal(dia("2026-09-06").meeting, 1);
  assert.deepEqual(
    v.movimentosDoDia("2026-09-06").map((x) => x.id),
    [140],
  );
});

// Pipe 39 de 01/10/2026: Reunião de proposta (com o especialista) antes de Em negociação; Stand by não valida.
const stagesOut = [
  { id: 274, order_nr: 1, name: "1 · Base elegível" },
  { id: 276, order_nr: 2, name: "2 · Abordagem iniciada" },
  { id: 290, order_nr: 3, name: "3 · Conexão" },
  { id: 275, order_nr: 4, name: "Gatilho (encerrada em 01/10 · não usar)" },
  { id: 277, order_nr: 5, name: "4 · Reunião de levantamento agendada" },
  { id: 287, order_nr: 6, name: "5 · Reunião de levantamento realizada" },
  { id: 291, order_nr: 7, name: "6 · Reunião de proposta" },
  { id: 279, order_nr: 8, name: "7 · Em negociação" },
  { id: 278, order_nr: 9, name: "8 · Proposta enviada" },
  { id: 288, order_nr: 10, name: "9 · Stand by" },
];
const out = (flow, over = {}) => {
  const r = raw({ id: 900, stage_id: 279, add_time: "2026-10-01 12:00:00", ...over });
  return summarize([r], stagesOut, { 900: flow }, "2026-10").cards[0];
};
test("Reunião de proposta não valida; Em negociação depois dela valida", () => {
  const ate = out([
    change(274, 276, "2026-10-05 12:00:00"),
    change(276, 287, "2026-10-06 12:00:00"),
    change(287, 291, "2026-10-07 12:00:00"),
  ]);
  assert.equal(ate.events.validated.length, 0);
  assert.equal(ate.events.meeting.length, 1);
  const depois = out([
    change(274, 276, "2026-10-05 12:00:00"),
    change(276, 287, "2026-10-06 12:00:00"),
    change(287, 291, "2026-10-07 12:00:00"),
    change(291, 279, "2026-10-09 12:00:00"),
  ]);
  assert.deepEqual(depois.events.validated.map((e) => e.date), ["2026-10-09"]);
});
test("Reunião de proposta não valida nem na ordem antiga (depois de Em negociação)", () => {
  const antiga = stagesOut.map((s) =>
    s.id === 291 ? { ...s, order_nr: 8 } : s.id === 279 ? { ...s, order_nr: 7 } : s,
  );
  const r = raw({ id: 901, stage_id: 291, add_time: "2026-10-01 12:00:00" });
  const c = summarize(
    [r],
    antiga,
    { 901: [change(274, 287, "2026-10-05 12:00:00"), change(287, 291, "2026-10-06 12:00:00")] },
    "2026-10",
  ).cards[0];
  assert.equal(c.events.validated.length, 0);
});
test("Stand by conta reunião, mas não valida a oportunidade (01/10)", () => {
  const c = out([change(277, 288, "2026-10-05 12:00:00")], { stage_id: 288 });
  assert.equal(c.events.meeting.length, 1);
  assert.equal(c.events.validated.length, 0);
});
test("Validação da ordem antiga desfeita na troca de 01–02/10 não conta; fora da janela conta", () => {
  const tag = out([
    change(287, 291, "2026-10-01 17:38:39"),
    change(291, 279, "2026-10-01 17:38:42"),
    change(279, 291, "2026-10-02 00:30:00"),
  ]);
  assert.equal(tag.events.validated.length, 0);
  const setembro = out(
    [change(287, 279, "2026-09-25 12:00:00"), change(279, 291, "2026-10-02 00:30:00")],
    { add_time: "2026-09-01 12:00:00" },
  );
  assert.deepEqual(setembro.events.validated.map((e) => e.date), ["2026-09-25"]);
});
test("Produtos ofertados: campo de várias opções vira lista de rotas", () => {
  assert.deepEqual(out([], { [OFFERED]: "1150,1152" }).offered, ["cella", "finance"]);
  assert.deepEqual(out([]).offered, []);
});
test("Envio: um card por empresa no Caixa; Recon segue no próprio pipe", () => {
  const cella = { id: 1, pipeline_id: 39, status: "open", [PRODUCT]: 1128, add_time: "2026-09-02 12:00:00" };
  const fin = { id: 2, pipeline_id: 39, status: "lost", [PRODUCT]: 1130, add_time: "2026-10-01 12:00:00" };
  assert.equal(cardDaEmpresa([fin, cella], "finance", "2026-10").deal.id, 2);
  assert.equal(cardDaEmpresa([fin, cella], "finance", "2026-10").sameProduct, true);
  const v = cardDaEmpresa([cella], "consultoria", "2026-10");
  assert.equal(v.deal.id, 1);
  assert.equal(v.sameProduct, false);
  assert.equal(cardDaEmpresa([{ ...cella, status: "lost" }], "consultoria", "2026-10"), null);
  assert.equal(cardDaEmpresa([cella], "recon", "2026-10"), null);
});

test("Organização homônima no CRM: fica a de mais negócios, e no empate a mais antiga", () => {
  const deals = new Map([
    [48781, []],
    [2721, []],
  ]);
  assert.equal(orgDaHomonima([48781, 2721], deals), 2721);
  deals.set(48781, [{ id: 1 }]);
  assert.equal(orgDaHomonima([2721, 48781], deals), 48781);
  assert.equal(orgDaHomonima([1757], new Map()), 1757);
  assert.equal(orgDaHomonima([], new Map()), null);
});
