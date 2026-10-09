// Tela Pré-venda da Monetização (contrato docs/design/contratos/monetizacao-pre-venda.md). Os dados de exemplo em
// tests/fixtures/pre-venda.json estão no formato exato do contrato de dados de 09/10/2026 (o que cada RPC devolve):
// 2 pessoas, 6 ligações avaliadas e 2 na fila, atividades vencidas em 9 cards.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aderencia,
  avaliadas,
  classificarErroPreVenda,
  duracao,
  falasDoTrecho,
  faixa,
  filtrarLigacoes,
  kpisRitmo,
  mensagemDeErroPreVenda,
  nomeDaPessoa,
  normalizarAtrasados,
  normalizarAvaliacoes,
  normalizarFicha,
  normalizarRitmo,
  notaCalculada,
  ordenarAtrasados,
  pessoasDoRecorte,
  semanaDe,
  serie,
  serieAbordagens,
  serieAtividades,
  situacaoDaLigacao,
  uteisAteHoje,
} from "../src/lib/monetizacao/pre-venda.ts";
import {
  ABAS,
  avisoDaAposentada,
  validarBuscaMonetizacao,
} from "../src/components/monetizacao/busca.ts";
import { AREAS } from "../src/lib/areas.ts";

const F = JSON.parse(readFileSync(new URL("./fixtures/pre-venda.json", import.meta.url), "utf8"));
const M = 28381245;
const H = 28897937;
const PERIODO = { de: "2026-10-01", ate: "2026-10-09", hoje: F.hoje };
const ritmo = normalizarRitmo(F.ritmo);
const atrasados = normalizarAtrasados(F.atrasados);
const avaliacoes = normalizarAvaliacoes(F.avaliacoes);
const umaCasa = (x) => Math.round(x * 10) / 10;

// ── Formato e régua ──────────────────────────────────────────────────────────────────────────────────────────────

test("Normalização aceita número como texto (numeric/bigint do PostgREST) e lista ausente", () => {
  const [l] = normalizarRitmo([
    {
      dia: "2026-10-09",
      user_id: "28381245",
      pessoa: "Matheus Carvalho",
      abordagens: "3",
      minutos_falados: "12.5",
    },
  ]);
  assert.equal(l.user_id, M);
  assert.equal(l.abordagens, 3);
  assert.equal(l.minutos_falados, 12.5);
  assert.equal(l.atividades_vencidas, 0);
  assert.deepEqual(normalizarRitmo(null), []);
  const [a] = normalizarAvaliacoes([
    { deal_id: "1", status: "pendente", nota: null, blocos: null },
  ]);
  assert.equal(a.deal_id, 1);
  assert.equal(a.nota, null);
  assert.deepEqual(a.blocos, []);
  assert.equal(normalizarAvaliacoes([{ status: "inventado" }])[0].status, "pendente");
});

test("A nota de cada ligação avaliada bate com a fórmula do contrato (pesos 1, 3 e 2)", () => {
  const av = avaliadas(avaliacoes);
  assert.equal(av.length, 6);
  for (const l of av) assert.equal(notaCalculada(l.blocos, l.perguntas), l.nota, l.empresa);
  // 3 de 4 perguntas e fechamento parcial: (1 + 0,75×3 + 0,5×2) ÷ 6 = 70,8
  const frig = av.find((l) => l.deal_id === 900301);
  assert.equal(frig.nota, 70.8);
  assert.equal(faixa(80), "bom");
  assert.equal(faixa(79.9), "atencao");
  assert.equal(faixa(50), "atencao");
  assert.equal(faixa(49.9), "critico");
});

// ── Aderência ────────────────────────────────────────────────────────────────────────────────────────────────────

