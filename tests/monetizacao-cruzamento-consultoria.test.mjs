// Cruzamento Consultoria: o passo de negócios da sync (supabase/functions/handoff-consultoria-sync/domain.mjs) e a
// régua da tela (src/lib/monetizacao/cruzamento-consultoria.ts). Dados sintéticos no formato do RPC
// ops.cruzamento_consultoria_painel(); esperados calculados à mão.
// A conferência contra a produção fica em scripts/monetizacao/conferir-cruzamento-consultoria.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  linhaNegocio,
  negociosSemCnpj,
} from "../supabase/functions/handoff-consultoria-sync/domain.mjs";
import {
  CITACOES,
  montarCruzamento,
  regimeDe,
  semanaDe,
  statusDa,
} from "../src/lib/monetizacao/cruzamento-consultoria.ts";

const AGORA = "2026-10-06T12:00:00.000Z";

test("negociosSemCnpj: o banco resolve primeiro; Pipedrive só para quem falta e não foi lido nas últimas 24 h", () => {
  const faltam = negociosSemCnpj({
    ganhos: [
      { pipedrive_deal_id: "1", cnpj: "12.345.678/0001-90", empresa_id: null },
      { pipedrive_deal_id: "2", cnpj: null, empresa_id: 7 },
      { pipedrive_deal_id: "3", cnpj: null, empresa_id: null },
      { pipedrive_deal_id: "4", cnpj: null, empresa_id: null },
      { pipedrive_deal_id: "5", cnpj: null, empresa_id: null },
      { pipedrive_deal_id: "6", cnpj: null, empresa_id: null },
      { pipedrive_deal_id: "6", cnpj: null, empresa_id: null },
      { pipedrive_deal_id: "7", cnpj: null, empresa_id: null },
    ],
    docs: [{ pipedrive_deal_id: "3", cnpj: "11222333000144", empresa_id: null }],
    empresas: [{ id: 7, cnpj: "99888777000166" }],
    onboarding: [{ pipedrive_deal_id: "4", cnpj: "55444333000122" }],
    anteriores: [
      { pipedrive_deal_id: "5", cnpj: null, tentado_em: "2026-10-06T06:00:00Z" }, // lido há 6 h, sem CNPJ
      { pipedrive_deal_id: "7", cnpj: null, tentado_em: "2026-10-04T06:00:00Z" }, // lido há 2 dias
    ],
    agora: AGORA,
  });
  // 1 contrato, 2 empresa, 3 documento, 4 onboarding, 5 recente: ficam. 6 (uma vez) e 7 (vencido) vão ao Pipedrive.
  assert.deepEqual(faltam, ["6", "7"]);
});

test("linhaNegocio: CNPJ do negócio, senão o da organização; o nome da organização vem junto", () => {
  const PD_NEG = "f37f5a5c865fe4f49f16233ed97a989cab34dc7d";
  const PD_ORG = "ca6f964bd78a8f54fceaab3a1138cccea668ac7f";
  assert.deepEqual(
    linhaNegocio(
      "10",
      { [PD_NEG]: "1.234.567.000.112", org_id: { value: 3, name: "ACME" } },
      null,
      AGORA,
    ),
    {
      pipedrive_deal_id: "10",
      cnpj: "01234567000112",
      cnpj_fonte: "negocio_pipedrive",
      organizacao: "ACME",
      tentado_em: AGORA,
    },
  );
  assert.deepEqual(
    linhaNegocio("11", { org_id: 3 }, { [PD_ORG]: "11.222.333/0001-44", name: "Beta" }, AGORA),
    {
      pipedrive_deal_id: "11",
      cnpj: "11222333000144",
      cnpj_fonte: "organizacao_pipedrive",
      organizacao: "Beta",
      tentado_em: AGORA,
    },
  );
  assert.equal(linhaNegocio("12", null, null, AGORA).cnpj, null);
});

