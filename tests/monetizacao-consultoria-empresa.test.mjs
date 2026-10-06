// Consultoria › Buscar empresa: o índice por CNPJ e a busca (src/lib/monetizacao/consultoria-empresa.ts).
// Dados sintéticos no formato dos RPCs ops.cruzamento_consultoria_painel() e ops.handoff_consultoria_painel().
import test from "node:test";
import assert from "node:assert/strict";
import {
  buscarEmpresas,
  doMesmoGrupo,
  indiceEmpresas,
} from "../src/lib/monetizacao/consultoria-empresa.ts";

const proj = (o) => ({
  produto: "Diagnóstico",
  linha_produto: "diagnostico_tributario",
  etapa: "operacao",
  etapa_descricao: null,
  cadastrado_em: "2026-09-20",
  na_etapa_desde: null,
  entregue_em: null,
  encerrado: false,
  encerrado_em: null,
  valor_identificado: 0,
  ...o,
});
const cli = (id, cnpj, nome, projetos, o = {}) => ({
  id,
  cnpj,
  cnpj_raiz: cnpj.slice(0, 8),
  razao_social: nome,
  nome_fantasia: null,
  grupo_economico: null,
  regime_tributario: "Lucro Real",
  porte: null,
  parceiro: null,
  cadastrado_em: "2026-09-01",
  valor_identificado: 0,
  credito_recuperado: 0,
  projetos,
  ...o,
});
const CRUZ = {
  lido_em: "2026-10-06T12:00:00Z",
  porta_financeiro: { aberta: true, motivo: null },
  frescor: { consultoria: null, negocios: null, financeiro_carregado_em: null },
  clientes: [
    cli("A", "11111111000101", "Ácme Indústria Ltda", [
      proj({ etapa: "pos_entrega", valor_identificado: 500 }),
    ]),
    cli("B", "11111111000282", "Acme Filial", [proj({ etapa: "fluxo_documentos" })]),
    cli("C", "33333333000103", "Gamma Serviços", [], { credito_recuperado: 900 }),
  ],
  propostas: [
    {
      id: "p1",
      empresa: "Acme",
      cnpj: "11111111000101",
      produto: "X",
      status: "Proposta",
      percentual_exito: 20,
      valor_total: 10,
      data_envio: null,
      canal_venda: null,
      parceiro: null,
    },
    {
      id: "p2",
      empresa: "Gamma Serviços",
      cnpj: null,
      produto: "Y",
      status: "Proposta",
      percentual_exito: null,
      valor_total: 5,
      data_envio: null,
      canal_venda: null,
      parceiro: null,
    },
  ],
  negocios: [
    {
      deal: "90",
      titulo: "Acme BPO",
      ganho_em: "2026-08-10",
      origem_pipeline: "inside_sales",
      unidade: "Belém",
      closer: null,
      regime_tributario: "Lucro Real",
      cnpj: "11111111000101",
      cnpj_fonte: "contrato",
      organizacao: null,
      onboarding: true,
    },
    {
      deal: "91",
      titulo: "Delta Comércio",
      ganho_em: "2026-09-10",
      origem_pipeline: "inside_sales",
      unidade: "Maceió",
      closer: null,
      regime_tributario: null,
      cnpj: null,
      cnpj_fonte: null,
      organizacao: "Delta",
      onboarding: false,
    },
  ],
  pat: [
    { cnpj: "11111111000101", mes: "2026-09-01", faturado: 100, recebido: 50 },
    { cnpj: "11111111000101", mes: "2026-08-01", faturado: 0, recebido: 0 },
  ],
};
const HAND = {
  clientes: [
    {
      card: "500",
      titulo: "Acme (onboarding)",
      unidade: "Belém",
      unidade_id: 1,
      fase: "Setup técnico",
      criado_em: null,
      venda_em: "2026-08-10",
      kickoff_em: "2026-08-20",
      encaminhado: "Sim",
      cnpj: "11111111000101",
      cnpj_fonte: "contrato",
      faixa: null,
      faixa_ordem: null,
      faixa_fonte: null,
      consultoria: null,
      propostas: 0,
      pat: null,
    },
    {
      card: "501",
      titulo: "Epsilon Ltda",
      unidade: "Belém",
      unidade_id: 1,
      fase: "Kickoff",
      criado_em: null,
      venda_em: null,
      kickoff_em: null,
      encaminhado: "Sim",
      cnpj: "55555555000105",
      cnpj_fonte: "contrato",
      faixa: null,
      faixa_ordem: null,
      faixa_fonte: null,
      consultoria: null,
      propostas: 0,
      pat: null,
    },
  ],
};

