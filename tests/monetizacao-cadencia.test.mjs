// Cadência da pré-venda da Monetização (pipe 39): dias úteis, horário de São Paulo em UTC, criação idempotente,
// retomada, encerramento, cards ignorados, MONET_CADENCIA_INICIO e dry-run, com Pipedrive e banco simulados em
// memória. A régua real tem testes próprios no fim; o resto usa uma régua de teste pequena.
import test from "node:test";
import assert from "node:assert/strict";
import {
  assunto,
  chavesDaRegua,
  diaUtilApos,
  diaZero,
  escolherTipos,
  instante,
  notaHtml,
  origemDaEntrada,
  planejar,
  rodarCadencia,
  vencimentoUtc,
} from "../supabase/functions/monetizacao-cadencia/logica.ts";
import { HORARIO, REGUA, VERSAO_REGUA } from "../supabase/functions/monetizacao-cadencia/regua.ts";

const REGUA_TESTE = [
  { dia: 0, turno: "manha", canal: "E-mail", tipo: "email", nota: "Olá, [NOME]" },
  { dia: 0, turno: "tarde", canal: "Ligação", tipo: "call", nota: "Dois toques" },
  { dia: 1, turno: "manha", canal: "WhatsApp", tipo: "whatsapp", nota: "Oi\n[NOME]" },
];
const VERSAO = "teste-1";
const INICIO = "2026-10-01T00:00:00Z";
const AGORA = new Date("2026-10-09T18:00:00Z");
const TIPOS = [
  { key_string: "call", name: "Ligação", active_flag: true },
  { key_string: "email", name: "E-mail", active_flag: true },
  { key_string: "task", name: "Tarefa", active_flag: true },
  { key_string: "whatsapp", name: "WhatsApp", active_flag: true },
];

const copia = (x) => JSON.parse(JSON.stringify(x));
const mudanca = (de, para, logTime) => ({
  object: "dealChange",
  timestamp: logTime,
  data: {
    field_key: "stage_id",
    old_value: String(de),
    new_value: String(para),
    log_time: logTime,
  },
});
const deal = (id, stageChange, extra = {}) => ({
  id,
  stage_id: 276,
  status: "open",
  user_id: { id: 7001, name: "Matheus" },
  add_time: "2026-09-01 10:00:00",
  stage_change_time: stageChange,
  ...extra,
});

/** Pipedrive em memória: deals abertos da 276, histórico, deals por id e atividades. */
function fakePipedrive({ abertos = [], flows = {}, deals = {}, tipos = TIPOS, falharPost } = {}) {
  const chamadas = [];
  const atividades = new Map();
  let proximo = 5000;
  let posts = 0;
  return {
    chamadas,
    atividades,
    escritas: () => chamadas.filter(([m]) => m === "POST" || m === "DELETE"),
    async get(path) {
      chamadas.push(["GET", path]);
      if (path === "activityTypes") return { data: tipos };
      let m = /^activities\/(\d+)$/.exec(path);
      if (m) {
        const a = atividades.get(Number(m[1]));
        if (!a) throw new Error("Pipedrive HTTP 404");
        return { data: copia(a) };
      }
      m = /^deals\/(\d+)$/.exec(path);
      if (m) {
        const d = deals[m[1]];
        if (!d) throw new Error("Pipedrive HTTP 404");
        return { data: copia(d) };
      }
      throw new Error(`GET inesperado: ${path}`);
    },
    async pages(path, params) {
      chamadas.push(["PAGES", path, params]);
      if (path === "deals") {
        assert.deepEqual(params, { stage_id: "276", status: "open" });
        return copia(abertos);
      }
      const m = /^deals\/(\d+)\/flow$/.exec(path);
      if (m) return copia(flows[m[1]] || []);
      throw new Error(`pages inesperado: ${path}`);
    },
    async post(path, payload) {
      chamadas.push(["POST", path, payload]);
      assert.equal(path, "activities");
      posts++;
      if (falharPost?.(posts)) throw new Error("Pipedrive HTTP 500");
      const id = proximo++;
      atividades.set(id, { id, ...payload, done: false });
      return { data: { id } };
    },
    async del(path) {
      chamadas.push(["DELETE", path]);
      const id = Number(path.split("/")[1]);
      if (!atividades.has(id)) throw new Error("Pipedrive HTTP 404");
      atividades.delete(id);
    },
  };
}

