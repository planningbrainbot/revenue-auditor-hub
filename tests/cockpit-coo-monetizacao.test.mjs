// Tema Qui · Monetização do Cockpit do COO: régua de engajamento por unidade e alertas de cobrança.
// Importa só o arquivo puro. Os valores esperados estão calculados à mão nos comentários.
import test from "node:test";
import assert from "node:assert/strict";
import { MAX_NUMEROS, ordenarAlertas } from "../src/lib/cockpit-coo/contrato.ts";
import { lerUnidades } from "../src/lib/cockpit-coo/unidades.ts";
import {
  REGUA,
  baseDoFiltro,
  caiuDeFaixa,
  coorteDaUnidade,
  dadosSemCarga,
  faixa,
  faixaDaNota,
  inicioDaLeitura,
  janelaDaCoorte,
  montarMonetizacao,
  notaEngajamento,
} from "../src/lib/cockpit-coo/temas/monetizacao.ts";

const HOJE = "2026-09-29";

// Cadastro de 29/09/2026 (ops.unidades).
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

// ── Fixture ─────────────────────────────────────────────────────────────
// Coorte madura em 29/09: primeiro trabalho entre 30/08 e 22/09. Há 7 dias (ref 22/09): 23/08 a 15/09.
let seq = 0;
const neg = (unidade_ids, ev = {}) => ({
  id: ++seq,
  unidade_ids,
  started: ev.started ?? [],
  scheduled: ev.scheduled ?? [],
  meeting: ev.meeting ?? [],
  validated: ev.validated ?? [],
  signed: ev.signed ?? [],
});
const varios = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

const GRUPOS = [
  { unidade_ids: [7], elegiveis: 98, comContato: 88, trabalhadas: 10 },
  // Conta de duas unidades: entra em Fortaleza e em Maceió, e uma vez só no total do filtro.
  { unidade_ids: [7, 8], elegiveis: 2, comContato: 2, trabalhadas: 1 },
  { unidade_ids: [8], elegiveis: 288, comContato: 264, trabalhadas: 11 },
  { unidade_ids: [6], elegiveis: 134, comContato: 11, trabalhadas: 8 },
  { unidade_ids: [4], elegiveis: 100, comContato: 25, trabalhadas: 10 },
  { unidade_ids: [5], elegiveis: 20, comContato: 20, trabalhadas: 5 },
  { unidade_ids: [13], elegiveis: 261, comContato: 259, trabalhadas: 1 },
  { unidade_ids: [12], elegiveis: 10, comContato: 10, trabalhadas: 5 },
  { unidade_ids: [9], elegiveis: 236, comContato: 127, trabalhadas: 6 },
  { unidade_ids: [10], elegiveis: 14, comContato: 7, trabalhadas: 9 },
  // Contas sem unidade: não entram em unidade nenhuma.
  { unidade_ids: [], elegiveis: 147, comContato: 96, trabalhadas: 29 },
];

