// Handoff Consultoria: a sync (supabase/functions/handoff-consultoria-sync/domain.mjs) e a régua da
// tela (src/lib/monetizacao/handoff-consultoria.ts). Dados sintéticos no formato que o Pipefy, o
// Pipedrive, o Financial Brain e o RPC devolveram em 02/10/2026; esperados calculados à mão.
// A conferência contra a produção fica em scripts/monetizacao/conferir-handoff-consultoria.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  categoriaDeCreditos,
  cnpjOuNulo,
  conectoresMudaram,
  dataBR,
  faixaDeclarada,
  linhaDoCard,
  linhasPat,
  podeMarcarAusentes,
  resolverChave,
  unidadeCanonica,
} from "../supabase/functions/handoff-consultoria-sync/domain.mjs";
import {
  clientesDoPainel,
  mesesEntre,
  montarPainel,
  regrasVigentes,
} from "../src/lib/monetizacao/handoff-consultoria.ts";

const UNIDADES = [
  { id: 3, nome_da_praca: "Belém" },
  { id: 4, nome_da_praca: "Rio de Janeiro" },
  { id: 5, nome_da_praca: "Campo Novo" },
  { id: 12, nome_da_praca: "São Bernardo" },
];
const AGORA = "2026-10-02T13:00:00.000Z";

// ─── sync ─────────────────────────────────────────────────────────────────────────────────────────

test("CNPJ: só dígitos, zeros que o Pipedrive comeu voltam, tamanho errado é nulo", () => {
  assert.equal(cnpjOuNulo("05.591.842/0001-89"), "05591842000189");
  assert.equal(cnpjOuNulo(5591842000189), "05591842000189");
  assert.equal(cnpjOuNulo("123.456.789-01"), "12345678901");
  assert.equal(cnpjOuNulo("1234"), null);
  assert.equal(cnpjOuNulo(""), null);
  assert.equal(cnpjOuNulo(null), null);
});

test("data do Pipefy dd/mm/aaaa vira ISO; lixo vira nulo", () => {
  assert.equal(dataBR("29/09/2026"), "2026-09-29");
  assert.equal(dataBR("Lucro Real"), null);
  assert.equal(dataBR(undefined), null);
});

test("unidade canônica: 'Planning', apelidos do pipe e acento não importam", () => {
  assert.deepEqual(unidadeCanonica("Planning Sudeste", UNIDADES), {
    unidade: "Rio de Janeiro",
    unidade_id: 4,
  });
  assert.deepEqual(unidadeCanonica("São Bernardo do Campo", UNIDADES), {
    unidade: "São Bernardo",
    unidade_id: 12,
  });
  assert.deepEqual(unidadeCanonica("Campo Novo do Parecis", UNIDADES), {
    unidade: "Campo Novo",
    unidade_id: 5,
  });
  assert.deepEqual(unidadeCanonica("belem", UNIDADES), { unidade: "Belém", unidade_id: 3 });
  assert.deepEqual(unidadeCanonica("Marte", UNIDADES), { unidade: "Marte", unidade_id: null });
  assert.deepEqual(unidadeCanonica("", UNIDADES), { unidade: null, unidade_id: null });
});

const card = (campos, extra = {}) => ({
  id: "1449182914",
  title: "pertinho do céu",
  created_at: "2026-09-16T10:00:00-03:00",
  current_phase: { name: "Pesquisa de Esforço (CES)" },
  fields: Object.entries(campos).map(([id, v]) =>
    Array.isArray(v)
      ? { field: { id }, value: JSON.stringify(v), array_value: v }
      : { field: { id }, value: v, array_value: null },
  ),
  ...extra,
});

