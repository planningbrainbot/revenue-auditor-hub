// Base nova (pipe 40 · Diagnóstico de Oportunidades): quem entra, vencimento em dia corrido com dia útil, régua por
// etapa, cobrança a cada 7 dias, encerramento, entrada automática e dry-run, com Pipedrive e banco simulados.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPO,
  JORDANA,
  MATHEUS,
  MOTIVO_SEM_ONBOARDING,
  cardDaVenda,
  elegibilidade,
  passouDoKickoff,
  unidadePausada,
  montarCard,
  motivoDeEncerrar,
  planejarEntrada,
  planejarGanho,
  preencher,
  proximaCobranca,
  proximoDiaUtil,
  rodarDiagnostico,
  rotuladorDe,
  vencimentoDiagnostico,
} from "../supabase/functions/monetizacao-diagnostico/logica.ts";
import { ETAPA, REGUA } from "../supabase/functions/monetizacao-diagnostico/regua.ts";

const rotulo = rotuladorDe([
  {
    key: CAMPO.regime,
    options: [
      { id: 350, label: "Simples Nacional" },
      { id: 351, label: "Lucro Presumido" },
      { id: 352, label: "Lucro Real" },
    ],
  },
  {
    key: CAMPO.faixa,
    options: [
      { id: 776, label: "R$ 4,8 milhões até R$ 10 milhões" },
      { id: 777, label: "R$ 10 milhões até R$ 25 milhões" },
    ],
  },
  { key: CAMPO.unidade, options: [{ id: 697, label: "Belém" }] },
]);
const AGORA = new Date("2026-10-16T15:00:00Z");

function card(over = {}) {
  return montarCard(
    {
      id: 500,
      title: "Grupo X",
      org_id: { value: 9, name: "Grupo X Ltda" },
      user_id: { id: MATHEUS, name: "Matheus" },
      status: "open",
      stage_id: ETAPA.execucao,
      stage_change_time: "2026-10-19 13:00:00",
      add_time: "2026-10-16 12:00:00",
      update_time: "2026-10-19 13:00:00",
      [CAMPO.regime]: "352",
      [CAMPO.faixa]: "777",
      ...over,
    },
    [],
    [],
    [],
    rotulo,
    AGORA,
  );
}

test("quem entra: Real, ou Presumido de R$ 10 mi para cima; sem organização também", () => {
  const v = (regime, faixa, org = 1) => ({
    org_id: org,
    custom_fields: { [CAMPO.regime]: regime, [CAMPO.faixa]: faixa },
  });
  assert.equal(elegibilidade(v(352, 774)).entra, true);
  assert.equal(elegibilidade(v(351, 777)).entra, true);
  assert.equal(elegibilidade(v(351, 776)).entra, false);
  assert.equal(elegibilidade(v(351, 776)).motivo, "Lucro Presumido abaixo de R$ 10 mi");
  assert.equal(elegibilidade(v(350, 778)).entra, false);
  assert.equal(elegibilidade(v(352, 778, null)).entra, true, "o cliente vem do onboarding");
  assert.equal(elegibilidade(v(null, null)).motivo, "sem regime na venda");
});

test("card novo herda da venda e nasce no nome do Matheus, etapa 01, um por conta", () => {
  const corpo = cardDaVenda(
    {
      id: 77,
      title: "Rocca (Segunda Oportunidade)",
      org_id: 9,
      person_id: 3,
      custom_fields: { [CAMPO.regime]: 351, [CAMPO.faixa]: 777, [CAMPO.cnpj]: 0 },
    },
    null,
  );
  assert.equal(corpo.title, "Rocca");
  assert.equal(corpo.user_id, MATHEUS);
  assert.equal(corpo.pipeline_id, 40);
  assert.equal(corpo.stage_id, ETAPA.novo);
  assert.equal(corpo[CAMPO.regime], "351");
  assert.equal(corpo[CAMPO.cnpj], undefined, "CNPJ 0 do formulário não é CNPJ");
  assert.equal(corpo[CAMPO.vendaOrigem], "https://grupoplanning.pipedrive.com/deal/77");
});

