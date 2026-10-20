// Pipefy do Portal de Faturamento (T3, 20/10/2026): montagem do card do pipe 307098392 a partir do pedido (PJ e PF, à
// vista e parcelado, NF e recibo), validação contra o schema do pipe, sequência de fases com os obrigatórios que travam
// a saída, e a prova de que, com pipefy_sync = false, nenhuma mutation sai. O Pipefy é simulado em memória.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALVO,
  criarPipefy,
  decidirPipefy,
  erroDoValor,
  ErroPipefy,
  FASE,
  montarCriarCard,
  MutacaoBloqueada,
  opcaoCompetencia,
  opcaoEmpresa,
  planejar,
  preenchidosEstimados,
  processarPipefy,
  rodarFilaPipefy,
  rota,
  validarCampos,
  validarCriarCard,
  validarPassos,
} from "../supabase/functions/faturamento-omie/pipefy.ts";
import {
  CAMPOS_INICIO,
  FASES,
  OPCAO_CONFERIDO,
} from "../supabase/functions/faturamento-omie/pipefy-307098392.ts";

const AGORA = new Date("2026-10-20T15:00:00Z");
const DOC = "c243b1d0-0000-4000-8000-000000000001";
const COLABS = new Map([
  ["rafael.andrade@planning.com.br", "401"],
  ["hugo.silva@planning.com.br", "402"],
  ["flavia.abreu@planning.com.br", "403"],
]);
const colaborador = (email) => COLABS.get(email) ?? null;

const payloadPJ = (o = {}) => ({
  versao: 1,
  status: "na_fila_omie",
  pedido: {
    id: "p-1",
    numero: "FAT-2026-000012",
    codigo_integracao: "FAT-2026-000012",
    valor: 1500,
    forma: "avulso",
    parcelas: 1,
    primeiro_vencimento: "2026-11-13",
    competencia: "2026-10-01",
    documento: "nf",
    meio: "boleto",
    descricao_nf: "Alteração contratual 2026 - competência 10/2026",
    projeto: "Alteração contratual 2026",
    departamento: "Jurídico",
    observacoes: "Cliente pediu boleto",
    emails_envio: ["financeiro@cliente.com.br", "contato@cliente.com.br"],
    ...(o.pedido ?? {}),
  },
  emissora: {
    id: DOC,
    apelido: "DOC",
    cnpj: "49726267000150",
    conta_corrente_padrao: null,
    ...(o.emissora ?? {}),
  },
  tomador: {
    tipo: "pj",
    documento: "11222333000181",
    nome: "CLIENTE EXEMPLO LTDA",
    municipio: "Curitiba",
    uf: "PR",
    emails: [],
    codigo_cliente_integracao: "11222333000181",
    ...(o.tomador ?? {}),
  },
  servico: {
    id: "s-1",
    codigo_omie: "6931061282",
    codigo: "SRV00001",
    descricao: "Alteração de contrato social",
    categoria: "1.01.85",
  },
  parcelas: o.parcelas ?? [{ n: 1, vencimento: "2026-11-13", valor: 1500 }],
  solicitante: { id: "u-1", nome: "Rafael", email: "Rafael.Andrade@planning.com.br" },
  dono: { id: "u-2", nome: "Hugo", email: "hugo.silva@planning.com.br" },
  omie_os_codigo: null,
});
const payloadPF = () =>
  payloadPJ({
    pedido: {
      valor: 100,
      forma: "parcelado",
      parcelas: 3,
      primeiro_vencimento: "2027-01-31",
      competencia: "2026-09-01",
      documento: "recibo",
      meio: "pix",
      departamento: null,
      emails_envio: ["pessoa@exemplo.com.br"],
    },
    tomador: {
      tipo: "pf",
      documento: "52998224725",
      nome: "Maria da Silva",
      codigo_cliente_integracao: "52998224725",
    },
    parcelas: [
      { n: 1, vencimento: "2027-01-31", valor: 33.33 },
      { n: 2, vencimento: "2027-02-28", valor: 33.33 },
      { n: 3, vencimento: "2027-03-31", valor: 33.34 },
    ],
  });
const campos = (input) =>
  Object.fromEntries(input.fields_attributes.map((f) => [f.field_id, f.field_value]));
const OBRIGATORIOS = Object.entries(CAMPOS_INICIO)
  .filter(([, d]) => d.obrigatorio)
  .map(([k]) => k)
  .sort();

// ---------------------------------------------------------------------------------------------- schema