test("statusDa e regimeDe: até 10% bate, até 25% perto, acima diverge; regime pelo texto", () => {
  assert.equal(statusDa(100, 109), "bate");
  assert.equal(statusDa(100, 90), "bate");
  assert.equal(statusDa(100, 120), "perto");
  assert.equal(statusDa(100, 70), "diverge");
  assert.equal(statusDa(100, null), "outra-conta");
  assert.equal(regimeDe("Lucro Real"), "real");
  assert.equal(regimeDe("LUCRO PRESUMIDO"), "presumido");
  assert.equal(regimeDe("Simples Nacional"), "simples");
  assert.equal(regimeDe(null), "sem");
  assert.equal(semanaDe("2026-10-06"), "2026-10-05"); // terça → segunda
  assert.equal(semanaDe("2026-10-04"), "2026-09-28"); // domingo → segunda anterior
});

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
const cli = (id, cnpj, regime, projetos) => ({
  id,
  cnpj,
  cnpj_raiz: cnpj.slice(0, 8),
  razao_social: `Cliente ${id}`,
  nome_fantasia: null,
  grupo_economico: null,
  regime_tributario: regime,
  porte: null,
  parceiro: null,
  cadastrado_em: "2026-09-01",
  valor_identificado: 0,
  credito_recuperado: 0,
  projetos,
});
const neg = (deal, mes, cnpj, o = {}) => ({
  deal,
  titulo: `Negócio ${deal}`,
  ganho_em: `${mes}-10`,
  origem_pipeline: "inside_sales",
  unidade: "Belém",
  closer: null,
  regime_tributario: "Lucro Real",
  cnpj,
  cnpj_fonte: cnpj ? "contrato" : null,
  organizacao: null,
  onboarding: false,
  ...o,
});
const BRUTO = {
  lido_em: AGORA,
  porta_financeiro: { aberta: true, motivo: null },
  frescor: { consultoria: AGORA, negocios: AGORA, financeiro_carregado_em: AGORA },
  clientes: [
    // A: lucro real, um projeto em pós-entrega com R$ 1 mi, entregue há 3 dias.
    cli("A", "11111111000101", "Lucro Real", [
      proj({
        etapa: "pos_entrega",
        valor_identificado: 1_000_000,
        entregue_em: "2026-10-03",
        cadastrado_em: "2026-09-29",
      }),
    ]),
    // B: presumido, parado em Fluxo de Documentos, cadastrado ontem.
    cli("B", "22222222000102", "Lucro Presumido", [
      proj({ etapa: "fluxo_documentos", cadastrado_em: "2026-10-05" }),
    ]),
    // C: lucro real, fila de processamento com R$ 500 mil já identificados (fora da janela de 28 dias).
    cli("C", "33333333000103", "Lucro Real", [
      proj({
        etapa: "fila_processamento",
        valor_identificado: 500_000,
        cadastrado_em: "2026-08-01",
      }),
    ]),
  ],
  propostas: [
    {
      id: "p1",
      empresa: "X",
      cnpj: null,
      produto: null,
      status: "Proposta",
      percentual_exito: 20,
      valor_total: 10,
      data_envio: null,
      canal_venda: null,
      parceiro: null,
    },
    {
      id: "p2",
      empresa: "Y",
      cnpj: null,
      produto: null,
      status: "Proposta",
      percentual_exito: 16,
      valor_total: 10,
      data_envio: null,
      canal_venda: null,
      parceiro: null,
    },
    {
      id: "p3",
      empresa: "Z",
      cnpj: null,
      produto: null,
      status: "Proposta",
      percentual_exito: null,
      valor_total: 10,
      data_envio: null,
      canal_venda: null,
      parceiro: null,
    },
  ],
  negocios: [
    neg("90", "2026-09", "11111111000101"), // na plataforma (A), trabalhado, faturou
    neg("91", "2026-09", "22222222000999"), // casa pela raiz com B, não trabalhado
    neg("92", "2026-09", null), // sem CNPJ
    neg("93", "2026-09", "44444444000104", { regime_tributario: "Simples Nacional" }), // fora da plataforma
    neg("94", "2026-09", "11111111000101", { origem_pipeline: "socios" }), // pipe Sócios: fora da máquina
    neg("95", "2026-07", "33333333000103"), // julho, na plataforma (C), não trabalhado
  ],
  pat: [
    { cnpj: "11111111000101", mes: "2026-10-01", faturado: 5000, recebido: 0 },
    { cnpj: "33333333000103", mes: "2026-06-01", faturado: 900, recebido: 900 }, // antes do ganho: não conta
  ],
};

