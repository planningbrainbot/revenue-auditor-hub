// Etapas do pipe 39 lidas pelo nome, antigo e novo (renomeação de 09/10/2026: 3 · Qualificação,
// 4 · Agendado - Levantamento com sócio, 5 · Realizado - Levantamento com sócio). A carga, o bot de reuniões, a régua
// da Operação e a tela Gravações leem o papel da etapa em supabase/functions/_shared/etapas-pipe39.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { chaveDaEtapa } from "../supabase/functions/_shared/etapas-pipe39.ts";
import { tipoDaEtapa } from "../supabase/functions/monetizacao-reunioes/agenda.ts";
import { summarize } from "../supabase/functions/monetizacao-crm/crm.mjs";
import { funilCumulativo, reguaDoPipe } from "../src/lib/monetizacao/funil-cumulativo.ts";
import { levantamentoDoHistorico } from "../src/lib/monetizacao/gravacoes.ts";

// Os três nomes de cada etapa que mudou: antes de 01/10, de 01/10 a 09/10 e depois de 09/10.
const NOMES = {
  conexao: ["3 · Conexão", "3 · Qualificação", "Qualificação"],
  agendada: [
    "Reunião agendada",
    "4 · Reunião de levantamento agendada",
    "4 · Agendado - Levantamento com sócio",
    "Agendado - Levantamento com sócio",
  ],
  realizada: [
    "Reunião realizada",
    "5 · Reunião de levantamento realizada",
    "5 · Realizado - Levantamento com sócio",
    "Realizado - Levantamento com sócio",
  ],
  reuniaoProposta: ["6 · Reunião de proposta", "7 · Reunião de proposta"],
  base: ["1 · Base elegível", "Base elegível"],
  abordagem: ["2 · Abordagem iniciada", "Abordagem em curso", "3 Abordagem em curso"],
  gatilho: ["Gatilho (encerrada em 01/10 · não usar)", "2 Gatilho identificado"],
  negociacao: ["7 · Em negociação", "6 · Em negociação"],
  propostaEnviada: ["8 · Proposta enviada"],
  standby: ["9 · Stand by", "Standby"],
};

test("Cada etapa do pipe 39 tem o mesmo papel com o nome antigo e com o novo", () => {
  for (const [chave, nomes] of Object.entries(NOMES))
    for (const nome of nomes) assert.equal(chaveDaEtapa(nome), chave, nome);
});

test("Proposta nunca é levantamento; realizado nunca é agendado; desqualificado não é Qualificação", () => {
  assert.equal(chaveDaEtapa("6 · Reunião de proposta"), "reuniaoProposta");
  assert.equal(chaveDaEtapa("5 · Realizado - Levantamento com sócio"), "realizada");
  assert.equal(chaveDaEtapa("4 · Agendado - Levantamento com sócio"), "agendada");
  assert.equal(chaveDaEtapa("Desqualificado"), null);
  assert.equal(chaveDaEtapa("Reciclado"), null);
  assert.equal(chaveDaEtapa(""), null);
  assert.equal(chaveDaEtapa(null), null);
});

test("Bot de reuniões: entra no levantamento agendado e na proposta, com o nome antigo e o novo", () => {
  for (const nome of NOMES.agendada) assert.equal(tipoDaEtapa(nome), "levantamento", nome);
  for (const nome of NOMES.reuniaoProposta) assert.equal(tipoDaEtapa(nome), "proposta", nome);
  for (const nome of [...NOMES.realizada, ...NOMES.conexao, ...NOMES.negociacao])
    assert.equal(tipoDaEtapa(nome), null, nome);
});

// O pipe 39 de 01/10 (com a ordem da carga) e o mesmo pipe com os nomes de 09/10.
const ANTES = [
  { id: 274, name: "1 · Base elegível", order: 1 },
  { id: 276, name: "2 · Abordagem iniciada", order: 2 },
  { id: 290, name: "3 · Conexão", order: 3 },
  { id: 275, name: "Gatilho (encerrada em 01/10 · não usar)", order: 4 },
  { id: 277, name: "4 · Reunião de levantamento agendada", order: 5 },
  { id: 287, name: "5 · Reunião de levantamento realizada", order: 6 },
  { id: 291, name: "6 · Reunião de proposta", order: 7 },
  { id: 279, name: "7 · Em negociação", order: 8 },
  { id: 278, name: "8 · Proposta enviada", order: 9 },
  { id: 288, name: "9 · Stand by", order: 10 },
];
const NOVO = {
  290: "3 · Qualificação",
  277: "4 · Agendado - Levantamento com sócio",
  287: "5 · Realizado - Levantamento com sócio",
};
const DEPOIS = ANTES.map((s) => ({ ...s, name: NOVO[s.id] ?? s.name }));

test("Régua da Operação: os mesmos níveis com os nomes de 01/10 e de 09/10", () => {
  const antes = reguaDoPipe(ANTES);
  const depois = reguaDoPipe(DEPOIS);
  assert.deepEqual(depois.nivelDe, antes.nivelDe);
  assert.deepEqual([...depois.nivelDaEtapa], [...antes.nivelDaEtapa]);
  assert.deepEqual(depois.semNivel, []);
  assert.deepEqual(
    depois.niveis.map((n) => n.nome),
    [
      "Base elegível",
      "Abordagem iniciada",
      "Qualificação",
      "Agendado - Levantamento com sócio",
      "Realizado - Levantamento com sócio",
      "Reunião de proposta",
      "Em negociação",
      "Proposta enviada",
      "Ganho",
    ],
  );
  assert.deepEqual(depois.niveis[2].somadas, [{ id: 275, nome: "Gatilho" }]);
  assert.deepEqual(depois.niveis[4].somadas, [{ id: 288, nome: "Stand by" }]);
});

