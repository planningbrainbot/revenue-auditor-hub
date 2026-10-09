// Avaliação das ligações da pré-venda (pipe 39): formato da Api4Com, escolha da ligação mais longa (3B), nota do
// script v2, conferência de trecho, pedido à OpenRouter e a rodada inteira (captura → escolha → transcrição →
// avaliação → notas), com Pipedrive, banco, download e IA simulados em memória. Nada aqui chama rede.
import test from "node:test";
import assert from "node:assert/strict";
import {
  base64,
  chamarOpenRouter,
  corpoAvaliacao,
  corpoTranscricao,
  criarIa,
  escolher,
  gravarNotas,
  instanteSaoPaulo,
  janela,
  lerApi4Com,
  lerTranscricao,
  ligacaoDaAtividade,
  mudou,
  notaAvaliacaoHtml,
  notaQualificacaoHtml,
  rodarLigacoes,
} from "../supabase/functions/monetizacao-ligacoes/logica.ts";
import {
  VERSAO_REGUA,
  apurar,
  calcularNota,
  execucaoDasPerguntas,
} from "../supabase/functions/monetizacao-ligacoes/rubrica-ligacao.ts";

const copia = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const AGORA = new Date("2026-10-09T18:00:00Z"); // 15h de São Paulo

// Formato real da integração Api4Com → Pipedrive (conferido em 1.658 atividades de 07 a 09/10/2026).
const assuntoAtendida = (ini, fim, dia = "09/10/2026") =>
  `Ligação para (11) 98765-4321 atendida às ${dia} ${ini} e encerrada às ${dia} ${fim}`;
const notaAtendida = (uuid, dur) =>
  `Para acessar a gravação desta ligação <a href="https://listener.api4com.com/files/listen/${uuid}.mp3" ` +
  `rel="noopener noreferrer" target="_blank">clique aqui</a> &gt; duração: ${dur}`;
const atividade = (id, deal, extra = {}) => ({
  id,
  deal_id: deal,
  user_id: 28381245,
  owner_name: "Matheus Pereira de Carvalho",
  type: "call",
  due_date: "2026-10-09",
  due_time: "13:00",
  add_time: "2026-10-09 13:05:00",
  done: true,
  ...extra,
});
const atendida = (id, deal, ini, fim, dur, uuid = `u${id}`) =>
  atividade(id, deal, { subject: assuntoAtendida(ini, fim), note: notaAtendida(uuid, dur) });

// ---------------------------------------------------------------------------- formato da Api4Com

test("Api4Com: atendida com duração, mp3 da nota e horário de Brasília gravado em UTC", () => {
  const l = lerApi4Com(
    assuntoAtendida("10:04:10", "10:13:58"),
    notaAtendida("4f1c2d3e-aaaa-bbbb-cccc-000000000001", "00:09:48"),
  );
  assert.deepEqual(l, {
    telefone: "(11) 98765-4321",
    atendida: true,
    inicio: "2026-10-09T13:04:10.000Z",
    duracao_seg: 588,
    motivo: null,
    mp3_url: "https://listener.api4com.com/files/listen/4f1c2d3e-aaaa-bbbb-cccc-000000000001.mp3",
  });
});

test("Api4Com: não atendida traz o motivo, sem mp3 e sem duração", () => {
  const l = lerApi4Com(
    "Ligação para (62) 3333-4444 não foi atendida pelo seguinte motivo: Caixa postal",
    "",
  );
  assert.deepEqual(l, {
    telefone: "(62) 3333-4444",
    atendida: false,
    inicio: null,
    duracao_seg: 0,
    motivo: "Caixa postal",
    mp3_url: null,
  });
});

test("Api4Com: atendida sem a nota fica sem mp3; sem 'duração' a conta sai do início e do fim", () => {
  const l = lerApi4Com(assuntoAtendida("08:04:10", "08:05:02"), null);
  assert.equal(l.atendida, true);
  assert.equal(l.mp3_url, null);
  assert.equal(l.duracao_seg, 52);
  const longa = lerApi4Com(assuntoAtendida("08:00:00", "08:00:00"), notaAtendida("x", "01:02:03"));
  assert.equal(longa.duracao_seg, 3723);
});

test("Api4Com: texto livre do pré-vendedor não é ligação", () => {
  for (const s of [
    "Ligação",
    "DIA 1 - Ligação manhã + WhatsApp",
    "Caixa · D0 · Ligação · tarde",
    "",
    null,
  ])
    assert.equal(lerApi4Com(s, "Ligar para o cliente"), null, String(s));
});

test("Api4Com: horário de verão e virada do dia no fuso de São Paulo", () => {
  assert.equal(
    instanteSaoPaulo("09/10/2026", "22:30:00").toISOString(),
    "2026-10-10T01:30:00.000Z",
  );
  assert.equal(instanteSaoPaulo("31/02/2026", "xx"), null);
});