test("vencimento: dias corridos, empurrado para o dia útil seguinte", () => {
  assert.equal(proximoDiaUtil("2026-10-17"), "2026-10-19"); // sábado → segunda
  assert.equal(proximoDiaUtil("2026-11-02"), "2026-11-03"); // Finados
  assert.equal(vencimentoDiagnostico("2026-10-19", 20), "2026-11-09"); // 08/11 é domingo
});

test("etapa 04 no Real: D0 é a entrada, quatro tarefas, follow-up da Jordana em D+15", () => {
  const t = planejarEntrada(card());
  assert.deepEqual(
    t.map((x) => [x.chave, x.due_date, x.user_id]),
    [
      ["04-largada", "2026-10-19", MATHEUS],
      ["04-followup-15", "2026-11-03", JORDANA],
      ["04-aviso-3-dias", "2026-11-05", MATHEUS],
      ["04-conferir", "2026-11-09", MATHEUS],
    ],
  );
  assert.match(t[0].assunto, /^Diagnóstico · 04 · Largada/);
  assert.match(t[0].nota, /Prazo do cliente: 18\/11\/2026/);
  assert.match(t[0].nota, /Prazo interno: 08\/11\/2026 \(D\+20\)/);
});

test("etapa 04 no Presumido: prazo de 60 dias e o follow-up de D+40", () => {
  const t = planejarEntrada(card({ [CAMPO.regime]: "351" }));
  assert.equal(t.length, 5);
  assert.ok(t.some((x) => x.chave === "04-followup-40"));
  assert.equal(t.find((x) => x.chave === "04-conferir").due_date, "2026-12-03");
  assert.match(t[0].nota, /Prazo do cliente: 18\/12\/2026/);
});

test("régua: 18 tarefas por card no Real e 19 no Presumido, fora cobranças e ganho", () => {
  assert.equal(
    REGUA.filter((i) => i.etapa !== "ganho" && !i.cada && (!i.so || i.so === "real")).length,
    18,
  );
  assert.equal(
    REGUA.filter((i) => i.etapa !== "ganho" && !i.cada && (!i.so || i.so === "presumido")).length,
    19,
  );
});

test("preencher troca só o que o Brain sabe", () => {
  assert.equal(
    preencher("Olá, [NOME], da [EMPRESA]", { EMPRESA: "Rocca" }),
    "Olá, [NOME], da Rocca",
  );
});

test("cobrança da pasta: a próxima nasce 7 dias depois, só quando a anterior venceu", () => {
  const c = card({ stage_id: ETAPA.coleta, stage_change_time: "2026-10-19 13:00:00" });
  const primeira = planejarEntrada(c).find((x) => x.chave === "03-cobrar-1");
  assert.equal(primeira.due_date, "2026-10-26");
  const linhas = [{ ...primeira, activity_id: 1, status: "aberta" }];
  assert.equal(proximaCobranca(c, linhas, "2026-10-25"), null);
  const segunda = proximaCobranca(c, linhas, "2026-10-26");
  assert.equal(segunda.chave, "03-cobrar-2");
  assert.equal(segunda.due_date, "2026-11-03"); // 02/11 é feriado
});

test("encerrar: saiu da etapa, perdido, ganho; tarefa de ganho fica", () => {
  const c = card();
  const l = { deal_id: 500, etapa: "297", entrou_em: "2026-10-19 13:00:00", chave: "04-largada" };
  assert.equal(motivoDeEncerrar(l, c), null);
  assert.equal(
    motivoDeEncerrar(l, { ...c, stage_id: ETAPA.concluido, stage_since: "2026-11-08 10:00:00" }),
    "saiu da etapa 04",
  );
  assert.equal(motivoDeEncerrar(l, { ...c, status: "lost" }), "card perdido");
  assert.equal(motivoDeEncerrar({ ...l, etapa: "ganho" }, { ...c, status: "won" }), null);
  assert.equal(motivoDeEncerrar(l, undefined), "card fora do pipe 40");
});