test("montarCruzamento: cada número da call contado nos dados da plataforma", () => {
  const p = montarCruzamento(BRUTO, "2026-10-06");
  const c = Object.fromEntries(p.cartoes.map((x) => [x.id, x]));
  assert.equal(p.cartoes.length, CITACOES.length);
  assert.equal(c.oportunidades.medido, 1_500_000);
  assert.equal(c.honorario.medido, 0.18); // (20 + 16) ÷ 2, a proposta sem % fica fora
  assert.equal(c["diagnostico-valor"].medido, 1); // só A tem pós-entrega com valor
  assert.equal(c["fluxo-documentos"].medido, 1);
  assert.equal(c["entram-semana"].medido, 1); // 2 cadastrados em 28 dias ÷ 4 = 0,5 → 1 (inteiro)
  assert.equal(c["saem-semana"].medido, 0); // 1 entregue ÷ 4 = 0,25 → 0
  assert.equal(c["entregues-mes"].medido, 1);
  assert.equal(c["lucro-real"].medido, 2); // A e C
  assert.equal(c["lucro-real-projetos"].medido, 2 / 3);
  assert.equal(c["media-lucro-real"].medido, 750_000);
  assert.equal(c["maquina-setembro"].medido, 4); // 90, 91, 92, 93 (o 94 é Sócios)
  assert.equal(c["chegaram-3-meses"].status, "outra-conta");
  assert.equal(c.honorario.status, "bate"); // 18% × 20%: −10%
  assert.equal(p.maquinaSemCnpj.length, 1);
  assert.equal(p.janela.entraram.length, 2);
  assert.equal(p.janela.sairam.length, 1);
});

test("coorte do teste do CEO: cumulativa, cada etapa é parte da anterior; regime filtra", () => {
  const p = montarCruzamento(BRUTO, "2026-10-06");
  const set = p.coorte.find((l) => l.mes === "2026-09");
  const n = (k) => set.etapas[k].map((x) => x.deal);
  assert.deepEqual(n("ganhos"), ["90", "91", "92", "93"]);
  assert.deepEqual(n("cnpj"), ["90", "91", "93"]);
  assert.deepEqual(n("plataforma"), ["90", "91"]);
  assert.deepEqual(n("trabalhados"), ["90"]);
  assert.deepEqual(n("faturou"), ["90"]);
  const jul = p.coorte.find((l) => l.mes === "2026-07");
  assert.deepEqual(
    jul.etapas.plataforma.map((x) => x.deal),
    ["95"],
  );
  assert.deepEqual(jul.etapas.faturou, []); // a receita de junho é anterior ao ganho
  for (const l of p.coorte) {
    const ordem = ["ganhos", "cnpj", "plataforma", "trabalhados", "faturou"];
    for (let i = 1; i < ordem.length; i++)
      for (const x of l.etapas[ordem[i]]) assert.ok(l.etapas[ordem[i - 1]].includes(x));
  }
  const simples = montarCruzamento(BRUTO, "2026-10-06", { regime: "simples" });
  assert.deepEqual(
    simples.coorte.find((l) => l.mes === "2026-09").etapas.ganhos.map((x) => x.deal),
    ["93"],
  );
  const semPorta = montarCruzamento(
    { ...BRUTO, porta_financeiro: { aberta: false, motivo: "x" } },
    "2026-10-06",
  );
  assert.equal(semPorta.coorte[0].etapas.faturou, null);
});

test("vazão: 12 semanas de segunda a domingo, a última em curso; máquina por mês com o dito pelo CEO", () => {
  const p = montarCruzamento(BRUTO, "2026-10-06");
  assert.equal(p.semanas.length, 12);
  assert.equal(p.semanas[11].semana, "2026-10-05");
  assert.equal(p.semanas[11].parcial, true);
  assert.equal(p.semanas[11].entraram.length, 1); // B, 05/10
  assert.equal(p.semanas[10].sairam.length, 1); // A, entregue 03/10 (semana de 28/09)
  const set = p.maquinaPorMes.find((m) => m.mes === "2026-09");
  assert.equal(set.ganhos.length, 4);
  assert.equal(set.dito, 85);
});
