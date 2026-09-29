import test from "node:test";
import assert from "node:assert/strict";
import {
  montarFinanceiroOperacoes,
  extrairCaixaLivre,
  extrairFluxo,
  extrairDre,
  extrairExposicao,
  casarUnidade,
  janelasFinanceiro,
  brl,
  brlCurto,
} from "../src/lib/cockpit-coo/temas/financeiro-operacoes.ts";
import { lerUnidades } from "../src/lib/cockpit-coo/unidades.ts";
import { MAX_NUMEROS } from "../src/lib/cockpit-coo/contrato.ts";

// Cadastro de 29/09/2026 (ops.unidades), igual ao do teste base.
const CADASTRO = [
  { id: 1, nome_da_praca: "Curitiba", tipo: "regional", data_inauguracao: "2025-04-01" },
  { id: 2, nome_da_praca: "Patos de Minas", tipo: "regional", data_inauguracao: "2024-08-01" },
  { id: 3, nome_da_praca: "Belém", tipo: "regional", data_inauguracao: "2025-06-01" },
  { id: 4, nome_da_praca: "Rio de Janeiro", tipo: "regional", data_inauguracao: "2024-07-01" },
  { id: 5, nome_da_praca: "Campo Novo", tipo: "regional", data_inauguracao: "2026-04-01" },
  { id: 6, nome_da_praca: "São Luis", tipo: "regional", data_inauguracao: "2026-04-01" },
  { id: 7, nome_da_praca: "Fortaleza", tipo: "regional", data_inauguracao: "2026-04-01" },
  { id: 8, nome_da_praca: "Maceió", tipo: "regional", data_inauguracao: "2026-05-01" },
  { id: 9, nome_da_praca: "Goiânia", tipo: "interna", data_inauguracao: null },
  { id: 10, nome_da_praca: "Construção Civil", tipo: "interna", data_inauguracao: null },
  { id: 11, nome_da_praca: "Consultoria", tipo: "interna", data_inauguracao: null },
  { id: 12, nome_da_praca: "São Bernardo", tipo: "regional", data_inauguracao: null },
  { id: 13, nome_da_praca: "Recife", tipo: "regional", data_inauguracao: null },
  { id: 14, nome_da_praca: "Sorocaba", tipo: "regional", data_inauguracao: null },
  { id: 15, nome_da_praca: "São Paulo", tipo: "interna", data_inauguracao: null },
];
const U = lerUnidades(CADASTRO);
const HOJE = "2026-09-29";

const SEM_ACESSO = {
  ok: false,
  estado: "acesso_insuficiente",
  motivo: "O consolidado do grupo exige ver todas as empresas no Financeiro; seu escopo é por empresa.",
};
const FORA = { ok: false, estado: "fonte_indisponivel", motivo: "a consulta de teste falhou" };

const mesesSaldo = [
  "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
  "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
];
const saldoMes = (mes, valor, extra = {}) => ({
  mes,
  valor,
  mesEmCurso: false,
  fotos: [],
  empresasNoEscopo: 15,
  empresasComSaldo: valor === null ? 0 : 12,
  empresasSemSaldo: valor === null ? [] : ["AGRO", "NEO", "PARTNERS"],
  ...extra,
});
const SALDO = {
  ok: true,
  meses: mesesSaldo.map((m) => {
    if (m === "2026-07") return saldoMes(m, 2_000_000);
    if (m === "2026-08") return saldoMes(m, 1_500_000);
    if (m === "2026-09")
      return saldoMes(m, 1_200_000, { mesEmCurso: true, fotos: ["2026-09-10", "2026-09-24"] });
    return saldoMes(m, null);
  }),
};

const mesesFluxo = [
  "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
  "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
];
const fluxoCom = (ultimos3) => ({
  ok: true,
  janela: { de: "2025-09-01", ate: "2026-08-01" },
  meses: mesesFluxo.map((m, i) => ({
    mes: m,
    valor: i < 4 ? null : i >= 9 ? ultimos3[i - 9] : 50_000,
    parcial: false,
    empresasSemDado: m === "2026-08" ? ["AGRO", "PNC", "ROIT"] : [],
  })),
});
// Média de jun–ago = (−100.000 − 250.000 − 350.000,33) ÷ 3 = −233.333,443… → −233.333,44 (centavos).
const FLUXO = fluxoCom([-100_000, -250_000, -350_000.33]);

const exposicao = (saldo, aReceber, aPagar) => ({
  ok: true,
  dado: {
    competencia: "2026-09",
    vencDe: "2026-09-29",
    vencAte: "2026-10-28",
    saldo,
    saldoDisponivel: true,
    aReceber,
    aPagar,
    // A fonte devolve `saldo_final_previsto` já arredondado em centavos.
    previsto: Math.round((saldo + aReceber - aPagar) * 100) / 100,
    empresas: 16,
    empresasComSaldo: 12,
    empresasSemSaldo: ["PRJ", "PARTNERS", "NEO", "AGRO"],
    vencidoAPagar: { valor: 3_471_436.26, titulos: 1699, primeiro: "2025-09-15" },
    vencidoAReceber: { valor: 5_019_376.34, titulos: 765, primeiro: "2023-09-30" },
    depoisDaJanela: { valor: 35_085_352.64, titulos: 1986, ultimo: "5224-12-24" },
  },
});

