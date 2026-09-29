import test from "node:test";
import assert from "node:assert/strict";
import {
  montarGrowth,
  janelaTrimestre,
  trimestreAnterior,
  unidadeDoGrowth,
  LIMIAR_RITMO,
  DIAS_BROKER_PARADA,
} from "../src/lib/cockpit-coo/temas/growth.ts";
import { lerUnidades } from "../src/lib/cockpit-coo/unidades.ts";
import { MAX_NUMEROS } from "../src/lib/cockpit-coo/contrato.ts";

// Cadastro de 29/09/2026 (ops.unidades), como no teste base.
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
const UNIDADES = lerUnidades(CADASTRO);
const HOJE = "2026-09-29";

const ok = (dado, atualizadoEm = "2026-09-29T11:10:00Z") => ({ ok: true, dado, atualizadoEm });

// Metas do Growth: nomes como o Growth grava ("Matriz" = Goiânia, "Marox" = Construção Civil).
const METAS = [
  { unidade: "Matriz", quarter: "2026-T3", meta: "150000", vendido: "226376.13" },
  { unidade: "Marox", quarter: "2026-T3", meta: 60000, vendido: 5909.9 },
  { unidade: "Rio de Janeiro", quarter: "2026-T3", meta: 40000, vendido: 17500 },
  { unidade: "Patos de Minas", quarter: "2026-T3", meta: 30000, vendido: 22500 },
  // Em implantação: não entram na soma nem no alerta, mesmo muito acima ou muito abaixo.
  { unidade: "São Bernardo", quarter: "2026-T3", meta: 10000, vendido: 110971.96 },
  { unidade: "Recife", quarter: "2026-T3", meta: 10000, vendido: 0 },
  // Outro trimestre: ignorado.
  { unidade: "Belém", quarter: "2026-T2", meta: 60000, vendido: 0 },
  // Sem unidade no cadastro: vira aviso.
  { unidade: "Itaúna", quarter: "2026-T3", meta: 5000, vendido: 0 },
];

// Contratos do Inside Sales (ops.contratos), com a unidade como o Ops grava.
const CONTRATOS = [
  { id: 1, unidade: "Rio de Janeiro", ganho_em: "2026-07-13", mrr_mensal: 17500 },
  { id: 2, unidade: "Patos de Minas", ganho_em: "2026-07-31", mrr_mensal: 7500 },
  { id: 3, unidade: "Patos de Minas", ganho_em: "2026-09-09", mrr_mensal: "7500" },
  { id: 4, unidade: "Matriz", ganho_em: "2026-08-15", mrr_mensal: 20000 },
  { id: 5, unidade: "Consultoria", ganho_em: "2026-09-04", mrr_mensal: 1000 },
  { id: 6, unidade: "São Bernardo", ganho_em: "2026-09-01", mrr_mensal: 5000 },
  { id: 7, unidade: "1124", ganho_em: "2026-09-04", mrr_mensal: 2490 },
  { id: 8, unidade: "Curitiba", ganho_em: "2026-07-10", mrr_mensal: 3000 },
  { id: 9, unidade: "Curitiba", ganho_em: "2026-09-30", mrr_mensal: 9999 }, // amanhã: fora
  { id: 10, unidade: "Belém", ganho_em: "2026-05-10", mrr_mensal: 4000 }, // T2
  { id: 11, unidade: "Rio de Janeiro", ganho_em: "2026-06-20", mrr_mensal: 6000 }, // T2
  { id: 12, unidade: "Belém", ganho_em: "2026-03-01", mrr_mensal: 99999 }, // T1: fora
  { id: 13, unidade: "Belém", ganho_em: "2026-08-20", mrr_mensal: 2000 },
];

const SERIE = [
  { mes: "2026-04", vendas: 20, mrr: 100000, investimento: 200000 },
  { mes: "2026-05", vendas: 23, mrr: 171176.47, investimento: 265899.37 },
  { mes: "2026-06", vendas: 40, mrr: 223166.68, investimento: 219346.46 },
  { mes: "2026-07", vendas: 48, mrr: 215703.16, investimento: 228719.64 },
  { mes: "2026-08", vendas: 56, mrr: 267178.49, investimento: 256102.48 },
  { mes: "2026-09", vendas: "72", mrr: "359954.12", investimento: "301099.98" },
];
const PLANOS = [
  { mes: "2026-07", metrica: "investimento_mes", alvo: 220000 },
  { mes: "2026-08", metrica: "investimento_mes", alvo: 250000 },
  { mes: "2026-09", metrica: "investimento_mes", alvo: 300000 },
];

