// Tags do cadastro do Omie na Base (29/09): classe vinda da ficha (ops.base_conta_omie_tags) e filtro "Cadastro no
// Omie". A regra das tags mora no banco (trigger base_omie_tags_flags); aqui só a leitura e o filtro.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSES_OMIE,
  classeOmie,
  EMPTY_PORTFOLIO_FILTERS as empty,
  filtrarCarteira,
  motivoConsultoria,
} from "../src/lib/monetizacao/portfolio.ts";
import { textoOmie } from "../src/lib/monetizacao/sinais.ts";
import { oferta, fornecedorForaDeOferta } from "../src/lib/monetizacao/model.ts";
import { grupoRecon, ofertaRecon } from "../src/lib/monetizacao/recon.ts";

const conta = (key, omie) => ({
  key,
  name: key,
  units: [],
  unit_ids: [],
  orgs: [],
  contact: true,
  base: omie === undefined ? undefined : { cnpjs: ["12345678000190"], omie },
});
const sinal = (classe, cliente_em = [], fornecedor_em = []) => ({
  classe,
  cliente_em,
  fornecedor_em,
  sincronizado_em: "2026-09-29T20:00:00Z",
});

test("Sem sinal do Omie a conta é 'fora do Omie'; com sinal, vale a classe do banco", () => {
  assert.equal(classeOmie(conta("a")), "fora_do_omie");
  assert.equal(classeOmie(conta("b", null)), "fora_do_omie");
  assert.equal(classeOmie(conta("c", sinal("fornecedor"))), "fornecedor");
  assert.deepEqual(Object.keys(CLASSES_OMIE), [
    "cliente",
    "cliente_e_fornecedor",
    "fornecedor",
    "pessoa_interna",
    "sem_tag",
    "fora_do_omie",
  ]);
});

test("Filtro 'Cadastro no Omie' casa qualquer classe marcada e vazio não filtra", () => {
  const rows = [
    conta("cli", sinal("cliente", ["Belém"])),
    conta("forn", sinal("fornecedor", [], ["Planning Partners (Matriz)"])),
    conta("ambos", sinal("cliente_e_fornecedor", ["Rio de Janeiro"], ["Rio de Janeiro"])),
    conta("fora"),
  ];
  const data = { cards: [], reservations: [], units: [] };
  const keys = (omie) =>
    filtrarCarteira(rows, { ...empty, distrato: ["todas"], omie }, data)
      .map((a) => a.key)
      .sort();
  assert.deepEqual(keys([]), ["ambos", "cli", "fora", "forn"]);
  assert.deepEqual(keys(["fornecedor"]), ["forn"]);
  assert.deepEqual(keys(["cliente", "cliente_e_fornecedor"]), ["ambos", "cli"]);
  assert.deepEqual(keys(["fora_do_omie"]), ["fora"]);
});

test("Texto do sinal diz a classe e em qual Omie", () => {
  assert.equal(textoOmie(conta("x")), "Fora do Omie");
  assert.equal(
    textoOmie(conta("y", sinal("fornecedor", [], ["Planning Partners (Matriz)"]))),
    "Só fornecedor · fornecedor em Planning Partners (Matriz)",
  );
  assert.equal(
    textoOmie(
      conta("z", sinal("cliente_e_fornecedor", ["Belém"], ["Belém", "Planning Partners (Matriz)"])),
    ),
    "Cliente e fornecedor · cliente em Belém · fornecedor em Belém, Planning Partners (Matriz)",
  );
});

// Regra de oferta (dono, 29/09: "sim deve sair", "deve só ser mencionado"): só fornecedor no Omie sai das ofertas,
// Recon inclusive, e a Base mostra o motivo. Espelho no servidor: 20260929210000_fornecedor_fora_da_oferta.sql.

const baseApta = (omie) => ({
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
  tax_evidence: {
    non_simples: true,
    conflict: false,
    covered: true,
    checked_at: null,
    sources: [],
  },
  responsible: null,
  validated_at: null,
  synced_at: null,
  source_status: "ok",
  needs_validation: false,
  needs_source_correction: false,
  omie,
});
// Apta em Consultoria: base antiga, sem fechamento comercial, fora do Simples.
const retroativa = (omie) => ({
  key: "r",
  name: "r",
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
  recon: { bpo_status: "fora_bpo", revenue_exact: 12_000_000, reason: "Fora do BPO" },
  base: baseApta(omie),
});

test("Só fornecedor sai de todas as ofertas com o motivo; cliente e fornecedor continua", () => {
  const forn = retroativa(sinal("fornecedor", [], ["Rio de Janeiro"]));
  const ambos = retroativa(sinal("cliente_e_fornecedor", ["Rio de Janeiro"], ["Rio de Janeiro"]));
  const fora = retroativa(undefined);
  assert.equal(oferta(fora, "consultoria").status, "elegivel");
  assert.equal(oferta(ambos, "consultoria").status, "elegivel");
  const o = oferta(forn, "consultoria");
  assert.equal(o.status, "fora_regra");
  assert.equal(
    o.reason,
    "Só fornecedor no Omie (Rio de Janeiro), sem tag de cliente. Fora das ofertas.",
  );
  assert.deepEqual(fornecedorForaDeOferta(forn), o);
  for (const p of ["finance", "cella"]) assert.equal(oferta(forn, p).status, "fora_regra");
  assert.equal(ofertaRecon(forn).reason, o.reason);
  assert.equal(ofertaRecon(fora).status, "elegivel");
});

test("Fornecedor tem motivo e grupo próprios: não vira Simples nem 'Até R$ 5 mi'", () => {
  const forn = retroativa(sinal("fornecedor", [], ["Planning Partners (Matriz)"]));
  assert.equal(motivoConsultoria(forn), "fornecedor");
  assert.equal(grupoRecon(forn), "fornecedor");
  assert.equal(motivoConsultoria(retroativa(undefined)), "apta");
});
