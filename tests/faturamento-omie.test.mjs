// Conector do Omie do Portal de Faturamento (T2, 20/10/2026): montagem do cliente e da OS a partir do pedido (PJ e PF,
// à vista e parcelado, NF e recibo), tradução de erro (403, 425 MISUSE, REDUNDANT, Client-*), retry e bloqueio da
// emissora, idempotência ("já existe" = ok) e a prova de que `simular` não escreve. O Omie é simulado em memória;
// as mensagens de erro são as lidas na DOC em 20/10 e as documentadas no cliente do Financeiro.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  autorizado,
  classificarErroOmie,
  criarOmie,
  decidir,
  documentoFormatado,
  ErroOmie,
  EscritaBloqueada,
  ESCRITAS,
  LEITURAS,
  leituraStatus,
  MAX_TENTATIVAS,
  modoDoEnvio,
  montarAlterarOS,
  montarCliente,
  montarOS,
  processarEnvio,
  rodarFila,
  servicoDoOmie,
  titulosDaOS,
} from "../supabase/functions/faturamento-omie/logica.ts";

const AGORA = new Date("2026-10-20T15:00:00Z");
const CRED = { app_key: "CHAVE-APP-123456", app_secret: "SEGREDO-APP-987654" };
const DOC = "c243b1d0-0000-4000-8000-000000000001";
const PAC = "c243b1d0-0000-4000-8000-000000000002";

// ---------------------------------------------------------------------------------------------- pedidos de exemplo

const payloadPJ = (o = {}) => ({
  versao: 1,
  pedido: {
    id: "p-1",
    numero: "FAT-2026-000012",
    codigo_integracao: "FAT-2026-000012",
    valor: 1500,
    forma: "avulso",
    parcelas: 1,
    primeiro_vencimento: "2026-11-13",
    competencia: "2026-11-01",
    documento: "nf",
    meio: "boleto",
    descricao_nf: "Alteração contratual 2026 - competência 11/2026",
    projeto: "Alteração contratual 2026",
    departamento: "Jurídico",
    observacoes: "Cliente pediu boleto",
    emails_envio: [
      "Financeiro@Cliente.com.br",
      "financeiro@cliente.com.br",
      "contato@cliente.com.br",
    ],
    ...(o.pedido ?? {}),
  },
  emissora: {
    id: DOC,
    apelido: "DOC",
    cnpj: "49726267000150",
    conta_corrente_padrao: 11850365,
    ...(o.emissora ?? {}),
  },
  tomador: {
    tipo: "pj",
    documento: "11222333000181",
    nome: "CLIENTE EXEMPLO COMERCIO DE PRODUTOS E SERVICOS DE CONSULTORIA EMPRESARIAL LTDA",
    municipio: "Curitiba",
    uf: "PR",
    emails: ["fiscal@cliente.com.br"],
    codigo_cliente_integracao: "11222333000181",
    ...(o.tomador ?? {}),
  },
  servico: {
    id: "s-1",
    codigo_omie: "6931061282",
    codigo: "SRV00001",
    descricao: "Alteração de contrato social",
    codigo_lc116: "17.01",
    codigo_municipal: "170101/17.01",
    id_tributacao: "01",
    categoria: "1.01.85",
    conta_corrente: null,
    tributacao: { cRetIR: "N" },
    ...(o.servico ?? {}),
  },
  parcelas: o.parcelas ?? [{ n: 1, vencimento: "2026-11-13", valor: 1500 }],
  ...(o.omie_os_codigo ? { omie_os_codigo: o.omie_os_codigo } : {}),
});

const payloadPFParceladoRecibo = () =>
  payloadPJ({
    pedido: {
      valor: 100,
      forma: "parcelado",
      parcelas: 3,
      primeiro_vencimento: "2027-01-31",
      documento: "recibo",
      meio: "pix",
      descricao_nf: "Honorários de assessoria - 3 parcelas",
      departamento: null,
      emails_envio: ["pessoa@exemplo.com.br"],
    },
    tomador: {
      tipo: "pf",
      documento: "52998224725",
      nome: "Maria da Silva",
      municipio: null,
      uf: null,
      emails: [],
      codigo_cliente_integracao: "52998224725",
    },
    parcelas: [
      { n: 2, vencimento: "2027-02-28", valor: 33.33 },
      { n: 1, vencimento: "2027-01-31", valor: 33.33 },
      { n: 3, vencimento: "2027-03-31", valor: 33.34 },
    ],
  });

const envio = (operacao, o = {}) => ({
  id: `e-${operacao}`,
  emissora: { id: DOC, apelido: "DOC" },
  origem: operacao === "sincronizar_servicos" ? "fat_emissora" : "fat_pedido",
  origem_id: operacao === "sincronizar_servicos" ? DOC : "p-1",
  operacao,
  codigo_integracao: "FAT-2026-000012",
  modo: "simular",
  tentativas: 1,
  payload: payloadPJ(),
  cliente_omie: null,
  dependencia: null,
  ...o,
});

// ---------------------------------------------------------------------------------------------- Omie falso

const NAO_OS = {
  faultstring: "ERROR: OS não cadastrada para o Código de Integração [FAT-2026-000012] !",
  faultcode: "SOAP-ENV:Client-103",
};
const NAO_CLI = {
  faultstring: "ERROR: Cliente não cadastrado para o Código [0] !",
  faultcode: "SOAP-ENV:Client-103",
};
const SERVICO_OK = {
  cabecalho: { cCodigo: "SRV00001" },
  info: { inativo: "N" },
  intListar: { nCodServ: 6931061282 },
};
const DEPARTAMENTOS = {
  departamentos: [
    { codigo: "6938857332", descricao: "Operação", inativo: "N" },
    { codigo: "777", descricao: "Jurídico", inativo: "N" },
  ],
};

/** handlers: metodo → objeto (200) | {http, corpo} | função(param, n) que devolve um dos dois. */
function omieFalso(handlers = {}) {
  const chamadas = [];
  const transporte = async (url, corpo) => {
    const req = JSON.parse(corpo);
    const metodo = req.call;
    chamadas.push({
      url,
      metodo,
      param: req.param[0],
      tinhaChave: req.app_key === CRED.app_key && req.app_secret === CRED.app_secret,
    });
    let h = handlers[metodo];
    if (h === undefined)
      return {
        status: 500,
        texto: JSON.stringify({
          faultstring: `sem handler para ${metodo}`,
          faultcode: "SOAP-ENV:Client-999",
        }),
      };
    if (typeof h === "function")
      h = h(req.param[0], chamadas.filter((c) => c.metodo === metodo).length);
    if (h instanceof Error) throw h;
    if (h && h.http)
      return {
        status: h.http,
        texto: typeof h.corpo === "string" ? h.corpo : JSON.stringify(h.corpo),
      };
    return { status: 200, texto: JSON.stringify(h) };
  };
  return { transporte, chamadas, metodos: () => chamadas.map((c) => c.metodo) };
}
const erro500 = (corpo) => ({ http: 500, corpo });

