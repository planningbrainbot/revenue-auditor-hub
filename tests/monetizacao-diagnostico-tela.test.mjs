// Régua das telas da base nova (pipe 40): funil cumulativo da coorte, relógio do prazo, áreas, cadastro, Hoje, Ritmo,
// Aderência ao processo e Forecast, sobre cards de exemplo no formato da RPC ops.monetizacao_diagnostico_painel().
import test from "node:test";
import assert from "node:assert/strict";
import {
  aderenciaDiagnostico,
  areasDiagnostico,
  cadastroDiagnostico,
  forecastDiagnostico,
  funilDiagnostico,
  filaDiagnostico,
  funisPorUnidadeDiag,
  hojeDiagnostico,
  horizonteDe,
  normalizarPainelDiagnostico,
  quadrosDiagnostico,
  relogioDiagnostico,
  ritmoDiagnostico,
} from "../src/lib/monetizacao/diagnostico.ts";
import { validarBuscaMonetizacao } from "../src/components/monetizacao/busca.ts";

const M = 28381245,
  J = 24067177;
const ETAPAS = [293, 294, 296, 297, 298, 299, 300, 301].map((id, i) => ({
  id,
  name: `E${i + 1}`,
  order: i + 1,
  probabilidade: [10, 10, 10, 15, 25, 35, 50, 70][i],
  estagnacao: [2, 3, 7, 20, 5, 7, 5, 7][i],
}));
const card = (o) => ({
  id: o.id,
  title: o.title ?? `C${o.id}`,
  org: o.org ?? `Conta ${o.id}`,
  owner_id: M,
  status: "open",
  regime: "real",
  areas: {},
  produtos: [],
  atividades: [],
  unidade: "Belém",
  unidade_ids: [3],
  ...o,
});
const painel = normalizarPainelDiagnostico({
  sync: {
    status: "ok",
    measured_at: "2026-11-10T12:00:00Z",
    stages: ETAPAS,
    previa: {},
    resumo: {},
  },
  cards: [
    // entrou em 02/11, está na 02 há 8 dias (estagnação 3)
    card({
      id: 1,
      stage_id: 294,
      add_time: "2026-11-02 12:00:00",
      stage_since: "2026-11-02 13:00:00",
      moves: [
        { stage_id: 293, at: "2026-11-02 12:00:00" },
        { stage_id: 294, at: "2026-11-02 13:00:00", actor_id: M },
      ],
    }),
    // na 04 desde 15/10 (D0), Real: prazo 14/11 → faltam 4 dias = em risco; Consultoria entregue
    card({
      id: 2,
      stage_id: 297,
      add_time: "2026-10-05 12:00:00",
      stage_since: "2026-10-15 12:00:00",
      d0: "2026-10-15",
      prazo: "2026-11-14",
      link_pasta: "x",
      fat_conferido: 30000000,
      areas: { consultoria: "entregue" },
      moves: [
        { stage_id: 293, at: "2026-10-05 12:00:00" },
        { stage_id: 294, at: "2026-10-06 12:00:00", actor_id: M },
        { stage_id: 296, at: "2026-10-07 12:00:00", actor_id: M },
        { stage_id: 297, at: "2026-10-15 12:00:00", actor_id: M },
      ],
    }),
    // ganho em 08/11 com Consultoria R$ 50 mil
    card({
      id: 3,
      status: "won",
      stage_id: 301,
      won_time: "2026-11-08 12:00:00",
      add_time: "2026-11-01 12:00:00",
      d0: "2026-11-01",
      prazo: "2026-12-01",
      produtos: [
        {
          product_id: 61,
          produto: "consultoria",
          nome: "Diagnóstico · Consultoria",
          preco: 50000,
          quantidade: 1,
          total: 50000,
        },
      ],
      moves: [
        { stage_id: 293, at: "2026-11-01 12:00:00" },
        { stage_id: 300, at: "2026-11-05 12:00:00", actor_id: J },
        { stage_id: 301, at: "2026-11-06 12:00:00", actor_id: J },
      ],
    }),
    // perdido sem motivo
    card({
      id: 4,
      status: "lost",
      stage_id: 293,
      add_time: "2026-11-03 12:00:00",
      lost_time: "2026-11-04 12:00:00",
      moves: [{ stage_id: 293, at: "2026-11-03 12:00:00" }],
    }),
    // na 06, Presumido, R$ 100 mil de Finance, com tarefa da Jordana vencida
    card({
      id: 5,
      stage_id: 299,
      regime: "presumido",
      add_time: "2026-09-20 12:00:00",
      stage_since: "2026-11-08 12:00:00",
      d0: "2026-09-25",
      prazo: "2026-11-24",
      produtos: [
        {
          product_id: 62,
          produto: "finance",
          nome: "F",
          preco: 100000,
          quantidade: 1,
          total: 100000,
        },
      ],
      atividades: [
        {
          id: 9,
          subject: "Diagnóstico · 06 · Agendar a apresentação",
          user_id: J,
          due_date: "2026-11-09",
          done: false,
        },
        {
          id: 10,
          subject: "Diagnóstico · 05 · Ler",
          user_id: J,
          due_date: "2026-11-05",
          done: true,
          done_at: "2026-11-05 14:00:00",
        },
      ],
      moves: [
        { stage_id: 293, at: "2026-09-20 12:00:00" },
        { stage_id: 298, at: "2026-11-05 12:00:00", actor_id: M },
        { stage_id: 299, at: "2026-11-08 12:00:00", actor_id: J },
      ],
    }),
  ],
  tarefas: [],
});
const F = { de: "2026-11-01", ate: "2026-11-10" };
const HOJE = "2026-11-10";