test("ganho: uma tarefa por produto vendido", () => {
  const c = {
    ...card(),
    status: "won",
    won_time: "2026-11-20 15:00:00",
    produtos: [
      { product_id: 61, produto: "consultoria", nome: "x", preco: 1, quantidade: 1, total: 1 },
      { product_id: 63, produto: "teses", nome: "y", preco: 1, quantidade: 1, total: 1 },
    ],
  };
  const t = planejarGanho(c);
  assert.deepEqual(
    t.map((x) => x.chave),
    ["ganho-61", "ganho-63"],
  );
  assert.match(t[1].assunto, /Passar Teses Jurídicas para a área/);
});

// ---------------------------------------------------------------------------- rodada com fakes

function fakes({
  deals = [],
  vendas = [],
  entradas = [],
  tarefas = [],
  notas = {},
  apagadas = [],
  onboarding = [],
  pipe39 = [],
} = {}) {
  const chamadas = [];
  let proximo = 9000;
  const pd = {
    async get(path, params = {}) {
      chamadas.push(["get", path]);
      if (path === "notes") return { data: notas[params.deal_id] || [] };
      if (path === "stages")
        return {
          data: [
            { id: 293, pipeline_id: 40, order_nr: 1, name: "Novo Cliente", active_flag: true },
            { id: 294, pipeline_id: 40, order_nr: 2, name: "Elegível", active_flag: true },
          ],
        };
      if (path.startsWith("organizations/"))
        return { data: { name: "Conta " + path.split("/")[1] } };
      if (path === "activityTypes")
        return {
          data: [
            { key_string: "task" },
            { key_string: "call" },
            { key_string: "email" },
            { key_string: "whatsapp" },
          ],
        };
      if (path.startsWith("activities/")) {
        const id = Number(path.split("/")[1]);
        return { data: { id, done: false, active_flag: !apagadas.includes(id) } };
      }
      return { data: null };
    },
    async pages(path, params = {}) {
      if (path === "dealFields") return [];
      if (path === "deals") return deals.filter((d) => d.stage_id === params.stage_id);
      return [];
    },
    async v2(path, params = {}) {
      chamadas.push(["v2", path, params]);
      if (params.ids) {
        const ids = String(params.ids).split(",").map(Number);
        return { data: vendas.filter((v) => ids.includes(v.id)), additional_data: {} };
      }
      if (params.pipeline_id === 39)
        return { data: pipe39.filter((d) => d.status === params.status), additional_data: {} };
      return { data: [], additional_data: {} };
    },
    async post(path, payload) {
      chamadas.push(["post", path, payload]);
      return { data: { id: ++proximo } };
    },
    async put(path, payload) {
      chamadas.push(["put", path, payload]);
      return { data: {} };
    },
    async del(path) {
      chamadas.push(["del", path]);
    },
  };
  const estado = { retrato: null, entradas: [...entradas], tarefas: [...tarefas], liberadas: [] };
  const store = {
    cardsAtuais: async () => [],
    gravarRetrato: async (r) => void (estado.retrato = r),
    entradas: async () => estado.entradas,
    inserirEntrada: async (l) => void estado.entradas.push(l),
    onboarding: async () => onboarding,
    liberarEtapa: async (dealId, etapa) => {
      estado.liberadas.push([dealId, etapa]);
      estado.tarefas = estado.tarefas.filter(
        (t) => !(t.deal_id === dealId && t.etapa === String(etapa) && t.status !== "aberta"),
      );
    },
    tarefas: async () => estado.tarefas,
    inserirTarefa: async (l) => {
      if (
        estado.tarefas.some(
          (x) => x.deal_id === l.deal_id && x.entrou_em === l.entrou_em && x.chave === l.chave,
        )
      )
        return false;
      estado.tarefas.push({ ...l });
      return true;
    },
    atualizarTarefa: async (k, patch) => {
      const l = estado.tarefas.find(
        (x) => x.deal_id === k.deal_id && x.entrou_em === k.entrou_em && x.chave === k.chave,
      );
      Object.assign(l, patch);
    },
  };
  return { pd, store, chamadas, estado };
}