test("Aderência: nota média por pessoa e do time, só com as avaliadas", () => {
  const a = aderencia(avaliacoes, pessoasDoRecorte(avaliacoes));
  assert.equal(a.n, 6);
  const m = a.porPessoa.find((p) => p.pessoa.id === M);
  const h = a.porPessoa.find((p) => p.pessoa.id === H);
  assert.equal(m.n, 4);
  assert.equal(umaCasa(m.media), 69.8); // (70,8 + 100 + 66,7 + 41,7) ÷ 4
  assert.equal(h.n, 2);
  assert.equal(umaCasa(h.media), 70.8); // (83,3 + 58,3) ÷ 2
  assert.equal(umaCasa(a.time.media), umaCasa((70.8 + 100 + 66.7 + 41.7 + 83.3 + 58.3) / 6));
  // Pendente e transcrevendo não entram na média, mas seguem na lista da Ficha.
  assert.equal(filtrarLigacoes(avaliacoes, {}).length, 8);
});

test("Mapa de calor: bloco = crédito médio, pergunta = % das ligações em que foi feita", () => {
  const a = aderencia(avaliacoes, pessoasDoRecorte(avaliacoes));
  assert.deepEqual(
    a.colunas.map((c) => c.id),
    [M, H, "todos"],
  );
  const valor = (chave, coluna) =>
    a.mapa.find((l) => l.chave === chave).celulas.find((c) => c.pessoa === coluna).valor;
  assert.equal(valor("abertura", M), 87.5); // sim, sim, parcial, sim
  assert.equal(valor("abertura", H), 50); // sim, não
  assert.equal(valor("momento", M), 100);
  assert.equal(valor("capital", M), 75);
  assert.equal(valor("capital", H), 50);
  assert.equal(valor("porte", H), 100);
  assert.equal(valor("teses", M), 25);
  assert.equal(valor("teses", "todos"), (2 / 6) * 100);
  assert.equal(valor("fechamento", M), 62.5); // parcial, sim, sim, não
  assert.equal(valor("fechamento", H), 75);
  // O clique na célula leva às ligações em que o item faltou: o destino tem exatamente `faltas` linhas.
  const teses = a.mapa.find((l) => l.chave === "teses").celulas.find((c) => c.pessoa === M);
  assert.equal(teses.faltas, 3);
  assert.equal(filtrarLigacoes(avaliacoes, { pessoa: M, falta: "teses" }).length, teses.faltas);
  const abertura = a.mapa
    .find((l) => l.chave === "abertura")
    .celulas.find((c) => c.pessoa === "todos");
  assert.equal(abertura.faltas, filtrarLigacoes(avaliacoes, { falta: "abertura" }).length);
});

test("A pergunta que mais fica de fora e os antipadrões mais frequentes", () => {
  const a = aderencia(avaliacoes, pessoasDoRecorte(avaliacoes));
  assert.equal(a.maisFalta.chave, "teses");
  assert.equal(a.maisFalta.faltas, 4);
  assert.equal(a.maisFalta.n, 6);
  assert.deepEqual(a.maisFalta.frentes, ["J"]);
  assert.deepEqual(
    a.antipadroes.map((x) => [x.chave, x.n]),
    [
      ["falou_preco", 2],
      ["disse_frente", 1],
      ["prometeu_economia", 1],
    ],
  );
  assert.equal(filtrarLigacoes(avaliacoes, { antipadrao: "falou_preco" }).length, 2);
  // Só a Heloá: a pergunta muda, e não há coluna "Os dois".
  const h = aderencia(avaliacoes, pessoasDoRecorte(avaliacoes, H));
  assert.deepEqual(
    h.colunas.map((c) => c.id),
    [H],
  );
  assert.ok(["capital", "teses"].includes(h.maisFalta.chave));
  assert.equal(h.maisFalta.faltas, 1);
});

test("Evolução semanal: média por semana (segunda a domingo, dia em São Paulo), uma série por pessoa", () => {
  const a = aderencia(avaliacoes, pessoasDoRecorte(avaliacoes));
  assert.deepEqual(
    a.semanas.map((s) => s.semana),
    ["2026-09-28", "2026-10-05"],
  );
  const [s1, s2] = a.semanas;
  assert.equal(s1[serie(M)], umaCasa((70.8 + 100) / 2));
  assert.equal(s1[serie(H)], null, "sem ligação na semana é nulo, não zero");
  assert.equal(s2[serie(M)], umaCasa((66.7 + 41.7) / 2));
  assert.equal(s2[serie(H)], umaCasa((83.3 + 58.3) / 2));
  assert.equal(semanaDe("2026-10-11"), "2026-10-05"); // domingo fecha a semana
  assert.equal(semanaDe("2026-10-05"), "2026-10-05");
});

