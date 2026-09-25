import test from "node:test";
import assert from "node:assert/strict";
import { enviarEmailAcesso, accessEmailStatus } from "../src/lib/email-access.server.ts";

const input = {
  to: "usuario@example.com",
  subject: "Acesso",
  html: "<p>Link de acesso</p>",
  text: "Link de acesso",
};

test("Acesso usa somente o remetente da Planning e preserva o destinatário solicitado", async (t) => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "synthetic-test-key";
  t.after(() =>
    previous === undefined
      ? delete process.env.RESEND_API_KEY
      : (process.env.RESEND_API_KEY = previous),
  );
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ id: "synthetic-email-id" }), { status: 200 });
  });
  assert.deepEqual(await enviarEmailAcesso(input), { enviado: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.resend.com/emails");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    from: "Planning Brain <noreply@planningbrain.com.br>",
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  });
  assert.equal(calls[0].options.headers.Authorization, "Bearer synthetic-test-key");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(JSON.stringify(accessEmailStatus()).includes("synthetic-test-key"), false);
});

test("Sem chave não chama nenhum provedor nem informa sucesso", async (t) => {
  const previous = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  t.after(() =>
    previous === undefined
      ? delete process.env.RESEND_API_KEY
      : (process.env.RESEND_API_KEY = previous),
  );
  const fetch = t.mock.method(globalThis, "fetch", () => {
    throw new Error("Não deveria enviar");
  });
  assert.equal((await enviarEmailAcesso(input)).enviado, false);
  assert.equal(accessEmailStatus().configured, false);
  assert.equal(fetch.mock.callCount(), 0);
});

test("Erros do provedor e de rede não vazam o corpo da mensagem ou a chave", async (t) => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "synthetic-secret";
  t.after(() =>
    previous === undefined
      ? delete process.env.RESEND_API_KEY
      : (process.env.RESEND_API_KEY = previous),
  );
  const logs = [];
  t.mock.method(console, "error", (...args) => logs.push(args));
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("synthetic-secret", { status: 403 }),
  );
  const rejected = await enviarEmailAcesso(input);
  assert.equal(rejected.enviado, false);
  fetch.mock.mockImplementation(async () => {
    throw new Error("synthetic-secret");
  });
  const failed = await enviarEmailAcesso(input);
  assert.equal(failed.enviado, false);
  assert.equal(JSON.stringify({ logs, rejected, failed }).includes("synthetic-secret"), false);
});