// DRE: jan–mai 200.000 cada (1.000.000), jun 300.000, jul 100.000, ago 500.000, set parcial.
const DRE = {
  ok: true,
  recortesFora: ["Finance", "Negócios Estruturados"],
  meses: [
    ...["01", "02", "03", "04", "05"].map((m) => ({ mes: `2026-${m}`, valor: 200_000, parcial: false })),
    { mes: "2026-06", valor: 300_000, parcial: false },
    { mes: "2026-07", valor: 100_000, parcial: false },
    { mes: "2026-08", valor: 500_000, parcial: false },
  ],
};

const apuracao = (unidadeId, mes, status, royalties, cscFixo, cscBaseAntiga = null, total = 1000) => ({
  unidadeId,
  mes,
  status,
  royalties,
  cscFixo,
  cscBaseAntiga,
  total,
  atualizadoEm: "2026-09-10T12:00:00Z",
});
const fatura = (unidadeId, competencia, valor, venceEm, tituloStatus) => ({
  unidadeId,
  competencia,
  status: "faturada",
  valor,
  venceEm,
  titulo: tituloStatus ? { status: tituloStatus, vencimento: venceEm, pagoEm: null } : null,
});
const REPASSE = {
  ok: true,
  apuracoes: [
    apuracao(3, "2026-08", "confirmado", 12_000.1, 20_000, null, 57_808.06), // Belém: 32.000,10
    apuracao(4, "2026-08", "confirmado", 60_000, 25_000), // Rio: 85.000,00
    apuracao(2, "2026-08", "confirmado", 14_000, null, 2_500.55, 33_531.24), // Patos: 16.500,55
    apuracao(13, "2026-08", "confirmado", 0, 5_000, null, 5_335.36), // Recife, em implantação
    apuracao(9, "2026-08", "confirmado", 99_999, 0), // Goiânia (interna): nunca entra
    apuracao(1, "2026-08", "rascunho", 13_000, 15_000), // Curitiba em rascunho: não fechou
    apuracao(3, "2026-07", "confirmado", 19_836.14, 20_000), // Belém jul: 39.836,14
  ],
  faturas: {
    ok: true,
    linhas: [
      fatura(3, "2026-08", 14_808.06, "2026-09-13", "ATRASADO"), // 16 dias vencida: alerta
      fatura(4, "2026-08", 62_925.08, "2026-09-14", "ATRASADO"), // 15 dias: no limiar, sem alerta
      fatura(1, "2026-08", 14_809.55, "2026-09-01", "RECEBIDO"), // recebida: sem alerta
    ],
  },
};

const card = (fase, unidade, entrouNaFase, concluido = false) => ({ fase, unidade, entrouNaFase, concluido });
const ONBOARDING = {
  ok: true,
  atualizadoEm: "2026-09-29T11:00:00Z",
  cards: [
    card("Setup técnico", "Belém", "2026-08-20T15:00:00Z"), // 40 dias
    card("Setup técnico", "Matriz", "2026-08-01T12:00:00Z"), // Goiânia, 59 dias
    card("Nova Onboarding", "São Bernardo do Campo", "2026-08-15T12:00:00Z"), // São Bernardo, 45 dias
    card("Nova Onboarding", null, "2026-07-01T12:00:00Z"), // sem unidade, 90 dias
    card("Pré Kickoff [ops + cs]", "Rio de Janeiro", "2026-09-20T12:00:00Z"), // 9 dias
    // 30/08 02:00 UTC é 29/08 23:00 em São Paulo: 31 dias, parado. Pelo dia UTC seriam 30.
    card("Setup técnico", "Curitiba", "2026-08-30T02:00:00Z"),
    card("Setup técnico", "Fortaleza", "2026-08-30T12:00:00Z"), // 30 dias: no limiar, não parado
    card("Concluído", "Belém", "2026-06-01T12:00:00Z", true),
    card("Churn no Onboarding", "Belém", "2026-06-01T12:00:00Z", true),
  ],
};

const DADOS_OK = {
  lidoEm: "2026-09-29T12:00:00Z",
  saldo: SALDO,
  fluxo: FLUXO,
  exposicao: exposicao(1_200_000, 800_000, 2_100_000),
  dre: DRE,
  repasse: REPASSE,
  onboarding: ONBOARDING,
};
const DADOS_COO = {
  ...DADOS_OK,
  saldo: SEM_ACESSO,
  fluxo: SEM_ACESSO,
  exposicao: SEM_ACESSO,
  dre: SEM_ACESSO,
};

const num = (l, id) => l.numeros.find((n) => n.id === id);
const alertasDe = (l, regra) => l.alertas.filter((a) => a.regra === regra);