test("atividade → linha: dono, nome, e a não atendida usa a hora da atividade (UTC)", () => {
  const nao = ligacaoDaAtividade(
    atividade(5, 101, {
      subject: "Ligação para (11) 90000-0000 não foi atendida pelo seguinte motivo: Cancelada",
      note: "",
      due_date: "2026-10-09",
      due_time: "14:37",
    }),
  );
  assert.deepEqual(nao, {
    activity_id: 5,
    deal_id: 101,
    user_id: 28381245,
    pessoa: "Matheus Pereira de Carvalho",
    inicio: "2026-10-09T14:37:00.000Z",
    duracao_seg: 0,
    atendida: false,
    motivo: "Cancelada",
    mp3_url: null,
    telefone: "(11) 90000-0000",
  });
  assert.equal(ligacaoDaAtividade(atividade(6, 101, { subject: "Ligação", note: "" })), null);
});

test("mudou: o mp3 que aparece depois conta como mudança; o mesmo instante em outro formato não", () => {
  const l = ligacaoDaAtividade(atendida(1, 101, "10:00:00", "10:05:00", "00:05:00"));
  assert.equal(mudou({ ...l, inicio: "2026-10-09T13:00:00+00:00" }, l), false);
  assert.equal(mudou({ ...l, mp3_url: null }, l), true);
  assert.equal(mudou({ ...l, duracao_seg: "300" }, l), false);
});

// ---------------------------------------------------------------------------- escolha (3B)

test("escolha: a atendida mais longa com 60 s ou mais e mp3; empate fica com a mais recente", () => {
  const base = { deal_id: 101, user_id: 1, pessoa: "x", motivo: null, telefone: null };
  const l = (id, dur, extra = {}) => ({
    ...base,
    activity_id: id,
    duracao_seg: dur,
    atendida: true,
    mp3_url: `https://listener.api4com.com/files/listen/${id}.mp3`,
    inicio: `2026-10-09T1${id % 10}:00:00Z`,
    ...extra,
  });
  assert.equal(escolher([l(1, 59), l(2, 0, { atendida: false })]), null);
  assert.equal(escolher([l(1, 60), l(2, 600, { mp3_url: null }), l(3, 61)]).activity_id, 3);
  assert.equal(escolher([l(1, 300), l(2, 300), l(3, 120)]).activity_id, 2);
  assert.equal(escolher([]), null);
});

// ---------------------------------------------------------------------------- nota e conferência

test("nota: fórmula do contrato, com perguntas 3/4 → bloco sim e 1–2 → parcial", () => {
  assert.equal(calcularNota("sim", 4, "sim"), 100);
  assert.equal(calcularNota("nao", 0, "nao"), 0);
  assert.equal(calcularNota("sim", 3, "parcial"), 70.8); // 100 × (1 + 2,25 + 1) ÷ 6
  assert.equal(calcularNota("parcial", 2, "sim"), 66.7); // 100 × (0,5 + 1,5 + 2) ÷ 6
  assert.equal(execucaoDasPerguntas(4), "sim");
  assert.equal(execucaoDasPerguntas(3), "sim");
  assert.equal(execucaoDasPerguntas(2), "parcial");
  assert.equal(execucaoDasPerguntas(1), "parcial");
  assert.equal(execucaoDasPerguntas(0), "nao");
});

// Ligação sintética que segue o script v2 (nenhum dado de cliente real).
const FALAS = [
  {
    falante: "pre_venda",
    texto:
      "Carlos? Aqui é o Matheus, da equipe do Evandro. Te mandei um e-mail para falarmos sobre oportunidades financeiras. Você chegou a ver?",
    inicio_seg: 0,
  },
  { falante: "cliente", texto: "Vi sim, pode falar.", inicio_seg: 8 },
  {
    falante: "pre_venda",
    texto:
      "Bom, Carlos, enquanto o time do Evandro cuida da contabilidade de vocês, eu conduzo uma frente à parte, de Inteligência Financeira. Para iniciarmos uma avaliação, vou te fazer algumas perguntas para entender o seu cenário, ok?",
    inicio_seg: 10,
  },
  { falante: "cliente", texto: "Ok.", inicio_seg: 25 },
  {
    falante: "pre_venda",
    texto:
      "Como estão os planos da empresa para os próximos 12 meses? Crescer, investir, segurar caixa? Se tem algum investimento no radar, onde seria e mais ou menos de quanto?",
    inicio_seg: 27,
  },
  {
    falante: "cliente",
    texto:
      "A gente quer abrir uma filial em Goiânia no ano que vem, uns dois milhões de investimento.",
    inicio_seg: 40,
  },
  {
    falante: "pre_venda",
    texto:
      "E como está a estrutura de capital da empresa hoje? Vocês têm algum financiamento ou linha de crédito? Com quais bancos e a que custo?",
    inicio_seg: 50,
  },
  {
    falante: "cliente",
    texto: "Temos capital de giro no banco, a uns dois por cento ao mês.",
    inicio_seg: 60,
  },
  {
    falante: "pre_venda",
    texto:
      "Só para eu calibrar: o faturamento dos últimos 12 meses ficou em torno de trinta milhões? E vocês seguem no Lucro Real?",
    inicio_seg: 70,
  },
  { falante: "cliente", texto: "Isso, uns trinta e dois milhões, Lucro Real.", inicio_seg: 80 },
  {
    falante: "pre_venda",
    texto:
      "Obrigado, Carlos. Pelo que você me contou, enxergo oportunidades interessantes para a empresa. O próximo passo é uma conversa com o Dárcio, sócio líder da nossa área de Inteligência Financeira.",
    inicio_seg: 90,
  },
  {
    falante: "pre_venda",
    texto:
      "Consigo terça às dez ou às quinze. Qual fica melhor para vocês? Te mando o convite neste e-mail.",
    inicio_seg: 105,
  },
  { falante: "cliente", texto: "Terça às dez fica bom.", inicio_seg: 115 },
];