test("funil da coorte: só desce, conta até a etapa mais adiantada, ganho no fim", () => {
  const f = funilDiagnostico(painel.cards, F, ETAPAS);
  assert.deepEqual(f.coorte.map((c) => c.id).sort(), [1, 3, 4]);
  const n = f.linhas.map((l) => l.cards.length);
  assert.deepEqual(n, [3, 2, 1, 1, 1, 1, 1, 1, 1]);
  for (let i = 1; i < n.length; i++) assert.ok(n[i] <= n[i - 1]);
  assert.equal(f.linhas[1].taxa, 2 / 3);
  assert.equal(f.perdidos.length, 1);
  assert.deepEqual(
    f.linhas[3].hoje.map((c) => c.id),
    [2],
    "Hoje = o pipe inteiro agora",
  );
});

test("funil por unidade: a mesma régua por unidade, as linhas somam o funil e Sem unidade vai por último", () => {
  const cards = painel.cards.map((c) =>
    c.id === 3 ? { ...c, unidade: "Recife" } : c.id === 4 ? { ...c, unidade: null } : c,
  );
  const u = funisPorUnidadeDiag(cards, F, ETAPAS);
  assert.deepEqual(
    u.map((x) => x.unidade),
    ["Belém", "Recife", "Sem unidade"],
  );
  const total = funilDiagnostico(cards, F, ETAPAS);
  total.linhas.forEach((l, i) =>
    assert.equal(
      u.reduce((t, x) => t + x.funil.linhas[i].cards.length, 0),
      l.cards.length,
      `etapa ${l.rotulo}`,
    ),
  );
  assert.ok(
    u.every((x) => x.funil.coorte.length > 0),
    "unidade sem card na coorte fica de fora",
  );
});

test("relógio: em risco com 5 dias ou menos; antes do D0 fica à parte", () => {
  const r = relogioDiagnostico(painel.cards, HOJE);
  const p2 = r.pontos.find((p) => p.card.id === 2);
  assert.equal(p2.situacao, "em_risco");
  assert.equal(p2.dias, 26);
  assert.equal(p2.faltam, 4);
  assert.deepEqual(
    r.antesDoD0.map((c) => c.id),
    [1],
  );
});

test("áreas: pendente depois do prazo interno vira atrasada", () => {
  const a = areasDiagnostico(painel.cards, HOJE);
  const consultoria = a.find((x) => x.area === "consultoria");
  assert.deepEqual(
    consultoria.entregue.map((c) => c.id),
    [2, 3].filter((id) => id === 2).concat([]),
  );
  const finance = a.find((x) => x.area === "finance");
  assert.ok(
    finance.atrasada.some((c) => c.id === 2),
    "D0 15/10 + 20 = 04/11 < 10/11",
  );
});

