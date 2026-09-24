import test from "node:test";
import assert from "node:assert/strict";
import { chaveMes, mesCorrente, mesesEntre, rotuloMes, somarMeses } from "../src/lib/rede/mes.ts";
import { listaTrimestres } from "../src/lib/rede/trimestre.ts";

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

test("somarMeses e mesesEntre fazem a conta sobre a chave, sem Date", () => {
  assert.equal(somarMeses("2026-01", -1), "2025-12");
  assert.equal(somarMeses("2026-09", -11), "2025-10");
  assert.equal(somarMeses("2025-12", 1), "2026-01");
  assert.equal(mesesEntre("2024-07", "2026-01"), 18);
  assert.equal(mesesEntre("2026-03", "2026-01"), -2);
  assert.ok(Number.isNaN(mesesEntre("", "2026-01")));
});

test("mesCorrente devolve aaaa-mm", () => {
  assert.match(mesCorrente(), /^\d{4}-(0[1-9]|1[0-2])$/);
});

test("listaTrimestres: fim exclusivo (IDU) e inclusivo (Indicadores)", () => {
  const hoje = new Date(2026, 8, 24); // 24/09/2026
  const exc = listaTrimestres({ fim: "exclusivo", hoje });
  const inc = listaTrimestres({ fim: "inclusivo", hoje });
  assert.equal(exc.length, 8);
  assert.deepEqual(exc[0], { key: "2026-T3", label: "T3/2026 · jul–set", ini: "2026-07-01", fim: "2026-10-01" });
  assert.deepEqual(inc[0], { key: "2026-T3", label: "T3/2026 · jul–set", ini: "2026-07-01", fim: "2026-09-30" });
  assert.equal(exc[3].key, "2025-T4");
  assert.equal(exc[3].fim, "2026-01-01");
  assert.equal(inc[3].fim, "2025-12-31");
  assert.equal(inc[7].key, "2024-T4");
});
