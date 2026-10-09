// Tela Gravações da Monetização (spec 2026-10-02-monetizacao-gravacoes-tela.md): a montagem da lista a partir do card e
// de ops.monetizacao_reunioes, o recorte do closer, o minuto e a confiança do ofertado, e a gravação no campo
// "Caixa · Produtos ofertados" com o Pipedrive simulado. A trava no banco tem teste próprio: tests/monetizacao-gravacoes.sql.
import test from "node:test";
import assert from "node:assert/strict";
import {
  contarSituacoes,
  filtrar,
  mesesDaLista,
  minuto,
  montarReunioes,
  nomeDoArquivo,
  ofertadoDaFicha,
  recorte,
  transcricaoEmTexto,
} from "../src/lib/monetizacao/gravacoes.ts";
import {
  CAMPO_OFERTADOS,
  detalharOfertado,
  gravarOfertados,
  lerOpcoes,
  LIMIAR_GRAVAR,
  localizarTrecho,
  produtosParaGravar,
  uniaoDeOpcoes,
} from "../supabase/functions/monetizacao-reunioes/ofertado.ts";

const A = 900000001; // closer A
const B = 900000002; // closer B
// O pipe 39 depois de 01/10, com a ordem da carga.
const ST = [
  { id: 274, name: "1 · Base elegível", order: 1 },
  { id: 276, name: "2 · Abordagem iniciada", order: 2 },
  { id: 290, name: "3 · Conexão", order: 3 },
  { id: 275, name: "Gatilho (encerrada em 01/10 · não usar)", order: 4 },
  { id: 277, name: "4 · Reunião de levantamento agendada", order: 5 },
  { id: 287, name: "5 · Reunião de levantamento realizada", order: 6 },
  { id: 291, name: "6 · Reunião de proposta", order: 7 },
  { id: 279, name: "7 · Em negociação", order: 8 },
  { id: 278, name: "8 · Proposta enviada", order: 9 },
  { id: 288, name: "9 · Stand by", order: 10 },
];
const NOME = Object.fromEntries(ST.map((s) => [s.id, s.name]));
const vazio = { loaded: [], started: [], scheduled: [], meeting: [], validated: [], signed: [] };
const card = (id, owner, stage, moves, extra = {}) => ({
  id,
  title: `Card ${id} - Caixa`,
  org: `Empresa ${id}`,
  org_id: id,
  owner: owner === A ? "Closer A" : "Closer B",
  owner_id: owner,
  route: "cella",
  status: "open",
  stage_id: stage,
  stage: NOME[stage],
  order: 0,
  events: vazio,
  created_at: "2026-09-01",
  started_at: null,
  validated_at: null,
  signed_on: null,
  moves: moves.map(([stage_id, at]) => ({ stage_id, at, date: at.slice(0, 10), actor_id: owner })),
  expected_close: null,
  revenue: {},
  next_activity: null,
  history_known: true,
  url: `https://planning.pipedrive.com/deal/${id}`,
  ...extra,
});

// 1: passou por agendada (2 dias) e realizada; está em Proposta enviada. Levantamento de 03/09, sem gravação.
const c1 = card(1, A, 278, [
  [274, "2026-09-01 12:00:00"],
  [276, "2026-09-01 12:10:00"],
  [277, "2026-09-01 13:00:00"],
  [287, "2026-09-03 17:00:00"],
  [278, "2026-09-04 12:00:00"],
]);
// 2: está em levantamento agendada (de B): reunião pendente sem registro no card.
const c2 = card(2, B, 277, [
  [274, "2026-09-20 12:00:00"],
  [277, "2026-09-29 15:00:00"],
]);
// 3: de A, foi para Reunião de proposta em 02/10 e está lá; o levantamento é de 30/09.
const c3 = card(3, A, 291, [
  [274, "2026-09-25 12:00:00"],
  [277, "2026-09-26 12:00:00"],
  [287, "2026-09-30 18:00:00"],
  [291, "2026-10-02 14:00:00"],
]);
// 4: tocou em agendada por 5 minutos e voltou: não chegou à reunião.
const c4 = card(4, A, 290, [
  [274, "2026-09-25 12:00:00"],
  [277, "2026-09-26 12:00:00"],
  [290, "2026-09-26 12:05:00"],
]);
// 5: de B, perdido depois de agendada: reunião sem gravação (a etapa de hoje diz Perdido).
const c5 = card(5, B, 277, [[277, "2026-09-10 12:00:00"]], { status: "lost" });
const CARDS = [c1, c2, c3, c4, c5];