function contexto(falso, modo = "simular", extra = {}) {
  const aplicados = { status: [], servicos: [] };
  let t = AGORA.getTime();
  const relogio = () => t;
  const ctx = {
    omie: criarOmie({
      transporte: falso.transporte,
      credencial: CRED,
      modo,
      dormir: async (ms) => {
        t += ms;
      },
      relogio,
      pausaMs: 0,
    }),
    modo,
    agora: () => new Date(relogio()),
    dormir: async (ms) => {
      t += ms;
    },
    departamentos: new Map(),
    statusAplicar: async (pedido, status) => {
      aplicados.status.push({ pedido, status });
      return { pedido: { id: pedido, status: "faturado" }, mudou: true };
    },
    servicosAplicar: async (emissora, catalogo) => {
      aplicados.servicos.push({ emissora, catalogo });
      return { entraram: 0, mudaram: 1, sairam: 0, total: catalogo.length };
    },
    ...extra,
  };
  return { ctx, aplicados };
}

const escritas = (falso) => falso.metodos().filter((m) => !LEITURAS.has(m));

// ---------------------------------------------------------------------------------------------- montagem do cliente

test("cliente PJ: código de integração = CNPJ, documento com máscara, razão social em 60, um e-mail, município e UF", () => {
  const c = montarCliente(payloadPJ());
  assert.equal(c.codigo_cliente_integracao, "11222333000181");
  assert.equal(c.cnpj_cpf, "11.222.333/0001-81");
  assert.equal(c.razao_social.length, 60);
  assert.ok(c.nome_fantasia.length > 60 && c.nome_fantasia.length <= 100);
  assert.equal(c.email, "financeiro@cliente.com.br");
  assert.equal(c.cidade, "Curitiba");
  assert.equal(c.estado, "PR");
  assert.deepEqual(c.tags, [{ tag: "Cliente" }]);
  assert.ok(!("app_key" in c) && !("pessoa_fisica" in c));
});

test("cliente PF: CPF com máscara, sem município nem UF quando o pedido não tem", () => {
  const c = montarCliente(payloadPFParceladoRecibo());
  assert.equal(c.cnpj_cpf, "529.982.247-25");
  assert.equal(c.codigo_cliente_integracao, "52998224725");
  assert.equal(c.razao_social, "Maria da Silva");
  assert.equal(c.email, "pessoa@exemplo.com.br");
  assert.ok(!("cidade" in c) && !("estado" in c));
  assert.equal(documentoFormatado("123"), "123");
});

// ---------------------------------------------------------------------------------------------- montagem da OS

test("OS PJ à vista, NF, boleto: cabeçalho, item do catálogo, e-mails, parcela, categoria e conta corrente", () => {
  const os = montarOS(payloadPJ(), {
    nCodCli: 2485994,
    cCodDepto: "777",
    categoria: "1.01.85",
    contaCorrente: 11850365,
  });
  assert.deepEqual(os.Cabecalho, {
    cCodIntOS: "FAT-2026-000012",
    nCodCli: 2485994,
    cEtapa: "50",
    dDtPrevisao: "13/11/2026",
    cCodParc: "999",
    nQtdeParc: 1,
  });
  assert.deepEqual(os.Email, {
    cEnvRecibo: "N",
    cEnvLink: "S",
    cEnvBoleto: "S",
    cEnvPix: "N",
    cEnviarPara: "financeiro@cliente.com.br; contato@cliente.com.br",
  });
  assert.deepEqual(os.InformacoesAdicionais, { cCodCateg: "1.01.85", nCodCC: 11850365 });
  assert.deepEqual(os.ServicosPrestados, [
    {
      nCodServico: 6931061282,
      cCodCategItem: "1.01.85",
      nQtde: 1,
      nValUnit: 1500,
      cDescServ: "Alteração contratual 2026 - competência 11/2026",
      cNaoGerarFinanceiro: "N",
      cReembolso: "N",
    },
  ]);
  assert.ok(
    !("impostos" in os.ServicosPrestados[0]),
    "imposto vem do cadastro do serviço, nunca do pedido",
  );
  assert.deepEqual(os.Parcelas, [
    {
      nParcela: 1,
      dDtVenc: "13/11/2026",
      nValor: 1500,
      tipo_documento: "BOL",
      meio_pagamento: "15",
      nao_gerar_boleto: "N",
    },
  ]);
  assert.deepEqual(os.Departamentos, [
    { cCodDepto: "777", nPerc: 100, nValor: 1500, nValorFixo: "S" },
  ]);
  assert.match(
    os.Observacoes.cObsOS,
    /^Pedido FAT-2026-000012 do Portal de Faturamento\. Projeto: Alteração contratual 2026\. Competência: 11\/2026\. Observações: Cliente pediu boleto$/,
  );
});

test("OS PF parcelada em 3, recibo, pix: parcelas em ordem que somam o total, recibo por OS e pix sem boleto", () => {
  const os = montarOS(payloadPFParceladoRecibo(), {
    nCodCli: 99,
    cCodDepto: null,
    categoria: "1.01.02",
    contaCorrente: 5,
  });
  assert.equal(os.Cabecalho.nQtdeParc, 3);
  assert.equal(os.Cabecalho.cCodParc, "999");
  assert.equal(os.Cabecalho.dDtPrevisao, "31/01/2027");
  assert.deepEqual(
    os.Parcelas.map((p) => [p.nParcela, p.dDtVenc, p.nValor]),
    [
      [1, "31/01/2027", 33.33],
      [2, "28/02/2027", 33.33],
      [3, "31/03/2027", 33.34],
    ],
  );
  assert.equal(Math.round(os.Parcelas.reduce((s, p) => s + p.nValor, 0) * 100), 10000);
  assert.ok(
    os.Parcelas.every(
      (p) => p.tipo_documento === "PIX" && p.meio_pagamento === "17" && p.nao_gerar_boleto === "S",
    ),
  );
  assert.equal(os.Email.cEnvRecibo, "S");
  assert.equal(os.Email.cEnvLink, "N");
  assert.equal(os.Email.cEnvPix, "S");
  assert.equal(os.Email.cEnvBoleto, "N");
  assert.equal(
    os.InformacoesAdicionais.cDadosAdicNF,
    "Honorários de assessoria - 3 parcelas",
    "recibo leva a descrição nos dados adicionais",
  );
  assert.deepEqual(os.Departamentos, []);
  assert.equal(os.ServicosPrestados[0].nValUnit, 100);
});