/** ops.monetizacao_cadencia em memória, com a mesma chave (deal_id, entrou_em). */
function fakeStore(linhas = []) {
  const chamadas = [];
  const mesma = (a, deal, entrou) =>
    Number(a.deal_id) === Number(deal) && Date.parse(a.entrou_em) === Date.parse(entrou);
  return {
    linhas,
    chamadas,
    escritas: () => chamadas.filter(([m]) => m === "insert" || m === "update"),
    async linhasDosDeals(ids) {
      chamadas.push(["select", ids]);
      return copia(linhas.filter((l) => ids.includes(Number(l.deal_id))));
    },
    async ativas() {
      chamadas.push(["ativas"]);
      return copia(linhas.filter((l) => l.status === "ativa"));
    },
    async inserir(linha) {
      chamadas.push(["insert", copia(linha)]);
      if (linhas.some((l) => mesma(l, linha.deal_id, linha.entrou_em))) return false;
      linhas.push(copia(linha));
      return true;
    },
    async atualizar(deal, entrou, patch) {
      chamadas.push(["update", deal, entrou, copia(patch)]);
      const l = linhas.find((x) => mesma(x, deal, entrou));
      if (l) Object.assign(l, copia(patch));
    },
  };
}

const rodar = (pd, store, extra = {}) =>
  rodarCadencia({
    pd,
    store,
    agora: AGORA,
    inicio: INICIO,
    ativo: true,
    regua: REGUA_TESTE,
    versao: VERSAO,
    ...extra,
  });

// ---------------------------------------------------------------------------- datas

test("dias úteis: sexta 09/10/2026 tem D1 em 13/10 (12/10 é feriado)", () => {
  const d0 = diaZero(instante("2026-10-09 15:00:00"));
  assert.equal(d0, "2026-10-09");
  assert.equal(diaUtilApos(d0, 1), "2026-10-13");
  assert.equal(diaUtilApos(d0, 2), "2026-10-14");
  assert.equal(diaUtilApos(d0, 0), d0);
});

test("dias úteis: entrada no sábado começa na segunda (e pula a segunda feriado)", () => {
  assert.equal(diaZero(instante("2026-10-17 13:00:00")), "2026-10-19");
  assert.equal(diaZero(instante("2026-10-10 13:00:00")), "2026-10-13");
  assert.equal(diaZero(instante("2026-10-11 13:00:00")), "2026-10-13");
});

test("dias úteis: a data é a de São Paulo, não a do UTC", () => {
  // 02:30 UTC de sábado = 23:30 de sexta em São Paulo.
  assert.equal(diaZero(instante("2026-10-10 02:30:00")), "2026-10-09");
});

test("dias úteis: virada de ano pula 01/01/2027 e o fim de semana", () => {
  const d0 = diaZero(instante("2026-12-31 13:00:00"));
  assert.equal(d0, "2026-12-31");
  assert.equal(diaUtilApos(d0, 1), "2027-01-04");
  assert.equal(diaZero(instante("2027-01-01 13:00:00")), "2027-01-04");
});

test("horário: 09:00 e 14:00 de São Paulo viram UTC, pelo Intl", () => {
  assert.deepEqual(vencimentoUtc("2026-10-13", "09:00"), {
    due_date: "2026-10-13",
    due_time: "12:00",
  });
  assert.deepEqual(vencimentoUtc("2026-10-13", "14:00"), {
    due_date: "2026-10-13",
    due_time: "17:00",
  });
  // Perto da meia-noite o dia em UTC já é o seguinte.
  assert.deepEqual(vencimentoUtc("2026-10-13", "22:30"), {
    due_date: "2026-10-14",
    due_time: "01:30",
  });
  // Com horário de verão (2018) o deslocamento era -2: prova que não é -3 fixo.
  assert.deepEqual(vencimentoUtc("2018-12-03", "09:00"), {
    due_date: "2018-12-03",
    due_time: "11:00",
  });
});

