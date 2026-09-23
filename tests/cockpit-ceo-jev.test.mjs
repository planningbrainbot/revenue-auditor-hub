import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { caminhoLedger } from "../src/lib/cockpit-ceo/jev/piloto.server.ts";
import {
  JEV_ENDPOINT,
  JEV_MODELO,
  IDS_PERGUNTAS_CEO,
  payloadRoteamento,
  payloadTesteEmail,
  validarPedido,
  validarResposta,
  resumirOrcamento,
  pilotoJevAtivo,
} from "../src/lib/cockpit-ceo/jev/contrato.ts";
import {
  decidirJev,
  criarLedgerMemoria,
  criarLedgerArquivo,
} from "../src/lib/cockpit-ceo/jev/adaptador.server.ts";

const CHAVE = "sk-or-v1-chave-de-teste-nao-real-0000000000";
const SEM_CUSTO = Symbol("sem custo");
const respostaEmail = (custo = 0.00002) => ({
  id: "gen-dec-teste",
  model: "typesafe/jev-1.13-20260917",
  provider: "TypeSafe",
  answers: {
    intencao: {
      type: "choice",
      choice: "conhecer",
      confidence: 0.8,
      probabilities: {
        conhecer: 0.87,
        proposta: 0.1,
        suporte: 0.01,
        outro: 0.01,
        insuficiente: 0.01,
      },
    },
    interesse: {
      type: "score",
      score: 1.1,
      confidence: 0.7,
      probabilities: { 0: 0.05, 1: 0.8, 2: 0.15 },
    },
    pessoa: { type: "noul", noul: 0.93 },
  },
  usage: { input_tokens: 400, output_tokens: 60, ...(custo === SEM_CUSTO ? {} : { cost: custo }) },
});
const transporteCom = (corpo, status = 200) => {
  const chamadas = [];
  const fn = async (url, init) => {
    chamadas.push({ url, init });
    return { status, text: async () => JSON.stringify(corpo) };
  };
  fn.chamadas = chamadas;
  return fn;
};
const deps = (transporte, extra = {}) => ({
  obterChave: async () => CHAVE,
  transporte,
  ledger: criarLedgerMemoria(),
  exemplo: "email-exploratorio",
  timeoutMs: 2000,
  ...extra,
});

test("Pedido do teste real: e-mail fictício, três perguntas e critérios em todas as primitivas", () => {
  const p = payloadTesteEmail();
  assert.equal(p.model, JEV_MODELO);
  assert.equal(JEV_ENDPOINT, "https://openrouter.ai/api/alpha/decisions");
  assert.match(p.state.mensagem, /Empresa Exemplo Alfa/);
  assert.deepEqual(Object.keys(p.questions).sort(), ["intencao", "interesse", "pessoa"]);
  assert.deepEqual(Object.keys(p.questions.intencao.criteria).sort(), [
    "conhecer",
    "insuficiente",
    "outro",
    "proposta",
    "suporte",
  ]);
  assert.equal(p.questions.interesse.type, "score");
  assert.equal(p.questions.interesse.criteria.length, 3);
  assert.equal(p.questions.pessoa.type, "noul");
  assert.deepEqual(Object.keys(p.questions.pessoa.criteria).sort(), ["false", "true"]);
  assert.doesNotThrow(() => validarPedido(p));
});

test("Pedido de roteamento só aceita perguntas fictícias fixas e oferece as seis frentes e a saída", () => {
  assert.ok(IDS_PERGUNTAS_CEO.length >= 3);
  const p = payloadRoteamento(IDS_PERGUNTAS_CEO[0]);
  const opcoes = Object.keys(p.questions.frente.criteria);
  for (const f of [
    "receita",
    "clientes",
    "comercial",
    "rede",
    "retencao",
    "capital",
    "fora_de_escopo",
    "insuficiente",
  ])
    assert.ok(opcoes.includes(f), f);
  assert.deepEqual(Object.keys(p.questions.pede_dado.criteria).sort(), ["false", "true"]);
  assert.throws(() => payloadRoteamento("texto livre qualquer"));
});

test("Pedido fora do contrato é recusado antes de sair", () => {
  const base = payloadTesteEmail();
  assert.throws(
    () => validarPedido({ ...base, questions: { x: { type: "noul", instructions: "?" } } }),
    /criteria/,
  );
  assert.throws(() =>
    validarPedido({
      ...base,
      questions: { x: { type: "choice", instructions: "?", criteria: {} } },
    }),
  );
  assert.throws(() =>
    validarPedido({
      ...base,
      questions: { x: { type: "score", instructions: "?", criteria: [] } },
    }),
  );
  assert.throws(() => validarPedido({ ...base, model: "outro/modelo" }));
});