test("nota de débito também sai por OS com recibo; alterar mexe no item existente e tira os outros", () => {
  const nd = montarOS(payloadPJ({ pedido: { documento: "nd" } }), {
    nCodCli: 1,
    cCodDepto: null,
    categoria: "x",
    contaCorrente: 1,
  });
  assert.equal(nd.Email.cEnvRecibo, "S");
  const alt = montarAlterarOS(nd, {
    Cabecalho: { nCodOS: 3021, nCodCli: 1 },
    ServicosPrestados: [{ nIdItem: 10 }, { nIdItem: 11 }],
  });
  assert.equal(alt.Cabecalho.nCodOS, 3021);
  assert.ok(!("cCodIntOS" in alt.Cabecalho));
  assert.deepEqual(
    alt.ServicosPrestados.map((s) => [s.nIdItem, s.cAcaoItem]),
    [
      [10, "A"],
      [11, "E"],
    ],
  );
  assert.equal(alt.ServicosPrestados[0].nCodServico, 6931061282);
});

// ---------------------------------------------------------------------------------------------- erros

test("classificação dos erros do Omie (textos reais)", () => {
  const c = (http, corpo) =>
    classificarErroOmie(http, typeof corpo === "string" ? corpo : JSON.stringify(corpo)).classe;
  assert.equal(
    c(403, {
      faultstring: "A chave de acesso está inválida ou o aplicativo está suspenso [#bb83 NDAy]",
      faultcode: "SOAP-ENV:Server",
    }),
    "indisponivel",
  );
  assert.equal(
    c(425, {
      faultstring:
        "MISUSE_API_PROCESS: API bloqueada por consumo indevido. Tente novamente em 870 segundos.",
      faultcode: "SOAP-ENV:Server",
    }),
    "bloqueio",
  );
  assert.equal(
    classificarErroOmie(
      425,
      JSON.stringify({
        faultstring: "API bloqueada por consumo indevido. Tente novamente em 870 segundos.",
      }),
    ).segundos,
    870,
  );
  assert.equal(
    c(500, {
      faultstring: "ERROR: Consumo redundante detectado (REDUNDANT). Aguarde 5 segundos.",
      faultcode: "SOAP-ENV:Client-6",
    }),
    "redundante",
  );
  assert.equal(c(500, NAO_OS), "nao_encontrado");
  assert.equal(
    c(500, {
      faultstring: "ERROR: Serviço não cadastrado para o ID do Serviço [1] ! Tag [nCodServ]!",
      faultcode: "SOAP-ENV:Client-5004",
    }),
    "nao_encontrado",
  );
  assert.equal(
    c(500, {
      faultstring: "ERROR: Não existem registros para a página [1]!",
      faultcode: "SOAP-ENV:Client-5113",
    }),
    "vazio",
  );
  assert.equal(
    c(500, {
      faultstring:
        "ERROR: Ordem de Serviço já cadastrada para o Código de Integração [FAT-2026-000012]!",
      faultcode: "SOAP-ENV:Client-102",
    }),
    "ja_existe",
  );
  assert.equal(
    c(500, { faultstring: "ERROR: A OS já foi faturada!", faultcode: "SOAP-ENV:Client-8" }),
    "ja_faturada",
  );
  assert.equal(
    c(500, {
      faultstring: "ERROR: Tag [CCODPARC] não faz parte da estrutura",
      faultcode: "SOAP-ENV:Client-5001",
    }),
    "chamador",
  );
  assert.equal(c(502, "<html>Bad Gateway</html>"), "passageiro");
  assert.equal(c(null, "fetch failed"), "passageiro");
  assert.equal(c(429, ""), "passageiro");
});

const erroDe = (classe, o = {}) =>
  new ErroOmie({
    classe,
    http: 500,
    segundos: null,
    faultcode: null,
    faultstring: null,
    metodo: "IncluirOS",
    ...o,
  });

test("425 MISUSE: volta para a fila depois do bloqueio e bloqueia a emissora; 403: erro legível e emissora indisponível", () => {
  const e = envio("incluir_os", { emissora: { id: DOC, apelido: "MAROX Serviços" } });
  const m = decidir(erroDe("bloqueio", { http: 425, segundos: 870 }), e, AGORA);
  assert.equal(m.status, "pendente");
  const esperado = new Date(AGORA.getTime() + 900_000).toISOString();
  assert.equal(m.codigos.tentar_em, esperado);
  assert.equal(m.codigos.bloquear_emissora_ate, esperado);
  assert.match(m.erro_legivel, /bloqueou a chave por excesso de chamadas até 12:15/);

  const s = decidir(erroDe("indisponivel", { http: 403 }), e, AGORA);
  assert.equal(s.status, "erro");
  assert.equal(s.codigos.emissora_indisponivel, true);
  assert.match(
    s.erro_legivel,
    /^A chave do Omie da MAROX Serviços está suspensa ou inválida: peça uma nova ao administrador da empresa/,
  );
});

test("REDUNDANT volta para a fila; Client-* vira erro sem repetir; passageiro repete até o teto", () => {
  const e = envio("garantir_cliente");
  const r = decidir(erroDe("redundante", { segundos: 5 }), e, AGORA);
  assert.equal(r.status, "pendente");
  assert.equal(r.codigos.tentar_em, new Date(AGORA.getTime() + 30_000).toISOString());

  const c = decidir(
    erroDe("chamador", { faultstring: "ERROR: CNPJ/CPF inválido [11.111.111/1111-11] !" }),
    e,
    AGORA,
  );
  assert.equal(c.status, "erro");
  assert.equal(
    c.erro_legivel,
    "O Omie da DOC recusou o cadastro do cliente: CNPJ/CPF inválido [11.111.111/1111-11].",
  );

  assert.equal(
    decidir(erroDe("passageiro", { http: 502 }), { ...e, tentativas: 1 }, AGORA).status,
    "pendente",
  );
  const fim = decidir(
    erroDe("passageiro", { http: 502 }),
    { ...e, tentativas: MAX_TENTATIVAS },
    AGORA,
  );
  assert.equal(fim.status, "erro");
  assert.match(fim.erro_legivel, /não respondeu em 6 tentativas \(HTTP 502\)/);
});

