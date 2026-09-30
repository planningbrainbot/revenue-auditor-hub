import test from "node:test";
import assert from "node:assert/strict";
import {
  clienteClickUp,
  lerTarefasDoSpace,
  ErroClickUp,
} from "../supabase/functions/_shared/clickup/api.ts";
import {
  normalizarOkrs,
  opcaoDoCampo,
  tarefasPorLista,
} from "../supabase/functions/_shared/clickup/normalizar.ts";
import { resolverCampo, opcaoPorNome } from "../supabase/functions/_shared/clickup/campos.ts";
import { medicaoKr } from "../supabase/functions/_shared/clickup/tipos.ts";
import { fracaoEsperada, listarKrs } from "../supabase/functions/_shared/clickup/dashboard.ts";
import {
  linhaDoEspelho,
  diferencas,
  mesmoInstante,
  podeMarcarSumidas,
} from "../supabase/functions/_shared/clickup/compromissos.ts";
import { calcularMedicoesBrain } from "../supabase/functions/_shared/clickup/medicoes-brain.ts";
import { montarOkrsTema } from "../src/lib/cockpit-coo/okrs.ts";
import {
  lerCompromisso,
  ordenarFila,
  higiene,
  temaDoTexto,
  execucaoDoTema,
  reuniaoAnterior,
  revisaoDaSemana,
  taxaNoPrazo,
  lerTarefas,
} from "../src/lib/cockpit-coo/compromissos.ts";
import { lerUnidades } from "../src/lib/cockpit-coo/unidades.ts";

// --- API: paginação e cota --------------------------------------------------------------------

function fetchFalso(paginas, chamadas = []) {
  return async (url, init) => {
    chamadas.push({ url, init });
    const page = Number(new URL(url).searchParams.get("page"));
    const corpo = paginas[page] ?? { tasks: [], last_page: true };
    return new Response(JSON.stringify(corpo), { status: 200 });
  };
}

const tarefa = (id, extra = {}) => ({
  id,
  name: `Tarefa ${id}`,
  url: `https://app.clickup.com/t/${id}`,
  parent: null,
  status: { status: "pendente", type: "open" },
  custom_fields: [],
  ...extra,
});

test("lerTarefasDoSpace segue as páginas até last_page: 250 tarefas chegam inteiras", async () => {
  const paginas = [
    { tasks: Array.from({ length: 100 }, (_, i) => tarefa(`a${i}`)), last_page: false },
    { tasks: Array.from({ length: 100 }, (_, i) => tarefa(`b${i}`)), last_page: false },
    { tasks: Array.from({ length: 50 }, (_, i) => tarefa(`c${i}`)), last_page: true },
  ];
  const chamadas = [];
  const c = clienteClickUp("pk_teste", { fetch: fetchFalso(paginas, chamadas) });
  const todas = await lerTarefasDoSpace(c, { teamId: "T", spaceId: "S" });
  assert.equal(todas.length, 250);
  assert.equal(chamadas.length, 3);
  const u = new URL(chamadas[0].url);
  assert.equal(u.pathname, "/api/v2/team/T/task");
  assert.equal(u.searchParams.get("space_ids[]"), "S");
  assert.equal(u.searchParams.get("subtasks"), "true");
  assert.equal(u.searchParams.get("include_closed"), "true");
  assert.equal(chamadas[0].init.headers.Authorization, "pk_teste");
});

test("lerTarefasDoSpace falha alto quando passa do teto de páginas (nunca devolve metade)", async () => {
  const cheia = { tasks: [tarefa("x")], last_page: false };
  const c = clienteClickUp("t", { fetch: async () => new Response(JSON.stringify(cheia)) });
  await assert.rejects(() => lerTarefasDoSpace(c, { tetoPaginas: 3 }), /mais de 3 páginas/);
});

