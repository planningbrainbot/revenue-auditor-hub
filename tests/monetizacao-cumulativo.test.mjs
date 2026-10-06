// Régua cumulativa da Operação e visão "Hoje" (spec 2026-10-01-monetizacao-acompanhamento-diario.md).
// A conferência contra a carga real fica em scripts/monetizacao/conferir-funil-cumulativo.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import {
  funilCumulativo,
  instante,
  linhaDa,
  reguaDoPipe,
} from "../src/lib/monetizacao/funil-cumulativo.ts";
import {
  conexaoPorUnidade,
  diaUtilAnterior,
  estoqueERitmo,
  eventosDoDia,
  listaDeAtencao,
  marcacaoDoMes,
  uteisDesde,
  USUARIO_OPS_PLANNING,
} from "../src/lib/monetizacao/acompanhamento.ts";
import { ehDiaUtil } from "../src/lib/monetizacao/feriados.ts";
import { metasOperacao, uteis } from "../src/lib/monetizacao/model.ts";

const M = 28381245;
// O pipe 39 depois da edição de 01/10, com a ordem da carga.
const ST = [
  { id: 274, name: "1 · Base elegível", order: 1 },
  { id: 276, name: "2 · Abordagem iniciada", order: 2 },
  { id: 290, name: "3 · Conexão", order: 3 },
  { id: 275, name: "Gatilho (encerrada em 01/10 · não usar)", order: 4 },
  { id: 277, name: "4 · Reunião de levantamento agendada", order: 5 },
  { id: 287, name: "5 · Reunião de levantamento realizada", order: 6 },
  { id: 279, name: "6 · Em negociação", order: 7 },
  { id: 291, name: "7 · Reunião de proposta", order: 8 },
  { id: 278, name: "8 · Proposta enviada", order: 9 },
  { id: 288, name: "9 · Stand by", order: 10 },
];
const SET = { from: "2026-09-01", to: "2026-09-30", owner: M, product: "" };
const TOTAL = { ...SET, owner: null };

// Data de São Paulo de um `at` UTC da carga.
const dataSp = (at) => new Date(instante(at) - 3 * 3600_000).toISOString().slice(0, 10);
const ev = (at, actor = M, source = "stage_change") => ({
  at,
  date: dataSp(at),
  actor_id: actor,
  source,
});
const mv = (stage_id, at, actor = M) => ({ stage_id, at, date: dataSp(at), actor_id: actor });
let proximo = 1;
function card({
  id = proximo++,
  route = "cella",
  status = "open",
  moves = [],
  started,
  signed = [],
  meeting = [],
  lost_on = null,
  lost_by,
  owner_id = M,
  unidade_ids,
} = {}) {
  // `started` padrão: a primeira saída da Base, como a carga grava.
  const saida = moves.findIndex(
    (m, i) => i > 0 && moves[i - 1].stage_id === 274 && m.stage_id !== 274,
  );
  return {
    id,
    title: `Card ${id}`,
    route,
    status,
    stage_id: moves.at(-1)?.stage_id ?? 274,
    owner_id,
    moves,
    events: {
      loaded: [],
      started: started ?? (saida > 0 ? [ev(moves[saida].at, moves[saida].actor_id)] : []),
      scheduled: [],
      meeting,
      validated: [],
      signed,
    },
    lost_on,
    lost_by,
    unidade_ids,
  };
}
const contagens = (fc) => fc.linhas.map((l) => l.contagem);

