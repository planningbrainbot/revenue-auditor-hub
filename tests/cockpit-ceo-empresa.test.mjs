// Cockpit do CEO, escopo da empresa inteira (23/09): Financeiro canônico, ponte, caixa, aquisição,
// operação, cadeia e o registro único de perguntas. Os valores esperados são escritos à mão a
// partir de fixtures pequenas — não são recalculados pela função que está sob teste.
import test from "node:test";
import assert from "node:assert/strict";
import {
  extrairPorCliente,
  montarPonte,
  extrairEmitidoRecebido,
  extrairInadimplencia,
  extrairIndicadores,
  extrairFrescor,
  idadeEmDias,
} from "../src/lib/cockpit-ceo/financeiro.ts";
import { montarAquisicao, trimestreDe } from "../src/lib/cockpit-ceo/aquisicao.ts";
import { lerCard, montarOnboarding } from "../src/lib/cockpit-ceo/operacao.ts";
import { montarCadeia, normContraparte, docDigitos } from "../src/lib/cockpit-ceo/cadeia.ts";
import { montarCockpit } from "../src/lib/cockpit-ceo/indicadores.ts";
import { fonteSintetica } from "../src/lib/cockpit-ceo/fixture-sintetica.ts";
import { resolverPeriodo } from "../src/lib/cockpit-ceo/periodo.ts";
import { somaDaComposicao } from "../src/lib/cockpit-ceo/contrato.ts";
import {
  PERGUNTAS,
  EXIGENCIAS_INVESTIDOR,
  PILARES,
  situacaoDaPergunta,
} from "../src/lib/cockpit-ceo/perguntas.ts";
import { ORDEM_FRENTES, IDS_INDICADORES } from "../src/lib/cockpit-ceo/contrato.ts";
import { FRENTES_JEV } from "../src/lib/cockpit-ceo/jev/contrato.ts";

// ── Ponte ────────────────────────────────────────────────────────────────────
// Quatro clientes, três meses (jan, fev, mar). Esperado de mar contra fev, calculado à mão:
//   A: 100 → 150 (expansão +50) · B: 200 → 120 (contração −80) · C: 50 em jan, nada em fev, 70 em
//   mar (retorno +70) · D: 30 em fev, nada em mar (sem faturamento −30) · E: só em mar, 40 (novo).
//   Sem cliente: 5 em fev, 8 em mar (+3). Fev = 100+200+30+5 = 335; mar = 150+120+70+40+8 = 388.
const mes = (m, receita) => ({ competencia: `2026-${m}-01`, receita });
const payload = (ajusteSerie = {}) => ({
  linhas: [
    { cliente: "A", meses: [mes("01", 90), mes("02", 100), mes("03", 150)] },
    { cliente: "B", meses: [mes("01", 200), mes("02", 200), mes("03", 120)] },
    { cliente: "C", meses: [mes("01", 50), mes("02", null), mes("03", 70)] },
    { cliente: "D", meses: [mes("01", null), mes("02", 30), mes("03", null)] },
    { cliente: "E", meses: [mes("01", null), mes("02", null), mes("03", 40)] },
  ],
  serie: [
    { competencia: "2026-01-01", receita: 340, receita_com_cliente: 340 },
    { competencia: "2026-02-01", receita: 335, receita_com_cliente: ajusteSerie.fev ?? 330 },
    { competencia: "2026-03-01", receita: 388, receita_com_cliente: ajusteSerie.mar ?? 380 },
  ],
  sem_cliente: {
    por_mes: [
      { competencia: "2026-02-01", receita: 5 },
      { competencia: "2026-03-01", receita: 8 },
    ],
  },
  truncado: { aplicado: false },
});