test("schema: 17 obrigatórios no formulário (CPF e CNPJ não), checklist novo em SOLICITAÇÃO ABERTA", () => {
  assert.equal(OBRIGATORIOS.length, 17);
  assert.ok(!OBRIGATORIOS.includes("cnpj_cliente_1") && !OBRIGATORIOS.includes("cpf_do_cliente"));
  assert.deepEqual(FASES[FASE.ABERTA].campos.cpf_cnpj_do_cliente_conferido, {
    label: "CPF/CNPJ do cliente conferido",
    tipo: "checklist_vertical",
    obrigatorio: true,
    opcoes: [OPCAO_CONFERIDO],
  });
  assert.equal(FASES[FASE.REALIZADO].campos.upload_do_e_mail.obrigatorio, true);
  assert.equal(
    opcaoEmpresa("49726267000150"),
    "DOC - DOC ASSESSORIA SOCIETARIA 49.726.267/0001-50",
  );
  assert.equal(opcaoEmpresa("68616679000181"), null, "a FINANCE não tem opção no pipe");
});

// ---------------------------------------------------------------------------------------------- montagem

test("card PJ à vista, NF, boleto: os 17 obrigatórios com as opções exatas e o card valida contra o schema", () => {
  const { input, faltas, avisos } = montarCriarCard(payloadPJ(), { colaborador, agora: AGORA });
  const c = campos(input);
  assert.deepEqual(faltas, []);
  for (const k of OBRIGATORIOS) assert.ok(k in c, `falta ${k}`);
  assert.equal(input.pipe_id, "307098392");
  assert.ok(!("phase_id" in input) && !("title" in input) && !("submitterEmail" in input));
  assert.deepEqual(c.respons_vel_pela_solicita_o_1, ["401"]);
  assert.deepEqual(c.coordena_o_respons_vel, ["402"]);
  assert.equal(c.empresa_de_faturamento, "DOC - DOC ASSESSORIA SOCIETARIA 49.726.267/0001-50");
  assert.equal(c.o_cliente_pessoa_f_sica_ou_jur_dica, "Pessoa jurídica (CNPJ)");
  assert.equal(c.cnpj_cliente_1, "11.222.333/0001-81");
  assert.ok(!("cpf_do_cliente" in c));
  assert.equal(c.e_mail_para_envio, "financeiro@cliente.com.br");
  assert.equal(c.vig_ncia_inicial, "2026-10-01");
  assert.equal(c.vig_ncia_final, "2026-11-13");
  assert.equal(c.qual_o_servi_o, "6931061282 · Alteração de contrato social");
  assert.equal(c.copy_of_valor_folha, "1500.00");
  assert.equal(c.departamento, "Jurídico");
  assert.equal(c.tipo_de_emiss_o_de_documento, "Nota Fiscal");
  assert.equal(c.tipo_de_faturamento, "Avulso");
  assert.equal(c.condi_es_de_pagamento_vista_ou_parcelado, "À vista");
  assert.equal(c.n_mero_de_parcelas, "1", "à vista manda 1 (obrigatório escondido)");
  assert.equal(c.tipo_de_recebimento, "Boleto");
  assert.equal(c.vencimento, "2026-11-13");
  assert.equal(c.compet_ncia_do_servi_o, "Mês do faturamento");
  assert.match(
    c.particularidades,
    /^Pedido FAT-2026-000012 do Portal de Faturamento\. A OS é criada pelo portal: não lançar no Omie\.\n/,
  );
  assert.match(c.particularidades, /Outros e-mails de envio: contato@cliente\.com\.br/);
  assert.ok(avisos.some((a) => a.includes("um e-mail de envio")));
  assert.deepEqual(validarCriarCard(input), []);
});

test("card PF parcelado em 3, recibo, pix: CPF, Parcelado, 3, Pix, Recibo e as parcelas em Observações", () => {
  const { input, faltas } = montarCriarCard(payloadPF(), { colaborador, agora: AGORA });
  const c = campos(input);
  assert.deepEqual(faltas, []);
  assert.equal(c.o_cliente_pessoa_f_sica_ou_jur_dica, "Pessoa física (CPF)");
  assert.equal(c.cpf_do_cliente, "529.982.247-25");
  assert.ok(!("cnpj_cliente_1" in c));
  assert.equal(c.condi_es_de_pagamento_vista_ou_parcelado, "Parcelado");
  assert.equal(c.n_mero_de_parcelas, "3");
  assert.equal(c.tipo_de_recebimento, "Pix");
  assert.equal(c.tipo_de_emiss_o_de_documento, "Recibo");
  assert.equal(c.copy_of_valor_folha, "100.00");
  assert.equal(c.vig_ncia_inicial, "2026-09-01");
  assert.equal(c.vig_ncia_final, "2027-03-31");
  assert.equal(c.compet_ncia_do_servi_o, "Mês anterior ao faturamento");
  assert.ok(!("departamento" in c));
  assert.match(
    c.particularidades,
    /Parcelas: 1\/3 em 31\/01\/2027 R\$ 33,33; 2\/3 em 28\/02\/2027 R\$ 33,33; 3\/3 em 31\/03\/2027 R\$ 33,34/,
  );
  assert.deepEqual(validarCriarCard(input), []);
});