test("cadastro: falta faturamento na 02 e motivo na perda", () => {
  const c = Object.fromEntries(
    cadastroDiagnostico(painel.cards).map((f) => [f.chave, f.cards.map((x) => x.id)]),
  );
  assert.deepEqual(c.faturamento, [1, 5]);
  assert.deepEqual(c.motivo, [4]);
  assert.deepEqual(c.areas, [5]);
});

test("Hoje: parado além da estagnação é do Matheus na 02; tarefa vencida e prazo são da Jordana", () => {
  const [m, j] = hojeDiagnostico(painel.cards, ETAPAS, HOJE);
  assert.deepEqual(
    m.parados.map((i) => i.card.id),
    [1, 2],
    "02 há 8 dias (limite 3) e 04 há 26 dias (limite 20)",
  );
  assert.match(m.parados[0].motivo, /8 dias em 02/);
  assert.deepEqual(
    j.vencidas.map((i) => i.card.id),
    [5],
  );
  assert.deepEqual(
    m.prazo.map((i) => i.card.id),
    [2],
  );
});

test("Ritmo: previstas e feitas por dia, avanços de quem moveu", () => {
  const [m, j] = ritmoDiagnostico(painel.cards, F, HOJE);
  assert.equal(j.previstas, 2);
  assert.equal(j.feitas, 1);
  assert.equal(j.vencidas, 1);
  assert.equal(j.avancos, 3, "Jordana moveu 3 para 300 e para 301, e 5 para 299, no período");
  assert.equal(m.avancos, 2, "Matheus moveu 1 para 294 e 5 para 298");
});

test("Aderência: passagem confere o para-avançar da etapa que o card deixou", () => {
  const p = aderenciaDiagnostico(painel.cards, [], F);
  const de01 = p.find((x) => x.card.id === 1 && x.chave === "01");
  assert.equal(de01.ok, false);
  const perda = p.find((x) => x.chave === "perda");
  assert.equal(perda.ok, false);
  const de05 = p.find((x) => x.card.id === 5 && x.chave === "05");
  assert.equal(de05.ok, true, "produto com honorário");
});

test("Forecast: honorário × probabilidade, horizonte pelo prazo + 7, conversão por área", () => {
  const f = forecastDiagnostico(painel.cards, ETAPAS, HOJE);
  assert.equal(Math.round(f.ponderado), 35000, "R$ 100 mil na 06 a 35%");
  assert.equal(horizonteDe("2026-12-01", HOJE), "proximo_mes");
  assert.equal(horizonteDe("2026-11-09", HOJE), "passou");
  const cons = f.produtos.find((x) => x.area === "consultoria");
  assert.equal(cons.vendidos.length, 1);
  assert.equal(cons.honorarioMedio, 50000);
  assert.equal(f.ganhosMes.length, 1);
  const q = quadrosDiagnostico(painel.cards, F, ETAPAS);
  assert.equal(q.find((x) => x.chave === "jogo").valor, 35000);
});

test("URL: base=nova só nas três abas; pessoa só Matheus ou Jordana; card só na Ficha", () => {
  assert.equal(validarBuscaMonetizacao({ aba: "operacao", base: "nova" }).base, "nova");
  assert.equal(validarBuscaMonetizacao({ aba: "funil", base: "nova" }).base, undefined);
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda", base: "nova", pessoa: "24067177" }).pessoa,
    J,
  );
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda", base: "nova", pessoa: "28897937" }).pessoa,
    undefined,
  );
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda", base: "nova", visao: "ficha", card: "77" }).card,
    77,
  );
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda", base: "nova", visao: "ritmo", card: "77" }).card,
    undefined,
  );
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda" }).base,
    undefined,
    "sem a chave, base antiga",
  );
});