test("cliente do Omie: leitura repete REDUNDANT curto e erro de rede; escrita nunca repete; chave sai do texto de erro", async () => {
  const f = omieFalso({
    ConsultarOS: (_p, n) =>
      n === 1
        ? erro500({
            faultstring: "Consumo redundante (REDUNDANT). Aguarde 3 segundos",
            faultcode: "SOAP-ENV:Client-6",
          })
        : n === 2
          ? new Error("fetch failed")
          : { Cabecalho: { nCodOS: 1 } },
    IncluirOS: erro500({
      faultstring: `ERROR: falha com ${CRED.app_key} e ${CRED.app_secret}`,
      faultcode: "SOAP-ENV:Server",
    }),
  });
  const omie = criarOmie({
    transporte: f.transporte,
    credencial: CRED,
    modo: "gravar",
    dormir: async () => {},
    pausaMs: 0,
  });
  assert.deepEqual(await omie.chamar("servicos/os", "ConsultarOS", { cCodIntOS: "X" }), {
    Cabecalho: { nCodOS: 1 },
  });
  assert.equal(f.metodos().filter((m) => m === "ConsultarOS").length, 3);
  await assert.rejects(omie.chamar("servicos/os", "IncluirOS", {}), (e) => {
    assert.ok(e instanceof ErroOmie);
    assert.equal(e.classe, "passageiro");
    assert.ok(!e.message.includes(CRED.app_key) && !e.message.includes(CRED.app_secret));
    assert.match(e.faultstring, /«chave»/);
    return true;
  });
  assert.equal(
    f.metodos().filter((m) => m === "IncluirOS").length,
    1,
    "escrita com erro passageiro não é repetida na mesma tentativa",
  );
  assert.ok(
    f.chamadas.every((c) => c.tinhaChave),
    "a chave vai só no corpo da chamada ao Omie",
  );
  assert.ok(omie.chamadas.every((c) => !JSON.stringify(c).includes(CRED.app_key)));
});

test("cliente do Omie: pausa mínima entre chamadas da mesma chave", async () => {
  const f = omieFalso({ ListarDepartamentos: { departamentos: [] } });
  let t = 0;
  const esperas = [];
  const omie = criarOmie({
    transporte: f.transporte,
    credencial: CRED,
    modo: "simular",
    relogio: () => t,
    dormir: async (ms) => {
      esperas.push(ms);
      t += ms;
    },
  });
  await omie.chamar("geral/departamentos", "ListarDepartamentos", {});
  await omie.chamar("geral/departamentos", "ListarDepartamentos", {});
  assert.deepEqual(esperas, [1100, 1100]);
});

// ---------------------------------------------------------------------------------------------- simular não escreve

test("simular: a trava recusa toda escrita antes da rede, e só leituras passam", async () => {
  const f = omieFalso({});
  const omie = criarOmie({
    transporte: f.transporte,
    credencial: CRED,
    modo: "simular",
    dormir: async () => {},
    pausaMs: 0,
  });
  for (const m of ESCRITAS) {
    await assert.rejects(omie.chamar("servicos/os", m, {}), EscritaBloqueada);
  }
  await assert.rejects(
    criarOmie({
      transporte: f.transporte,
      credencial: CRED,
      modo: "gravar",
      dormir: async () => {},
    }).chamar("servicos/osp", "CancelarOS", {}),
    /fora da lista/,
  );
  assert.equal(f.chamadas.length, 0, "nenhuma chamada chegou ao Omie");
  assert.equal(modoDoEnvio({ modo: "GRAVAR" }), "simular");
  assert.equal(modoDoEnvio({}), "simular");
  assert.equal(modoDoEnvio({ modo: "gravar", emissora: { modo_omie: "simular" } }), "conflito");
  assert.equal(modoDoEnvio({ modo: "gravar", emissora: { modo_omie: "gravar" } }), "gravar");
});

test("simular: as seis operações só leem, voltam simulado com o param que iria e o que as leituras acharam", async () => {
  const f = omieFalso({
    ConsultarCliente: erro500(NAO_CLI),
    ListarClientes: { clientes_cadastro: [] },
    ConsultarOS: erro500(NAO_OS),
    StatusOS: erro500(NAO_OS),
    ConsultarCadastroServico: SERVICO_OK,
    ListarDepartamentos: DEPARTAMENTOS,
    ListarCadastroServico: {
      nPagina: 1,
      nTotPaginas: 1,
      cadastros: [
        {
          cabecalho: { cDescricao: "Serviço A", cCodigo: "SRV1" },
          intListar: { nCodServ: 1 },
          info: { inativo: "N" },
          impostos: {},
        },
      ],
    },
    // Se qualquer escrita escapasse, este handler responderia sucesso e o teste pegaria pela lista de métodos.
    IncluirCliente: { codigo_cliente_omie: 1 },
    IncluirOS: { nCodOS: 1 },
    AlterarOS: {},
    FaturarOS: { cCodStatus: "0" },
  });
  const { ctx, aplicados } = contexto(f, "simular");
  const resultados = {};
  for (const op of [
    "garantir_cliente",
    "incluir_os",
    "alterar_os",
    "faturar_os",
    "consultar_status",
    "sincronizar_servicos",
  ]) {
    resultados[op] = await processarEnvio(envio(op), ctx);
  }
  assert.deepEqual(escritas(f), [], "nenhum Incluir/Alterar/Faturar/Upsert em simular");
  for (const [op, r] of Object.entries(resultados)) {
    assert.equal(r.status, "simulado", `${op}: ${r.erro_legivel}`);
    assert.equal(r.resposta.modo, "simular");
    assert.ok(
      !JSON.stringify(r).includes(CRED.app_key) && !JSON.stringify(r).includes(CRED.app_secret),
      `${op} sem chave`,
    );
  }
  const cli = resultados.garantir_cliente;
  assert.equal(cli.resposta.metodo, "IncluirCliente");
  assert.equal(cli.resposta.param.cnpj_cpf, "11.222.333/0001-81");
  assert.deepEqual(cli.codigos, {
    codigo_cliente_integracao: "11222333000181",
    cliente_existia: false,
  });

  const os = resultados.incluir_os;
  assert.equal(os.resposta.metodo, "IncluirOS");
  assert.equal(os.resposta.param.Cabecalho.cCodIntOS, "FAT-2026-000012");
  assert.equal(os.resposta.param.Departamentos[0].cCodDepto, "777");
  assert.deepEqual(os.codigos, { cliente_existe: false, servico_existe: true, os_existe: false });
  assert.deepEqual(os.resposta.leituras, {
    os_existe: false,
    cliente_existe: false,
    servico_existe: true,
    departamento: "777",
  });

  assert.deepEqual(resultados.faturar_os.codigos, { os_existe: false });
  assert.deepEqual(resultados.faturar_os.resposta.param, { cCodIntOS: "FAT-2026-000012" });
  // Leituras atualizam o nosso cache nos dois modos; o Omie não é tocado.
  assert.equal(aplicados.servicos.length, 1);
  assert.equal(aplicados.status.length, 0, "OS que não existe não tem status para aplicar");
  // Toda chamada feita aparece na resposta, sem param e sem chave.
  assert.ok(
    os.resposta.chamadas.length >= 3 && os.resposta.chamadas.every((c) => LEITURAS.has(c.metodo)),
  );
});

