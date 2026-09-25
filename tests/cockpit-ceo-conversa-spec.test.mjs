// Especificação da visão e conferência do texto (24/09). Regras críticas: o modelo não escreve
// número em bloco, só referencia resultado da rodada; número do texto sem origem derruba a frase.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PropostaVisaoSchema,
  definicaoDaProposta,
  aplicarFiltros,
  EspecificacaoRecusada,
  VisaoDefinicaoSchema,
} from "../src/lib/cockpit-ceo/conversa/spec.ts";
import { conferirTexto, lerNumeros } from "../src/lib/cockpit-ceo/conversa/conferir.ts";

const resultado = (id, consulta, args, dados, destaques = []) => ({
  id,
  consulta,
  args,
  versaoRegra: "t",
  titulo: "t",
  unidade: "reais",
  estado: "disponivel",
  fonte: "f",
  atualizadoEm: null,
  filtrosAplicados: [],
  avisos: [],
  destino: null,
  destaques,
  dados,
});
const r1 = resultado(
  "r1",
  "serie_faturamento",
  { filtros: { leitura: "grupo", periodo: { tipo: "ultimos_meses", meses: 3 } } },
  {
    forma: "serie",
    series: [{ chave: "total", rotulo: "T" }],
    pontos: [
      { x: "2026-07", valores: { total: 6_604_210.55 } },
      { x: "2026-08", valores: { total: 7_458_123.4 } },
    ],
  },
  [{ rotulo: "Variação", valor: 12.9, unidade: "percentual" }],
);
const r2 = resultado(
  "r2",
  "ranking_unidades",
  { filtros: { base: "todas" } },
  {
    forma: "categorias",
    itens: [
      { rotulo: "Curitiba", valor: 560 },
      { rotulo: "Belém", valor: 450 },
    ],
    total: 1010,
    somaFecha: true,
  },
);
const registro = new Map([
  ["r1", r1],
  ["r2", r2],
]);

test("proposta com número literal em bloco é recusada pelo schema", () => {
  const p = PropostaVisaoSchema.safeParse({
    titulo: "x",
    conclusao: "y",
    blocos: [{ tipo: "kpi", resultado: "r1", valor: 999 }],
  });
  assert.equal(p.success, false);
});

test("proposta vira definição com a consulta autorizada, não com o id", () => {
  const d = definicaoDaProposta(
    {
      titulo: "Faturamento",
      conclusao: "ok",
      blocos: [
        { tipo: "serie", resultado: "r1" },
        { tipo: "ranking", resultado: "r2" },
      ],
      proximas: [],
    },
    registro,
  );
  assert.equal(d.versao, 1);
  assert.deepEqual(d.blocos[0].consulta, { nome: "serie_faturamento", args: r1.args });
  assert.equal(d.blocos[1].tipo, "ranking");
  assert.equal(VisaoDefinicaoSchema.safeParse(d).success, true);
});

test("referência a resultado que não existe na rodada é recusada", () => {
  assert.throws(
    () =>
      definicaoDaProposta(
        { titulo: "x", conclusao: "y", blocos: [{ tipo: "kpi", resultado: "r9" }] },
        registro,
      ),
    EspecificacaoRecusada,
  );
});

test("bloco incompatível com a forma do resultado é recusado (funil sobre série)", () => {
  assert.throws(
    () =>
      definicaoDaProposta(
        { titulo: "x", conclusao: "y", blocos: [{ tipo: "funil", resultado: "r1" }] },
        registro,
      ),
    EspecificacaoRecusada,
  );
});

test("controle de filtro altera só os filtros que a consulta aceita", () => {
  const d = definicaoDaProposta(
    {
      titulo: "x",
      conclusao: "y",
      blocos: [
        { tipo: "serie", resultado: "r1" },
        { tipo: "ranking", resultado: "r2" },
      ],
    },
    registro,
  );
  const novo = aplicarFiltros(d, { base: "nova", unidades: ["Belém"], produto: "cella" });
  assert.deepEqual(novo.blocos[1].consulta.args.filtros, { base: "nova", unidades: ["Belém"] });
  // A série aceita unidades e base, não produto.
  assert.deepEqual(novo.blocos[0].consulta.args.filtros, {
    leitura: "grupo",
    periodo: { tipo: "ultimos_meses", meses: 3 },
    base: "nova",
    unidades: ["Belém"],
  });
  assert.deepEqual(novo.filtros, { base: "nova", unidades: ["Belém"], produto: "cella" });
});

test("leitura de números em português: escala, decimal e percentual", () => {
  const n = lerNumeros(
    "Faturamos R$ 7,46 mi em 08/2026, +12,9% sobre julho; Curitiba teve R$ 560 e 1.010 no total.",
  );
  assert.deepEqual(
    n.map((x) => [x.valor, x.tolerancia]),
    [
      [7_460_000, 5_000],
      [12.9, 0.05],
      [560, 0.5],
      [1010, 0.5],
    ],
  );
});

test("texto com números de origem passa inteiro", () => {
  const t = "Faturamos R$ 7,46 mi em agosto, 12,9% acima de julho. Curitiba lidera com R$ 560.";
  const c = conferirTexto(t, [r1, r2], "compare curitiba e belém");
  assert.equal(c.texto, t);
  assert.deepEqual(c.descartadas, []);
});

test("frase com número inventado sai, e o descarte fica registrado", () => {
  const t = "Faturamos R$ 7,46 mi em agosto. A margem foi de 38%. Curitiba lidera com R$ 560.";
  const c = conferirTexto(t, [r1, r2], "");
  assert.equal(c.texto, "Faturamos R$ 7,46 mi em agosto. Curitiba lidera com R$ 560.");
  assert.deepEqual(c.descartadas, ["A margem foi de 38%."]);
});

test("número da própria pergunta, datas e contagem de itens não contam como inventados", () => {
  const c = conferirTexto(
    "Nos últimos 3 meses, 2 unidades aparecem; em 24/09/2026 o dado era de 08/2026.",
    [r2],
    "últimos 3 meses",
  );
  assert.deepEqual(c.descartadas, []);
});

test("sem nenhum resultado, qualquer valor em reais é descartado", () => {
  const c = conferirTexto("O faturamento foi R$ 5 mi.", [], "quanto faturamos?");
  assert.equal(c.texto, "");
  assert.equal(c.descartadas.length, 1);
});
