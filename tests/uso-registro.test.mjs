// Uso do Brain (PRD 2026-10-ops-uso-do-brain, R-01): minuto conta só com a aba
// visível e interação no último minuto.
import test from "node:test";
import assert from "node:assert/strict";
import { JANELA_ATIVA_MS, minutoAtivo } from "../src/lib/uso-regra.ts";

test("aba visível com interação recente conta", () => {
  assert.equal(minutoAtivo(100_000, 100_000 - 30_000, true), true);
});

test("aba oculta não conta, mesmo com interação", () => {
  assert.equal(minutoAtivo(100_000, 100_000, false), false);
});

test("sem interação há um minuto ou mais não conta", () => {
  assert.equal(minutoAtivo(200_000, 200_000 - JANELA_ATIVA_MS, true), false);
});