// ── Porta do Financeiro ──────────────────────────────────────────────────────────────────────

test("porta fechada: os quatro números do grupo saem sem acesso, com o motivo, e nunca zero", () => {
  const l = montarFinanceiroOperacoes(DADOS_COO, U, "", HOJE);
  for (const id of ["saldo-caixa", "geracao-caixa", "exposicao-30d", "resultado-dre"]) {
    const n = num(l, id);
    assert.equal(n.estado, "acesso_insuficiente", id);
    assert.equal(n.valor, null, id);
    assert.equal(n.cobertura, "grupo", id);
    assert.match(n.motivo, /todas as empresas/, id);
  }
  // Sem saldo nem fluxo não existe fôlego nem exposição para alertar.
  assert.equal(alertasDe(l, "folego-caixa").length, 0);
  assert.equal(alertasDe(l, "exposicao-negativa").length, 0);
});

test("porta fechada: o gráfico do caixa fica sem acesso e entra o do repasse mensal", () => {
  const l = montarFinanceiroOperacoes(DADOS_COO, U, "", HOJE);
  assert.equal(l.graficos.length, 2);
  const [caixa, repasse] = l.graficos;
  assert.equal(caixa.id, "caixa-apontando");
  assert.equal(caixa.estado, "acesso_insuficiente");
  assert.deepEqual(caixa.pontos, []);
  assert.equal(repasse.id, "repasse-mensal");
  assert.equal(repasse.titulo, "Quanto a rede repassou por mês?");
  assert.equal(repasse.pontos.length, 12);
  assert.equal(repasse.pontos[0].rotulo, "set/25");
  assert.equal(repasse.pontos.at(-1).rotulo, "ago/26");
  // ago: Belém 32.000,10 + Rio 85.000,00 + Patos 16.500,55 (sem Recife, em implantação, e sem Goiânia).
  assert.equal(repasse.pontos.at(-1).repasse, 133_500.65);
  // jul: só Belém fechou.
  assert.equal(repasse.pontos.at(-2).repasse, 39_836.14);
  // Mês sem apuração fechada é vazio, não zero.
  assert.equal(repasse.pontos[0].repasse, null);
});

test("porta aberta: só o gráfico do caixa, com a projeção de 30 dias no último ponto", () => {
  const l = montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE);
  assert.equal(l.graficos.length, 1);
  const g = l.graficos[0];
  assert.equal(g.titulo, "Para onde o caixa está apontando?");
  assert.equal(g.estado, "disponivel");
  assert.equal(g.pontos.length, 13);
  assert.deepEqual(g.pontos.at(-2), { rotulo: "set/26", saldo: 1_200_000, projetado: 1_200_000 });
  assert.deepEqual(g.pontos.at(-1), { rotulo: "até 28/10", saldo: null, projetado: -100_000 });
  assert.equal(g.pontos[0].saldo, null);
  assert.equal(g.pontos[0].projetado, null);
});

// ── Números do grupo ─────────────────────────────────────────────────────────────────────────

test("saldo em caixa: foto mais antiga na nota, empresas que faltam no parcial e na atenção", () => {
  const n = num(montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE), "saldo-caixa");
  assert.equal(n.valor, 1_200_000);
  assert.equal(n.estado, "parcial");
  assert.equal(n.nota, "Foto mais antiga: 10/09/2026");
  assert.equal(n.dataDado, "2026-09-10");
  assert.match(n.motivo, /AGRO, NEO e PARTNERS/);
  assert.match(n.explicacao.atencao, /3 empresas de 15 sem saldo em set\/2026/);
  assert.match(n.explicacao.atencao, /de 10\/09\/2026 a 24\/09\/2026/);
  assert.equal(n.tendencia.valores.length, 12);
  assert.deepEqual(n.tendencia.valores.slice(-3), [2_000_000, 1_500_000, 1_200_000]);
  assert.equal(n.destino.externo, true);
});

test("saldo: sem nenhum mês com saldo é não apurado, não R$ 0", () => {
  const vazio = { ok: true, meses: mesesSaldo.map((m) => saldoMes(m, null)) };
  const l = montarFinanceiroOperacoes({ ...DADOS_OK, saldo: vazio }, U, "", HOJE);
  const n = num(l, "saldo-caixa");
  assert.equal(n.estado, "nao_apurado");
  assert.equal(n.valor, null);
  assert.equal(l.graficos[0].estado, "nao_apurado");
  // Sem saldo, o fôlego não é calculado (e não vira zero).
  assert.equal(num(l, "geracao-caixa").nota, "Fôlego sem saldo para calcular");
  assert.equal(alertasDe(l, "folego-caixa").length, 0);
});

