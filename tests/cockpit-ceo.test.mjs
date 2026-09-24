import test from "node:test";
import assert from "node:assert/strict";
import {
  resolverPeriodo,
  periodoAnterior,
  mesDoPeriodo,
  validarBusca,
} from "../src/lib/cockpit-ceo/periodo.ts";
import { formatarValor, somaDaComposicao, ESTADOS } from "../src/lib/cockpit-ceo/contrato.ts";

const HOJE = "2026-09-22";

test("Presets de período partem do dia de hoje e nunca fixam um mês", () => {
  assert.deepEqual(pick(resolverPeriodo({ periodo: "mes" }, HOJE)), {
    preset: "mes",
    de: "2026-09-01",
    ate: "2026-09-22",
  });
  assert.deepEqual(pick(resolverPeriodo({ periodo: "mes_anterior" }, HOJE)), {
    preset: "mes_anterior",
    de: "2026-08-01",
    ate: "2026-08-31",
  });
  assert.deepEqual(pick(resolverPeriodo({ periodo: "trimestre" }, HOJE)), {
    preset: "trimestre",
    de: "2026-07-01",
    ate: "2026-09-22",
  });
  assert.deepEqual(pick(resolverPeriodo({ periodo: "ano" }, HOJE)), {
    preset: "ano",
    de: "2026-01-01",
    ate: "2026-09-22",
  });
  assert.deepEqual(pick(resolverPeriodo({}, "2027-03-05")), {
    preset: "mes",
    de: "2027-03-01",
    ate: "2027-03-05",
  });
  assert.deepEqual(pick(resolverPeriodo({ periodo: "mes_anterior" }, "2027-01-10")), {
    preset: "mes_anterior",
    de: "2026-12-01",
    ate: "2026-12-31",
  });
});

test("Período personalizado inválido volta ao mês corrente com aviso", () => {
  const ok = resolverPeriodo(
    { periodo: "personalizado", de: "2026-06-10", ate: "2026-07-20" },
    HOJE,
  );
  assert.equal(ok.de, "2026-06-10");
  assert.equal(ok.ate, "2026-07-20");
  assert.equal(ok.aviso, null);
  for (const [de, ate] of [
    ["2026-02-30", "2026-03-10"],
    ["2026-08-10", "2026-08-01"],
    ["2020-01-01", "2026-09-01"],
    ["", ""],
  ]) {
    const r = resolverPeriodo({ periodo: "personalizado", de, ate }, HOJE);
    assert.equal(r.preset, "mes", `${de}..${ate}`);
    assert.equal(r.de, "2026-09-01");
    assert.ok(r.aviso && r.aviso.length > 10);
  }
  const futuro = resolverPeriodo(
    { periodo: "personalizado", de: "2026-09-01", ate: "2026-12-31" },
    HOJE,
  );
  assert.equal(futuro.ate, "2026-09-22", "período não avança além de hoje");
  assert.ok(futuro.aviso);
});

test("Período anterior tem a mesma duração e termina na véspera", () => {
  const p = resolverPeriodo({ periodo: "mes" }, HOJE);
  assert.deepEqual(periodoAnterior(p), { de: "2026-08-10", ate: "2026-08-31" });
  const m = resolverPeriodo({ periodo: "mes_anterior" }, HOJE);
  assert.deepEqual(periodoAnterior(m), { de: "2026-07-01", ate: "2026-07-31" });
});

test("Plano mensal só se compara a período dentro de um mês", () => {
  assert.deepEqual(mesDoPeriodo(resolverPeriodo({ periodo: "mes" }, HOJE)), {
    mes: "2026-09",
    completo: false,
  });
  assert.deepEqual(mesDoPeriodo(resolverPeriodo({ periodo: "mes_anterior" }, HOJE)), {
    mes: "2026-08",
    completo: true,
  });
  assert.equal(mesDoPeriodo(resolverPeriodo({ periodo: "trimestre" }, HOJE)), null);
  assert.equal(
    mesDoPeriodo(
      resolverPeriodo({ periodo: "personalizado", de: "2026-08-05", ate: "2026-08-20" }, HOJE),
    ),
    null,
  );
});

test("Busca da URL aceita só strings e descarta o resto", () => {
  assert.deepEqual(
    validarBusca({ periodo: "ano", de: 3, perimetro: "ex-norte", frente: "comercial", lixo: "x" }),
    { periodo: "ano", de: "", ate: "", perimetro: "ex-norte", frente: "comercial", indicador: "" },
  );
  assert.equal(validarBusca({ perimetro: "rede" }).perimetro, "");
  assert.equal(validarBusca({ perimetro: "unidade-exemplo" }).perimetro, "unidade-exemplo");
  assert.equal(validarBusca({ frente: "inexistente" }).frente, "");
});