const NEGOCIOS = [
  // Fortaleza: 6 leads (10/09), 3 com reunião e validados; F1 ganho em 26/09.
  // A = 90/100 = 90; B = (3/6)/0,5 = 100; C = (3/6)/0,4 = 125 → 100.
  // Nota = (25·90 + 35·100 + 20·100)/80 = 7750/80 = 96,875 → 97 (engajada). Há 7 dias: igual.
  ...varios(6, (i) =>
    neg([7], {
      started: ["2026-09-10"],
      scheduled: i < 3 ? ["2026-09-12"] : [],
      validated: i < 3 ? ["2026-09-15"] : [],
      signed: i === 0 ? ["2026-09-26"] : [],
    }),
  ),
  // Maceió: 6 leads, 4 com reunião (realizada) e validados. A = 266/290 = 91,72.
  // Nota = (25·91,72 + 3500 + 2000)/80 = 97,41 → 97 (engajada).
  ...varios(6, (i) =>
    neg([8], {
      started: ["2026-09-10"],
      meeting: i < 4 ? ["2026-09-12"] : [],
      validated: i < 4 ? ["2026-09-14"] : [],
    }),
  ),
  // São Luis: 5 leads (20/09, fora da coorte de 7 dias atrás), 1 reunião e 1 validado; ganho em 25/09.
  // A = 11/134 = 8,21; B = (1/5)/0,5 = 40; C = (1/5)/0,4 = 50.
  // Nota = (205,2 + 1400 + 1000)/80 = 32,57 → 33 (parada).
  ...varios(5, (i) =>
    neg([6], {
      started: ["2026-09-20"],
      scheduled: i === 0 ? ["2026-09-21"] : [],
      validated: i === 0 ? ["2026-09-22"] : [],
      signed: i === 0 ? ["2026-09-25"] : [],
    }),
  ),
  // Rio: R1–R5 (25/08) só na coorte de 7 dias atrás: 3 reuniões, 2 validados (10/09).
  // Há 7 dias: A = 25; B = (3/5)/0,5 = 120 → 100; C = (2/5)/0,4 = 100 → 6125/80 = 76,56 → 77 (engajada).
  // R6–R15 (18/09) só na coorte de hoje: 4 reuniões, 4 validados (21/09).
  // Hoje: B = (4/10)/0,5 = 80; C = (4/10)/0,4 = 100 → (625 + 2800 + 2000)/80 = 67,81 → 68 (morna).
  // R1 foi ganho em 31/08: fora do mês.
  ...varios(5, (i) =>
    neg([4], {
      started: ["2026-08-25"],
      scheduled: i < 3 ? ["2026-09-01"] : [],
      validated: i < 2 ? ["2026-09-10"] : [],
      signed: i === 0 ? ["2026-08-31"] : [],
    }),
  ),
  ...varios(10, (i) =>
    neg([4], {
      started: ["2026-09-18"],
      meeting: i < 4 ? ["2026-09-20"] : [],
      validated: i < 4 ? ["2026-09-21"] : [],
    }),
  ),
  // Campo Novo: 5 leads e nenhuma reunião. A = 100 → nota = 2500/80 = 31,25 → 31 (parada).
  ...varios(5, () => neg([5], { started: ["2026-09-15"] })),
  // São Bernardo (em implantação): 6 leads e nenhuma reunião → 31, mas fora de desempenho e sem alerta de unidade.
  ...varios(6, () => neg([12], { started: ["2026-09-15"] })),
  // Goiânia: 1 lead maduro → sem amostra.
  neg([9], { started: ["2026-09-10"] }),
  // Construção Civil: 7 leads, 3 reuniões, 2 validados. A = 50; B = (3/7)/0,5 = 85,71; C = (2/7)/0,4 = 71,43.
  // Nota = (1250 + 3000 + 1428,57)/80 = 70,98 → 71 (engajada).
  ...varios(7, (i) =>
    neg([10], {
      started: ["2026-09-05"],
      scheduled: i < 3 ? ["2026-09-07"] : [],
      validated: i < 2 ? ["2026-09-08"] : [],
    }),
  ),
  // Negócio de Fortaleza e Maceió, trabalhado em julho (fora da coorte), validado e ganho em setembro.
  neg([7, 8], { started: ["2026-07-01"], validated: ["2026-09-02"], signed: ["2026-09-28"] }),
  // Sem unidade: 3 leads maduros; um validado e ganho no mês.
  ...varios(3, (i) =>
    neg([], {
      started: ["2026-09-10"],
      validated: i === 0 ? ["2026-09-15"] : [],
      signed: i === 0 ? ["2026-09-20"] : [],
    }),
  ),
];

const DADOS = {
  base: { ok: true, grupos: GRUPOS, atualizadoEm: "2026-09-29T15:05:00Z", parada: null },
  negocios: { ok: true, lista: NEGOCIOS, atualizadoEm: "2026-09-29T15:05:07Z", parada: null },
};

const numero = (l, id) => l.numeros.find((n) => n.id === id);

// ── A régua ─────────────────────────────────────────────────────────────

test("régua: nota com os pesos 25/35/20 reescalada para 80, alvos de 50% e 40%", () => {
  // A = 80; B = (4/10)/0,5 = 80; C = (2/10)/0,4 = 50 → (2000 + 2800 + 1000)/80 = 72,5 → 73.
  const n = notaEngajamento({ elegiveis: 100, comContato: 80 }, { leads: 10, comReuniao: 4, validadas: 2 });
  assert.equal(n.A, 80);
  assert.equal(n.B, 80);
  assert.equal(n.C, 50);
  assert.equal(n.nota, 73);
  // Teto de 100 em B e C: 80% de reunião e 60% de validação valem 100.
  const t = notaEngajamento({ elegiveis: 10, comContato: 10 }, { leads: 10, comReuniao: 8, validadas: 6 });
  assert.equal(t.B, 100);
  assert.equal(t.C, 100);
  assert.equal(t.nota, 100);
  // Caso São Luís medido pela pesquisa: 11 de 134 com contato, 5 leads, 1 reunião, 1 validado → 33.
  assert.equal(
    notaEngajamento({ elegiveis: 134, comContato: 11 }, { leads: 5, comReuniao: 1, validadas: 1 }).nota,
    33,
  );
});