const VENDAS = [
  { id: 1, org_id: 11, won_time: "2026-10-02T15:00:00Z", custom_fields: { [CAMPO.regime]: 352, [CAMPO.faixa]: 775 } },
  { id: 2, org_id: 12, won_time: "2026-10-08T15:00:00Z", custom_fields: { [CAMPO.regime]: 351, [CAMPO.faixa]: 776 } },
  { id: 3, org_id: 11, won_time: "2026-10-09T15:00:00Z", custom_fields: { [CAMPO.regime]: 352, [CAMPO.faixa]: 775 } },
  { id: 4, org_id: 14, won_time: "2026-09-29T15:00:00Z", custom_fields: { [CAMPO.regime]: 352, [CAMPO.faixa]: 778 } },
  { id: 5, org_id: 15, won_time: "2026-09-10T15:00:00Z", custom_fields: { [CAMPO.regime]: 352, [CAMPO.faixa]: 777 } },
];
const onb = (card, venda, fase, fases = [], unidade = "Matriz") => ({
  pipefy_card_id: String(card),
  titulo: "Cliente " + card,
  unidade,
  fase_atual: fase,
  fases,
  pipedrive_deal_id: venda,
});
const ONBOARDING = [
  onb(101, 1, "Setup técnico"),
  onb(102, 2, "Concluído"), // Presumido abaixo de R$ 10 mi
  onb(103, 3, "Pesquisa de Esforço (CES)"), // mesma conta da venda 1
  onb(104, 4, "Pré Kickoff [ops + cs]"), // ainda antes do kickoff
  onb(105, 5, "Churn no Onboarding", ["kickoff com [Cliente + ops + cs]"]),
  onb(106, null, "Concluído"), // sem venda ligada
];

test("passou do kickoff: fase atual ou histórico; Pré Kickoff não conta; churn não entra", () => {
  assert.equal(passouDoKickoff(onb(1, 1, "kickoff com [Cliente + ops + cs]")), true);
  assert.equal(passouDoKickoff(onb(1, 1, "Pré Kickoff [ops + cs]")), false);
  assert.equal(
    passouDoKickoff(onb(1, 1, "Pré Kickoff [ops + cs]", ["kickoff com [Cliente + ops + cs]"])),
    true,
    "voltou para o Pré Kickoff depois de passar pelo kickoff",
  );
  assert.equal(passouDoKickoff(onb(1, 1, "Churn no Onboarding", ["Setup técnico"])), false);
  assert.equal(unidadePausada(["Belém"], ["Matriz", "BELEM"]), "BELEM");
  assert.equal(unidadePausada([], ["Belém"]), null);
});

test("dry-run: nada escrito, prévia de quem passou do kickoff com fit, uma por conta", async () => {
  const f = fakes({ vendas: VENDAS, onboarding: ONBOARDING });
  const r = await rodarDiagnostico({
    pd: f.pd,
    store: f.store,
    agora: AGORA,
    entradaAtiva: false,
    tarefasAtiva: false,
    inicio: null,
  });
  assert.equal(f.chamadas.filter((c) => c[0] === "post" || c[0] === "put").length, 0);
  assert.equal(r.entrada.a_criar_ou_criadas, 1, "só a venda 1: a 3 é da mesma conta");
  assert.equal(r.entrada.depois_do_kickoff, 4);
  assert.deepEqual(r.entrada.fora_da_regra, {
    "onboarding sem venda ligada": 1,
    "Lucro Presumido abaixo de R$ 10 mi": 1,
  });
  assert.equal(f.estado.retrato.previa.entradas[0].empresa, "Cliente 101");
  assert.equal(f.estado.entradas.length, 0);
});