test("Ausência não vira zero na formatação e na soma da composição", () => {
  const base = { valor: null, estado: "nao_apurado", unidade: "contas", composicao: [] };
  assert.equal(formatarValor(base), "—");
  assert.equal(formatarValor({ ...base, valor: 0, estado: "disponivel" }), "0");
  assert.equal(formatarValor({ ...base, valor: 1234, estado: "disponivel" }), "1.234");
  assert.equal(
    formatarValor({ ...base, valor: 1234.5, estado: "disponivel", unidade: "reais" }),
    "R$ 1.234,50",
  );
  assert.equal(
    somaDaComposicao({
      composicao: [{ valor: 2, soma: true }, { valor: 3, soma: true }, { valor: 9 }],
    }),
    5,
  );
  assert.equal(
    somaDaComposicao({
      composicao: [
        { valor: 2, soma: true },
        { valor: null, soma: true },
      ],
    }),
    null,
  );
  assert.equal(Object.keys(ESTADOS).length, 5);
});

function pick(p) {
  return { preset: p.preset, de: p.de, ate: p.ate };
}

// ── Task 3: catálogo de perguntas ────────────────────────────────────────────
import { PERGUNTAS, EXIGENCIAS_INVESTIDOR, COBERTURAS } from "../src/lib/cockpit-ceo/perguntas.ts";
import { IDS_INDICADORES, ORDEM_FRENTES } from "../src/lib/cockpit-ceo/contrato.ts";

test("Catálogo cobre as 11 exigências do mapa e a trajetória para R$ 1 bi", () => {
  assert.equal(EXIGENCIAS_INVESTIDOR.length, 11);
  for (const e of EXIGENCIAS_INVESTIDOR)
    assert.ok(
      PERGUNTAS.some((p) => p.exigencia === e.id),
      `exigência sem pergunta: ${e.titulo}`,
    );
  const bilhao = PERGUNTAS.find((p) => /R\$ 1 bi/.test(p.texto));
  assert.ok(bilhao, "falta a pergunta da trajetória");
  assert.equal(bilhao.cobertura, "depende_decisao");
  for (const f of ORDEM_FRENTES)
    assert.ok(
      PERGUNTAS.some((p) => p.frente === f),
      `frente vazia: ${f}`,
    );
});

test("Nenhuma pergunta se declara verificada no piloto e toda referência de indicador existe", () => {
  assert.ok(Object.keys(COBERTURAS).includes("verificada"));
  assert.equal(PERGUNTAS.filter((p) => p.cobertura === "verificada").length, 0);
  const ids = new Set(PERGUNTAS.map((p) => p.id));
  assert.equal(ids.size, PERGUNTAS.length, "ids repetidos");
  for (const p of PERGUNTAS) {
    for (const i of p.indicadores) assert.ok(IDS_INDICADORES.includes(i), `${p.id} → ${i}`);
    assert.ok(p.responsavel && p.aceite && p.fonte, `${p.id} incompleta`);
    // Implementada = respondida por um número ou por um painel de frente (a cadeia, O2, é painel).
    if (p.cobertura === "implementada_nao_homologada")
      assert.ok(
        p.indicadores.length + p.paineis.length > 0,
        `${p.id} implementada sem indicador nem painel`,
      );
  }
});

test("Catálogo não usa o vocabulário de franquia abolido em 09/09", () => {
  const texto = JSON.stringify([PERGUNTAS, EXIGENCIAS_INVESTIDOR]);
  assert.doesNotMatch(texto, /franqu/i);
});

// ── Task 4: indicadores de Base e Monetização ────────────────────────────────
import { montarCockpit } from "../src/lib/cockpit-ceo/indicadores.ts";

// Os números que dependem da carga de Base e Monetização. Os da empresa inteira (Financeiro, Growth,
// Ops) têm carga própria e são testados em cockpit-ceo-empresa.test.mjs.
const DA_MONETIZACAO = [
  "contratos-ganhos",
  "oportunidades-validadas",
  "leads-trabalhados",
  "receita-prevista-aberta",
  "contas-prontas",
];

const ev = (date, actor = 1) => ({
  at: date + "T12:00:00Z",
  date,
  actor_id: actor,
  source: "teste",
});
const receita = (total, partners = null, unit = null) =>
  total === null
    ? {
        total: v(null),
        partners: v(null),
        unit: v(null),
        sum: null,
        difference: null,
        status: "missing",
        basis: "",
        unit_name: null,
      }
    : {
        total: v(total),
        partners: v(partners),
        unit: v(unit),
        sum: total,
        difference: 0,
        status: "ok",
        basis: "",
        unit_name: null,
      };