test("Ponte: cada cliente cai num só movimento e o mês fecha em centavos com a série da fonte", () => {
  const p = montarPonte(extrairPorCliente(payload()), ["2026-01", "2026-02", "2026-03"]);
  assert.equal(p.historicoDesde, "2026-01");
  const mar = p.meses.find((m) => m.mes === "2026-03");
  assert.equal(mar.anterior, 335);
  assert.equal(mar.atual, 388);
  assert.deepEqual(mar.expansao, { clientes: 1, valor: 50 });
  assert.deepEqual(mar.contracao, { clientes: 1, valor: -80 });
  assert.deepEqual(mar.retornos, { clientes: 1, valor: 70 });
  assert.deepEqual(mar.novos, { clientes: 1, valor: 40 });
  assert.deepEqual(mar.semFaturamento, { clientes: 1, valor: -30 });
  assert.equal(mar.semCliente, 3);
  assert.equal(mar.fecha, true);
  assert.equal(mar.diferencaFonte, 0);
  // Fev: C sai (−50), D entra novo (+30), A expande (+10), B estável.
  const fev = p.meses.find((m) => m.mes === "2026-02");
  assert.deepEqual(fev.semFaturamento, { clientes: 1, valor: -50 });
  assert.deepEqual(fev.novos, { clientes: 1, valor: 30 });
  assert.equal(fev.estaveis, 1);
});

test("Ponte: mês sem o anterior fechado não entra; mês parcial fora da lista de fechados não entra", () => {
  const p = montarPonte(extrairPorCliente(payload()), ["2026-01", "2026-03"]);
  assert.deepEqual(
    p.meses.map((m) => m.mes),
    [],
    "mar precisa de fev fechado; jan não tem anterior",
  );
});

test("Ponte: linhas que não batem com a série da fonte não fecham, e erros não se compensam", () => {
  const um = montarPonte(extrairPorCliente(payload({ mar: 381 })), ["2026-02", "2026-03"]);
  assert.equal(um.meses[0].fecha, false);
  assert.equal(um.meses[0].diferencaFonte, 1);
  // +1 em fev e −1 em mar: somadas dariam 0; cada mês confere sozinho.
  const dois = montarPonte(extrairPorCliente(payload({ fev: 331, mar: 379 })), [
    "2026-02",
    "2026-03",
  ]);
  assert.equal(dois.meses[0].fecha, false);
  assert.equal(dois.meses[0].diferencaFonte, 2);
});

test("Ponte: payload cortado por limite de clientes é recusado", () => {
  assert.throws(() => extrairPorCliente({ ...payload(), truncado: { aplicado: true } }), /cortado/);
});

// ── Emitido × recebido, inadimplência, indicadores ───────────────────────────
test("Emitido × recebido: mês sem foto de títulos não mostra percentual; piso e prazo ficam rotulados", () => {
  const er = extrairEmitidoRecebido({
    snapshot_ref: "2026-06-01",
    serie: [
      {
        competencia: "2026-04-01",
        reconhecido: 100,
        recebido: 96,
        em_aberto: 4,
        pct_recebido: 0.96,
        meses_ate_a_foto: 2,
      },
      {
        competencia: "2026-06-01",
        reconhecido: 100,
        recebido: 86,
        em_aberto: 14,
        pct_recebido: 0.86,
        meses_ate_a_foto: 0,
      },
      {
        competencia: "2026-07-01",
        reconhecido: 100,
        recebido: 40,
        em_aberto: 60,
        pct_recebido: 0.4,
        meses_ate_a_foto: -1,
      },
      {
        competencia: "2026-08-01",
        reconhecido: 100,
        recebido: 100,
        em_aberto: 0,
        pct_recebido: 1,
        meses_ate_a_foto: -2,
      },
    ],
  });
  assert.equal(er.foto, "2026-06");
  assert.deepEqual(
    er.meses.map((m) => [m.mes, m.leitura, m.pctRecebido]),
    [
      ["2026-04", "maduro", 0.96],
      ["2026-06", "prazo", 0.86],
      ["2026-07", "piso", 0.4],
      ["2026-08", "sem_foto", null],
    ],
  );
});