test("linha do card: datas, encaminhado, conectores ordenados e unidade", () => {
  const l = linhaDoCard(
    card({
      unidade_1: "Planning Belém",
      data_da_venda: "11/09/2026",
      data_da_reuni_o: "22/09/2026",
      regime_tribut_rio_consultoria_tribut_ria: "Sim",
      card_s_de_contrato: ["300", "200"],
      conecte_esse_card_na_data_base_empresas: ["900"],
      faturamento: "R$ 4,8 milhões até R$ 10 milhões",
    }),
    UNIDADES,
    AGORA,
  );
  assert.equal(l.unidade, "Belém");
  assert.equal(l.unidade_id, 3);
  assert.equal(l.venda_em, "2026-09-11");
  assert.equal(l.kickoff_em, "2026-09-22");
  assert.equal(l.encaminhado, "Sim");
  assert.deepEqual(l.contrato_card_ids, ["200", "300"]);
  assert.deepEqual(l.empresa_record_ids, ["900"]);
  assert.equal(l.faturamento_card, "R$ 4,8 milhões até R$ 10 milhões");
  assert.equal(l.ausente_desde, null);
  assert.equal(
    linhaDoCard(card({ regime_tribut_rio_consultoria_tribut_ria: "Talvez" }), UNIDADES, AGORA)
      .encaminhado,
    null,
  );
});

test("conectores: só refaz a chave quando mudam", () => {
  const l = { contrato_card_ids: ["1", "2"], empresa_record_ids: ["9"] };
  assert.equal(conectoresMudaram(l, null), true);
  assert.equal(
    conectoresMudaram(l, { contrato_card_ids: ["1", "2"], empresa_record_ids: ["9"] }),
    false,
  );
  assert.equal(conectoresMudaram(l, { contrato_card_ids: ["1"], empresa_record_ids: ["9"] }), true);
});

const fontesVazias = () => ({
  contratos: new Map(),
  contratoPorNegocio: new Map(),
  registros: new Map(),
  empresas: new Map(),
  pipefyContrato: new Map(),
  pipefyRegistro: new Map(),
  negocios: new Map(),
});

test("chave: contrato no banco vence; depois negócio, empresa, Pipefy e Pipedrive", () => {
  const l = { contrato_card_ids: ["c1"], empresa_record_ids: ["r1"] };
  const f = fontesVazias();
  f.contratos.set("c1", { cnpj: "11.111.111/0001-11", pipedrive_deal_id: 50, empresa_id: 7 });
  f.registros.set("r1", { cnpj: "22222222000122", empresa_id: 8 });
  assert.deepEqual(resolverChave(l, f), {
    cnpj: "11111111000111",
    cnpj_fonte: "contrato",
    pipedrive_deal_id: "50",
  });

  f.contratos.set("c1", { cnpj: null, pipedrive_deal_id: 50, empresa_id: 7 });
  f.contratoPorNegocio.set("50", "33333333000133");
  assert.equal(resolverChave(l, f).cnpj_fonte, "contrato_negocio");

  f.contratoPorNegocio.clear();
  assert.equal(resolverChave(l, f).cnpj, "22222222000122");
  assert.equal(resolverChave(l, f).cnpj_fonte, "empresa");

  f.registros.set("r1", { cnpj: null, empresa_id: 8 });
  f.empresas.set("7", "44444444000144");
  assert.equal(resolverChave(l, f).cnpj_fonte, "empresa_id");

  f.empresas.clear();
  f.pipefyContrato.set("c1", { cnpj: "55.555.555/0001-55", negocio: "50" });
  assert.equal(resolverChave(l, f).cnpj_fonte, "contrato_pipefy");

  f.pipefyContrato.set("c1", { cnpj: null, negocio: "50" });
  f.negocios.set("50", { cnpj: 6666666000166, org_cnpj: null });
  assert.deepEqual(resolverChave(l, f), {
    cnpj: "06666666000166",
    cnpj_fonte: "negocio_pipedrive",
    pipedrive_deal_id: "50",
  });

  f.negocios.set("50", { cnpj: null, org_cnpj: "77777777000177" });
  assert.equal(resolverChave(l, f).cnpj_fonte, "organizacao_pipedrive");

  f.negocios.clear();
  assert.deepEqual(resolverChave(l, f), { cnpj: null, cnpj_fonte: null, pipedrive_deal_id: "50" });
});