const banco = (event_id, deal_id, closer, status, extra = {}) => ({
  event_id,
  deal_id,
  tipo: "levantamento",
  inicio: "2026-10-03T17:00:00+00:00",
  fim: null,
  status,
  closer_pipedrive_id: closer,
  nota: null,
  ofertado: null,
  ofertados_gravados: null,
  ofertados_gravados_em: null,
  erro: null,
  nota_pipedrive_id: null,
  updated_at: null,
  bot: null,
  transcricao: null,
  ...extra,
});
// O servidor já recortou as reuniões registradas; aqui o admin recebe as de A e B.
const REGISTRADAS = [
  banco("pedido-monet-2-20261003T1700", 2, B, "na_fila"),
  banco("pedido-monet-2-20260930T1500", 2, B, "cancelada", { inicio: "2026-09-30T15:00:00+00:00" }),
  banco("pedido-monet-77-20261001T1300", 77, A, "avaliada", {
    inicio: "2026-10-01T13:00:00+00:00",
    nota: "7.5",
    ofertado: { cella: true, consultoria: false, finance: true },
  }),
];

test("montagem: histórico do card, reunião registrada no lugar dela, cancelada fora", () => {
  const lista = montarReunioes({
    cards: CARDS,
    stages: ST,
    lista: { admin: true, closers: [], reunioes: REGISTRADAS },
  });
  const chaves = lista.map((r) => r.chave);
  assert.deepEqual(chaves, [
    "pedido-monet-2-20261003T1700",
    "hist-3-proposta",
    "pedido-monet-77-20261001T1300",
    "hist-3-levantamento",
    "hist-5-levantamento",
    "hist-1-levantamento",
  ]);
  const porChave = Object.fromEntries(lista.map((r) => [r.chave, r]));
  // Card 1: a data é a entrada em realizada, não em agendada.
  assert.equal(porChave["hist-1-levantamento"].data, "2026-09-03T17:00:00.000Z");
  assert.equal(porChave["hist-1-levantamento"].situacao, "sem_gravacao");
  assert.equal(porChave["hist-1-levantamento"].mes, "2026-09");
  // Card 2: a registrada substitui a do histórico; a cancelada não aparece.
  assert.ok(!chaves.includes("hist-2-levantamento"));
  assert.equal(porChave["pedido-monet-2-20261003T1700"].situacao, "na_fila");
  assert.equal(porChave["pedido-monet-2-20261003T1700"].empresa, "Empresa 2");
  // Card 3: proposta pendente (está na etapa agora) = sem registro no card.
  assert.equal(porChave["hist-3-proposta"].situacao, "sem_registro");
  assert.equal(porChave["hist-3-levantamento"].situacao, "sem_gravacao");
  // Card 4: toque desfeito em 5 min não é reunião.
  assert.ok(!chaves.some((c) => c.startsWith("hist-4")));
  // Card 5: perdido em agendada = sem gravação, e a etapa diz.
  assert.equal(porChave["hist-5-levantamento"].situacao, "sem_gravacao");
  assert.equal(porChave["hist-5-levantamento"].etapa, "Perdido · Reunião de levantamento agendada");
  // Registrada de card fora da carga: identificada pelo número, com o ofertado da lista.
  const fora = porChave["pedido-monet-77-20261001T1300"];
  assert.equal(fora.empresa, "Card 77");
  assert.equal(fora.etapa, "Fora do pipe 39");
  assert.equal(fora.nota, 7.5);
  assert.deepEqual(fora.ofertado, ["cella", "finance"]);
});

