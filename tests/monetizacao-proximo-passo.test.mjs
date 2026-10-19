// Próximo passo sugerido pelo Jev (14/10/2026): quem é avaliado, o que o Jev lê e como a resposta é aceita.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  baseDoCard,
  elegivel,
  lerResposta,
  notasParaJev,
  pedidoJev,
  precisaAvaliar,
  rodarProximoPasso,
  VERSAO,
  elegivelPrevisao,
  lerPrevisao,
  VERSAO_PREVISAO,
  ultimaNotaDoDono,
} from "../supabase/functions/monetizacao-proximo-passo/logica.ts";

const ETAPAS = [
  { id: 274, name: "1 · Base elegível", order: 1 },
  { id: 276, name: "2 · Abordagem iniciada", order: 2 },
  { id: 290, name: "3 · Qualificação", order: 3 },
  { id: 277, name: "4 · Agendado - Levantamento com sócio", order: 5 },
  { id: 287, name: "5 · Realizado - Levantamento com sócio", order: 6 },
  { id: 278, name: "8 · Proposta enviada", order: 9 },
  { id: 288, name: "9 · Stand by", order: 10 },
];
const M = 28381245;
const AGORA = new Date("2026-10-14T20:00:00Z");
const card = (o = {}) => ({
  id: 1,
  status: "open",
  stage_id: 278,
  owner_id: M,
  route: "cella",
  next_activity: null,
  last_activity_date: "2026-10-01",
  expected_close: null,
  updated_at: "2026-10-10 10:00:00",
  moves: [{ stage_id: 278, at: "2026-10-04 12:00:00" }],
  ...o,
});

test("Elegível: aberto, do Agendado em diante, sem atividade futura", () => {
  assert.ok(elegivel(card(), ETAPAS, 5, "2026-10-14"));
  assert.ok(
    elegivel(card({ stage_id: 288, next_activity: "2026-10-05" }), ETAPAS, 5, "2026-10-14"),
  );
  assert.ok(!elegivel(card({ next_activity: "2026-10-16" }), ETAPAS, 5, "2026-10-14"));
  assert.ok(!elegivel(card({ stage_id: 290 }), ETAPAS, 5, "2026-10-14"));
  assert.ok(!elegivel(card({ status: "lost" }), ETAPAS, 5, "2026-10-14"));
});

test("O Jev lê só as notas do dono, sem HTML, das novas para as velhas e com teto", () => {
  const notas = [
    { user_id: M, add_time: "2026-10-01 10:00:00", content: "<p>Mandei a <b>minuta</b></p>" },
    {
      user_id: 23984402,
      add_time: "2026-10-09 10:00:00",
      content: "Preparação comercial [PB:candidatos]",
    },
    {
      user_id: M,
      add_time: "2026-10-08 10:00:00",
      content: "Cliente pediu para retomar em novembro",
    },
  ];
  const t = notasParaJev(notas, M);
  assert.match(t, /^\[2026-10-08\] Cliente pediu/);
  assert.match(t, /\[2026-10-01\] Mandei a minuta/);
  assert.doesNotMatch(t, /Preparação comercial/);
  assert.equal(notasParaJev([], M), "sem notas do responsável");
  assert.ok(
    notasParaJev([{ user_id: M, add_time: "2026-10-01", content: "x".repeat(9000) }], M).length <=
      3000,
  );
});

test("Pedido ao Jev: estado com dias parado e próxima atividade; seis passos e três urgências", () => {
  const p = pedidoJev(
    card({ next_activity: "2026-10-05" }),
    "8 · Proposta enviada",
    "sem notas do responsável",
    AGORA,
  );
  assert.equal(p.model, "typesafe/jev-1.13");
  assert.equal(p.state.dias_na_etapa, "10");
  assert.equal(p.state.proxima_atividade, "atrasada desde 2026-10-05");
  assert.equal(Object.keys(p.questions.passo.criteria).length, 6);
  assert.equal(p.questions.urgencia.criteria.length, 3);
});

