// Atalhos de período das telas da Monetização (22/10/2026): "Ontem" é o dia útil anterior e "Semana" começa na segunda.
import test from "node:test";
import assert from "node:assert/strict";
import { diaUtilAnterior, segundaDaSemana } from "../src/lib/monetizacao/feriados.ts";

test("Ontem: o dia útil anterior, pulando fim de semana e feriado", () => {
  assert.equal(diaUtilAnterior("2026-10-22"), "2026-10-21");
  assert.equal(diaUtilAnterior("2026-10-26"), "2026-10-23", "na segunda, a sexta");
  assert.equal(diaUtilAnterior("2026-10-13"), "2026-10-09", "na terça depois de 12/10, a sexta");
});

test("Semana: da segunda-feira até hoje", () => {
  assert.equal(segundaDaSemana("2026-10-22"), "2026-10-19");
  assert.equal(segundaDaSemana("2026-10-19"), "2026-10-19");
  assert.equal(segundaDaSemana("2026-10-25"), "2026-10-19", "o domingo fecha a semana que começou na segunda");
});
