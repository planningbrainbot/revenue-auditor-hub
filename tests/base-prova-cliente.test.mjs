// Prova de cliente na Base (01/10): nível vindo da ficha (ops.base_conta_prova) e o que ele faz nas ofertas, no filtro e
// na procedência. A regra (quem é grupo, cliente comprovado, fornecedor...) mora no banco; aqui só a leitura.
// Espelho no servidor: 20261001200000_base_prova_fornecedor_admin.sql (monetizacao_offer_issue).
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSES_PROVA,
  EMPTY_PORTFOLIO_FILTERS as empty,
  filtrarCarteira,
  motivoConsultoria,
  nivelProva,
  procedencia,
  soNoOmie,
} from "../src/lib/monetizacao/portfolio.ts";
import { fornecedorForaDeOferta, oferta } from "../src/lib/monetizacao/model.ts";
import { grupoRecon, ofertaRecon } from "../src/lib/monetizacao/recon.ts";

const prova = (nivel, motivo = `motivo ${nivel}`) => ({ nivel, motivo, provas: [], pago_em: [] });
const base = (extra = {}) => ({
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
  ...extra,
});
// Apta em Consultoria e no Recon quando a prova não barra: base antiga, fora do Simples, acima de R$ 5 mi, sem BPO.
const conta = (p, extra = {}) => ({
  key: extra.key ?? "r",
  name: extra.key ?? "r",
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
  base: base({ prova: p, ...(extra.base ?? {}) }),
});

test("Grupo, fornecedor e sem prova saem de todas as ofertas com o motivo do banco", () => {
  for (const nivel of ["grupo", "fornecedor", "sem_prova"]) {
    const a = conta(prova(nivel));
    const esperado = { status: "fora_regra", reason: `motivo ${nivel}` };
    assert.deepEqual(fornecedorForaDeOferta(a), esperado, nivel);
    assert.deepEqual(oferta(a, "consultoria"), esperado, nivel);
    assert.deepEqual(oferta(a, "cella"), esperado, nivel);
    assert.deepEqual(ofertaRecon(a), esperado, nivel);
    assert.equal(grupoRecon(a), "fornecedor", nivel);
    assert.equal(motivoConsultoria(a), "fornecedor", nivel);
  }
});

test("Comprovado, cadastrado e só tag não mudam a oferta; sem prova calculada também não", () => {
  for (const p of [prova("comprovado"), prova("cadastrado"), prova("so_tag"), undefined]) {
    const a = conta(p);
    assert.equal(fornecedorForaDeOferta(a), null, p?.nivel ?? "ausente");
    assert.equal(oferta(a, "consultoria").status, "elegivel", p?.nivel ?? "ausente");
    assert.equal(ofertaRecon(a).status, "elegivel", p?.nivel ?? "ausente");
  }
});

test("Só a tag Cliente da Matriz sai das ofertas; a tag no Omie de uma unidade continua", () => {
  const omie = (cliente_em) => ({
    classe: "cliente",
    cliente_em,
    fornecedor_em: [],
    sincronizado_em: null,
  });
  const matriz = conta(prova("so_tag"), { base: { omie: omie(["Planning Partners (Matriz)"]) } });
  const r = fornecedorForaDeOferta(matriz);
  assert.equal(r?.status, "fora_regra");
  assert.match(r.reason, /Matriz/);
  assert.equal(oferta(matriz, "cella").status, "fora_regra");
  assert.equal(oferta(matriz, "consultoria").status, "fora_regra");
  assert.equal(ofertaRecon(matriz).status, "fora_regra");
  assert.equal(motivoConsultoria(matriz), "fornecedor");
  const unidade = conta(prova("so_tag"), { base: { omie: omie(["Patos de Minas"]) } });
  assert.equal(fornecedorForaDeOferta(unidade), null);
  const ambas = conta(prova("so_tag"), {
    base: { omie: omie(["Planning Partners (Matriz)", "Campo Novo"]) },
  });
  assert.equal(fornecedorForaDeOferta(ambas), null);
});

test("Comprovado com só a tag de fornecedor continua fora (regra de 29/09)", () => {
  const a = conta(prova("comprovado"), {
    base: {
      omie: {
        classe: "fornecedor",
        cliente_em: [],
        fornecedor_em: ["Belém"],
        sincronizado_em: null,
      },
    },
  });
  assert.equal(
    oferta(a, "consultoria").reason,
    "Só fornecedor no Omie (Belém), sem tag de cliente. Fora das ofertas.",
  );
});

test("Filtro 'Prova de cliente' casa os níveis marcados; conta sem prova calculada é 'a calcular'", () => {
  const rows = [
    conta(prova("comprovado"), { key: "comp" }),
    conta(prova("fornecedor"), { key: "forn" }),
    conta(prova("sem_prova"), { key: "sem" }),
    conta(undefined, { key: "nova" }),
  ];
  const data = { cards: [], reservations: [], units: [] };
  const keys = (p) =>
    filtrarCarteira(rows, { ...empty, distrato: ["todas"], prova: p }, data)
      .map((a) => a.key)
      .sort();
  assert.deepEqual(keys([]), ["comp", "forn", "nova", "sem"]);
  assert.deepEqual(keys(["comprovado"]), ["comp"]);
  assert.deepEqual(keys(["fornecedor", "sem_prova"]), ["forn", "sem"]);
  assert.deepEqual(keys(["a_calcular"]), ["nova"]);
  assert.equal(nivelProva(rows[3]), "a_calcular");
  assert.ok(Object.keys(CLASSES_PROVA).includes("grupo"));
});

test("Base antiga só do Omie não é 'Cadastro no Pipefy' (a TIM de Curitiba)", () => {
  const soOmie = conta(prova("sem_prova"), {
    base: { pipefy_ids: [], empresa_ids: [], omie_records: 1 },
  });
  assert.equal(procedencia(soOmie), "omie");
  const planilha = conta(prova("cadastrado"), {
    base: { pipefy_ids: [], empresa_ids: [], omie_records: 0 },
  });
  assert.equal(procedencia(planilha), "pipefy");
  const comCard = conta(prova("cadastrado"), { base: { omie_records: 3 } });
  assert.equal(procedencia(comCard), "pipefy");
});

test("Só no Omie com prova de cliente não fica presa no grupo 'só no cadastro do Omie'", () => {
  const omie = { pipefy_ids: [], empresa_ids: [], omie_records: 2 };
  assert.equal(soNoOmie(conta(prova("comprovado"), { base: omie })), false);
  assert.equal(soNoOmie(conta(prova("so_tag"), { base: omie })), true);
  assert.equal(soNoOmie(conta(undefined, { base: omie })), true);
});