test("instante: formato do Pipedrive é UTC; ISO com fuso também vale", () => {
  assert.equal(instante("2026-10-09 12:00:00").toISOString(), "2026-10-09T12:00:00.000Z");
  assert.equal(instante("2026-10-09T09:00:00-03:00").toISOString(), "2026-10-09T12:00:00.000Z");
  assert.equal(instante("2026-10-09T12:00:00").toISOString(), "2026-10-09T12:00:00.000Z");
  assert.equal(instante(""), null);
  assert.equal(instante("ontem"), null);
});

test("planejar: dia útil e horário de cada item, em UTC", () => {
  const plano = planejar(instante("2026-10-09 15:00:00"), REGUA_TESTE);
  assert.deepEqual(
    plano.map((p) => [p.chave, p.due_date, p.due_time]),
    [
      ["d0-manha-email", "2026-10-09", "12:00"],
      ["d0-tarde-call", "2026-10-09", "17:00"],
      ["d1-manha-whatsapp", "2026-10-13", "12:00"],
    ],
  );
  assert.equal(plano[2].subject, "Caixa · D1 · WhatsApp · manhã");
  assert.equal(plano[2].note, "Oi<br>[NOME]");
});

// ---------------------------------------------------------------------------- criação

test("cria a cadência do card que veio da 274, com dono, tipo e nota", async () => {
  const pd = fakePipedrive({
    abertos: [deal(101, "2026-10-09 15:00:00")],
    flows: { 101: [mudanca(274, 276, "2026-10-09 15:00:00")] },
  });
  const store = fakeStore();
  const r = await rodar(pd, store);
  assert.equal(r.status, "ok");
  assert.equal(r.modo, "ativo");
  assert.deepEqual(r.criados, [
    { deal: 101, entrou_em: "2026-10-09T15:00:00.000Z", atividades: 3 },
  ]);
  const posts = pd.chamadas.filter(([m]) => m === "POST").map(([, , p]) => p);
  assert.equal(posts.length, 3);
  assert.deepEqual(posts[0], {
    subject: "Caixa · D0 · E-mail · manhã",
    type: "email",
    due_date: "2026-10-09",
    due_time: "12:00",
    duration: "00:15",
    deal_id: 101,
    user_id: 7001,
    note: "Olá, [NOME]",
    done: 0,
  });
  assert.equal(store.linhas.length, 1);
  const linha = store.linhas[0];
  assert.equal(linha.status, "ativa");
  assert.equal(linha.dono, 7001);
  assert.equal(linha.versao_regua, VERSAO);
  assert.deepEqual(
    linha.atividades.map((a) => [a.chave, a.tipo, a.dia, a.turno]),
    [
      ["d0-manha-email", "email", 0, "manha"],
      ["d0-tarde-call", "call", 0, "tarde"],
      ["d1-manha-whatsapp", "whatsapp", 1, "manha"],
    ],
  );
  // A linha nasce antes da primeira atividade.
  assert.equal(store.chamadas.find(([m]) => m === "insert" || m === "update")[0], "insert");
});

test("idempotência: rodar duas vezes não duplica atividade nem linha", async () => {
  const pd = fakePipedrive({
    abertos: [deal(101, "2026-10-09 15:00:00")],
    flows: { 101: [mudanca(274, 276, "2026-10-09 15:00:00")] },
  });
  const store = fakeStore();
  await rodar(pd, store);
  const r2 = await rodar(pd, store);
  assert.deepEqual(r2.criados, []);
  assert.equal(pd.chamadas.filter(([m]) => m === "POST").length, 3);
  assert.equal(pd.atividades.size, 3);
  assert.equal(store.linhas.length, 1);
  // Na segunda rodada, o histórico do card nem é consultado de novo.
  assert.equal(pd.chamadas.filter(([m, p]) => m === "PAGES" && p === "deals/101/flow").length, 1);
});

