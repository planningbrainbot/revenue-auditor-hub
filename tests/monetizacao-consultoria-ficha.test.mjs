// Consultoria › Buscar empresa: a ficha completa sobre o espelho da plataforma (src/lib/monetizacao/consultoria-ficha.ts),
// o índice com o que só a plataforma tem (consultoria-empresa.ts) e as regras da consultoria-plataforma-sync.
import test from "node:test";
import assert from "node:assert/strict";
import { montarFicha, tomTese } from "../src/lib/monetizacao/consultoria-ficha.ts";
import { indiceEmpresas, buscarEmpresas } from "../src/lib/monetizacao/consultoria-empresa.ts";
import {
  caminhoPagina,
  documento,
  linhaEspelho,
  statusRodada,
  TABELAS,
} from "../supabase/functions/consultoria-plataforma-sync/domain.mjs";

const vazia = {
  lido_em: "2026-10-16T12:00:00Z",
  sincronizado_em: "2026-10-16T11:52:00Z",
  porta_financeiro: { aberta: true, motivo: null },
  clientes: [],
  projetos: [],
  prazos: [],
  gestores_projeto: [],
  gestores: [],
  teses: [],
  temas_projeto: [],
  areas: [],
  fups: [],
  historico: [],
  retificacoes: [],
  propostas: [],
  classificacao: [],
  estoques: [],
  movimentos: [],
  utilizacoes: [],
  canais: [{ id: "k1", nome: "Parceiros com GC" }],
  parceiros: [{ id: "pa1", apelido: "Emasfi" }],
  faturas: [],
  recebimentos: [],
  provisoes: [],
};

test("ficha: projeto com teses, gestores, canal e prazo; o valor deixa as declinadas e as baixadas de fora", () => {
  const f = montarFicha(
    {
      ...vazia,
      clientes: [{ id: "c1", razao_social: "Acme Ltda", capital_social: 1000, natureza_juridica: "LTDA" }],
      projetos: [
        {
          id: "p1",
          cliente_id: "c1",
          produto: "Diagnóstico",
          departamento: "diagnostico_tributario",
          etapa_atual: "fluxo_documentos",
          sub_status: "aguardando",
          baixado: false,
          data_entrada: "2026-09-01",
          canal_venda_id: "k1",
          parceiro_id: "pa1",
        },
        { id: "p2", cliente_id: "c1", produto: "Retificação", baixado: true, data_entrada: "2026-10-01" },
      ],
      prazos: [{ projeto_id: "p1", dias_na_etapa: 40, meta_dias: 30, dias_alem_da_meta: 10 }],
      gestores: [{ id: "g1", nome: "Thiara" }],
      gestores_projeto: [{ projeto_id: "p1", gestor_id: "g1", area: "impostos_diretos" }],
      teses: [
        { id: "t1", projeto_id: "p1", tema: "PIS", oportunidade: 100, convertido_status: "Sim" },
        { id: "t2", projeto_id: "p1", tema: "INSS", oportunidade: 50, convertido_status: "Declinado" },
        { id: "t4", projeto_id: "p1", tema: "ICMS", oportunidade: 20, convertido_status: "Baixada" },
        { id: "t3", projeto_id: null, tema: "IRPJ", oportunidade: 30, convertido_status: "Em Negociação" },
      ],
    },
    "2026-10-16",
  );
  assert.equal(f.cadastro.razao, "Acme Ltda");
  // Abertos primeiro.
  assert.deepEqual(
    f.projetos.map((p) => p.id),
    ["p1", "p2"],
  );
  const p1 = f.projetos[0];
  assert.equal(p1.valor, 100);
  assert.equal(p1.canal, "Parceiros com GC");
  assert.equal(p1.parceiro, "Emasfi");
  assert.equal(p1.etapa, "Fluxo de Documentos");
  assert.deepEqual(p1.gestores, ["Thiara (Impostos diretos)"]);
  assert.equal(p1.prazo.alem, 10);
  assert.equal(f.valorSemProjeto, 30);
  assert.equal(f.teses.find((t) => t.id === "t1").projeto, "Diagnóstico");
  assert.equal(f.teses.find((t) => t.id === "t3").projeto, null);
  assert.deepEqual(
    f.tesesPorStatus.map((s) => [s.status, s.valor]),
    [
      ["Sim", 100],
      ["Declinado", 50],
      ["Em Negociação", 30],
      ["Baixada", 20],
    ],
  );
  assert.equal(tomTese("Declinado"), "perigo");
});

