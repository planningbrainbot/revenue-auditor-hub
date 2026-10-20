// Portal de Faturamento: erro do banco → mensagem legível (src/lib/faturamento/erros.ts; API.md §0.3).
import test from "node:test";
import assert from "node:assert/strict";
import {
  ErroFaturamento,
  camposDoDetalhe,
  desembrulhar,
  tipoDoErro,
  traduzirErroBanco,
  valeTentarDeNovo,
} from "../src/lib/faturamento/erros.ts";

const RPC = "ops.fat_pedido_enviar";
const O_QUE = "O envio do pedido";

test("42501: a frase do portal vale; a do Postgres em inglês vira o padrão", () => {
  assert.deepEqual(
    traduzirErroBanco(
      { code: "42501", message: "Quem enviou não dá o OK no próprio pedido." },
      RPC,
      O_QUE,
    ),
    {
      tipo: "sem_acesso",
      codigo: "42501",
      mensagem: "Quem enviou não dá o OK no próprio pedido.",
      campos: [],
    },
  );
  const ingles = traduzirErroBanco(
    { code: "42501", message: "permission denied for function fat_pedido" },
    RPC,
    O_QUE,
  );
  assert.equal(ingles.tipo, "sem_acesso");
  assert.equal(ingles.mensagem, "Seu acesso não inclui esta parte do Portal de Faturamento.");
});

test("P0002 e 55000", () => {
  const nao = traduzirErroBanco({ code: "P0002", message: "" }, RPC, O_QUE);
  assert.equal(nao.tipo, "nao_encontrado");
  assert.equal(nao.mensagem, "Pedido não encontrado.");
  const transicao = traduzirErroBanco(
    {
      code: "55000",
      message: "Pedido FAT-2026-000012 está em Na fila do Omie: não dá para aprovar.",
    },
    RPC,
    O_QUE,
  );
  assert.equal(transicao.tipo, "transicao");
  assert.equal(
    transicao.mensagem,
    "Pedido FAT-2026-000012 está em Na fila do Omie: não dá para aprovar.",
  );
});

test("22023: a lista de campos vem do details; campo nulo é erro geral", () => {
  const details = JSON.stringify({
    erros: [
      { campo: "tomador_documento", mensagem: "CNPJ com dígito verificador errado." },
      { campo: null, mensagem: "Emissora sem Omie." },
      { campo: "x", mensagem: "  " },
      "lixo",
    ],
  });
  assert.deepEqual(
    traduzirErroBanco(
      { code: "22023", message: "Pedido incompleto ou com erro.", details },
      RPC,
      O_QUE,
    ),
    {
      tipo: "validacao",
      codigo: "22023",
      mensagem: "Pedido incompleto ou com erro.",
      campos: [
        { campo: "tomador_documento", mensagem: "CNPJ com dígito verificador errado." },
        { campo: null, mensagem: "Emissora sem Omie." },
      ],
    },
  );
  assert.deepEqual(camposDoDetalhe("não é json"), []);
  assert.deepEqual(camposDoDetalhe(null), []);
  assert.deepEqual(camposDoDetalhe('{"outra":1}'), []);
});

test("função que ainda não existe no banco, sessão vencida e falha genérica", () => {
  const ausente = traduzirErroBanco(
    { code: "PGRST202", message: "Could not find the function ops.fat_pedido_enviar" },
    RPC,
    O_QUE,
  );
  assert.equal(ausente.tipo, "indisponivel");
  assert.match(
    ausente.mensagem,
    /ainda não está disponível no banco \(a função ops\.fat_pedido_enviar não existe\)/,
  );
  assert.equal(
    traduzirErroBanco({ code: "PGRST301", message: "JWT expired" }, RPC, O_QUE).tipo,
    "sessao",
  );
  assert.deepEqual(
    traduzirErroBanco(
      { code: "57014", message: "canceling statement due to statement timeout" },
      RPC,
      O_QUE,
    ),
    {
      tipo: "falha",
      codigo: "57014",
      mensagem: "O envio do pedido falhou (código 57014). Tente de novo em instantes.",
      campos: [],
    },
  );
  assert.equal(
    traduzirErroBanco(null, RPC, O_QUE).mensagem,
    "O envio do pedido falhou. Tente de novo em instantes.",
  );
});

test("desembrulhar devolve os dados ou lança ErroFaturamento com tipo e campos", () => {
  assert.deepEqual(desembrulhar({ ok: true, dados: { id: 1 } }), { id: 1 });
  const erro = {
    tipo: "validacao",
    codigo: "22023",
    mensagem: "Pedido incompleto ou com erro.",
    campos: [{ campo: "valor", mensagem: "x" }],
  };
  assert.throws(
    () => desembrulhar({ ok: false, erro }),
    (e) =>
      e instanceof ErroFaturamento &&
      e.tipo === "validacao" &&
      e.campos.length === 1 &&
      e.message === erro.mensagem,
  );
});

test("só falha passageira tenta de novo, e uma vez", () => {
  const falha = new ErroFaturamento({ tipo: "falha", codigo: null, mensagem: "x", campos: [] });
  const acesso = new ErroFaturamento({
    tipo: "sem_acesso",
    codigo: "42501",
    mensagem: "x",
    campos: [],
  });
  assert.equal(tipoDoErro(acesso), "sem_acesso");
  assert.equal(tipoDoErro(new Error("rede")), "falha");
  assert.equal(valeTentarDeNovo(0, falha), true);
  assert.equal(valeTentarDeNovo(1, falha), false);
  assert.equal(valeTentarDeNovo(0, acesso), false);
});