test("ligada: cria o card com o nome do onboarding, a nota fixada e a entrada; nada se repete", async () => {
  const f = fakes({ vendas: VENDAS, onboarding: ONBOARDING });
  const op = {
    pd: f.pd,
    store: f.store,
    agora: AGORA,
    entradaAtiva: true,
    tarefasAtiva: true,
    inicio: "2026-10-16T00:00:00Z",
  };
  const r = await rodarDiagnostico(op);
  const posts = f.chamadas.filter((c) => c[0] === "post");
  assert.deepEqual(
    posts.map((c) => c[1]),
    ["deals", "notes"],
  );
  assert.equal(posts[0][2].title, "Cliente 101");
  assert.equal(posts[0][2].stage_id, ETAPA.novo);
  assert.equal(posts[1][2].pinned_to_deal_flag, 1);
  assert.match(posts[1][2].content, /Onboarding do CS: Setup técnico/);
  assert.equal(r.entrada.criadas, 1);
  assert.deepEqual(
    f.estado.entradas.map((e) => [e.venda_id, e.status, e.deal_id]),
    [
      [1, "criado", 9001],
      [3, "conta_ja_no_pipe", 9001],
    ],
  );
  const antes = f.chamadas.length;
  await rodarDiagnostico(op);
  assert.equal(f.chamadas.slice(antes).filter((c) => c[0] === "post").length, 0);
});

test("pipe 39: conta com card aberto fica lá; conta perdida no 39 entra", async () => {
  const f = fakes({
    vendas: VENDAS,
    onboarding: [onb(101, 1, "Setup técnico"), onb(107, 5, "Concluído")],
    pipe39: [
      { id: 39001, org_id: 11, status: "open" },
      { id: 39002, org_id: 15, status: "lost" },
    ],
  });
  const r = await rodarDiagnostico({
    pd: f.pd,
    store: f.store,
    agora: AGORA,
    entradaAtiva: false,
    tarefasAtiva: false,
    inicio: null,
  });
  assert.deepEqual(
    f.estado.retrato.previa.entradas.map((e) => e.venda_id),
    [5],
  );
  assert.deepEqual(r.entrada.fora_da_regra, { "card aberto ou ganho no pipe 39": 1 });
});

test("unidade pausada: o card nasce com a nota 'Pausado em' antes da nota da venda", async () => {
  const f = fakes({ vendas: VENDAS, onboarding: [onb(101, 1, "Concluído", [], "Belém")] });
  await rodarDiagnostico({
    pd: f.pd,
    store: f.store,
    agora: AGORA,
    entradaAtiva: true,
    tarefasAtiva: false,
    inicio: null,
    unidadesPausadas: ["Belém"],
  });
  const notas = f.chamadas.filter((c) => c[0] === "post" && c[1] === "notes");
  assert.equal(notas.length, 2);
  assert.match(notas[0][2].content, /^Pausado em 16\/10\/2026\. A unidade Belém/);
  assert.equal(notas[0][2].pinned_to_deal_flag, 1);
});

test("ligada: card que saiu da etapa apaga só a tarefa não feita", async () => {
  const tarefas = [
    {
      deal_id: 700,
      etapa: "294",
      entrou_em: "2026-10-16 10:00:00",
      chave: "02-sla",
      user_id: MATHEUS,
      assunto: "x",
      due_date: "2026-10-16",
      activity_id: 51,
      status: "aberta",
      versao: "v",
    },
  ];
  const f = fakes({
    tarefas,
    deals: [
      {
        id: 700,
        pipeline_id: 40,
        stage_id: 293,
        status: "open",
        title: "Y",
        org_id: { value: 20 },
        user_id: MATHEUS,
        stage_change_time: "2026-10-17 10:00:00",
        add_time: "2026-10-15 10:00:00",
        update_time: "2026-10-17 10:00:00",
      },
    ],
  });
  await rodarDiagnostico({
    pd: f.pd,
    store: f.store,
    agora: AGORA,
    entradaAtiva: false,
    tarefasAtiva: true,
    inicio: "2026-10-16T00:00:00Z",
    vendasDesde: "2026-10-01",
  });
  assert.ok(f.chamadas.some((c) => c[0] === "del" && c[1] === "activities/51"));
  assert.equal(f.estado.tarefas[0].status, "apagada");
  assert.equal(f.estado.tarefas[0].motivo, "saiu da etapa 02");
});

