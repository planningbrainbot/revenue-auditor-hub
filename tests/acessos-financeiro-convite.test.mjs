// Convite para o Financeiro (23/10/2026): a Ana convida quem ainda não tem conta.
import test from "node:test";
import assert from "node:assert/strict";
import {
  decidirConvite,
  emailDeFora,
  validarConvite,
} from "../src/lib/acessos-financeiro-convite.ts";

test("validação: normaliza nome, e-mail e unidades", () => {
  assert.deepEqual(
    validarConvite({ nome: "  Darcio   Souza ", email: " Darcio@Planning.com.br ", unidades: ["bpo", "bpo", " pac "] }),
    { nome: "Darcio Souza", email: "darcio@planning.com.br", unidades: ["bpo", "pac"] },
  );
});

test("validação: sem nome, e-mail inválido ou sem unidade não passa", () => {
  assert.throws(() => validarConvite({ nome: " ", email: "a@b.com", unidades: ["bpo"] }), /nome/);
  assert.throws(() => validarConvite({ nome: "A", email: "sem-arroba", unidades: ["bpo"] }), /E-mail inválido/);
  assert.throws(() => validarConvite({ nome: "A", email: "a@b.com", unidades: [] }), /pelo menos uma unidade/);
  assert.throws(() => validarConvite(null), /nome/);
});

test("domínio: os três do grupo são de dentro; o resto é de fora", () => {
  assert.equal(emailDeFora("ana@planning.com.br"), false);
  assert.equal(emailDeFora("x@grupoplanning.com.br"), false);
  assert.equal(emailDeFora("x@br.planning.com.br"), false);
  assert.equal(emailDeFora("x@diehlecella.com.br"), true);
  assert.equal(emailDeFora("x@gmail.com"), true);
  // subdomínio inventado não engana
  assert.equal(emailDeFora("x@planning.com.br.evil.com"), true);
});

test("decisão: sem conta cria; conta ativa sem Financeiro só concede", () => {
  assert.deepEqual(decidirConvite(null, false), { tipo: "criar" });
  assert.deepEqual(decidirConvite({ user_id: "u1", ativo: true }, false), { tipo: "conceder", userId: "u1" });
});

test("decisão: conta desativada ou que já entra no Financeiro é recusada", () => {
  const desativada = decidirConvite({ user_id: "u1", ativo: false }, false);
  assert.equal(desativada.tipo, "recusar");
  assert.match(desativada.motivo, /desativada/);
  // desativada pesa mais que "já entra": reativar é com o Ops
  assert.match(decidirConvite({ user_id: "u1", ativo: false }, true).motivo, /desativada/);
  assert.match(decidirConvite({ user_id: "u1", ativo: true }, true).motivo, /Editar unidades/);
});