// Apuração confirmada de agosto (o último mês fechado em 29/09).
const MIDIA_UNIDADES = [
  { unidade_id: 1, mes_referencia: "2026-08-01", csc_trafego_pago: 20000 },
  { unidade_id: 2, mes_referencia: "2026-08-01", csc_trafego_pago: 10000 },
  { unidade_id: 3, mes_referencia: "2026-08-01", csc_trafego_pago: 20000 },
  { unidade_id: 4, mes_referencia: "2026-08-01", csc_trafego_pago: "10000" },
  { unidade_id: 5, mes_referencia: "2026-08-01", csc_trafego_pago: 0 },
  { unidade_id: 7, mes_referencia: "2026-08-01", csc_trafego_pago: null },
  { unidade_id: 12, mes_referencia: "2026-08-01", csc_trafego_pago: null },
];

const BROKER = [
  { id: 1, status: "disponivel", reservado_por: null, updated_at: "2026-09-01T20:03:27Z", fechado_em: null, mrr_precificado: 5000 },
  { id: 2, status: "disponivel", reservado_por: null, updated_at: "2026-09-20T10:00:00Z", fechado_em: null, mrr_precificado: null },
  // 15 dias exatos: ainda não passou do limiar.
  { id: 3, status: "disponivel", reservado_por: null, updated_at: "2026-09-14T14:10:15Z", fechado_em: null, mrr_precificado: null },
  { id: 4, status: "reservado", reservado_por: 4, updated_at: "2026-09-03T22:08:41Z", fechado_em: null, mrr_precificado: 4000 },
  { id: 5, status: "reservado", reservado_por: 8, updated_at: "2026-09-24T15:35:27Z", fechado_em: null, mrr_precificado: null },
  { id: 6, status: "comprado", reservado_por: 4, updated_at: "2026-09-14T14:10:15Z", fechado_em: "2026-09-14", mrr_precificado: 4500 },
  { id: 7, status: "comprado", reservado_por: 4, updated_at: "2026-06-10T00:00:00Z", fechado_em: "2026-06-10", mrr_precificado: 3000 },
  { id: 8, status: "perdido", reservado_por: null, updated_at: "2026-09-03T20:55:04Z", fechado_em: null, mrr_precificado: 14000 },
];

const DADOS = {
  metas: ok(METAS),
  contratos: ok(CONTRATOS),
  midia: ok({ serie: SERIE, planos: PLANOS }, "2026-09-28"),
  midiaUnidades: ok(MIDIA_UNIDADES),
  broker: ok(BROKER),
};

const num = (l, id) => l.numeros.find((n) => n.id === id);

test("janela do trimestre: T3/2026 em 29/09 tem 90 de 92 dias corridos", () => {
  const j = janelaTrimestre(HOJE);
  assert.equal(j.chave, "2026-T3");
  assert.equal(j.rotulo, "T3/2026");
  assert.equal(j.inicio, "2026-07-01");
  assert.equal(j.fim, "2026-10-01");
  assert.deepEqual(j.meses, ["2026-07", "2026-08", "2026-09"]);
  assert.equal(j.dias, 92);
  assert.equal(j.decorridos, 90); // 31 de julho + 31 de agosto + 28 de setembro
  const a = trimestreAnterior(j);
  assert.equal(a.chave, "2026-T2");
  assert.equal(a.inicio, "2026-04-01");
  assert.equal(a.fim, "2026-07-01");
  assert.equal(a.fracao, 1);
  // Virada de ano.
  assert.equal(trimestreAnterior(janelaTrimestre("2027-01-15")).chave, "2026-T4");
});

