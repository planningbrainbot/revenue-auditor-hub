// Visão Hoje da Pré-venda (14/10/2026): o que cada pré-vendedor faz hoje, para a daily.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hojeDaPreVenda,
  normalizarCadencias,
  proximoDiaUtil,
} from "../src/lib/monetizacao/hoje-pre-venda.ts";

const M = 28381245,
  H = 28897937;
const ST = [
  { id: 274, name: "1 · Base elegível", order: 1 },
  { id: 276, name: "2 · Abordagem iniciada", order: 2 },
  { id: 290, name: "3 · Qualificação", order: 3 },
  { id: 275, name: "Gatilho (encerrada em 01/10 · não usar)", order: 4 },
  { id: 277, name: "4 · Agendado - Levantamento com sócio", order: 5 },
  { id: 287, name: "5 · Realizado - Levantamento com sócio", order: 6 },
  { id: 291, name: "6 · Reunião de proposta", order: 7 },
  { id: 279, name: "7 · Em negociação", order: 8 },
  { id: 278, name: "8 · Proposta enviada", order: 9 },
  { id: 288, name: "9 · Stand by", order: 10 },
];
let n = 1;
const card = (o = {}) => ({
  id: n++,
  title: "Card",
  route: "finance",
  status: "open",
  owner_id: M,
  stage_id: 274,
  moves: [],
  events: { loaded: [], started: [], scheduled: [], meeting: [], validated: [], signed: [] },
  next_activity: null,
  expected_close: null,
  ...o,
});
const HOJE = "2026-10-14";

test("Reta final: a atividade vencida conta como sem próximo passo, separada na nota; atividade manual sai de sem cadência", () => {
  const vencida = card({ stage_id: 279, next_activity: "2026-10-10" });
  const semNada = card({ stage_id: 278 });
  const manual = card({ stage_id: 276, next_activity: "2026-10-16" });
  const semCadencia = card({ stage_id: 276 });
  const [m] = hojeDaPreVenda({
    cards: [vencida, semNada, manual, semCadencia],
    stages: ST,
    units: [],
    atividades: [],
    hoje: HOJE,
    pessoa: M,
  });
  const b = (k) => m.blocos.find((x) => x.chave === k);
  assert.deepEqual(
    b("reta")
      .cards.map((c) => c.id)
      .sort(),
    [vencida.id, semNada.id].sort(),
  );
  assert.match(b("reta").nota, /^1 sem atividade · 1 com atividade vencida, de 2 cards/);
  assert.deepEqual(
    b("semCadencia").cards.map((c) => c.id),
    [semCadencia.id],
  );
  assert.match(b("semCadencia").nota, /1 com atividade manual, fora da conta/);
});

test("Próximo dia útil pula fim de semana e feriado", () => {
  assert.equal(proximoDiaUtil("2026-10-14"), "2026-10-15");
  assert.equal(proximoDiaUtil("2026-10-16"), "2026-10-19");
  assert.equal(proximoDiaUtil("2026-10-30"), "2026-11-03"); // 02/11, Finados
});

test("Blocos por pessoa: cadência, vencidas, reta final, data esperada, sem cadência e fila", () => {
  const abordagemComCadencia = card({ stage_id: 276 });
  const abordagemSemCadencia = card({ stage_id: 276 });
  const retaSemProximo = card({ stage_id: 278, expected_close: null });
  const retaComProximo = card({
    stage_id: 279,
    next_activity: "2026-10-16",
    expected_close: "2026-10-30",
  });
  const standBy = card({ stage_id: 288 });
  const fila = Array.from({ length: 9 }, () => card({ stage_id: 274 }));
  const daHeloa = card({ stage_id: 276, owner_id: H });
  const cards = [
    abordagemComCadencia,
    abordagemSemCadencia,
    retaSemProximo,
    retaComProximo,
    standBy,
    ...fila,
    daHeloa,
  ];
  const atividades = normalizarCadencias([
    // hoje 12:00 UTC = 9h em São Paulo, aberta; outra hoje, feita
    { deal_id: abordagemComCadencia.id, user_id: M, vence: "2026-10-14T12:00:00Z", feita: false },
    { deal_id: abordagemComCadencia.id, user_id: M, vence: "2026-10-14T17:00:00Z", feita: true },
    // ontem, não feita: vencida
    { deal_id: abordagemComCadencia.id, user_id: M, vence: "2026-10-13T17:00:00Z", feita: false },
    // amanhã
    { deal_id: abordagemComCadencia.id, user_id: M, vence: "2026-10-15T12:00:00Z", feita: false },
    // 01h UTC de 15/10 ainda é 14/10 em São Paulo
    { deal_id: daHeloa.id, user_id: H, vence: "2026-10-15T01:00:00Z", feita: false },
  ]);
  const [m, h] = hojeDaPreVenda({ cards, stages: ST, units: [], atividades, hoje: HOJE });
  const b = (p, k) => p.blocos.find((x) => x.chave === k);
  assert.equal(m.nome, "Matheus Carvalho");
  assert.equal(b(m, "cadencia").valor, 1);
  assert.match(b(m, "cadencia").nota, /1 feita/);
  assert.equal(b(m, "vencidas").valor, 1);
  assert.equal(b(m, "vencidas").tom, "perigo");
  // reta final: Proposta enviada sem próxima, Negociação com próxima, Stand by sem próxima
  assert.deepEqual(
    b(m, "reta")
      .cards.map((c) => c.id)
      .sort(),
    [retaSemProximo.id, standBy.id].sort(),
  );
  // data esperada: Proposta enviada sem data; Negociação tem data; Stand by fica fora
  assert.deepEqual(
    b(m, "semData").cards.map((c) => c.id),
    [retaSemProximo.id],
  );
  assert.deepEqual(
    b(m, "semCadencia").cards.map((c) => c.id),
    [abordagemSemCadencia.id],
  );
  assert.equal(b(m, "fila").valor, 9);
  assert.match(b(m, "fila").nota, /2 dias úteis a 8 por dia/);
  assert.equal(b(m, "amanha").valor, 1);
  assert.equal(b(m, "amanha").rotulo, "Cadência de 15/10");
  // Heloá: a atividade das 22h de 14/10 (São Paulo) é de hoje
  assert.equal(b(h, "cadencia").valor, 1);
  assert.equal(b(h, "semCadencia").valor, 0);
  // filtro de pessoa
  assert.deepEqual(
    hojeDaPreVenda({ cards, stages: ST, units: [], atividades, hoje: HOJE, pessoa: H }).map(
      (p) => p.id,
    ),
    [H],
  );
});