test("Inadimplência e indicadores: agregados saem, cliente e CNPJ não", () => {
  const ina = extrairInadimplencia({
    hoje: "2026-09-23",
    sincronizado_em: "2026-09-19T18:50:30Z",
    totais: { em_aberto: 1000, previsto_atrasado: 400, titulos_atrasados: 7 },
    faixas_de_atraso: [{ faixa: "1 a 30 dias", valor: 400, titulos: 7 }],
    cobertura: { sem_sync: ["AGRO"] },
    por_cliente: [{ cliente: "Cliente Real Ltda", cnpj: "12.345.678/0001-90", valor: 400 }],
  });
  assert.equal(ina.atrasado, 400);
  assert.deepEqual(ina.empresasSemSync, ["AGRO"]);
  assert.doesNotMatch(JSON.stringify(ina), /Cliente Real|12\.345/);
  const ind = extrairIndicadores({
    escopo: { comp_de: "2026-01-01", comp_ate: "2026-08-01" },
    receita_bruta: { valor: 300 },
    lucro_bruto: { valor: 120 },
    margem_pct: 0.4,
    por_empresa: [
      {
        grupo_apuracao: "BPO",
        receita_bruta: 100.1,
        lucro_bruto: 40,
        resultado: 10,
        cnpj: "12.345.678/0001-90",
        razao_social: "X",
      },
      { grupo_apuracao: "BPO", receita_bruta: 99.9, lucro_bruto: 40, resultado: 5 },
      { grupo_apuracao: "SP", receita_bruta: 100, lucro_bruto: 40, resultado: -3 },
    ],
    caixa_livre: {
      valor: 50,
      sem_dado: false,
      mes_referencia: "2026-08-01",
      cobertura: { empresas_sem_saldo: [] },
    },
  });
  assert.deepEqual(
    ind.porGrupo.map((g) => [g.grupo, g.receitaBruta, g.empresas]),
    [
      ["BPO", 200, 2],
      ["SP", 100, 1],
    ],
  );
  assert.doesNotMatch(JSON.stringify(ind), /12\.345|razao/);
  const semCaixa = extrairIndicadores({
    por_empresa: [],
    caixa_livre: { sem_dado: true, valor: 0 },
  });
  assert.equal(semCaixa.caixa.valor, null, "sem saldo vira null, nunca R$ 0");
});

test("Frescor: a última carga e a idade em dias", () => {
  const f = extrairFrescor([
    { carregado_em: "2026-09-18T10:00:00Z", cobre_ate: "2026-09-17" },
    { carregado_em: "2026-09-20T13:59:45Z", cobre_ate: "2026-09-18" },
  ]);
  assert.equal(f.carregadoEm, "2026-09-20T13:59:45Z");
  assert.equal(idadeEmDias(f.carregadoEm, "2026-09-23T15:00:00Z"), 3);
  assert.equal(idadeEmDias(null, "2026-09-23T15:00:00Z"), null);
});

// ── Aquisição ────────────────────────────────────────────────────────────────
test("Aquisição: plano ausente fica null (não 0%), pipeline não ponderado separa sem data e vencidos", () => {
  const a = montarAquisicao(
    {
      serie: [
        { mes: "2026-05", vendas: 20, mrr: 100000, investimento: 200000, leads: 900, mql: 300 },
        { mes: "2026-08", vendas: 50, mrr: 250000, investimento: 250000, leads: 2000, mql: 800 },
        { mes: "2026-09", vendas: 10, mrr: 60000, investimento: 90000, leads: 400, mql: 150 },
        { mes: "2026-10", vendas: 1, mrr: 1, investimento: 1, leads: 1, mql: 1 },
      ],
      metas: [
        { mes: "2026-08", papel: "funil", metrica: "new_mrr_mes", alvo: 230000 },
        { mes: "2026-08", papel: "porte-25m-mais", metrica: "new_mrr_mes", alvo: 99 },
      ],
      mesCorrente: [
        { porte: "consolidado", mes: "2026-09", mrr_forecast_ritmo: 200000, mrr_meta: 240000 },
      ],
      abertos: [
        { mrr: 1000, expected_close_date: null },
        { mrr: 2000, expected_close_date: "2026-08-10" },
        { mrr: 3000, mrr_efetivo: 3500, expected_close_date: "2026-10-05" },
      ],
      distMetas: [{ unidade: "U1", quarter: "2026-T3", meta: 100, vendido: 80 }],
    },
    "2026-09-23",
  );
  assert.deepEqual(
    a.meses.map((m) => m.mes),
    ["2026-05", "2026-08", "2026-09"],
    "mês futuro fora",
  );
  assert.equal(a.meses[0].plano, null);
  assert.equal(a.meses[1].plano.mrrNovo, 230000, "só o plano do funil consolidado");
  assert.equal(a.meses[1].custoMidiaPorVenda, 5000);
  assert.equal(a.meses[2].emAndamento, true);
  assert.equal(a.forecast.porRitmo, 200000);
  assert.equal(a.pipeline.mrr, 6500, "mrr_efetivo quando existe");
  assert.deepEqual(a.pipeline.semData, { negocios: 1, mrr: 1000 });
  assert.deepEqual(a.pipeline.vencidos, { negocios: 1, mrr: 2000 });
  assert.deepEqual(a.pipeline.porMes, [{ mes: "2026-10", negocios: 1, mrr: 3500 }]);
  assert.equal(trimestreDe("2026-09-23"), "2026-T3");
});

