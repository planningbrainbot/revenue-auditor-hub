// Envio dos pedidos das unidades (PRD da atualização da base, 28/10/2026), com Pipefy e banco simulados.
import test from "node:test";
import assert from "node:assert/strict";
import {
  churnPelaFase,
  contactFields,
  matchContato,
  npsParaDesmarcar,
} from "../supabase/functions/base-clientes-sync/pedidos.mjs";

let handler;
const env = {
  SUPABASE_URL: "https://planning-test.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
  PIPEFY_TOKEN: "source-test-key",
  BASE_CLIENTES_CRON_SECRET: "cron-test-key",
};
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => (handler = fn) };
await import("../supabase/functions/base-clientes-sync/index.ts");

const contatos = [
  { id: 1, pipefy_id: "c1", whatsapp: "5541988887777", nome: "Ana", email: "financeiro@x.com", contato_nps: true },
  { id: 2, pipefy_id: "c2", whatsapp: "5541977776666", nome: "Bruno", email: "financeiro@x.com", contato_nps: false },
];

test("R-09: mesmo WhatsApp no cliente acha o registro; e-mail só com o mesmo nome", () => {
  assert.equal(matchContato(contatos, { whatsapp: "5541988887777", nome: "Outro" })?.pipefy_id, "c1");
  assert.equal(matchContato(contatos, { whatsapp: "5541900000000", nome: "Carla", email: "financeiro@x.com" }), null);
  assert.equal(matchContato(contatos, { whatsapp: "5541900000000", nome: "bruno", email: "FINANCEIRO@x.com" })?.pipefy_id, "c2");
});

test("R-10: desmarca os outros contatos do NPS, não o novo", () => {
  assert.deepEqual(npsParaDesmarcar(contatos, "c2"), ["c1"]);
  assert.deepEqual(npsParaDesmarcar(contatos, "c1"), []);
});

test("Campos do contato: telefone com +55, cargo fora da lista não vai, empresa só ao criar", () => {
  const f = contactFields({ nome: "Ana", whatsapp: "5541988887777", cargo: "Chefe" }, "e9");
  assert.equal(f.find((x) => x.field_id === "whatsapp").field_value, "+5541988887777");
  assert.equal(f.find((x) => x.field_id === "cargo"), undefined);
  assert.deepEqual(f.find((x) => x.field_id === "empresa").field_value, ["e9"]);
  assert.equal(contactFields({ nome: "Ana", whatsapp: "41988887777" }, null).find((x) => x.field_id === "empresa"), undefined);
});

test("R-13: Perdido conclui, Recuperado e card apagado recusam, outra fase segue aberto", () => {
  assert.deepEqual(churnPelaFase({ current_phase: { id: "343394578" } }), { concluido: true, motivo: null });
  assert.equal(churnPelaFase({ current_phase: { id: "343394575" } }).concluido, false);
  assert.equal(churnPelaFase(null).concluido, false);
  assert.equal(churnPelaFase({ current_phase: { id: "343394573" } }), null);
});

// Simula o banco e o Pipefy para um tick com um pedido aprovado.
function simular(pedido, { mesmoCnpj = [] } = {}) {
  const chamadas = { pipefy: [], rpc: [], patch: [] };
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body || "null");
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (url === "https://api.pipefy.com/graphql") {
      chamadas.pipefy.push(body);
      if (body.query.includes("createTableRecord"))
        return ok({ data: { createTableRecord: { table_record: { id: `novo${chamadas.pipefy.length}` } } } });
      if (body.query.includes("setTableRecordFieldValue"))
        return ok({ data: { setTableRecordFieldValue: { table_record: { id: body.variables.id } } } });
      if (body.query.includes("table_record(id:"))
        return ok({ data: { table_record: { id: body.variables.id, table: { id: body.variables.id.startsWith("e") || body.variables.id.startsWith("novo1") ? "nIlE2il6" : "Y2LGWdN-" }, record_fields: [] } } });
      if (body.query.includes("table_fields")) return ok({ data: { table: { table_fields: [] } } });
      if (body.query.includes("table_records("))
        return ok({ data: { table_records: { pageInfo: { hasNextPage: false }, edges: [] } } });
      if (body.query.includes("card(id:")) return ok({ data: { card: null } });
    }
    const rpc = url.match(/\/rpc\/(\w+)$/)?.[1];
    if (rpc) {
      chamadas.rpc.push({ rpc, body });
      if (rpc === "base_pedido_claim") return ok(pedido);
      if (rpc === "base_ingest_lote") return ok([{ status: "ok", empresa_id: 7, contato_id: 9 }]);
      if (rpc === "base_pedidos_churn_abertos") return ok([]);
      if (["base_sync_claim", "base_claim_alteracao"].includes(rpc)) return ok(null);
      return ok(null);
    }
    if (url.includes("/empresas?cnpj=")) return ok(mesmoCnpj);
    if (url.includes("/unidades?")) return ok([]);
    if (options.method === "PATCH") {
      chamadas.patch.push({ url, body });
      return ok([]);
    }
    throw new Error(`endpoint inesperado ${url}`);
  };
  return chamadas;
}
const tick = () =>
  handler(
    new Request("https://planning-test.invalid/f", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-planning-base-cron": "cron-test-key" },
      body: JSON.stringify({ action: "tick" }),
    }),
  );