test("geração de caixa: média dos 3 últimos meses fechados e fôlego abaixo de 6 meses alerta", () => {
  const l = montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE);
  const n = num(l, "geracao-caixa");
  assert.equal(n.valor, -233_333.44);
  // 1.200.000 ÷ 233.333,44 = 5,14 meses.
  assert.equal(n.nota, "Fôlego de 5,1 meses no ritmo de jun/2026 a ago/2026");
  assert.equal(n.tom, "atencao");
  assert.match(n.explicacao.atencao, /Janela lida: set\/2025 a ago\/2026/);
  assert.match(n.explicacao.atencao, /AGRO, PNC e ROIT/);
  const [a] = alertasDe(l, "folego-caixa");
  assert.equal(a.gravidade, "atencao");
  assert.equal(a.titulo, "Grupo · fôlego de caixa de 5,1 meses");
  // Peso: 6 × 233.333,44 − 1.200.000 = 200.000,64 que faltam para 6 meses.
  assert.equal(a.peso, 200_000.64);
  assert.equal(a.chave, "coo:financeiro-operacoes:folego-caixa:rede:2026-09");
  assert.match(a.limiar, /abaixo de 6 meses/);
});

test("fôlego: exatamente 6 meses não alerta; sem queima diz isso na nota", () => {
  const seis = montarFinanceiroOperacoes({ ...DADOS_OK, fluxo: fluxoCom([-200_000, -200_000, -200_000]) }, U, "", HOJE);
  assert.equal(num(seis, "geracao-caixa").nota, "Fôlego de 6,0 meses no ritmo de jun/2026 a ago/2026");
  assert.equal(alertasDe(seis, "folego-caixa").length, 0);
  const gera = montarFinanceiroOperacoes({ ...DADOS_OK, fluxo: fluxoCom([-300_000, 100_000, 350_000]) }, U, "", HOJE);
  const n = num(gera, "geracao-caixa");
  assert.equal(n.valor, 50_000);
  assert.equal(n.nota, "Sem queima nos 3 últimos meses");
  assert.equal(n.tom, undefined);
  assert.equal(alertasDe(gera, "folego-caixa").length, 0);
});

test("geração: mês parcial não entra no ritmo; menos de 3 fechados é não apurado", () => {
  const f = fluxoCom([-100_000, -250_000, -350_000.33]);
  f.meses[11].parcial = true; // ago parcial: o ritmo passa a ser mai–jul
  const n = num(montarFinanceiroOperacoes({ ...DADOS_OK, fluxo: f }, U, "", HOJE), "geracao-caixa");
  // (50.000 − 100.000 − 250.000) ÷ 3 = −100.000
  assert.equal(n.valor, -100_000);
  assert.match(n.nota, /mai\/2026 a jul\/2026/);
  const curto = {
    ok: true,
    janela: FLUXO.janela,
    meses: FLUXO.meses.map((m, i) => ({ ...m, valor: i >= 10 ? m.valor : null })),
  };
  const s = num(montarFinanceiroOperacoes({ ...DADOS_OK, fluxo: curto }, U, "", HOJE), "geracao-caixa");
  assert.equal(s.estado, "nao_apurado");
  assert.equal(s.valor, null);
});

test("exposição em 30 dias: saldo + a receber − a pagar; negativa é alerta crítico", () => {
  const l = montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE);
  const n = num(l, "exposicao-30d");
  assert.equal(n.valor, -100_000);
  assert.equal(n.estado, "parcial");
  assert.equal(n.tom, "perigo");
  assert.equal(n.nota, "Até 28/10: R$ 800 mil a receber contra R$ 2,10 mi a pagar");
  assert.match(n.explicacao.atencao, /intercompany/);
  assert.match(n.explicacao.atencao, /5224/);
  assert.match(n.explicacao.atencao, /PRJ, PARTNERS, NEO e AGRO/);
  // Os vencidos ficam fora do número e aparecem na tabela, à parte.
  const linhas = n.dados.linhas.map((x) => x[0]);
  assert.ok(linhas.includes("A pagar vencido"));
  assert.ok(linhas.includes("A receber vencido"));
  const [a] = alertasDe(l, "exposicao-negativa");
  assert.equal(a.gravidade, "critico");
  assert.equal(a.peso, 100_000);
  assert.equal(l.alertas.filter((x) => x.gravidade === "critico").length, 1);
});

test("exposição positiva não alerta; sem saldo carimbado é não apurado", () => {
  const pos = montarFinanceiroOperacoes({ ...DADOS_OK, exposicao: exposicao(1_952_251.58, 4_815_904.4, 6_729_477.6) }, U, "", HOJE);
  assert.equal(num(pos, "exposicao-30d").valor, 38_678.38);
  assert.equal(alertasDe(pos, "exposicao-negativa").length, 0);
  const sem = exposicao(0, 10, 20);
  sem.dado.saldoDisponivel = false;
  const l = montarFinanceiroOperacoes({ ...DADOS_OK, exposicao: sem }, U, "", HOJE);
  assert.equal(num(l, "exposicao-30d").estado, "nao_apurado");
  assert.equal(num(l, "exposicao-30d").valor, null);
  // O gráfico fica parcial: sem a projeção.
  assert.equal(l.graficos[0].estado, "parcial");
});