function v(amount) {
  return { amount, currency: amount === null ? null : "BRL", invalid: false };
}
const negocio = (id, route, events = {}, extra = {}) => ({
  id,
  title: "Negócio sintético " + id,
  org: null,
  org_id: 100 + id,
  owner: "Pessoa",
  owner_id: 1,
  route,
  status: "open",
  stage_id: 1,
  stage: "Etapa",
  order: 1,
  events: {
    loaded: [],
    started: [],
    scheduled: [],
    meeting: [],
    validated: [],
    signed: [],
    ...events,
  },
  created_at: "2026-08-01",
  started_at: null,
  validated_at: null,
  signed_on: null,
  won_on: null,
  expected_close: null,
  revenue: receita(null),
  next_activity: null,
  history_known: true,
  url: "#",
  ...extra,
});
const conta = (key, changes = {}) => ({
  key,
  name: "Empresa Sintética " + key,
  units: [],
  unit_label: null,
  orgs: [],
  contact: true,
  band: "R$ 10 milhões até R$ 25 milhões",
  regime: "Lucro Presumido",
  segment: "Indústria",
  old_base: false,
  matrix: false,
  new_commercial: false,
  pipedrive_contract: false,
  consultoria_priority: false,
  finance_candidate: false,
  finance: { status: "revisar", reason: "" },
  ecd: false,
  base_origin: { status: "nova", reason: "", source: "", commercial: false },
  ...changes,
});
// A: apta e livre em Consultoria E Finance (sobreposição). B: apta e livre só em Finance.
// C: apta em Cella, mas só no cadastro do Omie. D: fora de todos (Simples).
const contaA = conta("A", {
  old_base: true,
  pipedrive_contract: true,
  orgs: [101],
  base_origin: { status: "antiga", reason: "", source: "", commercial: false },
  consultoria_origin: {
    status: "retroativa",
    reason: "",
    checked_at: "",
    ops_ids: [],
    pipefy_ids: [],
    commercial_deal_ids: [],
    non_simples_confirmed: true,
    regime_source: null,
  },
});
const contaB = conta("B", { pipedrive_contract: true, orgs: [102] });
const contaC = conta("C", { band: "R$ 50 milhões até R$ 78 milhões" });
const contaD = conta("D", { regime: "Simples Nacional" });
function dados(changes = {}) {
  return {
    forecasts: [],
    reservations: [],
    lists: [],
    records: [],
    stages: [],
    base_count: 4,
    accounts: [contaA, contaB, contaC, contaD],
    units: [
      {
        id: 1,
        key: "u1",
        name: "Unidade Exemplo Um",
        classification: "unidade",
        account_keys: ["A", "C"],
      },
      {
        id: 2,
        key: "u2",
        name: "Unidade Exemplo Dois",
        classification: "unidade",
        account_keys: ["B", "D"],
      },
    ],
    cards: [
      // Ganho dentro do período, na org da conta A (unidade 1), produto Consultoria.
      negocio(
        1,
        "consultoria",
        { started: [ev("2026-09-02")], validated: [ev("2026-09-05")], signed: [ev("2026-09-10")] },
        { status: "won", won_on: "2026-09-10", org_id: 101 },
      ),
      // Ganho fora do período (agosto), Finance, org da conta B.
      negocio(
        2,
        "finance",
        { signed: [ev("2026-08-20")] },
        { status: "won", won_on: "2026-08-20", org_id: 102 },
      ),
      // Aberto, validado no período, sem conta vinculada, com receita prevista.
      negocio(
        3,
        "cella",
        { started: [ev("2026-09-03")], validated: [ev("2026-09-12")] },
        { validated_at: "2026-09-12", revenue: receita(1000, 300, 700), org_id: 999 },
      ),
      // Aberto, validado antes do período, sem receita declarada, sem conta vinculada.
      negocio(
        4,
        "finance",
        { validated: [ev("2026-08-25")] },
        { validated_at: "2026-08-25", org_id: 998 },
      ),
    ],
    plans: [],
    measured_at: "2026-09-22T14:50:00Z",
    catalog_at: "2026-09-22T14:49:00Z",
    sync_status: "ok",
    sync_error: null,
    permissions: { view: true, manage: false, send: false, all_units: true },
    ...changes,
  };
}
const fonteOk = (d = dados(), extra = {}) => ({
  sintetico: false,
  hoje: "2026-09-22",
  agora: "2026-09-22T15:00:00Z",
  acessoBase: true,
  acessoNegocios: true,
  monetizacao: { estado: "ok", erro: null, dados: d },
  ...extra,
});
const recorte = (busca = {}, perimetro = "") => ({
  periodo: resolverPeriodo(busca, "2026-09-22"),
  perimetro,
});
const ind = (c, id) => c.indicadores.find((i) => i.id === id);

test("Cockpit produz exatamente os indicadores declarados, e seis na primeira dobra (N12)", () => {
  const c = montarCockpit(fonteOk(), recorte());
  assert.deepEqual(c.indicadores.map((i) => i.id).sort(), [...IDS_INDICADORES].sort());
  assert.equal(c.primeiraDobra.length, 6);
  for (const id of c.primeiraDobra) assert.ok(c.indicadores.some((i) => i.id === id), id);
  for (const i of c.indicadores) {
    assert.ok(i.definicao && i.fonte && i.versaoRegra && i.pergunta, i.id);
    assert.equal(i.dataApuracao, "2026-09-22T15:00:00Z");
  }
});

test("Duas ofertas da mesma conta não duplicam contas únicas", () => {
  const i = ind(montarCockpit(fonteOk(), recorte()), "contas-prontas");
  assert.equal(i.estado, "disponivel");
  assert.equal(i.unidade, "contas");
  assert.equal(i.valor, 2, "A (2 produtos) + B (1 produto)");
  const porProduto = Object.fromEntries(i.composicao.map((l) => [l.chave, l.valor]));
  assert.equal(porProduto["produto:consultoria"], 1);
  assert.equal(porProduto["produto:finance"], 2);
  assert.equal(porProduto["produto:cella"], 0);
  assert.equal(porProduto["sobreposicao"], 1);
  assert.equal(porProduto["so_omie"], 1, "C aprovada pela régua, mas só no Omie, fica fora");
  assert.equal(somaDaComposicao(i), i.valor);
  assert.equal(i.periodo, null, "fotografia: o período não se aplica");
  assert.match(i.notaComposicao, /mais de um produto/);
});

