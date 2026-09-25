// Jev na conversa (24/09): classifica domínio e ambiguidade; o encaminhamento é regra fixa com
// limiares. Falha do Jev nunca bloqueia a pergunta; Jev não escolhe número nem concede acesso.
import test from "node:test";
import assert from "node:assert/strict";
import {
  pedidoConversa,
  decidirEncaminhamento,
  LIMIARES_PADRAO,
  DOMINIOS_JEV,
  consultasDoDominio,
  TAXONOMIA_CONVERSA,
} from "../src/lib/cockpit-ceo/conversa/jev.ts";
import { validarPedido, taxonomiaDo } from "../src/lib/cockpit-ceo/jev/contrato.ts";
import { NOMES_CONSULTAS } from "../src/lib/cockpit-ceo/conversa/metricas.ts";

const ok = (dominio, pDominio, ambigua) => ({
  estado: "ok",
  respostas: {
    dominio: {
      type: "choice",
      choice: dominio,
      confidence: pDominio,
      probabilities: { [dominio]: pDominio },
    },
    ambigua: { type: "noul", noul: ambigua },
  },
  custoUsd: 0.00003,
  latenciaMs: 400,
});

test("o pedido segue o contrato do OpenRouter e é registrado na taxonomia da conversa", () => {
  const p = pedidoConversa("Quanto faturamos neste mês?", "");
  validarPedido(p);
  assert.equal(taxonomiaDo(p), TAXONOMIA_CONVERSA);
  assert.deepEqual(Object.keys(p.questions.dominio.criteria).sort(), [...DOMINIOS_JEV].sort());
  assert.equal(p.state.pergunta, "Quanto faturamos neste mês?");
  assert.equal(p.state.contexto, "Sem visão anterior nesta conversa.");
});

test("Jev fora do ar: segue para o modelo com todas as ferramentas, sem dica", () => {
  const d = decidirEncaminhamento(
    { estado: "falha", codigo: "tempo_esgotado", mensagem: "x" },
    false,
  );
  assert.equal(d.modo, "modelo");
  assert.equal(d.dominio, null);
  assert.deepEqual(d.consultas, NOMES_CONSULTAS);
  assert.equal(d.motivo, "jev_indisponivel");
});

test("domínio com confiança acima do limiar restringe as ferramentas ao domínio", () => {
  const d = decidirEncaminhamento(ok("caixa", 0.9, 0.1), false);
  assert.equal(d.dominio, "caixa");
  assert.ok(d.consultas.includes("caixa") && !d.consultas.includes("coortes"));
  assert.ok(d.consultas.includes("acoes"), "ações e frescor valem para todo domínio");
});

test("confiança abaixo do limiar: modelo com todas as ferramentas, sem escolher domínio", () => {
  const d = decidirEncaminhamento(ok("caixa", LIMIARES_PADRAO.dominio - 0.01, 0.1), false);
  assert.equal(d.dominio, null);
  assert.deepEqual(d.consultas, NOMES_CONSULTAS);
  assert.equal(d.motivo, "confianca_baixa");
});

test("ambígua sem contexto anterior pede esclarecimento; com contexto, segue", () => {
  assert.equal(decidirEncaminhamento(ok("receita", 0.9, 0.9), false).esclarecer, true);
  assert.equal(decidirEncaminhamento(ok("receita", 0.9, 0.9), true).esclarecer, false);
  assert.equal(
    decidirEncaminhamento(ok("receita", 0.9, LIMIARES_PADRAO.ambigua - 0.01), false).esclarecer,
    false,
  );
});

test("fora do escopo com confiança alta responde sem chamar o modelo", () => {
  const d = decidirEncaminhamento(ok("fora_do_escopo", 0.95, 0.1), false);
  assert.equal(d.modo, "fora_do_escopo");
  const baixa = decidirEncaminhamento(ok("fora_do_escopo", 0.6, 0.1), false);
  assert.equal(baixa.modo, "modelo");
});

test("composição e refinamento mantêm todas as ferramentas", () => {
  for (const dom of ["varios", "refinamento", "gestao_visao"]) {
    const d = decidirEncaminhamento(ok(dom, 0.95, 0.1), true);
    assert.deepEqual(d.consultas, NOMES_CONSULTAS, dom);
  }
  assert.ok(consultasDoDominio("unidades").includes("ranking_unidades"));
});
