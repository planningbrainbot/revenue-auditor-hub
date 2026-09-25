import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCnpj,
  resolveUnit,
  classifyOrigin,
  refinement,
  strictDate,
  canonicalContacts,
} from "../supabase/functions/base-clientes-sync/domain.mjs";
import {
  webhookRecord,
  mapCompany,
  mapContact,
} from "../supabase/functions/base-clientes-sync/pipefy.mjs";

const cnpj = "11222333000181"; // Documento sintético com dígitos verificadores válidos.
const units = [
  { id: 1, pipefy_id: "pf-rj", nome_da_praca: "Rio de Janeiro" },
  { id: 2, pipefy_id: "pf-cwb", nome_da_praca: "Curitiba" },
  { id: 3, pipefy_id: "pf-sbc", nome_da_praca: "São Bernardo" },
];

test("AC02/08: normaliza documento, recusa CPF, repetição e dígito verificador inválido", () => {
  assert.equal(normalizeCnpj("11.222.333/0001-81"), cnpj);
  for (const value of [null, "", "11111111111111", "12345678901", "11222333000182"])
    assert.equal(normalizeCnpj(value), null);
});
test("AC09: aliases e códigos conhecidos apontam à mesma unidade, sem usar cidade do cliente", () => {
  assert.equal(resolveUnit("Sudeste (RJ)", units).id, 1);
  assert.equal(resolveUnit('["pf-rj"]', units).id, 1);
  assert.equal(resolveUnit(1055, units, [{ id: 1055, label: "São Bernardo" }]).id, 3);
  assert.equal(resolveUnit("999999", units).status, "unknown");
  assert.equal(resolveUnit(["pf-rj", "pf-cwb"], units).status, "multiple");
});
test("AC03: Omie fora de Curitiba é Nova, com ou sem pagamento, sobrepondo origem antiga declarada", () => {
  for (const payment of [null, false, true]) {
    const result = classifyOrigin({
      omieUnits: ["Rio de Janeiro"],
      declared: "Base Antiga",
      payment,
    });
    assert.equal(result.status, "nova");
    assert.equal(result.expectedPipefy, "Base Nova");
    assert.equal(result.needsSourceCorrection, true);
  }
});
test("AC04: Curitiba usa vigência e não presença, ganho ou data de cadastro", () => {
  const input = {
    omieUnits: ["Curitiba"],
    pipedrivePresent: true,
    commercialWon: true,
    contractCoverage: true,
  };
  assert.equal(classifyOrigin({ ...input }).status, "confirmar");
  assert.equal(classifyOrigin({ ...input, firstContractDates: ["2025-03-31"] }).status, "antiga");
  assert.equal(classifyOrigin({ ...input, firstContractDates: ["2025-05-01"] }).status, "nova");
  for (const date of ["2025-04-01", "2025-04-30"])
    assert.equal(classifyOrigin({ ...input, firstContractDates: [date] }).status, "confirmar");
  assert.equal(
    classifyOrigin({ ...input, firstContractDates: ["2024-01-01", "2026-01-01"] }).status,
    "confirmar",
  );
  assert.equal(
    classifyOrigin({ ...input, firstContractDates: ["2024-01-01"], contractCoverage: false })
      .status,
    "confirmar",
  );
  assert.equal(
    classifyOrigin({ ...input, units: ["Curitiba", "Belém"], firstContractDates: ["2024-01-01"] })
      .status,
    "confirmar",
  );
});
test("AC05: qualquer registro Pipedrive fora de Curitiba determina Nova", () => {
  const input = {
    units: ["Belém"],
    pipedrivePresent: true,
    commercialWon: false,
    declared: "Base Antiga",
  };
  assert.equal(classifyOrigin(input).status, "nova");
  assert.equal(classifyOrigin({ ...input, units: ["Curitiba"] }).status, "confirmar");
  assert.equal(classifyOrigin({ ...input, units: [] }).status, "confirmar");
  assert.equal(classifyOrigin({ ...input, identityConflict: true }).status, "confirmar");
});
test("AC06: sem vínculo gera validação da unidade e preserva a origem declarada como evidência", () => {
  const result = classifyOrigin({ declared: "Base Antiga" });
  assert.equal(result.status, "confirmar");
  assert.equal(result.requiresUnitValidation, true);
  assert.equal(result.declared, "Base Antiga");
  assert.equal(result.expectedPipefy, null);
});
test("AC07/08: refinamento cumulativo exige ECD do CNPJ correto e não conta contato/negócio como empresa", () => {
  const rows = [
    {
      key: "a",
      cnpjs: [cnpj],
      contacts: [{ type: "email", value: "a@example.test" }],
      ecd: [{ cnpj, year: 2024 }],
    },
    { key: "b", cnpjs: [cnpj], contacts: [], ecd: [{ cnpj, year: 2024 }] },
    { key: "c", cnpjs: [], contacts: [{ type: "phone", value: "11999999999" }], ecd: [] },
  ];
  assert.deepEqual(refinement(rows).counts, { raw: 3, cnpj: 2, contact: 1, ecd: 1 });
  assert.deepEqual(refinement([...rows, rows[0]]).counts, refinement(rows).counts);
  assert.equal(
    refinement([{ ...rows[0], ecd: [{ cnpj: "00000000000000", year: 2024 }] }]).counts.ecd,
    0,
  );
});
test("AC02: contato mantém identidade própria; e-mail/telefone vazios não comprovam contatabilidade", () => {
  assert.equal(
    canonicalContacts([
      { id: "1", email: "A@example.test" },
      { id: "1", email: "A@example.test" },
    ]).length,
    1,
  );
  assert.equal(canonicalContacts([{ id: "1", email: "" }])[0].reachable, false);
});
test("AC15: datas ISO e brasileiras válidas; não transforma mês 14 nem dia inexistente em sucesso", () => {
  assert.equal(strictDate("14/07/2026"), "2026-07-14");
  assert.equal(strictDate("2026-07-14"), "2026-07-14");
  assert.equal(strictDate("2026-14-07"), null);
  assert.equal(strictDate("31/02/2026"), null);
  assert.equal(strictDate("2024-02-29T12:00:00Z"), "2024-02-29");
});
test("AC10: recebe o formato atual de webhook Pipefy de tabela e não confia no valor enviado", () => {
  assert.deepEqual(
    webhookRecord(
      {
        data: {
          action: "card.field_update",
          card: { id: 123, pipe_id: "companies" },
          new_value: "não confiar",
        },
      },
      ["companies"],
    ),
    { action: "card.field_update", id: "123", table: "companies", deleted: false },
  );
  assert.equal(
    webhookRecord(
      { data: { action: "card.create", card: { id: 123, pipe_id: "outro-projeto" } } },
      ["companies"],
    ),
    null,
  );
  assert.equal(
    webhookRecord(
      { action: "table_record.update", data: { table_record: { id: 123, table_id: "companies" } } },
      ["companies"],
    ).id,
    "123",
  );
});
test("AC10/11: campo esvaziado na fonte vira nulo; campo que não existe no schema é preservado", () => {
  const record = {
    id: "pf-company",
    title: "Empresa sintética",
    updated_at: "2026-09-16T12:00:00Z",
    record_fields: [
      { field: { id: "cnpj" }, value: "11.222.333/0001-81" },
      { field: { id: "unidade" }, array_value: ["pf-rj"] },
    ],
  };
  const result = mapCompany(record, ["cnpj", "unidade", "segmento", "origem_da_base"], units);
  assert.equal(result.fields.cnpj, cnpj);
  assert.equal(result.fields.unidade, "Rio de Janeiro");
  assert.equal(result.fields.segmento, null);
  assert.equal(Object.hasOwn(result.fields, "regime_tributario"), false);
  assert.equal(result.unit.id, 1);
});
test("AC02/10: vínculo de contato usa ID da empresa e deixa múltiplos vínculos explícitos", () => {
  const r = mapContact(
    {
      id: "p1",
      title: "Pessoa sintética",
      record_fields: [
        { field: { id: "empresa" }, array_value: ["e1", "e2"] },
        { field: { id: "e_mail_direto" }, value: "p@example.test" },
      ],
    },
    ["empresa", "e_mail_direto", "nome_completo"],
  );
  assert.deepEqual(r.companyRefs, ["e1", "e2"]);
  assert.equal(r.fields.email, "p@example.test");
});