const RESPOSTA = {
  blocos: {
    abertura: {
      executou: "sim",
      trecho:
        "Aqui é o Matheus, da equipe do Evandro. Te mandei um e-mail para falarmos sobre oportunidades financeiras.",
      nota_curta: "Seguiu a abertura.",
    },
    fechamento: {
      executou: "sim",
      trecho:
        "O próximo passo é uma conversa com o Dárcio, sócio líder da nossa área de Inteligência Financeira.",
      nota_curta: "Marcou com o sócio da área.",
    },
  },
  perguntas: {
    momento: {
      feita: true,
      trecho:
        "Como estão os planos da empresa para os próximos 12 meses? Crescer, investir, segurar caixa?",
    },
    capital: {
      feita: true,
      trecho: "Vocês têm algum financiamento ou linha de crédito? Com quais bancos e a que custo?",
    },
    porte: {
      feita: true,
      trecho:
        "o faturamento dos últimos 12 meses ficou em torno de trinta milhões? E vocês seguem no Lucro Real?",
    },
    teses: { feita: false, trecho: "" },
  },
  antipadroes: [
    {
      chave: "disse_frente",
      trecho: "Você tem uma ótima tese tributária para entrar na justiça agora.",
    },
    { chave: "inventado", trecho: "Aqui é o Matheus, da equipe do Evandro. Te mandei um e-mail" },
  ],
  qualificacao: {
    resumo:
      "Quer abrir filial em Goiânia no ano que vem (R$ 2 milhões). Capital de giro a 2% ao mês. Lucro Real, R$ 32 milhões.",
    frentes: [
      {
        frente: "finance",
        sinal: "segue",
        porque: "Investimento de R$ 2 milhões e dívida cara.",
        trecho: "Temos capital de giro no banco, a uns dois por cento ao mês.",
      },
      {
        frente: "cella",
        sinal: "segue",
        porque: "Lucro Real acima de 25 milhões.",
        trecho: "faturamento inventado de cem milhões no presumido",
      },
    ],
    quem_decide: "não dito na ligação",
    proximo_passo: "Conversa com o Dárcio na terça às 10h.",
  },
};

test("apurar: trecho conferido conta; antipadrão sem trecho e chave desconhecida caem; frente sem trecho vira sem_dado", () => {
  const { avaliacao, nota } = apurar(RESPOSTA, FALAS);
  assert.equal(nota, 87.5); // 100 × (1 + 0,75 × 3 + 1 × 2) ÷ 6
  assert.deepEqual(
    avaliacao.blocos.map((b) => [b.chave, b.peso, b.executou, b.nota_curta]),
    [
      ["abertura", 1, "sim", "Seguiu a abertura."],
      ["perguntas", 3, "sim", "3 de 4"],
      ["fechamento", 2, "sim", "Marcou com o sócio da área."],
    ],
  );
  assert.equal(avaliacao.blocos[1].trecho, null);
  assert.deepEqual(
    avaliacao.perguntas.map((p) => [p.chave, p.feita, p.frentes]),
    [
      ["momento", true, ["T", "F"]],
      ["capital", true, ["F"]],
      ["porte", true, ["J", "T"]],
      ["teses", false, ["J"]],
    ],
  );
  assert.deepEqual(avaliacao.antipadroes, []);
  assert.deepEqual(
    avaliacao.qualificacao.frentes.map((f) => [f.frente, f.sinal]),
    [
      ["finance", "segue"],
      ["cella", "sem_dado"],
    ],
  );
  assert.match(avaliacao.qualificacao.frentes[1].porque, /não está na transcrição/);
  assert.equal(avaliacao.oportunidade, "sim");
});

test("apurar: 'sim' com trecho inventado é rebaixado para não e a nota cai", () => {
  const r = copia(RESPOSTA);
  r.blocos.abertura.trecho =
    "Boa tarde, aqui é da Planning, a maior empresa de contabilidade do Brasil, tudo bem?";
  r.perguntas.teses = {
    feita: true,
    trecho: "A empresa tem alguma ação tributária na justiça com outro escritório?",
  };
  const { avaliacao, nota } = apurar(r, FALAS);
  assert.equal(avaliacao.blocos[0].executou, "nao");
  assert.equal(avaliacao.blocos[0].rebaixado, true);
  assert.equal(avaliacao.perguntas[3].feita, false);
  assert.equal(avaliacao.perguntas[3].rebaixada, true);
  assert.equal(nota, 70.8); // 100 × (0 + 0,75 × 3 + 2) ÷ 6
});