test("chave: negócio vem do contrato, senão do card de contrato no Pipefy, senão do registro", () => {
  const l = { contrato_card_ids: ["c1"], empresa_record_ids: ["r1"] };
  const f = fontesVazias();
  f.pipefyRegistro.set("r1", "90");
  assert.equal(resolverChave(l, f).pipedrive_deal_id, "90");
  f.pipefyContrato.set("c1", { cnpj: null, negocio: "80" });
  assert.equal(resolverChave(l, f).pipedrive_deal_id, "80");
  f.contratos.set("c1", { cnpj: null, pipedrive_deal_id: 70, empresa_id: null });
  assert.equal(resolverChave(l, f).pipedrive_deal_id, "70");
});

const OPCOES = [
  { id: 772, label: "Até R$ 500 mil" },
  { id: 774, label: "R$ 1 milhão até R$ 2 milhões" },
  { id: 776, label: "R$ 4,8 milhões até R$ 10 milhões" },
];

test("faixa declarada: opção do negócio; sem ela, o mesmo rótulo no card; texto livre não vira faixa", () => {
  assert.deepEqual(faixaDeclarada(776, null, OPCOES), {
    faixa: "R$ 4,8 milhões até R$ 10 milhões",
    faixa_id: 776,
    faixa_ordem: 2,
    faixa_fonte: "pipedrive_negocio",
  });
  assert.equal(
    faixaDeclarada(null, "r$ 1 milhão até r$ 2 milhões", OPCOES).faixa_fonte,
    "onboarding",
  );
  assert.equal(faixaDeclarada(null, "R$ 9.600.000,00 anual", OPCOES).faixa, null);
  assert.equal(faixaDeclarada("999", null, OPCOES).faixa, null);
});

test("PAT: nome do Omie casa com o cadastro; faturado e créditos por competência, recebido pelo crédito", () => {
  const contrapartes = [
    {
      razao_social: "GREENBELT LABS COSMETICOS LTDA",
      nome_fantasia: null,
      nome_norm: null,
      fantasia_norm: null,
      doc_digitos: "29094565000167",
    },
    {
      razao_social: "STOK UNIVERSAL",
      nome_fantasia: "Stok",
      nome_norm: "STOK UNIVERSAL",
      fantasia_norm: null,
      doc_digitos: "10695084000189",
    },
  ];
  const faturado = [
    {
      cliente: "GREENBELT LABS COSMETICOS LTDA",
      meses: [
        { competencia: "2026-08-01", receita: 2846.82 },
        { competencia: "2026-09-01", receita: null },
      ],
    },
    { cliente: "Stok Universal", meses: [{ competencia: "2026-07-01", receita: 8187.94 }] },
    { cliente: "SEM CADASTRO", meses: [{ competencia: "2026-07-01", receita: 10 }] },
  ];
  const creditos = [
    { cliente: "STOK UNIVERSAL", meses: [{ competencia: "2026-07-01", receita: 8187.94 }] },
  ];
  const recebidos = [
    {
      cliente: "GREENBELT LABS COSMETICOS LTDA",
      data_caixa: "2026-08-24",
      titulo_valor_pago: 14479.73,
    },
    {
      cliente: "GREENBELT LABS COSMETICOS LTDA",
      data_caixa: "2026-08-25",
      titulo_valor_pago: 2671.75,
    },
  ];
  const { linhas, sem_cnpj } = linhasPat({
    faturado,
    creditos,
    recebidos,
    contrapartes,
    agora: AGORA,
  });
  assert.deepEqual(sem_cnpj, ["SEM CADASTRO"]);
  const g = linhas.find((l) => l.cnpj === "29094565000167" && l.mes === "2026-08-01");
  assert.equal(g.faturado, 2846.82);
  assert.equal(g.recebido, 17151.48);
  assert.equal(g.creditos, 0);
  const s = linhas.find((l) => l.cnpj === "10695084000189");
  assert.deepEqual(
    [s.mes, s.faturado, s.creditos, s.recebido],
    ["2026-07-01", 8187.94, 8187.94, 0],
  );
  assert.equal(linhas.length, 2);
});

test("categoria de créditos achada pelo nome, com a grafia do de/para", () => {
  assert.equal(
    categoriaDeCreditos({
      itens: [{ categoria: "Projetos especiais" }, { categoria: "Creditos triburários" }],
    }),
    "Creditos triburários",
  );
  assert.equal(categoriaDeCreditos({ itens: [{ categoria: "Consultoria mensal" }] }), null);
});