test("Régua lê as etapas por nome e ordem: Gatilho vale Conexão, Stand by vale realizada", () => {
  const r = reguaDoPipe(ST);
  assert.deepEqual(r.nivelDe, {
    abordagem: 1,
    conexao: 2,
    agendada: 3,
    realizada: 4,
    negociacao: 5,
    reuniaoProposta: 6,
    propostaEnviada: 7,
  });
  assert.equal(r.ganho, 8);
  assert.equal(r.nivelDaEtapa.get(275), 2);
  assert.equal(r.nivelDaEtapa.get(288), 4);
  assert.deepEqual(r.semNivel, []);
  assert.deepEqual(
    r.niveis.map((n) => n.nome),
    [
      "Base elegível",
      "Abordagem iniciada",
      "Conexão",
      "Reunião de levantamento agendada",
      "Reunião de levantamento realizada",
      "Em negociação",
      "Reunião de proposta",
      "Proposta enviada",
      "Ganho",
    ],
  );
  assert.deepEqual(r.niveis[2].somadas, [{ id: 275, nome: "Gatilho" }]);
  // A frente 01 põe Reunião de proposta antes de Em negociação: a régua acompanha, sem id fixo.
  const reordenado = reguaDoPipe(ST.map((s) => (s.id === 291 ? { ...s, order: 6.5 } : s)));
  assert.equal(reordenado.nivelDe.reuniaoProposta, 5);
  assert.equal(reordenado.nivelDe.negociacao, 6);
  // Pipe anterior a 01/10, sem Conexão: o Gatilho é etapa da sequência e faz o papel dela.
  const antigo = reguaDoPipe([
    { id: 1, name: "1 · Base elegível", order: 1 },
    { id: 2, name: "2 · Abordagem em curso", order: 2 },
    { id: 3, name: "3 · Gatilho identificado", order: 3 },
    { id: 4, name: "4 · Reunião agendada", order: 4 },
    { id: 5, name: "5 · Reunião realizada", order: 5 },
    { id: 8, name: "8 · Stand by", order: 8 },
  ]);
  assert.equal(antigo.nivelDe.conexao, 2);
  assert.equal(antigo.nivelDe.agendada, 3);
  assert.equal(antigo.nivelDaEtapa.get(8), 4);
});

test("Nível: a etapa conta se o card ficou 30 min, avançou dela ou terminou nela; toque desfeito não conta", () => {
  // Base → Abordagem → Conexão por 5 min → volta para Abordagem: não houve Conexão.
  const toque = card({
    moves: [
      mv(274, "2026-08-20 12:00:00"),
      mv(276, "2026-09-02 13:00:00"),
      mv(290, "2026-09-02 13:05:00"),
      mv(276, "2026-09-02 13:10:00"),
    ],
  });
  // Conexão por um minuto e avançou para a reunião, onde terminou.
  const avancou = card({
    moves: [
      mv(274, "2026-08-20 12:00:00"),
      mv(276, "2026-09-02 13:00:00"),
      mv(290, "2026-09-02 13:05:00"),
      mv(277, "2026-09-02 13:06:00"),
    ],
  });
  // Ficou uma hora na reunião agendada e voltou para Abordagem: a reunião conta.
  const voltou = card({
    moves: [
      mv(274, "2026-08-20 12:00:00"),
      mv(276, "2026-09-02 13:00:00"),
      mv(277, "2026-09-03 13:00:00"),
      mv(276, "2026-09-03 14:00:00"),
    ],
  });
  // Stand by vale reunião realizada; Gatilho (setembro) vale Conexão.
  const espera = card({
    moves: [
      mv(274, "2026-08-20 12:00:00"),
      mv(275, "2026-09-04 13:00:00"),
      mv(288, "2026-09-08 13:00:00"),
    ],
  });
  const fc = funilCumulativo([toque, avancou, voltou, espera], ST, SET);
  assert.equal(fc.nivelDoCard.get(toque.id), 1);
  assert.equal(fc.nivelDoCard.get(avancou.id), 3);
  assert.equal(fc.nivelDoCard.get(voltou.id), 3);
  assert.equal(fc.nivelDoCard.get(espera.id), 4);
  assert.deepEqual(contagens(fc), [4, 4, 3, 3, 1, 0, 0, 0, 0]);
});

test("Contagens só descem, validadas ≤ realizadas, e a taxa é a etapa ÷ a de cima", () => {
  const base = mv(274, "2026-08-20 12:00:00");
  const cards = [
    card({ moves: [base, mv(276, "2026-09-02 13:00:00")] }),
    card({ moves: [base, mv(276, "2026-09-02 13:00:00"), mv(290, "2026-09-03 13:00:00")] }),
    // pulou etapas: da Base direto para Em negociação conta em todas as de cima
    card({ moves: [base, mv(279, "2026-09-05 13:00:00")] }),
    card({
      moves: [base, mv(277, "2026-09-05 13:00:00"), mv(287, "2026-09-10 13:00:00")],
      signed: [ev("2026-09-20 13:00:00")],
    }),
  ];
  const fc = funilCumulativo(cards, ST, SET);
  assert.deepEqual(contagens(fc), [4, 4, 3, 2, 2, 2, 1, 1, 1]);
  const l = fc.linhas;
  for (let i = 2; i < l.length; i++) assert.ok(l[i].contagem <= l[i - 1].contagem);
  assert.ok(linhaDa(fc, "negociacao").contagem <= linhaDa(fc, "realizada").contagem);
  assert.equal(l[0].taxa, undefined);
  assert.equal(linhaDa(fc, "conexao").taxa, 3 / 4);
  assert.equal(linhaDa(fc, "agendada").taxa, 2 / 3);
  // etapa de cima vazia: sem taxa, não zero
  const vazio = funilCumulativo([], ST, SET);
  assert.equal(linhaDa(vazio, "abordagem").taxa, null);
});