test("nota de débito vai como Recibo; departamento fora da lista sai com aviso; emissora sem opção é falta", () => {
  const nd = montarCriarCard(
    payloadPJ({ pedido: { documento: "nd", departamento: "Auditoria" } }),
    { colaborador, agora: AGORA },
  );
  assert.equal(campos(nd.input).tipo_de_emiss_o_de_documento, "Recibo");
  assert.match(campos(nd.input).particularidades, /Documento: nota de débito/);
  assert.ok(nd.avisos.some((a) => a.includes("Nota de débito vai como Recibo")));
  assert.ok(nd.avisos.some((a) => a.includes('"Auditoria" não é opção')));
  const finance = montarCriarCard(
    payloadPJ({ emissora: { apelido: "FINANCE", cnpj: "68616679000181" } }),
    { colaborador, agora: AGORA },
  );
  assert.ok(
    finance.faltas.some((f) =>
      f.startsWith('A FINANCE não tem opção no campo "Empresa Planning que irá faturar"'),
    ),
  );
  assert.ok(
    validarCriarCard(finance.input).some((e) =>
      e.startsWith("Empresa Planning que irá faturar: vazio"),
    ),
  );
  assert.equal(opcaoCompetencia("2026-07-01", "2026-10-20"), "Outro");
});

test("solicitante fora de Colaboradores: a falta diz qual e-mail cadastrar; lista não lida: marcador só vale em simulação", () => {
  const p = payloadPJ();
  p.solicitante.email = "nova.pessoa@planning.com.br";
  const r = montarCriarCard(p, { colaborador, agora: AGORA });
  assert.ok(
    r.faltas.some((f) => f.includes("nova.pessoa@planning.com.br") && f.includes("Colaboradores")),
  );
  const semLista = montarCriarCard(payloadPJ(), { colaborador: () => undefined, agora: AGORA });
  assert.deepEqual(campos(semLista.input).respons_vel_pela_solicita_o_1, [
    "«id de rafael.andrade@planning.com.br em Colaboradores»",
  ]);
  assert.deepEqual(validarCriarCard(semLista.input, true), []);
  assert.ok(
    validarCriarCard(semLista.input, false).some((e) => e.includes("id de registro inválido")),
  );
});

test("validação pega opção errada, obrigatório faltando, campo inexistente, phase_id, data e valor fora do formato", () => {
  const { input } = montarCriarCard(payloadPJ(), { colaborador, agora: AGORA });
  const ruim = structuredClone(input);
  ruim.phase_id = "342815180";
  const c = (id) => ruim.fields_attributes.find((f) => f.field_id === id);
  c("tipo_de_faturamento").field_value = "Recorrente";
  c("vencimento").field_value = "2026-02-30";
  c("copy_of_valor_folha").field_value = "1.500,00";
  ruim.fields_attributes = ruim.fields_attributes.filter((f) => f.field_id !== "nome_do_projeto");
  ruim.fields_attributes.push({ field_id: "nao_existe", field_value: "x" });
  const erros = validarCriarCard(ruim);
  assert.ok(erros.includes("phase_id não vai no createCard (mapa §7.1)"));
  assert.ok(
    erros.some((e) => e.includes('"Recorrente" não é uma das opções')),
    "a opção certa tem espaço no fim",
  );
  assert.ok(erros.some((e) => e.startsWith("Vencimento: data inexistente")));
  assert.ok(erros.some((e) => e.includes("valor fora do formato 1500.00")));
  assert.ok(
    erros.some((e) => e.startsWith("Nome do projeto") && e.endsWith("obrigatório e não veio")),
  );
  assert.ok(erros.includes("campo nao_existe não existe no formulário"));
  assert.equal(
    erroDoValor(CAMPOS_INICIO.cnpj_cliente_1, "12.ABC.345/01DE-35"),
    null,
    "máscara aceita CNPJ alfanumérico",
  );
  assert.deepEqual(
    validarCampos(FASE.ABERTA, [
      { fieldId: "status_do_faturamento", value: ["Faturado"], operation: "REPLACE" },
    ]),
    ["campo status_do_faturamento não existe em SOLICITAÇÃO ABERTA"],
  );
});