test("ausentes: leitura vazia ou que perde mais da metade não marca ninguém", () => {
  assert.equal(podeMarcarAusentes(0, 200).pode, false);
  assert.equal(podeMarcarAusentes(90, 200).pode, false);
  assert.equal(podeMarcarAusentes(206, 206).pode, true);
});

// ─── régua da tela ────────────────────────────────────────────────────────────────────────────────

const REGRAS = [
  {
    chave: "repasse_expansao",
    valor: 0.5,
    vigente_desde: "2026-07-01",
    situacao: "proposta",
    origem: "29/09",
  },
  {
    chave: "repasse_unidade",
    valor: 0.2,
    vigente_desde: "2026-07-01",
    situacao: "proposta",
    origem: "29/09",
  },
  {
    chave: "fee_estimado",
    valor: 0.25,
    vigente_desde: "2026-07-01",
    situacao: "proposta",
    origem: "v12",
  },
  {
    chave: "exclui_cliente_previo_pat",
    valor: 1,
    vigente_desde: "2026-07-01",
    situacao: "proposta",
    origem: "02/10",
  },
];
const cli = (card, extra = {}) => ({
  card,
  titulo: `Cliente ${card}`,
  unidade: "Belém",
  unidade_id: 3,
  fase: "Setup técnico",
  criado_em: "2026-08-10T12:00:00Z",
  venda_em: null,
  kickoff_em: null,
  encaminhado: null,
  cnpj: null,
  cnpj_fonte: null,
  faixa: null,
  faixa_ordem: null,
  faixa_fonte: null,
  consultoria: null,
  propostas: 0,
  pat: [],
  ...extra,
});
const chegou = (dia) => ({
  cadastrado_em: `${dia}T15:00:00Z`,
  via: "cnpj",
  ativo: true,
  inativo_desde: null,
  valor_a_recuperar: null,
  valor_a_recuperar_em: null,
});
const bruto = (clientes, porta = true) => ({
  lido_em: AGORA,
  todas_unidades: true,
  porta_financeiro: {
    aberta: porta,
    motivo: porta ? null : "Sua conta não tem acesso ao Brain Financeiro.",
  },
  regras: REGRAS,
  frescor: { onboarding: AGORA, consultoria: AGORA, pat: AGORA, financeiro_carregado_em: AGORA },
  clientes,
});

// A: chegou em 26/07 (carga inicial) e já pagava a PAT desde abril: fora da regra.
// B: chegou em 10/09 pelo kickoff, faixa declarada, recebeu R$ 1.000 em set e R$ 3.000 em out: na base.
// C: mesmo CNPJ de B num card mais novo (encaminhado Sim): some na deduplicação, mas o Sim vale.
// D: encaminhado Sim e não chegou.  E: sem CNPJ.  F: chegou em out, recebimento antes da chegada (set): fora do período do dinheiro.
const CASO = [
  cli("A", {
    cnpj: "10695084000189",
    consultoria: chegou("2026-07-26"),
    pat: [
      { mes: "2026-04-01", faturado: 4643, creditos: 4643, recebido: 4358, cliente_omie: "STOK" },
      {
        mes: "2026-07-01",
        faturado: 8187.94,
        creditos: 8187.94,
        recebido: 7843.18,
        cliente_omie: "STOK",
      },
    ],
  }),
  cli("B", {
    cnpj: "34181324000195",
    venda_em: "2026-08-19",
    kickoff_em: "2026-09-10",
    faixa: "R$ 4,8 milhões até R$ 10 milhões",
    faixa_ordem: 4,
    faixa_fonte: "pipedrive_negocio",
    consultoria: chegou("2026-09-10"),
    pat: [
      { mes: "2026-09-01", faturado: 1000, creditos: 1000, recebido: 1000, cliente_omie: "SOLIDA" },
      { mes: "2026-10-01", faturado: 0, creditos: 0, recebido: 3000, cliente_omie: "SOLIDA" },
    ],
  }),
  cli("C", {
    cnpj: "34181324000195",
    venda_em: "2026-09-01",
    encaminhado: "Sim",
    consultoria: chegou("2026-09-10"),
  }),
  cli("D", {
    cnpj: "05591842000189",
    kickoff_em: "2026-09-22",
    encaminhado: "Sim",
    unidade: null,
    unidade_id: null,
  }),
  cli("E", { titulo: "Sem chave" }),
  cli("F", {
    cnpj: "08904606000163",
    consultoria: chegou("2026-10-01"),
    pat: [
      { mes: "2026-09-01", faturado: 500, creditos: 0, recebido: 500, cliente_omie: "MIRANTE" },
    ],
  }),
];

