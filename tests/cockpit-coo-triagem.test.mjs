import test from "node:test";
import assert from "node:assert/strict";
import { validarPedido } from "../src/lib/cockpit-ceo/jev/contrato.ts";
import {
  LIMIARES_TRIAGEM,
  pedidoTriagem,
  pedidoBloqueio,
  pedidoDuplicidade,
  lerTriagem,
  lerDuplicidade,
  assinatura,
  textoDaTarefa,
  opcoesUnidade,
} from "../src/lib/cockpit-coo/triagem.ts";
import { lerUnidades } from "../src/lib/cockpit-coo/unidades.ts";

const UNIDADES = lerUnidades([
  { id: 3, nome_da_praca: "Belém", tipo: "regional", data_inauguracao: "2025-06-01" },
  { id: 9, nome_da_praca: "Goiânia", tipo: "interna", data_inauguracao: null },
]);

test("os pedidos passam na validação do contrato do Jev (criteria obrigatório em todas as primitivas)", () => {
  validarPedido(pedidoTriagem("Cobrar Belém", UNIDADES, { tema: true, unidade: true }));
  validarPedido(pedidoBloqueio("Tarefa", ["aguardando o jurídico"]));
  validarPedido(pedidoBloqueio("Tarefa", []));
  validarPedido(pedidoDuplicidade("Cobrar fatura de Belém", [{ id: "a", nome: "Fatura Belém agosto" }]));
});

test("opções de unidade: uma por unidade (com apelidos de Goiânia), rede e nenhuma", () => {
  const o = opcoesUnidade(UNIDADES);
  assert.deepEqual(Object.keys(o).sort(), ["nenhuma", "rede", "u3", "u9"]);
  assert.match(o.u9, /Matriz ou Partners/);
});

test("tema fica desligado pela calibração; unidade só acima de 0,8", () => {
  assert.ok(LIMIARES_TRIAGEM.tema > 1, "tema desligado: 51% de acerto em 108 KRs reais");
  assert.ok(LIMIARES_TRIAGEM.bloqueio > 1, "bloqueio desligado: sem amostra rotulada");
  const r = lerTriagem({
    tema: { type: "choice", choice: "growth", confidence: 0.99, probabilities: { growth: 0.99 } },
    unidade: { type: "choice", choice: "u3", confidence: 0.9, probabilities: { u3: 0.91 } },
  });
  assert.equal(r.tema.tema, "growth");
  assert.equal(r.tema.aceita, false);
  assert.deepEqual(
    { id: r.unidade.unidadeId, aceita: r.unidade.aceita, conf: r.unidade.confianca },
    { id: 3, aceita: true, conf: 0.91 },
  );
  const baixa = lerTriagem({ unidade: { type: "choice", choice: "u9", confidence: 0.55, probabilities: null } });
  assert.equal(baixa.unidade.aceita, false);
  const nenhuma = lerTriagem({ unidade: { type: "choice", choice: "nenhuma", confidence: 0.99, probabilities: null } });
  assert.equal(nenhuma.unidade.aceita, false, "'nenhuma' não vira sugestão para gravar");
  const rede = lerTriagem({ unidade: { type: "choice", choice: "rede", confidence: 0.95, probabilities: null } });
  assert.equal(rede.unidade.aceita, true);
});

test("duplicidade aponta a tarefa aberta só acima do limiar", () => {
  const abertas = [{ id: "x1", nome: "Fatura de Belém" }, { id: "x2", nome: "Outra" }];
  assert.deepEqual(
    lerDuplicidade({ type: "choice", choice: "t0", confidence: 0.9, probabilities: { t0: 0.9 } }, abertas),
    { id: "x1", nome: "Fatura de Belém", confianca: 0.9 },
  );
  assert.equal(lerDuplicidade({ type: "choice", choice: "t0", confidence: 0.6, probabilities: null }, abertas), null);
  assert.equal(lerDuplicidade({ type: "choice", choice: "nenhuma", confidence: 0.99, probabilities: null }, abertas), null);
});

test("assinatura muda quando o texto muda; o texto da tarefa não passa de 800 caracteres", () => {
  assert.equal(assinatura("abc"), assinatura("abc"));
  assert.notEqual(assinatura("abc"), assinatura("abd"));
  assert.ok(textoDaTarefa({ nome: "x".repeat(2000) }).length <= 800);
});