test("apurar: trecho levemente alterado vale pela janela de 12 palavras seguidas", () => {
  const r = copia(RESPOSTA);
  r.blocos.abertura = {
    executou: "parcial",
    trecho:
      "Então, Carlos, enquanto o time do Evandro cuida da contabilidade de vocês, eu conduzo uma frente separada",
    nota_curta: "Abertura incompleta.",
  };
  r.antipadroes = [
    {
      chave: "falou_preco",
      trecho:
        "Consigo terça às dez ou às quinze. Qual fica melhor para vocês? Te mando o convite neste e-mail.",
    },
  ];
  const { avaliacao, nota } = apurar(r, FALAS);
  assert.equal(avaliacao.blocos[0].executou, "parcial");
  assert.equal(nota, 79.2); // 100 × (0,5 + 2,25 + 2) ÷ 6
  assert.deepEqual(
    avaliacao.antipadroes.map((a) => [a.chave, a.titulo]),
    [["falou_preco", "Falou de preço, honorário, êxito ou prazo"]],
  );
});

test("apurar: resposta vazia ou quebrada dá nota 0 e 'sem_dado', sem lançar erro", () => {
  for (const r of [null, {}, { blocos: "x", perguntas: [], qualificacao: 3 }]) {
    const { avaliacao, nota } = apurar(r, FALAS);
    assert.equal(nota, 0);
    assert.equal(avaliacao.oportunidade, "sem_dado");
    assert.equal(avaliacao.qualificacao.quem_decide, "não dito na ligação");
  }
});

// ---------------------------------------------------------------------------- OpenRouter

const resposta = (corpo, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => corpo,
});

test("pedido: max_tokens sempre explícito e teto de raciocínio, áudio em input_audio mp3", () => {
  const t = corpoTranscricao("google/gemini-3.8-flash", "QUJD");
  assert.equal(t.max_tokens, 24000);
  assert.equal(t.reasoning.max_tokens, 1024);
  assert.deepEqual(t.messages[1].content[1], {
    type: "input_audio",
    input_audio: { data: "QUJD", format: "mp3" },
  });
  assert.deepEqual(
    t.response_format.json_schema.schema.properties.falas.items.properties.falante.enum,
    ["pre_venda", "cliente"],
  );
  const a = corpoAvaliacao("anthropic/claude-sonnet-5.5", FALAS);
  assert.equal(a.max_tokens, 9000);
  assert.equal(a.reasoning.max_tokens, 2000);
  assert.match(a.messages[1].content, /\[00:00\] Pré-venda: Carlos\? Aqui é o Matheus/);
  assert.match(a.messages[0].content, /Aqui é o \[SEU NOME\], da equipe do \[SÓCIO\]/);
});

test("OpenRouter: recusa finish_reason diferente de stop, conteúdo vazio e erro HTTP", async () => {
  const chamar = (corpo, status) =>
    chamarOpenRouter(async () => resposta(corpo, status), "chave-teste", {}, 1000);
  await assert.rejects(
    chamar({ choices: [{ finish_reason: "length", message: { content: '{"a":1}' } }] }),
    /incompleta.*length/,
  );
  await assert.rejects(
    chamar({ choices: [{ finish_reason: "stop", message: { content: " " } }] }),
    /incompleta/,
  );
  await assert.rejects(
    chamar({ error: { message: "sem crédito" } }, 402),
    /OpenRouter HTTP 402: sem crédito/,
  );
  await assert.rejects(
    chamarOpenRouter(async () => resposta({}), "", {}, 1000),
    /OPENROUTER_API_KEY ausente/,
  );
  const ok = await chamar({
    model: "google/gemini-3.8-flash",
    usage: { cost: 0.0235 },
    choices: [{ finish_reason: "stop", message: { content: '{"falas":[]}' } }],
  });
  assert.deepEqual(ok, {
    conteudo: '{"falas":[]}',
    custo: 0.0235,
    modelo: "google/gemini-3.8-flash",
  });
});

test("OpenRouter: a chave vai no cabeçalho e nunca na mensagem de erro", async () => {
  let cabecalho;
  await assert.rejects(
    chamarOpenRouter(
      async (_url, init) => {
        cabecalho = init.headers.Authorization;
        return resposta({ error: { message: "x" } }, 500);
      },
      "sk-or-segredo",
      {},
      1000,
    ),
    (e) => !String(e.message).includes("sk-or-segredo"),
  );
  assert.equal(cabecalho, "Bearer sk-or-segredo");
});

test("transcrição: lê a cerca ```json, valida falante e recusa lista vazia", () => {
  const f = lerTranscricao(
    '```json\n{"falas":[{"falante":"pre_venda","texto":" Alô ","inicio_seg":1.26},{"falante":"cliente","texto":"","inicio_seg":2},{"falante":"cliente","texto":"Oi","inicio_seg":"x"}]}\n```',
  );
  assert.deepEqual(f, [
    { falante: "pre_venda", texto: "Alô", inicio_seg: 1.3 },
    { falante: "cliente", texto: "Oi", inicio_seg: 1.3 },
  ]);
  assert.throws(() => lerTranscricao('{"falas":[]}'), /vazia/);
  assert.throws(
    () => lerTranscricao('{"falas":[{"falante":"SDR","texto":"a","inicio_seg":0}]}'),
    /falante/,
  );
  assert.throws(() => lerTranscricao('{"outra":1}'), /lista de falas/);
});