test("meses do período e regra vigente lidos da tabela", () => {
  assert.deepEqual(mesesEntre("2026-07-01", "2026-10-02"), [
    "2026-07",
    "2026-08",
    "2026-09",
    "2026-10",
  ]);
  const r = regrasVigentes(
    [
      ...REGRAS,
      {
        chave: "repasse_expansao",
        valor: 0.2,
        vigente_desde: "2026-11-01",
        situacao: "confirmada",
        origem: "futuro",
      },
    ],
    "2026-10-02",
  );
  assert.equal(r.expansao, 0.5);
  assert.equal(r.proposta, true);
  assert.equal(regrasVigentes([], "2026-10-02").expansao, null);
});

test("clientes: um por CNPJ, carga inicial, quem já pagava a PAT e a base do repasse", () => {
  const cs = clientesDoPainel(bruto(CASO), regrasVigentes(REGRAS, "2026-10-02"));
  assert.equal(cs.length, 5);
  const porCard = Object.fromEntries(cs.map((c) => [c.card, c]));
  assert.equal(porCard.B.encaminhado, true, "o Sim do card mais novo vale para o cliente");
  assert.equal(porCard.C, undefined);
  assert.equal(porCard.A.cargaInicial, true);
  assert.equal(porCard.A.jaPagavaPat, true);
  assert.equal(porCard.A.naBase, false);
  assert.equal(porCard.A.recebido, 7843.18, "só do mês da chegada em diante");
  assert.equal(porCard.B.jaPagavaPat, false);
  assert.equal(porCard.B.naBase, true);
  assert.equal(porCard.B.recebido, 4000);
  assert.equal(porCard.B.mesTrabalho, "2026-09");
  assert.equal(porCard.F.recebido, 0, "recebimento antes da chegada não conta");
  assert.equal(porCard.F.jaPagavaPat, true);
  assert.equal(porCard.D.chegada, null);
  assert.equal(porCard.D.unidade, "Sem unidade");
});

test("painel: números, dinheiro por mês, funil que só desce e atenção", () => {
  const p = montarPainel(bruto(CASO), {}, "2026-10-02");
  assert.equal(p.todos.length, 5);
  assert.equal(p.chegaram.length, 3);
  assert.equal(p.trabalhados.length, 2);
  assert.deepEqual(p.dinheiro, {
    recuperado: 36751.76,
    recuperadoFonte: "estimado",
    identificado: null,
    recebido: 11843.18,
    base: 4000,
    fora: 7843.18,
    expansao: 2000,
    unidade: 800,
  });
  const set = p.porMes.find((m) => m.mes === "2026-09");
  assert.deepEqual(
    [set.recebido, set.base, set.expansao, set.unidade, set.fora],
    [1000, 1000, 500, 200, 0],
  );
  const jul = p.porMes.find((m) => m.mes === "2026-07");
  assert.deepEqual(
    [jul.chegaram.length, jul.cargaInicial, jul.recebido, jul.fora, jul.expansao],
    [1, 1, 7843.18, 7843.18, 0],
  );
  assert.deepEqual(
    p.funil.map((e) => e.clientes.length),
    [5, 3, 2, 0, 0],
  );
  assert.deepEqual(
    p.funil.map((e) => e.taxa),
    [null, 60, 67, 0, null],
  );
  for (let i = 1; i < p.funil.length; i++) {
    assert.ok(p.funil[i].clientes.length <= p.funil[i - 1].clientes.length, "etapa só desce");
    assert.ok(
      p.funil[i].clientes.every((c) => p.funil[i - 1].clientes.includes(c)),
      "etapa cabe na de cima",
    );
  }
  assert.deepEqual(
    p.atencao.encaminhadosFora.map((c) => c.card),
    ["D"],
  );
  assert.deepEqual(
    p.atencao.semCnpj.map((c) => c.card),
    ["E"],
  );
  assert.equal(p.atencao.plataformaSemStatus, true);
  assert.deepEqual(
    p.porUnidade.map((u) => [u.unidade, u.base, u.expansao, u.unidade_]),
    [["Belém", 4000, 2000, 800]],
  );
  const faixa = p.faixas.find((f) => f.faixa.startsWith("R$ 4,8"));
  assert.deepEqual([faixa.chegaram.length, faixa.noOnboarding.length], [1, 1]);
  assert.equal(p.faixas.at(-1).faixa, "Sem faixa declarada");
  for (const m of p.porMes)
    for (const k of ["chegaram", "encaminhados", "trabalhados"])
      assert.ok(Number.isInteger(m[k].length));
});