// ── Ritmo ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Ritmo: abordagens empilhadas por pessoa nos dias úteis, e a média é a do cartão", () => {
  const pessoas = pessoasDoRecorte(ritmo);
  const s = serieAbordagens(ritmo, pessoas, PERIODO);
  assert.deepEqual(
    s.pontos.map((p) => p.rotulo),
    ["01/10", "02/10", "05/10", "06/10", "07/10", "08/10", "09/10"],
  );
  assert.equal(s.uteis, 7);
  assert.equal(s.total, 74);
  assert.equal(s.media, 74 / 7);
  const dia5 = s.pontos.find((p) => p.dia === "2026-10-05");
  assert.equal(dia5[serie(M)], 8);
  assert.equal(dia5[serie(H)], 4);
  assert.equal(dia5.total, 12);
  // Um dia útil sem nenhuma linha aparece com zero (é dia de trabalho), e a soma por pessoa bate com o total.
  assert.equal(
    s.pontos.reduce((t, p) => t + p[serie(M)], 0),
    52,
  );
  const k = kpisRitmo(ritmo, atrasados, pessoas, PERIODO);
  assert.equal(k.abordagens, s.total);
  assert.equal(k.porDiaUtil, s.media);
  // Só a Heloá: outra série, outra média.
  const h = serieAbordagens(ritmo, pessoasDoRecorte(ritmo, H), PERIODO);
  assert.equal(h.total, 22);
  assert.equal(h.media, 22 / 7);
});

test("Ritmo: sábado trabalhado entra no gráfico, mas não na conta de dias úteis", () => {
  const linhas = normalizarRitmo([
    ...F.ritmo,
    { dia: "2026-10-03", user_id: M, pessoa: "Matheus Carvalho", abordagens: 2 },
  ]);
  const s = serieAbordagens(linhas, pessoasDoRecorte(linhas), PERIODO);
  assert.ok(s.pontos.some((p) => p.dia === "2026-10-03" && !p.util));
  assert.equal(s.uteis, 7);
  assert.equal(s.total, 76);
  assert.equal(
    uteisAteHoje("2026-10-01", "2026-10-31", "2026-10-09"),
    7,
    "o que não passou não divide",
  );
  assert.equal(uteisAteHoje("2026-10-10", "2026-10-31", "2026-10-09"), 0);
});

test("Ritmo: cadência de hoje, vencidas agora e ligações atendidas", () => {
  const k = kpisRitmo(ritmo, atrasados, pessoasDoRecorte(ritmo), PERIODO);
  assert.equal(k.feitasHoje, 14);
  assert.equal(k.previstasHoje, 30);
  assert.equal(k.vencidasAgora, 17);
  assert.equal(k.cardsAtrasados, 9);
  assert.equal(k.discadas, 73);
  assert.equal(k.atendidas, 39);
  assert.equal(k.taxaAtendidas, 39 / 73);
  // A caixa de atrasados soma o mesmo que o cartão (drill-down N2), e o dado de exemplo é coerente com o ritmo.
  const vencidasNoRitmo = ritmo.reduce((t, l) => t + l.atividades_vencidas, 0);
  assert.equal(vencidasNoRitmo, k.vencidasAgora);
  const kh = kpisRitmo(ritmo, atrasados, pessoasDoRecorte(ritmo, H), PERIODO);
  assert.equal(kh.vencidasAgora, 4);
  assert.equal(kh.cardsAtrasados, 3);
  // Sem ligação, a taxa é ausente, não zero.
  assert.equal(kpisRitmo([], [], pessoasDoRecorte([]), PERIODO).taxaAtendidas, null);
});

