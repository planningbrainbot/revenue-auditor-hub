import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emailRecuperacaoSenha } from "../src/lib/email-templates.ts";

test("Template publicado no Auth corresponde ao layout compartilhado, com link e código", () => {
  const html = emailRecuperacaoSenha({
    link: "https://planningbrain.com.br/redefinir-senha#token_hash={{ .TokenHash }}&type=recovery",
    codigo: "{{ .Token }}",
  }).html;
  assert.equal(
    readFileSync(new URL("../supabase/templates/recovery.html", import.meta.url), "utf8"),
    html + "\n",
  );
  assert.ok(html.includes("#token_hash={{ .TokenHash }}&amp;type=recovery"));
  assert.ok(html.includes("{{ .Token }}"));
  assert.equal(html.includes(".ConfirmationURL"), false);
  assert.ok(html.includes("/brand/planning-logo-dark.png"));
  assert.ok(html.includes("#0ae18c"));
  assert.ok(html.includes("1 hora"));
  assert.equal(/<script|<form|<iframe/i.test(html), false);
  assert.ok(Buffer.byteLength(html) < 100_000);
});
