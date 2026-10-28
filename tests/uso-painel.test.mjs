// Contas da tela /uso-brain (contrato docs/design/contratos/uso-brain.md).
import test from "node:test";
import assert from "node:assert/strict";
import { formatarHoras, resumir, segundaDaSemana } from "../src/lib/uso-painel.ts";

const membro = (user_id, extra = {}) => ({
  user_id,
  email: `${user_id}@x.com`,
  nome: user_id,
  ativo: true,
  concedido_em: "2026-01-01T00:00:00Z",
  papeis: "socio",
  ultimo_login: null,
  ...extra,
});

const painel = {
  membros: [
    membro("ana"),
    membro("bia"),
    membro("adm", { papeis: "admin" }),
    membro("saiu", { ativo: false }),
    membro("novo", { concedido_em: "2026-11-02T00:00:00Z" }), // depois da semana
  ],
  dia: [
    { user_id: "ana", dia: "2026-10-27", minutos: 90 }, // semana 26/10
    { user_id: "ana", dia: "2026-10-20", minutos: 40 }, // semana anterior
    { user_id: "adm", dia: "2026-10-28", minutos: 300 },
    { user_id: "saiu", dia: "2026-10-28", minutos: 50 },
  ],
  sessoes: [],
  rota_semana: [
    { user_id: "ana", semana: "2026-10-26", rota: "/clientes", minutos: 60 },
    { user_id: "ana", semana: "2026-10-26", rota: "/base", minutos: 30 },
    { user_id: "adm", semana: "2026-10-26", rota: "/clientes", minutos: 300 },
  ],
  calor: [{ user_id: "ana", dow: 1, hora: 9, minutos: 90 }],
  historico: [{ user_id: "ana", primeiro_dia: "2026-10-20", ultimo_uso: "2026-10-27T15:00:00Z" }],
};

test("segunda da semana", () => {
  assert.equal(segundaDaSemana("2026-10-28"), "2026-10-26");
  assert.equal(segundaDaSemana("2026-11-01"), "2026-10-26"); // domingo
  assert.equal(segundaDaSemana("2026-10-26"), "2026-10-26");
});

test("com admins: inativo e quem ainda não tinha acesso ficam fora da base", () => {
  const r = resumir(painel, "2026-10-26", true);
  assert.equal(r.comAcesso, 3); // ana, bia, adm
  assert.equal(r.ativos, 2);
  assert.equal(r.minutosSemana, 390);
  assert.deepEqual(r.ranking.map((l) => l.membro.user_id), ["adm", "ana"]);
  assert.deepEqual(r.semUso.map((l) => l.membro.user_id), ["bia"]);
  assert.deepEqual(r.telas[0], { rota: "/clientes", minutos: 360 });
});

test("sem admins (R-06) e média de 4 semanas divide por 4 fixo", () => {
  const r = resumir(painel, "2026-10-26", false);
  assert.equal(r.comAcesso, 2);
  assert.equal(r.ativos, 1);
  assert.equal(r.ranking[0].mediaMin4Sem, 10); // 40 min em 4 semanas
  assert.equal(r.calor[1][9], 90);
});

test("filtro por pessoa só recorta telas e mapa", () => {
  const r = resumir(painel, "2026-10-26", true, "adm");
  assert.deepEqual(r.telas, [{ rota: "/clientes", minutos: 300 }]);
  assert.equal(r.calor[1][9], 0);
  assert.equal(r.ativos, 2);
});

test("horas", () => {
  assert.equal(formatarHoras(45), "45min");
  assert.equal(formatarHoras(60), "1h");
  assert.equal(formatarHoras(135), "2h15");
});