test("Resposta fora das opções é erro, nunca palpite", () => {
  // O score vem como valor esperado da escala (1,7 entre 0 e 2): o nível é o mais próximo.
  const ok = lerResposta({
    answers: { passo: { choice: "cobrar_retorno", confidence: 0.8 }, urgencia: { score: 1.7 } },
    usage: { cost: 0.00003 },
  });
  assert.deepEqual(ok, {
    passo: "cobrar_retorno",
    confianca: 0.8,
    urgencia: 2,
    custo_usd: 0.00003,
  });
  assert.throws(() =>
    lerResposta({ answers: { passo: { choice: "inventado" }, urgencia: { score: 1 } } }),
  );
  assert.throws(() =>
    lerResposta({ answers: { passo: { choice: "ligar_hoje" }, urgencia: { score: 2.4 } } }),
  );
});

test("Reavalia quando o card muda, quando a versão muda ou depois de 20 horas", () => {
  const c = card();
  const igual = { base: baseDoCard(c), gerado_em: "2026-10-14T19:00:00Z", versao: VERSAO };
  assert.equal(precisaAvaliar(c, igual, AGORA), false);
  assert.equal(precisaAvaliar(c, { ...igual, base: "outra" }, AGORA), true);
  assert.equal(precisaAvaliar(c, { ...igual, versao: "v0" }, AGORA), true);
  assert.equal(precisaAvaliar(c, { ...igual, gerado_em: "2026-10-13T20:00:00Z" }, AGORA), true);
  assert.equal(precisaAvaliar(c, undefined, AGORA), true);
});

test("Rodada: desligada não chama o Jev nem grava; ligada grava a sugestão", async () => {
  const chamadas = [],
    gravadas = [];
  const deps = (ativo) => ({
    cards: async () => [
      card({ id: 1 }),
      card({ id: 2, next_activity: "2026-10-20" }),
      card({ id: 3, stage_id: 290 }),
    ],
    etapas: async () => ETAPAS,
    anteriores: async () => new Map(),
    notas: async () => [],
    jev: async (p) => (
      chamadas.push(p),
      {
        answers: { passo: { choice: "cobrar_retorno", confidence: 0.9 }, urgencia: { score: 1 } },
        usage: { cost: 0.00003 },
      }
    ),
    gravar: async (l) => void gravadas.push(l),
    agora: AGORA,
    ativo,
    limite: 40,
    orcamentoMs: 60_000,
  });
  const seco = await rodarProximoPasso(deps(false));
  assert.equal(seco.elegiveis, 1);
  assert.equal(chamadas.length, 0);
  assert.equal(gravadas.length, 0);
  const r = await rodarProximoPasso(deps(true));
  assert.equal(r.avaliados, 1);
  assert.equal(gravadas[0].deal_id, 1);
  assert.equal(gravadas[0].passo, "cobrar_retorno");
  assert.equal(gravadas[0].versao, VERSAO);
});

const ETAPAS_P = [...ETAPAS, { id: 291, name: "6 · Reunião de proposta", order: 7 }];

test("Previsão do Jev: só cards da Reunião de proposta em diante, sem Stand by e sem data esperada", () => {
  assert.ok(elegivelPrevisao(card(), ETAPAS_P, 7));
  assert.ok(!elegivelPrevisao(card({ expected_close: "2026-10-20" }), ETAPAS_P, 7));
  assert.ok(!elegivelPrevisao(card({ stage_id: 288 }), ETAPAS_P, 7));
  assert.ok(!elegivelPrevisao(card({ stage_id: 287 }), ETAPAS_P, 7));
  assert.deepEqual(
    lerPrevisao({
      answers: { fechamento: { choice: "este_mes", confidence: 0.6 } },
      usage: { cost: 0.00002 },
    }),
    {
      horizonte: "este_mes",
      confianca: 0.6,
      custo_usd: 0.00002,
    },
  );
  assert.throws(() => lerPrevisao({ answers: { fechamento: { choice: "ontem" } } }));
});

