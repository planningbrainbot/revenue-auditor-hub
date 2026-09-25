import test from "node:test";
import assert from "node:assert/strict";
let handler;
const env = {
  SUPABASE_URL: "https://planning-test.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "service-test-key",
  PIPEFY_TOKEN: "source-test-key",
  BASE_CLIENTES_WEBHOOK_SECRET: "webhook-test-key",
};
globalThis.Deno = {
  env: { get: (k) => env[k] },
  serve: (fn) => {
    handler = fn;
  },
};
await import("../supabase/functions/base-clientes-sync/index.ts");
const record = {
  table: { id: "nIlE2il6" },
  id: "company-test",
  title: "Empresa sintética",
  updated_at: "2026-09-16T15:00:00Z",
  record_fields: [{ field: { id: "raz_o_social" }, value: "Valor confirmado na origem" }],
};
function request(body, headers = {}) {
  return new Request("https://planning-test.invalid/function", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const event = {
  data: {
    action: "card.field_update",
    card: { id: "company-test", pipe_id: "nIlE2il6" },
    new_value: "Valor forjado no evento",
  },
};
function fakeSource(found = record) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body || "null");
    calls.push({ url, body, method: options.method });
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (url === "https://api.pipefy.com/graphql") {
      if (body.query.includes("table_record(id:")) return ok({ data: { table_record: found } });
      if (body.query.includes("table_fields"))
        return ok({ data: { table: { table_fields: [{ id: "raz_o_social" }] } } });
      if (body.query.includes("table_records("))
        return ok({
          data: { table_records: { pageInfo: { hasNextPage: false, endCursor: null }, edges: [] } },
        });
    }
    if (url.includes("/unidades?")) return ok([]);
    if (url.endsWith("/base_sync_execucoes")) return ok([{ id: "run-test" }]);
    if (url.includes("/base_sync_execucoes?id=")) return ok([]);
    if (url.endsWith("/rpc/base_ingest_lote")) return ok([{ status: "ok", empresa_id: 1 }]);
    if (url.endsWith("/rpc/base_refresh_cadastro")) return ok(1);
    if (url.endsWith("/rpc/base_pipefy_ausente")) return ok(null);
    throw new Error("Unexpected endpoint in test");
  };
  return calls;
}
test("Webhook: recusa chamada sem autenticação e não consulta sistemas", async () => {
  globalThis.fetch = () => {
    throw new Error("Network must not be called");
  };
  assert.equal((await handler(request(event))).status, 401);
});
test("Webhook: segredo não concede operações cron nem acesso a outra tabela", async () => {
  const headers = { "x-planning-base-secret": "webhook-test-key" };
  assert.equal((await handler(request({ action: "tick" }, headers))).status, 400);
  assert.equal(
    (
      await handler(
        request({ data: { ...event.data, card: { id: "x", pipe_id: "other-project" } } }, headers),
      )
    ).status,
    400,
  );
});
test("Webhook: grava valor relido; ignora conteúdo forjado e confirma a execução", async () => {
  const calls = fakeSource();
  const r = await handler(request(event, { "x-planning-base-secret": "webhook-test-key" }));
  assert.equal(r.status, 200);
  const write = calls.find((c) => c.url.endsWith("/rpc/base_ingest_lote"));
  assert.equal(write.body._registros[0].campos.razao_social, "Valor confirmado na origem");
  assert.equal(JSON.stringify(write.body).includes("Valor forjado"), false);
  assert.equal(calls.at(-1).body.status, "ok");
});
test("Webhook: delete atrasado não remove registro que continua presente na fonte", async () => {
  const calls = fakeSource();
  await handler(
    request(
      { data: { ...event.data, action: "card.delete" } },
      { "x-planning-base-secret": "webhook-test-key" },
    ),
  );
  assert.ok(calls.some((c) => c.url.endsWith("/rpc/base_ingest_lote")));
  assert.equal(
    calls.some((c) => c.url.endsWith("/rpc/base_pipefy_ausente")),
    false,
  );
});
test("Webhook: ausência confirmada marca estado sem DELETE nem perda de histórico", async () => {
  const calls = fakeSource(null);
  const r = await handler(request(event, { "x-planning-base-secret": "webhook-test-key" }));
  assert.equal((await r.json()).status, "absent");
  assert.equal(
    calls.some((c) => c.method === "DELETE"),
    false,
  );
  assert.ok(calls.some((c) => c.url.endsWith("/rpc/base_pipefy_ausente")));
});

test("Webhook: valida a tabela no registro relido, não apenas no payload recebido", async () => {
  const calls = fakeSource({ ...record, table: { id: "other-project" } });
  const r = await handler(request(event, { "x-planning-base-secret": "webhook-test-key" }));
  assert.equal(r.status, 502);
  assert.equal(
    calls.some((c) => c.url.endsWith("/rpc/base_ingest_lote")),
    false,
  );
});
