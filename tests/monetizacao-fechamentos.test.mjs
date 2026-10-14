// Forecast da Monetização (14/10/2026): horizonte pela data esperada e receita pelo valor do card ou ticket medido.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fimDaSemana,
  forecastDeFechamento,
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
const receita = (v) => ({ total: { amount: v, currency: "BRL" }, partners: { amount: null }, unit: { amount: null }, sum: null });
const card = (o = {}) => ({
  id: n++, title: "Card", route: "cella", status: "open", owner_id: 28381245, stage_id: 278,
  expected_close: null, revenue: receita(null), events: { signed: [] }, ...o,
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