const NOTA_PAUSA = {
  id: 1,
  add_time: "2026-10-19 23:54:52",
  user_id: 23984402,
  pinned_to_deal_flag: true,
  content: "<b>Pausado em 19/10/2026.</b> A abordagem da base de Belém espera o sócio.",
};
const NOTA_MATHEUS = {
  id: 2,
  add_time: "2026-10-20 11:30:57",
  user_id: MATHEUS,
  pinned_to_deal_flag: false,
  content: "BELEM - AGUARDAR.",
};
const cardPausavel = () => ({
  id: 800,
  pipeline_id: 40,
  stage_id: 293,
  status: "open",
  title: "Posto",
  org_id: { value: 30 },
  user_id: MATHEUS,
  stage_change_time: "2026-10-16 10:00:00",
  add_time: "2026-10-16 10:00:00",
  update_time: "2026-10-20 11:30:57",
  notes_count: 2,
});
const tarefaPausavel = (status) => ({
  deal_id: 800,
  etapa: "293",
  entrou_em: "2026-10-16 10:00:00",
  chave: "01-conferir",
  user_id: MATHEUS,
  assunto: "Diagnóstico · 01 · Conferir regime e faturamento",
  due_date: "2026-10-16",
  activity_id: 61,
  status,
  versao: "v",
});
const rodarPausa = (f) =>
  rodarDiagnostico({
    pd: f.pd,
    store: f.store,
    agora: AGORA,
    entradaAtiva: false,
    tarefasAtiva: true,
    inicio: "2026-10-16T00:00:00Z",
    vendasDesde: "2026-10-01",
  });

test("pausa: nota fixada guarda a tarefa que a pausa tirou e o card não recebe tarefa nova", async () => {
  const f = fakes({
    deals: [cardPausavel()],
    tarefas: [tarefaPausavel("aberta")],
    notas: { 800: [NOTA_PAUSA, NOTA_MATHEUS] },
    apagadas: [61],
  });
  const r = await rodarPausa(f);
  assert.equal(f.estado.tarefas[0].status, "pausada");
  assert.equal(r.tarefas.pausadas, 1);
  assert.ok(
    !f.chamadas.some((c) => c[0] === "post" && c[1] === "activities"),
    "nenhuma tarefa nova",
  );
  const card = f.estado.retrato.cards[0];
  assert.match(card.pausa.texto, /^Pausado em 19\/10\/2026\./);
  assert.equal(card.ultima_nota.texto, "BELEM - AGUARDAR.");
  assert.equal(card.ultima_nota.autor_id, MATHEUS);
});

test("pausa: atividade que continua no Pipedrive não vira pausada", async () => {
  const f = fakes({
    deals: [cardPausavel()],
    tarefas: [tarefaPausavel("aberta")],
    notas: { 800: [NOTA_PAUSA] },
  });
  await rodarPausa(f);
  assert.equal(f.estado.tarefas[0].status, "aberta");
});

test("pausa liberada: a nota saiu e a tarefa guardada volta, vencendo no dia útil de hoje", async () => {
  const f = fakes({
    deals: [cardPausavel()],
    tarefas: [tarefaPausavel("pausada")],
    notas: { 800: [{ ...NOTA_PAUSA, pinned_to_deal_flag: false }, NOTA_MATHEUS] },
  });
  const r = await rodarPausa(f);
  const post = f.chamadas.find((c) => c[0] === "post" && c[1] === "activities");
  assert.ok(post, "a tarefa voltou ao Pipedrive");
  assert.equal(post[2].subject, "Diagnóstico · 01 · Conferir regime e faturamento");
  assert.equal(post[2].deal_id, 800);
  const l = f.estado.tarefas[0];
  assert.equal(l.status, "aberta");
  assert.equal(l.due_date, "2026-10-16");
  assert.ok(l.activity_id > 9000);
  assert.equal(r.tarefas.retomadas, 1);
  assert.equal(f.estado.retrato.cards[0].pausa, null);
});