test("Resposta é validada contra a taxonomia e os intervalos de cada primitiva", () => {
  const perguntas = payloadTesteEmail().questions;
  const ok = validarResposta(respostaEmail(), perguntas);
  assert.equal(ok.modelo, "typesafe/jev-1.13-20260917");
  assert.equal(ok.custoUsd, 0.00002);
  assert.equal(ok.respostas.intencao.choice, "conhecer");
  assert.equal(ok.respostas.pessoa.noul, 0.93);
  const quebra = (mudar) => {
    const r = structuredClone(respostaEmail());
    mudar(r);
    return () => validarResposta(r, perguntas);
  };
  assert.throws(
    quebra((r) => (r.answers.intencao.choice = "fechar_negocio")),
    { codigo: "resposta_invalida" },
  );
  assert.throws(
    quebra((r) => (r.answers.interesse.score = 3)),
    { codigo: "resposta_invalida" },
  );
  assert.throws(
    quebra((r) => (r.answers.pessoa.noul = 1.2)),
    { codigo: "resposta_invalida" },
  );
  assert.throws(
    quebra((r) => (r.model = "openai/gpt-x")),
    { codigo: "resposta_invalida" },
  );
  assert.throws(
    quebra((r) => delete r.answers.pessoa),
    { codigo: "resposta_invalida" },
  );
  assert.throws(
    quebra((r) => (r.answers.intencao.type = "noul")),
    { codigo: "resposta_invalida" },
  );
  assert.equal(
    validarResposta(respostaEmail(SEM_CUSTO), perguntas).custoUsd,
    null,
    "custo ausente não vira zero",
  );
  assert.equal(validarResposta(respostaEmail(-1), perguntas).custoUsd, null);
});

test("Chamada real simulada: uma requisição, sem retry, com modelo, duração e custo registrados", async () => {
  const t = transporteCom(respostaEmail());
  const d = deps(t);
  const r = await decidirJev(payloadTesteEmail(), d);
  assert.equal(r.estado, "ok");
  assert.equal(t.chamadas.length, 1);
  assert.equal(t.chamadas[0].url, JEV_ENDPOINT);
  assert.equal(t.chamadas[0].init.method, "POST");
  assert.equal(t.chamadas[0].init.headers.Authorization, "Bearer " + CHAVE);
  assert.equal(JSON.parse(t.chamadas[0].init.body).model, JEV_MODELO);
  assert.ok(r.latenciaMs >= 0);
  assert.equal(r.custoUsd, 0.00002);
  assert.equal(r.modeloSolicitado, JEV_MODELO);
  assert.equal(r.modeloRetornado, "typesafe/jev-1.13-20260917");
  assert.equal(r.orcamento.tentativas, 1);
  const registros = JSON.stringify(await d.ledger.ler());
  assert.ok(!registros.includes(CHAVE), "chave fora do ledger");
  assert.ok(!registros.includes("Empresa Exemplo Alfa"), "texto analisado fora do ledger");
  assert.ok(!JSON.stringify(r).includes(CHAVE), "chave fora do resultado");
});

test("Custo não informado bloqueia a próxima chamada antes do transporte", async () => {
  const t = transporteCom(respostaEmail(SEM_CUSTO));
  const d = deps(t);
  const r1 = await decidirJev(payloadTesteEmail(), d);
  assert.equal(r1.estado, "ok");
  assert.equal(r1.custoUsd, null);
  const r2 = await decidirJev(payloadTesteEmail(), d);
  assert.equal(r2.estado, "bloqueado");
  assert.match(r2.mensagem, /custo/i);
  assert.equal(t.chamadas.length, 1);
});

test("Dez tentativas é o teto do piloto; a décima primeira nem sai", async () => {
  const t = transporteCom(respostaEmail(0.000001));
  const d = deps(t);
  for (let i = 0; i < 10; i++)
    assert.equal((await decidirJev(payloadTesteEmail(), d)).estado, "ok");
  const r = await decidirJev(payloadTesteEmail(), d);
  assert.equal(r.estado, "bloqueado");
  assert.equal(t.chamadas.length, 10);
  assert.equal(r.orcamento.tentativas, 10);
});

test("US$ 0,10 de custo informado interrompe novas chamadas", async () => {
  const t = transporteCom(respostaEmail(0.1));
  const d = deps(t);
  assert.equal((await decidirJev(payloadTesteEmail(), d)).estado, "ok");
  assert.equal((await decidirJev(payloadTesteEmail(), d)).estado, "bloqueado");
  assert.equal(t.chamadas.length, 1);
});

test("Tempo esgotado falha uma vez, sem retry, e deixa o custo como desconhecido", async () => {
  let chamadas = 0;
  const lento = (url, init) => {
    chamadas++;
    return new Promise((_, rejeita) =>
      init.signal.addEventListener("abort", () =>
        rejeita(Object.assign(new Error("abort"), { name: "AbortError" })),
      ),
    );
  };
  const d = deps(lento, { timeoutMs: 30 });
  const r = await decidirJev(payloadTesteEmail(), d);
  assert.equal(r.estado, "falha");
  assert.equal(r.codigo, "tempo_esgotado");
  assert.equal(chamadas, 1);
  assert.equal((await decidirJev(payloadTesteEmail(), d)).estado, "bloqueado");
  assert.equal(chamadas, 1);
});