test("DRE: acumulado dos meses fechados do ano e projeção pelo ritmo, sem meta", () => {
  const n = num(montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE), "resultado-dre");
  // 5 × 200.000 + 300.000 + 100.000 + 500.000
  assert.equal(n.valor, 1_900_000);
  assert.equal(n.estado, "disponivel");
  // 1.900.000 + (300.000 + 100.000 + 500.000) ÷ 3 × 4 meses (set–dez) = 3.100.000
  assert.equal(n.nota, "Projeção de 2026: R$ 3,10 mi (estimativa pelo ritmo)");
  assert.equal(n.meta, undefined);
  assert.match(n.explicacao.atencao, /Não há orçado/);
  assert.match(n.explicacao.dono, /Controladoria/);
  assert.match(n.explicacao.comoCalcula, /Finance e Negócios Estruturados/);
  assert.deepEqual(n.dados.linhas.at(-1), ["Projeção de 2026 (estimativa pelo ritmo)", 3_100_000, "4 meses a projetar"]);
});

test("DRE no começo do ano: ritmo usa os meses fechados do ano anterior", () => {
  const dre = {
    ok: true,
    recortesFora: [],
    meses: [
      { mes: "2026-11", valor: 100, parcial: false },
      { mes: "2026-12", valor: 200, parcial: false },
      { mes: "2027-01", valor: 300, parcial: false },
    ],
  };
  const n = num(montarFinanceiroOperacoes({ ...DADOS_OK, dre }, U, "", "2027-02-10"), "resultado-dre");
  assert.equal(n.valor, 300);
  // 300 + 200 × 11 = 2.500
  assert.equal(n.nota, "Projeção de 2027: R$ 3 mil (estimativa pelo ritmo)");
  assert.deepEqual(n.dados.linhas.at(-1), ["Projeção de 2027 (estimativa pelo ritmo)", 2_500, "11 meses a projetar"]);
});

test("DRE sem mês fechado no ano é não apurado", () => {
  const dre = { ok: true, recortesFora: [], meses: [{ mes: "2026-12", valor: 10, parcial: false }] };
  const n = num(montarFinanceiroOperacoes({ ...DADOS_OK, dre }, U, "", "2027-01-15"), "resultado-dre");
  assert.equal(n.estado, "nao_apurado");
  assert.equal(n.valor, null);
});

test("número do grupo ignora o filtro de unidade e diz isso", () => {
  const todas = montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE);
  const belem = montarFinanceiroOperacoes(DADOS_OK, U, "3", HOJE);
  const propria = montarFinanceiroOperacoes(DADOS_OK, U, "propria", HOJE);
  for (const id of ["saldo-caixa", "geracao-caixa", "exposicao-30d", "resultado-dre"]) {
    assert.equal(num(belem, id).valor, num(todas, id).valor, id);
    assert.equal(num(propria, id).valor, num(todas, id).valor, id);
    assert.match(num(belem, id).explicacao.atencao, /não muda com o filtro de unidade/, id);
  }
});

// ── Repasse da rede ──────────────────────────────────────────────────────────────────────────

test("repasse: só rede regional em operação; Goiânia e unidade em implantação ficam fora", () => {
  const n = num(montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE), "repasse-rede");
  assert.equal(n.cobertura, "rede");
  assert.equal(n.rotulo, "Repasse da rede em ago/2026");
  // 32.000,10 + 85.000,00 + 16.500,55 (Recife 5.000 e Goiânia 99.999 fora)
  assert.equal(n.valor, 133_500.65);
  assert.equal(n.estado, "parcial");
  assert.equal(n.motivo, "fora da soma: Campo Novo, Curitiba, Fortaleza, Maceió e São Luis");
  assert.equal(n.nota, "3 de 8 apurações fechadas, 2 faturadas");
  assert.match(n.explicacao.atencao, /Unidades em implantação ficam fora: Recife \(R\$ 5\.000,00\)/);
  assert.equal(n.destino.rota, "/receita-overview");
  assert.deepEqual(n.destino.search, { mes: "2026-08" });
  assert.equal(n.dados.linhas.length, 8);
});

test("repasse com filtro: operação própria e unidade em implantação não têm número", () => {
  const propria = num(montarFinanceiroOperacoes(DADOS_OK, U, "propria", HOJE), "repasse-rede");
  assert.equal(propria.estado, "nao_apurado");
  assert.equal(propria.valor, null);
  assert.equal(propria.motivo, "só existe na rede regional");
  const goiania = num(montarFinanceiroOperacoes(DADOS_OK, U, "9", HOJE), "repasse-rede");
  assert.equal(goiania.estado, "nao_apurado");
  const recife = num(montarFinanceiroOperacoes(DADOS_OK, U, "13", HOJE), "repasse-rede");
  assert.equal(recife.estado, "nao_apurado");
  assert.match(recife.motivo, /implantação/);
  const rio = num(montarFinanceiroOperacoes(DADOS_OK, U, "4", HOJE), "repasse-rede");
  assert.equal(rio.valor, 85_000);
  assert.equal(rio.estado, "disponivel");
  // Com a porta fechada, o gráfico de reserva segue o filtro.
  const g = montarFinanceiroOperacoes(DADOS_COO, U, "propria", HOJE).graficos[1];
  assert.equal(g.estado, "nao_apurado");
  assert.equal(g.motivo, "só existe na rede regional");
});

