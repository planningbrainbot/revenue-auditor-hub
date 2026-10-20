// Consultoria retroativa sem tributo próprio (19/10/2026): holding sem operação e empresa aberta há menos de 1 ano saem
// da Consultoria; as outras ofertas não mudam. Espelho no servidor: 20261019240000 (tests/consultoria-sem-tributo-proprio.sql).
import test from "node:test";
import assert from "node:assert/strict";
import {
  consultoriaSemTributoProprio,
  hoje,
  oferta,
  umAnoAntes,
} from "../src/lib/monetizacao/model.ts";
import { motivoConsultoria } from "../src/lib/monetizacao/portfolio.ts";

const FONTE = "Receita Federal · consulta em lote 18/09/2026";
const cadastro = (inicio_atividade, cnaes) => ({ inicio_atividade, cnaes, fonte: FONTE });
// Apta em Consultoria pela régua de antes: base antiga, sem fechamento comercial, fora do Simples.
const conta = (extra = {}) => ({
  key: "k",
  name: "k",
  orgs: [],
  regime: null,
  band: null,
  segment: null,
  contact: false,
  pipedrive_contract: false,
  new_commercial: false,
  old_base: true,
  base_origin: { status: "antiga" },
  consultoria_origin: { status: "retroativa", non_simples_confirmed: true },
  base: { source_status: "ok", tax_evidence: { non_simples: true } },
  ...extra,
});
const diasAtras = (n) => {
  const d = new Date(`${hoje()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

test("Arcanjo: holding aberta há 7 meses sai da Consultoria pela data de abertura", () => {
  const a = conta({ cadastro_receita: cadastro("2026-03-10", ["6462000"]) });
  const r = consultoriaSemTributoProprio(a, {}, "2026-10-19");
  assert.match(r, /^Aberta há menos de 1 ano na Receita \(início de atividade em 10\/03\/2026\)/);
  // Um ano depois da abertura, continua fora: agora pela holding sem faixa.
  assert.match(
    consultoriaSemTributoProprio(a, {}, "2027-03-10"),
    /^Holding sem operação própria \(CNAE 6462-0\/00/,
  );
});

test("Pela oferta: recente e holding saem como fora da regra; o motivo não é contado como Simples", () => {
  const recente = conta({ cadastro_receita: cadastro(diasAtras(30), ["4711302"]) });
  const o = oferta(recente, "consultoria");
  assert.equal(o.status, "fora_regra");
  assert.match(o.reason, /menos de 1 ano/);
  assert.equal(motivoConsultoria(recente), "sem_tributo");

  const holding = conta({ cadastro_receita: cadastro("2015-05-05", ["6463800"]) });
  assert.equal(oferta(holding, "consultoria").status, "fora_regra");
  assert.match(oferta(holding, "consultoria").reason, /CNAE 6463-8\/00/);
  assert.equal(motivoConsultoria(holding), "sem_tributo");
});

test("Holding com faixa declarada, ou com faixa revisada na lista, continua apta", () => {
  const h = { cadastro_receita: cadastro("2015-05-05", ["6462000"]) };
  assert.equal(
    oferta(conta({ ...h, band: "R$ 4,8 milhões até R$ 10 milhões" }), "consultoria").status,
    "elegivel",
  );
  assert.equal(
    oferta(conta(h), "consultoria", { band: "R$ 2 milhões até R$ 4,8 milhões" }).status,
    "elegivel",
  );
});

test("Grupo com holding e empresa operacional não é holding pura", () => {
  const a = conta({ cadastro_receita: cadastro("2010-01-01", ["4711302", "6462000"]) });
  assert.equal(consultoriaSemTributoProprio(a), null);
  assert.equal(oferta(a, "consultoria").status, "elegivel");
});

test("LUX Incorporações SPE: compra e venda de imóveis aberta em 2020 não muda", () => {
  const lux = conta({
    regime: "Lucro Presumido",
    cadastro_receita: cadastro("2020-07-29", ["6810201"]),
  });
  assert.equal(consultoriaSemTributoProprio(lux), null);
  assert.equal(oferta(lux, "consultoria").status, "elegivel");
});

test("Conta fora da consulta da Receita segue a régua de antes", () => {
  assert.equal(oferta(conta(), "consultoria").status, "elegivel");
  assert.equal(oferta(conta({ cadastro_receita: null }), "consultoria").status, "elegivel");
  assert.equal(motivoConsultoria(conta()), "apta");
});

test("A regra é só da Consultoria: Cella e Finance não mudam", () => {
  const extra = {
    regime: "Lucro Real",
    band: "R$ 50 milhões até R$ 78 milhões",
    pipedrive_contract: true,
  };
  const sem = conta(extra);
  const com = conta({ ...extra, cadastro_receita: cadastro(diasAtras(10), ["6462000"]) });
  for (const p of ["cella", "finance"]) assert.deepEqual(oferta(com, p), oferta(sem, p), p);
});

test("Quem já é cliente da Consultoria mantém esse motivo; fechamento comercial também", () => {
  const recente = { cadastro_receita: cadastro(diasAtras(10), ["6462000"]) };
  const cliente = conta({
    ...recente,
    base: {
      source_status: "ok",
      consultoria: { cliente: { cnpj: "12345678000190", casamento: "cnpj" }, propostas: [] },
    },
  });
  assert.match(oferta(cliente, "consultoria").reason, /Já é cliente da Consultoria/);
  const comercial = conta({ ...recente, new_commercial: true });
  assert.match(oferta(comercial, "consultoria").reason, /Fechamento pelo comercial/);
});

test("Um ano antes, como o Postgres: exatamente 1 ano não é recente; 29/02 vira 28/02", () => {
  assert.equal(umAnoAntes("2026-10-19"), "2025-10-19");
  assert.equal(umAnoAntes("2028-02-29"), "2027-02-28");
  const a = (inicio) => conta({ cadastro_receita: cadastro(inicio, ["4711302"]) });
  assert.equal(consultoriaSemTributoProprio(a("2025-10-19"), {}, "2026-10-19"), null);
  assert.match(consultoriaSemTributoProprio(a("2025-10-20"), {}, "2026-10-19"), /menos de 1 ano/);
});
