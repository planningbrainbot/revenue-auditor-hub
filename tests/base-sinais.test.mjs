// Distrato (Central de Tratativas) e Consultoria (plataforma do Pedro Siqueira) na geração de bases.
// Espelho no servidor: tests/base-sinais.sql (paridade de ops.base_distrato_bloqueio e
// ops.base_consultoria_bloqueio com as regras abaixo).
import test from "node:test";
import assert from "node:assert/strict";
import {
  consultoriaForaDeOferta,
  distratoForaDeOferta,
  oferta,
  propostasAbertas,
  valorPropostas,
} from "../src/lib/monetizacao/model.ts";
import {
  EMPTY_PORTFOLIO_FILTERS as empty,
  estadoDistrato,
  filtrarCarteira,
  motivoConsultoria,
  vinculosConsultoria,
} from "../src/lib/monetizacao/portfolio.ts";
import { grupoRecon, ofertaRecon } from "../src/lib/monetizacao/recon.ts";

const base = (changes = {}) => ({
  key: "k",
  cnpjs: ["12345678000190"],
  empresa_ids: [1],
  pipefy_ids: ["p1"],
  pipedrive_ids: [],
  omie_units: [],
  omie_records: 0,
  contact_count: 0,
  contact: true,
  ecd: [],
  declared_origin: [],
  origin: "antiga",
  origin_reason: "Base Antiga",
  tax_evidence: { non_simples: true, conflict: false, covered: true, checked_at: null, sources: [] },
  responsible: null,
  validated_at: null,
  synced_at: null,
  source_status: "ok",
  needs_validation: false,
  needs_source_correction: false,
  ...changes,
});
// Apta em Finance (contrato ganho, abaixo de R$ 25 mi, fora do Simples), fora em Cella.
const finance = (key, baseChanges = {}, changes = {}) => ({
  key,
  name: key,
  orgs: [],
  regime: "Lucro Presumido",
  band: "R$ 10 milhões até R$ 25 milhões",
  segment: "Indústria",
  contact: true,
  pipedrive_contract: true,
  new_commercial: true,
  old_base: false,
  base_origin: { status: "nova" },
  base: base({ origin: "nova", ...baseChanges }),
  ...changes,
});
// Apta em Consultoria: base antiga, sem fechamento comercial, fora do Simples.
const retroativa = (key, baseChanges = {}, changes = {}) => ({
  key,
  name: key,
  orgs: [],
  regime: "Lucro Real",
  band: null,
  segment: null,
  contact: false,
  pipedrive_contract: false,
  new_commercial: false,
  old_base: true,
  base_origin: { status: "antiga" },
  consultoria_origin: { status: "retroativa", non_simples_confirmed: true },
  base: base(baseChanges),
  ...changes,
});
const distrato = (estado, extra = {}) => ({
  distrato: {
    estado,
    fase: estado === "tratativa" ? "Contatar ASAP" : "Churn Confirmado (Perdido)",
    card_id: "1",
    data_churn: estado === "concluido" ? "2026-02-03" : null,
    categoria: null,
    casamento: "pipefy",
    cards: 1,
    atualizado_em: null,
    sincronizado_em: null,
    ...extra,
  },
});
const cliente = (casamento = "cnpj", extra = {}) => ({
  consultoria: {
    cliente: {
      casamento,
      cnpj: "12345678000190",
      razao_social: "X",
      ativo: true,
      inativo_desde: null,
      valor_a_recuperar: null,
      valor_a_recuperar_em: null,
      regime_tributario: null,
      parceiro: null,
      cadastrado_em: null,
      ...extra,
    },
    propostas: [],
    sincronizado_em: null,
  },
});
const proposta = (casamento, extra = {}) => ({
  id: casamento + (extra.id ?? ""),
  categoria: "Proposta",
  status: null,
  produto: "Reforma Tributária",
  linha_produto: null,
  valor_total: 92000,
  tipo_cobranca: "fixo",
  percentual_exito: null,
  data_envio: "2026-04-06",
  data_ultimo_fup: null,
  data_proximo_fup: null,
  responsavel: null,
  casamento,
  ...extra,
});
const comPropostas = (...ps) => ({ consultoria: { cliente: null, propostas: ps, sincronizado_em: null } });

test("Distrato concluído tira a conta de todos os produtos e do Recon, com a data do churn", () => {
  const a = finance("fin", distrato("concluido"));
  for (const p of ["consultoria", "finance", "cella"]) assert.equal(oferta(a, p).status, "fora_regra");
  assert.match(oferta(a, "finance").reason, /Distrato concluído.*03\/02\/2026/);
  const r = retroativa("ret", distrato("concluido"));
  assert.equal(oferta(r, "consultoria").status, "fora_regra");
  assert.equal(ofertaRecon(a).status, "fora_regra");
  assert.equal(grupoRecon(a), "distrato");
});

test("Em tratativa só rebaixa o que o produto aceitaria: apta vira a confirmar, fora continua fora", () => {
  const a = finance("fin", distrato("tratativa"));
  assert.equal(oferta(a, "finance").status, "revisar");
  assert.match(oferta(a, "finance").reason, /tratativa de distrato.*Contatar ASAP/);
  // Cella já recusava pela faixa: o motivo continua o da faixa, não o da tratativa.
  assert.equal(oferta(a, "cella").status, "fora_regra");
  assert.match(oferta(a, "cella").reason, /Cella/);
  // Sem card, a mesma conta é apta: a tratativa é o único motivo da troca.
  assert.equal(oferta(finance("limpa"), "finance").status, "elegivel");
});