test("apelidos do Growth casam com o cadastro: Matriz = Goiânia, Marox = Construção Civil", () => {
  assert.equal(unidadeDoGrowth(UNIDADES, "Matriz").id, 9);
  assert.equal(unidadeDoGrowth(UNIDADES, "Marox").id, 10);
  assert.equal(unidadeDoGrowth(UNIDADES, "São Luis").id, 6);
  assert.equal(unidadeDoGrowth(UNIDADES, "1124"), null);
  assert.equal(unidadeDoGrowth(UNIDADES, null), null);
});

test("no máximo 6 números, cada um com explicação, dono, cobertura e fonte", () => {
  const l = montarGrowth(DADOS, UNIDADES, "", HOJE);
  assert.ok(l.numeros.length <= MAX_NUMEROS);
  assert.equal(l.numeros.length, 6);
  for (const n of l.numeros) {
    assert.ok(n.explicacao.oQueDiz && n.explicacao.comoCalcula && n.explicacao.dono, n.id);
    assert.ok(n.fonte && !/[a-z]+\.[a-z_]+/.test(n.fonte), `fonte sem nome de tabela: ${n.fonte}`);
    assert.ok(["todas", "rede", "grupo"].includes(n.cobertura));
    assert.ok(n.destino, `${n.id} sem destino`);
  }
  assert.equal(l.tema, "growth");
  assert.equal(l.universo, "15 unidades · 11 da rede regional (8 em operação) · 4 de operação própria");
  assert.equal(l.fontes.length, 5);
});

test("MRR vendido × meta: Goiânia e Construção Civil entram, implantação fica fora", () => {
  const l = montarGrowth(DADOS, UNIDADES, "", HOJE);
  const n = num(l, "mrr-vendido-meta");
  // 226.376,13 + 5.909,90 + 17.500 + 22.500 (São Bernardo e Recife em implantação ficam fora).
  assert.equal(n.estado, "disponivel");
  assert.equal(n.valor, 272286.03);
  assert.deepEqual(n.meta, { valor: 280000, rotulo: "meta T3/2026" });
  // Esperado = 280.000 × 90/92 = 273.913,04: abaixo do esperado, acima da metade → atenção.
  assert.equal(n.tom, "atencao");
  assert.match(n.explicacao.atencao, /São Bernardo/);
  assert.match(n.explicacao.atencao, /Consultoria/); // sem meta no Growth
  // Filtro "propria": Goiânia + Construção Civil.
  const p = num(montarGrowth(DADOS, UNIDADES, "propria", HOJE), "mrr-vendido-meta");
  assert.equal(p.valor, 232286.03);
  assert.equal(p.meta.valor, 210000);
  // Filtro "rede": Rio + Patos.
  const r = num(montarGrowth(DADOS, UNIDADES, "rede", HOJE), "mrr-vendido-meta");
  assert.equal(r.valor, 40000);
  assert.equal(r.meta.valor, 70000);
  // Uma unidade: Construção Civil, muito abaixo do ritmo.
  const cc = num(montarGrowth(DADOS, UNIDADES, "10", HOJE), "mrr-vendido-meta");
  assert.equal(cc.valor, 5909.9);
  assert.equal(cc.tom, "perigo");
});

test("unidade em implantação sozinha no filtro: desempenho não apurado, nunca zero", () => {
  const l = montarGrowth(DADOS, UNIDADES, "12", HOJE);
  for (const id of ["mrr-vendido-meta", "contratos-novos", "ticket-medio"]) {
    const n = num(l, id);
    assert.equal(n.estado, "nao_apurado", id);
    assert.equal(n.valor, null, id);
    assert.match(n.motivo, /implantação/);
  }
  assert.equal(l.graficos[0].estado, "nao_apurado");
  assert.equal(l.alertas.filter((a) => a.regra === "abaixo-do-ritmo").length, 0);
});