test("repasse: royalties ausentes não viram zero; nenhuma apuração fechada é não apurado", () => {
  const semRoy = {
    ...REPASSE,
    apuracoes: [apuracao(4, "2026-08", "confirmado", null, 25_000), apuracao(3, "2026-08", "confirmado", 1_000, 1_000)],
  };
  const n = num(montarFinanceiroOperacoes({ ...DADOS_OK, repasse: semRoy }, U, "rede", HOJE), "repasse-rede");
  assert.equal(n.valor, 2_000);
  assert.equal(n.estado, "parcial");
  assert.match(n.motivo, /Rio de Janeiro \(sem royalties\)/);
  const nada = { ...REPASSE, apuracoes: [apuracao(1, "2026-08", "rascunho", 1, 1)] };
  const z = num(montarFinanceiroOperacoes({ ...DADOS_OK, repasse: nada }, U, "", HOJE), "repasse-rede");
  assert.equal(z.estado, "nao_apurado");
  assert.equal(z.valor, null);
  const fora = num(montarFinanceiroOperacoes({ ...DADOS_OK, repasse: FORA }, U, "", HOJE), "repasse-rede");
  assert.equal(fora.estado, "fonte_indisponivel");
  assert.equal(fora.valor, null);
});

test("alertas do repasse: apuração fechada sem fatura por unidade da rede", () => {
  const l = montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE);
  const sem = alertasDe(l, "apuracao-sem-fatura");
  // Patos (em operação) e Recife (em implantação: a cobrança é operação); Goiânia nunca.
  assert.deepEqual(sem.map((a) => a.titulo).sort(), [
    "Patos de Minas · apuração fechada sem fatura",
    "Recife · apuração fechada sem fatura",
  ]);
  const patos = sem.find((a) => a.unidade === "Patos de Minas");
  assert.equal(patos.chave, "coo:financeiro-operacoes:apuracao-sem-fatura:patos-de-minas:2026-08");
  assert.equal(patos.peso, 33_531.24);
  assert.equal(patos.destino.rota, "/unidades/royalties");
  // Com filtro "propria", nenhum alerta de repasse.
  const p = montarFinanceiroOperacoes(DADOS_OK, U, "propria", HOJE);
  assert.equal(alertasDe(p, "apuracao-sem-fatura").length, 0);
});

test("alertas do repasse: faturado e não recebido há mais de 15 dias, pelo vencimento", () => {
  const l = montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE);
  const nr = alertasDe(l, "faturado-nao-recebido");
  // Belém venceu em 13/09 (16 dias); Rio em 14/09 (15, no limiar); Curitiba recebeu.
  assert.equal(nr.length, 1);
  assert.equal(nr[0].titulo, "Belém · faturado e não recebido há 16 dias");
  assert.equal(nr[0].peso, 14_808.06);
  assert.equal(nr[0].gravidade, "atencao");
  // Sem leitura das faturas: nenhum alerta de fatura, e um aviso diz por quê.
  const semFat = { ...REPASSE, faturas: { ok: false, estado: "acesso_insuficiente", motivo: "sem a chave" } };
  const s = montarFinanceiroOperacoes({ ...DADOS_OK, repasse: semFat }, U, "", HOJE);
  assert.equal(alertasDe(s, "faturado-nao-recebido").length, 0);
  assert.equal(alertasDe(s, "apuracao-sem-fatura").length, 0);
  assert.ok(s.avisos.some((x) => /Faturas do repasse sem leitura/.test(x)));
  assert.equal(num(s, "repasse-rede").nota, "3 de 8 unidades em operação com apuração fechada");
});

// ── Onboarding ───────────────────────────────────────────────────────────────────────────────

test("onboarding: todas as unidades, inclusive Goiânia e o card sem unidade, no filtro vazio", () => {
  const l = montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE);
  const n = num(l, "onboarding-parado");
  // Belém 40, Goiânia 59, São Bernardo 45, sem unidade 90, Curitiba 31 (fuso de São Paulo).
  assert.equal(n.valor, 5);
  assert.equal(n.cobertura, "todas");
  assert.equal(n.nota, "Gargalo: Setup técnico (3)");
  assert.equal(n.dataDado, "2026-09-29");
  assert.deepEqual(n.dados.linhas[0], ["Setup técnico", 4, 3]);
  const [g] = alertasDe(l, "onboarding-gargalo");
  assert.equal(g.titulo, "Onboarding · Setup técnico com 3 clientes parados há 30+ dias");
  assert.equal(g.peso, 3);
  assert.ok(l.avisos.some((x) => /1 card de onboarding sem unidade/.test(x)));
});