test("trava na tela: closer A não vê reunião de card do closer B; admin vê", () => {
  // O servidor manda ao closer A só as registradas dele (aqui: a do card 77).
  const doA = montarReunioes({
    cards: CARDS,
    stages: ST,
    lista: {
      admin: false,
      closers: [A],
      reunioes: REGISTRADAS.filter((r) => r.closer_pipedrive_id === A),
    },
  });
  assert.ok(
    doA.every((r) => r.closer_id === A),
    "linha de outro closer na lista do A",
  );
  assert.ok(!doA.some((r) => r.deal_id === 2 || r.deal_id === 5));
  assert.deepEqual(
    doA.map((r) => r.chave).sort(),
    [
      "hist-1-levantamento",
      "hist-3-levantamento",
      "hist-3-proposta",
      "pedido-monet-77-20261001T1300",
    ].sort(),
  );
  const admin = montarReunioes({
    cards: CARDS,
    stages: ST,
    lista: { admin: true, closers: [], reunioes: REGISTRADAS },
  });
  assert.ok(admin.some((r) => r.deal_id === 2) && admin.some((r) => r.deal_id === 5));
  // Quem não é closer nem admin: nada, nem do histórico.
  const ninguem = montarReunioes({
    cards: CARDS,
    stages: ST,
    lista: { admin: false, closers: [], reunioes: [] },
  });
  assert.equal(ninguem.length, 0);
});

test("recorte, filtro por situação, contagem e meses", () => {
  const lista = montarReunioes({
    cards: CARDS,
    stages: ST,
    lista: { admin: true, closers: [], reunioes: REGISTRADAS },
  });
  assert.deepEqual(mesesDaLista(lista), ["2026-10", "2026-09"]);
  const out = recorte(lista, { mes: "2026-10" });
  assert.equal(out.length, 3);
  const n = contarSituacoes(out);
  assert.deepEqual(n, {
    na_fila: 1,
    gravando: 0,
    avaliada: 1,
    sem_gravacao: 0,
    erro: 0,
    sem_registro: 1,
  });
  assert.equal(filtrar(lista, { gravacao: "sem_gravacao" }).length, 3);
  assert.equal(filtrar(lista, { q: "empresa 3" }).length, 2);
  assert.equal(filtrar(lista, { q: "closer b", gravacao: "na_fila" }).length, 1);
  // A soma das situações é o total do recorte (N2: o número abre exatamente as linhas).
  const set = recorte(lista, { mes: "2026-09" });
  assert.equal(
    Object.values(contarSituacoes(set)).reduce((s, x) => s + x, 0),
    set.length,
  );
});

const FALAS = [
  {
    ordem: 0,
    inicio_s: 0,
    falante: "Falante 1",
    texto: "Bom dia, obrigado por receber a gente hoje.",
  },
  {
    ordem: 1,
    inicio_s: 192.4,
    falante: "Falante 1",
    texto:
      "A primeira frente é a tese tributária da Cella, que revisa o que a empresa pagou a mais nos últimos cinco anos.",
  },
  {
    ordem: 2,
    inicio_s: 425,
    falante: "Falante 2",
    texto:
      "Sobre crédito, hoje a gente tem uma linha cara no banco e queria entender se dá para trocar por uma mais barata.",
  },
];

test("ofertado: minuto e confiança do trecho (alta = inteiro numa fala; média = 12 palavras)", () => {
  const alta = localizarTrecho(
    "a tese tributária da Cella, que revisa o que a empresa pagou a mais",
    FALAS,
  );
  assert.deepEqual(alta, { confianca: "alta", inicio_s: 192.4, ordem: 1 });
  const media = localizarTrecho(
    "hoje a gente tem uma linha cara no banco e queria entender, segundo o cliente, outra coisa qualquer",
    FALAS,
  );
  assert.equal(media?.confianca, "media");
  assert.equal(media?.inicio_s, 425);
  assert.equal(localizarTrecho("curto demais", FALAS), null);
  assert.equal(
    localizarTrecho("um trecho inventado que não aparece em fala nenhuma da reunião", FALAS),
    null,
  );
  assert.equal(minuto(192.4), "03:12");
  assert.equal(minuto(3725), "1:02:05");
});

