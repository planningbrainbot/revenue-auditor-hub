// Camada de métricas da conversa (24/09): catálogo fechado sobre a carga do cockpit. Os valores
// esperados são escritos à mão a partir de uma fonte pequena, não recalculados pela função testada.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONSULTAS,
  ConsultaRecusada,
  criarEntrada,
  executarConsulta,
  NOMES_CONSULTAS,
} from "../src/lib/cockpit-ceo/conversa/metricas.ts";
import {
  mesesDoPeriodo,
  resolverUnidades,
  FiltrosSchema,
} from "../src/lib/cockpit-ceo/conversa/filtros.ts";
import { numerosDoResultado } from "../src/lib/cockpit-ceo/conversa/resultado.ts";
import { fonteSintetica } from "../src/lib/cockpit-ceo/fixture-sintetica.ts";

import { HOJE, rede, fonte } from "./_fonte-conversa.mjs";

const e = criarEntrada(fonte);
const serie = (r, chave) => r.dados.pontos.map((p) => p.valores[chave]);

test("base nova + base antiga reconstroem a linha da rede, em cada unidade e mês", () => {
  for (const l of rede.linhas) {
    const p = rede.porBase.find((x) => x.mes === l.mes && x.chave === l.chave);
    assert.equal(Math.round((p.nova + p.antiga) * 100), Math.round(l.valor * 100));
  }
});

test("série da rede por unidade, três meses fechados, base todas e base nova", () => {
  const args = {
    filtros: {
      leitura: "rede",
      unidades: ["curitiba", "belem"],
      periodo: { tipo: "ultimos_meses", meses: 3 },
    },
  };
  const r = executarConsulta(e, "serie_faturamento", args, "r1");
  assert.deepEqual(
    r.dados.pontos.map((p) => p.x),
    ["2026-06", "2026-07", "2026-08"],
  );
  assert.deepEqual(serie(r, "Curitiba"), [200, 190, 170]);
  assert.deepEqual(serie(r, "Belém"), [150, 150, 150]);
  const nova = executarConsulta(
    e,
    "serie_faturamento",
    { filtros: { ...args.filtros, base: "nova" } },
    "r2",
  );
  assert.deepEqual(serie(nova, "Curitiba"), [200, 180, 150]);
  assert.deepEqual(serie(nova, "Belém"), [100, 110, 120]);
  assert.ok(nova.filtrosAplicados.includes("Base nova"));
});

test("mês com unidade sem apuração: o total da rede fica sem número, nunca zero", () => {
  const r = executarConsulta(
    e,
    "serie_faturamento",
    { filtros: { leitura: "rede", periodo: { tipo: "ultimos_meses", meses: 3 } } },
    "r1",
  );
  assert.deepEqual(serie(r, "total"), [360, 350, null]);
  assert.equal(r.estado, "parcial");
  assert.match(r.avisos.join(" "), /08\/2026/);
});

test("unidade fora do escopo não é lida e a resposta não diz se ela existe", () => {
  const r = executarConsulta(
    e,
    "serie_faturamento",
    { filtros: { leitura: "rede", unidades: ["Recife"] } },
    "r1",
  );
  assert.equal(r.estado, "nao_apurado");
  assert.deepEqual(numerosDoResultado(r), []);
  assert.match(r.avisos[0], /Recife/);
});

test("série do grupo exclui o mês em curso e não aceita unidade", () => {
  const r = executarConsulta(
    e,
    "serie_faturamento",
    { filtros: { periodo: { tipo: "ultimos_meses", meses: 3 } } },
    "r1",
  );
  assert.deepEqual(serie(r, "total"), [1000, 1100, 1250]);
  const d = Object.fromEntries(r.destaques.map((x) => [x.rotulo, x.valor]));
  assert.equal(d["Faturamento do grupo: soma do período"], 3350);
  assert.equal(d["Faturamento do grupo: variação do último mês (%)"], 13.6); // 1250/1100 − 1
  const g = executarConsulta(
    e,
    "serie_faturamento",
    { filtros: { leitura: "grupo", unidades: ["Belém"] } },
    "r2",
  );
  assert.match(g.avisos.join(" "), /só existem na leitura da rede/);
});