test("Contratos ganhos contam só o evento dentro do período e a composição reconstrói o total", () => {
  const i = ind(montarCockpit(fonteOk(), recorte()), "contratos-ganhos");
  assert.equal(i.unidade, "negócios");
  assert.equal(i.valor, 1);
  assert.equal(somaDaComposicao(i), 1);
  assert.deepEqual(i.periodo, { de: "2026-09-01", ate: "2026-09-22" });
  const anterior = i.comparacoes.find((c) => c.rotulo.startsWith("Período anterior"));
  assert.equal(anterior.referencia, 1, "o ganho de 20/08 cai no período anterior (10/08 a 31/08)");
  assert.equal(i.destino.rota, "/monetizacao");
  assert.equal(i.destino.search.aba, "operacao");
  assert.equal(i.destino.mesmoRecorte, false);
  assert.ok(i.destino.observacao.length > 20);
  const ago = ind(
    montarCockpit(fonteOk(), recorte({ periodo: "mes_anterior" })),
    "contratos-ganhos",
  );
  assert.equal(ago.valor, 1);
});

test("Sem permissão de Monetização os comerciais dizem acesso insuficiente, e a Base continua", () => {
  const c = montarCockpit(
    fonteOk(dados({ permissions: { view: false, manage: false, send: false, all_units: true } })),
    recorte(),
  );
  for (const id of [
    "contratos-ganhos",
    "oportunidades-validadas",
    "leads-trabalhados",
    "receita-prevista-aberta",
  ]) {
    assert.equal(ind(c, id).estado, "acesso_insuficiente", id);
    assert.equal(ind(c, id).valor, null, id);
    assert.equal(ind(c, id).composicao.length, 0, id);
  }
  assert.equal(ind(c, "contas-prontas").estado, "disponivel");
  assert.equal(c.serieDiaria, null);
  const semBase = montarCockpit(fonteOk(dados(), { acessoBase: false }), recorte());
  assert.equal(ind(semBase, "contas-prontas").estado, "acesso_insuficiente");
  assert.equal(ind(semBase, "contas-prontas").valor, null);
});

test("Fonte com erro não vira zero e não mostra cache", () => {
  const c = montarCockpit(
    {
      ...fonteOk(),
      monetizacao: { estado: "erro", erro: "A base mudou durante a consulta.", dados: null },
    },
    recorte(),
  );
  for (const i of c.indicadores.filter((x) => DA_MONETIZACAO.includes(x.id))) {
    assert.equal(i.estado, "fonte_indisponivel", i.id);
    assert.equal(i.valor, null, i.id);
  }
  assert.ok(c.avisos.some((a) => /mudou durante a consulta/.test(a)));
});

test("Carga comercial com falha vira dado parcial com a data do dado", () => {
  const c = montarCockpit(
    fonteOk(dados({ sync_error: "statement timeout", measured_at: "2026-09-21T18:35:00Z" })),
    recorte(),
  );
  const i = ind(c, "contratos-ganhos");
  assert.equal(i.estado, "parcial");
  assert.equal(i.dataDado, "2026-09-21T18:35:00Z");
  assert.equal(i.valor, 1, "o número existe, mas marcado como parcial");
  assert.ok(c.ameacas.some((a) => a.id === "crm-parado"));
  const nunca = montarCockpit(fonteOk(dados({ measured_at: null })), recorte());
  assert.equal(ind(nunca, "contratos-ganhos").estado, "fonte_indisponivel");
});

test("Perímetro de unidade exclui negócio sem conta vinculada e diz quantos ficaram fora", () => {
  const c = montarCockpit(fonteOk(), recorte({}, "u1"));
  assert.match(c.universo, /Unidade Exemplo Um/);
  assert.equal(ind(c, "contratos-ganhos").valor, 1);
  const val = ind(c, "oportunidades-validadas");
  assert.equal(val.valor, 1, "negócio 1 (conta A); o negócio 3 não tem conta vinculada");
  assert.match(val.notaComposicao, /1 negócio sem conta vinculada/);
  assert.equal(
    ind(montarCockpit(fonteOk(), recorte()), "oportunidades-validadas").valor,
    2,
    "na rede entram os dois",
  );
  assert.equal(ind(c, "contas-prontas").valor, 1, "só A está na unidade 1 entre as prontas");
  const u2 = montarCockpit(fonteOk(), recorte({}, "u2"));
  assert.equal(ind(u2, "contratos-ganhos").valor, 0);
  const desconhecida = montarCockpit(fonteOk(), recorte({}, "u9"));
  assert.ok(desconhecida.avisos.some((a) => /Unidade não encontrada/.test(a)));
  assert.equal(ind(desconhecida, "contratos-ganhos").valor, 1, "cai na rede");
});