test("retomada: erro no meio grava o que foi criado e a rodada seguinte completa só o que falta", async () => {
  const pd = fakePipedrive({
    abertos: [deal(101, "2026-10-09 15:00:00")],
    flows: { 101: [mudanca(274, 276, "2026-10-09 15:00:00")] },
    falharPost: (n) => n === 2,
  });
  const store = fakeStore();
  const r1 = await rodar(pd, store);
  assert.equal(r1.status, "com_erros");
  assert.equal(r1.erros[0].deal, 101);
  assert.equal(r1.erros[0].etapa, "criar");
  assert.deepEqual(
    store.linhas[0].atividades.map((a) => a.chave),
    ["d0-manha-email"],
  );
  const r2 = await rodar(pd, store);
  assert.equal(r2.status, "ok");
  assert.deepEqual(r2.criados, [
    { deal: 101, entrou_em: "2026-10-09T15:00:00.000Z", atividades: 2, retomada: true },
  ]);
  assert.deepEqual(
    store.linhas[0].atividades.map((a) => a.chave),
    ["d0-manha-email", "d0-tarde-call", "d1-manha-whatsapp"],
  );
  assert.equal(pd.atividades.size, 3);
  const assuntos = [...pd.atividades.values()].map((a) => a.subject);
  assert.equal(new Set(assuntos).size, 3);
});

test("retomada: linha ativa gravada sem atividade (rodada que morreu) recebe só as que faltam", async () => {
  const pd = fakePipedrive({ abertos: [deal(101, "2026-10-09 15:00:00")] });
  const store = fakeStore([
    {
      deal_id: 101,
      entrou_em: "2026-10-09T15:00:00+00:00",
      dono: 7001,
      versao_regua: VERSAO,
      status: "ativa",
      atividades: [
        {
          id: 1,
          chave: "d0-manha-email",
          dia: 0,
          canal: "E-mail",
          tipo: "email",
          turno: "manha",
          due_date: "2026-10-09",
          due_time: "12:00",
        },
      ],
    },
  ]);
  const r = await rodar(pd, store);
  assert.equal(r.criados[0].atividades, 2);
  assert.deepEqual(
    pd.chamadas.filter(([m]) => m === "POST").map(([, , p]) => p.subject),
    ["Caixa · D0 · Ligação · tarde", "Caixa · D1 · WhatsApp · manhã"],
  );
  assert.equal(store.chamadas.filter(([m]) => m === "insert").length, 0);
  // Linha existente não reabre o histórico.
  assert.equal(pd.chamadas.filter(([m, p]) => m === "PAGES" && p === "deals/101/flow").length, 0);
});

test("tipo que não existe na conta vira task e aparece em tipos_substituidos", async () => {
  const pd = fakePipedrive({
    abertos: [deal(101, "2026-10-09 15:00:00")],
    flows: { 101: [mudanca(274, 276, "2026-10-09 15:00:00")] },
    tipos: TIPOS.filter((t) => t.key_string !== "whatsapp"),
  });
  const r = await rodar(pd, fakeStore());
  assert.deepEqual(r.tipos_substituidos, [{ tipo: "whatsapp", usado: "task" }]);
  const tipos = pd.chamadas.filter(([m]) => m === "POST").map(([, , p]) => p.type);
  assert.deepEqual(tipos, ["email", "call", "task"]);
});

test("escolherTipos: tipo inativo cai para task; tipo da conta é achado pelo nome", () => {
  const r = escolherTipos(
    [
      { key_string: "call", active_flag: false },
      { key_string: "email", active_flag: true },
      { key_string: "whatsapp_mensagem", name: "WhatsApp", active_flag: true },
    ],
    REGUA_TESTE,
  );
  assert.equal(r.usar.get("call"), "task");
  assert.equal(r.usar.get("email"), "email");
  assert.equal(r.usar.get("whatsapp"), "whatsapp_mensagem");
  assert.deepEqual(r.substituidos, [{ tipo: "call", usado: "task" }]);
});

// ---------------------------------------------------------------------------- quem não recebe