const muta = (c, campo) => c.pipefy.filter((x) => x.query.includes("setTableRecordFieldValue") && x.variables.field === campo);

test("CA-06: incluir WhatsApp que já existe no cliente atualiza o registro e não cria outro", async () => {
  const c = simular({
    id: "p1", tipo: "contato_incluir", conta_key: "k1", proposto: { nome: "Ana Souza", whatsapp: "5541988887777", contato_nps: false },
    ctx: { conta: { nome: "Cliente", cnpjs: ["11222333000181"] }, empresas: [{ id: 7, pipefy_id: "e1" }], contatos },
  });
  const r = await (await tick()).json();
  assert.equal(r.pedidos.status, "concluido");
  assert.equal(c.pipefy.filter((x) => x.query.includes("createTableRecord")).length, 0);
  assert.equal(muta(c, "nome_completo")[0].variables.id, "c1");
  assert.ok(c.rpc.some((x) => x.rpc === "base_pedido_resultado" && x.body._ok === true));
});

test("CA-11: novo contato do NPS desmarca o anterior antes de marcar o novo", async () => {
  const c = simular({
    id: "p2", tipo: "contato_nps", conta_key: "k1", proposto: { nome: "Bruno" },
    ctx: { empresas: [{ id: 7, pipefy_id: "e1" }], contato: { id: 2, pipefy_id: "c2" }, contatos },
  });
  await tick();
  const nps = muta(c, "contato_do_nps").map((x) => [x.variables.id, x.variables.value[0]]);
  assert.deepEqual(nps, [["c1", "Não"], ["c2", "Sim"]]);
});

test("Repetir o envio depois de falha não cria o contato de novo (resultado guardado)", async () => {
  const c = simular({
    id: "p3", tipo: "contato_incluir", conta_key: "k1", proposto: { nome: "Carla", whatsapp: "5541966665555" },
    resultado: { contato_pipefy: "c9" },
    ctx: { conta: { nome: "Cliente", cnpjs: [] }, empresas: [{ id: 7, pipefy_id: "e1" }], contatos },
  });
  await tick();
  assert.equal(c.pipefy.filter((x) => x.query.includes("createTableRecord")).length, 0);
  assert.equal(muta(c, "whatsapp")[0].variables.id, "c9");
});

test("CA-21: cliente declarado com CNPJ já em Empresas só vincula, sem criar empresa", async () => {
  const c = simular(
    {
      id: "p4", tipo: "cliente_incluir", conta_key: null, proposto: { cnpj: "11222333000181", razao_social: "Lótus Ltda" },
      ctx: { unidade: { pipefy_id: "u1" }, empresas: [], contatos: [], filhos: [{ id: "f1", proposto: { nome: "Dora", whatsapp: "5541955554444", contato_nps: true } }] },
    },
    { mesmoCnpj: [{ pipefy_record_id: "e5" }] },
  );
  await tick();
  const criados = c.pipefy.filter((x) => x.query.includes("createTableRecord"));
  assert.equal(criados.length, 1);
  assert.equal(criados[0].variables.t, "Y2LGWdN-");
  assert.deepEqual(criados[0].variables.f.find((f) => f.field_id === "empresa").field_value, ["e5"]);
});

test("Falha no Pipefy deixa o pedido em erro com a mensagem", async () => {
  simular({ id: "p5", tipo: "contato_editar", conta_key: "k1", proposto: { nome: "X", whatsapp: "5541988887777" }, ctx: { contato: null, contatos } });
  const r = await (await tick()).json();
  assert.equal(r.pedidos.status, "error");
  assert.match(r.pedidos.error, /Stakeholder/);
});