test("simular com conta corrente e categoria vazias: simulado, com os avisos do que impediria gravar", async () => {
  const f = omieFalso({
    ConsultarOS: erro500(NAO_OS),
    ConsultarCadastroServico: SERVICO_OK,
    ListarDepartamentos: DEPARTAMENTOS,
  });
  const { ctx } = contexto(f, "simular");
  const p = payloadPJ({
    emissora: { conta_corrente_padrao: null },
    servico: { categoria: null },
    pedido: { departamento: "Inexistente" },
  });
  const r = await processarEnvio(
    envio("incluir_os", {
      payload: p,
      dependencia: {
        operacao: "garantir_cliente",
        status: "simulado",
        codigos: { codigo_cliente_omie: 4214850 },
      },
    }),
    ctx,
  );
  assert.equal(r.status, "simulado");
  assert.equal(r.resposta.param.Cabecalho.nCodCli, 4214850);
  const avisos = r.resposta.avisos.join(" | ");
  assert.match(avisos, /Falta a conta corrente do Omie da DOC/);
  assert.match(avisos, /sem categoria padrão/);
  assert.match(avisos, /departamento "Inexistente" não existe/);
});

// ---------------------------------------------------------------------------------------------- gravar e idempotência

test("garantir_cliente: achado pelo código de integração não inclui; achado pelo CNPJ (cadastro à mão) também não", async () => {
  const f1 = omieFalso({
    ConsultarCliente: {
      codigo_cliente_omie: 555,
      codigo_cliente_integracao: "11222333000181",
      inativo: "N",
    },
  });
  const r1 = await processarEnvio(
    envio("garantir_cliente", { modo: "gravar" }),
    contexto(f1, "gravar").ctx,
  );
  assert.equal(r1.status, "ok");
  assert.deepEqual(r1.codigos, {
    codigo_cliente_omie: 555,
    codigo_cliente_integracao: "11222333000181",
    cliente_existia: true,
  });
  assert.deepEqual(f1.metodos(), ["ConsultarCliente"]);

  const f2 = omieFalso({
    ConsultarCliente: erro500(NAO_CLI),
    ListarClientes: {
      clientes_cadastro: [
        {
          codigo_cliente_omie: 777,
          cnpj_cpf: "11.222.333/0001-81",
          codigo_cliente_integracao: "",
          inativo: "N",
        },
      ],
    },
  });
  const r2 = await processarEnvio(
    envio("garantir_cliente", { modo: "gravar" }),
    contexto(f2, "gravar").ctx,
  );
  assert.equal(r2.status, "ok");
  assert.equal(r2.codigos.codigo_cliente_omie, 777);
  assert.equal(r2.codigos.cliente_existia, true);
  assert.deepEqual(escritas(f2), []);
  assert.deepEqual(f2.chamadas[1].param.clientesFiltro, { cnpj_cpf: "11222333000181" });
});

test("garantir_cliente em gravar: não existe → IncluirCliente; 'já cadastrado' na corrida → consulta e segue", async () => {
  const f = omieFalso({
    ConsultarCliente: (_p, n) => (n < 2 ? erro500(NAO_CLI) : { codigo_cliente_omie: 901 }),
    ListarClientes: { clientes_cadastro: [] },
    IncluirCliente: erro500({
      faultstring: "ERROR: Cliente já cadastrado para o Código de Integração [11222333000181] !",
      faultcode: "SOAP-ENV:Client-102",
    }),
  });
  const r = await processarEnvio(
    envio("garantir_cliente", { modo: "gravar" }),
    contexto(f, "gravar").ctx,
  );
  assert.equal(r.status, "ok");
  assert.equal(r.codigos.codigo_cliente_omie, 901);
  assert.deepEqual(f.metodos(), [
    "ConsultarCliente",
    "ListarClientes",
    "IncluirCliente",
    "ConsultarCliente",
  ]);
});

test("incluir_os: OS com o mesmo cCodIntOS já existe = ok, sem IncluirOS (CA-06)", async () => {
  const f = omieFalso({
    ConsultarOS: { Cabecalho: { nCodOS: 3021, cNumOS: "000123", cEtapa: "50" } },
  });
  const r = await processarEnvio(
    envio("incluir_os", { modo: "gravar", dependencia: { codigos: { codigo_cliente_omie: 1 } } }),
    contexto(f, "gravar").ctx,
  );
  assert.equal(r.status, "ok");
  assert.deepEqual(r.codigos, { nCodOS: 3021, cNumOS: "000123", cEtapa: "50", ja_existia: true });
  assert.deepEqual(f.metodos(), ["ConsultarOS"]);
});

