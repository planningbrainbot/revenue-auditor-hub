// Área Tarefas: prazo no dia de São Paulo, cartões do topo, ordem e filtros
// (src/lib/tarefas/regras.ts, contrato docs/design/contratos/tarefas.md).
import test from "node:test";
import assert from "node:assert/strict";
import {
  contar,
  domingoDaSemana,
  filtrar,
  hojeSaoPaulo,
  lerBuscaTarefas,
  ordemEntre,
  ordenarPorPrazo,
  situacaoDoPrazo,
} from "../src/lib/tarefas/regras.ts";

const Q = "11111111-1111-1111-1111-111111111111";
const EU = "22222222-2222-2222-2222-222222222222";
const OUTRO = "33333333-3333-3333-3333-333333333333";
const t = (id, extra = {}) => ({
  id,
  titulo: id,
  descricao: null,
  prazo: null,
  prioridade: "media",
  concluida: false,
  responsavelId: EU,
  projetoId: null,
  departamentoId: null,
  quadroId: Q,
  ...extra,
});

test("hoje é o dia de São Paulo, não o de UTC", () => {
  // 02h UTC de 23/10 ainda é 22/10 em São Paulo.
  assert.equal(hojeSaoPaulo(new Date("2026-10-23T02:00:00Z")), "2026-10-22");
});

test("a semana vai até domingo", () => {
  assert.equal(domingoDaSemana("2026-10-22"), "2026-10-25"); // quinta
  assert.equal(domingoDaSemana("2026-10-25"), "2026-10-25"); // domingo
  assert.equal(domingoDaSemana("2026-10-26"), "2026-11-01"); // segunda
});

test("vencer hoje não é estar atrasada", () => {
  assert.equal(situacaoDoPrazo("2026-10-22", "2026-10-22"), "semana");
  assert.equal(situacaoDoPrazo("2026-10-21", "2026-10-22"), "atrasada");
  assert.equal(situacaoDoPrazo("2026-10-26", "2026-10-22"), "futura");
  assert.equal(situacaoDoPrazo(null, "2026-10-22"), "sem");
});

test("cartões contam só abertas", () => {
  const lista = [
    t("a", { prazo: "2026-10-01" }),
    t("b", { prazo: "2026-10-01", concluida: true }),
    t("c", { prazo: "2026-10-24" }),
    t("d"),
    t("e", { prazo: "2026-12-01" }),
  ];
  assert.deepEqual(contar(lista, "2026-10-22"), { abertas: 4, atrasadas: 1, semana: 1, semPrazo: 1 });
});

test("o filtro de prazo devolve exatamente o que o cartão contou", () => {
  const lista = [t("a", { prazo: "2026-10-01" }), t("b", { prazo: "2026-10-01", concluida: true }), t("c")];
  const ctx = { hoje: "2026-10-22", eu: EU, usarStatus: true };
  assert.deepEqual(
    filtrar(lista, { prazo: "atrasadas", status: "todas" }, ctx).map((x) => x.id),
    ["a"],
  );
});

test("ordem: prazo mais cedo, sem prazo por último, empate por prioridade", () => {
  const lista = [
    t("sem"),
    t("baixa", { prazo: "2026-10-20", prioridade: "baixa" }),
    t("alta", { prazo: "2026-10-20", prioridade: "alta" }),
    t("depois", { prazo: "2026-11-01" }),
  ];
  assert.deepEqual(
    ordenarPorPrazo(lista).map((x) => x.id),
    ["alta", "baixa", "depois", "sem"],
  );
});

test("filtros de responsável e status", () => {
  const lista = [t("minha"), t("dele", { responsavelId: OUTRO }), t("ninguem", { responsavelId: null }), t("feita", { concluida: true })];
  const ctx = { hoje: "2026-10-22", eu: EU, usarStatus: true };
  assert.deepEqual(filtrar(lista, { responsavel: "eu" }, ctx).map((x) => x.id), ["minha"]);
  assert.deepEqual(filtrar(lista, { responsavel: "ninguem" }, ctx).map((x) => x.id), ["ninguem"]);
  assert.deepEqual(filtrar(lista, { status: "concluidas" }, ctx).map((x) => x.id), ["feita"]);
  // No quadro o status não filtra: as colunas mostram tudo.
  assert.equal(filtrar(lista, {}, { ...ctx, usarStatus: false }).length, 4);
});

test("a URL só aceita valores conhecidos", () => {
  assert.deepEqual(lerBuscaTarefas({ prioridade: "urgente", prazo: "ontem", quadro: "x", responsavel: "eu" }), {
    quadro: undefined,
    responsavel: "eu",
    prioridade: undefined,
    projeto: undefined,
    departamento: undefined,
    prazo: undefined,
    status: undefined,
    busca: undefined,
    tarefa: undefined,
  });
});

test("ordem entre vizinhos", () => {
  assert.equal(ordemEntre(null, null), 1000);
  assert.equal(ordemEntre(1000, 2000), 1500);
  assert.equal(ordemEntre(null, 1000), 0);
  assert.equal(ordemEntre(1000, null), 2000);
});