test("Coorte é de quem tirou o card da Base; a fila compara instantes, não texto", () => {
  const base = mv(274, "2026-08-20 12:00:00");
  // Criado pela API do Ops direto em Gatilho (95196, 95211): fora do recorte do farmer, dentro do total.
  const api = card({
    moves: [mv(275, "2026-09-11 13:00:00", USUARIO_OPS_PLANNING)],
    started: [ev("2026-09-11 13:00:00", USUARIO_OPS_PLANNING, "created_in_stage")],
  });
  const dele = card({ moves: [base, mv(276, "2026-09-02 13:00:00")] });
  assert.equal(funilCumulativo([api, dele], ST, SET).coorte.length, 1);
  assert.equal(funilCumulativo([api, dele], ST, TOTAL).coorte.length, 2);
  // Saiu da Base às 04:00 UTC de 01/09 (01:00 em São Paulo): à meia-noite estava na Base, então é fila.
  // Comparado como texto, "2026-09-01 04:00:00" < "2026-09-01T03:00:00Z" e o card sumia da fila.
  const madrugada = card({ moves: [base, mv(276, "2026-09-01 04:00:00")] });
  // Saiu da Base em agosto e foi perdido em agosto: não é fila de setembro.
  const agosto = card({
    status: "lost",
    lost_on: "2026-08-25",
    moves: [base, mv(276, "2026-08-22 13:00:00")],
  });
  // Entrou na Base no meio do mês e ficou lá.
  const nova = card({ moves: [mv(274, "2026-09-15 13:00:00")] });
  const fc = funilCumulativo([madrugada, agosto, nova], ST, SET);
  assert.deepEqual(
    fc.fila.map((c) => c.id),
    [madrugada.id, nova.id],
  );
});

test("Ganho fora da coorte e perdidos de quem marcou ficam à parte da taxa", () => {
  const base = mv(274, "2026-07-20 12:00:00");
  const agosto = card({
    status: "won",
    moves: [base, mv(276, "2026-08-02 13:00:00"), mv(278, "2026-08-20 13:00:00")],
    signed: [ev("2026-09-10 13:00:00")],
  });
  const perdido = card({
    status: "lost",
    lost_on: "2026-09-12",
    lost_by: M,
    moves: [base, mv(276, "2026-09-02 13:00:00")],
  });
  const fc = funilCumulativo([agosto, perdido], ST, SET);
  assert.equal(linhaDa(fc, "ganho").contagem, 0);
  assert.deepEqual(
    fc.ganhosForaDaCoorte.map((c) => c.id),
    [agosto.id],
  );
  assert.deepEqual(
    fc.perdidos.map((c) => c.id),
    [perdido.id],
  );
});

