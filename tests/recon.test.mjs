import test from "node:test";
import assert from "node:assert/strict";
import {
  GRUPOS_RECON,
  grupoRecon,
  ofertaRecon,
  potencialRecon,
  faturamentoRecon,
} from "../src/lib/monetizacao/recon.ts";
const proof = (changes = {}) => ({
  bpo_status: "fora_bpo",
  revenue_min: 10_000_000,
  revenue_max: 25_000_000,
  revenue_exact: null,
  revenue_conflict: false,
  reason: "Contratos conferidos",
  ...changes,
});
const account = (recon = proof(), changes = {}) => ({
  recon,
  contact: false,
  regime: "Simples Nacional",
  ...changes,
});
test("Recon exige receita estritamente acima de 5 milhões e não veta contato ou regime", () => {
  assert.equal(ofertaRecon(account()).status, "elegivel");
  assert.equal(ofertaRecon(account(proof({ revenue_exact: 5_000_000 }))).status, "fora_regra");
  assert.equal(ofertaRecon(account(proof({ revenue_exact: 5_000_001 }))).status, "elegivel");
  assert.equal(
    ofertaRecon(account(proof({ revenue_min: 4_800_000, revenue_max: 10_000_000 }))).status,
    "revisar",
  );
  assert.equal(
    ofertaRecon(account(proof({ revenue_min: null, revenue_max: null }))).status,
    "revisar",
  );
});
test("Recon não admite BPO ou comprovação incompleta como ausência de BPO", () => {
  assert.equal(ofertaRecon(account(proof({ bpo_status: "bpo" }))).status, "fora_regra");
  assert.equal(ofertaRecon(account(proof({ bpo_status: "pendente" }))).status, "revisar");
  assert.equal(ofertaRecon(account(undefined, { recon: undefined })).status, "revisar");
  assert.equal(ofertaRecon(account(proof({ revenue_conflict: true }))).status, "revisar");
  assert.equal(ofertaRecon(account(proof(), { band_conflict: true })).status, "revisar");
});

test("O radar separa oportunidades pendentes sem promovê-las a aptas", () => {
  const ready = account();
  const pendingBpo = account(proof({ bpo_status: "pendente" }));
  const crossing = account(proof({ revenue_min: 4_800_000, revenue_max: 10_000_000 }));
  const missing = account(proof({ revenue_min: null, revenue_max: null }));
  const bpo = account(proof({ bpo_status: "bpo" }));
  const low = account(proof({ revenue_exact: 5_000_000 }));
  const conflict = account(proof({ revenue_conflict: true }));
  const accounts = [ready, pendingBpo, crossing, missing, bpo, low, conflict];
  assert.equal(accounts.filter(potencialRecon).length, 3);
  assert.equal(accounts.filter((a) => ofertaRecon(a).status === "elegivel").length, 1);
  assert.deepEqual(accounts.map(grupoRecon), [
    "elegivel",
    "confirmar_bpo",
    "faixa_limite",
    "sem_faturamento",
    "bpo",
    "abaixo_corte",
    "divergencia",
  ]);
  assert.equal(
    Object.keys(GRUPOS_RECON).reduce(
      (sum, g) => sum + accounts.filter((a) => grupoRecon(a) === g).length,
      0,
    ),
    accounts.length,
  );
});

test("Nota revisada acima de 5 mi resolve faixa limítrofe, preservando conflito e BPO", () => {
  const a = account(
    proof({
      revenue_min: 4_800_000,
      revenue_max: 10_000_000,
      revenue_exact: 5_300_000,
      revenue_label: "R$ 5,3 milhões/ano · nota CRM",
    }),
  );
  assert.equal(grupoRecon(a), "elegivel");
  assert.equal(faturamentoRecon(a), "R$ 5,3 milhões/ano · nota CRM");
  assert.equal(grupoRecon({ ...a, recon: { ...a.recon, revenue_conflict: true } }), "divergencia");
  assert.equal(grupoRecon({ ...a, recon: { ...a.recon, bpo_status: "bpo" } }), "bpo");
  assert.equal(
    faturamentoRecon(account(undefined, { recon: undefined, band: "Faixa original" })),
    "Faixa original",
  );
});