test("base64 em blocos é igual ao do Buffer, inclusive em áudio grande", () => {
  const bytes = new Uint8Array(300_001).map((_, i) => (i * 7919) % 256);
  assert.equal(base64(bytes), Buffer.from(bytes).toString("base64"));
});

test("criarIa: transcreve com o modelo de áudio e devolve falas, custo e modelo", async () => {
  let corpo;
  const ia = criarIa({
    chave: "k",
    fetcher: async (_u, init) => {
      corpo = JSON.parse(init.body);
      return resposta({
        model: corpo.model,
        usage: { cost: 0.02 },
        choices: [
          { finish_reason: "stop", message: { content: JSON.stringify({ falas: FALAS }) } },
        ],
      });
    },
  });
  const r = await ia.transcrever(new Uint8Array([1, 2, 3]), 1000);
  assert.equal(corpo.model, "google/gemini-3.8-flash");
  assert.equal(corpo.messages[1].content[1].input_audio.data, "AQID");
  assert.equal(r.valor.length, FALAS.length);
  assert.equal(r.custo, 0.02);
});

// ---------------------------------------------------------------------------- notas

test("notas: HTML com o título combinado, a trilha ✔/◐/✘, o que faltou e o link do áudio", () => {
  const { avaliacao, nota } = apurar(RESPOSTA, FALAS);
  const l = {
    deal_id: 101,
    pessoa: "Matheus <Carvalho>",
    inicio: "2026-10-09T13:04:10Z",
    duracao_seg: 588,
    mp3_url: "https://listener.api4com.com/files/listen/u1.mp3",
    avaliacao,
    nota,
    regua_versao: VERSAO_REGUA,
  };
  const q = notaQualificacaoHtml(l);
  assert.match(
    q,
    /^<b>Qualificação da ligação por IA \(Planning Brain\) — para o sócio da área · confira antes de usar<\/b>/,
  );
  assert.match(q, /Matheus &lt;Carvalho&gt; · 09\/10\/2026 10:04 · 9 min 48 s/);
  assert.match(q, /<b>Finance:<\/b> segue\. Investimento/);
  assert.match(q, /<b>Cella:<\/b> sem dado\./);
  assert.match(
    q,
    /<a href="https:\/\/listener\.api4com\.com\/files\/listen\/u1\.mp3">Ouvir a ligação<\/a>/,
  );
  const a = notaAvaliacaoHtml(l);
  assert.match(a, /^<b>Avaliação da ligação por IA \(script v2\) — confira antes de usar<\/b>/);
  assert.match(a, /Aderência ao script: 87,5%/);
  assert.match(a, /✔ <b>Abertura<\/b> \(peso 1\)/);
  assert.match(a, /✔ <b>Perguntas<\/b> \(peso 3\): 3 de 4/);
  assert.match(a, /<b>Faltaram:<\/b> Teses na justiça/);
  assert.match(a, /nenhum antipadrão encontrado/);
});

// ---------------------------------------------------------------------------- rodada (fakes)

function fakePd(atividades = []) {
  const notas = new Map();
  const chamadas = [];
  let proximo = 7000;
  return {
    notas,
    chamadas,
    atividades,
    escritas: () => chamadas.filter(([m]) => m !== "PAGES"),
    async pages(path, params) {
      chamadas.push(["PAGES", path, params]);
      assert.equal(path, "activities");
      return copia(this.atividades);
    },
    async post(path, payload) {
      chamadas.push(["POST", path, payload]);
      assert.equal(path, "notes");
      const id = proximo++;
      notas.set(id, { ...payload });
      return { data: { id } };
    },
    async put(path, payload) {
      chamadas.push(["PUT", path, payload]);
      const id = Number(path.split("/")[1]);
      if (!notas.has(id)) throw new Error("Pipedrive HTTP 404");
      notas.get(id).content = payload.content;
      return { data: { id } };
    },
  };
}

