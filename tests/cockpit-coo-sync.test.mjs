import test from "node:test";
import assert from "node:assert/strict";
import { planejarRodada, diaSaoPaulo, PASTAS_FORA_DOS_OKRS } from "../supabase/functions/clickup-sync/dominio.ts";
import { linhaDoEspelho } from "../supabase/functions/_shared/clickup/compromissos.ts";

const t = (id, lista, extra = {}) => ({
  id,
  name: `T ${id}`,
  url: `u/${id}`,
  parent: null,
  status: { status: "pendente", type: "open" },
  custom_fields: [],
  list: { id: lista, name: `Lista ${lista}` },
  ...extra,
});

const PASTAS = [
  { id: "P-OP", name: "Operações · Victor", lists: [{ id: "L-OP", name: "Objetivo Op" }] },
  { id: "P-ROT", name: "Rotina Semanal", lists: [{ id: "L-ROT", name: "Compromissos da rotina" }] },
];

test("primeira rodada é linha de base: grava tudo, nenhum evento, nenhuma sumida", () => {
  const p = planejarRodada([], [t("k1", "L-OP"), t("c1", "L-ROT")], PASTAS, null, "2026-09-29");
  assert.equal(p.linhas.length, 2);
  assert.equal(p.eventos.length, 0);
  assert.equal(p.sumidas.length, 0);
  // A pasta vem da estrutura quando a tarefa não traz `folder`.
  assert.equal(p.linhas.find((l) => l.id === "c1").pasta_nome, "Rotina Semanal");
});

test("a foto de OKR não conta a Rotina Semanal como KR", () => {
  const p = planejarRodada([], [t("k1", "L-OP"), t("c1", "L-ROT")], PASTAS, null, "2026-09-29");
  assert.deepEqual(p.snapshot.map((s) => s.kr_id), ["k1"]);
  assert.equal(p.snapshot[0].departamento, "Operações · Victor");
  assert.equal(p.snapshot[0].dia, "2026-09-29");
  assert.ok(PASTAS_FORA_DOS_OKRS.test("Manutenção do Brain"));
});

test("rodada seguinte registra mudanças e sumidas; tarefa repetida entre páginas conta uma vez", () => {
  const anteriores = [linhaDoEspelho(t("c1", "L-ROT")), linhaDoEspelho(t("c2", "L-ROT"))];
  const agora = [
    t("c1", "L-ROT", { status: { status: "concluído", type: "closed" }, date_done: "1790000000000" }),
    t("c1", "L-ROT", { status: { status: "concluído", type: "closed" }, date_done: "1790000000000" }),
    t("c3", "L-ROT"),
  ];
  const p = planejarRodada(anteriores, agora, PASTAS, null, "2026-09-29");
  assert.equal(p.linhas.length, 2);
  assert.deepEqual(
    p.eventos.map((e) => `${e.tarefa_id}:${e.tipo}`).sort(),
    ["c1:concluida", "c2:sumiu", "c3:criada"],
  );
  assert.deepEqual(p.sumidas, ["c2"]);
});

test("leitura que perde mais da metade não marca ninguém como sumido", () => {
  const anteriores = Array.from({ length: 10 }, (_, i) => linhaDoEspelho(t(`c${i}`, "L-ROT")));
  const p = planejarRodada(anteriores, [t("c0", "L-ROT")], PASTAS, null, "2026-09-29");
  assert.deepEqual(p.sumidas, []);
  assert.equal(p.sumidasRecusadas, true);
  assert.equal(p.eventos.filter((e) => e.tipo === "sumiu").length, 0);
});

test("medição do Brain entra na foto da KR mapeada", () => {
  const pastas = [{ id: "P-PT", name: "Performance & Tech · Mikael", lists: [{ id: "L-PT", name: "Obj" }] }];
  const p = planejarRodada(
    [],
    [t("86e2gnh64", "L-PT", { name: "CPMQL ≤ R$ 300" })],
    pastas,
    { campanhas: [{ investimento: 3000, mql: 10 }], trafegoDia: [], metricasPessoa: [], ticketReal: null },
    "2026-09-29",
  );
  assert.equal(p.snapshot[0].origem, "brain");
  assert.equal(p.snapshot[0].progresso, 1);
});

test("dia da foto no fuso de São Paulo", () => {
  // 02h UTC do dia 30 ainda é dia 29 em São Paulo.
  assert.equal(diaSaoPaulo(new Date("2026-09-30T02:00:00Z")), "2026-09-29");
});