test("Card abordado no mês anterior que avança no período vai para a nota, e contrato conta sempre", () => {
  const OUT = { from: "2026-10-01", to: "2026-10-06", owner: M, product: "" };
  const base = mv(274, "2026-09-29 14:40:00");
  // Tag (98025): abordada 30/09, agenda, realiza e valida em outubro; o toque do Ops não é do Matheus.
  const tag = card({
    moves: [
      base,
      mv(276, "2026-09-30 19:47:57"),
      mv(290, "2026-10-01 12:19:44"),
      mv(277, "2026-10-01 12:20:41"),
      mv(287, "2026-10-01 12:20:46"),
      mv(291, "2026-10-01 14:38:39"),
      mv(279, "2026-10-01 14:38:42"),
      mv(291, "2026-10-01 22:36:06", 23984402),
      mv(277, "2026-10-02 11:41:54"),
      mv(287, "2026-10-02 11:42:10"),
      mv(279, "2026-10-02 12:37:27"),
      mv(278, "2026-10-02 20:01:03"),
    ],
  });
  // Alves e Freitas (98022): validada em 30/09 e ganha em 05/10. Só o ganho é novo em outubro.
  const alves = card({
    status: "won",
    moves: [
      base,
      mv(277, "2026-09-30 12:20:28"),
      mv(279, "2026-09-30 20:22:32"),
      mv(291, "2026-10-01 13:28:36"),
      mv(278, "2026-10-01 13:28:56"),
    ],
    signed: [ev("2026-10-05 14:10:31")],
  });
  // Abordado em outubro: é coorte, não abordagem anterior.
  const novo = card({ moves: [mv(274, "2026-09-20 12:00:00"), mv(276, "2026-10-02 13:00:00")] });
  // Perdido em setembro: não avança em outubro.
  const perdido = card({
    status: "lost",
    lost_on: "2026-09-30",
    moves: [base, mv(276, "2026-09-30 13:00:00")],
  });
  const fc = funilCumulativo([tag, alves, novo, perdido], ST, OUT);
  assert.deepEqual(
    fc.coorte.map((c) => c.id),
    [novo.id],
  );
  const r = fc.regua;
  assert.deepEqual(
    fc.avancosAnteriores.map((a) => [a.card.id, a.de, a.ate]),
    [
      [tag.id, r.nivelDe.abordagem, r.nivelDe.propostaEnviada],
      [alves.id, r.nivelDe.negociacao, r.ganho],
    ],
  );
  const plan = { daily_target: 7, target_contracts: 8 };
  const q = Object.fromEntries(
    metasOperacao(fc, plan, OUT, "2026-10-06").quadros.map((x) => [x.chave, x]),
  );
  // A coorte não muda: o funil segue cumulativo.
  assert.equal(q.started.total, 1);
  assert.equal(q.meeting.valor, 0);
  assert.equal(q.validated.valor, 0);
  // A Tag entra à parte em agendados, realizados e validadas; a Alves e Freitas, que validou em setembro, não.
  assert.match(q.scheduled.nota, /\+1 de abordagem anterior$/);
  assert.match(q.meeting.nota, /\+1 de abordagem anterior$/);
  assert.match(q.validated.nota, /\+1 de abordagem anterior$/);
  assert.deepEqual(
    q.validated.cards.map((c) => c.id),
    [tag.id],
  );
  // Contrato conta todo ganho do período contra a meta.
  assert.equal(q.signed.valor, 1);
  assert.equal(q.signed.nota, "1 de abordagem anterior");
  assert.deepEqual(
    q.signed.cards.map((c) => c.id),
    [alves.id],
  );
});

test("Dias úteis pulam os feriados nacionais de 2026 e 2027", () => {
  assert.equal(uteis("2026-09-01", "2026-09-30"), 21); // 07/09
  assert.equal(uteis("2026-10-01", "2026-10-31"), 21); // 12/10
  assert.equal(uteis("2027-02-01", "2027-02-28"), 18); // Carnaval, ponto facultativo
  assert.equal(ehDiaUtil("2026-06-04"), false); // Corpus Christi
  assert.equal(ehDiaUtil("2026-10-13"), true);
  assert.equal(diaUtilAnterior("2026-10-13"), "2026-10-09"); // segunda 12/10 é feriado
  assert.equal(uteisDesde("2026-10-09", "2026-10-14"), 2);
});