function fakeStore({ deals = { 101: "Empresa A", 102: "Empresa B" }, avaliacoes = [] } = {}) {
  const L = new Map();
  const A = new Map(avaliacoes.map((a) => [a.deal_id, copia(a)]));
  const chamadas = [];
  const ordem = (a, b) =>
    String(a.atualizado_em || "").localeCompare(String(b.atualizado_em || ""));
  return {
    L,
    A,
    chamadas,
    escritas: () => chamadas.filter(([m]) => m !== "ler"),
    async dealsDoPipe() {
      return new Map(Object.entries(deals).map(([k, v]) => [Number(k), v]));
    },
    async ligacoesPorAtividade(ids) {
      chamadas.push(["ler"]);
      return ids.filter((i) => L.has(i)).map((i) => copia(L.get(i)));
    },
    async gravarLigacoes(linhas) {
      chamadas.push(["gravarLigacoes", linhas.map((l) => l.activity_id)]);
      for (const l of linhas) L.set(l.activity_id, copia(l));
    },
    async ligacoesDosDeals(ds) {
      return [...L.values()].filter((l) => ds.includes(l.deal_id)).map(copia);
    },
    async avaliacoesDosDeals(ds) {
      return [...A.values()].filter((a) => ds.includes(a.deal_id)).map(copia);
    },
    async gravarAvaliacao(linha) {
      chamadas.push(["gravarAvaliacao", linha.deal_id, linha.activity_id]);
      A.set(linha.deal_id, { ...(A.get(linha.deal_id) || {}), ...copia(linha) });
    },
    async atualizarAvaliacao(deal, patch, se = {}) {
      chamadas.push(["atualizar", deal, Object.keys(patch).sort().join(",")]);
      const a = A.get(deal);
      if (!a) return false;
      if (se.activity_id !== undefined && a.activity_id !== se.activity_id) return false;
      if (se.status && !se.status.includes(a.status)) return false;
      Object.assign(a, copia(patch));
      return true;
    },
    async proximaParaTranscrever(travada) {
      const l = [...A.values()]
        .filter(
          (a) =>
            a.status === "pendente" || (a.status === "transcrevendo" && a.atualizado_em < travada),
        )
        .sort(ordem)[0];
      return l ? copia(l) : null;
    },
    async proximaParaAvaliar() {
      const l = [...A.values()].filter((a) => a.status === "transcrita").sort(ordem)[0];
      return l ? copia(l) : null;
    },
    async paraNotas(n) {
      return [...A.values()]
        .filter((a) => a.status === "avaliada" && !a.notas_em)
        .sort(ordem)
        .slice(0, n)
        .map(copia);
    },
  };
}

function fakeIa({ falhaTranscricao, falhaAvaliacao } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async transcrever(mp3) {
      chamadas.push(["transcrever", mp3.byteLength]);
      if (falhaTranscricao) throw new Error(falhaTranscricao);
      return { valor: copia(FALAS), custo: 0.0235, modelo: "google/gemini-3.8-flash" };
    },
    async avaliar(falas) {
      chamadas.push(["avaliar", falas.length]);
      if (falhaAvaliacao) throw new Error(falhaAvaliacao);
      return { valor: copia(RESPOSTA), custo: 0.0456, modelo: "anthropic/claude-sonnet-5.5" };
    },
  };
}

const audio = async () => new Uint8Array(240_000);
const rodar = (pd, store, ia, extra = {}) =>
  rodarLigacoes({
    pd,
    store,
    ia,
    baixar: audio,
    agora: AGORA,
    ativa: true,
    notas: true,
    dry: false,
    ...extra,
  });

const CAPTURA = () => [
  atendida(1, 101, "10:00:00", "10:05:00", "00:05:00"), // 300 s, card do pipe 39
  atividade(2, 101, {
    subject: "Ligação para (11) 90000-0000 não foi atendida pelo seguinte motivo: Cancelada",
    note: "",
  }),
  atividade(3, 101, { subject: "Caixa · D0 · Ligação · tarde", note: "Dois toques" }), // manual
  atendida(4, 999, "11:00:00", "11:20:00", "00:20:00"), // card de outro pipe
  atendida(5, 102, "12:00:00", "12:00:40", "00:00:40"), // 40 s: capturada, não escolhida
];

test("rodada: janela de hoje e 2 dias antes em São Paulo; captura só o pipe 39 e só o formato da Api4Com", async () => {
  assert.deepEqual(janela(AGORA), { de: "2026-10-07", ate: "2026-10-09", ate_api: "2026-10-10" });
  const pd = fakePd(CAPTURA());
  const store = fakeStore();
  const r = await rodar(pd, store, fakeIa(), { ativa: false, notas: false });
  assert.deepEqual(pd.chamadas[0], [
    "PAGES",
    "activities",
    { user_id: "0", type: "call", start_date: "2026-10-07", end_date: "2026-10-10" },
  ]);
  assert.deepEqual(r.capturadas, {
    atividades_call: 5,
    no_pipe39: 4,
    api4com: 3,
    manuais_ignoradas: 1,
    novas: 3,
    atualizadas: 0,
  });
  assert.deepEqual([...store.L.keys()].sort(), [1, 2, 5]);
  assert.deepEqual(r.escolhidas, [{ deal: 101, activity_id: 1, duracao_seg: 300, antes: null }]);
  assert.equal(store.A.get(101).status, "pendente");
  assert.equal(store.A.get(101).empresa, "Empresa A");
  assert.equal(store.A.has(102), false);
});

test("sem MONET_LIGACOES_ATIVA: só captura, nenhuma chamada à IA nem ao Pipedrive, e diz o que faria", async () => {
  const pd = fakePd(CAPTURA());
  const store = fakeStore();
  const ia = fakeIa();
  const r = await rodar(pd, store, ia, { ativa: false, notas: false });
  assert.equal(r.modo, "só captura");
  assert.match(r.ia, /desligada/);
  assert.match(r.escrita_no_pipedrive, /desligada/);
  assert.deepEqual(ia.chamadas, []);
  assert.deepEqual(pd.escritas(), []);
  assert.deepEqual(r.faria, { transcrever: 101, avaliar: null, notas_pendentes: 0 });
});