test("ranking de unidades soma os meses do período e declara mês faltante", () => {
  const r = executarConsulta(
    e,
    "ranking_unidades",
    { filtros: { periodo: { tipo: "ultimos_meses", meses: 3 } } },
    "r1",
  );
  assert.deepEqual(
    r.dados.itens.map((i) => [i.rotulo, i.valor]),
    [
      ["Curitiba", 560],
      ["Belém", 450],
      ["Outra", 20],
    ],
  );
  assert.equal(r.dados.total, 1030);
  assert.equal(r.dados.itens[2].detalhe, "2 de 3 meses apurados");
});

test("variação por unidade usa o último mês fechado completo e fecha no total", () => {
  const r = executarConsulta(e, "variacao_por_chave", { filtros: { leitura: "rede" } }, "r1");
  // ago é parcial → o último fechado completo é jul; jul − jun: Curitiba −10, Belém 0, Outra 0.
  assert.match(r.titulo, /07\/2026/);
  assert.deepEqual(
    r.dados.itens.map((i) => [i.rotulo, i.valor]),
    [["Curitiba", -10]],
  );
  assert.equal(r.dados.total, -10);
});

test("catálogo fechado: nome desconhecido e argumento fora do schema são recusados antes de ler", () => {
  assert.throws(
    () => executarConsulta(e, "sql", { query: "select * from auth.users" }, "r1"),
    ConsultaRecusada,
  );
  assert.throws(
    () => executarConsulta(e, "indicador", { id: "drop table" }, "r1"),
    ConsultaRecusada,
  );
  assert.throws(
    () =>
      executarConsulta(
        e,
        "serie_faturamento",
        { filtros: { unidades: ["Belém"], sql: "1=1" } },
        "r1",
      ),
    ConsultaRecusada,
  );
  assert.equal(FiltrosSchema.safeParse({ unidades: Array(9).fill("x") }).success, false);
});

test("períodos: nenhum mês em curso entra, intervalo invertido é vazio", () => {
  assert.deepEqual(mesesDoPeriodo({ tipo: "ultimos_meses", meses: 2 }, HOJE), [
    "2026-07",
    "2026-08",
  ]);
  assert.deepEqual(mesesDoPeriodo({ tipo: "intervalo", de: "2026-07", ate: "2026-12" }, HOJE), [
    "2026-07",
    "2026-08",
  ]);
  assert.deepEqual(mesesDoPeriodo({ tipo: "intervalo", de: "2026-08", ate: "2026-07" }, HOJE), []);
  assert.deepEqual(mesesDoPeriodo({ tipo: "trimestre" }, HOJE), ["2026-07", "2026-08"]);
});

test("resolução de unidade: sem acento e sem caixa, prefixo só quando único", () => {
  const d = ["Belém", "Curitiba - PR", "Curitibanos", "São Paulo"];
  assert.deepEqual(resolverUnidades(["belem", "curitiba", "sao paulo"], d).unidades, [
    "Belém",
    "Curitiba - PR",
    "São Paulo",
  ]);
  assert.deepEqual(resolverUnidades(["cur"], d).fora, ["cur"]);
});

test("toda consulta roda sobre a fonte sintética sem NaN e sem número em estado sem dado", () => {
  const s = criarEntrada(fonteSintetica(HOJE, `${HOJE}T12:00:00.000Z`));
  const exemplos = {
    indicador: { id: "faturamento-mes" },
    caixa: { metrica: "inadimplencia" },
    portfolio: { metrica: "ganhos" },
  };
  for (const nome of NOMES_CONSULTAS) {
    const r = executarConsulta(s, nome, exemplos[nome] ?? {}, "r1");
    for (const n of numerosDoResultado(r)) assert.ok(Number.isFinite(n), `${nome}: ${n}`);
    if (r.estado === "acesso_insuficiente" || r.estado === "fonte_indisponivel")
      assert.deepEqual(numerosDoResultado(r), [], `${nome} mostrou número sem dado`);
    assert.ok(r.fonte && r.titulo, nome);
  }
  assert.equal(Object.keys(CONSULTAS).length, NOMES_CONSULTAS.length);
});