test("ofertado: limiar para o campo do pipe é confiança alta", () => {
  assert.equal(LIMIAR_GRAVAR, "alta");
  const det = detalharOfertado(
    {
      cella: {
        apresentado: "sim",
        evidencia: "a tese tributária da Cella, que revisa o que a empresa pagou a mais",
      },
      finance: {
        apresentado: "sim",
        evidencia:
          "hoje a gente tem uma linha cara no banco e queria entender, segundo o cliente, outra coisa",
      },
      consultoria: { apresentado: "nao", evidencia: "" },
    },
    FALAS,
  );
  assert.equal(det.cella.confianca, "alta");
  assert.equal(det.finance.confianca, "media");
  assert.equal(det.consultoria.confianca, null);
  assert.deepEqual(produtosParaGravar(det), ["cella"]);
  // Avaliação antiga, sem confiança gravada: nada passa.
  assert.deepEqual(produtosParaGravar({ cella: { apresentado: "sim", evidencia: "x" } }), []);
  // A ficha usa o que foi gravado e calcula o que faltar.
  const ficha = ofertadoDaFicha({ ofertado: det, falas: FALAS });
  assert.equal(ficha.cella.inicio_s, 192.4);
  const antiga = ofertadoDaFicha({
    ofertado: { cella: { apresentado: "sim", evidencia: det.cella.evidencia } },
    falas: FALAS,
  });
  assert.equal(antiga.cella.confianca, "alta");
});

test("campo de várias opções: leitura e união", () => {
  assert.deepEqual(lerOpcoes("1152,1150"), [1150, 1152]);
  assert.deepEqual(lerOpcoes(1151), [1151]);
  assert.deepEqual(lerOpcoes(null), []);
  assert.deepEqual(lerOpcoes("1150,9999,1150"), [1150]);
  assert.deepEqual(uniaoDeOpcoes([1152], [1150]), [1150, 1152]);
});

/** Pipedrive simulado: guarda as chamadas e devolve o card com o campo. */
function pipedrive(valorAtual) {
  const chamadas = [];
  const pd = async (path, params = {}, payload, method = "POST") => {
    chamadas.push({ path, method: payload ? method : "GET", payload });
    if (!payload) return { data: { id: 1, [CAMPO_OFERTADOS]: valorAtual } };
    return { data: { id: 1 } };
  };
  return { pd, chamadas };
}
const OFERTADO_CELLA_ALTA = {
  cella: { apresentado: "sim", evidencia: "x", confianca: "alta", inicio_s: 192 },
  finance: { apresentado: "sim", evidencia: "y", confianca: "media", inicio_s: 425 },
  consultoria: { apresentado: "nao", evidencia: "", confianca: null, inicio_s: null },
};
const AGORA = () => new Date("2026-10-02T18:00:00Z");

test("gravar ofertados: desligado não chama a API", async () => {
  const { pd, chamadas } = pipedrive("1152");
  const registros = [];
  const r = await gravarOfertados({
    ligado: false,
    reuniao: { deal_id: 1, ofertado: OFERTADO_CELLA_ALTA, ofertados_gravados_em: null },
    pd,
    registrar: async (p) => registros.push(p),
  });
  assert.equal(r.situacao, "desligado");
  assert.equal(chamadas.length, 0);
  assert.equal(registros.length, 0);
});

test("gravar ofertados: ligado faz PUT com a união e registra o que somou", async () => {
  const { pd, chamadas } = pipedrive("1152"); // Finance já marcado pelo closer
  const registros = [];
  const r = await gravarOfertados({
    ligado: true,
    reuniao: { deal_id: 1, ofertado: OFERTADO_CELLA_ALTA, ofertados_gravados_em: null },
    pd,
    registrar: async (p) => registros.push(p),
    agora: AGORA,
  });
  assert.equal(r.situacao, "gravado");
  assert.deepEqual(r.somados, ["cella"]);
  assert.deepEqual(
    chamadas.map((c) => `${c.method} ${c.path}`),
    ["GET deals/1", "PUT deals/1"],
  );
  assert.deepEqual(
    chamadas[1].payload,
    { [CAMPO_OFERTADOS]: "1150,1152" },
    "a união mantém o Finance",
  );
  assert.deepEqual(registros, [
    { ofertados_gravados: ["cella"], ofertados_gravados_em: "2026-10-02T18:00:00.000Z" },
  ]);
});