test("Ritmo: atividades por dia de uma pessoa, com o que ainda vai vencer hoje", () => {
  const s = serieAtividades(ritmo, M, PERIODO);
  assert.deepEqual(
    s.map((x) => x.rotulo),
    ["05/10", "06/10", "07/10", "08/10", "09/10"],
  );
  const hoje = s.at(-1);
  assert.deepEqual([hoje.feitas, hoje.vencidas, hoje.aVencer, hoje.previstas], [9, 3, 6, 18]);
  for (const x of s) assert.equal(x.feitas + x.vencidas + x.aVencer, x.previstas);
});

test("Atrasados em ordem de trabalho: mais vencidas primeiro", () => {
  const o = ordenarAtrasados(atrasados);
  assert.equal(o[0].empresa, "Transportadora Vale do Ipê Ltda");
  assert.deepEqual(
    o.slice(0, 3).map((a) => a.vencidas),
    [4, 3, 2],
  );
  for (let i = 1; i < o.length; i++) assert.ok(o[i - 1].vencidas >= o[i].vencidas);
});

// ── Ficha ────────────────────────────────────────────────────────────────────────────────────────────────────────

test("Ficha: situação na lista, duração e trecho marcado na transcrição", () => {
  assert.equal(situacaoDaLigacao("pendente"), "na_fila");
  assert.equal(situacaoDaLigacao("transcrevendo"), "na_fila");
  assert.equal(situacaoDaLigacao("transcrita"), "avaliando");
  assert.equal(situacaoDaLigacao("avaliada"), "avaliada");
  assert.equal(duracao(430), "7:10");
  assert.equal(duracao(3725), "1:02:05");
  assert.equal(duracao(null), "—");
  const f = normalizarFicha(F.fichas["900302"]);
  assert.equal(f.status, "avaliada");
  assert.equal(f.url, "https://grupoplanning.pipedrive.com/deal/900302");
  assert.equal(f.avaliacao.blocos.length, 3);
  assert.equal(f.avaliacao.qualificacao.frentes.length, 2);
  const capital = f.avaliacao.perguntas.find((p) => p.chave === "capital");
  const marcadas = falasDoTrecho(f.transcricao, capital.trecho);
  assert.equal(marcadas.length, 1);
  assert.equal(f.transcricao[marcadas[0]].falante, "pre_venda");
  // Ficha na fila: sem avaliação e sem transcrição, sem quebrar.
  const fila = normalizarFicha(F.fichas["900305"]);
  assert.equal(fila.avaliacao, null);
  assert.deepEqual(fila.transcricao, []);
});

test("Acréscimos do backend (09/10): nome pelo user_id, rebaixado, trecho da frente e oportunidade", () => {
  // A ficha (RPC 4) traz o nome bruto do Pipedrive; a tela mostra o do cadastro, como nas listas.
  assert.equal(F.fichas["900304"].pessoa, "Matheus Pereira de Carvalho");
  const f = normalizarFicha(F.fichas["900304"]);
  assert.equal(f.pessoa, "Matheus Carvalho");
  assert.equal(nomeDaPessoa(null, "Alguém de fora"), "Alguém de fora");
  assert.equal(nomeDaPessoa(999, null), "Sem dono");
  // A pergunta citada pela IA sem trecho na transcrição vem rebaixada e conta como não feita.
  const porte = f.avaliacao.perguntas.find((p) => p.chave === "porte");
  assert.deepEqual([porte.feita, porte.rebaixada], [false, true]);
  assert.equal(f.avaliacao.perguntas.find((p) => p.chave === "momento").rebaixada, false);
  const clinica = normalizarFicha(F.fichas["900402"]);
  const abertura = clinica.avaliacao.blocos.find((b) => b.chave === "abertura");
  assert.deepEqual([abertura.executou, abertura.rebaixado], ["nao", true]);
  // A fala do cliente que sustenta o sinal da frente.
  const finance = f.avaliacao.qualificacao.frentes.find((x) => x.frente === "finance");
  assert.equal(finance.sinal, "segue");
  assert.ok(f.transcricao.some((x) => x.falante === "cliente" && x.texto === finance.trecho));
  // Oportunidade só aceita sim, nao e sem_dado; o resto vira ausente.
  assert.equal(f.avaliacao.oportunidade, "sem_dado");
  assert.equal(
    normalizarFicha({ avaliacao: { oportunidade: "indefinido" } }).avaliacao.oportunidade,
    null,
  );
  assert.equal(f.tentativas, 1);
  assert.equal(f.custo_usd, 0.031);
  assert.ok(f.notas_em);
  // Linhas antigas sem os campos novos continuam valendo (acréscimo é opcional).
  const [b] = normalizarAvaliacoes([{ blocos: [{ chave: "abertura", executou: "sim" }] }])[0]
    .blocos;
  assert.equal(b.rebaixado, false);
});