// Carga do CRM: o mesmo histórico dá os mesmos eventos com os nomes de antes e de depois.
const change = (old, newValue, at, actor = 20) => ({
  object: "dealChange",
  data: {
    field_key: "stage_id",
    old_value: old,
    new_value: newValue,
    log_time: at,
    user_id: actor,
  },
});
const raw = (over = {}) => ({
  id: 900,
  title: "Empresa sintética",
  org_id: { value: 10, name: "Empresa sintética" },
  user_id: { id: 20, name: "Hunter" },
  creator_user_id: { id: 20 },
  stage_id: 279,
  status: "open",
  pipeline_id: 39,
  add_time: "2026-10-01 12:00:00",
  update_time: "2026-10-09 15:00:00",
  ...over,
});
const paraCarga = (st) => st.map(({ id, name, order }) => ({ id, name, order_nr: order }));

test("Carga do CRM: agendada, realizada, Stand by e validação iguais com os nomes novos", () => {
  const fluxos = {
    900: [
      change(274, 276, "2026-10-05 12:00:00"),
      change(276, 290, "2026-10-06 12:00:00"),
      change(290, 277, "2026-10-06 15:00:00"),
      change(277, 287, "2026-10-07 12:00:00"),
      change(287, 291, "2026-10-08 12:00:00"),
      change(291, 279, "2026-10-09 12:00:00"),
    ],
    901: [change(274, 276, "2026-10-05 12:00:00"), change(276, 288, "2026-10-06 12:00:00")],
  };
  const deals = [raw(), raw({ id: 901, stage_id: 288 })];
  const eventos = (st) =>
    summarize(deals, paraCarga(st), fluxos, "2026-10").cards.map((c) =>
      Object.fromEntries(Object.entries(c.events).map(([k, es]) => [k, es.map((e) => e.date)])),
    );
  const antes = eventos(ANTES);
  const depois = eventos(DEPOIS);
  assert.deepEqual(depois, antes);
  assert.deepEqual(depois[0].scheduled, ["2026-10-06"]);
  assert.deepEqual(depois[0].meeting, ["2026-10-07"]);
  assert.deepEqual(depois[0].validated, ["2026-10-09"]);
  // Stand by sem reunião antes conta como reunião realizada, e não valida.
  assert.deepEqual(depois[1].meeting, ["2026-10-06"]);
  assert.deepEqual(depois[1].validated, []);
});

test("Carga do CRM recusa o pipe sem etapa de reunião realizada nem negociação", () => {
  const semRealizada = DEPOIS.filter((s) => s.id !== 287);
  assert.throws(
    () => summarize([raw()], paraCarga(semRealizada), {}, "2026-10"),
    /Etapas de reunião e negociação/,
  );
});

// Funil cumulativo e Gravações sobre o mesmo card, com os nomes de antes e de depois.
const M = 28381245;
const dataSp = (at) => new Date(Date.parse(at) - 3 * 3600_000).toISOString().slice(0, 10);
const mv = (stage_id, at) => ({ stage_id, at, date: dataSp(at), actor_id: M });
const card = (stage, moves, over = {}) => ({
  id: 1,
  title: "Card 1",
  route: "cella",
  status: "open",
  stage_id: moves.at(-1).stage_id,
  stage,
  owner_id: M,
  moves,
  events: {
    loaded: [],
    started: [{ at: moves[1].at, date: moves[1].date, actor_id: M, source: "stage_change" }],
    scheduled: [],
    meeting: [],
    validated: [],
    signed: [],
  },
  ...over,
});
const MOVES = [
  mv(274, "2026-10-01T12:00:00Z"),
  mv(276, "2026-10-02T12:00:00Z"),
  mv(290, "2026-10-05T12:00:00Z"),
  mv(277, "2026-10-06T12:00:00Z"),
];

test("Funil cumulativo conta igual com os nomes novos; Gravações vê o levantamento pendente", () => {
  const f = { from: "2026-10-01", to: "2026-10-09", owner: M, product: "" };
  const contagens = (st, nome) =>
    funilCumulativo([card(nome, MOVES)], st, f).linhas.map((l) => [l.chave, l.contagem]);
  assert.deepEqual(
    contagens(DEPOIS, NOVO[277]),
    contagens(ANTES, "4 · Reunião de levantamento agendada"),
  );
  const agendada = Object.fromEntries(contagens(DEPOIS, NOVO[277])).agendada;
  assert.equal(agendada, 1);
  // A etapa de hoje vem do payload do card: o nome antigo (carga velha) e o novo deixam o levantamento pendente.
  for (const [st, nome] of [
    [ANTES, "4 · Reunião de levantamento agendada"],
    [DEPOIS, NOVO[277]],
  ]) {
    const h = levantamentoDoHistorico(card(nome, MOVES), reguaDoPipe(st));
    assert.equal(h?.pendente, true, nome);
  }
  // Já realizado: não está pendente, nem com o nome novo.
  const realizado = card(NOVO[287], [...MOVES, mv(287, "2026-10-08T12:00:00Z")]);
  assert.equal(levantamentoDoHistorico(realizado, reguaDoPipe(DEPOIS))?.pendente, false);
});
