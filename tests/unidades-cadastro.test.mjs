import test from "node:test";
import assert from "node:assert/strict";
import {
  lerData,
  lerNumeroBr,
  lerRegistroPipefy,
  normalizarCnpjs,
  normalizarEmails,
  normalizarSigla,
  pendenciasDaUnidade,
  statusDaUnidade,
  tempoDeCasa,
  validarUnidade,
} from "../src/lib/unidades-cadastro.ts";

const base = {
  nome_da_praca: "  Natal ",
  tipo: "regional",
  razao_social: " PLANNING NATAL LTDA ",
  cnpj: "29543734000107",
  data_inauguracao: "",
  royalties_percentual: 12,
  csc_valor_fixo: 5000,
  csc_percentual_base_antiga: null,
  midia_mensal: null,
  midia_cac: false,
  paga_cac: false,
  cac_desde: "2026-02-01",
  absorve_midia: false,
  id_omie: "",
  id_asaas: null,
  pipefy_id: "1448470601",
  pipedrive_opcao_id: 1200,
  observacoes_financeiras: "",
};

test("Validação limpa texto, formata CNPJ e não inventa zero", () => {
  const l = validarUnidade(base);
  assert.equal(l.nome_da_praca, "Natal");
  assert.equal(l.razao_social, "PLANNING NATAL LTDA");
  assert.equal(l.cnpj, "29.543.734/0001-07");
  assert.equal(l.data_inauguracao, null);
  assert.equal(l.midia_mensal, null);
  assert.equal(l.id_omie, null);
  assert.equal(l.observacoes_financeiras, null);
  // Sem CAC a data de início some: o funil de CAC lê cac_desde.
  assert.equal(l.cac_desde, null);
  assert.equal(validarUnidade({ ...base, paga_cac: true }).cac_desde, "2026-02-01");
});

test("Validação recusa o que quebraria a reconciliação por nome", () => {
  assert.throws(() => validarUnidade({ ...base, nome_da_praca: "  " }), /nome/);
  assert.throws(() => validarUnidade({ ...base, nome_da_praca: "1055" }), /só número/);
  assert.throws(() => validarUnidade({ ...base, tipo: "franquia" }), /regional ou interna/);
  assert.throws(() => validarUnidade({ ...base, royalties_percentual: 120 }), /Royalties/);
  assert.throws(() => validarUnidade({ ...base, pipedrive_opcao_id: 10.5 }), /Pipedrive/);
  assert.throws(() => validarUnidade({ ...base, id_omie: "UNIDADE-NAT" }), /Omie/);
});

test("CNPJ aceita várias entidades, uma por linha, e recusa número curto", () => {
  assert.equal(
    normalizarCnpjs("36.729.702/0001-58\n17721729000150; 17.721.729/0001-50"),
    "36.729.702/0001-58\n17.721.729/0001-50",
  );
  assert.equal(normalizarCnpjs("  "), null);
  assert.throws(() => normalizarCnpjs("1234"), /14 dígitos/);
});

test("Número e data no formato do Pipefy", () => {
  assert.equal(lerNumeroBr("20.000,00"), 20000);
  assert.equal(lerNumeroBr("R$ 5.000,50"), 5000.5);
  assert.equal(lerNumeroBr("8"), 8);
  assert.equal(lerNumeroBr(""), null);
  assert.equal(lerData("25/09/2026"), "2026-09-25");
  assert.equal(lerData("2026-09-25T00:00:00Z"), "2026-09-25");
  assert.throws(() => lerData("31/02/2026"), /inválida/);
});

test("Registro do Pipefy vira formulário, lendo pelo id do campo", () => {
  const r = lerRegistroPipefy({
    id: "1367065618",
    title: "Belém",
    record_fields: [
      { field: { id: "nome_da_pra_a" }, value: "Belém" },
      { field: { id: "csc_valor_fixo_r" }, value: "20.000,00" },
      { field: { id: "royalties" }, value: "8" },
      { field: { id: "cnpj" }, value: "60.455.832/0001-24" },
      { field: { id: "email_do_financeiro" }, value: "Financeiro.Belem@grupoplanning.com.br" },
      { field: { id: "data_de_inaugura_o" }, value: "data ruim" },
    ],
  });
  assert.equal(r.unidade_de_negocio, "Belém");
  assert.equal(r.csc_valor_fixo, 20000);
  assert.equal(r.royalties_percentual, 8);
  assert.equal(r.cnpj, "60.455.832/0001-24");
  assert.deepEqual(r.emails, ["financeiro.belem@grupoplanning.com.br"]);
  // Campo ilegível fica vazio em vez de derrubar a lista.
  assert.equal(r.data_inauguracao, null);
});

test("Pendências: regional cobra o que a apuração usa; interna só os vínculos", () => {
  const regional = {
    tipo: "regional",
    cnpj: null,
    razao_social: null,
    data_inauguracao: null,
    royalties_percentual: null,
    pipedrive_opcao_id: null,
    pipefy_id: null,
    id_omie: null,
  };
  assert.deepEqual(
    pendenciasDaUnidade(regional, false).map((p) => p.chave),
    ["pipedrive", "pipefy", "cnpj", "razao_social", "inauguracao", "royalties", "omie", "csc"],
  );
  // Sem leitura de csc_unidades a pendência não é afirmada.
  assert.ok(!pendenciasDaUnidade(regional, null).some((p) => p.chave === "csc"));
  assert.deepEqual(
    pendenciasDaUnidade({ ...regional, tipo: "interna", pipedrive_opcao_id: 719 }, false).map(
      (p) => p.chave,
    ),
    ["pipefy"],
  );
});

test("Sigla e e-mails do CSC", () => {
  assert.equal(normalizarSigla(" são "), "SAO");
  assert.throws(() => normalizarSigla("S"), /2 a 5/);
  assert.deepEqual(normalizarEmails(["A@x.com.br, b@x.com.br", "a@x.com.br"]), [
    "a@x.com.br",
    "b@x.com.br",
  ]);
  assert.throws(() => normalizarEmails(["sem-arroba"]), /inválido/);
});

test("status e tempo de casa leem a data no fuso local", () => {
  const hoje = new Date(2026, 9, 1); // 01/10/2026
  assert.equal(statusDaUnidade({ tipo: "interna", data_inauguracao: "2030-01-01" }, hoje), "interna");
  assert.equal(statusDaUnidade({ tipo: "regional", data_inauguracao: "2026-10-01" }, hoje), "ativa");
  assert.equal(statusDaUnidade({ tipo: "regional", data_inauguracao: "2026-10-02" }, hoje), "futura");
  assert.equal(statusDaUnidade({ tipo: "regional", data_inauguracao: null }, hoje), "ativa");
  assert.equal(tempoDeCasa("2026-09-01", hoje), "1 mês");
  assert.equal(tempoDeCasa("2024-10-01", hoje), "2 anos");
  assert.equal(tempoDeCasa("2025-04-15", hoje), "1a 6m");
  assert.equal(tempoDeCasa("2026-11-01", hoje), "inicia 11/2026");
  assert.equal(tempoDeCasa(null, hoje), "—");
});
