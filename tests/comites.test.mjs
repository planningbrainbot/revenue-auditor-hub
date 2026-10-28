// Contas da tela /comites (contrato docs/design/contratos/comites.md).
import test from "node:test";
import assert from "node:assert/strict";
import { linkPesquisa, ordenarComites, porComite, resumir, slugCodigo } from "../src/lib/comites.ts";

const resp = (nps, extra = {}) => ({
  id: Math.random(),
  created_at: "2026-09-10T21:50:00Z",
  comite_codigo: "operacoes-2026-09",
  nps_recomendaria: nps,
  clareza_resultados: 4,
  utilidade_novidades: 5,
  clareza_proximos_passos: 4,
  frente_prioritaria: "cs_onboarding",
  comentario: null,
  ...extra,
});

test("NPS é % promotores menos % detratores", () => {
  // 2 promotores (9, 10), 1 neutro (8), 1 detrator (6): (2 - 1) / 4 = 25
  const r = resumir([resp(9), resp(10), resp(8), resp(6)]);
  assert.equal(r.nps, 25);
  assert.equal(r.promotores, 2);
  assert.equal(r.neutros, 1);
  assert.equal(r.detratores, 1);
});

test("sem resposta não inventa nota", () => {
  const r = resumir([]);
  assert.equal(r.nps, null);
  assert.equal(r.clareza, null);
  assert.deepEqual(r.frentes, []);
});

test("médias com uma casa e frentes ordenadas por voto", () => {
  const r = resumir([
    resp(10, { clareza_resultados: 4 }),
    resp(10, { clareza_resultados: 5, frente_prioritaria: "wallet" }),
    resp(9, { clareza_resultados: 4 }),
  ]);
  assert.equal(r.clareza, 4.3);
  assert.deepEqual(r.frentes.map((f) => [f.rotulo, f.votos]), [
    ["CS e onboarding", 2],
    ["Wallet", 1],
  ]);
});

test("comentário vazio não conta", () => {
  const r = resumir([resp(9, { comentario: "  " }), resp(9, { comentario: "Bom" })]);
  assert.deepEqual(r.comentarios.map((c) => c.texto), ["Bom"]);
});

test("respostas sem código de comitê ficam de fora", () => {
  const m = porComite([resp(9), resp(9, { comite_codigo: null }), resp(9, { comite_codigo: "growth-2026-10" })]);
  assert.equal(m.get("operacoes-2026-09").length, 1);
  assert.equal(m.get("growth-2026-10").length, 1);
});

test("comitê sem data vem primeiro, depois o mais recente", () => {
  const c = (titulo, data) => ({ titulo, data });
  assert.deepEqual(
    ordenarComites([c("Set", "2026-09-10"), c("Out", null), c("Ago", "2026-08-10")]).map((x) => x.titulo),
    ["Out", "Set", "Ago"],
  );
});

test("código e link da pesquisa", () => {
  assert.equal(slugCodigo("Comitê de Outubro 2026"), "comite-de-outubro-2026");
  assert.equal(linkPesquisa("growth-2026-10"), "https://comite-pesquisa-planning17.vercel.app/?c=growth-2026-10");
});