test("Metas contam a coorte: validadas não passam de realizadas, e a meta de contrato é inteira", () => {
  const base = mv(274, "2026-08-20 12:00:00");
  const cards = [
    card({ moves: [base, mv(276, "2026-09-02 13:00:00")] }),
    card({ moves: [base, mv(277, "2026-09-03 13:00:00"), mv(287, "2026-09-04 13:00:00")] }),
    card({ moves: [base, mv(279, "2026-09-05 13:00:00")] }),
  ];
  const f = { ...SET, to: "2026-09-12" }; // 8 dias úteis: 07/09 é feriado
  const plan = { daily_target: 7, target_contracts: 8 };
  const { quadros, uteis: n } = metasOperacao(funilCumulativo(cards, ST, f), plan, f, "2026-09-24");
  assert.equal(n, 8);
  const q = Object.fromEntries(quadros.map((x) => [x.chave, x]));
  assert.equal(q.started.total, 3);
  assert.equal(q.started.valor, 0.4);
  assert.equal(q.started.status, "fora");
  assert.equal(q.meeting.valor, 2);
  assert.equal(q.validated.valor, 1);
  assert.ok(q.validated.valor <= q.meeting.valor);
  // setembro/2026 tem 21 dias úteis: ⌈8 × 8/21⌉ = 4
  assert.equal(q.signed.meta, 4);
  assert.ok(quadros.every((x) => Number.isInteger(x.total)));
  const hojeF = { ...SET, from: "2026-09-24", to: "2026-09-24" };
  const h = metasOperacao(funilCumulativo(cards, ST, hojeF), plan, hojeF, "2026-09-24");
  assert.equal(h.quadros[0].status, "dia-em-curso");
});

test("Hoje: abordagem do Ops não conta, toque desfeito não conta, e o realizado vem do evento", () => {
  const r = reguaDoPipe(ST);
  const base = mv(274, "2026-09-20 12:00:00");
  const f = { owner: null, product: "" };
  const dele = card({ moves: [base, mv(276, "2026-10-01 13:00:00")] });
  const ops = card({
    moves: [mv(276, "2026-10-01 13:00:00", USUARIO_OPS_PLANNING)],
    started: [ev("2026-10-01 13:00:00", USUARIO_OPS_PLANNING, "created_in_stage")],
  });
  const conexao = card({
    moves: [base, mv(276, "2026-09-29 13:00:00"), mv(290, "2026-10-01 14:00:00")],
  });
  const toque = card({
    moves: [
      base,
      mv(276, "2026-09-29 13:00:00"),
      mv(290, "2026-10-01 14:00:00"),
      mv(276, "2026-10-01 14:02:00"),
    ],
  });
  // 98025: entrou em Reunião de proposta e foi para Em negociação no mesmo minuto.
  const proposta = card({
    moves: [
      base,
      mv(279, "2026-09-30 13:00:00"),
      mv(291, "2026-10-01 15:00:00"),
      mv(279, "2026-10-01 15:00:30"),
    ],
  });
  const realizada = card({
    moves: [base, mv(277, "2026-09-30 13:00:00"), mv(287, "2026-10-01 16:00:00")],
    meeting: [ev("2026-10-01 16:00:00")],
  });
  const d = eventosDoDia([dele, ops, conexao, toque, proposta, realizada], r, "2026-10-01", f);
  assert.deepEqual(
    d.abordagens.map((c) => c.id),
    [dele.id],
  );
  assert.deepEqual(
    d.conexoes.map((c) => c.id),
    [conexao.id],
  );
  assert.equal(d.propostas.length, 0);
  assert.deepEqual(
    d.realizados.map((c) => c.id),
    [realizada.id],
  );
  assert.equal(
    eventosDoDia([dele], r, "2026-10-01", { owner: 1, product: "" }).abordagens.length,
    0,
  );
});

test("Mês até hoje: faltam para 50% é inteiro, metade dos abordados para cima menos os agendados", () => {
  const base = mv(274, "2026-09-20 12:00:00");
  const cards = [
    ...Array.from({ length: 20 }, () => card({ moves: [base, mv(276, "2026-10-01 13:00:00")] })),
    ...Array.from({ length: 5 }, () =>
      card({ moves: [base, mv(276, "2026-10-01 13:00:00"), mv(277, "2026-10-01 18:00:00")] }),
    ),
  ];
  const m = marcacaoDoMes(cards, ST, { owner: M, product: "" }, "2026-10-01");
  assert.equal(m.abordados, 25);
  assert.equal(m.agendados, 5);
  assert.equal(m.faltam, 8); // ⌈12,5⌉ − 5
  assert.equal(m.marcacao, 0.2);
  assert.equal(m.taxaLevantamento, 1);
});

