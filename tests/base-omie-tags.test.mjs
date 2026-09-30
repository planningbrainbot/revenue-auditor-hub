// Tags do cadastro do Omie na Base (29/09): classe vinda da ficha (ops.base_conta_omie_tags) e filtro "Cadastro no
// Omie". A regra das tags mora no banco (trigger base_omie_tags_flags); aqui só a leitura e o filtro.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASSES_OMIE,
  classeOmie,
  EMPTY_PORTFOLIO_FILTERS as empty,
  filtrarCarteira,
} from "../src/lib/monetizacao/portfolio.ts";
import { textoOmie } from "../src/lib/monetizacao/sinais.ts";

const conta = (key, omie) => ({
  key,
  name: key,
  units: [],
  unit_ids: [],
  orgs: [],
  contact: true,
  base: omie === undefined ? undefined : { cnpjs: ["12345678000190"], omie },
});
const sinal = (classe, cliente_em = [], fornecedor_em = []) => ({
  classe,
  cliente_em,
  fornecedor_em,
  sincronizado_em: "2026-09-29T20:00:00Z",
});

test("Sem sinal do Omie a conta é 'fora do Omie'; com sinal, vale a classe do banco", () => {
  assert.equal(classeOmie(conta("a")), "fora_do_omie");
  assert.equal(classeOmie(conta("b", null)), "fora_do_omie");
  assert.equal(classeOmie(conta("c", sinal("fornecedor"))), "fornecedor");
  assert.deepEqual(Object.keys(CLASSES_OMIE), [
    "cliente",
    "cliente_e_fornecedor",
    "fornecedor",
    "pessoa_interna",
    "sem_tag",
    "fora_do_omie",
  ]);
});

test("Filtro 'Cadastro no Omie' casa qualquer classe marcada e vazio não filtra", () => {
  const rows = [
    conta("cli", sinal("cliente", ["Belém"])),
    conta("forn", sinal("fornecedor", [], ["Planning Partners (Matriz)"])),
    conta("ambos", sinal("cliente_e_fornecedor", ["Rio de Janeiro"], ["Rio de Janeiro"])),
    conta("fora"),
  ];
  const data = { cards: [], reservations: [], units: [] };
  const keys = (omie) =>
    filtrarCarteira(rows, { ...empty, distrato: ["todas"], omie }, data)
      .map((a) => a.key)
      .sort();
  assert.deepEqual(keys([]), ["ambos", "cli", "fora", "forn"]);
  assert.deepEqual(keys(["fornecedor"]), ["forn"]);
  assert.deepEqual(keys(["cliente", "cliente_e_fornecedor"]), ["ambos", "cli"]);
  assert.deepEqual(keys(["fora_do_omie"]), ["fora"]);
});

test("Texto do sinal diz a classe e em qual Omie", () => {
  assert.equal(textoOmie(conta("x")), "Fora do Omie");
  assert.equal(
    textoOmie(conta("y", sinal("fornecedor", [], ["Planning Partners (Matriz)"]))),
    "Só fornecedor · fornecedor em Planning Partners (Matriz)",
  );
  assert.equal(
    textoOmie(
      conta("z", sinal("cliente_e_fornecedor", ["Belém"], ["Belém", "Planning Partners (Matriz)"])),
    ),
    "Cliente e fornecedor · cliente em Belém · fornecedor em Belém, Planning Partners (Matriz)",
  );
});