test("onboarding por filtro: própria, rede e uma unidade", () => {
  const v = (f) => num(montarFinanceiroOperacoes(DADOS_OK, U, f, HOJE), "onboarding-parado").valor;
  assert.equal(v("propria"), 1); // Goiânia ("Matriz" no Pipefy)
  assert.equal(v("rede"), 3); // Belém, São Bernardo, Curitiba; o card sem unidade não entra
  assert.equal(v("12"), 1); // "São Bernardo do Campo" casa com São Bernardo
  assert.equal(v("9"), 1);
  assert.equal(v("7"), 0); // Fortaleza com 30 dias está no limiar
});

test("onboarding: zero é zero quando a fila foi lida; fonte fora é fonte fora", () => {
  const vazio = { ok: true, atualizadoEm: null, cards: [card("Setup técnico", "Belém", "2026-09-25T12:00:00Z")] };
  const l = montarFinanceiroOperacoes({ ...DADOS_OK, onboarding: vazio }, U, "", HOJE);
  const n = num(l, "onboarding-parado");
  assert.equal(n.valor, 0);
  assert.equal(n.estado, "disponivel");
  assert.equal(n.nota, "1 cliente em curso, nenhum parado");
  assert.equal(alertasDe(l, "onboarding-gargalo").length, 0);
  const f = num(montarFinanceiroOperacoes({ ...DADOS_OK, onboarding: FORA }, U, "", HOJE), "onboarding-parado");
  assert.equal(f.estado, "fonte_indisponivel");
  assert.equal(f.valor, null);
});

// ── Forma da leitura ─────────────────────────────────────────────────────────────────────────

test("no máximo 6 números, com explicação, fonte e cobertura em todos", () => {
  for (const dados of [DADOS_OK, DADOS_COO]) {
    for (const filtro of ["", "rede", "propria", "9", "13"]) {
      const l = montarFinanceiroOperacoes(dados, U, filtro, HOJE);
      assert.ok(l.numeros.length <= MAX_NUMEROS);
      assert.deepEqual(
        l.numeros.map((n) => n.id),
        ["saldo-caixa", "geracao-caixa", "exposicao-30d", "resultado-dre", "repasse-rede", "onboarding-parado"],
      );
      for (const n of l.numeros) {
        assert.ok(n.explicacao.oQueDiz && n.explicacao.comoCalcula && n.explicacao.dono, n.id);
        assert.ok(n.fonte && !/ops\.|fn_/.test(n.fonte), `${n.id}: fonte legível`);
        if (n.estado !== "disponivel" && n.estado !== "parcial") assert.equal(n.valor, null, n.id);
      }
      assert.equal(l.tema, "financeiro-operacoes");
      assert.ok(l.graficos.length >= 1 && l.graficos.length <= 2);
    }
  }
  assert.equal(
    montarFinanceiroOperacoes(DADOS_OK, U, "", HOJE).universo,
    "15 unidades · 11 da rede regional (8 em operação) · 4 de operação própria",
  );
});

// ── Extratores e utilitários ─────────────────────────────────────────────────────────────────

test("extrairCaixaLivre: payload real de set/2026 (mês em curso, fotos por empresa)", () => {
  const s = extrairCaixaLivre("2026-09", {
    valor: 1952251.58,
    sem_dado: false,
    mes_referencia: "2026-09-01",
    mes_em_curso: true,
    fontes: [
      "omie:mes-em-curso@2026-09-24",
      "omie:mes-em-curso@2026-09-10",
      "omie:mes-em-curso@2026-09-17",
      "omie:mes-em-curso@2026-09-11",
    ],
    cobertura: { n_empresas_no_escopo: 15, n_empresas_com_saldo: 12, empresas_sem_saldo: ["AGRO", "NEO", "PARTNERS"] },
  });
  assert.equal(s.valor, 1952251.58);
  assert.deepEqual(s.fotos, ["2026-09-10", "2026-09-11", "2026-09-17", "2026-09-24"]);
  assert.equal(s.empresasComSaldo, 12);
  // Sem dado no mês: null, não zero, e nenhuma empresa conta como tendo saldo.
  const vazio = extrairCaixaLivre("2025-10", {
    valor: null,
    sem_dado: true,
    mes_referencia: null,
    fontes: [],
    cobertura: { n_empresas_no_escopo: 15, n_empresas_com_saldo: 0, empresas_sem_saldo: [] },
  });
  assert.equal(vazio.valor, null);
  assert.throws(() => extrairCaixaLivre("2026-09", { valor: 1 }), /formato inesperado/);
});