test("régua: sem amostra abaixo de 5 leads, sem base sem elegíveis; faixa pela nota arredondada", () => {
  const coorte4 = { leads: 4, comReuniao: 4, validadas: 4 };
  assert.equal(notaEngajamento({ elegiveis: 100, comContato: 100 }, coorte4), null);
  assert.equal(faixa({ elegiveis: 100 }, coorte4, null), "sem_amostra");
  const coorte5 = { leads: 5, comReuniao: 0, validadas: 0 };
  assert.equal(notaEngajamento({ elegiveis: 0, comContato: 0 }, coorte5), null);
  // Sem base vence sem amostra.
  assert.equal(faixa({ elegiveis: 0 }, coorte5, null), "sem_base");
  assert.equal(faixaDaNota(70), "engajada");
  assert.equal(faixaDaNota(69), "morna");
  assert.equal(faixaDaNota(40), "morna");
  assert.equal(faixaDaNota(39), "parada");
  // A = 71; B = 80; C = 50 → (1775 + 2800 + 1000)/80 = 69,69: a tela mostra 70, e a faixa é a do 70.
  const n = notaEngajamento({ elegiveis: 100, comContato: 71 }, { leads: 10, comReuniao: 4, validadas: 2 });
  assert.equal(n.nota, 70);
  assert.equal(faixa({ elegiveis: 100 }, { leads: 10 }, n), "engajada");
});

test("coorte madura: primeiro trabalho entre D-30 e D-7, eventos até a data de referência", () => {
  assert.deepEqual(janelaDaCoorte(HOJE), { de: "2026-08-30", ate: "2026-09-22" });
  assert.deepEqual(janelaDaCoorte("2026-09-22"), { de: "2026-08-23", ate: "2026-09-15" });
  const l = [
    neg([1], { started: ["2026-09-01"], scheduled: ["2026-09-03"] }), // dentro, com reunião
    neg([1], { started: ["2026-09-23"] }), // recente demais
    neg([1], { started: ["2026-08-29"] }), // antigo demais
    neg([1], { started: ["2026-09-10", "2026-08-20"] }), // vale o PRIMEIRO trabalho: 20/08, fora
    neg([1, 2], { started: ["2026-08-30"], meeting: ["2026-09-05"], validated: ["2026-09-10"] }), // borda, duas unidades
    neg([1], { started: ["2026-09-22"], validated: ["2026-09-30"] }), // borda; validação depois de hoje não conta
    neg([], { started: ["2026-09-05"] }), // sem unidade
  ];
  assert.deepEqual(coorteDaUnidade(l, 1, HOJE), { leads: 3, comReuniao: 2, validadas: 1 });
  assert.deepEqual(coorteDaUnidade(l, 2, HOJE), { leads: 1, comReuniao: 1, validadas: 1 });
  assert.deepEqual(coorteDaUnidade(l, null, HOJE), { leads: 1, comReuniao: 0, validadas: 0 });
  // Há 7 dias (ref 22/09, janela 23/08–15/09): entram o 1º, o 3º (29/08) e o 5º.
  assert.deepEqual(coorteDaUnidade(l, 1, "2026-09-22"), { leads: 3, comReuniao: 2, validadas: 1 });
});

test("queda de faixa só compara duas notas; início da leitura cobre a coorte de 7 dias atrás e o mês", () => {
  assert.equal(caiuDeFaixa("morna", "engajada"), true);
  assert.equal(caiuDeFaixa("parada", "morna"), true);
  assert.equal(caiuDeFaixa("engajada", "morna"), false);
  assert.equal(caiuDeFaixa("sem_amostra", "engajada"), false);
  assert.equal(caiuDeFaixa("parada", "sem_amostra"), false);
  assert.equal(inicioDaLeitura(HOJE), "2026-08-23");
  // Em 03/10 a coorte de 7 dias atrás começa em 27/08, antes do dia 1º.
  assert.equal(inicioDaLeitura("2026-10-03"), "2026-08-27");
});