test("regra muda pela tabela, sem código: incluir quem já pagava a PAT e repassar 20%", () => {
  const regras = REGRAS.map((r) =>
    r.chave === "exclui_cliente_previo_pat"
      ? { ...r, valor: 0 }
      : r.chave === "repasse_expansao"
        ? { ...r, valor: 0.2 }
        : r,
  );
  const p = montarPainel({ ...bruto(CASO), regras }, {}, "2026-10-02");
  assert.equal(p.dinheiro.base, 11843.18);
  assert.equal(p.dinheiro.expansao, 2368.64);
});

test("sem a porta do Financeiro: contagens seguem, dinheiro some (nulo, não zero)", () => {
  const p = montarPainel(bruto(CASO, false), {}, "2026-10-02");
  assert.equal(p.chegaram.length, 3);
  assert.equal(p.dinheiro.expansao, null);
  assert.equal(p.dinheiro.recebido, null);
  assert.ok(p.porMes.every((m) => m.recebido === null && m.expansao === null));
  assert.ok(p.todos.every((c) => c.jaPagavaPat === null && !c.naBase));
  assert.deepEqual(
    p.funil.map((e) => e.clientes.length),
    [5, 3, 0, 0, 0],
  );
});

test("filtros: período corta chegadas e dinheiro; unidade corta tudo", () => {
  const p = montarPainel(bruto(CASO), { de: "2026-09-01", ate: "2026-09-30" }, "2026-10-02");
  assert.deepEqual(
    p.chegaram.map((c) => c.card),
    ["B"],
  );
  assert.equal(p.dinheiro.recebido, 1000);
  assert.deepEqual(p.meses, ["2026-09"]);
  const u = montarPainel(bruto(CASO), { unidade: "Sem unidade" }, "2026-10-02");
  assert.deepEqual(
    u.todos.map((c) => c.card),
    ["D"],
  );
  assert.deepEqual(
    u.unidades.includes("Belém"),
    true,
    "a lista de unidades não encolhe com o filtro",
  );
});

// A plataforma da Consultoria manda projetos e créditos por cliente desde 05/10/2026.
const projeto = (cadastrado, etapa, valor = 0, extra = {}) => ({
  produto: "Diagnóstico de oportunidades",
  linha_produto: "diagnostico_tributario",
  etapa: null,
  etapa_descricao: etapa,
  cadastrado_em: cadastrado,
  na_etapa_desde: cadastrado,
  entregue_em: null,
  encerrado: false,
  encerrado_em: null,
  valor_identificado: valor,
  ...extra,
});
const naPlataforma = (dia, extra) => ({ ...chegou(dia), ...extra });
const REGRAS_05_10 = [
  {
    chave: "repasse_expansao",
    valor: 0.5,
    vigente_desde: "2026-07-01",
    situacao: "confirmada",
    origem: "05/10",
  },
  {
    chave: "repasse_unidade",
    valor: 0,
    vigente_desde: "2026-07-01",
    situacao: "confirmada",
    origem: "05/10",
  },
  {
    chave: "fee_estimado",
    valor: 0.25,
    vigente_desde: "2026-07-01",
    situacao: "confirmada",
    origem: "05/10",
  },
  {
    chave: "exclui_cliente_previo_pat",
    valor: 1,
    vigente_desde: "2026-07-01",
    situacao: "confirmada",
    origem: "05/10",
  },
];

