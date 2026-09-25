// Cache da carga da conversa (25/09): por pessoa; carga com parte em erro dura só o prazo curto.
import test from "node:test";
import assert from "node:assert/strict";
import { criarCachePorPessoa } from "../src/lib/cockpit-ceo/conversa/cache.ts";

const novo = () =>
  criarCachePorPessoa({
    validadeMs: 600_000,
    validadeComErroMs: 30_000,
    temErro: (v) => v.erro === true,
  });

test("o cache é por pessoa: a carga de uma nunca serve a outra", async () => {
  const c = novo();
  let n = 0;
  const a = await c.obter("a", 0, async () => ({ dono: "a", n: ++n }));
  const b = await c.obter("b", 0, async () => ({ dono: "b", n: ++n }));
  assert.equal(a.dono, "a");
  assert.equal(b.dono, "b");
  assert.equal((await c.obter("a", 599_999, async () => ({ dono: "x" }))).n, a.n);
  assert.equal((await c.obter("a", 600_001, async () => ({ dono: "a", n: 9 }))).n, 9);
});

test("carga com parte em erro é refeita depois do prazo curto; falha inteira não fica", async () => {
  const c = novo();
  await c.obter("c", 0, async () => ({ erro: true }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((await c.obter("c", 29_999, async () => ({ erro: false }))).erro, true);
  assert.equal((await c.obter("c", 30_001, async () => ({ erro: false }))).erro, false);
  await c
    .obter("d", 0, async () => {
      throw new Error("fora");
    })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((await c.obter("d", 1, async () => ({ ok: 1 }))).ok, 1);
});