test("incluir_os em gravar: inclui; 'já cadastrada' na resposta do IncluirOS vira sucesso pela consulta", async () => {
  const dep = {
    operacao: "garantir_cliente",
    status: "ok",
    codigos: { codigo_cliente_omie: 4214850 },
  };
  const f1 = omieFalso({
    ConsultarOS: erro500(NAO_OS),
    ConsultarCadastroServico: SERVICO_OK,
    ListarDepartamentos: DEPARTAMENTOS,
    IncluirOS: { cCodIntOS: "FAT-2026-000012", nCodOS: 3021, cNumOS: "000123", cCodStatus: "0" },
  });
  const r1 = await processarEnvio(
    envio("incluir_os", { modo: "gravar", dependencia: dep }),
    contexto(f1, "gravar").ctx,
  );
  assert.equal(r1.status, "ok", r1.erro_legivel);
  assert.deepEqual(r1.codigos, { nCodOS: 3021, cNumOS: "000123", cEtapa: "50" });
  assert.equal(f1.chamadas.find((c) => c.metodo === "IncluirOS").param.Cabecalho.nCodCli, 4214850);

  const f2 = omieFalso({
    ConsultarOS: (_p, n) =>
      n === 1 ? erro500(NAO_OS) : { Cabecalho: { nCodOS: 3022, cNumOS: "000124" } },
    ConsultarCadastroServico: SERVICO_OK,
    ListarDepartamentos: DEPARTAMENTOS,
    IncluirOS: erro500({
      faultstring:
        "ERROR: Ordem de Serviço já cadastrada para o Código de Integração [FAT-2026-000012] !",
      faultcode: "SOAP-ENV:Client-102",
    }),
  });
  const r2 = await processarEnvio(
    envio("incluir_os", { modo: "gravar", dependencia: dep }),
    contexto(f2, "gravar").ctx,
  );
  assert.equal(r2.status, "ok");
  assert.equal(r2.codigos.nCodOS, 3022);
});

test("incluir_os em gravar sem conta corrente: erro legível e nenhuma escrita", async () => {
  const f = omieFalso({
    ConsultarOS: erro500(NAO_OS),
    ConsultarCadastroServico: SERVICO_OK,
    ListarDepartamentos: DEPARTAMENTOS,
    IncluirOS: { nCodOS: 1 },
  });
  const p = payloadPJ({ emissora: { conta_corrente_padrao: null } });
  const r = await processarEnvio(
    envio("incluir_os", {
      modo: "gravar",
      payload: p,
      dependencia: { codigos: { codigo_cliente_omie: 1 } },
    }),
    contexto(f, "gravar").ctx,
  );
  assert.equal(r.status, "erro");
  assert.match(r.erro_legivel, /^Nada foi gravado no Omie\. Falta a conta corrente do Omie da DOC/);
  assert.deepEqual(escritas(f), []);
});

test("faturar_os: já faturada no Omie = ok sem FaturarOS; faturar lê a NF e os títulos", async () => {
  const faturada = {
    nCodOS: 3021,
    cEtapa: "60",
    cFaturada: "S",
    cCancelada: "N",
    dDtFat: "21/11/2026",
    cHrFat: "10:15:00",
    ListaRpsNfse: [{ nNfse: "4521", cUrlNfse: "https://nfse.exemplo/4521", cStatusRps: "004" }],
  };
  const titulos = {
    titulosEncontrados: [
      {
        cabecTitulo: {
          nCodTitulo: 999,
          cNumParcela: "001/001",
          cStatus: "AVENCER",
          cNatureza: "R",
        },
      },
    ],
  };
  const f1 = omieFalso({ StatusOS: faturada, PesquisarLancamentos: titulos });
  const e = envio("faturar_os", { modo: "gravar", payload: payloadPJ({ omie_os_codigo: 3021 }) });
  const r1 = await processarEnvio(e, contexto(f1, "gravar").ctx);
  assert.equal(r1.status, "ok");
  assert.deepEqual(r1.codigos, {
    nf_numero: "4521",
    nf_link: "https://nfse.exemplo/4521",
    nf_emitida_em: "2026-11-21T10:15:00-03:00",
    titulos: [{ parcela: 1, codigo: 999 }],
  });
  assert.deepEqual(escritas(f1), []);

  const f2 = omieFalso({
    StatusOS: (_p, n) =>
      n === 1 ? { nCodOS: 3021, cFaturada: "N", cCancelada: "N", cEtapa: "50" } : faturada,
    FaturarOS: { nCodOS: 3021, cCodStatus: "0", cDescStatus: "OS faturada com sucesso" },
    PesquisarLancamentos: titulos,
  });
  const r2 = await processarEnvio(e, contexto(f2, "gravar").ctx);
  assert.equal(r2.status, "ok");
  assert.equal(r2.codigos.nf_numero, "4521");
  assert.deepEqual(f2.metodos(), ["StatusOS", "FaturarOS", "StatusOS", "PesquisarLancamentos"]);
  assert.deepEqual(f2.chamadas[1].param, { nCodOS: 3021 });
});

test("faturar_os com boleto vencido: erro antes de chamar o FaturarOS", async () => {
  const f = omieFalso({
    StatusOS: { nCodOS: 3021, cFaturada: "N", cCancelada: "N" },
    FaturarOS: { cCodStatus: "0" },
  });
  const p = payloadPJ({
    omie_os_codigo: 3021,
    parcelas: [{ n: 1, vencimento: "2026-10-13", valor: 1500 }],
  });
  const r = await processarEnvio(
    envio("faturar_os", { modo: "gravar", payload: p }),
    contexto(f, "gravar").ctx,
  );
  assert.equal(r.status, "erro");
  assert.match(
    r.erro_legivel,
    /vence em 13\/10\/2026, antes de hoje: o Omie não fatura boleto vencido/,
  );
  assert.deepEqual(escritas(f), []);
});

test("consultar_status: etapa, NF, títulos pagos e em atraso → fat_status_aplicar", async () => {
  const f = omieFalso({
    StatusOS: {
      nCodOS: 3021,
      cEtapa: "60",
      cFaturada: "S",
      dDtFat: "21/11/2026",
      cHrFat: "10:15",
      ListaRpsNfse: [
        { nNfse: "", cUrlNfse: "" },
        { nNfse: "4521", cUrlPdfDest: "https://pdf" },
      ],
    },
    PesquisarLancamentos: {
      titulosEncontrados: [
        {
          cabecTitulo: {
            nCodTitulo: 2,
            cNumParcela: "002/002",
            cStatus: "ATRASADO",
            cNatureza: "R",
          },
        },
        {
          cabecTitulo: {
            nCodTitulo: 1,
            cNumParcela: "001/002",
            cStatus: "RECEBIDO",
            dDtPagamento: "12/11/2026",
            cNatureza: "R",
          },
        },
      ],
    },
  });
  const { ctx, aplicados } = contexto(f, "gravar");
  const r = await processarEnvio(
    envio("consultar_status", { modo: "gravar", payload: payloadPJ({ omie_os_codigo: 3021 }) }),
    ctx,
  );
  assert.equal(r.status, "ok");
  assert.deepEqual(aplicados.status[0].status, {
    os: { codigo: 3021, etapa: "60" },
    lido_em: AGORA.toISOString(),
    nf: { numero: "4521", link: "https://pdf", emitida_em: "2026-11-21T10:15:00-03:00" },
    titulos: [
      { parcela: 1, codigo: 1, situacao: "pago", pago_em: "2026-11-12" },
      { parcela: 2, codigo: 2, situacao: "em_atraso" },
    ],
  });
  assert.equal(aplicados.status[0].pedido, "p-1");
});