test("Meta mensal só compara com período dentro de um mês", () => {
  const plano = {
    month: "2026-08",
    owner_id: 1,
    owner_name: "Pessoa",
    capacity: 90,
    meetings_capacity: 40,
    target_contracts: 6,
    daily_target: 4,
    allocation: { cella: 0, consultoria: 0, finance: 0 },
    rates: { cella: null, consultoria: null, finance: null },
  };
  const ago = ind(
    montarCockpit(fonteOk(dados({ plans: [plano] })), recorte({ periodo: "mes_anterior" })),
    "contratos-ganhos",
  );
  const meta = ago.comparacoes.find((c) => c.rotulo.startsWith("Meta do mês"));
  assert.equal(meta.referencia, 6);
  assert.equal(meta.estado, "disponivel");
  const tri = ind(
    montarCockpit(fonteOk(dados({ plans: [plano] })), recorte({ periodo: "trimestre" })),
    "contratos-ganhos",
  );
  const metaTri = tri.comparacoes.find((c) => c.rotulo.startsWith("Meta do mês"));
  assert.equal(metaTri.estado, "nao_apurado");
  assert.equal(metaTri.referencia, null);
  assert.match(metaTri.nota, /mensal/);
});

test("Ritmo abaixo da meta e plano sem alocação viram ameaça e decisão", () => {
  const plano = {
    month: "2026-09",
    owner_id: 1,
    owner_name: "Pessoa",
    capacity: 90,
    meetings_capacity: 40,
    target_contracts: 6,
    daily_target: 4,
    allocation: { cella: 0, consultoria: 0, finance: 0 },
    rates: { cella: null, consultoria: null, finance: null },
  };
  const c = montarCockpit(fonteOk(dados({ plans: [plano] })), recorte());
  assert.ok(
    c.ameacas.some((a) => a.id === "ritmo-contratos"),
    "1 ganho contra ~remaining ritmo de 6",
  );
  assert.ok(c.decisoes.some((d) => d.id === "alocar-plano"));
  assert.ok(c.decisoes.length <= 3);
  assert.equal(c.decisoes[0].id, "perimetro-meta");
});

test("Meta de R$ 1 bi fica não apurada, com lacuna e responsável", () => {
  const i = ind(montarCockpit(fonteOk(), recorte()), "meta-bilhao");
  assert.equal(i.estado, "nao_apurado");
  assert.equal(i.valor, null);
  assert.equal(i.unidade, "reais");
  assert.equal(i.lacuna.responsavel, "CEO + CFO");
  assert.match(i.definicao, /faturamento anual/i);
  assert.match(i.definicao, /não é valuation/i);
});

test("Receita prevista soma o declarado, separa o faltante e não chama de faturamento", () => {
  const i = ind(montarCockpit(fonteOk(), recorte()), "receita-prevista-aberta");
  assert.equal(i.valor, 1000);
  assert.equal(i.estado, "parcial", "um negócio validado aberto sem valor");
  const faltante = i.composicao.find((l) => l.chave === "faltante");
  assert.equal(faltante.valor, 1);
  assert.equal(somaDaComposicao(i), 1000);
  assert.match(i.definicao, /não é faturamento/);
  assert.equal(i.periodo, null);
});

// ── Task 5: fonte sintética e adaptador do Brain ─────────────────────────────
import { baseSintetica, fonteSintetica } from "../src/lib/cockpit-ceo/fixture-sintetica.ts";
import { fonteDoBrain } from "../src/lib/cockpit-ceo/adaptador-brain.ts";

test("Fonte sintética é determinística e se identifica em cada nome", () => {
  const a = baseSintetica("2026-09-22");
  assert.deepEqual(a, baseSintetica("2026-09-22"));
  assert.ok(a.accounts.length >= 40);
  for (const c of a.accounts) assert.match(c.name, /^Empresa Sintética \d{3}$/);
  for (const u of a.units) assert.match(u.name, /^Unidade Exemplo /);
  for (const n of a.cards) assert.match(n.title, /^Negócio sintético /);
  assert.ok(
    a.cards.every((n) => n.url === "#sintetico"),
    "nenhum link para o CRM real",
  );
});

test("Cockpit sobre a fonte sintética marca tudo como sintético e exercita as regras", () => {
  const c = montarCockpit(fonteSintetica("2026-09-22", "2026-09-22T15:00:00Z"), recorte());
  assert.equal(c.sintetico, true);
  assert.ok(c.avisos.some((a) => /sintéticos/.test(a)));
  for (const i of c.indicadores) assert.equal(i.sintetico, true, i.id);
  const prontas = ind(c, "contas-prontas");
  assert.ok(
    prontas.composicao.find((l) => l.chave === "sobreposicao").valor > 0,
    "há sobreposição",
  );
  assert.ok(
    prontas.composicao.find((l) => l.chave === "so_omie").valor > 0,
    "há contas só no Omie",
  );
  assert.ok(ind(c, "contratos-ganhos").valor > 0);
  assert.equal(ind(c, "receita-prevista-aberta").estado, "parcial");
  assert.ok(c.decisoes.some((d) => d.id === "alocar-plano"));
  assert.ok(c.serieDiaria.length === 22);
  assert.ok(c.perimetros.length >= 3);
  // Outro dia gera outro calendário, sem mês fixo.
  const marco = montarCockpit(fonteSintetica("2027-03-05", "2027-03-05T15:00:00Z"), {
    periodo: resolverPeriodo({}, "2027-03-05"),
    perimetro: "",
  });
  assert.ok(ind(marco, "leads-trabalhados").valor > 0);
});