test("dry-run: não escreve no banco nem no Pipedrive, mesmo com tudo ligado", async () => {
  const pd = fakePd(CAPTURA());
  const store = fakeStore();
  const ia = fakeIa();
  const r = await rodar(pd, store, ia, { dry: true });
  assert.equal(r.modo, "dry-run");
  assert.equal(r.capturadas.novas, 3);
  assert.deepEqual(r.escolhidas, [{ deal: 101, activity_id: 1, duracao_seg: 300, antes: null }]);
  assert.deepEqual(store.escritas(), []);
  assert.deepEqual(pd.escritas(), []);
  assert.deepEqual(ia.chamadas, []);
});

test("rodada completa e idempotência das notas: ligação mais longa refaz a avaliação e ATUALIZA as mesmas notas", async () => {
  const pd = fakePd(CAPTURA());
  const store = fakeStore();
  const ia = fakeIa();

  // 1ª rodada: transcreve, avalia e cria as duas notas.
  const r1 = await rodar(pd, store, ia);
  assert.equal(r1.status, "ok");
  assert.equal(r1.modo, "ativo");
  assert.deepEqual(r1.transcritas, [
    { deal: 101, activity_id: 1, falas: FALAS.length, custo_usd: 0.0235 },
  ]);
  assert.deepEqual(r1.avaliadas, [{ deal: 101, activity_id: 1, nota: 87.5, custo_usd: 0.0456 }]);
  assert.deepEqual(r1.notas, [{ deal: 101, criadas: 2, atualizadas: 0 }]);
  const linha = store.A.get(101);
  assert.equal(linha.status, "avaliada");
  assert.equal(linha.nota, 87.5);
  assert.equal(linha.regua_versao, "script-v2-2026-10-09");
  assert.equal(linha.custo_usd, 0.0691);
  assert.match(
    linha.modelos,
    /transcrição google\/gemini-3\.8-flash · avaliação anthropic\/claude-sonnet-5\.5/,
  );
  assert.equal(linha.notas_em, AGORA.toISOString());
  const ids = [linha.nota_qualificacao_id, linha.nota_avaliacao_id];
  assert.deepEqual(ids, [7000, 7001]);
  assert.match(pd.notas.get(7000).content, /Qualificação da ligação por IA/);
  assert.equal(pd.notas.get(7000).deal_id, 101);
  assert.match(pd.notas.get(7001).content, /Avaliação da ligação por IA \(script v2\)/);

  // 2ª rodada, nada mudou: nenhuma escrita no Pipedrive, nenhuma chamada à IA.
  const antesPd = pd.escritas().length,
    antesIa = ia.chamadas.length;
  const r2 = await rodar(pd, store, ia);
  assert.deepEqual([r2.escolhidas, r2.transcritas, r2.avaliadas, r2.notas], [[], [], [], []]);
  assert.equal(pd.escritas().length, antesPd);
  assert.equal(ia.chamadas.length, antesIa);

  // 3ª rodada: apareceu uma ligação mais longa no mesmo card.
  pd.atividades.push(atendida(9, 101, "14:00:00", "14:08:00", "00:08:00"));
  const r3 = await rodar(pd, store, ia);
  assert.deepEqual(r3.escolhidas, [{ deal: 101, activity_id: 9, duracao_seg: 480, antes: 1 }]);
  assert.equal(r3.avaliadas.length, 1);
  assert.deepEqual(r3.notas, [{ deal: 101, criadas: 0, atualizadas: 2 }]);
  const novas = pd.escritas().slice(antesPd);
  assert.deepEqual(
    novas.map(([m, p]) => [m, p]),
    [
      ["PUT", "notes/7000"],
      ["PUT", "notes/7001"],
    ],
  );
  assert.equal(pd.notas.size, 2);
  assert.deepEqual(
    [store.A.get(101).nota_qualificacao_id, store.A.get(101).nota_avaliacao_id],
    ids,
  );
  assert.equal(store.A.get(101).activity_id, 9);
  assert.match(pd.notas.get(7000).content, /8 min 0 s/);
});

test("notas: nota apagada à mão no card nasce de novo, e o id novo fica salvo", async () => {
  const pd = fakePd();
  const { avaliacao, nota } = apurar(RESPOSTA, FALAS);
  const linha = {
    deal_id: 101,
    activity_id: 1,
    status: "avaliada",
    avaliacao,
    nota,
    nota_qualificacao_id: 5555, // não existe mais no Pipedrive
    nota_avaliacao_id: null,
    notas_em: null,
  };
  const store = fakeStore({ avaliacoes: [linha] });
  const r = await gravarNotas(pd, store, copia(linha), AGORA);
  assert.deepEqual(r, { criadas: 2, atualizadas: 0 });
  assert.deepEqual(
    pd.chamadas.map(([m, p]) => [m, p]),
    [
      ["PUT", "notes/5555"],
      ["POST", "notes"],
      ["POST", "notes"],
    ],
  );
  assert.equal(store.A.get(101).nota_qualificacao_id, 7000);
  assert.equal(store.A.get(101).nota_avaliacao_id, 7001);
  assert.equal(store.A.get(101).notas_em, AGORA.toISOString());
});