test("Retido na tratativa não muda regra nenhuma", () => {
  const a = finance("fin", distrato("revertido"));
  assert.equal(distratoForaDeOferta(a), null);
  assert.equal(oferta(a, "finance").status, "elegivel");
});

test("Cliente da Consultoria, por CNPJ ou pela raiz, não recebe Consultoria; Finance e Cella não mudam", () => {
  const porCnpj = retroativa("c1", cliente("cnpj"));
  const porRaiz = retroativa("c2", cliente("raiz"));
  assert.equal(oferta(porCnpj, "consultoria").status, "fora_regra");
  assert.match(oferta(porCnpj, "consultoria").reason, /Já é cliente da Consultoria/);
  assert.match(oferta(porRaiz, "consultoria").reason, /raiz do CNPJ 12345678/);
  assert.equal(motivoConsultoria(porCnpj), "cliente");
  const fin = finance("f", cliente("cnpj"));
  assert.equal(oferta(fin, "finance").status, "elegivel");
});

test("Ex-cliente (ativo = false) não bloqueia Consultoria", () => {
  const a = retroativa("ex", cliente("cnpj", { ativo: false, inativo_desde: "2026-01-01" }));
  assert.equal(consultoriaForaDeOferta(a), null);
  assert.equal(oferta(a, "consultoria").status, "elegivel");
  assert.deepEqual(vinculosConsultoria(a), ["ex_cliente"]);
});

test("Proposta aberta por CNPJ ou raiz bloqueia Consultoria; casada pelo nome é só selo", () => {
  const cnpj = retroativa("p1", comPropostas(proposta("cnpj")));
  assert.equal(oferta(cnpj, "consultoria").status, "fora_regra");
  assert.match(oferta(cnpj, "consultoria").reason, /Proposta da Consultoria em aberto \(R\$ 92 mil, enviada em 06\/04\/2026\)/);
  const raiz = retroativa("p2", comPropostas(proposta("raiz")));
  assert.equal(oferta(raiz, "consultoria").status, "fora_regra");
  const nome = retroativa("p3", comPropostas(proposta("nome")));
  assert.equal(oferta(nome, "consultoria").status, "elegivel");
  assert.deepEqual(vinculosConsultoria(nome), ["proposta_incerta"]);
  // Proposta que a plataforma marcar como perdida não bloqueia.
  const perdida = retroativa("p4", comPropostas(proposta("cnpj", { status: "perdida" })));
  assert.equal(oferta(perdida, "consultoria").status, "elegivel");
});

test("Contrato registrado na plataforma bloqueia Consultoria como cliente", () => {
  const a = retroativa("ct", comPropostas(proposta("cnpj", { categoria: "Contrato" })));
  assert.match(oferta(a, "consultoria").reason, /Contrato da Consultoria/);
  assert.deepEqual(vinculosConsultoria(a), ["contrato"]);
});

test("Valor das propostas não inventa zero para proposta sem valor", () => {
  const ps = [proposta("cnpj", { id: "a" }), proposta("cnpj", { id: "b", valor_total: null })];
  assert.deepEqual(valorPropostas(ps), { total: 92000, semValor: 1 });
  assert.equal(propostasAbertas(retroativa("x", comPropostas(...ps))).length, 2);
});

test("Tabela padrão esconde distrato concluído; o filtro o mostra, e 'todas' tira o filtro", () => {
  const rows = [
    finance("concluida", distrato("concluido")),
    finance("tratativa", distrato("tratativa")),
    finance("retida", distrato("revertido")),
    finance("sem"),
  ];
  const data = { cards: [], reservations: [], units: [] };
  const keys = (f) =>
    filtrarCarteira(rows, { ...empty, ...f }, data)
      .map((a) => a.key)
      .sort();
  assert.deepEqual(keys({}), ["retida", "sem", "tratativa"]);
  assert.deepEqual(keys({ distrato: ["concluido"] }), ["concluida"]);
  assert.deepEqual(keys({ distrato: ["todas"] }), ["concluida", "retida", "sem", "tratativa"]);
  assert.deepEqual(keys({ distrato: ["tratativa", "sem"] }), ["sem", "tratativa"]);
  assert.equal(estadoDistrato(rows[3]), "sem");
});

test("Filtro de Consultoria casa qualquer vínculo marcado", () => {
  const rows = [
    retroativa("cli", cliente("cnpj")),
    retroativa("raiz", cliente("raiz")),
    retroativa("prop", comPropostas(proposta("cnpj"))),
    retroativa("nada"),
  ];
  const data = { cards: [], reservations: [], units: [] };
  const keys = (consultoria) =>
    filtrarCarteira(rows, { ...empty, consultoria }, data)
      .map((a) => a.key)
      .sort();
  assert.deepEqual(keys(["cliente", "cliente_raiz"]), ["cli", "raiz"]);
  assert.deepEqual(keys(["proposta"]), ["prop"]);
  assert.deepEqual(keys(["sem"]), ["nada"]);
});