test("Rodada grava a previsão quando recebe onde gravar, e lê as notas do card uma vez só", async () => {
  let leituras = 0;
  const previsoes = [];
  const r = await rodarProximoPasso({
    cards: async () => [card({ id: 1 })],
    etapas: async () => ETAPAS_P,
    anteriores: async () => new Map(),
    notas: async () => (leituras++, []),
    jev: async (p) =>
      p.questions.fechamento
        ? {
            answers: { fechamento: { choice: "este_mes", confidence: 0.7 } },
            usage: { cost: 0.00002 },
          }
        : {
            answers: {
              passo: { choice: "cobrar_retorno", confidence: 0.9 },
              urgencia: { score: 1 },
            },
            usage: { cost: 0.00003 },
          },
    gravar: async () => {},
    anterioresPrevisao: async () => new Map(),
    gravarPrevisao: async (l) => void previsoes.push(l),
    agora: AGORA,
    ativo: true,
    limite: 40,
    orcamentoMs: 60_000,
  });
  assert.equal(r.previsao.avaliados, 1);
  assert.equal(previsoes[0].horizonte, "este_mes");
  assert.equal(previsoes[0].versao, VERSAO_PREVISAO);
  assert.equal(leituras, 1);
});

// ---------------------------------------------------------------------------- fila do Forecast (19/10/2026)

test("Última nota do dono: a mais nova com texto, sem HTML, com o instante; nota de outro usuário fica fora", () => {
  const notas = [
    {
      user_id: 23984402,
      add_time: "2026-10-18 10:00:00",
      content: "<h2>Preparação comercial</h2>[PB:x:dossier]",
    },
    {
      user_id: M,
      add_time: "2026-10-15 14:30:00",
      content: "<p>Feito follow,</p><p>cliente pediu   retorno</p>",
    },
    { user_id: M, add_time: "2026-10-16 09:00:00", content: "<p> </p>" },
    { user_id: M, add_time: "2026-10-01 09:00:00", content: "antiga" },
  ];
  assert.deepEqual(ultimaNotaDoDono(notas, M), {
    nota: "Feito follow, cliente pediu retorno",
    nota_em: "2026-10-15T14:30:00.000Z",
  });
  assert.equal(ultimaNotaDoDono(notas, 999), null);
  assert.equal(ultimaNotaDoDono([], M), null);
});

test("Rodada grava a última nota de toda a reta final (Stand by entra), sem chamar o Jev a mais", async () => {
  const gravadas = [];
  let chamadasJev = 0;
  const cards = [
    card({ id: 1, next_activity: "2026-10-20" }), // tem próxima atividade: o Jev não avalia, a nota entra
    card({ id: 2, stage_id: 288 }),
    card({ id: 3, stage_id: 287, next_activity: "2026-10-21" }), // antes da proposta: fora da fila
  ];
  const r = await rodarProximoPasso({
    cards: async () => cards,
    etapas: async () => ETAPAS_P,
    anteriores: async () =>
      new Map([
        [2, { base: baseDoCard(cards[1]), gerado_em: AGORA.toISOString(), versao: VERSAO }],
      ]),
    notas: async (deal) => [
      { user_id: M, add_time: "2026-10-1" + deal + " 10:00:00", content: "nota " + deal },
    ],
    jev: async () => (
      chamadasJev++,
      { answers: { passo: { choice: "cobrar_retorno", confidence: 0.9 }, urgencia: { score: 1 } } }
    ),
    gravar: async () => {},
    gravarNotas: async (l) => void gravadas.push(...l),
    agora: AGORA,
    ativo: true,
    limite: 40,
    orcamentoMs: 60_000,
  });
  assert.deepEqual(
    gravadas.map((g) => [g.deal_id, g.nota]),
    [
      [1, "nota 1"],
      [2, "nota 2"],
    ],
  );
  assert.equal(r.notas_fila.gravadas, 2);
  assert.equal(chamadasJev, 0, "card 1 tem próxima atividade e o 2 já foi avaliado");

  // Desligada (dry-run): lê, não grava.
  const seco = [];
  await rodarProximoPasso({
    cards: async () => cards,
    etapas: async () => ETAPAS_P,
    anteriores: async () => new Map(),
    notas: async () => [],
    jev: async () => ({}),
    gravar: async () => {},
    gravarNotas: async (l) => void seco.push(...l),
    agora: AGORA,
    ativo: false,
    limite: 40,
    orcamentoMs: 60_000,
  });
  assert.equal(seco.length, 0);
});