test("base do filtro: conta de duas unidades entra uma vez", () => {
  // Fortaleza + Maceió: 98 + 2 + 288 = 388 (somar por unidade daria 390).
  assert.equal(baseDoFiltro(GRUPOS, new Set([7, 8])).elegiveis, 388);
  assert.equal(baseDoFiltro(GRUPOS, new Set([7, 8])).trabalhadas, 22);
});

// ── O tema montado ──────────────────────────────────────────────────────

test("todas as unidades: seis números, Goiânia e internas no perímetro, implantação fora do desempenho", () => {
  const l = montarMonetizacao(DADOS, UNIDADES, "", HOJE);
  assert.equal(l.tema, "monetizacao");
  assert.equal(l.numeros.length, MAX_NUMEROS);
  assert.equal(l.universo, "15 unidades · 11 da rede regional (8 em operação) · 4 de operação própria");

  // Com amostra e em operação: Fortaleza 97, Maceió 97, Construção Civil 71 (engajadas), Rio 68 (morna),
  // São Luis 33 e Campo Novo 31 (paradas). São Bernardo tem nota (31), mas está em implantação.
  const eng = numero(l, "unidades-engajadas");
  assert.equal(eng.estado, "disponivel");
  assert.equal(eng.valor, 3);
  assert.equal(eng.nota, "de 6 unidades com amostra");
  const par = numero(l, "unidades-paradas");
  assert.equal(par.valor, 2);
  assert.equal(par.nota, "São Luis, Campo Novo");
  assert.equal(par.tom, "perigo");

  // Ganhos no mês: São Luis, Fortaleza e o negócio de Fortaleza + Maceió (uma vez) = 3; o sem unidade fica fora.
  const ganhos = numero(l, "contratos-ganhos-mes");
  assert.equal(ganhos.valor, 3);
  assert.equal(ganhos.nota, "1 negócio sem unidade ficou de fora");
  // Validadas em setembro: Fortaleza 3 + Maceió 4 + São Luis 1 + Rio 2 + 4 + Construção Civil 2 + o duplo 1 = 17.
  assert.equal(numero(l, "oportunidades-validadas-mes").valor, 17);

  // Cobertura sem contar duas vezes: 66 com negócio ÷ 1.163 elegíveis = 5,675 → 5,7.
  const cob = numero(l, "cobertura-base");
  assert.equal(cob.valor, 5.7);
  assert.equal(cob.nota, "66 de 1.163 elegíveis com negócio");

  // Leads maduros: 6 + 6 + 5 + 10 + 5 + 6 + 1 + 7 + 3 = 49; 3 sem unidade.
  const sem = numero(l, "leads-sem-unidade");
  assert.equal(sem.valor, 3);
  assert.equal(sem.nota, "de 49 leads maduros no pipe");

  for (const n of l.numeros) {
    assert.ok(n.explicacao.oQueDiz && n.explicacao.comoCalcula && n.explicacao.dono, n.id);
    assert.ok(n.fonte && !/ops\.|monetizacao_/.test(n.fonte), `fonte legível em ${n.id}`);
    assert.equal(n.destino.rota, "/monetizacao");
    assert.equal(n.destino.mesmoRecorte, false);
    assert.equal(n.dataDado !== null, true);
  }
  assert.ok(l.avisos.some((a) => a.includes("Parte D")));
  assert.ok(numero(l, "unidades-engajadas").explicacao.atencao.includes("(25A + 35B + 20C) ÷ 80"));
});

