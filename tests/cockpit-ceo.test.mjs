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

// ── Task 3: catálogo de perguntas ────────────────────────────────────────────
import { PERGUNTAS, EXIGENCIAS_INVESTIDOR, COBERTURAS } from "../src/lib/cockpit-ceo/perguntas.ts";
import { IDS_INDICADORES, ORDEM_FRENTES } from "../src/lib/cockpit-ceo/contrato.ts";

test("Catálogo cobre as 11 exigências do mapa e a trajetória para R$ 1 bi", () => {
  assert.equal(EXIGENCIAS_INVESTIDOR.length, 11);
  for (const e of EXIGENCIAS_INVESTIDOR)
    assert.ok(
      PERGUNTAS.some((p) => p.exigencia === e.id),
      `exigência sem pergunta: ${e.titulo}`,
    );
  const bilhao = PERGUNTAS.find((p) => /R\$ 1 bi/.test(p.texto));
  assert.ok(bilhao, "falta a pergunta da trajetória");
  assert.equal(bilhao.cobertura, "depende_decisao");
  for (const f of ORDEM_FRENTES) assert.ok(PERGUNTAS.some((p) => p.frente === f), `frente vazia: ${f}`);
});

test("Nenhuma pergunta se declara verificada no piloto e toda referência de indicador existe", () => {
  assert.ok(Object.keys(COBERTURAS).includes("verificada"));
  assert.equal(PERGUNTAS.filter((p) => p.cobertura === "verificada").length, 0);
  const ids = new Set(PERGUNTAS.map((p) => p.id));
  assert.equal(ids.size, PERGUNTAS.length, "ids repetidos");
  for (const p of PERGUNTAS) {
    for (const i of p.indicadores) assert.ok(IDS_INDICADORES.includes(i), `${p.id} → ${i}`);
    assert.ok(p.responsavel && p.aceite && p.fonte, `${p.id} incompleta`);
    if (p.cobertura === "implementada_nao_homologada")
      assert.ok(p.indicadores.length > 0, `${p.id} implementada sem indicador`);
  }
});

test("Catálogo não usa o vocabulário de franquia abolido em 09/09", () => {
  const texto = JSON.stringify([PERGUNTAS, EXIGENCIAS_INVESTIDOR]);
  assert.doesNotMatch(texto, /franqu/i);
});
