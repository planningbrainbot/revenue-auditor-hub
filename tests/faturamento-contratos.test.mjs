// CA-04 (empresa errada, 20/10/2026): a leitura dos contratos das emissoras do grupo para o aviso de contrato em outra
// empresa. Montagem do contrato a partir do ListarContratos, regra de vigente (ativo e vigência em dia, E0 §3.1),
// casamento nCodCli → documento em lotes de 50 (ListarClientesResumido) com o ConsultarCliente para o que faltar, e a
// prova de que a operação só lê o Omie (vale em simular e em gravar) e respeita a folga da rodada.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contratoDoOmie,
  contratoVigente,
  criarOmie,
  emLotes,
  LEITURAS,
  LOTE_CLIENTES,
  processarEnvio,
} from "../supabase/functions/faturamento-omie/logica.ts";

const AGORA = new Date("2026-10-20T15:00:00Z");
const PAC = "8cdf5de7-683f-4d8e-a194-f303677ac6ea";
const CRED = { app_key: "CHAVE-APP-123456", app_secret: "SEGREDO-APP-987654" };
const cab = (o) => ({
  cabecalho: {
    nCodCtr: 1,
    cNumCtr: "C-1",
    nCodCli: 10,
    cCodSit: "10",
    dVigInicial: "01/01/2026",
    dVigFinal: "",
    nValTotMes: 2500,
    ...o,
  },
});

test("montagem: nCodCtr, número, cliente, situação, vigência em ISO e valor", () => {
  assert.deepEqual(contratoDoOmie(cab({ dVigFinal: "31/12/2026", nValTotMes: 1234.567 })), {
    codigo_contrato: 1,
    numero: "C-1",
    codigo_cliente_omie: 10,
    situacao: "10",
    vigencia_inicial: "2026-01-01",
    vigencia_final: "2026-12-31",
    valor_mensal: 1234.57,
  });
  assert.equal(contratoDoOmie(cab({})).vigencia_final, null);
});

