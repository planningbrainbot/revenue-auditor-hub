// Recorrente do Portal de Faturamento (E2, 29/10/2026), parte do conector: o contrato com dia de faturamento, itens,
// projeto e nome do cliente; e a leitura nova de notas de contrato (NFS-e pelo nCodigoContrato, recibos por OS com
// cTipoFat REC), que alimenta o "faturado no mês anterior" e a conferência depois do corte. Só leitura no Omie.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contratoDoOmie,
  contratoRecente,
  criarOmie,
  inicioMesAnterior,
  LEITURAS,
  notaDoOmie,
  OPERACOES,
  periodoNotas,
  processarEnvio,
  reciboDoOmie,
} from "../supabase/functions/faturamento-omie/logica.ts";

const AGORA = new Date("2026-10-29T15:00:00Z");
const PAC = "8cdf5de7-683f-4d8e-a194-f303677ac6ea";
const CRED = { app_key: "CHAVE-APP-123456", app_secret: "SEGREDO-APP-987654" };

// Formato lido de um contrato real da PAC em 29/10/2026 (valores trocados).
const contratoOmie = (o = {}) => ({
  cabecalho: {
    cCodSit: "10",
    cNumCtr: "2021/00001",
    cTipoFat: "01",
    dVigFinal: "",
    dVigInicial: "01/01/2021",
    nCodCli: 853629632,
    nCodCtr: 854048955,
    nDiaFat: 15,
    nValTotMes: 1500,
    ...(o.cabecalho ?? {}),
  },
  infAdic: { cCodCateg: "1.06.96", nCodCC: 9254116564, nCodProj: 854062640, ...(o.infAdic ?? {}) },
  itensContrato: o.itensContrato ?? [
    {
      itemCabecalho: { codServico: 853565608, quant: 1, valorUnit: 1500, valorTotal: 1500 },
      itemDescrServ: { descrCompleta: "Honorários Contábeis" },
    },
  ],
  vencTextos: { nDiaFixo: 10 },
});

test("contrato do Omie: dia de faturamento, tipo, vencimento, projeto, categoria e itens", () => {
  const c = contratoDoOmie(contratoOmie());
  assert.equal(c.dia_faturamento, 15);
  assert.equal(c.tipo_faturamento, "01");
  assert.equal(c.dia_vencimento, 10);
  assert.equal(c.codigo_projeto, 854062640);
  assert.equal(c.categoria, "1.06.96");
  assert.deepEqual(c.itens, [
    {
      servico: "Honorários Contábeis",
      codigo_servico: "853565608",
      quantidade: 1,
      valor_unitario: 1500,
      valor_total: 1500,
    },
  ]);
  assert.equal(contratoDoOmie(contratoOmie({ cabecalho: { nDiaFat: 0 } })).dia_faturamento, null);
  assert.equal(contratoDoOmie(contratoOmie({ infAdic: { nCodProj: 0 } })).codigo_projeto, null);
});

test("recentes: vigência final vazia ou a partir do 1º dia do mês anterior (virada de ano incluída)", () => {
  assert.equal(inicioMesAnterior("2026-10-29"), "2026-09-01");
  assert.equal(inicioMesAnterior("2027-01-05"), "2026-12-01");
  assert.equal(contratoRecente({ vigencia_final: null }, "2026-09-01"), true);
  assert.equal(contratoRecente({ vigencia_final: "2026-09-01" }, "2026-09-01"), true);
  assert.equal(contratoRecente({ vigencia_final: "2026-08-31" }, "2026-09-01"), false);
});

test("nota de contrato: liga pelo nCodigoContrato; sem contrato fica de fora; cancelada é marcada", () => {
  const nfse = (o = {}) => ({
    Cabecalho: {
      nCodNF: 77,
      nNumeroNFSe: "4321",
      nValorNFSe: 1500,
      nCodigoCliente: 853629632,
      cStatusNFSe: "F",
      ...o.cab,
    },
    OrdemServico: { nCodigoContrato: 854048955, nCodigoOS: 991, ...o.os },
    Emissao: { cDataEmissao: "15/10/2026", ...o.em },
    Cancelamento: o.canc ?? {},
  });
  assert.deepEqual(notaDoOmie(nfse()), {
    chave: "nfse:77",
    codigo_contrato: 854048955,
    codigo_cliente_omie: 853629632,
    codigo_os: 991,
    numero: "4321",
    emitida_em: "2026-10-15",
    valor: 1500,
    cancelada: false,
  });
  assert.equal(
    notaDoOmie(nfse({ os: { nCodigoContrato: 0 } })),
    null,
    "nota avulsa não é de contrato",
  );
  assert.equal(
    notaDoOmie(nfse({ em: { cDataEmissao: "15/10/2026 10:12:00" } })).emitida_em,
    "2026-10-15",
  );
  assert.equal(notaDoOmie(nfse({ canc: { cDataCancelamento: "20/10/2026" } })).cancelada, true);
});