test("leitura de recibo: o número do recibo ocupa o lugar da nota; OS não faturada não leva nota", () => {
  const rec = leituraStatus(
    {
      nCodOS: 5,
      cEtapa: "60",
      cFaturada: "S",
      cNumRecibo: "88",
      cUrlPdfRecibo: "https://recibo",
      dDtFat: "01/12/2026",
    },
    null,
    "x",
  );
  assert.deepEqual(rec.nf, {
    numero: "88",
    link: "https://recibo",
    emitida_em: "2026-12-01T00:00:00-03:00",
  });
  assert.ok(!("nf" in leituraStatus({ nCodOS: 5, cFaturada: "N", cNumRecibo: "" }, null, "x")));
  assert.deepEqual(
    titulosDaOS({
      titulosEncontrados: [
        { cabecTitulo: { cNumParcela: "001/001", cStatus: "VENCEHOJE", cNatureza: "P" } },
      ],
    }),
    [],
  );
});

test("sincronizar_servicos: pagina de 50 em 50 e manda o catálogo ao banco; lista vazia não apaga nada", async () => {
  const pag = (n, tot, cods) => ({
    nPagina: n,
    nTotPaginas: tot,
    cadastros: cods.map((c) => ({
      cabecalho: {
        cDescricao: `Serviço ${c}`,
        cCodigo: `SRV${c}`,
        cCodLC116: "17.01",
        cCodServMun: "1701",
        cIdTrib: "01",
        cCodCateg: "1.01.02",
      },
      intListar: { nCodServ: c },
      info: { inativo: c === 3 ? "S" : "N" },
      impostos: { nAliqISS: 2 },
    })),
  });
  const f = omieFalso({
    ListarCadastroServico: (p) => (p.nPagina === 1 ? pag(1, 2, [1, 2]) : pag(2, 2, [3])),
  });
  const { ctx, aplicados } = contexto(f, "simular");
  const r = await processarEnvio(envio("sincronizar_servicos"), ctx);
  assert.equal(r.status, "simulado");
  assert.deepEqual(
    f.chamadas.map((c) => [c.param.nPagina, c.param.nRegPorPagina]),
    [
      [1, 50],
      [2, 50],
    ],
  );
  assert.equal(aplicados.servicos[0].emissora, DOC);
  assert.deepEqual(aplicados.servicos[0].catalogo[2], {
    codigo_omie: "3",
    descricao: "Serviço 3",
    codigo: "SRV3",
    codigo_lc116: "17.01",
    codigo_municipal: "1701",
    id_tributacao: "01",
    tributacao: { nAliqISS: 2 },
    categoria: "1.01.02",
    inativo: true,
  });
  assert.equal(servicoDoOmie({}).codigo_omie, "");
  assert.ok(
    !("tributacao" in servicoDoOmie({ impostos: null })),
    "sem impostos a chave não vai: o banco recusa tributacao nula",
  );

  const vazio = omieFalso({
    ListarCadastroServico: erro500({
      faultstring: "ERROR: Não existem registros para a página [1]!",
      faultcode: "SOAP-ENV:Client-5113",
    }),
  });
  const c2 = contexto(vazio, "gravar");
  const r2 = await processarEnvio(envio("sincronizar_servicos", { modo: "gravar" }), c2.ctx);
  assert.equal(r2.status, "erro");
  assert.match(r2.erro_legivel, /catálogo de serviços vazio: nada mudou/);
  assert.equal(c2.aplicados.servicos.length, 0);
});

// ---------------------------------------------------------------------------------------------- a fila

function filaFalsa(lotes) {
  const respostas = [];
  let i = 0;
  return {
    respostas,
    reservar: async () => lotes[i++] ?? [],
    responder: async (id, r) => {
      respostas.push({ id, ...r });
    },
  };
}

test("fila: MISUSE na DOC para a DOC na rodada (o resto da DOC volta para depois do bloqueio) e a PAC segue", async () => {
  const doc1 = envio("garantir_cliente", { id: "d1" });
  const doc2 = envio("garantir_cliente", { id: "d2" });
  const pac1 = envio("garantir_cliente", { id: "p1", emissora: { id: PAC, apelido: "PAC" } });
  const fila = filaFalsa([[doc1, pac1, doc2]]);
  const porChave = {
    DOC: {
      ConsultarCliente: {
        http: 425,
        corpo: {
          faultstring: "MISUSE_API_PROCESS: consumo indevido. Tente novamente em 200 segundos.",
        },
      },
    },
    PAC: { ConsultarCliente: { codigo_cliente_omie: 1 } },
  };
  const chamadas = [];
  const transporte = async (url, corpo) => {
    const req = JSON.parse(corpo);
    const quem = req.app_key === "k-DOC" ? "DOC" : "PAC";
    chamadas.push(`${quem}:${req.call}`);
    const h = porChave[quem][req.call];
    return h.http
      ? { status: h.http, texto: JSON.stringify(h.corpo) }
      : { status: 200, texto: JSON.stringify(h) };
  };
  let t = AGORA.getTime();
  const resumo = await rodarFila({
    ...fila,
    credencial: async (id) =>
      id === DOC
        ? { app_key: "k-DOC", app_secret: "s-DOC" }
        : { app_key: "k-PAC", app_secret: "s-PAC" },
    statusAplicar: async () => null,
    servicosAplicar: async () => null,
    transporte,
    dormir: async (ms) => {
      t += ms;
    },
    relogio: () => t,
    pausaMs: 0,
  });
  assert.deepEqual(
    chamadas,
    ["DOC:ConsultarCliente", "PAC:ConsultarCliente"],
    "depois do 425 a DOC não é chamada de novo",
  );
  const [r1, r2, r3] = fila.respostas;
  assert.equal(r1.status, "pendente");
  assert.ok(r1.codigos.bloquear_emissora_ate);
  assert.equal(r2.status, "simulado");
  assert.equal(r3.id, "d2");
  assert.equal(r3.status, "pendente");
  assert.equal(r3.codigos.tentar_em, r1.codigos.bloquear_emissora_ate);
  assert.deepEqual(resumo.por_status, { pendente: 2, simulado: 1 });
  assert.equal(resumo.emissoras_paradas[0].motivo, "bloqueio");
});

