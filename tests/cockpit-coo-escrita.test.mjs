import test from "node:test";
import assert from "node:assert/strict";
import {
  prazoEmMs,
  proximaReuniao,
  validarNovo,
  camposDoCompromisso,
  corpoTarefaNova,
  statusConcluido,
  corpoTrocaDono,
  corpoComentario,
} from "../src/lib/cockpit-coo/escrita.ts";
import { linhaDoEspelho, marcasDoTexto } from "../supabase/functions/_shared/clickup/compromissos.ts";
import { ehCompromissoDaRotina, temaDoTexto } from "../src/lib/cockpit-coo/compromissos.ts";

const dd = (id, nome, opcoes) => ({
  id,
  name: nome,
  type: "drop_down",
  type_config: { options: opcoes.map((n, i) => ({ id: `${id}-${i}`, name: n, orderindex: i })) },
});
const CAMPOS = [
  dd("fT", "Tema", ["Growth", "Financeiro e Operações", "CS e RH", "Monetização", "Estratégico"]),
  dd("fU", "Unidade", ["Belém", "Goiânia", "São Luís", "Rede"]),
  { id: "fO", name: "Origem no Brain", type: "short_text" },
];
const NOVO = {
  titulo: "Cobrar fatura da apuração de agosto",
  contexto: "Belém · apuração fechada sem fatura",
  donoId: 123,
  prazo: "2026-10-06",
  tema: "financeiro-operacoes",
  unidade: "Belém",
  chaveAlerta: "coo:financeiro-operacoes:fechada-sem-fatura:belem:2026-08",
  linkBrain: "https://planningbrain.com.br/cockpit-coo?tema=financeiro-operacoes",
};
const AUTOR = { nome: "Paulo Carvalho", email: "paulo.carvalho@planning.com.br" };

test("prazo: 18h de São Paulo no dia escolhido; formato inválido é recusado", () => {
  assert.equal(new Date(prazoEmMs("2026-10-06")).toISOString(), "2026-10-06T21:00:00.000Z");
  assert.throws(() => prazoEmMs("06/10/2026"), /Prazo inválido/);
});

test("próxima reunião do mesmo tema, sempre depois de hoje", () => {
  // Terça 29/09: a próxima terça é 06/10; a próxima segunda é 05/10; a sexta é 02/10.
  assert.equal(proximaReuniao("financeiro-operacoes", "2026-09-29"), "2026-10-06");
  assert.equal(proximaReuniao("growth", "2026-09-29"), "2026-10-05");
  assert.equal(proximaReuniao("estrategico", "2026-09-29"), "2026-10-02");
});

test("validação: dono único, prazo, tema e unidade obrigatórios", () => {
  assert.equal(validarNovo(NOVO, "2026-09-29"), null);
  assert.match(validarNovo({ ...NOVO, donoId: 0 }, "2026-09-29"), /dono/);
  assert.match(validarNovo({ ...NOVO, prazo: "2026-09-28" }, "2026-09-29"), /passado/);
  assert.match(validarNovo({ ...NOVO, titulo: " " }, "2026-09-29"), /precisa ser feito/);
  assert.match(validarNovo({ ...NOVO, unidade: "" }, "2026-09-29"), /unidade/);
});

test("campos: tema e unidade por opção (sem acento), origem pela chave do alerta", () => {
  const r = camposDoCompromisso(CAMPOS, NOVO);
  assert.deepEqual(r.faltando, []);
  assert.deepEqual(r.custom_fields, [
    { id: "fT", value: "fT-1" },
    { id: "fU", value: "fU-0" },
    { id: "fO", value: NOVO.chaveAlerta },
  ]);
  const semCampos = camposDoCompromisso([], NOVO);
  assert.deepEqual(semCampos.faltando, ["Tema", "Unidade", "Origem no Brain"]);
  const semOpcao = camposDoCompromisso(CAMPOS, { ...NOVO, unidade: "Recife" });
  assert.deepEqual(semOpcao.faltando, ['Unidade (opção "Recife")']);
});