// ---------------------------------------------------------------------------------------------- fases

test("caminhos permitidos: cancelar não passa por faturado, a não ser que o card já esteja lá", () => {
  assert.deepEqual(rota(FASE.ABERTA, FASE.ARQUIVADO), [FASE.ABERTA, FASE.ARQUIVADO]);
  assert.deepEqual(rota(FASE.VALIDACAO, FASE.ARQUIVADO), [
    FASE.VALIDACAO,
    FASE.ABERTA,
    FASE.ARQUIVADO,
  ]);
  assert.deepEqual(rota(FASE.APROVADO, FASE.ARQUIVADO), [
    FASE.APROVADO,
    FASE.VALIDACAO,
    FASE.ABERTA,
    FASE.ARQUIVADO,
  ]);
  assert.deepEqual(rota(FASE.REALIZADO, FASE.ARQUIVADO), [
    FASE.REALIZADO,
    FASE.FINALIZADO,
    FASE.ARQUIVADO,
  ]);
  assert.deepEqual(rota(FASE.APROVADO, FASE.ABERTA), [FASE.APROVADO, FASE.VALIDACAO, FASE.ABERTA]);
  assert.equal(ALVO.recebido, null);
});

const passosResumo = (passos) =>
  passos.map((p) =>
    p.tipo === "mover"
      ? `→${FASES[p.para].nome}`
      : p.tipo === "anexo"
        ? "anexo"
        : `campos:${p.values.map((v) => v.fieldId).join(",")}`,
  );

test("em_conferencia: Responsável pelo ticket = quem conferiu, documento conferido, 'Sim' e → VALIDAÇÃO", () => {
  const pl = planejar({
    para: "em_conferencia",
    atual: FASE.ABERTA,
    responsavelId: "403",
    preenchidos: preenchidosEstimados("os_criada"),
    agora: AGORA,
  });
  assert.deepEqual(passosResumo(pl.passos), [
    "campos:conex_o_de_database,a_demanda_possui_todas_as_informa_es_necess_rias",
    "→VALIDAÇÃO DE DADOS",
  ]);
  assert.deepEqual(pl.passos[0].values[0], {
    fieldId: "conex_o_de_database",
    value: ["403"],
    operation: "REPLACE",
  });
  assert.deepEqual(pl.faltas, []);
  assert.deepEqual(validarPassos(pl.passos), []);
  const sem = planejar({
    para: "em_conferencia",
    atual: FASE.ABERTA,
    responsavelId: null,
    preenchidos: new Set(),
    agora: AGORA,
  });
  assert.ok(sem.faltas[0].startsWith("Falta o Responsável pelo ticket"));
  assert.ok(
    sem.passos[0].values.some(
      (v) => v.fieldId === "cpf_cnpj_do_cliente_conferido" && v.value[0] === OPCAO_CONFERIDO,
    ),
    "checklist vazio é marcado na saída",
  );
});

test("faturado: APROVADO com Status 'Faturado', data e nº da NFS-e, → REALIZADO e o PDF no Upload do e-mail", () => {
  const nf = {
    numero: "4521",
    link: "https://nfse.exemplo/4521",
    emitida_em: "2026-11-21T10:15:00-03:00",
    os: 3021,
  };
  const pl = planejar({
    para: "faturado",
    atual: FASE.VALIDACAO,
    nf,
    preenchidos: preenchidosEstimados("em_conferencia"),
    agora: AGORA,
  });
  assert.deepEqual(passosResumo(pl.passos), [
    "→APROVADO PARA FATURAMENTO",
    "campos:status_do_faturamento,data,observa_o",
    "→FATURAMENTO REALIZADO",
    "anexo",
  ]);
  assert.deepEqual(pl.passos[1].values, [
    { fieldId: "status_do_faturamento", value: ["Faturado"], operation: "REPLACE" },
    { fieldId: "data", value: ["2026-11-21"], operation: "REPLACE" },
    {
      fieldId: "observa_o",
      value: ["NFS-e 4521 · https://nfse.exemplo/4521 · OS 3021"],
      operation: "REPLACE",
    },
  ]);
  assert.deepEqual(validarPassos(pl.passos), []);
  // Faturado sem conferência (direto da OS criada): o card sai da ABERTA com o responsável de quem faturou.
  const direto = planejar({
    para: "faturado",
    atual: FASE.ABERTA,
    responsavelId: "403",
    nf,
    preenchidos: preenchidosEstimados("os_criada"),
    agora: AGORA,
  });
  assert.deepEqual(passosResumo(direto.passos).slice(0, 3), [
    "campos:conex_o_de_database,a_demanda_possui_todas_as_informa_es_necess_rias",
    "→APROVADO PARA FATURAMENTO",
    "campos:status_do_faturamento,data,observa_o",
  ]);
  // Já em FATURAMENTO REALIZADO (voltou de atraso ou recebido): não move.
  assert.deepEqual(
    planejar({
      para: "faturado",
      atual: FASE.REALIZADO,
      nf,
      preenchidos: preenchidosEstimados("em_atraso"),
      agora: AGORA,
    }).passos,
    [],
  );
});