test("card que veio da 290 ou foi criado direto na 276 não recebe e vira ignorada", async () => {
  const pd = fakePipedrive({
    abertos: [
      deal(201, "2026-10-09 15:00:00"),
      deal(202, null, { add_time: "2026-10-09 16:00:00" }),
    ],
    flows: {
      201: [
        mudanca(274, 276, "2026-10-05 12:00:00"),
        mudanca(276, 290, "2026-10-07 12:00:00"),
        mudanca(290, 276, "2026-10-09 15:00:00"),
      ],
      202: [],
    },
  });
  const store = fakeStore();
  const r = await rodar(pd, store);
  assert.deepEqual(r.criados, []);
  assert.deepEqual(r.ignorados, [
    { deal: 201, motivo: "veio da etapa 290" },
    { deal: 202, motivo: "criado direto na etapa 276, sem vir da 274" },
  ]);
  assert.equal(pd.escritas().length, 0);
  assert.deepEqual(
    store.linhas.map((l) => [l.deal_id, l.status, l.motivo_encerramento]),
    [
      [201, "ignorada", "veio da etapa 290"],
      [202, "ignorada", "criado direto na etapa 276, sem vir da 274"],
    ],
  );
  // Gravada como ignorada, não reconsulta o histórico na rodada seguinte.
  const antes = pd.chamadas.length;
  await rodar(pd, store);
  assert.equal(
    pd.chamadas.slice(antes).filter(([m, p]) => m === "PAGES" && /flow/.test(p)).length,
    0,
  );
});

test("origemDaEntrada: vale a mudança cujo log_time bate com a entrada", () => {
  const flow = [
    mudanca(274, 276, "2026-10-09 15:00:00"),
    mudanca(276, 290, "2026-10-09 16:00:00"),
    mudanca(290, 276, "2026-10-09 17:00:00"),
  ];
  assert.equal(origemDaEntrada(flow, instante("2026-10-09 15:00:00")).de, 274);
  assert.equal(origemDaEntrada(flow, instante("2026-10-09 17:00:00")).de, 290);
  // Sem log_time que bata, a mais recente.
  assert.equal(origemDaEntrada(flow, instante("2026-10-09 18:00:00")).de, 290);
});

test("card que entrou na 276 antes do MONET_CADENCIA_INICIO não recebe", async () => {
  const pd = fakePipedrive({
    abertos: [deal(301, "2026-09-30 23:59:00")],
    flows: { 301: [mudanca(274, 276, "2026-09-30 23:59:00")] },
  });
  const store = fakeStore();
  const r = await rodar(pd, store);
  assert.deepEqual(r.criados, []);
  assert.equal(r.anteriores_ao_inicio, 1);
  assert.equal(pd.escritas().length, 0);
  assert.equal(store.escritas().length, 0);
  assert.equal(pd.chamadas.filter(([m, p]) => m === "PAGES" && /flow/.test(p)).length, 0);
});

test("sem MONET_CADENCIA_INICIO (ou inválida) não cria nada e o resumo diz por quê", async () => {
  for (const inicio of [undefined, "", "amanhã"]) {
    const pd = fakePipedrive({
      abertos: [deal(101, "2026-10-09 15:00:00")],
      flows: { 101: [mudanca(274, 276, "2026-10-09 15:00:00")] },
    });
    const store = fakeStore();
    const r = await rodar(pd, store, { inicio });
    assert.equal(r.inicio, null);
    assert.match(r.aviso, /MONET_CADENCIA_INICIO/);
    assert.deepEqual(r.criados, []);
    assert.equal(pd.escritas().length, 0);
    assert.equal(store.escritas().length, 0);
  }
});

// ---------------------------------------------------------------------------- encerramento

/** Card 401 com cadência ativa de 3 atividades: 5001 feita, 5002 aberta, 5003 já apagada; 9999 é de fora. */
function cenarioEncerramento({ dealAtual, abertos = [] } = {}) {
  const pd = fakePipedrive({ abertos, deals: dealAtual ? { 401: dealAtual } : {} });
  pd.atividades.set(5001, { id: 5001, deal_id: 401, done: true });
  pd.atividades.set(5002, { id: 5002, deal_id: 401, done: false });
  pd.atividades.set(9999, { id: 9999, deal_id: 401, done: false, subject: "Outra do card" });
  const atv = (id, chave) => ({
    id,
    chave,
    dia: 0,
    canal: "x",
    tipo: "call",
    turno: "manha",
    due_date: "2026-10-09",
    due_time: "12:00",
  });
  const store = fakeStore([
    {
      deal_id: 401,
      entrou_em: "2026-10-09T15:00:00+00:00",
      dono: 7001,
      versao_regua: VERSAO,
      status: "ativa",
      atividades: [atv(5001, "a"), atv(5002, "b"), atv(5003, "c")],
    },
  ]);
  return { pd, store };
}

