import test from "node:test";
import assert from "node:assert/strict";
import { montarCoortes } from "../src/lib/cockpit-ceo/coortes.ts";

const HOJE = "2026-09-22";
const k = (deal, ganho_em, extra = {}) => ({
  deal,
  ganho_em,
  unidade: "Unidade Um",
  origem: "inside_sales",
  ...extra,
});
const base = (contratos, churns) =>
  montarCoortes({ contratos, churns, regionais: ["Unidade Um"], hoje: HOJE, horizonte: 6 });

test("Coorte tem denominador fixo, churn datado reduz os meses seguintes e o mês corrente fica vazio", () => {
  const c = base(
    [k("a", "2026-06-10"), k("b", "2026-06-11"), k("c", "2026-06-12"), k("d", "2026-06-13")],
    [
      { deal: "b", data_churn: "2026-07-20" },
      { deal: "c", data_churn: "2026-06-25" },
    ],
  );
  const jun = c.linhas.find((l) => l.mes === "2026-06");
  assert.equal(jun.denominador, 4);
  assert.deepEqual(jun.retidos, [3, 2, 2, null, null, null, null]);
  assert.equal(c.inicioRegistroChurn, "2026-06");
});

test("Mês anterior ao início do registro de churn fica vazio, não 100%", () => {
  const c = base(
    [k("e", "2026-03-05"), k("f", "2026-03-06"), k("x", "2026-06-01")],
    [{ deal: "x", data_churn: "2026-06-15" }],
  );
  const mar = c.linhas.find((l) => l.mes === "2026-03");
  assert.deepEqual(mar.retidos.slice(0, 4), [null, null, null, 2]);
  assert.ok(c.avisos.some((a) => /06\/2026/.test(a) && /registro de churn/.test(a)));
});

test("Origem fora das vendas e unidade não regional saem e são contadas; negócio repetido conta uma vez", () => {
  const c = base(
    [
      k("a", "2026-06-10"),
      k("a", "2026-07-02"),
      k("s", "2026-08-01", { origem: "socios" }),
      k("i", "2026-06-01", { unidade: "Unidade Interna" }),
    ],
    [{ deal: "z", data_churn: "2026-07-01" }],
  );
  assert.equal(c.linhas.find((l) => l.mes === "2026-06").denominador, 1);
  assert.equal(
    c.linhas.find((l) => l.mes === "2026-07"),
    undefined,
  );
  assert.deepEqual(c.foraDaOrigem, [{ origem: "socios", contratos: 1 }]);
  assert.equal(c.foraDeRegional, 1);
  assert.equal(c.churnsSemContrato, 1);
});

test("Churn sem data deixa a coorte parcial; coorte recente é marcada", () => {
  const c = base(
    [k("a", "2026-05-10"), k("b", "2026-05-11"), k("n", "2026-06-30")],
    [
      { deal: "b", data_churn: null },
      { deal: "n", data_churn: "2026-07-01" },
    ],
  );
  const mai = c.linhas.find((l) => l.mes === "2026-05");
  assert.equal(mai.churnsSemData, 1);
  assert.equal(mai.recente, false);
  assert.equal(c.linhas.find((l) => l.mes === "2026-06").recente, true);
  assert.equal(c.estado, "parcial");
  assert.ok(c.avisos.some((a) => /sem data/.test(a)));
});

test("Sem contrato nenhum não é 100% de retenção: não apurado", () => {
  const c = base([], []);
  assert.equal(c.estado, "nao_apurado");
  assert.equal(c.linhas.length, 0);
});