test("fila do dia: tarefa vencida ou de hoje, prazo vencendo e sem tarefa em Fazer hoje; pausado fica fora", () => {
  const HJ = "2026-11-10"; // terça: a semana vai até domingo, 15/11
  const ativ = (id, due, done = false) => ({
    id,
    subject: `Diagnóstico · 01 · T${id}`,
    due_date: due,
    done,
  });
  const p = normalizarPainelDiagnostico({
    sync: {
      status: "ok",
      measured_at: "2026-11-10T12:00:00Z",
      stages: ETAPAS,
      previa: {},
      resumo: {},
    },
    cards: [
      card({ id: 11, stage_id: 293, atividades: [ativ(1, "2026-11-09")] }),
      card({ id: 12, stage_id: 293, atividades: [ativ(2, HJ), ativ(3, "2026-11-12")] }),
      card({ id: 13, stage_id: 294, atividades: [ativ(4, "2026-11-01", true)] }),
      card({ id: 14, stage_id: 294, atividades: [ativ(5, "2026-11-13")] }),
      card({
        id: 15,
        stage_id: 297,
        d0: "2026-10-12",
        prazo: "2026-11-11",
        produtos: [
          {
            product_id: 61,
            produto: "consultoria",
            nome: "C",
            preco: 1,
            quantidade: 1,
            total: 9000,
          },
        ],
        atividades: [ativ(6, "2026-11-20")],
      }),
      card({
        id: 16,
        stage_id: 293,
        pausa: { em: "2026-11-01 10:00:00", autor_id: 1, texto: "Pausado em 01/11/2026." },
      }),
      card({ id: 17, stage_id: 293, status: "lost" }),
    ],
    tarefas: [],
  });
  const f = filaDiagnostico(p.cards, HJ);
  assert.equal(f.total, 5, "abertos fora o pausado");
  assert.deepEqual(
    f.pausados.map((c) => c.id),
    [16],
  );
  assert.equal(f.fimDaSemana, "2026-11-15");
  assert.equal(f.fimDoMes, "2026-11-30");
  const ids = (k) =>
    f
      .grupos(k)
      .flatMap((g) => g.linhas.map((l) => l.card.id))
      .sort();
  assert.deepEqual(ids("hoje"), [11, 12, 13]);
  assert.deepEqual(ids("semana"), [14, 15]);
  const l15 = f
    .grupos("semana")
    .flatMap((g) => g.linhas)
    .find((l) => l.card.id === 15);
  assert.equal(l15.porque, "prazo do cliente em 11/11");
  assert.equal(l15.fechamento, "2026-11-18");
  assert.deepEqual(ids("mes"), [15]);
  assert.deepEqual(ids("semdata"), [11, 12, 13, 14], "sem D0 ou sem produto");
  assert.deepEqual(f.contagem, { hoje: 3, semana: 2, mes: 1, semdata: 4 });
  const porque = Object.fromEntries(
    f
      .grupos("hoje")
      .flatMap((g) => g.linhas)
      .map((l) => [l.card.id, l.porque]),
  );
  assert.deepEqual(porque, {
    11: "tarefa vencida em 09/11",
    12: "tarefa de hoje",
    13: "sem tarefa aberta",
  });
});

test("Hoje: card pausado sai de parados, prazo e sem tarefa e vai para Pausados", () => {
  const p = normalizarPainelDiagnostico({
    sync: {
      status: "ok",
      measured_at: "2026-11-10T12:00:00Z",
      stages: ETAPAS,
      previa: {},
      resumo: {},
    },
    cards: [
      card({
        id: 21,
        stage_id: 294,
        stage_since: "2026-11-01 12:00:00",
        pausa: {
          em: "2026-11-02 10:00:00",
          autor_id: 1,
          texto: "Pausado em 02/11/2026. Espera o sócio.",
        },
      }),
      card({ id: 22, stage_id: 294, stage_since: "2026-11-01 12:00:00" }),
    ],
    tarefas: [],
  });
  const [m] = hojeDiagnostico(p.cards, ETAPAS, HOJE);
  assert.deepEqual(
    m.pausados.map((i) => i.card.id),
    [21],
  );
  assert.match(m.pausados[0].motivo, /Espera o sócio/);
  assert.deepEqual(
    m.semProximo.map((i) => i.card.id),
    [22],
  );
  assert.deepEqual(
    m.parados.map((i) => i.card.id),
    [22],
  );
});