test("gráfico: nota por unidade com a faixa, maior nota primeiro e sem nota no fim", () => {
  const [g] = montarMonetizacao(DADOS, UNIDADES, "", HOJE).graficos;
  assert.equal(g.titulo, "Quais unidades estão mais engajadas no projeto?");
  assert.equal(g.tipo, "barras-h");
  assert.equal(g.pontos.length, 15);
  assert.deepEqual(
    g.pontos.slice(0, 7).map((p) => [p.rotulo, p.nota, p.faixa]),
    [
      // Empate em 97: a maior base elegível primeiro (Maceió 290 × Fortaleza 100).
      ["Maceió", 97, "engajada"],
      ["Fortaleza", 97, "engajada"],
      ["Construção Civil", 71, "engajada"],
      ["Rio de Janeiro", 68, "morna"],
      ["São Luis", 33, "parada"],
      ["Campo Novo", 31, "parada"],
      ["São Bernardo", 31, "parada · em implantação"],
    ],
  );
  const semNota = g.pontos.slice(7);
  assert.ok(semNota.every((p) => p.nota === null));
  assert.deepEqual(semNota.slice(0, 2).map((p) => [p.rotulo, p.faixa]), [
    ["Recife", "sem amostra · em implantação"],
    ["Goiânia", "sem amostra"],
  ]);
  assert.equal(semNota.find((p) => p.rotulo === "São Paulo").faixa, "sem base");
  assert.equal(semNota.find((p) => p.rotulo === "Sorocaba").faixa, "sem base · em implantação");
});

test("alertas: cobrar a unidade (parada, sem reunião, caiu) e cobrar a matriz, um de cada por unidade", () => {
  const l = montarMonetizacao(DADOS, UNIDADES, "", HOJE);
  const ordem = ordenarAlertas(l.alertas);
  assert.deepEqual(
    ordem.map((a) => [a.gravidade, a.titulo]),
    [
      ["critico", "São Luis · unidade parada: nota 33"],
      // Campo Novo também é parada; a regra mais específica vence e não vira duas tarefas.
      ["critico", "Campo Novo · 5 leads maduros e nenhuma reunião"],
      ["atencao", "Rio de Janeiro · caiu de engajada para morna: nota 68 (era 77)"],
      // Maceió é engajada, mas só 12 de 290 elegíveis têm negócio (4,1%): cobrar a matriz.
      ["atencao", "Maceió · matriz com cobertura baixa: 4,1% dos 290 elegíveis com negócio"],
      ["atencao", "Recife · matriz sem trabalho: 261 elegíveis, nenhum lead maduro"],
      ["atencao", "Goiânia · matriz sem trabalho: 236 elegíveis, 1 lead maduro"],
    ],
  );
  const saoLuis = ordem[0];
  assert.equal(saoLuis.chave, "coo:monetizacao:unidade-parada:sao-luis:2026-09");
  assert.equal(saoLuis.unidade, "São Luis");
  assert.match(saoLuis.limiar, /abaixo de 40/);
  assert.equal(saoLuis.destino.search.aba, "funil");
  const recife = ordem.find((a) => a.unidade === "Recife");
  assert.equal(recife.regra, "matriz-sem-trabalho");
  assert.match(recife.limiar, /50 ou mais contas elegíveis e menos de 5 leads maduros/);
  assert.equal(recife.destino.search.aba, "capacidade");
  // São Bernardo (em implantação) tem 6 leads e nenhuma reunião, mas não recebe alerta de unidade.
  assert.equal(l.alertas.some((a) => a.unidade === "São Bernardo"), false);
});

test("filtro: rede tira Goiânia; própria só as internas; uma unidade em implantação não tem desempenho", () => {
  const rede = montarMonetizacao(DADOS, UNIDADES, "rede", HOJE);
  assert.equal(rede.graficos[0].pontos.some((p) => p.rotulo === "Goiânia"), false);
  assert.equal(rede.alertas.some((a) => a.unidade === "Goiânia"), false);
  // Rede: 98 + 2 + 288 + 134 + 100 + 20 + 261 + 10 = 913 elegíveis; 51 com negócio → 5,59 → 5,6.
  assert.equal(numero(rede, "cobertura-base").valor, 5.6);
  // Construção Civil é própria: fora das engajadas da rede.
  assert.equal(numero(rede, "unidades-engajadas").valor, 2);

  const propria = montarMonetizacao(DADOS, UNIDADES, "propria", HOJE);
  assert.deepEqual(
    propria.graficos[0].pontos.map((p) => p.rotulo),
    ["Construção Civil", "Goiânia", "Consultoria", "São Paulo"],
  );
  assert.equal(numero(propria, "unidades-engajadas").valor, 1);
  assert.equal(numero(propria, "unidades-paradas").valor, 0);
  assert.equal(numero(propria, "unidades-paradas").tom, "sucesso");
  // Ganho lido e zero é zero (a fonte respondeu); o sem unidade é avisado na nota.
  assert.equal(numero(propria, "contratos-ganhos-mes").valor, 0);
  assert.equal(numero(propria, "contratos-ganhos-mes").estado, "disponivel");
  // Goiânia 236 + Construção Civil 14 = 250; 15 com negócio → 6,0.
  assert.equal(numero(propria, "cobertura-base").valor, 6);
  assert.deepEqual(propria.alertas.map((a) => a.unidade), ["Goiânia"]);

  const recife = montarMonetizacao(DADOS, UNIDADES, "13", HOJE);
  assert.equal(recife.universo, "Recife · rede regional · em implantação");
  for (const id of ["unidades-engajadas", "unidades-paradas"]) {
    const n = numero(recife, id);
    assert.equal(n.valor, null);
    assert.equal(n.estado, "nao_apurado");
    assert.match(n.motivo, /em implantação/);
  }
  assert.deepEqual(recife.alertas.map((a) => a.regra), ["matriz-sem-trabalho"]);
});