test("recibo de contrato: só OS faturada; liga pelo nCodCtr ou pelo número do contrato", () => {
  const os = (o = {}) => ({
    Cabecalho: {
      nCodOS: 555,
      cNumOS: "000555",
      nCodCli: 2,
      nCodCtr: 0,
      nValorTotal: 3000,
      ...o.cab,
    },
    InfoCadastro: { cFaturada: "S", cCancelada: "N", dDtFat: "15/10/2026", ...o.inf },
    InformacoesAdicionais: { cNumContrato: "T-003", ...o.adic },
  });
  const r = reciboDoOmie(os());
  assert.equal(r.chave, "recibo:555");
  assert.equal(r.codigo_contrato, null);
  assert.equal(r.numero_contrato, "T-003");
  assert.equal(r.numero, "000555");
  assert.equal(r.emitida_em, "2026-10-15");
  assert.equal(reciboDoOmie(os({ inf: { cFaturada: "N" } })), null, "OS não faturada não é recibo");
  assert.equal(
    reciboDoOmie(os({ adic: { cNumContrato: "" } })),
    null,
    "OS sem contrato fica de fora",
  );
  assert.equal(
    reciboDoOmie(os({ cab: { nCodCtr: 9 }, adic: { cNumContrato: "" } })).codigo_contrato,
    9,
  );
  assert.equal(reciboDoOmie(os({ inf: { cCancelada: "S" } })).cancelada, true);
});

test("período das notas: o do payload, ou do 1º dia do mês anterior até hoje", () => {
  assert.deepEqual(periodoNotas({ de: "2026-10-01", ate: "2026-10-31" }, "2026-11-02"), {
    de: "2026-10-01",
    ate: "2026-10-31",
  });
  assert.deepEqual(periodoNotas({}, "2026-10-29"), { de: "2026-09-01", ate: "2026-10-29" });
  assert.deepEqual(periodoNotas({ de: "2026-11-01", ate: "2026-10-01" }, "2026-10-29"), {
    de: "2026-09-01",
    ate: "2026-10-29",
  });
});

function omieRecorrente(h) {
  const chamadas = [];
  const transporte = async (_u, corpo) => {
    const req = JSON.parse(corpo);
    const p = req.param[0];
    chamadas.push({ metodo: req.call, param: p });
    const r = h[req.call]?.(p);
    if (r === undefined)
      return {
        status: 500,
        texto: JSON.stringify({
          faultstring: `sem handler para ${req.call}`,
          faultcode: "SOAP-ENV:Client-999",
        }),
      };
    return { status: 200, texto: JSON.stringify(r) };
  };
  return { transporte, chamadas };
}

const envio = (operacao, payload = {}) => ({
  id: "e-1",
  emissora: { id: PAC, apelido: "PAC", modo_omie: "simular" },
  origem: "fat_emissora",
  origem_id: PAC,
  operacao,
  codigo_integracao: `${operacao === "sincronizar_notas" ? "NOTAS" : "CONTRATOS"}-${PAC}`,
  modo: "simular",
  tentativas: 1,
  reserva: "r",
  payload: { versao: 1, emissora: { id: PAC, apelido: "PAC" }, ...payload },
});

function contexto(f, extra = {}) {
  const aplicados = { contratos: [], notas: [] };
  return {
    aplicados,
    ctx: {
      omie: criarOmie({
        transporte: f.transporte,
        credencial: CRED,
        modo: "simular",
        dormir: async () => {},
        pausaMs: 0,
      }),
      modo: "simular",
      agora: () => AGORA,
      dormir: async () => {},
      departamentos: new Map(),
      statusAplicar: async () => null,
      servicosAplicar: async () => null,
      contratosAplicar: async (emissora, contratos) => {
        aplicados.contratos.push({ emissora, contratos });
        return { total: contratos.length };
      },
      notasAplicar: async (emissora, de, ate, notas) => {
        aplicados.notas.push({ emissora, de, ate, notas });
        return { gravadas: notas.length };
      },
      ...extra,
    },
  };
}