test("429 espera a janela e tenta de novo; outro erro vira ErroClickUp com status", async () => {
  let n = 0;
  const esperas = [];
  const c = clienteClickUp("t", {
    fetch: async () => {
      n++;
      if (n === 1)
        return new Response("{}", { status: 429, headers: { "X-RateLimit-Reset": "1005" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
    agora: () => 1_000_000,
    dormir: async (ms) => esperas.push(ms),
  });
  assert.deepEqual(await c.ler("/x"), { ok: true });
  assert.deepEqual(esperas, [5000]);

  const c2 = clienteClickUp("t", {
    fetch: async () => new Response(JSON.stringify({ err: "Token invalid", ECODE: "OAUTH_025" }), { status: 401 }),
  });
  await assert.rejects(
    () => c2.ler("/team/1/task"),
    (e) => e instanceof ErroClickUp && e.status === 401 && /Token invalid/.test(e.message),
  );
  assert.throws(() => clienteClickUp(""), /token do ClickUp ausente/);
});

// --- Normalização de OKR (régua do Growth) ------------------------------------------------------

test("normalizarOkrs: pasta = departamento, lista = objetivo, tarefa = KR, subtarefa = ação", () => {
  const pastas = [
    {
      id: "P1",
      name: "Operações · Victor",
      lists: [
        { id: "L1", name: "Objetivo 1", statuses: [{ status: "pendente", orderindex: 0 }, { status: "concluído", orderindex: 2 }] },
        { id: "L2", name: "🗣️ Direcionamentos (1:1)" },
      ],
    },
  ];
  const campos = [
    { id: "f1", name: "🎯 Alvo", type: "number", value: "10" },
    { id: "f2", name: "📍 Atual", type: "number", value: "4" },
    {
      id: "f3",
      name: "Sentido",
      type: "drop_down",
      value: 0,
      type_config: { options: [{ id: "o1", name: "maior melhor", orderindex: 0 }, { id: "o2", name: "menor melhor", orderindex: 1 }] },
    },
  ];
  const ts = [
    tarefa("K1", { list: { id: "L1" }, custom_fields: campos, orderindex: "1" }),
    tarefa("A1", { list: { id: "L1" }, parent: "K1", status: { status: "concluído", type: "closed" } }),
    tarefa("A2", { list: { id: "L1" }, parent: "K1" }),
  ];
  const deptos = normalizarOkrs(pastas, tarefasPorLista(ts));
  assert.equal(deptos[0].objetivos.length, 1, "lista 🗣️ não é objetivo");
  const kr = deptos[0].objetivos[0].krs[0];
  assert.equal(kr.alvo, 10);
  assert.equal(kr.atual, 4);
  assert.equal(kr.sentido, "maior");
  assert.equal(kr.acoes.length, 2);
  assert.equal(kr.acoes[0].id, "A1", "concluída vem primeiro");
  assert.deepEqual(medicaoKr(kr), { progresso: 0.4, origem: "clickup" });
  assert.equal(listarKrs(deptos).length, 1);
});

test("medicaoKr: Brain > ponteiro > ações; menor melhor", () => {
  const base = { id: "k", nome: "", url: "", alvo: null, atual: null, sentido: "maior", acoes: [] };
  assert.equal(medicaoKr(base), null);
  assert.deepEqual(medicaoKr({ ...base, acoes: [{ concluida: true }, { concluida: false }] }), { progresso: 0.5, origem: "acoes" });
  assert.deepEqual(medicaoKr({ ...base, alvo: 300, atual: 400, sentido: "menor" }), { progresso: 0.75, origem: "clickup" });
  assert.deepEqual(medicaoKr({ ...base, alvo: 300, atual: 400, brain: { progresso: 0.9, resumo: "" } }), { progresso: 0.9, origem: "brain" });
});

test("fracaoEsperada: ciclo de 01/08 a 31/12, linear e contando o dia", () => {
  assert.equal(fracaoEsperada("2026-07-15"), 0);
  assert.equal(fracaoEsperada("2026-12-31"), 1);
  assert.equal(Number(fracaoEsperada("2026-09-29").toFixed(4)), Number((60 / 153).toFixed(4)));
});

test("campos: dropdown por orderindex ou id; resolução cai para o space; opção por nome sem acento", () => {
  const dd = {
    id: "fT",
    name: "Tema",
    type: "drop_down",
    value: "op2",
    type_config: { options: [{ id: "op1", name: "Growth", orderindex: 0 }, { id: "op2", name: "Monetização", orderindex: 1 }] },
  };
  assert.equal(opcaoDoCampo([dd], "Tema"), "Monetização");
  assert.equal(opcaoDoCampo([{ ...dd, value: 0 }], "Tema"), "Growth");
  assert.equal(opcaoDoCampo([{ id: "u", name: "Origem no Brain", type: "url", value: "coo:x" }], "Origem"), "coo:x");
  assert.deepEqual(resolverCampo([], [dd], "Tema"), { ok: true, id: "fT", origem: "space", opcoes: dd.type_config.options });
  assert.deepEqual(resolverCampo([], [], "Tema"), { ok: false, motivo: "ausente_no_space" });
  assert.equal(opcaoPorNome(dd.type_config.options, "monetizacao"), "op2");
  assert.equal(opcaoPorNome(dd.type_config.options, "RH"), null);
});

test("medições do Brain: CPMQL menor melhor, alvo lido do nome da KR", () => {
  const m = calcularMedicoesBrain(
    { campanhas: [{ investimento: 3000, mql: 10 }], trafegoDia: [], metricasPessoa: [], ticketReal: null },
    new Map([["86e2gnh64", "CPMQL ≤ R$ 250"]]),
  );
  assert.equal(m.get("86e2gnh64").progresso, 250 / 300);
});

// --- Espelho e eventos ---------------------------------------------------------------------------

const campoDd = (nome, valor, opcoes) => ({
  id: nome,
  name: nome,
  type: "drop_down",
  value: valor,
  type_config: { options: opcoes.map((n, i) => ({ id: `${nome}-${i}`, name: n, orderindex: i })) },
});

test("linhaDoEspelho: datas em ms viram ISO, donos, tema e unidade pelos campos", () => {
  const t = tarefa("T1", {
    list: { id: "L9", name: "Compromissos da rotina" },
    folder: { id: "F9", name: "Rotina Semanal" },
    assignees: [{ id: 123, username: "Victor Eliezek", email: "v@x" }],
    due_date: String(Date.UTC(2026, 9, 3, 15)),
    date_created: String(Date.UTC(2026, 8, 29, 12)),
    date_updated: String(Date.UTC(2026, 8, 29, 13)),
    custom_fields: [
      campoDd("Tema", 1, ["Growth", "Financeiro e Operações"]),
      campoDd("Unidade", 0, ["Belém", "Rede"]),
    ],
  });
  const l = linhaDoEspelho(t);
  assert.equal(l.prazo, "2026-10-03T15:00:00.000Z");
  assert.equal(l.pasta_nome, "Rotina Semanal");
  assert.deepEqual(l.donos, [{ id: "123", nome: "Victor Eliezek", email: "v@x" }]);
  assert.equal(l.tema, "Financeiro e Operações");
  assert.equal(l.unidade, "Belém");
  assert.equal(l.concluida, false);
  assert.equal(l.concluida_em, null);
});

test("diferencas: criada, prazo empurrado, dono, concluída, sumiu; trava de universo", () => {
  const base = linhaDoEspelho(tarefa("T1", { due_date: String(Date.UTC(2026, 9, 1)) }));
  const outra = linhaDoEspelho(tarefa("T2"));
  const depois = {
    ...base,
    prazo: new Date(Date.UTC(2026, 9, 8)).toISOString(),
    donos: [{ id: "9", nome: "Ana", email: null }],
    concluida: true,
    status: "concluído",
  };
  const nova = linhaDoEspelho(tarefa("T3"));
  const ev = diferencas([base, outra], [depois, nova]);
  const tipos = ev.map((e) => `${e.tarefa_id}:${e.tipo}`).sort();
  assert.deepEqual(tipos, ["T1:concluida", "T1:dono", "T1:prazo", "T2:sumiu", "T3:criada"]);
  assert.equal(podeMarcarSumidas(100, 40), false);
  assert.equal(podeMarcarSumidas(100, 60), true);
  assert.equal(podeMarcarSumidas(0, 0), true);
});

// --- OKRs por tema ------------------------------------------------------------------------------

const snap = (dia, kr, depto, p) => ({ dia, kr_id: kr, departamento: depto, objetivo: "O", kr_nome: kr, progresso: p, origem: "acoes" });

test("okrs do tema: série por departamento, só os departamentos do tema, foto parada", () => {
  const linhas = [
    snap("2026-09-01", "k1", "Operações · Victor", 0.4),
    snap("2026-09-01", "k2", "Operações · Victor", "0.6"),
    snap("2026-09-02", "k1", "Operações · Victor", 0.5),
    snap("2026-09-02", "k2", "Operações · Victor", 0.7),
    snap("2026-09-02", "k3", "Operações · Victor", null),
    snap("2026-09-02", "k9", "Receitas · Pedro Luca", 0.9),
  ];
  const o = montarOkrsTema("financeiro-operacoes", linhas, "2026-09-29");
  assert.equal(o.ultimoDia, "2026-09-02");
  assert.equal(o.parado, true);
  assert.equal(o.estado, "parcial");
  assert.equal(o.departamentos.length, 1);
  const d = o.departamentos[0];
  assert.equal(d.base, "Operações");
  assert.equal(d.serie.length, 2);
  assert.equal(Number(d.serie[0].progresso.toFixed(3)), 0.5);
  assert.equal(Number(d.progresso.toFixed(3)), 0.6);
  assert.equal(d.krs.total, 3);
  assert.equal(d.krs.semMedicao, 1);
  assert.equal(d.piorKr.nome, "k1");
  assert.deepEqual(o.semFoto, ["Auditoria & Qualidade"]);
  const vazio = montarOkrsTema("growth", [], "2026-09-29");
  assert.equal(vazio.estado, "fonte_indisponivel");
});

// --- Compromissos --------------------------------------------------------------------------------

const AGORA = "2026-09-29T12:00:00.000Z";
const linha = (id, extra = {}) => ({
  ...linhaDoEspelho(tarefa(id)),
  donos: [{ id: "1", nome: "Victor", email: null }],
  tema: "Financeiro e Operações",
  atualizada_em: "2026-09-28T12:00:00.000Z",
  criada_em: "2026-09-20T12:00:00.000Z",
  ...extra,
});

test("temaDoTexto aceita título, rótulo do menu, dia e sem acento", () => {
  assert.equal(temaDoTexto("Monetização"), "monetizacao");
  assert.equal(temaDoTexto("Ter · Financeiro e Operações"), "financeiro-operacoes");
  assert.equal(temaDoTexto("quarta"), "cs-rh");
  assert.equal(temaDoTexto("cs e rh"), "cs-rh");
  assert.equal(temaDoTexto("Outra coisa"), null);
});

test("fila: vencidos primeiro, depois prazo, sem prazo, concluídos por último; higiene", () => {
  const cs = [
    linha("semprazo"),
    linha("futuro", { prazo: "2026-10-05T12:00:00.000Z" }),
    linha("vencidoNovo", { prazo: "2026-09-28T12:00:00.000Z" }),
    linha("vencidoVelho", { prazo: "2026-09-20T12:00:00.000Z", donos: [] }),
    linha("feito", { concluida: true, prazo: "2026-09-25T12:00:00.000Z", concluida_em: "2026-09-24T12:00:00.000Z" }),
    linha("parado", { prazo: "2026-10-10T12:00:00.000Z", atualizada_em: "2026-09-10T12:00:00.000Z" }),
  ].map((l) => lerCompromisso(l, [], AGORA));
  assert.deepEqual(
    ordenarFila(cs).map((c) => c.id),
    ["vencidoVelho", "vencidoNovo", "futuro", "parado", "semprazo", "feito"],
  );
  assert.deepEqual(higiene(cs), { semDono: 1, semPrazo: 1, vencidos: 2, parados: 1, semTema: 0 });
  const feito = cs.find((c) => c.id === "feito");
  assert.equal(feito.cumpridoNoPrazo, true);
  assert.equal(cs.find((c) => c.id === "vencidoVelho").diasVencido, 9);
});

test("adiamentos contam só prazo empurrado para frente", () => {
  const ev = [
    { tarefa_id: "a", tipo: "prazo", de: "2026-09-10T00:00:00.000Z", para: "2026-09-17T00:00:00.000Z", em: "x" },
    { tarefa_id: "a", tipo: "prazo", de: "2026-09-17T00:00:00.000Z", para: "2026-09-24T00:00:00.000Z", em: "x" },
    { tarefa_id: "a", tipo: "prazo", de: "2026-09-24T00:00:00.000Z", para: "2026-09-20T00:00:00.000Z", em: "x" },
    { tarefa_id: "b", tipo: "prazo", de: "2026-09-10T00:00:00.000Z", para: "2026-09-17T00:00:00.000Z", em: "x" },
  ];
  assert.equal(lerCompromisso(linha("a"), ev, AGORA).adiamentos, 2);
});

test("reunião anterior do mesmo tema e execução do tema", () => {
  // Terça 29/09: a reunião de terça é hoje, então a anterior é 22/09; a de segunda já foi (28/09).
  assert.equal(reuniaoAnterior("financeiro-operacoes", "2026-09-29"), "2026-09-22");
  assert.equal(reuniaoAnterior("growth", "2026-09-29"), "2026-09-28");
  assert.equal(reuniaoAnterior("estrategico", "2026-09-29"), "2026-09-25");
  const cs = [
    linha("v", { prazo: "2026-09-25T12:00:00.000Z" }),
    linha("f", { concluida: true, concluida_em: "2026-09-23T10:00:00.000Z" }),
    linha("f-velho", { concluida: true, concluida_em: "2026-09-21T10:00:00.000Z" }),
    linha("outro-tema", { tema: "Growth", prazo: "2026-09-25T12:00:00.000Z" }),
  ].map((l) => lerCompromisso(l, [], AGORA));
  const e = execucaoDoTema("financeiro-operacoes", cs, "2026-09-29");
  assert.equal(e.abertos, 1);
  assert.equal(e.vencidos, 1);
  assert.equal(e.feitosDesdeUltima, 1);
  assert.equal(e.destaques[0].id, "v");
});

test("revisão da semana por tema e taxa no prazo", () => {
  const cs = [
    linha("noprazo", { prazo: "2026-09-30T12:00:00.000Z", concluida: true, concluida_em: "2026-09-29T09:00:00.000Z" }),
    linha("atraso", { prazo: "2026-09-28T12:00:00.000Z", concluida: true, concluida_em: "2026-09-29T09:00:00.000Z" }),
    linha("vencido", { prazo: "2026-09-28T12:00:00.000Z" }),
    linha("aberto", { prazo: "2026-10-02T12:00:00.000Z" }),
    linha("fora", { prazo: "2026-10-09T12:00:00.000Z" }),
  ].map((l) => lerCompromisso(l, [], AGORA));
  const r = revisaoDaSemana(cs, "2026-09-29").find((x) => x.tema === "financeiro-operacoes");
  assert.deepEqual(r, { tema: "financeiro-operacoes", noPrazo: 1, comAtraso: 1, vencidos: 1, abertos: 1 });
  assert.equal(Number(taxaNoPrazo(revisaoDaSemana(cs, "2026-09-29")).toFixed(2)), 33.33);
  assert.equal(taxaNoPrazo(revisaoDaSemana([], "2026-09-29")), null);
});

// --- Reflexo do ClickUp: tarefas das áreas junto dos compromissos (pedido do Pedro, 30/09) --------

const noEspaco = (id, pasta, lista, extra = {}) =>
  linha(id, { pasta_nome: pasta, lista_nome: lista, tema: null, ...extra });

test("lerTarefas: tarefas das áreas e compromissos; Minha Semana e guias ficam de fora", () => {
  const unidades = lerUnidades([
    { id: 8, nome_da_praca: "Maceió", tipo: "regional", data_inauguracao: "2026-05-01" },
    { id: 3, nome_da_praca: "Belém", tipo: "regional", data_inauguracao: "2025-06-01" },
  ]);
  const linhas = [
    noEspaco("c1", "🗓️ Rotina Semanal · Paulo", "✅ Compromissos da rotina", { tema: "Growth", nome: "Cobrar Belém" }),
    noEspaco("d1", "🗓️ Rotina Semanal · Paulo", "📅 Minha Semana", { nome: "D2 · TERÇA · Finance e Ops" }),
    noEspaco("g1", "Comercial · Renan", "📖 COMECE AQUI · Guia de uso"),
    noEspaco("kr1", "Operações · Victor", "Garantir um modelo financeiro sustentável", { nome: "Implantação do Broker 100% das unidades" }),
    noEspaco("e1", "Operações · Victor", "Garantir um modelo financeiro sustentável", { nome: "Maceió", parent_id: "kr1", donos: [] }),
    noEspaco("dir1", "Marketing · Simão e Tiago", "🗣️ Direcionamentos (1:1)", { nome: "Rever criativos" }),
    noEspaco("s1", "Novos Sócios . Paulo", "Construir a base", { nome: "Onboarding" }),
  ];
  const ts = lerTarefas({ linhas, eventos: [] }, AGORA, unidades);
  assert.deepEqual(ts.map((t) => t.id), ["c1", "kr1", "e1", "dir1", "s1"]);
  const por = Object.fromEntries(ts.map((t) => [t.id, t]));
  assert.deepEqual(
    [por.c1.origemTarefa, por.c1.tipo, por.c1.departamento, por.c1.tema],
    ["rotina", "compromisso", null, "growth"],
  );
  // O tema da tarefa de área vem da pasta do departamento (mapa aprovado pelo COO).
  assert.deepEqual(
    [por.kr1.origemTarefa, por.kr1.tipo, por.kr1.departamento, por.kr1.tema],
    ["area", "kr", "Operações", "financeiro-operacoes"],
  );
  // Entrega: o nome da KR mãe e a unidade achada no nome da tarefa.
  assert.deepEqual([por.e1.tipo, por.e1.pai, por.e1.unidade, por.e1.dono], ["entrega", "Implantação do Broker 100% das unidades", "Maceió", null]);
  assert.deepEqual([por.dir1.tipo, por.dir1.tema], ["direcionamento", "growth"]);
  // "Novos Sócios . Paulo" (ponto em vez de ·) também casa com o departamento.
  assert.deepEqual([por.s1.departamento, por.s1.tema], ["Novos Sócios", "estrategico"]);
});

test("execução do tema: tarefas da área e compromissos, com vence em 7 dias, sem dono e até 5 destaques", () => {
  const op = (id, extra) => noEspaco(id, "Operações · Victor", "Objetivo", extra);
  const ts = lerTarefas(
    {
      linhas: [
        op("v1", { prazo: "2026-09-10T12:00:00.000Z" }),
        op("v2", { prazo: "2026-09-20T12:00:00.000Z", donos: [] }),
        op("s1", { prazo: "2026-10-02T12:00:00.000Z" }),
        op("s2", { prazo: "2026-10-06T12:00:00.000Z" }),
        op("longe", { prazo: "2026-10-20T12:00:00.000Z" }),
        op("semprazo", { donos: [] }),
        op("feita", { concluida: true, concluida_em: "2026-09-24T12:00:00.000Z" }),
        noEspaco("aud", "Auditoria & Qualidade · Amanda/Sumaya", "01 · Autofinanciamento", { prazo: "2026-09-30T12:00:00.000Z" }),
        noEspaco("mkt", "Marketing · Simão e Tiago", "O1", { prazo: "2026-09-25T12:00:00.000Z" }),
      ],
      eventos: [],
    },
    AGORA,
  );
  const e = execucaoDoTema("financeiro-operacoes", ts, "2026-09-29");
  // Operações + Auditoria & Qualidade: 7 abertas (a de Marketing é de segunda).
  assert.equal(e.abertos, 7);
  assert.equal(e.vencidos, 2);
  // Até 06/10: aud (30/09), s1 (02/10) e s2 (06/10).
  assert.equal(e.vencemEm7, 3);
  assert.equal(e.semDono, 2);
  assert.equal(e.feitosDesdeUltima, 1);
  assert.deepEqual(e.destaques.map((c) => c.id), ["v1", "v2", "aud", "s1", "s2"]);
});

test("prazo igual escrito de outro jeito não é mudança nem adiamento (bug de 30/09)", () => {
  // O banco devolve "+00:00"; a leitura nova, ".000Z". Antes: um evento por tarefa a cada 10 minutos.
  assert.equal(mesmoInstante("2026-07-30T07:00:00+00:00", "2026-07-30T07:00:00.000Z"), true);
  assert.equal(mesmoInstante("2026-07-30T07:00:00+00:00", "2026-08-06T07:00:00.000Z"), false);
  assert.equal(mesmoInstante(null, "2026-07-30T07:00:00.000Z"), false);
  const antes = { ...linhaDoEspelho(tarefa("x")), prazo: "2026-07-30T07:00:00+00:00" };
  const agora = { ...antes, prazo: "2026-07-30T07:00:00.000Z" };
  assert.deepEqual(diferencas([antes], [agora]), []);
  // Os eventos falsos que já estão gravados não contam como adiamento.
  const ev = [
    { tarefa_id: "x", tipo: "prazo", de: "2026-07-30T07:00:00+00:00", para: "2026-07-30T07:00:00.000Z", em: "a" },
    { tarefa_id: "x", tipo: "prazo", de: "2026-07-30T07:00:00+00:00", para: "2026-08-06T07:00:00.000Z", em: "b" },
  ];
  assert.equal(lerCompromisso(linha("x"), ev, AGORA).adiamentos, 1);
});

test("prazo sem hora do ClickUp (04h de São Paulo) só vence no dia seguinte", () => {
  // 30/09 às 13h UTC (10h em São Paulo): a tarefa de hoje não está vencida; a de ontem está, há 1 dia.
  const agora = "2026-09-30T13:00:00.000Z";
  const hoje = lerCompromisso(linha("h", { prazo: "2026-09-30T07:00:00.000Z" }), [], agora);
  assert.equal(hoje.vencido, false);
  const ontem = lerCompromisso(linha("o", { prazo: "2026-09-29T07:00:00.000Z" }), [], agora);
  assert.equal(ontem.vencido, true);
  assert.equal(ontem.diasVencido, 1);
  // 00h30 UTC do dia 1º ainda é 30/09 em São Paulo: a tarefa de 30/09 continua no prazo.
  assert.equal(lerCompromisso(linha("h2", { prazo: "2026-09-30T07:00:00.000Z" }), [], "2026-10-01T00:30:00.000Z").vencido, false);
});