test("encerramento apaga só as não feitas da lista e nunca outra atividade do card", async () => {
  const { pd, store } = cenarioEncerramento({
    dealAtual: deal(401, "2026-10-10 12:00:00", { stage_id: 290 }),
  });
  const r = await rodar(pd, store);
  assert.deepEqual(r.encerrados, [
    { deal: 401, motivo: "saiu para a etapa 290", apagadas: 1, mantidas: 1, ja_nao_existiam: 1 },
  ]);
  assert.deepEqual(pd.escritas(), [["DELETE", "activities/5002"]]);
  assert.ok(pd.atividades.has(5001));
  assert.ok(pd.atividades.has(9999));
  assert.ok(!pd.atividades.has(5002));
  assert.equal(store.linhas[0].status, "encerrada");
  assert.equal(store.linhas[0].motivo_encerramento, "saiu para a etapa 290");
  assert.equal(store.linhas[0].encerrado_em, AGORA.toISOString());
  // Encerrada não volta a ser processada.
  const antes = pd.chamadas.length;
  const r2 = await rodar(pd, store);
  assert.deepEqual(r2.encerrados, []);
  assert.equal(pd.chamadas.slice(antes).filter(([m]) => m === "DELETE").length, 0);
});

test("encerramento: perdido, ganho, apagado e saiu e voltou", async () => {
  const casos = [
    [deal(401, "2026-10-09 15:00:00", { status: "lost" }), [], "perdido"],
    [deal(401, "2026-10-09 15:00:00", { status: "won" }), [], "ganho"],
    [deal(401, "2026-10-09 15:00:00", { status: "deleted" }), [], "apagado"],
    [null, [], "apagado"],
    [null, [deal(401, "2026-10-12 12:00:00")], "saiu e voltou à etapa"],
  ];
  for (const [dealAtual, abertos, motivo] of casos) {
    const { pd, store } = cenarioEncerramento({ dealAtual, abertos });
    const r = await rodar(pd, store, { inicio: "2030-01-01T00:00:00Z" });
    assert.equal(r.encerrados[0]?.motivo, motivo, motivo);
    assert.equal(store.linhas[0].status, "encerrada");
  }
});

test("card que segue na 276 com a mesma entrada não é encerrado", async () => {
  const { pd, store } = cenarioEncerramento({ abertos: [deal(401, "2026-10-09 15:00:00")] });
  const r = await rodar(pd, store, { inicio: "2030-01-01T00:00:00Z" });
  assert.deepEqual(r.encerrados, []);
  assert.equal(store.linhas[0].status, "ativa");
  assert.equal(pd.escritas().length, 0);
});

test("saiu e voltou da 274: encerra a cadência antiga e cria a nova", async () => {
  const { pd, store } = cenarioEncerramento({ abertos: [deal(401, "2026-10-13 12:00:00")] });
  pd.chamadas.length = 0;
  const flows = { 401: [mudanca(274, 276, "2026-10-13 12:00:00")] };
  const pages = pd.pages;
  pd.pages = async (path, params) =>
    path === "deals/401/flow" ? copia(flows[401]) : pages(path, params);
  const r = await rodar(pd, store);
  assert.equal(r.encerrados[0].motivo, "saiu e voltou à etapa");
  assert.deepEqual(r.criados, [
    { deal: 401, entrou_em: "2026-10-13T12:00:00.000Z", atividades: 3 },
  ]);
  assert.deepEqual(
    store.linhas.map((l) => [l.entrou_em, l.status]),
    [
      ["2026-10-09T15:00:00+00:00", "encerrada"],
      ["2026-10-13T12:00:00.000Z", "ativa"],
    ],
  );
});

// ---------------------------------------------------------------------------- dry-run e orçamento