// ── Estados ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("Estados vazios: sem ligação avaliada, a pessoa e a célula ficam ausentes, nunca zero", () => {
  const a = aderencia([], pessoasDoRecorte([]));
  assert.equal(a.n, 0);
  assert.equal(a.maisFalta, null);
  assert.deepEqual(a.antipadroes, []);
  assert.deepEqual(a.semanas, []);
  for (const p of a.porPessoa) assert.equal(p.media, null);
  for (const l of a.mapa) for (const c of l.celulas) assert.equal(c.valor, null);
  // Só ligações na fila: nada entra na conta, mas a lista da Ficha mostra as duas.
  const fila = avaliacoes.filter((l) => l.status !== "avaliada");
  assert.equal(aderencia(fila, pessoasDoRecorte(fila)).n, 0);
  assert.equal(filtrarLigacoes(fila, {}).length, 2);
  // Pessoa sem ligação no recorte aparece com ausência (Heloá antes de ligar pelo ramal).
  const soMatheus = avaliacoes.filter((l) => l.user_id === M);
  const h = aderencia(soMatheus, pessoasDoRecorte(soMatheus)).porPessoa.find(
    (p) => p.pessoa.id === H,
  );
  assert.equal(h.n, 0);
  assert.equal(h.media, null);
});

test("Erro da RPC: sem acesso e função ainda não criada não viram erro de leitura", () => {
  const sem = mensagemDeErroPreVenda({ code: "42501" }, "x");
  const nao = mensagemDeErroPreVenda({ code: "PGRST202" }, "x");
  const falha = mensagemDeErroPreVenda({ code: "57014" }, "o ritmo da pré-venda");
  assert.equal(classificarErroPreVenda(sem), "sem-acesso");
  assert.equal(classificarErroPreVenda(nao), "nao-ativada");
  assert.equal(
    classificarErroPreVenda(mensagemDeErroPreVenda({ code: "42883" }, "x")),
    "nao-ativada",
  );
  assert.equal(classificarErroPreVenda(falha), "erro");
  assert.match(falha, /o ritmo da pré-venda/);
});

// ── Navegação ────────────────────────────────────────────────────────────────────────────────────────────────────

test("Menu da Monetização: seis itens, Pré-venda logo depois da Operação diária", () => {
  const area = AREAS.find((a) => a.slug === "monetizacao");
  const itens = area.grupos.flatMap((g) => g.items);
  assert.deepEqual(
    itens.map((i) => i.title),
    [
      "Operação diária",
      "Pré-venda",
      "Consultoria",
      "Funil comercial",
      "Abordagens",
      "Distribuição",
    ],
  );
  assert.equal(itens[1].url, "/monetizacao?aba=pre-venda");
  assert.equal(area.grupos[0].label, "Oportunidades");
  assert.ok(!itens.some((i) => /aba=(gravacoes|pessoas)/.test(i.url)));
  // Toda aba do menu é uma aba válida da tela.
  for (const i of itens) {
    const aba = new URLSearchParams(i.url.split("?")[1] ?? "").get("aba") ?? "operacao";
    assert.ok(ABAS.includes(aba), aba);
  }
});

