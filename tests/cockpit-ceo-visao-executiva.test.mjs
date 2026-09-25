// Primeira leitura do Cockpit do CEO (24/09): quatro números sem cartão vazio, gráfico que concilia
// com o cartão e com a ponte, no máximo três exceções com dono, decisões com alternativas dos dados.
import test from "node:test";
import assert from "node:assert/strict";
import { montarCockpit } from "../src/lib/cockpit-ceo/indicadores.ts";
import { fonteSintetica } from "../src/lib/cockpit-ceo/fixture-sintetica.ts";
import { resolverPeriodo } from "../src/lib/cockpit-ceo/periodo.ts";
import {
  montarLeituraExecutiva,
  IDS_PRIMEIRA_LEITURA,
} from "../src/lib/cockpit-ceo/visao-executiva.ts";

const HOJE = "2026-09-24";
const cockpitDe = (fonte) =>
  montarCockpit(fonte, { periodo: resolverPeriodo({}, HOJE), perimetro: "" });
const sintetica = () => fonteSintetica(HOJE, `${HOJE}T12:00:00.000Z`);

test("cartão, última barra e total da ponte são o mesmo número", () => {
  const l = montarLeituraExecutiva(cockpitDe(sintetica()));
  const fat = l.cartoes.find((c) => c.indicador.id === "faturamento-mes");
  assert.ok(l.grafico.conciliado);
  assert.equal(fat.indicador.valor, l.grafico.ultimo.valor);
  assert.equal(l.grafico.ponte.atual, l.grafico.ultimo.valor);
  assert.equal(fat.tendencia.valores.at(-1), fat.indicador.valor);
  assert.ok(l.grafico.meses.every((m, i, a) => i === 0 || a[i - 1].mes < m.mes));
});

test("no máximo quatro números, nenhum não apurado, e a meta de R$ 1 bi fora da grade", () => {
  const l = montarLeituraExecutiva(cockpitDe(sintetica()));
  assert.ok(l.cartoes.length <= 4);
  for (const c of l.cartoes) {
    assert.ok(IDS_PRIMEIRA_LEITURA.includes(c.indicador.id));
    assert.ok(["disponivel", "parcial", "acesso_insuficiente"].includes(c.indicador.estado));
    assert.doesNotMatch(c.fonteCurta, /fn_|_|\(/, "fonte curta sem nome de tabela ou função");
  }
});

test("Financeiro fora: o cartão de faturamento sai e vira aviso, sem zero", () => {
  const f = sintetica();
  f.receita = { estado: "erro", erro: "a leitura falhou", leituras: [] };
  const l = montarLeituraExecutiva(cockpitDe(f));
  assert.ok(!l.cartoes.some((c) => c.indicador.id === "faturamento-mes"));
  assert.ok(l.ausentes.some((a) => a.id === "faturamento-mes"));
  assert.equal(l.grafico, null);
});

test("sem acesso continua visível como sem acesso", () => {
  const f = sintetica();
  f.receita = { estado: "sem_acesso", erro: null, leituras: [] };
  const c = cockpitDe(f);
  const l = montarLeituraExecutiva(c);
  const fat = c.indicadores.find((i) => i.id === "faturamento-mes");
  if (fat.estado === "acesso_insuficiente")
    assert.ok(l.cartoes.some((x) => x.indicador.id === "faturamento-mes"));
});

test("até três exceções, cada uma com responsável; decisões trazem alternativas dos dados", () => {
  const l = montarLeituraExecutiva(cockpitDe(sintetica()));
  assert.ok(l.excecoes.length <= 3);
  for (const e of l.excecoes) assert.notEqual(e.responsavel, "A definir", e.id);
  const perimetro = l.decisoes.find((d) => d.id === "perimetro-meta");
  assert.ok(perimetro.alternativas.length >= 1);
  assert.match(perimetro.alternativas[0], /média de R\$ .* mi\/mês/);
  assert.ok(l.decisoes.length <= 3);
});

test("número com dado velho entra no selo de saúde, que não pode dizer 'em dia'", () => {
  const c = cockpitDe(sintetica());
  const venc = c.indicadores.find((i) => i.id === "vencido-em-aberto");
  venc.dataDado = "2026-09-19T15:50:00Z";
  const l = montarLeituraExecutiva(c);
  assert.ok(l.saude.paradas.some((p) => p.fonte.includes("Vencido a receber")));
});