test("pausa liberada depois de o card mudar de etapa: a tarefa guardada sai, não volta", async () => {
  const f = fakes({
    deals: [{ ...cardPausavel(), stage_id: 294, stage_change_time: "2026-10-16 12:00:00" }],
    tarefas: [tarefaPausavel("pausada")],
  });
  await rodarPausa(f);
  const l = f.estado.tarefas.find((x) => x.chave === "01-conferir");
  assert.equal(l.status, "apagada");
  assert.equal(l.motivo, "saiu da etapa 01");
});

test("base antiga protegida: conta no pipe 40 não sobe para o 39, fora o perdido na etapa 01", async () => {
  const { cardDoDiagnostico, FORA_DO_ENVIO_39 } =
    await import("../supabase/functions/monetizacao-crm/send.mjs");
  assert.equal(cardDoDiagnostico([{ id: 1, pipeline_id: 39, status: "open" }]), null);
  assert.equal(
    cardDoDiagnostico([{ id: 2, pipeline_id: 40, status: "open", stage_id: 297 }]).id,
    2,
  );
  assert.equal(cardDoDiagnostico([{ id: 3, pipeline_id: 40, status: "won", stage_id: 301 }]).id, 3);
  assert.equal(
    cardDoDiagnostico([{ id: 4, pipeline_id: 40, status: "lost", stage_id: 293 }]),
    null,
  );
  assert.equal(
    cardDoDiagnostico([{ id: 5, pipeline_id: 40, status: "lost", stage_id: 300 }]).id,
    5,
  );
  assert.ok(FORA_DO_ENVIO_39.has(MATHEUS));
});

// ---------------------------------------------------------------------------- reabertura (21/10/2026)

test("card que saiu antes do onboarding volta à etapa 01 quando o cliente passa do kickoff", async () => {
  const perdido = {
    id: 900,
    pipeline_id: 40,
    stage_id: 293,
    status: "lost",
    lost_reason: MOTIVO_SEM_ONBOARDING,
    title: "Cliente",
    org_id: { value: 11, name: "Cliente" },
    user_id: MATHEUS,
    stage_change_time: "2026-10-14 12:00:00",
    add_time: "2026-10-14 12:00:00",
    update_time: "2026-10-15 12:00:00",
  };
  const f = fakes({
    vendas: VENDAS,
    deals: [perdido],
    entradas: [{ venda_id: 1, org_id: 11, deal_id: 900, status: "criado" }],
    tarefas: [
      {
        deal_id: 900,
        etapa: "293",
        entrou_em: "2026-10-14 12:00:00",
        chave: "01-conferir",
        status: "feita",
        activity_id: 1,
      },
    ],
    onboarding: [onb(101, 1, "Pré Kickoff [ops + cs]")],
  });
  const op = {
    pd: f.pd,
    store: f.store,
    agora: AGORA,
    entradaAtiva: true,
    tarefasAtiva: true,
    inicio: "2026-10-01T00:00:00Z",
  };
  await rodarDiagnostico(op);
  assert.equal(
    f.chamadas.filter((c) => c[0] === "put").length,
    0,
    "antes do kickoff, o card perdido fica como está",
  );

  f.store.onboarding = async () => [onb(101, 1, "kickoff com [Cliente + ops + cs]")];
  const r = await rodarDiagnostico(op);
  const put = f.chamadas.find((c) => c[0] === "put");
  assert.deepEqual(put.slice(1), ["deals/900", { status: "open", stage_id: ETAPA.novo }]);
  assert.equal(r.entrada.reabertas, 1);
  assert.deepEqual(f.estado.liberadas, [[900, 293]]);
  assert.equal(f.estado.tarefas.length, 0, "a 01 feita antes sai, para nascer de novo");
  assert.equal(f.estado.entradas.length, 1, "a entrada da venda já existia");

  // Próxima rodada: o card aberto na 01 ganha a tarefa, vencendo hoje e não no dia da entrada antiga.
  perdido.status = "open";
  perdido.lost_reason = null;
  perdido.update_time = "2026-10-16 15:00:00";
  await rodarDiagnostico(op);
  const nova = f.estado.tarefas.find((t) => t.deal_id === 900 && t.chave === "01-conferir");
  assert.equal(nova.status, "aberta");
  assert.equal(nova.due_date, "2026-10-16");
});