test("Adaptador do Brain separa carregando, erro e carga concluída", () => {
  const d = baseSintetica("2026-09-22");
  const ok = fonteDoBrain(
    { data: d, error: null, isLoading: false },
    { acessoBase: true, acessoNegocios: true },
    "2026-09-22",
    "2026-09-22T15:00:00Z",
  );
  assert.equal(ok.monetizacao.estado, "ok");
  assert.equal(ok.sintetico, false);
  const carregando = fonteDoBrain(
    { data: undefined, error: null, isLoading: true },
    { acessoBase: true, acessoNegocios: true },
    "2026-09-22",
    "x",
  );
  assert.equal(carregando.monetizacao.estado, "carregando");
  const erro = fonteDoBrain(
    { data: d, error: new Error("A base mudou durante a consulta."), isLoading: false },
    { acessoBase: true, acessoNegocios: true },
    "2026-09-22",
    "x",
  );
  assert.equal(erro.monetizacao.estado, "erro", "erro não se esconde atrás da carga anterior");
  assert.equal(erro.monetizacao.dados, null);
  assert.match(erro.monetizacao.erro, /mudou durante a consulta/);
  const sessao = fonteDoBrain(
    { data: undefined, error: new Error("Unauthorized: Invalid token"), isLoading: false },
    { acessoBase: true, acessoNegocios: true },
    "2026-09-22",
    "x",
  );
  assert.match(sessao.monetizacao.erro, /sessão/i);
});

// ── Task 6: URL enxuta ───────────────────────────────────────────────────────
import { buscaDaUrl } from "../src/lib/cockpit-ceo/periodo.ts";

test("URL do cockpit omite campos vazios e a normalização é idempotente", () => {
  assert.deepEqual(buscaDaUrl({}), {});
  assert.deepEqual(buscaDaUrl({ periodo: "ano", perimetro: "", frente: "capital", x: 1 }), {
    periodo: "ano",
    frente: "capital",
  });
  const u = buscaDaUrl({ periodo: "personalizado", de: "2026-06-01", ate: "2026-06-30" });
  assert.deepEqual(buscaDaUrl(u), u);
  assert.equal(validarBusca(u).perimetro, "");
});

test("Ritmo esperado diz se é da meta de contratos ou da capacidade de leads", () => {
  const plano = {
    month: "2026-09",
    owner_id: 1,
    owner_name: "Pessoa",
    capacity: 90,
    meetings_capacity: 40,
    target_contracts: 6,
    daily_target: 4,
    allocation: { cella: 0, consultoria: 0, finance: 0 },
    rates: { cella: null, consultoria: null, finance: null },
  };
  const c = montarCockpit(fonteOk(dados({ plans: [plano] })), recorte());
  const rotulos = (id) => ind(c, id).comparacoes.map((x) => x.rotulo);
  assert.ok(rotulos("contratos-ganhos").includes("Ritmo esperado da meta"));
  assert.ok(rotulos("leads-trabalhados").includes("Ritmo esperado da capacidade"));
  assert.ok(!rotulos("leads-trabalhados").includes("Ritmo esperado da meta"));
});

// ── Correções da revisão final ───────────────────────────────────────────────
import { fonteSemAcesso } from "../src/lib/cockpit-ceo/adaptador-brain.ts";

test("Soma da composição em reais confere com o total, sem erro de ponto flutuante", () => {
  const linhas = [100.1, 200.2, 300.3].map((valor) => ({ valor, soma: true }));
  assert.equal(somaDaComposicao({ composicao: linhas }), 600.6);
});

test("Dado com mais de 30 minutos é parcial, como na barra de frescor da Monetização", () => {
  const velho = dados({ measured_at: "2026-09-22T14:20:00Z", catalog_at: "2026-09-22T14:20:00Z" });
  const plano = {
    month: "2026-09",
    owner_id: 1,
    owner_name: "Pessoa",
    capacity: 90,
    meetings_capacity: 40,
    target_contracts: 6,
    daily_target: 4,
    allocation: { cella: 0, consultoria: 0, finance: 0 },
    rates: { cella: null, consultoria: null, finance: null },
  };
  velho.plans = [plano];
  const c = montarCockpit(fonteOk(velho), recorte());
  assert.equal(ind(c, "contratos-ganhos").estado, "parcial");
  assert.equal(ind(c, "contas-prontas").estado, "parcial");
  assert.ok(
    !c.ameacas.some((a) => a.id === "ritmo-contratos"),
    "dado parado não acusa ritmo contra hoje",
  );
  const fresco = montarCockpit(fonteOk(), recorte());
  assert.equal(ind(fresco, "contratos-ganhos").estado, "disponivel");
});