test("contratos e ticket: só Inside Sales até hoje, internas entram, implantação e sem cadastro ficam fora", () => {
  const l = montarGrowth(DADOS, UNIDADES, "", HOJE);
  const c = num(l, "contratos-novos");
  // T3 até 29/09: 1, 2, 3, 4 (Goiânia), 5 (Consultoria), 8, 13 = 7. Fora: 6 (implantação), 7 (sem cadastro), 9 (amanhã).
  assert.equal(c.valor, 7);
  assert.equal(c.estado, "disponivel");
  assert.deepEqual(c.tendencia.valores, [3, 2, 2]); // jul: 1, 2, 8 · ago: 4, 13 · set: 3, 5
  assert.match(c.explicacao.atencao, /1 contrato não casa/);
  const t = num(l, "ticket-medio");
  // (17.500 + 7.500 + 7.500 + 20.000 + 1.000 + 3.000 + 2.000) ÷ 7 = 58.500 ÷ 7 = 8.357,14.
  assert.equal(t.valor, 8357.14);
  // T2 inteiro: (4.000 + 6.000) ÷ 2 = 5.000.
  assert.equal(t.delta.valor, 3357.14);
  assert.equal(t.delta.rotulo, "vs T2/2026");
  // Filtro "propria": Goiânia (20.000) + Consultoria (1.000).
  const p = montarGrowth(DADOS, UNIDADES, "propria", HOJE);
  assert.equal(num(p, "contratos-novos").valor, 2);
  assert.equal(num(p, "ticket-medio").valor, 10500);
  // Filtro "rede": 1, 2, 3, 8, 13.
  assert.equal(num(montarGrowth(DADOS, UNIDADES, "rede", HOJE), "contratos-novos").valor, 5);
});

test("contratos lidos e zero no trimestre: 0 contratos, ticket não apurado", () => {
  const d = { ...DADOS, contratos: ok([{ id: 10, unidade: "Belém", ganho_em: "2026-05-10", mrr_mensal: 4000 }]) };
  const l = montarGrowth(d, UNIDADES, "", HOJE);
  assert.equal(num(l, "contratos-novos").valor, 0);
  assert.equal(num(l, "contratos-novos").estado, "disponivel");
  assert.equal(num(l, "ticket-medio").valor, null);
  assert.equal(num(l, "ticket-medio").estado, "nao_apurado");
});

test("mídia e custo por contrato: régua do Growth, cobertura do grupo, ignoram o filtro", () => {
  const l = montarGrowth(DADOS, UNIDADES, "", HOJE);
  const m = num(l, "midia-roas");
  // 228.719,64 + 256.102,48 + 301.099,98.
  assert.equal(m.valor, 785922.1);
  assert.equal(m.cobertura, "grupo");
  assert.deepEqual(m.meta, { valor: 770000, rotulo: "plano T3/2026" });
  // ROAS = 842.835,77 ÷ 785.922,10 = 1,072.
  assert.match(m.nota, /ROAS 1,07×/);
  assert.match(m.explicacao.atencao, /não se separa por unidade/);
  const c = num(l, "cac-midia");
  // 785.922,10 ÷ 176 vendas = 4.465,47; T2: 685.245,83 ÷ 83 = 8.255,97.
  assert.equal(c.valor, 4465.47);
  assert.equal(c.delta.valor, -3790.5);
  assert.equal(c.delta.sentido, "menor-melhor");
  assert.equal(c.cobertura, "grupo");
  // Com filtro "propria" o número do grupo é o mesmo (e diz isso), não "não apurado".
  const p = montarGrowth(DADOS, UNIDADES, "propria", HOJE);
  assert.equal(num(p, "midia-roas").valor, 785922.1);
  assert.equal(num(p, "cac-midia").valor, 4465.47);
  // Sem plano de um mês: sem meta ao lado (nunca soma parcial).
  const semPlano = montarGrowth({ ...DADOS, midia: ok({ serie: SERIE, planos: PLANOS.slice(0, 2) }) }, UNIDADES, "", HOJE);
  assert.equal(num(semPlano, "midia-roas").meta, undefined);
});

test("nenhum número de cobertura rede: não há o que zerar com filtro propria", () => {
  for (const f of ["", "rede", "propria"]) {
    const l = montarGrowth(DADOS, UNIDADES, f, HOJE);
    assert.equal(l.numeros.filter((n) => n.cobertura === "rede").length, 0, f);
  }
});

