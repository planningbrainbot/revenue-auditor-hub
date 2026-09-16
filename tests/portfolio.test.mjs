import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PORTFOLIO_FILTERS as empty,
  filtrarCarteira,
  origemBase,
} from "../src/lib/monetizacao/portfolio.ts";
const account = (key, changes = {}) => ({
  key,
  name: key,
  orgs: [],
  regime: "Lucro Presumido",
  band: "R$ 10 milhões até R$ 25 milhões",
  segment: "Indústria",
  contact: true,
  pipedrive_contract: true,
  new_commercial: true,
  old_base: false,
  base_origin: { status: "nova" },
  ...changes,
});
const old = account("antiga", {
  old_base: true,
  new_commercial: false,
  band: null,
  contact: false,
  pipedrive_contract: false,
  segment: null,
  base_origin: { status: "antiga" },
  consultoria_origin: { status: "retroativa" },
});
const fin = account("finance", { orgs: [10] });
const cella = account("cella", { band: "R$ 25 milhões até R$ 50 milhões" });
const missing = account("pendente", {
  regime: null,
  band: null,
  base_origin: { status: "confirmar" },
});
const accounts = [old, fin, cella, missing];
const data = {
  cards: [],
  reservations: [],
  units: [{ key: "u1", account_keys: ["antiga", "finance"] }],
};
const keys = (filters, rows = accounts, d = data) =>
  filtrarCarteira(rows, { ...empty, ...filters }, d)
    .map((a) => a.key)
    .sort();

test("Selecionar produto filtra mesmo sem situação; Consultoria não inclui fechamento comercial", () => {
  assert.deepEqual(keys({ product: "finance" }), ["finance"]);
  assert.deepEqual(keys({ product: "cella" }), ["cella"]);
  assert.deepEqual(keys({ product: "consultoria" }), ["antiga"]);
  assert.deepEqual(keys({ product: "consultoria", status: "excluded" }), [
    "cella",
    "finance",
    "pendente",
  ]);
  assert.deepEqual(keys({ product: "finance", status: "review" }), ["pendente"]);
});
test("Origem, unidade, contato, regime, segmento e faixa combinam por interseção", () => {
  assert.deepEqual(
    keys({
      unit: "u1",
      origin: "antiga",
      contact: "false",
      band: "unknown",
      segment: "unknown",
      regime: "Lucro Presumido",
    }),
    ["antiga"],
  );
  assert.deepEqual(keys({ origin: "nova", band: "25" }), ["cella"]);
  assert.deepEqual(keys({ band: "exact:R$ 10 milhões até R$ 25 milhões", query: " FINANCE " }), [
    "finance",
  ]);
  assert.deepEqual(keys({ regime: "unknown" }), ["pendente"]);
  assert.deepEqual(keys({ origin: "divergente" }), []);
  assert.equal(
    origemBase(account("sem_origem", { base_origin: undefined, new_commercial: false })),
    "confirmar",
  );
});
test("Disponibilidade por produto não confunde reserva de outra oferta", () => {
  const d = {
    ...data,
    reservations: [
      { account_key: "finance", product: "finance", status: "sending", deal_id: null },
    ],
  };
  assert.deepEqual(keys({ product: "finance", status: "free" }, accounts, d), []);
  assert.deepEqual(keys({ product: "finance", status: "occupied" }, accounts, d), ["finance"]);
  const other = {
    ...data,
    reservations: [
      { account_key: "finance", product: "consultoria", status: "sending", deal_id: null },
    ],
  };
  assert.deepEqual(keys({ product: "finance", status: "free" }, accounts, other), ["finance"]);
});
test("Sobreposição preserva a oferta selecionada e não soma contas", () => {
  const both = {
    ...old,
    key: "ambas",
    pipedrive_contract: true,
    band: "R$ 10 milhões até R$ 25 milhões",
  };
  assert.deepEqual(keys({ product: "finance", overlap: true }, [...accounts, both]), ["ambas"]);
  assert.deepEqual(keys({ product: "consultoria", overlap: true }, [...accounts, both]), ["ambas"]);
});

test("Origem atual divergente ou nova não conserva uma aprovação retroativa antiga", () => {
  for (const status of ["nova", "divergente", "confirmar"]) {
    assert.deepEqual(keys({ product: "consultoria" }, [{ ...old, base_origin: { status } }]), []);
  }
});