test("Perímetro de unidade declara também negócio de conta sem unidade, inclusive na receita", () => {
  const contaE = conta("E", { orgs: [103] });
  const n6 = negocio(
    6,
    "finance",
    { validated: [ev("2026-09-15")] },
    { validated_at: "2026-09-15", revenue: receita(500, 150, 350), org_id: 103 },
  );
  const d = dados();
  d.accounts = [...d.accounts, contaE];
  d.cards = [...d.cards, n6];
  const c = montarCockpit(fonteOk(d), recorte({}, "u1"));
  const val = ind(c, "oportunidades-validadas");
  assert.match(val.notaComposicao, /1 negócio sem conta vinculada/);
  assert.match(val.notaComposicao, /1 negócio de conta sem unidade/);
  const rec = ind(c, "receita-prevista-aberta");
  assert.match(rec.notaComposicao, /fora do recorte por unidade/);
});

test("Produto sem negócio aberto validado mostra zero; só o desconhecido mostra traço", () => {
  const c = montarCockpit(fonteOk(), recorte());
  const linha = (p) => c.porProduto.find((l) => l.produto === p);
  assert.equal(linha("consultoria").receitaPrevista, 0);
  assert.equal(linha("finance").receitaPrevista, null, "só negócio sem valor declarado");
  assert.equal(linha("cella").receitaPrevista, 1000);
});

test("Período desconhecido na URL cai no mês atual e avisa", () => {
  assert.equal(validarBusca({ periodo: "semestre" }).periodo, "semestre");
  const r = resolverPeriodo(validarBusca({ periodo: "semestre" }), "2026-09-22");
  assert.equal(r.preset, "mes");
  assert.ok(r.aviso);
});

test("Sem leitura de negócios, contas prontas não se afirmam: disponibilidade depende deles", () => {
  const c = montarCockpit(fonteOk(dados(), { acessoNegocios: false }), recorte());
  assert.equal(ind(c, "contas-prontas").estado, "acesso_insuficiente");
  assert.equal(ind(c, "contas-prontas").valor, null);
});

test("Sem nenhuma chave de Base ou Monetização a resposta é acesso insuficiente, não fonte fora", () => {
  const c = montarCockpit(fonteSemAcesso("2026-09-22", "2026-09-22T15:00:00Z"), recorte());
  for (const i of c.indicadores.filter((x) => DA_MONETIZACAO.includes(x.id))) {
    assert.equal(i.estado, "acesso_insuficiente", i.id);
    assert.equal(i.valor, null, i.id);
  }
});

test("Fonte sintética nasce fresca em relação ao relógio de quem abre o preview", () => {
  const c = montarCockpit(fonteSintetica("2026-09-22", "2026-09-23T02:30:00Z"), recorte());
  assert.equal(ind(c, "contratos-ganhos").estado, "disponivel");
});

// ── Rodada 2: homologação com dado real ──────────────────────────────────────
test("Sem histórico antes do período comparável, a comparação não vira zero", () => {
  const anterior = (c) =>
    ind(c, "contratos-ganhos").comparacoes.find((x) => x.rotulo.startsWith("Período anterior"));
  // Primeiro evento da fixture: 20/08. O mês atual compara com 10/08–31/08: cobertura parcial.
  const parcial = anterior(montarCockpit(fonteOk(dados()), recorte()));
  assert.equal(parcial.estado, "parcial");
  assert.equal(parcial.referencia, 1);
  assert.match(parcial.nota, /a partir de 20\/08\/2026/);
  // Com um evento antigo, o período anterior fica coberto por inteiro.
  const d1 = dados();
  d1.cards = [...d1.cards, negocio(7, "cella", { loaded: [ev("2026-07-01")] }, { org_id: 997 })];
  assert.equal(anterior(montarCockpit(fonteOk(d1), recorte())).estado, "disponivel");
  // Sem nenhum evento antes do período, não há comparação: nem zero, nem ameaça de queda.
  const d2 = dados();
  d2.cards = d2.cards.filter((c) => c.id !== 2 && c.id !== 4);
  const c2 = montarCockpit(fonteOk(d2), recorte());
  const semHistorico = anterior(c2);
  assert.equal(semHistorico.estado, "nao_apurado");
  assert.equal(semHistorico.referencia, null);
  assert.match(semHistorico.nota, /eventos a partir de/);
  assert.ok(!c2.ameacas.some((a) => a.id === "validadas-em-queda"));
});

