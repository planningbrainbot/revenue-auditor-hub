import test from "node:test";
import assert from "node:assert/strict";
import {
  fillHandoff,
  qualificationFields,
  safeLink,
  plainText,
  samePerson,
} from "../supabase/functions/monetizacao-crm/handoff.mjs";
import { PRODUCT } from "../supabase/functions/monetizacao-crm/crm.mjs";
const context = () => ({
  nonce: "synthetic",
  deal_id: 10,
  org_id: 20,
  product: "finance",
  contacts_allowed: true,
  account: {
    name: "Empresa sintética",
    orgs: [20],
    pipedrive_contract_id: 30,
    band: "R$ 1 milhão até R$ 2 milhões",
    regime: "Lucro Real",
  },
  contacts: [],
  channels: [],
  cnpjs: [],
  review: {},
  detail: {},
  documents: [],
  contract_ids: [30],
});
function harness({ failUpload = false } = {}) {
  const target = {
    id: 10,
    pipeline_id: 39,
    org_id: { value: 20 },
    user_id: { id: 40 },
    person_id: null,
    [PRODUCT]: 1130,
  };
  const original = {
    id: 30,
    pipeline_id: 1,
    org_id: { value: 20 },
    person_id: { value: 50 },
    title: "Origem sintética",
    status: "won",
  };
  const notes = [],
    files = [],
    participants = [],
    writes = [];
  let uploadFailure = failUpload;
  const api = {
    async pages(path, p = {}) {
      if (path === "notes")
        return p.org_id
          ? []
          : p.deal_id === 10
            ? notes
            : [{ id: 60, content: "<p>Pedido de diagnóstico.</p>", add_time: "2026-09-01" }];
      if (path === "organizations/20/files") return [];
      if (path === "organizations/20/persons")
        return [
          {
            id: 50,
            name: "Pessoa sintética",
            org_id: { value: 20 },
            email: [{ value: "pessoa@example.com" }],
            phone: [],
          },
        ];
      if (path === "deals/10/participants") return participants;
      if (path === "dealFields") return [];
      if (path === "deals/10/files") return files;
      if (path === "deals/30/files")
        return [{ id: 70, deal_id: 30, active_flag: true, name: "proposta.pdf", file_size: 100 }];
      throw Error("unexpected " + path);
    },
    async pd(path, p = {}, body, method = "POST") {
      if (body) writes.push({ path, body, method });
      if (path === "deals/10") {
        if (body) Object.assign(target, body);
        return { data: target };
      }
      if (path === "deals/30") return { data: original };
      if (path === "notes") {
        const n = { id: 100 + notes.length, ...body };
        notes.push(n);
        return { data: n };
      }
      if (path.startsWith("notes/")) {
        const n = notes.find((n) => n.id === Number(path.split("/")[1]));
        Object.assign(n, body);
        return { data: n };
      }
      throw Error("unexpected " + path);
    },
    async copyFile(id, deal, name) {
      const f = { id: 80 + files.length, name };
      files.push(f);
      if (uploadFailure) {
        uploadFailure = false;
        throw Error("resposta perdida");
      }
      return f;
    },
  };
  return { api, target, original, notes, files, writes };
}
test("prepara contato, ficha, histórico e arquivo; reexecução não duplica", async () => {
  const h = harness(),
    ctx = context();
  const first = await fillHandoff(ctx, h.api);
  assert.equal(first.status, "complete");
  assert.equal(h.target.person_id, 50);
  assert.equal(first.notes, 1);
  assert.equal(first.files, 1);
  const noteCount = h.notes.length,
    fileCount = h.files.length;
  await fillHandoff(ctx, h.api);
  assert.equal(h.notes.length, noteCount);
  assert.equal(h.files.length, fileCount);
  assert.ok(h.notes.some((n) => n.content.includes("[PB:synthetic:dossier]")));
});
test("upload com resposta perdida é reconciliado pelo nome; não recria negócio/arquivo", async () => {
  const h = harness({ failUpload: true });
  assert.equal((await fillHandoff(context(), h.api)).status, "partial");
  assert.equal((await fillHandoff(context(), h.api)).status, "complete");
  assert.equal(h.files.length, 1);
  assert.equal(
    h.writes.some((w) => w.path === "deals"),
    false,
  );
});
test("empresa/produto divergente bloqueia preenchimento sem escrita", async () => {
  for (const change of [{ org_id: 21 }, { [PRODUCT]: 1128 }]) {
    const h = harness();
    Object.assign(h.target, change);
    await assert.rejects(fillHandoff(context(), h.api), /mudou/);
    assert.equal(h.writes.length, 0);
  }
});
test("campos de qualificação usam opções válidas sem levar ticket da venda anterior", () => {
  const fields = [
    { key: "band", name: "Faturamento anual", options: [{ id: 1, label: "Até R$ 500 mil" }] },
    { key: "value", name: "Valor da Oportunidade" },
    { key: "erp", name: "ERP do cliente", options: [{ id: 2, label: "Outro" }] },
    { key: "doc", name: "CNPJ", field_type: "double" },
  ];
  const payload = qualificationFields(
    fields,
    { band: "Até R$ 500 mil" },
    {},
    { value: 90000, erp: 2 },
    ["01234567890123"],
  );
  assert.deepEqual(payload, { band: 1, erp: 2, doc: 1234567890123 });
  assert.deepEqual(
    qualificationFields(fields, { band: "Outra faixa" }, {}, { value: 9, erp: 99 }),
    {},
  );
  assert.deepEqual(
    qualificationFields(fields, { band: "Até R$ 500 mil", band_conflict: true }),
    {},
  );
});
test("contato precisa de canal coincidente; conteúdo e links não transportam scripts/segredos", () => {
  assert.equal(
    samePerson({ email: [{ value: "a@example.com" }], phone: [] }, { email: "A@example.com" }),
    true,
  );
  assert.equal(samePerson({ email: [], phone: [] }, { name: "Mesmo nome" }), false);
  assert.equal(safeLink("javascript:alert(1)"), null);
  assert.equal(safeLink("https://example.com?api_token=segredo"), null);
  assert.equal(plainText("<script>segredo()</script><p>Fato</p>").trim(), "Fato");
  assert.equal(
    plainText('<a href="https://example.com/doc">Documento</a>'),
    "Documento (https://example.com/doc)",
  );
  assert.equal(plainText('<a href="javascript:alert(1)">Documento</a>'), "Documento");
});
