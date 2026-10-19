// Forecast da Monetização (14/10/2026): horizonte pela data esperada e receita pelo valor do card ou ticket medido.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filaDoDia,
  fimDaSemana,
  forecastDeFechamento,
  normalizarFila,
  horizonteDe,
  ticketsMedidos,
} from "../src/lib/monetizacao/fechamentos.ts";

const ST = [
  { id: 274, name: "1 · Base elegível", order: 1 },
  { id: 276, name: "2 · Abordagem iniciada", order: 2 },
  { id: 290, name: "3 · Qualificação", order: 3 },
  { id: 277, name: "4 · Agendado - Levantamento com sócio", order: 5 },
  { id: 287, name: "5 · Realizado - Levantamento com sócio", order: 6 },
  { id: 291, name: "6 · Reunião de proposta", order: 7 },
  { id: 279, name: "7 · Em negociação", order: 8 },
  { id: 278, name: "8 · Proposta enviada", order: 9 },
  { id: 288, name: "9 · Stand by", order: 10 },
];
let n = 1;
const receita = (v) => ({
  total: { amount: v, currency: "BRL" },
  partners: { amount: null },
  unit: { amount: null },
  sum: null,
});
const card = (o = {}) => ({
  id: n++,
  title: "Card",
  route: "cella",
  status: "open",
  owner_id: 28381245,
  stage_id: 278,
  expected_close: null,
  revenue: receita(null),
  events: { signed: [] },
  ...o,
});
const HOJE = "2026-10-14"; // quarta
const TODOS = { owner: null, product: "" };

test("Horizonte pela data esperada; a semana vai até domingo", () => {
  assert.equal(fimDaSemana("2026-10-14"), "2026-10-18");
  assert.equal(fimDaSemana("2026-10-18"), "2026-10-18");
  assert.equal(horizonteDe(null, HOJE), "semData");
  assert.equal(horizonteDe("2026-10-10", HOJE), "atrasado");
  assert.equal(horizonteDe("2026-10-14", HOJE), "hoje");
  assert.equal(horizonteDe("2026-10-18", HOJE), "semana");
  assert.equal(horizonteDe("2026-10-31", HOJE), "mes");
  assert.equal(horizonteDe("2026-11-03", HOJE), "depois");
});

test("Ticket medido só com contrato ganho com valor; sem ele, o produto fica sem ticket", () => {
  const cards = [
    card({ status: "won", route: "cella", revenue: receita(10000) }),
    card({ status: "won", route: "cella", revenue: receita(30000) }),
    card({ status: "won", route: "finance", revenue: receita(null) }),
  ];
  const t = Object.fromEntries(ticketsMedidos(cards).map((x) => [x.produto, x]));
  assert.equal(t.cella.valor, 20000);
  assert.equal(t.cella.contratos, 2);
  assert.equal(t.finance.valor, null);
});

test("Universo da Reunião de proposta em diante, sem Stand by; valor do card antes do ticket", () => {
  const cards = [
    card({ status: "won", route: "cella", revenue: receita(20000), won_on: "2026-10-05" }),
    card({ stage_id: 291, expected_close: "2026-10-16", revenue: receita(50000) }), // semana, valor do card
    card({ stage_id: 279, expected_close: "2026-10-31" }), // mês, ticket da Cella
    card({ stage_id: 278, route: "finance", expected_close: "2026-10-10" }), // atrasado, sem ticket
    card({ stage_id: 278 }), // sem data
    card({ stage_id: 288, expected_close: "2026-10-15" }), // Stand by fica fora
    card({ stage_id: 287, expected_close: "2026-10-15" }), // Realizado fica fora
  ];
  const fc = forecastDeFechamento(cards, ST, HOJE, TODOS);
  const g = Object.fromEntries(fc.grupos.map((x) => [x.chave, x]));
  assert.equal(fc.total, 4);
  assert.equal(g.semana.itens.length, 1);
  assert.equal(g.semana.valor, 50000);
  assert.equal(g.mes.valor, 20000);
  assert.equal(g.atrasado.semValor, 1);
  assert.equal(g.semData.itens.length, 1);
  const cella = fc.receita.find((l) => l.produto === "cella");
  assert.equal(cella.receitaGanha, 20000);
  assert.equal(cella.esperados.length, 2); // semana e mês; sem data fica fora do mês
  assert.equal(cella.receitaEsperada, 70000);
  const finance = fc.receita.find((l) => l.produto === "finance");
  assert.equal(finance.esperados.length, 1); // atrasado ainda pode fechar no mês
  assert.equal(finance.esperadosSemValor, 1);
});