test("Meta de R$ 1 bi mostra as leituras candidatas sem escolher perímetro nem calcular gap", () => {
  const destino = {
    rota: "/financeiro",
    search: {},
    rotulo: "x",
    mesmoRecorte: false,
    observacao: "",
  };
  const linhas = (valor, desde, n) =>
    Array.from({ length: n }, (_, i) => ({
      mes: new Date(Date.UTC(Number(desde.slice(0, 4)), Number(desde.slice(5, 7)) - 1 + i, 1))
        .toISOString()
        .slice(0, 7),
      chave: "X",
      valor,
    }));
  const receita = {
    estado: "ok",
    erro: null,
    leituras: [
      {
        id: "grupo",
        titulo: "Empresas do grupo",
        definicao: "d",
        fonte: "f",
        estado: "disponivel",
        nota: null,
        linhas: linhas(10_000_000, "2026-01", 8),
        cobertura: [],
        destino,
      },
      {
        id: "rede",
        titulo: "Faturamento da rede",
        definicao: "d",
        fonte: "f",
        estado: "disponivel",
        nota: null,
        linhas: linhas(1_500_000, "2025-01", 20),
        cobertura: [],
        destino,
      },
    ],
  };
  const c = montarCockpit(fonteOk(dados(), { receita }), recorte());
  const meta = ind(c, "meta-bilhao");
  assert.equal(meta.estado, "nao_apurado");
  assert.equal(meta.valor, null);
  assert.ok(meta.composicao.some((l) => l.chave === "leitura:grupo" && l.valor === 10_000_000));
  assert.ok(meta.composicao.some((l) => l.chave === "leitura:rede" && l.valor === 1_500_000));
  assert.ok(!meta.composicao.some((l) => l.soma), "leituras não se somam");
  const necessaria = meta.comparacoes.find((x) => /necessária em 2030/.test(x.rotulo));
  assert.equal(Math.round(necessaria.referencia), 83_333_333);
  assert.match(meta.notaComposicao, /não se somam/);
  assert.equal(c.trajetoria.length, 2);
  assert.equal(montarCockpit(fonteOk(), recorte()).trajetoria, null);
});

test("Sem acesso ao Financeiro, a leitura do grupo fica em acesso insuficiente e sem número", () => {
  const destino = {
    rota: "/financeiro",
    search: {},
    rotulo: "x",
    mesmoRecorte: false,
    observacao: "",
  };
  const receita = {
    estado: "ok",
    erro: null,
    leituras: [
      {
        id: "grupo",
        titulo: "Empresas do grupo",
        definicao: "d",
        fonte: "f",
        estado: "acesso_insuficiente",
        nota: "Sua conta não tem acesso ao Brain Financeiro.",
        linhas: [],
        cobertura: [],
        destino,
      },
    ],
  };
  const c = montarCockpit(fonteOk(dados(), { receita }), recorte());
  const [g] = c.trajetoria;
  assert.equal(g.estado, "acesso_insuficiente");
  assert.equal(g.fechados, null);
  assert.equal(g.multiploNecessario, null);
  const linha = ind(c, "meta-bilhao").composicao.find((l) => l.chave === "leitura:grupo");
  assert.equal(linha.valor, null, "nunca R$ 0");
  assert.match(linha.observacao, /não tem acesso/);
});

test("Preview sintético traz as duas leituras candidatas, identificadas e com mês parcial da rede", () => {
  const f = fonteSintetica("2026-09-22", "2026-09-22T12:00:00.000Z");
  assert.equal(f.receita.estado, "ok");
  assert.deepEqual(
    f.receita.leituras.map((l) => l.id),
    ["grupo", "rede"],
  );
  assert.ok(f.receita.leituras.every((l) => l.fonte.startsWith("SINTÉTICO")));
  const rede = f.receita.leituras[1];
  assert.equal(rede.parciaisFonte.length, 1);
  assert.match(rede.notasPorMes[rede.parciaisFonte[0]], /Unidade Exemplo Leste/);
  const c = montarCockpit(f, recorte());
  assert.ok(c.trajetoria.every((t) => t.fechados && t.fechados.meses > 0));
});

test("Carga das leituras de faturamento: erro não vira leitura vazia 'ok'", async () => {
  const { receitaDaCarga } = await import("../src/lib/cockpit-ceo/adaptador-brain.ts");
  assert.equal(receitaDaCarga({ isLoading: true }).estado, "carregando");
  const e = receitaDaCarga({ isLoading: false, error: new Error("") });
  assert.equal(e.estado, "erro");
  assert.match(e.erro, /faturamento/);
  assert.equal(receitaDaCarga({ isLoading: false, data: { leituras: [] } }).estado, "ok");
  const c = montarCockpit(fonteOk(dados(), { receita: e }), recorte());
  assert.equal(c.trajetoria, null);
  assert.match(c.trajetoriaAviso, /faturamento/);
});

test("Preview sintético mostra as quatro definições de cliente ativo com sobreposição e penetração", () => {
  const f = fonteSintetica("2026-09-22", "2026-09-22T12:00:00.000Z");
  const c = montarCockpit(f, recorte());
  assert.equal(c.clientes.definicoes.length, 4);
  assert.ok(c.clientes.definicoes.every((d) => d.fonte.startsWith("SINTÉTICO")));
  const qb = c.clientes.definicoes.find((d) => d.id === "qb_ativos");
  assert.equal(qb.semContaBase, 4);
  assert.equal(qb.contasBase, f.monetizacao.dados.accounts.length);
  assert.equal(c.clientes.sobreposicao.length, 6);
  assert.equal(c.clientes.penetracaoEstado, "parcial");
  assert.ok(
    qb.penetracao.some((p) => p.contas > 0),
    "a fixture tem negócio ganho",
  );
  const sem = montarCockpit(fonteSemAcesso("2026-09-22", "2026-09-22T12:00:00.000Z"), recorte());
  assert.equal(sem.clientes, null);
});
