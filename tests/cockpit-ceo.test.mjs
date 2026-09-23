import test from "node:test";
import assert from "node:assert/strict";
import {
  resolverPeriodo,
  periodoAnterior,
  mesDoPeriodo,
  validarBusca,
} from "../src/lib/cockpit-ceo/periodo.ts";
import { formatarValor, somaDaComposicao, ESTADOS } from "../src/lib/cockpit-ceo/contrato.ts";

const HOJE = "2026-09-22";

test("Presets de período partem do dia de hoje e nunca fixam um mês", () => {
  assert.deepEqual(
    pick(resolverPeriodo({ periodo: "mes" }, HOJE)),
    { preset: "mes", de: "2026-09-01", ate: "2026-09-22" },
  );
  assert.deepEqual(
    pick(resolverPeriodo({ periodo: "mes_anterior" }, HOJE)),
    { preset: "mes_anterior", de: "2026-08-01", ate: "2026-08-31" },
  );
  assert.deepEqual(
    pick(resolverPeriodo({ periodo: "trimestre" }, HOJE)),
    { preset: "trimestre", de: "2026-07-01", ate: "2026-09-22" },
  );
  assert.deepEqual(
    pick(resolverPeriodo({ periodo: "ano" }, HOJE)),
    { preset: "ano", de: "2026-01-01", ate: "2026-09-22" },
  );
  assert.deepEqual(
    pick(resolverPeriodo({}, "2027-03-05")),
    { preset: "mes", de: "2027-03-01", ate: "2027-03-05" },
  );
  assert.deepEqual(
    pick(resolverPeriodo({ periodo: "mes_anterior" }, "2027-01-10")),
    { preset: "mes_anterior", de: "2026-12-01", ate: "2026-12-31" },
  );
});

test("Período personalizado inválido volta ao mês corrente com aviso", () => {
  const ok = resolverPeriodo({ periodo: "personalizado", de: "2026-06-10", ate: "2026-07-20" }, HOJE);
  assert.equal(ok.de, "2026-06-10");
  assert.equal(ok.ate, "2026-07-20");
  assert.equal(ok.aviso, null);
  for (const [de, ate] of [
    ["2026-02-30", "2026-03-10"],
    ["2026-08-10", "2026-08-01"],
    ["2020-01-01", "2026-09-01"],
    ["", ""],
  ]) {
    const r = resolverPeriodo({ periodo: "personalizado", de, ate }, HOJE);
    assert.equal(r.preset, "mes", `${de}..${ate}`);
    assert.equal(r.de, "2026-09-01");
    assert.ok(r.aviso && r.aviso.length > 10);
  }
  const futuro = resolverPeriodo({ periodo: "personalizado", de: "2026-09-01", ate: "2026-12-31" }, HOJE);
  assert.equal(futuro.ate, "2026-09-22", "período não avança além de hoje");
  assert.ok(futuro.aviso);
});

test("Período anterior tem a mesma duração e termina na véspera", () => {
  const p = resolverPeriodo({ periodo: "mes" }, HOJE);
  assert.deepEqual(periodoAnterior(p), { de: "2026-08-10", ate: "2026-08-31" });
  const m = resolverPeriodo({ periodo: "mes_anterior" }, HOJE);
  assert.deepEqual(periodoAnterior(m), { de: "2026-07-01", ate: "2026-07-31" });
});

test("Plano mensal só se compara a período dentro de um mês", () => {
  assert.deepEqual(mesDoPeriodo(resolverPeriodo({ periodo: "mes" }, HOJE)), {
    mes: "2026-09",
    completo: false,
  });
  assert.deepEqual(mesDoPeriodo(resolverPeriodo({ periodo: "mes_anterior" }, HOJE)), {
    mes: "2026-08",
    completo: true,
  });
  assert.equal(mesDoPeriodo(resolverPeriodo({ periodo: "trimestre" }, HOJE)), null);
  assert.equal(
    mesDoPeriodo(resolverPeriodo({ periodo: "personalizado", de: "2026-08-05", ate: "2026-08-20" }, HOJE)),
    null,
  );
});

test("Busca da URL aceita só strings e descarta o resto", () => {
  assert.deepEqual(
    validarBusca({ periodo: "ano", de: 3, perimetro: "ex-norte", frente: "comercial", lixo: "x" }),
    { periodo: "ano", de: "", ate: "", perimetro: "ex-norte", frente: "comercial", indicador: "" },
  );
  assert.equal(validarBusca({ perimetro: "rede" }).perimetro, "");
  assert.equal(validarBusca({ perimetro: "unidade-exemplo" }).perimetro, "unidade-exemplo");
  assert.equal(validarBusca({ frente: "inexistente" }).frente, "");
});

test("Ausência não vira zero na formatação e na soma da composição", () => {
  const base = { valor: null, estado: "nao_apurado", unidade: "contas", composicao: [] };
  assert.equal(formatarValor(base), "—");
  assert.equal(formatarValor({ ...base, valor: 0, estado: "disponivel" }), "0");
  assert.equal(formatarValor({ ...base, valor: 1234, estado: "disponivel" }), "1.234");
  assert.equal(
    formatarValor({ ...base, valor: 1234.5, estado: "disponivel", unidade: "reais" }),
    "R$ 1.234,50",
  );
  assert.equal(
    somaDaComposicao({ composicao: [{ valor: 2, soma: true }, { valor: 3, soma: true }, { valor: 9 }] }),
    5,
  );
  assert.equal(somaDaComposicao({ composicao: [{ valor: 2, soma: true }, { valor: null, soma: true }] }), null);
  assert.equal(Object.keys(ESTADOS).length, 5);
});

function pick(p) {
  return { preset: p.preset, de: p.de, ate: p.ate };
}