test("corpo da tarefa: um dono, prazo em ms, autor real na descrição", () => {
  const { corpo, faltando } = corpoTarefaNova(NOVO, CAMPOS, AUTOR, "2026-09-29T14:05:00.000Z");
  assert.deepEqual(faltando, []);
  assert.equal(corpo.name, NOVO.titulo);
  assert.deepEqual(corpo.assignees, [123]);
  assert.equal(corpo.due_date, Date.parse("2026-10-06T21:00:00.000Z"));
  assert.match(corpo.markdown_description, /Criado pelo Cockpit do COO por Paulo Carvalho \(paulo\.carvalho@planning\.com\.br\)/);
  assert.match(corpo.markdown_description, /Ter · Financeiro e Operações/);
  assert.match(corpo.markdown_description, /coo:financeiro-operacoes:fechada-sem-fatura:belem:2026-08/);
  const semCampos = corpoTarefaNova(NOVO, [], AUTOR, "2026-09-29T14:05:00.000Z");
  assert.match(semCampos.corpo.markdown_description, /Campos que faltam na lista do ClickUp: Tema, Unidade, Origem no Brain/);
});

test("status concluído: closed; senão o último done", () => {
  assert.equal(statusConcluido([{ status: "pendente", type: "open" }, { status: "feito", type: "done" }, { status: "arquivado", type: "closed" }]), "arquivado");
  assert.equal(statusConcluido([{ status: "a", type: "open" }, { status: "ok", type: "done" }, { status: "ok2", type: "done" }]), "ok2");
  assert.equal(statusConcluido([{ status: "a", type: "open" }]), null);
});

test("troca de dono tira todos os outros; comentário leva o autor", () => {
  assert.deepEqual(corpoTrocaDono(["1", "2", 3], 2), { assignees: { add: [2], rem: [1, 3] } });
  assert.deepEqual(corpoComentario(" feito ", AUTOR), { comment_text: "feito\n\n— Paulo Carvalho, pelo Cockpit do COO", notify_all: false });
  assert.throws(() => corpoComentario("  ", AUTOR), /Escreva/);
});

test("sem os campos na lista, tema, unidade e alerta voltam pelo texto da tarefa", () => {
  const { corpo } = corpoTarefaNova(NOVO, [], AUTOR, "2026-09-29T14:05:00.000Z");
  // O ClickUp devolve a descrição sem a marcação (conferido na API em 29/09/2026).
  const texto = corpo.markdown_description.replace(/\*\*|`/g, "");
  const m = marcasDoTexto(texto);
  assert.equal(temaDoTexto(m.tema), "financeiro-operacoes");
  assert.equal(m.unidade, "Belém");
  assert.equal(m.origem, NOVO.chaveAlerta);
  assert.deepEqual(marcasDoTexto(corpo.markdown_description), m);
  const l = linhaDoEspelho({
    id: "x1", name: NOVO.titulo, url: "u", parent: null,
    status: { status: "pendente", type: "open" },
    list: { id: "L", name: "✅ Compromissos da rotina" },
    folder: { id: "F", name: "🗓️ Rotina Semanal · Paulo" },
    custom_fields: [],
    text_content: texto,
  });
  assert.equal(l.origem, NOVO.chaveAlerta);
  assert.equal(l.unidade, "Belém");
  // Campo preenchido no ClickUp vence o texto.
  const comCampo = linhaDoEspelho({
    id: "x2", name: "t", url: "u", parent: null, status: { status: "pendente", type: "open" },
    custom_fields: [{ id: "fU", name: "Unidade", type: "drop_down", value: 1, type_config: { options: [{ id: "a", name: "Belém", orderindex: 0 }, { id: "b", name: "Rede", orderindex: 1 }] } }],
    text_content: texto,
  });
  assert.equal(comCampo.unidade, "Rede");
  assert.deepEqual(marcasDoTexto("Tarefa comum, sem marca."), { tema: null, unidade: null, origem: null });
});

test("compromisso é a lista de compromissos da pasta da rotina, com ou sem enfeite no nome", () => {
  assert.equal(ehCompromissoDaRotina("🗓️ Rotina Semanal · Paulo", "✅ Compromissos da rotina"), true);
  assert.equal(ehCompromissoDaRotina("Rotina Semanal", "Compromissos"), true);
  assert.equal(ehCompromissoDaRotina("🗓️ Rotina Semanal · Paulo", "📅 Minha Semana"), false);
  assert.equal(ehCompromissoDaRotina("Operações · Victor", "Compromissos"), false);
  assert.equal(ehCompromissoDaRotina(null, "Compromissos"), false);
});