// ── Operação ─────────────────────────────────────────────────────────────────
test("Onboarding: faixas de idade só para quem está em curso; tempo do ganho à conclusão pelo vínculo", () => {
  const agora = "2026-09-23T12:00:00Z";
  const dias = (n) => new Date(Date.parse(agora) - n * 86_400_000).toISOString();
  const cards = [
    {
      fase_atual: "Setup técnico",
      entrou_fase_atual_em: dias(45),
      criado_em: dias(60),
      empresa_id: 1,
    },
    {
      fase_atual: "Setup técnico",
      entrou_fase_atual_em: dias(70),
      criado_em: dias(80),
      empresa_id: 2,
    },
    {
      fase_atual: "Nova Onboarding",
      entrou_fase_atual_em: dias(5),
      criado_em: dias(5),
      empresa_id: null,
    },
    {
      fase_atual: "Concluído",
      concluido: true,
      entrou_fase_atual_em: dias(90),
      criado_em: "2026-07-05T00:00:00Z",
      empresa_id: 3,
      fases_history: [{ fase: "Concluído", entrou_em: "2026-08-01T00:00:00Z" }],
    },
    {
      fase_atual: "Churn no Onboarding",
      concluido: true,
      entrou_fase_atual_em: dias(99),
      criado_em: dias(100),
      empresa_id: 4,
    },
  ].map(lerCard);
  // Empresa 3 tem um ganho antigo (2025) e o que originou o card (02/07): vale o de 02/07.
  // Um ganho DEPOIS da criação do card não é a venda que o originou.
  const ganhos = new Map([[3, ["2025-01-10", "2026-07-02", "2026-09-01"]]]);
  const o = montarOnboarding(cards, ganhos, agora, { de: "2026-09-01", ate: "2026-09-23" });
  assert.equal(o.emCurso, 3);
  assert.equal(o.parados30, 2, "o concluído e o churn com 90+ dias não contam");
  assert.equal(o.parados60, 1);
  assert.equal(o.concluidos, 1);
  assert.equal(o.churnNoOnboarding, 1);
  assert.deepEqual(o.ganhoAteConclusao, { mediana: 30, casos: 1, semVinculo: 0 });
  assert.deepEqual(o.criacaoAteConclusao, { mediana: 27, casos: 1 }, "05/07 → 01/08");
  assert.equal(o.semEmpresa, 1);
});

// ── Cadeia ───────────────────────────────────────────────────────────────────
test("Normalização do nome segue a função do Financeiro (acento, pontuação, sufixo societário)", () => {
  assert.equal(normContraparte("Açaí & Cia. LTDA - ME"), "acai");
  assert.equal(normContraparte("A.B.C. Serviços S/A"), "abc servicos");
  assert.equal(normContraparte("  "), null);
  assert.equal(docDigitos("12.345.678/0001-90"), "12345678000190");
  assert.equal(docDigitos("123.456.789-01"), null, "CPF fica fora");
});

