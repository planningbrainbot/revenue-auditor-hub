import test from "node:test";
import assert from "node:assert/strict";
import {
  CASOS_AVALIACAO,
  CLASSES,
  LIMITES_AVALIACAO,
  baselinePalavras,
  medirAvaliacao,
} from "../src/lib/cockpit-ceo/jev/avaliacao.ts";
import { OPCOES_ROTEAMENTO } from "../src/lib/cockpit-ceo/jev/contrato.ts";

test("Casos: 40, todos fictícios, das quatro classes, com rótulos dentro da taxonomia", () => {
  assert.equal(CASOS_AVALIACAO.length, 40);
  const ids = new Set(CASOS_AVALIACAO.map((c) => c.id));
  assert.equal(ids.size, 40);
  for (const classe of CLASSES)
    assert.ok(
      CASOS_AVALIACAO.some((c) => c.classe === classe),
      classe,
    );
  for (const c of CASOS_AVALIACAO) {
    assert.ok(c.aceitas.length > 0, c.id);
    for (const a of c.aceitas) assert.ok(a in OPCOES_ROTEAMENTO, `${c.id}: ${a}`);
    assert.doesNotMatch(c.texto, /\d{11,14}|@/, "nada de documento ou e-mail");
  }
  assert.ok(LIMITES_AVALIACAO.tentativas <= 50 && LIMITES_AVALIACAO.custoUsd <= 0.1);
  assert.ok(CASOS_AVALIACAO.length <= LIMITES_AVALIACAO.tentativas);
});

test("Baseline por palavras: acha a frente pelo vocabulário e cai em fora de escopo sem palavra", () => {
  assert.equal(baselinePalavras("Qual o churn por coorte de entrada?"), "retencao");
  assert.equal(baselinePalavras("Quanto faturamos no trimestre?"), "receita");
  assert.equal(baselinePalavras("Qual a previsão do tempo amanhã?"), "fora_de_escopo");
});

test("Métricas: acerto por classe, matriz de confusão, calibração, latência e custo por mil", () => {
  const casos = [
    { id: "a", classe: "clara", texto: "x", aceitas: ["receita"], pedeDado: true },
    { id: "b", classe: "clara", texto: "x", aceitas: ["rede"], pedeDado: true },
    { id: "c", classe: "ambigua", texto: "x", aceitas: ["comercial", "receita"], pedeDado: null },
    { id: "d", classe: "fora_de_escopo", texto: "x", aceitas: ["fora_de_escopo"], pedeDado: null },
  ];
  const resultados = [
    {
      id: "a",
      estado: "ok",
      escolha: "receita",
      confianca: 0.95,
      pedeDado: 0.9,
      latenciaMs: 400,
      custoUsd: 0.00003,
      baseline: "receita",
    },
    {
      id: "b",
      estado: "ok",
      escolha: "receita",
      confianca: 0.6,
      pedeDado: 0.2,
      latenciaMs: 600,
      custoUsd: 0.00003,
      baseline: "rede",
    },
    {
      id: "c",
      estado: "ok",
      escolha: "receita",
      confianca: 0.55,
      pedeDado: 0.5,
      latenciaMs: 800,
      custoUsd: 0.00003,
      baseline: "fora_de_escopo",
    },
    { id: "d", estado: "falha", codigo: "tempo_esgotado", baseline: "fora_de_escopo" },
  ];
  const m = medirAvaliacao(casos, resultados);
  assert.equal(m.respondidos, 3);
  assert.equal(m.falhas, 1);
  assert.deepEqual(m.jev.porClasse.clara, { n: 2, acertos: 1, taxa: 0.5 });
  assert.deepEqual(m.jev.porClasse.ambigua, { n: 1, acertos: 1, taxa: 1 });
  assert.equal(m.jev.porClasse.fora_de_escopo.n, 0, "falha não entra no acerto");
  assert.equal(m.jev.geral.taxa, 2 / 3);
  assert.equal(m.baseline.geral.taxa, 2 / 3, "baseline medida nos mesmos casos respondidos");
  assert.equal(m.confusao.rede.receita, 1);
  assert.equal(m.pedeDado.n, 2);
  assert.equal(m.pedeDado.acertos, 1);
  const alta = m.calibracao.find((b) => b.faixa === "0,90–1,00");
  assert.equal(alta.n, 1);
  assert.equal(alta.taxa, 1);
  assert.equal(m.latencia.p50, 600);
  assert.equal(m.latencia.p95, 800);
  assert.ok(Math.abs(m.custo.porMilUsd - 0.03) < 1e-9);
  assert.equal(m.custo.totalUsd, 0.00009);
});