test("extrairFluxo: mês fora de meses_com_dado é vazio; mês parcial marcado", () => {
  const m = extrairFluxo({
    totais: {
      "2025-12-01": { total_geral: 25772 },
      "2026-08-01": { total_geral: -563031.04 },
      "2026-09-01": { total_geral: 947434.16 },
    },
    periodos: [
      { id: "2025-12-01", parcial: false, parcial_dado: false },
      { id: "2026-08-01", parcial: false, parcial_dado: false },
      { id: "2026-09-01", parcial: false, parcial_dado: true },
    ],
    cobertura: {
      meses_com_dado: ["2026-08-01", "2026-09-01"],
      meses_parciais: ["2026-09-01"],
      empresas_sem_dado_por_competencia: [{ competencia: "2026-08-01", empresas: ["AGRO", "PNC", "ROIT"] }],
    },
  });
  assert.deepEqual(m, [
    { mes: "2025-12", valor: null, parcial: false, empresasSemDado: [] },
    { mes: "2026-08", valor: -563031.04, parcial: false, empresasSemDado: ["AGRO", "PNC", "ROIT"] },
    { mes: "2026-09", valor: 947434.16, parcial: true, empresasSemDado: [] },
  ]);
});

test("extrairDre e extrairExposicao: payloads reais", () => {
  const d = extrairDre({
    total_geral: { valores: { "2026-08-01": 1847086.68, "2026-09-01": 2986289.25 } },
    cobertura: { meses_com_dado: ["2026-08-01", "2026-09-01"], meses_parciais: ["2026-09-01"] },
    escopo: {
      recortes_destacaveis: [
        { rotulo: "Finance", estado: "excluido" },
        { rotulo: "Negócios Estruturados", estado: "excluido" },
      ],
    },
  });
  assert.deepEqual(d.meses, [
    { mes: "2026-08", valor: 1847086.68, parcial: false },
    { mes: "2026-09", valor: 2986289.25, parcial: true },
  ]);
  assert.deepEqual(d.recortesFora, ["Finance", "Negócios Estruturados"]);
  const e = extrairExposicao({
    competencia: "2026-09-01",
    venc_de: "2026-09-29",
    venc_ate: "2026-10-28",
    totais: {
      saldo: 1952251.58,
      total_a_pagar: 6729477.6,
      receita_prevista: 4815904.4,
      saldo_final_previsto: 38678.38,
      empresas: 16,
      empresas_com_saldo: 12,
      saldo_disponivel: true,
    },
    antes_da_janela: { valor: 3471436.26, titulos: 1699, primeiro_vencimento: "2025-09-15" },
    receita_antes_da_janela: { valor: 5019376.34, titulos: 765, primeiro_vencimento: "2023-09-30" },
    fora_da_janela: { valor: 35085352.64, titulos: 1986, ultimo_vencimento: "5224-12-24" },
    por_empresa: [
      { apelido: "PAC", saldo: 251665.57 },
      { apelido: "PRJ", saldo: null },
      { apelido: "AGRO", saldo: null },
    ],
  });
  assert.equal(e.previsto, 38678.38);
  assert.equal(e.competencia, "2026-09");
  assert.deepEqual(e.empresasSemSaldo, ["PRJ", "AGRO"]);
  assert.equal(e.vencidoAReceber.titulos, 765);
  assert.throws(() => extrairExposicao({ totais: {} }), /formato inesperado/);
});

test("casarUnidade: apelido do cadastro, complemento de nome e texto que não casa", () => {
  assert.equal(casarUnidade(U, "São Bernardo do Campo").id, 12);
  assert.equal(casarUnidade(U, "São Luís").id, 6);
  assert.equal(casarUnidade(U, "Matriz").id, 9);
  assert.equal(casarUnidade(U, "Itaúna"), null);
  assert.equal(casarUnidade(U, null), null);
});

test("janelas pedidas ao Financeiro", () => {
  const j = janelasFinanceiro(HOJE);
  assert.equal(j.saldoMeses.length, 12);
  assert.equal(j.saldoMeses[0], "2025-10");
  assert.equal(j.saldoMeses[11], "2026-09");
  assert.deepEqual(j.fluxo, { de: "2025-09-01", ate: "2026-08-01" });
  assert.deepEqual(j.dre, { de: "2026-01-01", ate: "2026-08-31" });
  assert.deepEqual(j.exposicao, { competencia: "2026-09-01", de: "2026-09-29", ate: "2026-10-28" });
  // Em fevereiro a DRE começa em novembro do ano anterior, para ter 3 meses de ritmo.
  assert.deepEqual(janelasFinanceiro("2027-02-10").dre, { de: "2026-11-01", ate: "2027-01-31" });
});

test("formatação de reais sem espaço inseparável", () => {
  assert.equal(brl(1952251.58), "R$ 1.952.251,58");
  assert.equal(brl(-430341.52), "-R$ 430.341,52");
  assert.equal(brlCurto(1952251.58), "R$ 1,95 mi");
  assert.equal(brlCurto(12392860.75), "R$ 12,4 mi");
  assert.equal(brlCurto(-430341.52), "-R$ 430 mil");
  assert.equal(brlCurto(38678.38), "R$ 39 mil");
});