test("dry-run não escreve nada no Pipedrive nem no banco, e responde o que faria", async () => {
  const { pd, store } = cenarioEncerramento({
    dealAtual: deal(401, "2026-10-10 12:00:00", { stage_id: 290 }),
    abertos: [deal(101, "2026-10-09 15:00:00"), deal(201, "2026-10-09 15:00:00")],
  });
  const flows = {
    101: [mudanca(274, 276, "2026-10-09 15:00:00")],
    201: [mudanca(290, 276, "2026-10-09 15:00:00")],
  };
  const pages = pd.pages;
  pd.pages = async (path, params) => {
    const m = /^deals\/(\d+)\/flow$/.exec(path);
    return m ? copia(flows[m[1]] || []) : pages(path, params);
  };
  const r = await rodar(pd, store, { ativo: false });
  assert.equal(r.modo, "dry-run");
  assert.deepEqual(r.criados, [
    { deal: 101, entrou_em: "2026-10-09T15:00:00.000Z", atividades: 3 },
  ]);
  assert.deepEqual(r.ignorados, [{ deal: 201, motivo: "veio da etapa 290" }]);
  assert.deepEqual(r.encerrados, [
    { deal: 401, motivo: "saiu para a etapa 290", apagadas: 1, mantidas: 1, ja_nao_existiam: 1 },
  ]);
  assert.equal(pd.chamadas.filter(([m]) => m === "POST" || m === "DELETE").length, 0);
  assert.equal(store.escritas().length, 0);
  assert.equal(store.linhas.length, 1);
  assert.equal(store.linhas[0].status, "ativa");
});

test("orçamento: sem tempo, o card fica para a próxima rodada", async () => {
  const pd = fakePipedrive({
    abertos: [deal(101, "2026-10-09 15:00:00"), deal(102, "2026-10-09 16:00:00")],
    flows: {
      101: [mudanca(274, 276, "2026-10-09 15:00:00")],
      102: [mudanca(274, 276, "2026-10-09 16:00:00")],
    },
  });
  let t = 0;
  const store = fakeStore();
  const r = await rodar(pd, store, { relogio: () => (t += 60_000), orcamentoMs: 90_000 });
  assert.equal(r.criados.length, 1);
  assert.equal(r.criados[0].deal, 101);
  assert.equal(r.adiados, 1);
  const r2 = await rodar(pd, store);
  assert.deepEqual(
    r2.criados.map((c) => c.deal),
    [102],
  );
});

// ---------------------------------------------------------------------------- a régua real

test("régua real: 19 atividades, chaves únicas, D4 e D9 sem atividade", () => {
  assert.equal(VERSAO_REGUA, "v2-2026-10-09");
  assert.deepEqual(HORARIO, { manha: "09:00", tarde: "14:00" });
  assert.equal(REGUA.length, 19);
  const chaves = chavesDaRegua(REGUA);
  assert.equal(new Set(chaves).size, 19);
  const dias = new Set(REGUA.map((r) => r.dia));
  assert.ok(!dias.has(4));
  assert.ok(!dias.has(9));
  assert.deepEqual(
    [...dias].sort((a, b) => a - b),
    [0, 1, 2, 3, 5, 6, 7, 8, 10],
  );
  for (const item of REGUA) {
    assert.ok(["manha", "tarde"].includes(item.turno));
    assert.ok(["email", "call", "whatsapp", "task"].includes(item.tipo));
    assert.ok(item.canal && item.nota);
  }
});

test("régua real: assunto e nota prontos para o Pipedrive", () => {
  const item = REGUA.find((r) => r.dia === 2 && r.turno === "tarde");
  assert.equal(assunto(item), "Caixa · D2 · WhatsApp retomada · tarde");
  const plano = planejar(instante("2026-10-09 15:00:00"), REGUA);
  const d2 = plano.find((p) => p.dia === 2 && p.turno === "tarde");
  assert.equal(d2.subject, "Caixa · D2 · WhatsApp retomada · tarde");
  assert.match(d2.note, /<br>/);
  assert.match(d2.note, /\[NOME\]/);
  assert.match(d2.note, /\[MOTIVO DO DOSSIÊ\]/);
  assert.ok(!d2.note.includes("\n"));
  assert.equal(plano[0].subject, "Caixa · D0 · E-mail de apresentação · manhã");
  assert.equal(plano.at(-1).subject, "Caixa · D10 · Descartar se não respondeu · manhã");
  // D10 de uma entrada em 09/10/2026: 13, 14, 15, 16, 19, 20, 21, 22, 23, 26/10.
  assert.equal(plano.at(-1).due_date, "2026-10-26");
});

test("notaHtml escapa &, < e > e troca quebra de linha por <br>", () => {
  assert.equal(notaHtml("A & B <x>\n[NOME]"), "A &amp; B &lt;x&gt;<br>[NOME]");
});