test("Pré-venda: visão na URL, Ritmo por padrão, e cada chave só vale na visão dela", () => {
  assert.equal(validarBuscaMonetizacao({ aba: "pre-venda" }).visao, undefined);
  assert.equal(validarBuscaMonetizacao({ aba: "pre-venda", visao: "ritmo" }).visao, undefined);
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda", visao: "aderencia" }).visao,
    "aderencia",
  );
  assert.equal(validarBuscaMonetizacao({ aba: "pre-venda", visao: "cruzamento" }).visao, undefined);
  assert.equal(
    validarBuscaMonetizacao({ aba: "handoff-consultoria", visao: "ficha" }).visao,
    undefined,
  );
  assert.equal(
    validarBuscaMonetizacao({ aba: "handoff-consultoria", visao: "empresa" }).visao,
    "empresa",
  );
  const f = validarBuscaMonetizacao({
    aba: "pre-venda",
    visao: "ficha",
    ligacao: "900302",
    falta: "teses",
    antipadrao: "falou_preco",
    responsavel: String(H),
  });
  assert.deepEqual(
    [f.ligacao, f.falta, f.antipadrao, f.responsavel],
    [900302, "teses", "falou_preco", H],
  );
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda", visao: "ficha", falta: "x" }).falta,
    undefined,
  );
  // `falta` e `ligacao` são da Ficha › Ligações: na Aderência ou nas Reuniões, caem.
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda", visao: "aderencia", falta: "teses" }).falta,
    undefined,
  );
  const r = validarBuscaMonetizacao({
    aba: "pre-venda",
    visao: "ficha",
    ficha: "reunioes",
    ligacao: "1",
  });
  assert.equal(r.ficha, "reunioes");
  assert.equal(r.ligacao, undefined);
});

test("Links antigos: Gravações abre Ficha › Reuniões e Pessoas e PDI abre Aderência, com o aviso", () => {
  const g = validarBuscaMonetizacao({
    aba: "gravacoes",
    reuniao: "hist-77-proposta",
    mes: "2026-10",
    q: "agro",
  });
  assert.equal(g.aba, "pre-venda");
  assert.equal(g.visao, "ficha");
  assert.equal(g.ficha, "reunioes");
  assert.equal(g.aposentada, "gravacoes");
  // O link de uma reunião continua abrindo a mesma reunião.
  assert.deepEqual([g.reuniao, g.mes, g.q], ["hist-77-proposta", "2026-10", "agro"]);
  const p = validarBuscaMonetizacao({ aba: "pessoas", responsavel: String(M) });
  assert.equal(p.aba, "pre-venda");
  assert.equal(p.visao, "aderencia");
  assert.equal(p.aposentada, "pessoas");
  assert.equal(p.responsavel, M);
  assert.deepEqual(avisoDaAposentada("gravacoes"), {
    tela: "Gravações",
    onde: "Pré-venda › Ficha › Reuniões",
  });
  assert.deepEqual(avisoDaAposentada("pessoas"), {
    tela: "Pessoas e PDI",
    onde: "Pré-venda › Aderência",
  });
  // O aviso fica na URL até fechar, mas só na tela de destino.
  assert.equal(
    validarBuscaMonetizacao({ aba: "pre-venda", aposentada: "gravacoes" }).aposentada,
    "gravacoes",
  );
  assert.equal(
    validarBuscaMonetizacao({ aba: "funil", aposentada: "gravacoes" }).aposentada,
    undefined,
  );
  // As quatro de 09/10 seguem abrindo a Operação diária.
  const t = validarBuscaMonetizacao({ aba: "follow-day" });
  assert.equal(t.aba, "operacao");
  assert.equal(t.aposentada, "follow-day");
  assert.deepEqual(avisoDaAposentada("follow-day"), {
    tela: "Follow Day",
    onde: "Operação diária",
  });
  // `arquivados` era só do PDI e saiu com ele.
  assert.equal(
    "arquivados" in validarBuscaMonetizacao({ aba: "operacao", arquivados: "mostrar" }),
    false,
  );
});