test("sincronizar_contratos: pede os itens, casa o nome do cliente e o nome do projeto", async () => {
  const f = omieRecorrente({
    ListarContratos: () => ({
      pagina: 1,
      total_de_paginas: 1,
      contratoCadastro: [
        contratoOmie(),
        contratoOmie({
          cabecalho: { nCodCtr: 2, nCodCli: 3, dVigFinal: "31/10/2026" },
          infAdic: { nCodProj: 0 },
        }),
        contratoOmie({ cabecalho: { nCodCtr: 4, nCodCli: 5, dVigFinal: "31/07/2026" } }),
      ],
    }),
    ListarClientesResumido: (p) => ({
      clientes_cadastro_resumido: p.clientesPorCodigo.map((x) => ({
        codigo_cliente: x.codigo_cliente_omie,
        cnpj_cpf: x.codigo_cliente_omie === 3 ? "11.444.777/0001-61" : "11.222.333/0001-81",
        razao_social: `CLIENTE ${x.codigo_cliente_omie}`,
      })),
    }),
    ListarProjetos: () => ({
      total_de_paginas: 1,
      cadastro: [{ codigo: 854062640, nome: "MAIÊ" }],
    }),
  });
  const { ctx, aplicados } = contexto(f);
  const r = await processarEnvio(envio("sincronizar_contratos"), ctx);
  assert.equal(r.status, "simulado", r.erro_legivel);
  assert.equal(f.chamadas.find((c) => c.metodo === "ListarContratos").param.cExibirProdutos, "S");
  const enviados = aplicados.contratos[0].contratos;
  assert.deepEqual(
    enviados.map((c) => [c.codigo_contrato, c.cliente_nome, c.projeto]),
    [
      [854048955, "CLIENTE 853629632", "MAIÊ"],
      [2, "CLIENTE 3", null],
    ],
    "o vencido em julho fica de fora; o que vence em outubro entra",
  );
  assert.equal(enviados[0].dia_faturamento, 15);
  assert.ok(
    f.chamadas.every((c) => LEITURAS.has(c.metodo)),
    "só leitura",
  );
});

test("sincronizar_notas: NFS-e de contrato e recibos do período, em páginas; só leitura; aplica o período", async () => {
  assert.ok(OPERACOES.includes("sincronizar_notas"));
  const nfse = (cod, ctr) => ({
    Cabecalho: { nCodNF: cod, nNumeroNFSe: String(cod), nValorNFSe: 100, nCodigoCliente: 1 },
    OrdemServico: { nCodigoContrato: ctr, nCodigoOS: cod },
    Emissao: { cDataEmissao: "15/10/2026" },
  });
  const f = omieRecorrente({
    ListarNFSEs: (p) =>
      p.nPagina === 1
        ? { nPagina: 1, nTotPaginas: 2, nfseEncontradas: [nfse(1, 10), nfse(2, 0)] }
        : { nPagina: 2, nTotPaginas: 2, nfseEncontradas: [nfse(3, 11)] },
    ListarOS: () => ({
      pagina: 1,
      total_de_paginas: 1,
      osCadastro: [
        {
          Cabecalho: { nCodOS: 50, nCodCli: 2, nCodCtr: 12, nValorTotal: 300 },
          InfoCadastro: { cFaturada: "S", dDtFat: "16/10/2026" },
          InformacoesAdicionais: {},
        },
      ],
    }),
  });
  const { ctx, aplicados } = contexto(f);
  const r = await processarEnvio(
    envio("sincronizar_notas", { de: "2026-10-01", ate: "2026-10-31" }),
    ctx,
  );
  assert.equal(r.status, "simulado", r.erro_legivel);
  assert.ok(
    f.chamadas.every((c) => LEITURAS.has(c.metodo)),
    "só leitura",
  );
  const nf = f.chamadas.find((c) => c.metodo === "ListarNFSEs").param;
  assert.equal(nf.dEmiInicial, "01/10/2026");
  assert.equal(nf.dEmiFinal, "31/10/2026");
  assert.equal(f.chamadas.find((c) => c.metodo === "ListarOS").param.cTipoFat, "REC");
  const a = aplicados.notas[0];
  assert.equal(a.de, "2026-10-01");
  assert.equal(a.ate, "2026-10-31");
  assert.deepEqual(
    a.notas.map((n) => n.chave),
    ["nfse:1", "nfse:3", "recibo:50"],
  );
  assert.equal(r.resposta.nfse_lidas, 3);
  assert.equal(r.resposta.de_contrato, 3);
});

test("sincronizar_notas sem folga na rodada volta para a fila sem ler", async () => {
  const f = omieRecorrente({});
  const { ctx, aplicados } = contexto(f, { restaMs: () => 30_000 });
  const r = await processarEnvio(envio("sincronizar_notas"), ctx);
  assert.equal(r.status, "pendente");
  assert.equal(f.chamadas.length, 0);
  assert.equal(aplicados.notas.length, 0);
});