test("índice: uma empresa por CNPJ, juntando plataforma, onboarding, negócio, proposta e PAT", () => {
  const idx = indiceEmpresas(CRUZ, HAND, "2026-10-06");
  const acme = idx.find((e) => e.chave === "11111111000101");
  assert.ok(acme.plataforma);
  assert.equal(acme.onboarding.length, 1);
  assert.equal(acme.negocios.length, 1);
  assert.deepEqual(
    acme.propostas.map((p) => p.id),
    ["p1"],
  );
  assert.deepEqual(acme.pat, [{ mes: "2026-09", faturado: 100, recebido: 50 }]); // mês zerado sai
  assert.equal(acme.situacao.rotulo, "Diagnóstico entregue");
  assert.equal(
    idx.find((e) => e.chave === "11111111000282").situacao.rotulo,
    "Esperando documentos",
  );
  const gamma = idx.find((e) => e.chave === "33333333000103");
  assert.equal(gamma.situacao.rotulo, "Crédito recuperado");
  assert.deepEqual(
    gamma.propostas.map((p) => p.id),
    ["p2"],
  ); // proposta sem CNPJ casa pelo nome
  assert.equal(
    idx.find((e) => e.chave === "55555555000105").situacao.rotulo,
    "Encaminhada, fora da plataforma",
  );
  assert.equal(
    idx.find((e) => e.chave === "deal:91").situacao.rotulo,
    "Vendida, fora da plataforma",
  );
  assert.equal(idx.length, 5);
});

test("busca: CNPJ (com ou sem pontuação, a raiz acha o grupo) e nome sem acento", () => {
  const idx = indiceEmpresas(CRUZ, HAND, "2026-10-06");
  assert.equal(buscarEmpresas(idx, "11.111.111/0001-01")[0].chave, "11111111000101");
  assert.deepEqual(
    buscarEmpresas(idx, "11111111")
      .map((e) => e.chave)
      .sort(),
    ["11111111000101", "11111111000282"],
  );
  assert.equal(buscarEmpresas(idx, "acme industria")[0].chave, "11111111000101");
  assert.equal(buscarEmpresas(idx, "delta")[0].chave, "deal:91"); // pela organização do negócio
  assert.deepEqual(buscarEmpresas(idx, "a"), []); // curto demais
  assert.deepEqual(buscarEmpresas(idx, "zzz"), []);
  const acme = idx.find((e) => e.chave === "11111111000101");
  assert.deepEqual(
    doMesmoGrupo(idx, acme).map((e) => e.chave),
    ["11111111000282"],
  );
});

test("sem a porta do Financeiro a PAT fica nula; sem o Handoff o índice ainda funciona", () => {
  const idx = indiceEmpresas(
    { ...CRUZ, porta_financeiro: { aberta: false, motivo: "x" } },
    null,
    "2026-10-06",
  );
  assert.equal(idx.find((e) => e.chave === "11111111000101").pat, null);
  assert.equal(idx.length, 4); // sem o card 501 do onboarding
});

test("filial do onboarding cai na ficha da matriz que está na plataforma (raiz do CNPJ), e a busca acha pelos dois", () => {
  const cruz = {
    ...CRUZ,
    clientes: [
      cli("G", "29094565000167", "Greenbelt Labs Cosmeticos Ltda", [], { credito_recuperado: 563 }),
    ],
    negocios: [],
    propostas: [],
    pat: [{ cnpj: "29094565000329", mes: "2026-08-01", faturado: 2847, recebido: 17151 }],
  };
  const hand = {
    clientes: [
      { ...HAND.clientes[0], card: "777", titulo: "Greenbelt (Menfisrt)", cnpj: "29094565000329" },
    ],
  };
  const idx = indiceEmpresas(cruz, hand, "2026-10-06");
  assert.equal(idx.length, 1);
  const g = idx[0];
  assert.deepEqual(g.cnpjs, ["29094565000167", "29094565000329"]);
  assert.equal(g.onboarding.length, 1);
  assert.equal(g.situacao.rotulo, "Crédito recuperado");
  assert.deepEqual(g.pat, [{ mes: "2026-08", faturado: 2847, recebido: 17151 }]);
  assert.equal(buscarEmpresas(idx, "29.094.565/0003-29")[0].chave, "29094565000167");
});