test("Broker: abertas = fila + reservadas; convertidas no trimestre; fila só com filtro da rede toda", () => {
  const l = montarGrowth(DADOS, UNIDADES, "", HOJE);
  const b = num(l, "broker");
  assert.equal(b.valor, 5); // 3 na fila + 2 reservadas
  assert.match(b.nota, /^1 convertida em contrato no T3\/2026$/);
  assert.deepEqual(b.dados.linhas.map((x) => x[1]), [3, 2, 1, 2]);
  // Rio (4): a reserva 4 e a compra 6; a fila não tem unidade e fica fora.
  const rio = num(montarGrowth(DADOS, UNIDADES, "4", HOJE), "broker");
  assert.equal(rio.valor, 1);
  assert.match(rio.nota, /^1 convertida/);
  // Operação própria: fonte lida, nenhuma reserva → zero de verdade.
  const p = num(montarGrowth(DADOS, UNIDADES, "propria", HOJE), "broker");
  assert.equal(p.valor, 0);
  assert.equal(p.estado, "disponivel");
});

test("alertas: ritmo abaixo de 50%, mídia sem contrato e Broker parado, com limiar e chave estável", () => {
  const l = montarGrowth(DADOS, UNIDADES, "", HOJE);
  const ritmo = l.alertas.filter((a) => a.regra === "abaixo-do-ritmo");
  // Construção Civil: 5.909,90 de 58.695,65 esperados (10%). Rio: 17.500 de 39.130,43 (45%).
  // Patos: 22.500 de 29.347,83 (77%) não entra; Recife (0 vendido) está em implantação.
  assert.deepEqual(ritmo.map((a) => a.unidade).sort(), ["Construção Civil", "Rio de Janeiro"]);
  const cc = ritmo.find((a) => a.unidade === "Construção Civil");
  assert.equal(cc.gravidade, "critico");
  assert.equal(cc.titulo, "Construção Civil · 10% do ritmo da meta do trimestre");
  assert.equal(cc.peso, 52786); // 58.695,65 − 5.909,90
  assert.equal(cc.chave, "coo:growth:abaixo-do-ritmo:construcao-civil:2026-t3");
  assert.match(cc.limiar, new RegExp(`${LIMIAR_RITMO * 100}% do ritmo esperado`));
  assert.ok(!ritmo.some((a) => a.unidade === "Recife" || a.unidade === "São Bernardo"));

  const midia = l.alertas.filter((a) => a.regra === "midia-sem-contrato");
  // Agosto: Curitiba, Patos e Rio pagaram mídia e não fecharam contrato; Belém fechou (13).
  assert.deepEqual(midia.map((a) => a.unidade).sort(), ["Curitiba", "Patos de Minas", "Rio de Janeiro"]);
  const cur = midia.find((a) => a.unidade === "Curitiba");
  assert.equal(cur.titulo, "Curitiba · R$ 20 mil de mídia em ago/2026 e nenhum contrato novo");
  assert.equal(cur.gravidade, "atencao");
  assert.equal(cur.chave, "coo:growth:midia-sem-contrato:curitiba:2026-08");
  assert.equal(cur.destino.rota, "/unidades/royalties");
  assert.equal(cur.destino.search.mes, "2026-08");

  const broker = l.alertas.filter((a) => a.regra.startsWith("broker"));
  assert.deepEqual(
    broker.map((a) => a.titulo).sort(),
    [
      "Broker · 1 oportunidade parada na fila há mais de 15 dias",
      "Rio de Janeiro · reserva no Broker parada há 26 dias",
    ],
  );
  assert.match(broker[0].limiar, new RegExp(`mais de ${DIAS_BROKER_PARADA} dias`));

  // Ordem: críticos primeiro, e dentro deles o maior peso.
  assert.equal(l.alertas[0].unidade, "Construção Civil");
  assert.equal(l.alertas[1].unidade, "Rio de Janeiro");
});

test("alerta de ritmo cala nos primeiros 14 dias do trimestre", () => {
  const metasT4 = [{ unidade: "Rio de Janeiro", quarter: "2026-T4", meta: 30000, vendido: 0 }];
  const d = { ...DADOS, metas: ok(metasT4) };
  const cedo = montarGrowth(d, UNIDADES, "", "2026-10-10");
  assert.equal(cedo.alertas.filter((a) => a.regra === "abaixo-do-ritmo").length, 0);
  assert.ok(cedo.avisos.some((a) => /só dispara a partir do 15º dia/.test(a)));
  const depois = montarGrowth(d, UNIDADES, "", "2026-10-20");
  assert.equal(depois.alertas.filter((a) => a.regra === "abaixo-do-ritmo").length, 1);
});