test("notas: erro do Pipedrive que não é 404 não cria nota duplicada", async () => {
  const pd = fakePd();
  pd.put = async () => {
    throw new Error("Pipedrive HTTP 500");
  };
  const { avaliacao, nota } = apurar(RESPOSTA, FALAS);
  const linha = {
    deal_id: 101,
    activity_id: 1,
    status: "avaliada",
    avaliacao,
    nota,
    nota_qualificacao_id: 1,
    nota_avaliacao_id: 2,
  };
  const store = fakeStore({ avaliacoes: [linha] });
  await assert.rejects(gravarNotas(pd, store, copia(linha), AGORA), /HTTP 500/);
  assert.equal(pd.notas.size, 0);
  assert.equal(store.A.get(101).notas_em, undefined);
});

test("sem MONET_LIGACOES_NOTAS: avalia, mas não escreve no card e conta as notas pendentes", async () => {
  const pd = fakePd(CAPTURA());
  const store = fakeStore();
  const r = await rodar(pd, store, fakeIa(), { notas: false });
  assert.equal(r.avaliadas.length, 1);
  assert.deepEqual(pd.escritas(), []);
  assert.equal(r.faria.notas_pendentes, 1);
  assert.equal(store.A.get(101).notas_em, null);
});

test("áudio ainda não publicado (404): volta para pendente sem gastar tentativa; 6 h depois vira erro", async () => {
  const pd = fakePd(CAPTURA());
  const store = fakeStore();
  const ia = fakeIa();
  const sem = async () => {
    throw new Error("áudio HTTP 404");
  };
  const r = await rodar(pd, store, ia, { baixar: sem });
  assert.equal(r.status, "com_erros");
  assert.equal(store.A.get(101).status, "pendente");
  assert.equal(store.A.get(101).tentativas, 0);
  assert.match(store.A.get(101).erro, /áudio HTTP 404/);
  assert.deepEqual(ia.chamadas, []);
  await rodar(pd, store, ia, { baixar: sem, agora: new Date("2026-10-10T02:00:00Z") });
  assert.equal(store.A.get(101).status, "erro");
});

test("arquivo quase vazio conta como áudio não publicado", async () => {
  const store = fakeStore();
  await rodar(fakePd(CAPTURA()), store, fakeIa(), { baixar: async () => new Uint8Array(100) });
  assert.equal(store.A.get(101).status, "pendente");
  assert.match(store.A.get(101).erro, /arquivo vazio/);
});

test("transcrição que falha 3 vezes vai para erro; avaliação que falha fica transcrita até a 3ª", async () => {
  const pd = fakePd(CAPTURA());
  const store = fakeStore();
  const ia = fakeIa({ falhaTranscricao: "OpenRouter HTTP 502" });
  for (let i = 0; i < 3; i++) await rodar(pd, store, ia);
  assert.equal(store.A.get(101).status, "erro");
  assert.equal(store.A.get(101).tentativas, 3);
  assert.equal(ia.chamadas.length, 3);

  const store2 = fakeStore();
  const ia2 = fakeIa({ falhaAvaliacao: "resposta incompleta do modelo: length" });
  await rodar(pd, store2, ia2);
  assert.equal(store2.A.get(101).status, "transcrita");
  assert.equal(store2.A.get(101).tentativas, 1);
  await rodar(pd, store2, ia2);
  await rodar(pd, store2, ia2);
  assert.equal(store2.A.get(101).status, "erro");
  assert.match(store2.A.get(101).erro, /avaliação: resposta incompleta/);
});

test("linha presa em 'transcrevendo' (rodada que morreu) volta para a fila depois de 10 minutos", async () => {
  const presa = {
    deal_id: 101,
    activity_id: 1,
    status: "transcrevendo",
    mp3_url: "https://listener.api4com.com/files/listen/u1.mp3",
    inicio: "2026-10-09T13:00:00Z",
    tentativas: 0,
    atualizado_em: "2026-10-09T17:55:00.000Z",
  };
  const store = fakeStore({ avaliacoes: [presa] });
  const ia = fakeIa();
  await rodar(fakePd([]), store, ia, { ativa: true, notas: false });
  assert.deepEqual(ia.chamadas, []); // 5 minutos: ainda não
  store.A.get(101).atualizado_em = "2026-10-09T17:45:00.000Z";
  await rodar(fakePd([]), store, ia, { ativa: true, notas: false });
  assert.equal(store.A.get(101).status, "avaliada");
});

test("orçamento: sem tempo, a transcrição e a avaliação ficam para a próxima rodada", async () => {
  const store = fakeStore();
  const ia = fakeIa();
  let t = 0;
  const r = await rodar(fakePd(CAPTURA()), store, ia, {
    relogio: () => (t += 100_000),
    orcamentoMs: 120_000,
  });
  assert.deepEqual(ia.chamadas, []);
  assert.deepEqual(r.adiado, ["transcrição", "avaliação"]);
  assert.equal(store.A.get(101).status, "pendente");
});