test("devolvido volta a ABERTA com 'Não' e o motivo; cancelado vai a ARQUIVADO e trava sem o anexo depois de faturado", () => {
  const dev = planejar({
    para: "devolvido",
    atual: FASE.VALIDACAO,
    motivo: "Falta o CNPJ certo",
    preenchidos: preenchidosEstimados("em_conferencia"),
    agora: AGORA,
  });
  assert.deepEqual(passosResumo(dev.passos), [
    "→SOLICITAÇÃO ABERTA",
    "campos:a_demanda_possui_todas_as_informa_es_necess_rias,quais_informa_es_est_o_faltando_na_solicita_o",
  ]);
  assert.deepEqual(dev.passos[1].values[1].value, ["Falta o CNPJ certo"]);
  const can = planejar({
    para: "cancelado",
    atual: FASE.REALIZADO,
    preenchidos: preenchidosEstimados("faturado"),
    agora: AGORA,
  });
  assert.deepEqual(passosResumo(can.passos), ["→FINALIZADO", "→ARQUIVADO"]);
  const semAnexo = planejar({
    para: "cancelado",
    atual: FASE.REALIZADO,
    preenchidos: new Set(["status_do_faturamento"]),
    agora: AGORA,
  });
  assert.ok(semAnexo.faltas.some((f) => f.includes("sem o anexo")));
  const aberta = planejar({
    para: "cancelado",
    atual: FASE.ABERTA,
    responsavelId: "403",
    preenchidos: new Set(),
    agora: AGORA,
  });
  assert.deepEqual(passosResumo(aberta.passos), [
    "campos:conex_o_de_database,cpf_cnpj_do_cliente_conferido",
    "→ARQUIVADO",
  ]);
});

test("recebido, em atraso, simulado e reenvio não movem: o motivo fica registrado", () => {
  for (const para of [
    "recebido",
    "em_atraso",
    "simulado",
    "os_criada",
    "erro_omie",
    "cancelamento_pedido",
    "na_fila_omie",
  ]) {
    const pl = planejar({ para, atual: FASE.REALIZADO, preenchidos: new Set(), agora: AGORA });
    assert.deepEqual(pl.passos, [], para);
    assert.ok(pl.registro, para);
  }
  assert.match(
    planejar({ para: "recebido", atual: FASE.REALIZADO, preenchidos: new Set(), agora: AGORA })
      .registro,
    /FINALIZADO hoje quer dizer 'e-mail anexado'/,
  );
});

// ---------------------------------------------------------------------------------------------- Pipefy falso

function pipefyFalso(respostas = {}) {
  const chamadas = [];
  const transporte = async (corpo) => {
    const { query, variables } = JSON.parse(corpo);
    const nome = /^\s*(query|mutation)\s+(\w+)/.exec(query)[2];
    chamadas.push({ nome, mutacao: /^\s*mutation/.test(query), variables });
    let h = respostas[nome];
    if (typeof h === "function") h = h(variables, chamadas.filter((c) => c.nome === nome).length);
    if (h && h.http) return { status: h.http, texto: JSON.stringify(h.corpo ?? {}) };
    return { status: 200, texto: JSON.stringify(h ?? { data: {} }) };
  };
  return { transporte, chamadas };
}
const COLABORADORES_RESP = {
  data: {
    table_records: {
      pageInfo: { hasNextPage: false, endCursor: null },
      edges: [...COLABS].map(([email, id]) => ({
        node: {
          id,
          record_fields: [
            { field: { id: "e_mail_comercial" }, value: email },
            { field: { id: "nome_completo" }, value: "X" },
          ],
        },
      })),
    },
  },
};
const contextoPedido =
  (o = {}) =>
  async () => ({
    pedido: {
      id: "p-1",
      numero: "FAT-2026-000012",
      omie_nf_numero: "4521",
      omie_nf_link: "https://nfse.exemplo/4521",
      omie_nf_emitida_em: "2026-11-21T13:15:00+00:00",
      omie_os_codigo: 3021,
    },
    responsavel_ticket: { email: "flavia.abreu@planning.com.br", origem: "conferencia" },
    card_id: null,
    ...o,
  });