test("ficha: propostas de todos os status, estoque com saldo e movimentos, atraso no recebimento", () => {
  const f = montarFicha(
    {
      ...vazia,
      propostas: [
        { id: "a", status: "perdida", data_envio: "2026-05-01", motivo_perda: "preço" },
        { id: "b", status: "aceita", data_envio: "2026-08-01", data_aceite: "2026-08-10" },
        { id: "c", status: "em_negociacao", data_envio: "2026-09-01" },
      ],
      estoques: [
        {
          id: "e1",
          tipo_credito: "Ressarcimento",
          status: "ativo",
          valor_total_aprovado: 1000,
          aliquota_exito: 0.15,
          saldo: { total_utilizado: 400, saldo_atual: 600, total_exito_gerado: 60 },
        },
      ],
      movimentos: [
        { estoque_id: "e1", competencia: "2026-08", declaracao_compensacoes: 100, deposito_contas: 0 },
        { estoque_id: "e1", competencia: "2026-09", declaracao_compensacoes: 0, deposito_contas: 0 },
      ],
      faturas: [
        { data_faturamento: "2026-09-01", valor: 500, status_fatura: "ativa" },
        { data_faturamento: "2026-08-01", valor: 999, status_fatura: "substituida" },
      ],
      recebimentos: [
        { data_vencimento: "2026-09-10", valor_conta: 500, valor_recebido: 0, valor_a_receber: 500 },
        { data_vencimento: "2026-11-10", valor_conta: 200, valor_recebido: 0, valor_a_receber: 200 },
        { data_vencimento: "2026-08-10", valor_conta: 300, valor_recebido: 300, valor_a_receber: 0 },
        { data_vencimento: "2026-07-10", valor_conta: 50, valor_a_receber: 50, cancelado: true },
      ],
    },
    "2026-10-16",
  );
  assert.deepEqual(
    f.propostas.map((p) => [p.id, p.rotuloStatus]),
    [
      ["c", "Em negociação"],
      ["b", "Aceita"],
      ["a", "Perdida"],
    ],
  );
  assert.equal(f.propostas[2].motivoPerda, "preço");
  const e = f.estoques[0];
  assert.equal(e.utilizado, 400);
  assert.equal(e.saldo, 600);
  assert.equal(e.exitoPct, 15);
  // Mês sem movimento nenhum some.
  assert.deepEqual(
    e.movimentos.map((m) => m.competencia),
    ["2026-08"],
  );
  assert.equal(f.financeiro.faturado, 500);
  assert.equal(f.financeiro.recebido, 300);
  assert.equal(f.financeiro.aReceber, 700);
  assert.equal(f.financeiro.emAtraso, 500);
});

test("ficha: sem a porta do Financeiro, faturas e recebimentos não aparecem", () => {
  const f = montarFicha(
    {
      ...vazia,
      porta_financeiro: { aberta: false, motivo: "sem acesso" },
      faturas: null,
      recebimentos: null,
      provisoes: null,
    },
    "2026-10-16",
  );
  assert.equal(f.financeiro, null);
  assert.equal(f.portaFinanceiro.aberta, false);
});

test("ficha: histórico em frases", () => {
  const f = montarFicha(
    {
      ...vazia,
      gestores: [{ id: "g1", nome: "Thiara" }],
      historico: [
        {
          entidade_tipo: "projeto_gestao",
          evento_tipo: "mudanca_fase",
          fase_origem: "fila_processamento",
          fase_destino: "operacao",
          data_evento: "2026-09-02",
        },
        {
          entidade_tipo: "projeto_gestao",
          evento_tipo: "atribuicao_responsavel",
          payload: { gestor_id: "g1", area: "impostos_diretos" },
          data_evento: "2026-09-03",
          ator: "Pedro Siqueira",
        },
        { entidade_tipo: "projeto_gestao", evento_tipo: "baixa", payload: { motivo: "finalizado" }, data_evento: "2026-09-04" },
        { entidade_tipo: "proposta", evento_tipo: "criacao", data_evento: "2026-08-01" },
        {
          entidade_tipo: "proposta",
          evento_tipo: "mudanca_fase",
          fase_origem: "em_negociacao",
          fase_destino: "aceita",
          data_evento: "2026-08-18",
        },
      ],
    },
    "2026-10-16",
  );
  assert.deepEqual(
    f.historico.map((h) => h.texto),
    [
      "Projeto baixado: finalizado",
      "Gestor atribuído: Thiara (Impostos diretos)",
      "Projeto: Fila de Processamento → Operação",
      "Proposta: em negociação → aceita",
      "Proposta criada",
    ],
  );
  assert.equal(f.historico[1].quem, "Pedro Siqueira");
});

// ─── Índice da busca com o espelho da plataforma ─────────────────────────────────────────────────