test("gravar ofertados: nada a somar não chama a API (ou só lê, se já estiver marcado)", async () => {
  // Nenhum produto com confiança alta: nenhuma chamada ao Pipedrive.
  const semAlta = pipedrive("");
  const reg1 = [];
  const r1 = await gravarOfertados({
    ligado: true,
    reuniao: {
      deal_id: 1,
      ofertado: {
        ...OFERTADO_CELLA_ALTA,
        cella: { ...OFERTADO_CELLA_ALTA.cella, confianca: "media" },
      },
      ofertados_gravados_em: null,
    },
    pd: semAlta.pd,
    registrar: async (p) => reg1.push(p),
    agora: AGORA,
  });
  assert.equal(r1.situacao, "nada_a_somar");
  assert.equal(semAlta.chamadas.length, 0);
  assert.deepEqual(reg1, [
    { ofertados_gravados: [], ofertados_gravados_em: "2026-10-02T18:00:00.000Z" },
  ]);
  // Cella já marcada no card: só a leitura, nenhum PUT.
  const marcado = pipedrive("1150,1151");
  const r2 = await gravarOfertados({
    ligado: true,
    reuniao: { deal_id: 1, ofertado: OFERTADO_CELLA_ALTA, ofertados_gravados_em: null },
    pd: marcado.pd,
    registrar: async () => {},
    agora: AGORA,
  });
  assert.equal(r2.situacao, "ja_marcado");
  assert.deepEqual(
    marcado.chamadas.map((c) => c.method),
    ["GET"],
  );
});

test("gravar ofertados: idempotente e ensaio sem escrita", async () => {
  const feito = pipedrive("1150");
  const r = await gravarOfertados({
    ligado: true,
    reuniao: {
      deal_id: 1,
      ofertado: OFERTADO_CELLA_ALTA,
      ofertados_gravados_em: "2026-10-02T17:00:00Z",
    },
    pd: feito.pd,
    registrar: async () => assert.fail("registrou de novo"),
  });
  assert.equal(r.situacao, "ja_gravado");
  assert.equal(feito.chamadas.length, 0);
  const ensaio = pipedrive(null);
  const d = await gravarOfertados({
    ligado: true,
    dry: true,
    reuniao: { deal_id: 1, ofertado: OFERTADO_CELLA_ALTA, ofertados_gravados_em: null },
    pd: ensaio.pd,
    registrar: async () => assert.fail("ensaio registrou"),
  });
  assert.equal(d.situacao, "gravaria");
  assert.deepEqual(d.depois, [1150]);
  assert.deepEqual(
    ensaio.chamadas.map((c) => c.method),
    ["GET"],
  );
});

test("exportar transcrição em texto", () => {
  const r = {
    empresa: "Empresa Ação Ltda",
    deal_id: 42,
    tipo: "levantamento",
    data: "2026-10-02T17:00:00+00:00",
    closer: "Closer A",
  };
  const texto = transcricaoEmTexto(r, { falas: FALAS, nomes: { "Falante 1": "Matheus" } });
  const linhas = texto.split("\n");
  assert.equal(linhas[0], "Reunião de levantamento com sócio · Empresa Ação Ltda · card 42");
  assert.equal(linhas[1], "02/10/2026 14:00 (horário de Brasília) · closer: Closer A");
  assert.ok(linhas.includes("[03:12] Matheus: " + FALAS[1].texto));
  assert.ok(linhas.includes("[07:05] Falante 2: " + FALAS[2].texto));
  assert.equal(nomeDoArquivo(r), "transcricao-empresa-acao-ltda-card-42-2026-10-02.txt");
});