const envioPipefy = (operacao, o = {}) => ({
  id: `pf-${operacao}`,
  emissora: { id: DOC, apelido: "DOC" },
  pipefy_sync: false,
  origem_id: "p-1",
  operacao,
  card_id: null,
  tentativas: 1,
  payload:
    operacao === "criar_card"
      ? payloadPJ()
      : {
          versao: 1,
          de: "os_criada",
          para: "em_conferencia",
          evento: "conferencia",
          motivo: null,
          pedido: { id: "p-1", numero: "FAT-2026-000012" },
        },
  ...o,
});

// ---------------------------------------------------------------------------------------------- pipefy_sync = false não escreve

test("pipefy_sync = false: só a consulta de Colaboradores sai; createCard, updateFieldsValues e moveCardToPhase ficam montados", async () => {
  const f = pipefyFalso({ Colaboradores: COLABORADORES_RESP });
  const fila = [];
  const lotes = [
    [
      envioPipefy("criar_card"),
      envioPipefy("mover_fase"),
      envioPipefy("mover_fase", {
        id: "pf-fat",
        payload: {
          versao: 1,
          de: "em_conferencia",
          para: "faturado",
          pedido: {
            id: "p-1",
            numero: "FAT-2026-000012",
            omie_nf_numero: "4521",
            omie_nf_link: "https://nfse.exemplo/4521",
            omie_nf_emitida_em: "2026-11-21T13:15:00+00:00",
            omie_os_codigo: 3021,
          },
        },
      }),
      envioPipefy("mover_fase", {
        id: "pf-dev",
        payload: {
          versao: 1,
          de: "simulado",
          para: "devolvido",
          motivo: "Teste",
          pedido: { id: "p-1" },
        },
      }),
      envioPipefy("mover_fase", {
        id: "pf-can",
        payload: {
          versao: 1,
          de: "devolvido",
          para: "cancelado",
          motivo: "Teste",
          pedido: { id: "p-1" },
        },
      }),
    ],
  ];
  let i = 0;
  const resumo = await rodarFilaPipefy({
    reservar: async () => lotes[i++] ?? [],
    responder: async (id, r) => {
      fila.push({ id, ...r });
    },
    contexto: contextoPedido(),
    transporte: f.transporte,
    orcamentoMs: 60_000,
    agora: () => AGORA,
  });
  assert.deepEqual(
    f.chamadas.filter((c) => c.mutacao),
    [],
    "nenhuma mutation chegou ao Pipefy",
  );
  assert.deepEqual(
    f.chamadas.map((c) => c.nome),
    ["Colaboradores"],
    "Colaboradores lido uma vez na rodada",
  );
  assert.deepEqual(resumo.por_status, { simulado: 5 });
  const [criar, conf, fat, dev, can] = fila;
  assert.deepEqual(
    criar.resposta.mutacoes.map((m) => m.nome),
    ["createCard", "updateFieldsValues"],
  );
  assert.equal(criar.resposta.validacao.ok, true);
  assert.deepEqual(criar.resposta.mutacoes[1].variables.input.values, [
    { fieldId: "cpf_cnpj_do_cliente_conferido", value: [OPCAO_CONFERIDO], operation: "REPLACE" },
  ]);
  assert.equal(criar.card_id, null, "simulação não inventa card");
  assert.deepEqual(
    conf.resposta.mutacoes.map((m) => m.nome),
    ["updateFieldsValues", "moveCardToPhase"],
  );
  assert.deepEqual(conf.resposta.mutacoes[0].variables.input.values[0], {
    fieldId: "conex_o_de_database",
    value: ["403"],
    operation: "REPLACE",
  });
  assert.equal(conf.resposta.mutacoes[1].variables.input.destination_phase_id, FASE.VALIDACAO);
  assert.deepEqual(
    fat.resposta.mutacoes.map((m) => m.nome),
    [
      "moveCardToPhase",
      "updateFieldsValues",
      "moveCardToPhase",
      "createPresignedUrl",
      "updateFieldsValues",
    ],
  );
  assert.deepEqual(dev.resposta.caminho, ["SOLICITAÇÃO ABERTA"]);
  assert.deepEqual(can.resposta.caminho, ["SOLICITAÇÃO ABERTA", "ARQUIVADO"]);
  for (const r of fila) {
    assert.equal(r.status, "simulado", `${r.id}: ${r.erro_legivel}`);
    assert.ok(r.resposta.chamadas.every((c) => c.operacao === "Colaboradores"));
  }
});

