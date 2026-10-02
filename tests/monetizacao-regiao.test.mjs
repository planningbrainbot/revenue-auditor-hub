// Regra de região do Finance (frente 02, 02/10/2026): src/lib/monetizacao/regiao.ts e o gancho em oferta().
// O servidor repete a regra em ops.monetizacao_finance_regiao_issue (migration 20261002160000).
import test from "node:test";
import assert from "node:assert/strict";
import {
  aplicarRegiaoFinance,
  linhasDaRegiao,
  regiaoPorConta,
} from "../src/lib/monetizacao/regiao.ts";
import { oferta } from "../src/lib/monetizacao/model.ts";

const LINHAS = [
  { linha: "FCO", regioes: ["Centro-Oeste"], ativa: true },
  { linha: "BASA", regioes: ["Norte"], ativa: false },
  { linha: "FNE", regioes: ["Nordeste"], ativa: false },
  { linha: "BNDES", regioes: null, ativa: true },
  { linha: "FINAME", regioes: null, ativa: true },
];
const ELEGIVEL = {
  status: "elegivel",
  reason: "Contrato ganho no Pipedrive, faturamento abaixo de R$ 25 mi e regime fora do Simples.",
};
const r = (regra, uf, regiao) => ({
  regra,
  uf,
  regiao,
  fonte: uf ? "cadastro" : null,
  conflito: false,
  linhas: LINHAS,
});

test("desligada ou ausente: a oferta não muda", () => {
  assert.deepEqual(aplicarRegiaoFinance(ELEGIVEL, undefined), ELEGIVEL);
  assert.deepEqual(aplicarRegiaoFinance(ELEGIVEL, r("desligada", "SP", "Sudeste")), ELEGIVEL);
});

test("só Centro-Oeste: fora da região sai, sem UF pede confirmação, Centro-Oeste fica com a linha FCO", () => {
  assert.equal(
    aplicarRegiaoFinance(ELEGIVEL, r("so_centro_oeste", "SP", "Sudeste")).status,
    "fora_regra",
  );
  assert.match(
    aplicarRegiaoFinance(ELEGIVEL, r("so_centro_oeste", "SP", "Sudeste")).reason,
    /a empresa é de SP/,
  );
  assert.equal(aplicarRegiaoFinance(ELEGIVEL, r("so_centro_oeste", null, null)).status, "revisar");
  const go = aplicarRegiaoFinance(ELEGIVEL, r("so_centro_oeste", "GO", "Centro-Oeste"));
  assert.equal(go.status, "elegivel");
  assert.match(go.reason, /linha FCO/);
});

test("região escolhe a linha: ninguém sai, a linha vem da região e BASA/FNE desligadas não aparecem", () => {
  const mt = aplicarRegiaoFinance(ELEGIVEL, r("regiao_escolhe_linha", "MT", "Centro-Oeste"));
  assert.equal(mt.status, "elegivel");
  assert.match(mt.reason, /linhas FCO, BNDES, FINAME/);
  const pa = aplicarRegiaoFinance(ELEGIVEL, r("regiao_escolhe_linha", "PA", "Norte"));
  assert.match(pa.reason, /linhas BNDES, FINAME\./);
  const sem = aplicarRegiaoFinance(ELEGIVEL, r("regiao_escolhe_linha", null, null));
  assert.equal(sem.status, "elegivel");
  assert.match(sem.reason, /falta a UF/);
});

test("linhas da região: regionais ativas primeiro, depois as nacionais", () => {
  assert.deepEqual(linhasDaRegiao(LINHAS, "Centro-Oeste"), ["FCO", "BNDES", "FINAME"]);
  assert.deepEqual(
    linhasDaRegiao(
      [...LINHAS.slice(0, 1), { ...LINHAS[1], ativa: true }, ...LINHAS.slice(2)],
      "Norte",
    ),
    ["BASA", "BNDES", "FINAME"],
  );
});

test("conta que já está fora ou a confirmar fica com o motivo dela", () => {
  const fora = { status: "fora_regra", reason: "Sem contrato ganho identificado no Pipedrive." };
  assert.deepEqual(aplicarRegiaoFinance(fora, r("so_centro_oeste", "SP", "Sudeste")), fora);
});

test("resposta da RPC: regra desconhecida vira desligada; contas viram mapa por chave", () => {
  const m = regiaoPorConta({
    regra: "qualquer",
    linhas: LINHAS,
    contas: [{ key: "k1", uf: "GO", regiao: "Centro-Oeste", fonte: "omie", conflito: false }],
  });
  assert.equal(m.get("k1").regra, "desligada");
  assert.equal(regiaoPorConta(null).size, 0);
});

test("oferta(): Finance elegível só muda com a chave ligada", () => {
  const conta = {
    key: "k",
    name: "X",
    units: [],
    unit_label: null,
    orgs: [],
    regime: "Lucro Presumido",
    band: "R$ 4,8 milhões até R$ 10 milhões",
    old_base: false,
    matrix: true,
    new_commercial: false,
    pipedrive_contract: true,
    consultoria_priority: false,
    finance_candidate: true,
    finance: { status: "elegivel", reason: "" },
    ecd: false,
    base: { tax_evidence: { non_simples: true } },
  };
  const hoje = oferta(conta, "finance");
  assert.equal(hoje.status, "elegivel");
  assert.deepEqual(
    oferta({ ...conta, finance_regiao: r("desligada", "SP", "Sudeste") }, "finance"),
    hoje,
  );
  assert.equal(
    oferta({ ...conta, finance_regiao: r("so_centro_oeste", "SP", "Sudeste") }, "finance").status,
    "fora_regra",
  );
  assert.equal(
    oferta({ ...conta, finance_regiao: r("so_centro_oeste", "DF", "Centro-Oeste") }, "finance")
      .status,
    "elegivel",
  );
  // Cella e Consultoria não leem a regra
  assert.deepEqual(
    oferta({ ...conta, finance_regiao: r("so_centro_oeste", "SP", "Sudeste") }, "cella"),
    oferta(conta, "cella"),
  );
});