test("Conexão por unidade: unidade da carga, sem inferir pelo dono; sem unidade vai por último", () => {
  const base = mv(274, "2026-09-20 12:00:00");
  const units = [
    { id: 1, name: "Curitiba" },
    { id: 9, name: "Goiânia" },
  ];
  const cards = [
    card({
      unidade_ids: [1],
      moves: [base, mv(276, "2026-10-01 13:00:00"), mv(290, "2026-10-01 18:00:00")],
    }),
    card({ unidade_ids: [1], moves: [base, mv(276, "2026-10-01 13:00:00")] }),
    card({ unidade_ids: [9, 1], moves: [base, mv(276, "2026-10-01 13:00:00")] }),
    card({ unidade_ids: [], moves: [base, mv(276, "2026-10-01 13:00:00")] }),
  ];
  const m = marcacaoDoMes(cards, ST, { owner: M, product: "" }, "2026-10-01");
  assert.deepEqual(
    conexaoPorUnidade(m, units).map((u) => [u.unidade, u.conexao.length, u.abordados.length]),
    [
      ["Curitiba", 1, 2],
      ["Curitiba / Goiânia", 0, 1],
      ["Sem unidade", 0, 1],
    ],
  );
  // a leitura não trouxe a unidade: não apurado, não "Sem unidade"
  const semColuna = cards.map((c) => ({ ...c, unidade_ids: undefined }));
  assert.equal(
    conexaoPorUnidade(marcacaoDoMes(semColuna, ST, { owner: M, product: "" }, "2026-10-01"), units),
    null,
  );
});

test("Estoque e ritmo: meta do plano ou 120 por closer, e quantas contas faltam", () => {
  const r = reguaDoPipe(ST);
  const naBase = Array.from({ length: 84 }, () =>
    card({ moves: [mv(274, "2026-09-25 12:00:00")] }),
  );
  const f = { owner: M, product: "" };
  const e = estoqueERitmo(naBase, r, f, undefined, 25, "2026-10-01");
  assert.equal(e.base.length, 84);
  assert.equal(e.uteisRestantes, 21);
  assert.equal(e.meta, 120);
  assert.equal(e.porDiaUtil, 5); // ⌈95 ÷ 21⌉
  assert.equal(e.faltamContas, 11);
  assert.equal(estoqueERitmo(naBase, r, f, { capacity: 100 }, 25, "2026-10-01").meta, 100);
  // a meta é da frente inteira: com filtro de produto não há ritmo nem cobertura
  const cella = estoqueERitmo(naBase, r, { ...f, product: "cella" }, undefined, 25, "2026-10-01");
  assert.equal(cella.meta, null);
  assert.equal(cella.porDiaUtil, null);
});

test("Lista de atenção: em Abordagem, sem nunca chegar à Conexão, abordado há 3 dias úteis ou mais", () => {
  const r = reguaDoPipe(ST);
  const base = mv(274, "2026-09-01 12:00:00");
  const f = { owner: M, product: "" };
  const units = [{ id: 3, name: "Belém" }];
  const velho = card({ unidade_ids: [3], moves: [base, mv(276, "2026-09-10 13:00:00")] });
  const recente = card({ moves: [base, mv(276, "2026-10-08 13:00:00")] }); // 09/10 e 13/10: 2 dias úteis
  const tresDias = card({ moves: [base, mv(276, "2026-10-07 13:00:00")] });
  // ficou em Gatilho em setembro e voltou para Abordagem na edição de 01/10: continua sem Conexão
  const gatilho = card({
    moves: [
      base,
      mv(276, "2026-09-15 13:00:00"),
      mv(275, "2026-09-16 13:00:00"),
      mv(276, "2026-10-01 12:00:00", 23984402),
    ],
  });
  // teve Conexão e voltou: sai da lista
  const respondeu = card({
    moves: [
      base,
      mv(276, "2026-09-15 13:00:00"),
      mv(290, "2026-10-01 13:00:00"),
      mv(276, "2026-10-02 13:00:00"),
    ],
  });
  const deOutro = card({ owner_id: 99, moves: [base, mv(276, "2026-09-10 13:00:00")] });
  const lista = listaDeAtencao(
    [velho, recente, tresDias, gatilho, respondeu, deOutro],
    r,
    f,
    units,
    "2026-10-13",
  );
  assert.deepEqual(
    lista.map((i) => [i.card.id, i.diasUteis, i.unidade]),
    [
      [velho.id, 22, "Belém"],
      [gatilho.id, 19, "Sem unidade"],
      [tresDias.id, 3, "Sem unidade"],
    ],
  );
  assert.equal(lista[0].abordadoEm, "2026-09-10");
});