test("a trava: em simulação o cliente do Pipefy recusa mutation antes da rede", async () => {
  const f = pipefyFalso({});
  const pf = criarPipefy({ transporte: f.transporte, modo: "simular" });
  await assert.rejects(
    pf.mutacao(
      "mutation CriarCardDoPedido($input: CreateCardInput!) { createCard(input: $input) { card { id } } }",
      {},
    ),
    MutacaoBloqueada,
  );
  await assert.rejects(pf.mutacao("  mutation MoverCard { x }", {}), MutacaoBloqueada);
  assert.equal(f.chamadas.length, 0);
});

test("simulação com o card inválido (emissora sem opção) volta erro legível, sem escrever", async () => {
  const f = pipefyFalso({ Colaboradores: COLABORADORES_RESP });
  const p = payloadPJ({ emissora: { apelido: "FINANCE", cnpj: "68616679000181" } });
  const r = await processarPipefy(envioPipefy("criar_card", { payload: p }), {
    pipefy: criarPipefy({ transporte: f.transporte, modo: "simular" }),
    modo: "simular",
    agora: () => AGORA,
    colaboradores: async () => COLABS,
    contexto: contextoPedido(),
  });
  assert.equal(r.status, "erro");
  assert.match(
    r.erro_legivel,
    /^Em gravação o Pipefy recusaria o card: A FINANCE não tem opção no campo "Empresa Planning que irá faturar"/,
  );
  assert.deepEqual(f.chamadas, []);
});

// ---------------------------------------------------------------------------------------------- gravar (pipefy_sync = true)

test("gravar criar_card: procura o card do pedido, cria, marca o checklist e devolve o card_id; achado = não cria de novo", async () => {
  const f = pipefyFalso({
    CardsPeloProjeto: { data: { cards: { edges: [] } } },
    CriarCardDoPedido: {
      data: {
        createCard: { card: { id: "998877", url: "https://app.pipefy.com/open-cards/998877" } },
      },
    },
    PreencherCampos: { data: { updateFieldsValues: { success: true, userErrors: [] } } },
  });
  const ctx = (tr) => ({
    pipefy: criarPipefy({ transporte: tr, modo: "gravar" }),
    modo: "gravar",
    agora: () => AGORA,
    colaboradores: async () => COLABS,
    contexto: contextoPedido(),
  });
  const r = await processarPipefy(
    envioPipefy("criar_card", { pipefy_sync: true }),
    ctx(f.transporte),
  );
  assert.equal(r.status, "ok", r.erro_legivel);
  assert.equal(r.card_id, "998877");
  assert.deepEqual(
    f.chamadas.map((c) => c.nome),
    ["CardsPeloProjeto", "CriarCardDoPedido", "PreencherCampos"],
  );
  assert.equal(f.chamadas[1].variables.input.pipe_id, "307098392");

  const g = pipefyFalso({
    CardsPeloProjeto: {
      data: {
        cards: {
          edges: [
            {
              node: {
                id: "555",
                url: "u",
                fields: [
                  {
                    field: { id: "particularidades" },
                    value: "Pedido FAT-2026-000012 do Portal de Faturamento. …",
                  },
                ],
              },
            },
          ],
        },
      },
    },
    PreencherCampos: { data: { updateFieldsValues: { success: true, userErrors: [] } } },
  });
  const r2 = await processarPipefy(
    envioPipefy("criar_card", { pipefy_sync: true }),
    ctx(g.transporte),
  );
  assert.equal(r2.card_id, "555");
  assert.equal(r2.resposta.ja_existia, true);
  assert.ok(!g.chamadas.some((c) => c.nome === "CriarCardDoPedido"));
});

