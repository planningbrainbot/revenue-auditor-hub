import test from "node:test";
import assert from "node:assert/strict";
import { chaveMes, rotuloMes } from "../src/lib/rede/mes.ts";

test("chaveMes: date, aaaa-mm e timestamp sem fuso valem o mês escrito", () => {
  assert.equal(chaveMes("2026-01"), "2026-01");
  assert.equal(chaveMes("2026-01-15"), "2026-01");
  assert.equal(chaveMes("2026-03-10T12:00:00"), "2026-03");
});

test("chaveMes: date_trunc das views (sessão UTC ou São Paulo) fica no mês truncado", () => {
  assert.equal(chaveMes("2026-01-01T00:00:00+00:00"), "2026-01");
  assert.equal(chaveMes("2026-01-01 03:00:00+00"), "2026-01");
  assert.equal(chaveMes("2026-12-01 00:00:00+00"), "2026-12");
  assert.equal(chaveMes("2026-01-01T00:00:00.000-03:00"), "2026-01");
});

test("chaveMes: outro instante com fuso vai para o mês de São Paulo", () => {
  assert.equal(chaveMes("2026-02-01T01:00:00+00:00"), "2026-01");
  assert.equal(chaveMes("2026-02-01T03:00:00Z"), "2026-02");
  assert.equal(chaveMes(new Date("2026-05-01T00:00:00Z")), "2026-05");
  assert.equal(chaveMes(new Date("2026-05-01T02:00:00Z")), "2026-04");
});

test("chaveMes: ausente ou ilegível é null", () => {
  assert.equal(chaveMes("2026-13"), null);
  assert.equal(chaveMes(""), null);
  assert.equal(chaveMes(null), null);
  assert.equal(chaveMes("xx"), null);
});

test("rotuloMes monta mmm/aa a partir da string", () => {
  assert.equal(rotuloMes("2026-01"), "jan/26");
  assert.equal(rotuloMes("2025-12"), "dez/25");
  assert.equal(rotuloMes("lixo"), "lixo");
});