test("vigente: só ativo (10) com vigência final vazia ou a partir de hoje", () => {
  const hoje = "2026-10-20";
  assert.equal(contratoVigente({ situacao: "10", vigencia_final: null }, hoje), true);
  assert.equal(contratoVigente({ situacao: "10", vigencia_final: "2026-10-20" }, hoje), true);
  assert.equal(
    contratoVigente({ situacao: "10", vigencia_final: "2026-10-19" }, hoje),
    false,
    "vencido não conta",
  );
  assert.equal(
    contratoVigente({ situacao: "90", vigencia_final: null }, hoje),
    false,
    "suspenso não conta",
  );
  assert.equal(
    contratoVigente({ situacao: "99", vigencia_final: null }, hoje),
    false,
    "cancelado não conta",
  );
  assert.deepEqual(emLotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

function omieContratos({ paginas, clientes, consultar = {} }) {
  const chamadas = [];
  const transporte = async (_u, corpo) => {
    const req = JSON.parse(corpo);
    const p = req.param[0];
    chamadas.push({ metodo: req.call, param: p });
    if (req.call === "ListarContratos") {
      return {
        status: 200,
        texto: JSON.stringify({
          pagina: p.pagina,
          total_de_paginas: paginas.length,
          contratoCadastro: paginas[p.pagina - 1],
        }),
      };
    }
    if (req.call === "ListarClientesResumido") {
      const pedidos = p.clientesPorCodigo.map((x) => x.codigo_cliente_omie);
      const lista = pedidos
        .filter((c) => clientes[c])
        .map((c) => ({ codigo_cliente: c, cnpj_cpf: clientes[c] }));
      return { status: 200, texto: JSON.stringify({ clientes_cadastro_resumido: lista }) };
    }
    if (req.call === "ConsultarCliente") {
      const d = consultar[p.codigo_cliente_omie];
      return d
        ? {
            status: 200,
            texto: JSON.stringify({ codigo_cliente_omie: p.codigo_cliente_omie, cnpj_cpf: d }),
          }
        : {
            status: 500,
            texto: JSON.stringify({
              faultstring: "ERROR: Cliente não cadastrado para o Código [x] !",
              faultcode: "SOAP-ENV:Client-103",
            }),
          };
    }
    return {
      status: 500,
      texto: JSON.stringify({ faultstring: "inesperado", faultcode: "SOAP-ENV:Client-1" }),
    };
  };
  return { transporte, chamadas };
}

const envio = (modo = "simular") => ({
  id: "c-1",
  emissora: { id: PAC, apelido: "PAC", modo_omie: modo },
  origem: "fat_emissora",
  origem_id: PAC,
  operacao: "sincronizar_contratos",
  codigo_integracao: `CONTRATOS-${PAC}`,
  modo,
  tentativas: 1,
  reserva: "r",
  payload: { versao: 1, emissora: { id: PAC, apelido: "PAC" } },
});
const contexto = (f, modo, extra = {}) => {
  const aplicados = [];
  return {
    aplicados,
    ctx: {
      omie: criarOmie({
        transporte: f.transporte,
        credencial: CRED,
        modo,
        dormir: async () => {},
        pausaMs: 0,
      }),
      modo,
      agora: () => AGORA,
      dormir: async () => {},
      departamentos: new Map(),
      statusAplicar: async () => null,
      servicosAplicar: async () => null,
      contratosAplicar: async (emissora, contratos) => {
        aplicados.push({ emissora, contratos });
        return { total: contratos.length };
      },
      ...extra,
    },
  };
};

test("casamento: vigentes de todas as páginas, clientes em lotes de 50, o que falta pelo ConsultarCliente", async () => {
  // 120 contratos em 2 páginas: 1..110 vigentes (cliente = contrato), 111..115 vencidos, 116..120 suspensos.
  const todos = Array.from({ length: 120 }, (_, i) => {
    const n = i + 1;
    return cab({
      nCodCtr: n,
      cNumCtr: `C-${n}`,
      nCodCli: n,
      cCodSit: n > 115 ? "90" : "10",
      dVigFinal: n > 110 && n <= 115 ? "01/10/2026" : "",
    });
  });
  const clientes = {};
  for (let c = 1; c <= 110; c++)
    if (c !== 7 && c !== 8) clientes[c] = `${String(10000000 + c).padStart(8, "0")}000191`;
  clientes[3] = "12.ABC.345/01DE-35"; // alfanumérico, com máscara
  clientes[4] = "1234"; // inválido: fica de fora
  const f = omieContratos({
    paginas: [todos.slice(0, 100), todos.slice(100)],
    clientes,
    consultar: { 7: "529.982.247-25" },
  });
  for (const modo of ["simular", "gravar"]) {
    f.chamadas.length = 0;
    const { ctx, aplicados } = contexto(f, modo);
    const r = await processarEnvio(envio(modo), ctx);
    assert.equal(r.status, modo === "gravar" ? "ok" : "simulado", r.erro_legivel);
    assert.ok(
      f.chamadas.every((c) => LEITURAS.has(c.metodo)),
      "só leitura no Omie",
    );
    const metodos = f.chamadas.map((c) => c.metodo);
    assert.deepEqual(metodos.filter((m) => m === "ListarContratos").length, 2);
    const lotes = f.chamadas.filter((c) => c.metodo === "ListarClientesResumido");
    assert.deepEqual(
      lotes.map((c) => c.param.clientesPorCodigo.length),
      [LOTE_CLIENTES, LOTE_CLIENTES, 10],
    );
    assert.deepEqual(
      f.chamadas
        .filter((c) => c.metodo === "ConsultarCliente")
        .map((c) => c.param.codigo_cliente_omie),
      [4, 7, 8],
    );
    const enviados = aplicados[0].contratos;
    assert.equal(aplicados[0].emissora, PAC);
    assert.equal(
      enviados.length,
      108,
      "110 vigentes menos o de documento inválido e o sem cadastro",
    );
    assert.equal(enviados.find((c) => c.codigo_contrato === 3).documento, "12ABC34501DE35");
    assert.equal(enviados.find((c) => c.codigo_contrato === 7).documento, "52998224725");
    assert.ok(!enviados.some((c) => c.codigo_contrato > 110), "vencido e suspenso ficam de fora");
    assert.equal(r.resposta.vigentes, 110);
    assert.equal(r.resposta.sem_documento, 2);
    assert.equal(r.resposta.lidos, 120);
  }
});

test("emissora sem contrato (Não existem registros) aplica lista vazia; sem folga na rodada, volta para a fila sem ler", async () => {
  const vazio = {
    transporte: async () => ({
      status: 500,
      texto: JSON.stringify({
        faultstring: "ERROR: Não existem registros para a página [1]!",
        faultcode: "SOAP-ENV:Client-5113",
      }),
    }),
    chamadas: [],
  };
  const a = contexto(vazio, "simular");
  const r = await processarEnvio(envio(), a.ctx);
  assert.equal(r.status, "simulado");
  assert.deepEqual(a.aplicados, [{ emissora: PAC, contratos: [] }]);
  const f = omieContratos({ paginas: [[cab({})]], clientes: { 10: "11222333000181" } });
  const b = contexto(f, "simular", { restaMs: () => 30_000 });
  const p = await processarEnvio(envio(), b.ctx);
  assert.equal(p.status, "pendente");
  assert.equal(p.codigos.tentar_em, AGORA.toISOString());
  assert.equal(f.chamadas.length, 0);
  assert.equal(b.aplicados.length, 0);
});