test("plataforma: projeto marca o trabalho, o crédito recuperado vem dela e vence o estimado", () => {
  const clientes = [
    // P1: carga inicial, projeto de fevereiro (antes da chegada), crédito recuperado.
    cli("P1", {
      cnpj: "11111111000111",
      consultoria: naPlataforma("2026-07-26", {
        valor_identificado: 100000,
        credito_aprovado: 90000,
        credito_recuperado: 40000,
        credito_saldo: 50000,
        credito_ultima_recuperacao_em: "2026-09-25",
        projetos: [projeto("2026-02-23", "Pós Entrega", 100000)],
      }),
      pat: [
        {
          mes: "2026-08-01",
          faturado: 10000,
          creditos: 10000,
          recebido: 10000,
          cliente_omie: "P1",
        },
      ],
    }),
    // P2: chegou no kickoff de setembro, projeto aberto, nada identificado ainda.
    cli("P2", {
      cnpj: "22222222000122",
      consultoria: naPlataforma("2026-09-10", {
        valor_identificado: 0,
        credito_recuperado: 0,
        projetos: [
          projeto("2026-09-01", "Pós Entrega", 0, { encerrado: true }),
          projeto("2026-09-29", "Fluxo de Documentos"),
        ],
      }),
    }),
    // P3: chegou e ainda não tem projeto.
    cli("P3", {
      cnpj: "33333333000133",
      consultoria: naPlataforma("2026-09-15", { credito_recuperado: 0, projetos: [] }),
    }),
  ];
  const p = montarPainel({ ...bruto(clientes), regras: REGRAS_05_10 }, {}, "2026-10-05");
  const porCard = Object.fromEntries(p.todos.map((c) => [c.card, c]));
  assert.equal(porCard.P1.trabalhado, true);
  assert.equal(
    porCard.P1.mesTrabalho,
    "2026-07",
    "projeto antes da chegada conta no mês da chegada",
  );
  assert.equal(porCard.P1.etapa, "Pós Entrega");
  assert.equal(porCard.P2.mesTrabalho, "2026-09");
  assert.equal(
    porCard.P2.etapa,
    "Fluxo de Documentos",
    "a etapa é a do projeto aberto mais recente",
  );
  assert.equal(porCard.P3.trabalhado, false);
  assert.equal(p.trabalhados.length, 2);
  assert.equal(p.dinheiro.recuperadoFonte, "plataforma");
  assert.equal(p.dinheiro.recuperado, 40000);
  assert.equal(p.dinheiro.identificado, 100000);
  assert.ok(
    p.porMes.every((m) => m.recuperado === null),
    "sem estimativa mês a mês quando a plataforma informa",
  );
  assert.deepEqual(
    p.funil.map((e) => [e.id, e.clientes.length, e.taxa]),
    [
      ["onboarding", 3, null],
      ["consultoria", 3, 100],
      ["trabalhados", 2, 67],
      ["identificado", 1, 50],
      ["recuperado", 1, 100],
    ],
  );
  assert.equal(p.atencao.plataformaSemStatus, false);
  // Recuperado com identificado zerado na plataforma ainda conta como identificado no funil.
  const zerado = montarPainel(
    {
      ...bruto([
        cli("Z", {
          cnpj: "44444444000144",
          consultoria: naPlataforma("2026-07-26", {
            valor_identificado: 0,
            credito_recuperado: 40939.68,
            projetos: [projeto("2026-03-01", "Pós Entrega")],
          }),
        }),
      ]),
      regras: REGRAS_05_10,
    },
    {},
    "2026-10-05",
  );
  assert.deepEqual(
    zerado.funil.map((e) => e.clientes.length),
    [1, 1, 1, 1, 1],
  );
  // Regra de 05/10: 50% à Expansão e nada para a unidade no onboarding.
  assert.equal(p.regras.proposta, false);
  assert.equal(p.regras.unidade, 0);
  assert.equal(p.dinheiro.expansao, 5000);
  assert.equal(p.dinheiro.unidade, 0);
});
