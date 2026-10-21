// Recorte da Base por região, porte e segmento (Pedro, 21/10/2026). A leitura é pura: UF da empresa ou da unidade,
// porte pela faixa ou pela Receita, segmento do cadastro com os nomes da DataStone traduzidos.
import test from "node:test";
import assert from "node:assert/strict";
import {
  contarFaceta,
  contasDaOpcao,
  passaRecorte,
  perfilRecorte,
  porteDaConta,
  RECORTE_VAZIO,
  segmentoDaConta,
  ufDaConta,
} from "../src/lib/clientes/recorte.ts";

const UNIDADES = {
  k_mcz: "Maceió",
  k_cwb: "Curitiba",
  k_nova: "Unidade Nova",
  k_rj: "Sudeste (RJ)",
};
const nome = (k) => UNIDADES[k];
const conta = (key, extra = {}) => ({
  key,
  name: key,
  units: [],
  segment: null,
  band: null,
  faturamento_teto: null,
  ...extra,
});

test("UF: a da empresa vale; sem ela, a da praça da unidade; sem as duas, sem UF", () => {
  assert.deepEqual(
    ufDaConta(conta("a", { finance_regiao: { uf: "sp" }, units: ["k_mcz"] }), nome),
    {
      uf: "SP",
      fonte: "empresa",
    },
  );
  assert.deepEqual(ufDaConta(conta("b", { units: ["k_nova", "k_mcz"] }), nome), {
    uf: "AL",
    fonte: "unidade",
  });
  assert.deepEqual(ufDaConta(conta("c", { units: ["k_rj"] }), nome), {
    uf: "RJ",
    fonte: "unidade",
  });
  assert.deepEqual(ufDaConta(conta("d", { units: ["k_nova"] }), nome), { uf: null, fonte: null });
  // UF que não é estado (lixo do cadastro) não conta como da empresa.
  assert.equal(
    ufDaConta(conta("e", { finance_regiao: { uf: "XX" }, units: ["k_cwb"] }), nome).uf,
    "PR",
  );
});

test("porte: a faixa manda; sem ela, o teto do porte na Receita; sem os dois, sem porte", () => {
  assert.equal(porteDaConta(conta("a", { band: "Até R$ 500 mil" })), "micro");
  assert.equal(porteDaConta(conta("b", { band: "Sem movimentação" })), "micro");
  assert.equal(porteDaConta(conta("c", { faturamento_teto: 0.36 })), "micro");
  assert.equal(porteDaConta(conta("d", { faturamento_teto: 4.8 })), "pequena");
  assert.equal(porteDaConta(conta("e", { band: "R$ 2 milhões até R$ 4,8 milhões" })), "pequena");
  assert.equal(porteDaConta(conta("f", { band: "R$ 50 milhões até R$ 78 milhões" })), "media");
  assert.equal(
    porteDaConta(conta("g", { band: "[ANTIGO] Entre R$ 4,8 milhões e R$ 78 milhões" })),
    "media",
  );
  assert.equal(
    porteDaConta(conta("h", { band: "Entre R$ 78 milhões e R$ 300 milhões" })),
    "grande",
  );
  assert.equal(porteDaConta(conta("i", { band: "Acima de R$ 300 milhões" })), "grande");
  assert.equal(porteDaConta(conta("j")), "sem_porte");
  assert.equal(porteDaConta(conta("k", { band: "faixa que ninguém conhece" })), "sem_porte");
});

test("segmento: grafias do mesmo segmento viram uma, a DataStone vira o do cadastro, vazio é sem segmento", () => {
  assert.equal(segmentoDaConta({ segment: "Construção civil" }), "Construção Civil");
  assert.equal(segmentoDaConta({ segment: "Construção Civil" }), "Construção Civil");
  assert.equal(segmentoDaConta({ segment: "VAREJO" }), "Distribuição e Varejo");
  assert.equal(segmentoDaConta({ segment: "OUTROS SERVICOS" }), "Serviços");
  assert.equal(segmentoDaConta({ segment: "Não informado" }), "Sem segmento");
  assert.equal(segmentoDaConta({ segment: "  " }), "Sem segmento");
  assert.equal(segmentoDaConta({ segment: null }), "Sem segmento");
  assert.equal(segmentoDaConta({ segment: "Saúde" }), "Saúde");
  assert.equal(segmentoDaConta({ segment: "MINERACAO" }), "Mineracao");
});

const contas = [
  conta("sul-micro", { finance_regiao: { uf: "PR" }, faturamento_teto: 0.36, segment: "Serviços" }),
  conta("sul-grande", {
    finance_regiao: { uf: "SC" },
    band: "Acima de R$ 300 milhões",
    segment: "Indústria",
  }),
  conta("ne-micro", { units: ["k_mcz"], faturamento_teto: 0.36, segment: "OUTROS SERVICOS" }),
  conta("sem-uf", { units: ["k_nova"], segment: null }),
];
const perfis = new Map(contas.map((a) => [a.key, perfilRecorte(a, nome)]));
const perfil = (a) => perfis.get(a.key);

test("recorte: opções do mesmo filtro somam, filtros diferentes se cruzam", () => {
  const r = { ...RECORTE_VAZIO, regiao: ["Sul", "Nordeste"], porte: ["micro"] };
  assert.deepEqual(
    contas.filter((a) => passaRecorte(perfil(a), r)).map((a) => a.key),
    ["sul-micro", "ne-micro"],
  );
  const soPR = { ...RECORTE_VAZIO, regiao: ["Sul"], uf: ["PR"] };
  assert.deepEqual(
    contas.filter((a) => passaRecorte(perfil(a), soPR)).map((a) => a.key),
    ["sul-micro"],
  );
});

test("contagem de um filtro ignora o próprio filtro e a gaveta lista as mesmas contas", () => {
  const r = { ...RECORTE_VAZIO, porte: ["micro"], regiao: ["Sul"], uf: ["PR"] };
  // Região conta com o porte aplicado e sem a própria escolha (nem a UF, que mora dentro dela).
  assert.deepEqual(Object.fromEntries(contarFaceta(contas, perfil, r, "regiao")), {
    Sul: 1,
    Nordeste: 1,
  });
  // Porte conta dentro de PR.
  assert.deepEqual(Object.fromEntries(contarFaceta(contas, perfil, r, "porte")), { micro: 1 });
  assert.deepEqual(Object.fromEntries(contarFaceta(contas, perfil, RECORTE_VAZIO, "segmento")), {
    Serviços: 2,
    Indústria: 1,
    "Sem segmento": 1,
  });
  for (const [valor, n] of contarFaceta(contas, perfil, r, "regiao"))
    assert.equal(contasDaOpcao(contas, perfil, r, "regiao", valor).length, n);
  assert.deepEqual(
    contasDaOpcao(contas, perfil, RECORTE_VAZIO, "regiao", "sem_uf").map((a) => a.key),
    ["sem-uf"],
  );
});