test("Cadeia: nome ambíguo não conta como faturado; sem leitura do faturamento, o elo é null", () => {
  const base = {
    vendas: [
      { empresaId: 1, cnpj: "11111111000111", ganhoEm: "2026-08-10", dealId: "a" },
      { empresaId: 2, cnpj: "22222222000122", ganhoEm: "2026-08-10", dealId: "b" },
      { empresaId: null, cnpj: "33333333000133", ganhoEm: "2026-08-10", dealId: "c" },
      { empresaId: 4, cnpj: null, ganhoEm: "2026-09-01", dealId: "d" },
    ],
    onboarding: new Map([
      [1, { concluido: true }],
      [2, { concluido: false }],
    ]),
    nomesPorCnpj: new Map([
      ["11111111000111", new Set(["alfa"])],
      ["22222222000122", new Set(["beta"])],
    ]),
    documentosPorNome: new Map([
      ["alfa", 1],
      ["beta", 2],
    ]),
    mesesFaturadosPorNome: new Map([
      ["alfa", new Set(["2026-07", "2026-09"])],
      ["beta", new Set(["2026-09"])],
    ]),
    churnEmpresas: new Set([2]),
    churnNegocios: new Set(["d"]),
    faturamentoLido: true,
    // C (33…) não está no cadastro do grupo, mas tem título na unidade depois do ganho, pago.
    // B (22…) tem um título ANTES do ganho: não conta.
    titulosUnidadePorCnpj: new Map([
      ["33333333000133", [{ vencimento: "2026-09-10", pago: true }]],
      ["22222222000122", [{ vencimento: "2026-07-10", pago: true }]],
    ]),
    unidadesLidas: true,
  };
  const c = montarCadeia(base);
  assert.equal(c.vendas, 4);
  assert.equal(c.ativacaoIniciada, 2);
  assert.equal(c.ativacaoConcluida, 1);
  assert.equal(c.faturadasNoGrupo, 1, "alfa faturou no grupo depois do ganho; beta é ambíguo");
  assert.equal(c.faturadasNaUnidade, 1, "C na unidade; o título de B é anterior ao ganho");
  assert.equal(c.faturadas, 2);
  assert.equal(c.recebidasNaUnidade, 1);
  assert.equal(c.faturamentoAmbiguo, 1);
  assert.equal(c.semContraparte, 0, "C tem título na unidade: não é 'sem vínculo'");
  assert.equal(c.semCnpj, 1);
  assert.equal(c.saidas, 2);
  const semGrupo = montarCadeia({ ...base, faturamentoLido: false });
  assert.equal(semGrupo.faturadas, null, "sem uma das fontes o total seria piso: null");
  assert.equal(semGrupo.faturadasNoGrupo, null);
  assert.equal(semGrupo.faturadasNaUnidade, 1);
  const semUnidade = montarCadeia({ ...base, unidadesLidas: false });
  assert.equal(semUnidade.recebidasNaUnidade, null);
});

// ── Montagem na tela ─────────────────────────────────────────────────────────
const HOJE = "2026-09-23";
const AGORA = `${HOJE}T15:00:00Z`;
const recorte = () => ({ periodo: resolverPeriodo({ periodo: "mes" }, HOJE), perimetro: "" });
const ind = (c, id) => c.indicadores.find((i) => i.id === id);

test("Primeira dobra: seis números da empresa, cada composição somável reconstrói o valor", () => {
  const c = montarCockpit(fonteSintetica(HOJE, AGORA), recorte());
  assert.deepEqual(c.primeiraDobra, [
    "meta-bilhao",
    "faturamento-mes",
    "faturamento-saiu",
    "mrr-vendido",
    "vencido-em-aberto",
    "onboarding-parado",
  ]);
  for (const id of c.primeiraDobra.slice(1)) {
    const i = ind(c, id);
    assert.ok(i.valor !== null, id);
    assert.equal(somaDaComposicao(i), i.valor, id);
  }
  assert.doesNotMatch(JSON.stringify(c), /Cliente Sintético/, "nome de cliente não chega à tela");
});

test("Financeiro parado vira dado parcial e ameaça alta, nunca número fresco", () => {
  const c = montarCockpit(fonteSintetica(HOJE, AGORA), recorte());
  assert.equal(ind(c, "faturamento-mes").estado, "parcial");
  assert.ok(c.ameacas.some((a) => a.id === "financeiro-parado" && a.gravidade === "alta"));
  assert.equal(c.empresa.frescor[0].estado, "parada");
});

test("Sem leitura do Financeiro, os números dele dizem acesso insuficiente, não zero", () => {
  const f = fonteSintetica(HOJE, AGORA);
  const semFin = {
    ...f,
    receita: {
      ...f.receita,
      ponte: null,
      leituras: f.receita.leituras.map((l) =>
        l.id === "grupo"
          ? {
              ...l,
              estado: "acesso_insuficiente",
              nota: "Sua conta não tem acesso ao Brain Financeiro.",
              linhas: [],
            }
          : l,
      ),
    },
    caixa: {
      estado: "ok",
      erro: null,
      resposta: {
        lidoEm: AGORA,
        janela: { de: "2026-01", ate: "2026-08" },
        emitidoRecebido: { estado: "acesso_insuficiente", motivo: "sem acesso" },
        inadimplencia: { estado: "acesso_insuficiente", motivo: "sem acesso" },
        indicadores: { estado: "acesso_insuficiente", motivo: "sem acesso" },
      },
    },
  };
  const c = montarCockpit(semFin, recorte());
  for (const id of ["faturamento-mes", "faturamento-saiu", "vencido-em-aberto"]) {
    assert.equal(ind(c, id).estado, "acesso_insuficiente", id);
    assert.equal(ind(c, id).valor, null, id);
  }
});