test("Sem data esperada, vale a previsão do Jev; com data, a data manda (15/10/2026)", () => {
  const comData = card({ stage_id: 278, expected_close: "2026-10-31" });
  const semData = card({ stage_id: 278 });
  const semNada = card({ stage_id: 279 });
  const prev = [
    { deal_id: comData.id, horizonte: "esta_semana", confianca: 0.9 },
    { deal_id: semData.id, horizonte: "esta_semana", confianca: 0.7 },
    { deal_id: semNada.id, horizonte: "sem_previsao", confianca: 0.8 },
  ];
  const fc = forecastDeFechamento([comData, semData, semNada], ST, HOJE, TODOS, prev);
  const g = Object.fromEntries(fc.grupos.map((x) => [x.chave, x]));
  assert.deepEqual(
    g.mes.itens.map((i) => i.card.id),
    [comData.id],
  );
  assert.deepEqual(
    g.semana.itens.map((i) => i.card.id),
    [semData.id],
  );
  assert.equal(g.semana.estimados, 1);
  assert.equal(g.semData.itens.length, 1);
  assert.equal(g.semData.estimados, 0);
});

// ---------------------------------------------------------------------------- fila do dia (19/10/2026)

test("Fila do dia: números pelo Jev, pelo horizonte e pelo card; grupos pelo passo, o mais urgente primeiro", () => {
  const c1 = card({ id: 501, stage_id: 291 }); // hoje, ligar
  const c2 = card({
    id: 502,
    stage_id: 278,
    expected_close: "2026-10-30",
    revenue: receita(40000),
  }); // mês, com valor
  const c3 = card({ id: 503, stage_id: 279 }); // semana, cobrar, na Consultoria
  const c4 = card({ id: 504, stage_id: 278 }); // sem sugestão
  const c5 = card({ id: 505, stage_id: 288 }); // Stand by: fora do universo
  const c6 = card({ id: 506, stage_id: 278 }); // hoje, cobrar, confiança menor
  const fila = normalizarFila([
    {
      deal_id: 501,
      passo: "ligar_hoje",
      urgencia: 2,
      confianca: 0.9,
      nota: "cliente sumiu",
      nota_em: "2026-10-15T14:00:00Z",
    },
    {
      deal_id: 503,
      passo: "cobrar_retorno",
      urgencia: 1,
      confianca: "0.5",
      consultoria: "Já é cliente da Consultoria; não oferecer Consultoria",
    },
    { deal_id: 506, passo: "cobrar_retorno", urgencia: 2, confianca: 0.3 },
    { deal_id: 505, passo: "ligar_hoje", urgencia: 2 },
    { deal_id: 507, passo: "inventado", urgencia: 2 },
  ]);
  assert.equal(
    fila.find((l) => l.deal_id === 507).passo,
    null,
    "passo fora das opções vira sem sugestão",
  );
  const fc = forecastDeFechamento([c1, c2, c3, c4, c5, c6], ST, HOJE, TODOS, [
    { deal_id: 503, horizonte: "esta_semana", confianca: 0.7 },
  ]);
  const hoje = filaDoDia(fc, fila);
  assert.deepEqual(hoje.contagem, { hoje: 2, semana: 1, mes: 2, semdata: 4, consultoria: 1 });
  assert.equal(hoje.total, 5);
  assert.deepEqual(
    hoje.grupos.map((g) => [g.passo, g.linhas.map((l) => l.item.card.id)]),
    [
      ["ligar_hoje", [501]],
      ["cobrar_retorno", [506]],
    ],
  );
  assert.equal(hoje.grupos[0].rotulo, "Ligar e retomar");
  // "Fecha no mês": data no mês (502) e a semana pela previsão do Jev (503).
  assert.deepEqual(
    filaDoDia(fc, fila, "mes")
      .grupos.flatMap((g) => g.linhas.map((l) => l.item.card.id))
      .sort(),
    [502, 503],
  );
  // Sem data nem valor: o card com data e valor (502) fica fora; o sem sugestão vai para o fim.
  const semdata = filaDoDia(fc, fila, "semdata");
  assert.equal(semdata.filtradas, 4);
  assert.equal(semdata.grupos.at(-1).passo, null);
  assert.equal(semdata.grupos.at(-1).rotulo, "Sem sugestão do Jev");
});

test("Fila do dia sem a leitura do Jev: os cards seguem, sem passo, e a tela sabe", () => {
  const fc = forecastDeFechamento([card({ id: 601, stage_id: 278 })], ST, HOJE, TODOS);
  const d = filaDoDia(fc, null, "semdata");
  assert.equal(d.semJev, true);
  assert.equal(d.contagem.hoje, 0);
  assert.equal(d.grupos[0].passo, null);
});