test("gravar sem o solicitante em Colaboradores: volta para a fila com o e-mail a cadastrar, sem criar card", async () => {
  const f = pipefyFalso({});
  const p = payloadPJ();
  p.solicitante.email = "nova.pessoa@planning.com.br";
  const r = await processarPipefy(envioPipefy("criar_card", { pipefy_sync: true, payload: p }), {
    pipefy: criarPipefy({ transporte: f.transporte, modo: "gravar" }),
    modo: "gravar",
    agora: () => AGORA,
    colaboradores: async () => COLABS,
    contexto: contextoPedido(),
  });
  assert.equal(r.status, "pendente");
  assert.match(
    r.erro_legivel,
    /nova\.pessoa@planning\.com\.br \(solicitante\) não está na tabela Colaboradores/,
  );
  assert.deepEqual(f.chamadas, []);
});

test("gravar faturado: lê a fase do card, preenche, move e anexa o PDF da NFS-e, na ordem", async () => {
  const subidas = [];
  const f = pipefyFalso({
    CardDoPedido: {
      data: {
        card: {
          id: "998877",
          url: "u",
          current_phase: { id: FASE.VALIDACAO },
          fields: [
            { field: { id: "conex_o_de_database" }, value: '["Flávia"]' },
            { field: { id: "cpf_cnpj_do_cliente_conferido" }, value: '["Conferido"]' },
          ],
        },
      },
    },
    MoverCard: (v) => ({
      data: {
        moveCardToPhase: {
          card: { id: "998877", current_phase: { id: v.input.destination_phase_id } },
        },
      },
    }),
    PreencherCampos: { data: { updateFieldsValues: { success: true, userErrors: [] } } },
    UrlDoAnexo: {
      data: {
        createPresignedUrl: {
          url: "https://pipefy-prd-us-east-1.s3.amazonaws.com/orgs/abc/uploads/xyz/NFSe-4521.pdf?X-Amz=1",
        },
      },
    },
  });
  const r = await processarPipefy(
    envioPipefy("mover_fase", {
      pipefy_sync: true,
      card_id: "998877",
      payload: {
        versao: 1,
        de: "em_conferencia",
        para: "faturado",
        pedido: {
          id: "p-1",
          numero: "FAT-2026-000012",
          omie_nf_numero: "4521",
          omie_nf_link: "https://nfse.exemplo/4521",
          omie_nf_emitida_em: "2026-11-21T13:15:00+00:00",
          omie_os_codigo: 3021,
        },
      },
    }),
    {
      pipefy: criarPipefy({ transporte: f.transporte, modo: "gravar" }),
      modo: "gravar",
      agora: () => AGORA,
      colaboradores: async () => COLABS,
      contexto: contextoPedido(),
      pdfDaNota: async () => ({ nome: "NFSe-4521.pdf", bytes: new Uint8Array([37, 80, 68, 70]) }),
      subir: async (url, bytes) => {
        subidas.push({ url, n: bytes.length });
      },
    },
  );
  assert.equal(r.status, "ok", r.erro_legivel);
  assert.deepEqual(
    f.chamadas.map((c) => c.nome),
    ["CardDoPedido", "MoverCard", "PreencherCampos", "MoverCard", "UrlDoAnexo", "PreencherCampos"],
  );
  assert.deepEqual(f.chamadas[5].variables.input.values, [
    {
      fieldId: "upload_do_e_mail",
      value: ["orgs/abc/uploads/xyz/NFSe-4521.pdf"],
      operation: "REPLACE",
    },
  ]);
  assert.equal(subidas.length, 1);
  assert.deepEqual(r.resposta.feitos, [
    "→ APROVADO PARA FATURAMENTO",
    "campos em APROVADO PARA FATURAMENTO",
    "→ FATURAMENTO REALIZADO",
    "PDF da NFS-e anexado",
  ]);
});

test("erros do Pipefy: 401 sem acesso vira erro legível, 429 volta para a fila, recusa vira erro com a fala do Pipefy", () => {
  const e = envioPipefy("criar_card");
  assert.match(
    decidirPipefy(new ErroPipefy("acesso", 401, "Unauthorized"), e).erro_legivel,
    /^O token do Pipefy do Brain não tem acesso ao pipe 307098392/,
  );
  assert.equal(decidirPipefy(new ErroPipefy("passageiro", 429, "Too many"), e).status, "pendente");
  assert.equal(
    decidirPipefy(new ErroPipefy("passageiro", 502, "x"), { ...e, tentativas: 6 }).status,
    "erro",
  );
  assert.match(
    decidirPipefy(new ErroPipefy("recusa", 200, "Field value is invalid"), e).erro_legivel,
    /^O Pipefy recusou o card: Field value is invalid/,
  );
});
