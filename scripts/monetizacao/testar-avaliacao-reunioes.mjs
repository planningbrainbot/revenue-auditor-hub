// Confere a avaliação de reunião da Edge Function `monetizacao-reunioes` contra o protótipo validado em Python
// (monetizacao/comercial/guia-closer/avaliacao/avaliar.py), sobre a MESMA resposta do modelo: nenhuma chamada nova.
//
//   node --experimental-strip-types scripts/monetizacao/testar-avaliacao-reunioes.mjs <avaliacao-<tipo>.json> <transcricao.txt> <nota-<tipo>.html> [rubrica.json]
//
// Os três primeiros arquivos saem do protótipo (`avaliar.py ... <pasta>`). Eles têm dado de cliente e ficam fora do
// repositório. O quarto, opcional, é a rubrica do protótipo: o teste confere que a cópia em rubrica.ts é idêntica.
// Também testa, sem arquivo nenhum, a leitura da atividade do Pipedrive (agenda.ts). Sai com código 1 se algo falhar.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import {
  apurar,
  confere,
  normal,
  notaPipedrive,
  transcricaoDasFalas,
} from "../../supabase/functions/monetizacao-reunioes/avaliacao.ts";
import {
  eventId,
  linkDoTeams,
  proximaReuniao,
  tipoDaEtapa,
} from "../../supabase/functions/monetizacao-reunioes/agenda.ts";
import { RUBRICA } from "../../supabase/functions/monetizacao-reunioes/rubrica.ts";

let falhas = 0;
const checar = (nome, fn) => {
  try {
    fn();
    console.log("ok ·", nome);
  } catch (e) {
    falhas++;
    console.log("FALHOU ·", nome, "\n   ", e.message.split("\n").slice(0, 6).join("\n    "));
  }
};

// --- agenda.ts, com atividades sintéticas
const agora = new Date("2026-10-02T12:00:00Z");
checar("etapas por nome", () => {
  assert.equal(tipoDaEtapa("4 · Reunião de levantamento agendada"), "levantamento");
  assert.equal(tipoDaEtapa("6 · Reunião de proposta"), "proposta");
  assert.equal(tipoDaEtapa("5 · Reunião de levantamento realizada"), null);
  assert.equal(tipoDaEtapa("7 · Em negociação"), null);
});
checar("link do Teams em qualquer campo", () => {
  assert.equal(linkDoTeams({ location: "sala" }), null);
  assert.equal(
    linkDoTeams({
      note: '<a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=a&amp;b=1">entrar</a>',
    }),
    "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x/0?context=a&b=1",
  );
  assert.equal(
    linkDoTeams({ conference_meeting_url: "https://teams.live.com/meet/123" }),
    "https://teams.live.com/meet/123",
  );
});
checar("próxima reunião válida, hora em UTC e duração", () => {
  const acts = [
    {
      id: 1,
      type: "call",
      due_date: "2026-10-02",
      due_time: "17:00",
      location: "https://teams.microsoft.com/l/x",
    },
    {
      id: 2,
      type: "meeting",
      due_date: "2026-10-02",
      due_time: "18:00",
      duration: "00:30",
      location: "https://teams.microsoft.com/l/b",
    },
    {
      id: 3,
      type: "meeting",
      due_date: "2026-10-02",
      due_time: "15:00",
      location: "https://teams.microsoft.com/l/a",
    },
    {
      id: 4,
      type: "meeting",
      due_date: "2026-10-01",
      due_time: "15:00",
      location: "https://teams.microsoft.com/l/velha",
    },
    { id: 5, type: "meeting", due_date: "2026-10-02", due_time: "14:00", location: "sem link" },
    {
      id: 6,
      type: "meeting",
      done: true,
      due_date: "2026-10-02",
      due_time: "13:00",
      location: "https://teams.microsoft.com/l/feita",
    },
  ];
  const r = proximaReuniao(acts, agora);
  assert.equal(r.atividade_id, 3);
  assert.equal(r.inicio, "2026-10-02T15:00:00.000Z");
  assert.equal(r.fim, "2026-10-02T16:00:00.000Z");
  assert.equal(proximaReuniao([acts[1]], agora).fim, "2026-10-02T18:30:00.000Z");
  assert.equal(proximaReuniao([acts[3], acts[4]], agora), null);
});
checar("event_id no formato da SDR IA", () => {
  assert.equal(eventId(98005, "2026-10-02T15:00:00.000Z"), "pedido-monet-98005-20261002T1500");
});
checar("falas do Brain Meet viram texto com minuto", () => {
  const t = transcricaoDasFalas([
    { ordem: 2, inicio_s: "75.4", falante: "Falante 2", texto: "b" },
    { ordem: 1, inicio_s: 3, falante: "Falante 1", texto: "a" },
  ]);
  assert.equal(t, "[00:03] Falante 1: a\n[01:15] Falante 2: b");
});
checar("conferência de trecho: inteiro, janela de 12 palavras e paráfrase", () => {
  const base = normal(
    "Bom dia, aqui é o Matheus da Planning e hoje vamos olhar as três frentes do Caixa de Oportunidade da sua empresa em vinte minutos.",
  );
  assert.equal(confere("hoje vamos olhar as três frentes do Caixa de Oportunidade", base), true);
  assert.equal(
    confere(
      "aqui é o Matheus da Planning e hoje vamos olhar as três frentes do Caixa, isso aqui não existe",
      base,
    ),
    true,
  );
  assert.equal(confere("vamos analisar os três produtos da empresa nesta conversa", base), false);
  assert.equal(confere("curto", base), false);
});

// --- protótipo × porte, sobre a mesma resposta
const [aval, transc, html, rubricaJson] = process.argv.slice(2);
if (rubricaJson)
  checar("rubrica.ts idêntica à do protótipo", () =>
    assert.deepEqual(RUBRICA, JSON.parse(readFileSync(rubricaJson, "utf8"))),
  );
if (aval && transc) {
  const py = JSON.parse(readFileSync(aval, "utf8"));
  const texto = readFileSync(transc, "utf8");
  const ts = apurar(py.avaliacao.tipo, py.resposta_bruta, texto);
  const sem = (a) => ({ ...a });
  checar("fases: execução, rebaixamento e antipadrões", () =>
    assert.deepEqual(
      ts.fases.map((f) => [f.id, f.executou, f.rebaixada, f.antipadroes]),
      py.avaliacao.fases.map((f) => [f.id, f.executou, f.rebaixada, f.antipadroes]),
    ),
  );
  checar("nota e blocos", () => {
    assert.equal(ts.nota, py.avaliacao.nota);
    assert.deepEqual(sem(ts.blocos), sem(py.avaliacao.blocos));
  });
  checar("ofertado e produtos que seguem", () => {
    assert.deepEqual(ts.ofertado, py.avaliacao.ofertado);
    assert.deepEqual(ts.produtos_que_seguem, py.avaliacao.produtos_que_seguem);
  });
  if (html) {
    const dataReuniao =
      readFileSync(html, "utf8").match(/ · (\d\d\/\d\d\/\d{4}[^·]*?) · nota/)?.[1] ?? "";
    const fonte = readFileSync(html, "utf8").match(/<i>Base: (.*?); rubrica/)?.[1] ?? "";
    checar("HTML da nota igual ao do protótipo", () =>
      assert.equal(
        notaPipedrive(ts, dataReuniao, fonte.replace(/&#x27;/g, "'")),
        readFileSync(html, "utf8"),
      ),
    );
  }
}
console.log(falhas ? `${falhas} falha(s)` : "tudo certo");
process.exit(falhas ? 1 : 0);