test("fila: 403 marca a emissora indisponível (CA-12), chave ausente no cofre idem, e as outras seguem", async () => {
  const doc1 = envio("garantir_cliente", { id: "d1" });
  const doc2 = envio("incluir_os", { id: "d2" });
  const pac1 = envio("garantir_cliente", { id: "p1", emissora: { id: PAC, apelido: "PAC" } });
  const pis1 = envio("garantir_cliente", { id: "s1", emissora: { id: "pis", apelido: "PIS" } });
  const fila = filaFalsa([
    [doc1, doc2],
    [pac1, pis1],
  ]);
  const transporte = async (_u, corpo) => {
    const req = JSON.parse(corpo);
    if (req.app_key === "k-DOC")
      return {
        status: 403,
        texto: JSON.stringify({
          faultstring: "A chave de acesso está inválida ou o aplicativo está suspenso",
          faultcode: "SOAP-ENV:Server",
        }),
      };
    return { status: 200, texto: JSON.stringify({ codigo_cliente_omie: 1 }) };
  };
  const resumo = await rodarFila({
    ...fila,
    credencial: async (id) => {
      if (id === "pis")
        throw Object.assign(new Error("Segredo omie_pis da emissora PIS não está no Vault"), {
          code: "P0002",
        });
      return { app_key: id === DOC ? "k-DOC" : "k-PAC", app_secret: "s" };
    },
    statusAplicar: async () => null,
    servicosAplicar: async () => null,
    transporte,
    dormir: async () => {},
    pausaMs: 0,
  });
  const por = Object.fromEntries(fila.respostas.map((r) => [r.id, r]));
  assert.equal(por.d1.status, "erro");
  assert.equal(por.d1.codigos.emissora_indisponivel, true);
  assert.equal(por.d2.status, "erro");
  assert.equal(por.d2.erro_legivel, por.d1.erro_legivel);
  assert.equal(por.d2.resposta.liberado, "emissora indisponível nesta rodada");
  assert.equal(por.p1.status, "simulado");
  assert.equal(por.s1.status, "erro");
  assert.match(por.s1.erro_legivel, /A chave do Omie da PIS não está no cofre do Brain/);
  assert.equal(resumo.reservados, 4);
});

test("fila: fim do tempo devolve o que sobrou para a fila na hora; gravar com a emissora de volta em simulação não grava", async () => {
  const a = envio("garantir_cliente", { id: "a" });
  const b = envio("garantir_cliente", { id: "b" });
  const c = envio("incluir_os", {
    id: "c",
    modo: "gravar",
    emissora: { id: PAC, apelido: "PAC", modo_omie: "simular" },
  });
  const fila = filaFalsa([[a, b, c]]);
  let t = 0;
  const resumo = await rodarFila({
    ...fila,
    credencial: async () => CRED,
    statusAplicar: async () => null,
    servicosAplicar: async () => null,
    transporte: async () => {
      t += 90_000;
      return { status: 200, texto: JSON.stringify({ codigo_cliente_omie: 1 }) };
    },
    dormir: async () => {},
    relogio: () => t,
    pausaMs: 0,
  });
  assert.equal(fila.respostas[0].status, "simulado");
  assert.equal(fila.respostas[1].status, "pendente");
  assert.equal(fila.respostas[1].resposta.liberado, "fim do tempo da rodada");
  assert.equal(
    fila.respostas[2].status,
    "pendente",
    "o tempo acabou antes; o conflito seria erro sem gravar",
  );
  assert.equal(resumo.reservados, 3);

  const fila2 = filaFalsa([[c]]);
  const transportes = [];
  await rodarFila({
    ...fila2,
    credencial: async () => CRED,
    statusAplicar: async () => null,
    servicosAplicar: async () => null,
    transporte: async (u) => {
      transportes.push(u);
      return { status: 200, texto: "{}" };
    },
    dormir: async () => {},
    pausaMs: 0,
  });
  assert.equal(fila2.respostas[0].status, "erro");
  assert.match(
    fila2.respostas[0].erro_legivel,
    /voltou para simulação depois que o pedido entrou na fila: nada foi gravado/,
  );
  assert.equal(transportes.length, 0);
});

test("fila: resposta recusada pelo banco não derruba a rodada", async () => {
  const fila = {
    reservar: (() => {
      let i = 0;
      return async () =>
        i++ ? [] : [envio("garantir_cliente", { id: "x" }), envio("garantir_cliente", { id: "y" })];
    })(),
    responder: async (id) => {
      if (id === "x") throw new Error("55000 envio não está processando");
    },
  };
  const resumo = await rodarFila({
    ...fila,
    credencial: async () => CRED,
    statusAplicar: async () => null,
    servicosAplicar: async () => null,
    transporte: async () => ({ status: 200, texto: JSON.stringify({ codigo_cliente_omie: 1 }) }),
    dormir: async () => {},
    pausaMs: 0,
  });
  assert.equal(resumo.erros_banco.length, 1);
  assert.equal(resumo.por_status.simulado, 2);
});

// ---------------------------------------------------------------------------------------------- acesso

test("a edge só aceita a chave de serviço ou o cabeçalho do cron com o segredo", () => {
  const h = (o) => ({ get: (n) => o[n.toLowerCase()] ?? null });
  const SERV = "service-role-chave";
  const SEG = "segredo-do-cron-com-32-caracteres!!";
  assert.equal(autorizado(h({ authorization: `Bearer ${SERV}` }), SERV, SEG), true);
  assert.equal(autorizado(h({ "x-faturamento-cron": SEG }), SERV, SEG), true);
  assert.equal(autorizado(h({ authorization: "Bearer anon" }), SERV, SEG), false);
  assert.equal(autorizado(h({ "x-faturamento-cron": SEG.slice(0, -1) + "?" }), SERV, SEG), false);
  assert.equal(
    autorizado(h({ "x-faturamento-cron": "" }), SERV, ""),
    false,
    "sem segredo configurado, o cron não entra",
  );
  assert.equal(autorizado(h({}), "", null), false);
});