test("gráfico: meta × vendido por unidade em operação, da mais atrasada para a mais adiantada", () => {
  const g = montarGrowth(DADOS, UNIDADES, "", HOJE).graficos;
  assert.equal(g.length, 1);
  assert.equal(g[0].tipo, "barras-h");
  assert.equal(g[0].titulo, "Quanto cada unidade já vendeu da meta do trimestre?");
  // % da meta: CC 9,8% · Rio 43,8% · Patos 75% · Goiânia 150,9%.
  assert.deepEqual(
    g[0].pontos.map((p) => p.rotulo),
    ["Construção Civil", "Rio de Janeiro", "Patos de Minas", "Goiânia"],
  );
  assert.deepEqual(g[0].pontos[0], { rotulo: "Construção Civil", meta: 60000, vendido: 5909.9 });
});

test("fonte fora ou sem acesso: estado próprio, valor nulo, nada vira zero, e as outras fontes seguem", () => {
  const d = {
    ...DADOS,
    metas: { ok: false, estado: "acesso_insuficiente", motivo: "a meta por unidade do Growth é lida só pela diretoria e pelo comercial do Growth" },
    contratos: { ok: false, estado: "fonte_indisponivel", motivo: "a consulta de contratos do Inside Sales falhou (código 57014)" },
    broker: { ok: false, estado: "acesso_insuficiente", motivo: "sem view.broker_admin" },
  };
  const l = montarGrowth(d, UNIDADES, "", HOJE);
  assert.equal(num(l, "mrr-vendido-meta").estado, "acesso_insuficiente");
  assert.equal(num(l, "mrr-vendido-meta").valor, null);
  assert.equal(num(l, "contratos-novos").estado, "fonte_indisponivel");
  assert.equal(num(l, "contratos-novos").valor, null);
  assert.equal(num(l, "ticket-medio").valor, null);
  assert.equal(num(l, "broker").estado, "acesso_insuficiente");
  assert.equal(num(l, "broker").valor, null);
  assert.equal(l.graficos[0].estado, "acesso_insuficiente");
  // Sem metas não há alerta de ritmo; sem contratos não há "mídia sem contrato" (seria falso); sem Broker, nada do Broker.
  assert.equal(l.alertas.length, 0);
  // A mídia do Growth segue de pé.
  assert.equal(num(l, "midia-roas").valor, 785922.1);
  assert.equal(l.fontes.find((f) => f.fonte === "Broker da Expansão").atualizadoEm, null);
});

test("Growth sem meta para o trimestre: não apurado, não R$ 0", () => {
  const d = { ...DADOS, metas: ok([{ unidade: "Belém", quarter: "2026-T2", meta: 60000, vendido: 0 }]) };
  const n = num(montarGrowth(d, UNIDADES, "", HOJE), "mrr-vendido-meta");
  assert.equal(n.estado, "nao_apurado");
  assert.equal(n.valor, null);
  const semSerie = montarGrowth({ ...DADOS, midia: ok({ serie: SERIE.slice(0, 3), planos: [] }) }, UNIDADES, "", HOJE);
  assert.equal(num(semSerie, "midia-roas").estado, "nao_apurado");
  assert.equal(num(semSerie, "cac-midia").valor, null);
});

test("avisos: implantação e meta do Growth sem unidade no cadastro", () => {
  const l = montarGrowth(DADOS, UNIDADES, "", HOJE);
  assert.ok(l.avisos.some((a) => /Recife, São Bernardo, Sorocaba estão em implantação/.test(a)));
  assert.ok(l.avisos.some((a) => /sem unidade no cadastro, fora da leitura: Itaúna/.test(a)));
  // Filtro da operação própria: nenhuma unidade em implantação, nenhum aviso de implantação.
  const p = montarGrowth(DADOS, UNIDADES, "propria", HOJE);
  assert.ok(!p.avisos.some((a) => /implantação/.test(a)));
});