test("Recusa HTTP do fornecedor é falha nomeada, conta tentativa e não vaza corpo", async () => {
  const t = transporteCom({ error: { code: 402, message: "Insufficient credits " + CHAVE } }, 402);
  const d = deps(t);
  const r = await decidirJev(payloadTesteEmail(), d);
  assert.equal(r.estado, "falha");
  assert.equal(r.codigo, "openrouter_http_402");
  assert.ok(!JSON.stringify(r).includes(CHAVE));
  assert.ok(!JSON.stringify(await d.ledger.ler()).includes(CHAVE));
  assert.equal(resumirOrcamento(await d.ledger.ler()).tentativas, 1);
  assert.equal(
    (await decidirJev(payloadTesteEmail(), d)).estado,
    "falha",
    "402 não bloqueia por custo; o limite de tentativas continua valendo",
  );
  assert.equal(t.chamadas.length, 2);
});

test("Resposta que ecoa a chave é tratada como inválida", async () => {
  const eco = respostaEmail();
  eco.provider = CHAVE;
  const d = deps(transporteCom(eco));
  const r = await decidirJev(payloadTesteEmail(), d);
  assert.equal(r.estado, "falha");
  assert.equal(r.codigo, "resposta_invalida");
  assert.ok(!JSON.stringify(await d.ledger.ler()).includes(CHAVE));
});

test("Sem chave não há chamada nem tentativa registrada", async () => {
  const t = transporteCom(respostaEmail());
  const d = deps(t, { obterChave: async () => null });
  const r = await decidirJev(payloadTesteEmail(), d);
  assert.equal(r.estado, "sem_chave");
  assert.equal(t.chamadas.length, 0);
  assert.equal((await d.ledger.ler()).length, 0);
});

test("Ledger em arquivo serializa chamadas concorrentes e sobrevive ao processo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-ledger-"));
  try {
    const caminho = join(dir, "chamadas.jsonl");
    const t = transporteCom(respostaEmail(0.00001));
    const [a, b] = await Promise.all([
      decidirJev(payloadTesteEmail(), deps(t, { ledger: criarLedgerArquivo(caminho) })),
      decidirJev(payloadTesteEmail(), deps(t, { ledger: criarLedgerArquivo(caminho) })),
    ]);
    assert.equal(a.estado, "ok");
    assert.equal(b.estado, "ok");
    const linhas = readFileSync(caminho, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    assert.equal(resumirOrcamento(linhas).tentativas, 2);
    assert.ok(!readFileSync(caminho, "utf8").includes(CHAVE));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Reserva sem desfecho (processo caiu no meio) bloqueia: o custo pode ter sido cobrado", () => {
  const r = resumirOrcamento([
    { id: "a", estado: "reservada", em: "x", exemplo: "e", taxonomia: "t" },
  ]);
  assert.equal(r.bloqueado, true);
  assert.equal(r.custoDesconhecido, true);
});

test("Jev só liga no piloto, fora de produção", () => {
  assert.equal(pilotoJevAtivo({ COCKPIT_JEV_PILOTO: "1", NODE_ENV: "development" }), true);
  assert.equal(pilotoJevAtivo({ COCKPIT_JEV_PILOTO: "1", NODE_ENV: "production" }), false);
  assert.equal(pilotoJevAtivo({ NODE_ENV: "development" }), false);
});

test("Resposta sem o campo type, no resto conforme, é aceita pelo tipo da pergunta", () => {
  const r = respostaEmail();
  for (const a of Object.values(r.answers)) delete a.type;
  const v = validarResposta(r, payloadTesteEmail().questions);
  assert.equal(v.respostas.intencao.type, "choice");
  assert.equal(v.respostas.pessoa.noul, 0.93);
});

test("Resposta fora do contrato mas com custo informado guarda o custo e não trava o orçamento à toa", async () => {
  const r = respostaEmail(0.00003);
  r.answers.intencao.choice = "outra_coisa";
  const t = transporteCom(r);
  const d = deps(t);
  const f = await decidirJev(payloadTesteEmail(), d);
  assert.equal(f.estado, "falha");
  assert.equal(f.codigo, "resposta_invalida");
  const desfecho = (await d.ledger.ler()).find((x) => x.estado === "falha");
  assert.equal(desfecho.custoUsd, 0.00003);
  assert.equal(desfecho.custoDesconhecido, false);
  assert.ok(desfecho.formato, "guarda o formato da resposta para diagnóstico");
  assert.ok(!JSON.stringify(desfecho.formato).includes("outra_coisa"), "formato sem valores");
  assert.equal(resumirOrcamento(await d.ledger.ler()).bloqueado, false);
});

test("Ledger do piloto tem caminho fixo, independente do diretório de execução", () => {
  const esperado = fileURLToPath(
    new URL("../docs/dev_notes/cockpit-ceo-piloto/jev-chamadas.jsonl", import.meta.url),
  );
  const antes = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "jev-cwd-"));
  try {
    process.chdir(dir);
    process.env.COCKPIT_JEV_LEDGER = join(dir, "outro.jsonl");
    assert.equal(caminhoLedger(), esperado);
  } finally {
    process.chdir(antes);
    delete process.env.COCKPIT_JEV_LEDGER;
    rmSync(dir, { recursive: true, force: true });
  }
});