test("ausência não é zero: carga negada, negócios fora, nenhuma amostra, carga parada", () => {
  const negado = montarMonetizacao(
    dadosSemCarga("acesso_insuficiente", "Seu acesso não inclui Clientes/Aquário ou Monetização."),
    UNIDADES,
    "",
    HOJE,
  );
  assert.equal(negado.numeros.length, MAX_NUMEROS);
  for (const n of negado.numeros) {
    assert.equal(n.valor, null, n.id);
    assert.equal(n.estado, "acesso_insuficiente", n.id);
  }
  assert.equal(negado.graficos[0].estado, "acesso_insuficiente");
  assert.deepEqual(negado.graficos[0].pontos, []);
  assert.deepEqual(negado.alertas, []);

  // Base lida, negócios fora: nada que dependa dos negócios vira zero.
  const semNegocios = montarMonetizacao(
    {
      base: { ...DADOS.base, grupos: GRUPOS.map((g) => ({ ...g, trabalhadas: null })) },
      negocios: { ok: false, estado: "fonte_indisponivel", motivo: "O CRM ainda não teve uma carga concluída." },
    },
    UNIDADES,
    "",
    HOJE,
  );
  for (const n of semNegocios.numeros) {
    assert.equal(n.valor, null, n.id);
    assert.equal(n.estado, "fonte_indisponivel", n.id);
  }
  assert.deepEqual(semNegocios.alertas, []);

  // Negócios lidos e vazios: sem amostra é "não apurado"; ganhos lidos são zero de verdade.
  const vazio = montarMonetizacao(
    { base: DADOS.base, negocios: { ...DADOS.negocios, lista: [] } },
    UNIDADES,
    "",
    HOJE,
  );
  assert.equal(numero(vazio, "unidades-engajadas").estado, "nao_apurado");
  assert.equal(numero(vazio, "unidades-engajadas").valor, null);
  assert.equal(numero(vazio, "contratos-ganhos-mes").valor, 0);
  assert.equal(numero(vazio, "leads-sem-unidade").valor, 0);

  // Filtro sem elegíveis (Sorocaba): cobertura não apurada, não 0%.
  const sorocaba = montarMonetizacao(DADOS, UNIDADES, "14", HOJE);
  assert.equal(numero(sorocaba, "cobertura-base").estado, "nao_apurado");
  assert.equal(numero(sorocaba, "cobertura-base").valor, null);

  // Carga do CRM parada: o número continua, marcado como parcial e com o motivo.
  const parada = montarMonetizacao(
    { base: DADOS.base, negocios: { ...DADOS.negocios, parada: "Indicadores do CRM parados desde 29/09 09:00." } },
    UNIDADES,
    "",
    HOJE,
  );
  const eng = numero(parada, "unidades-engajadas");
  assert.equal(eng.valor, 3);
  assert.equal(eng.estado, "parcial");
  assert.match(eng.motivo, /parados desde/);
  assert.equal(numero(parada, "contratos-ganhos-mes").estado, "parcial");
});

test("os limiares da régua são os aprovados pelo COO em 29/09", () => {
  assert.deepEqual(REGUA.pesos, { A: 25, B: 35, C: 20, D: 20 });
  assert.equal(REGUA.amostraMinima, 5);
  assert.equal(REGUA.engajada, 70);
  assert.equal(REGUA.morna, 40);
  assert.equal(REGUA.matrizElegiveis, 50);
  assert.equal(REGUA.matrizLeads, 5);
  assert.equal(REGUA.coberturaMinima, 5);
});
