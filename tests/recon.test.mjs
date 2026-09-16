import test from "node:test";
import assert from "node:assert/strict";
import { ofertaRecon } from "../src/lib/monetizacao/recon.ts";
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