test("Growth sem acesso: MRR vendido diz acesso insuficiente e o motor não inventa valor", () => {
  const f = fonteSintetica(HOJE, AGORA);
  const c = montarCockpit(
    {
      ...f,
      aquisicao: {
        estado: "ok",
        erro: null,
        resposta: {
          estado: "acesso_insuficiente",
          lidoEm: AGORA,
          motivo: "Sua conta não é membro do Growth.",
        },
      },
    },
    recorte(),
  );
  assert.equal(ind(c, "mrr-vendido").estado, "acesso_insuficiente");
  assert.equal(ind(c, "mrr-vendido").valor, null);
  const motor = c.empresa.motores.find((m) => m.id === "inside-sales");
  assert.equal(motor.realizado, "—");
});

test("Decisões: no máximo três, o perímetro sempre primeiro", () => {
  const c = montarCockpit(fonteSintetica(HOJE, AGORA), recorte());
  assert.ok(c.decisoes.length <= 3);
  assert.equal(c.decisoes[0].id, "perimetro-meta");
  assert.ok(c.decisoes.some((d) => d.id === "sla-onboarding"));
});

test("Motores sem série confiável aparecem como não apurados, nunca como zero", () => {
  const c = montarCockpit(fonteSintetica(HOJE, AGORA), recorte());
  for (const id of ["socios", "aquisicoes"]) {
    const m = c.empresa.motores.find((x) => x.id === id);
    assert.equal(m.estado, "nao_apurado", id);
    assert.equal(m.realizado, "—", id);
  }
});

// ── Registro único ───────────────────────────────────────────────────────────
test("Registro: as 11 exigências do mapa cobertas, ids únicos, pilares válidos, toda frente com pergunta", () => {
  const ids = new Set(PERGUNTAS.map((p) => p.id));
  assert.equal(ids.size, PERGUNTAS.length);
  for (const e of EXIGENCIAS_INVESTIDOR)
    assert.ok(
      PERGUNTAS.some((p) => p.exigencia === e.id && p.origem === "mapa"),
      `exigência ${e.id} sem pergunta`,
    );
  for (const p of PERGUNTAS) {
    assert.ok(PILARES[p.pilar], `${p.id} pilar`);
    for (const a of p.apoios) assert.ok(PILARES[a] && a !== p.pilar, `${p.id} apoio ${a}`);
    assert.ok(p.growth && p.ops && p.resposta, `${p.id} sem papel ou resposta`);
    for (const i of p.indicadores) assert.ok(IDS_INDICADORES.includes(i), `${p.id} → ${i}`);
  }
  for (const f of ORDEM_FRENTES)
    assert.ok(
      PERGUNTAS.some((p) => p.frente === f),
      `frente ${f}`,
    );
});

test("Registro: ids da primeira fatia preservados; pergunta não iniciada nunca se diz respondida", () => {
  for (const id of [
    "R1",
    "R2",
    "R3",
    "R4",
    "R5",
    "C1",
    "C2",
    "C3",
    "E1",
    "E2",
    "E3",
    "E4",
    "N1",
    "N2",
    "N3",
    "T1",
    "T2",
    "K1",
    "K2",
    "K3",
    "K4",
  ])
    assert.ok(
      PERGUNTAS.some((p) => p.id === id),
      id,
    );
  for (const p of PERGUNTAS.filter((x) => x.estados.implementacao === "nao_iniciada"))
    assert.equal(situacaoDaPergunta(p), "lacuna", p.id);
  assert.equal(
    PERGUNTAS.filter((p) => p.cobertura === "verificada").length,
    0,
    "sem aceite do responsável",
  );
});

test("Jev continua com as seis frentes avaliadas, mesmo com nove no cockpit", () => {
  assert.deepEqual(Object.keys(FRENTES_JEV), [
    "receita",
    "clientes",
    "comercial",
    "rede",
    "retencao",
    "capital",
  ]);
  assert.equal(ORDEM_FRENTES.length, 9);
});