const CRUZ = {
  lido_em: "2026-10-16T12:00:00Z",
  porta_financeiro: { aberta: true, motivo: null },
  frescor: { consultoria: null, negocios: null, financeiro_carregado_em: null },
  clientes: [
    {
      id: "c1",
      cnpj: "11111111000101",
      cnpj_raiz: "11111111",
      razao_social: "Acme Indústria Ltda",
      nome_fantasia: null,
      grupo_economico: null,
      regime_tributario: "Lucro Real",
      porte: null,
      parceiro: null,
      cadastrado_em: "2026-09-01",
      valor_identificado: 0,
      credito_recuperado: 0,
      projetos: [],
    },
  ],
  propostas: [],
  negocios: [],
  pat: [],
};
const PLAT = {
  lido_em: "2026-10-16T12:00:00Z",
  sincronizado_em: "2026-10-16T11:52:00Z",
  projetos_sem_cliente: [
    { id: "o1", nome: "VEOLINK", apelido: null, etapa: "pos_entrega", baixado: false, data_entrada: "2026-06-01" },
    { id: "o2", nome: "ACME INDUSTRIA LTDA", apelido: null, etapa: "operacao", baixado: false, data_entrada: "2026-07-01" },
  ],
  teses_sem_projeto: [{ empresa: "Castropil", teses: 16, valor: 1000 }],
  propostas: [
    { id: "pr1", empresa: "Qualquer nome", cnpj: null, cliente_id: "c1", status: "aceita", valor_total: 10 },
    { id: "pr2", empresa: "Gradiente", cnpj: null, cliente_id: null, status: "em_negociacao", valor_total: 92000 },
  ],
};

test("índice: proposta pelo cliente, proposta sem cadastro, projeto sem CNPJ e teses pelo nome", () => {
  const idx = indiceEmpresas(CRUZ, null, "2026-10-16", PLAT);
  const acme = idx.find((e) => e.chave === "11111111000101");
  // A proposta ligada ao cliente cai na ficha dele, qualquer que seja o nome digitado.
  assert.deepEqual(
    acme.propostas.map((p) => p.id),
    ["pr1"],
  );
  // O projeto sem cliente com o mesmo nome também.
  assert.deepEqual(
    acme.semCadastro.projetos.map((p) => p.id),
    ["o2"],
  );
  const grad = idx.find((e) => e.chave === "proposta:gradiente");
  assert.equal(grad.situacao.rotulo, "Proposta da Consultoria");
  assert.equal(grad.situacao.tom, "info");
  const veo = idx.find((e) => e.chave === "projeto:veolink");
  assert.equal(veo.situacao.rotulo, "Projeto sem CNPJ");
  assert.match(veo.situacao.detalhe, /Pós-entrega/);
  const cas = idx.find((e) => e.chave === "tese:castropil");
  assert.equal(cas.semCadastro.teses, 16);
  assert.equal(cas.situacao.rotulo, "Teses sem projeto");
  // E todas são buscáveis pelo nome.
  assert.equal(buscarEmpresas(idx, "gradiente")[0].chave, "proposta:gradiente");
  assert.equal(buscarEmpresas(idx, "veolink")[0].chave, "projeto:veolink");
});

test("índice: sem o espelho, o comportamento de antes (só a API)", () => {
  const idx = indiceEmpresas(CRUZ, null, "2026-10-16");
  assert.equal(idx.length, 1);
  assert.deepEqual(idx[0].semCadastro, { projetos: [], teses: 0, valorTeses: 0 });
});

// ─── Regras da consultoria-plataforma-sync ───────────────────────────────────────────────────────

test("sync: linha do espelho, documento, página e status da rodada", () => {
  const spec = (t) => TABELAS.find((x) => x.tabela === t);
  assert.equal(documento("11.111.111/0001-01"), "11111111000101");
  assert.equal(documento("123"), null);
  const l = linhaEspelho(spec("projetos_gestao"), {
    id: "p1",
    cliente_id: null,
    cnpj: null,
    razao_social: "VEOLINK",
  });
  assert.deepEqual(
    { id: l.id, cliente: l.cliente_id, projeto: l.projeto_id, cnpj: l.cnpj, nome: l.nome },
    { id: "p1", cliente: null, projeto: "p1", cnpj: null, nome: "VEOLINK" },
  );
  assert.equal(
    linhaEspelho(spec("projeto_gestores"), { projeto_id: "p1", gestor_id: "g1", area: null }).id,
    "p1|g1|",
  );
  assert.equal(linhaEspelho(spec("clientes"), { razao_social: "sem id" }), null);
  assert.equal(
    caminhoPagina(spec("vw_linha_do_tempo"), 2),
    "vw_linha_do_tempo?select=*&entidade_tipo=in.(projeto_gestao,proposta,retificacao)&order=id&limit=1000&offset=2000",
  );
  assert.equal(statusRodada([{ lidos: 1 }, { erro: "x" }]), "parcial");
  assert.equal(statusRodada([{ erro: "x" }]), "erro");
  assert.equal(statusRodada([{ lidos: 1 }]), "sucesso");
});
