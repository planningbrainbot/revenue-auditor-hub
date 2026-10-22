// Envio para a Diehl & Cella: quem entra, ganho por produto contratado, motivo neutro, negócio fechado do lado deles,
// criação completa, prévia sem chamar o Pipedrive deles e o espelho dos pipes 39 e 40, com tudo simulado.
import test from "node:test";
import assert from "node:assert/strict";
import {
  CELLA,
  PLANNING,
  corpoNegocio,
  corpoOrganizacao,
  corpoPessoa,
  decidir,
  detalheDe,
  fonte39,
  fonte40,
  hashDe,
  motivoNeutro,
  rodarCella,
  ufDe,
} from "../supabase/functions/monetizacao-cella-envio/logica.ts";

const card = (o = {}) => ({
  pipe: 39,
  deal_id: 98123,
  nome: "Transportadora Exemplo",
  status: "open",
  stage_id: 278,
  cella: true,
  lost_reason: null,
  reuniao: "2026-10-08",
  org_id: 1,
  ...o,
});
const conhecido = (o = {}) => ({
  deal_id: 98123,
  pipe: 39,
  vinculo: "existente",
  estado: "ativo",
  cella_deal_id: 2160,
  hash: null,
  ultimo_evento: null,
  ...o,
});

test("só entra da reunião de proposta em diante, e perdido nunca entra na primeira vez", () => {
  assert.deepEqual(decidir(card({ stage_id: 287 }), null), { tipo: "nada" });
  assert.equal(decidir(card({ stage_id: 291 }), null).evento, "entrou");
  assert.equal(decidir(card({ stage_id: 291 }), null).stage_id, 35);
  assert.equal(decidir(card({ stage_id: 279 }), null).stage_id, 36);
  assert.equal(decidir(card({ stage_id: 288 }), null).stage_id, 37);
  assert.deepEqual(decidir(card({ status: "lost" }), null), { tipo: "nada" });
  assert.deepEqual(decidir(card({ cella: false }), null), { tipo: "nada" });
});

test("ganho do card só é ganho da Cella com ela em Produtos contratados", () => {
  assert.equal(decidir(card({ status: "won" }), null, null).tipo, "pendente");
  const g = decidir(card({ status: "won" }), null, [PLANNING.contratadoCella]);
  assert.equal(g.evento, "ganhou");
  assert.equal(g.encerra, true);
  // Fechou só outro produto: para a Cella é perda, com motivo neutro e sem citar o produto.
  const p = decidir(card({ status: "won" }), conhecido(), [1206]);
  assert.equal(p.evento, "perdeu");
  assert.equal(p.lost_reason, "Cliente não seguiu com a proposta");
  assert.equal(p.status, "lost");
});

test("a Cella sai do card: perdeu neutro para quem já recebeu, nada para quem não recebeu", () => {
  const d = decidir(card({ cella: false }), conhecido());
  assert.equal(d.evento, "perdeu");
  assert.equal(d.lost_reason, "Cliente não seguiu com a proposta");
  assert.deepEqual(decidir(card({ cella: false }), null), { tipo: "nada" });
});

test("o motivo de perda nunca repete o texto do card", () => {
  assert.equal(motivoNeutro("Fechou Consultoria e não quis a Cella"), "Cliente não seguiu com a proposta");
  assert.equal(motivoNeutro("Tentativa de contato esgotadas"), "Sem retorno do cliente");
  assert.equal(motivoNeutro("Sem fit"), "Sem oportunidade identificada");
  assert.equal(motivoNeutro(null), "Cliente não seguiu com a proposta");
  for (const m of ["Finance", "Consultoria", "outro produto"])
    assert.ok(!motivoNeutro(`perdido por ${m}`).toLowerCase().includes(m.toLowerCase()));
});

test("encerrado e parado do lado deles não recebem mais nada", () => {
  assert.deepEqual(decidir(card(), conhecido({ estado: "encerrado" })), { tipo: "nada" });
  assert.deepEqual(decidir(card(), conhecido({ estado: "parado_deles" })), { tipo: "nada" });
});

test("pipe 40: só com a Teses no card, da apresentação agendada em diante", () => {
  const f = (o) => card({ pipe: 40, ...o });
  assert.deepEqual(decidir(f({ stage_id: 298 }), null), { tipo: "nada" });
  assert.equal(decidir(f({ stage_id: 299 }), null).stage_id, 35);
  assert.equal(decidir(f({ stage_id: 300 }), null).stage_id, 36);
  assert.equal(decidir(f({ status: "won", stage_id: 301 }), null).evento, "ganhou");
  // Venda parcial sem a Teses: o produto saiu do card antes do ganho.
  assert.equal(decidir(f({ status: "won", cella: false }), conhecido({ pipe: 40 })).evento, "perdeu");
});

test("empresa, contato e corpos do Pipedrive deles", () => {
  const det = detalheDe(
    { [PLANNING.campo.regime]: 352, [PLANNING.campo.faixa]: 778, title: "x" },
    { name: "Transportadora Exemplo", [PLANNING.campo.cnpjOrg]: "12.345.678/0001-90", address_locality: "Goiânia", address_admin_area_level_1: "Goiás" },
    { name: "Maria Exemplo", [PLANNING.campo.cargo]: "Diretora", email: [{ value: "maria@exemplo.com.br", primary: true }], phone: [{ value: "+55 (62) 99999-0000", primary: true }] },
    (id) => ({ 778: "R$ 25 milhões até R$ 50 milhões" })[id] ?? null,
  );
  assert.equal(det.empresa.cnpj, "12345678000190");
  assert.equal(det.empresa.uf, "GO");
  assert.equal(det.empresa.regime, "lucro_real");
  const org = corpoOrganizacao(det);
  assert.equal(org.address, "Goiânia - GO");
  assert.equal(org[CELLA.campo.regime], "29");
  assert.equal(org[CELLA.campo.cnpj], "12345678000190");
  assert.equal(org.owner_id, CELLA.dona);
  const pessoa = corpoPessoa(det, 900);
  assert.equal(pessoa.job_title, "Diretora");
  assert.equal(pessoa.phone[0].value, "5562999990000");
  const neg = corpoNegocio(card(), det, decidir(card(), null), { org_id: 900, person_id: 901 });
  assert.equal(neg.pipeline_id, 9);
  assert.equal(neg.user_id, 23868473);
  assert.equal(neg.stage_id, 36);
  assert.equal(neg.origin_id, "98123");
  assert.equal(neg.title, "Transportadora Exemplo");
  // Nada que denuncie outro produto ou a casa: só os campos combinados.
  const tudo = JSON.stringify({ org, pessoa, neg }).toLowerCase();
  for (const proibido of ["consultoria", "finance", "rota", "partners"]) assert.ok(!tudo.includes(proibido), proibido);
  assert.equal(ufDe("SP"), "SP");
  assert.equal(ufDe("Rio Grande do Sul"), "RS");
});

test("hash estável e indiferente à ordem das chaves", () => {
  assert.equal(hashDe({ a: 1, b: [1, 2] }), hashDe({ b: [1, 2], a: 1 }));
  assert.notEqual(hashDe({ a: 1 }), hashDe({ a: 2 }));
});

function simulado(estados = []) {
  const chamadas = [];
  const salvos = [];
  const logs = [];
  const cella = new Proxy(
    {},
    {
      get: (_, nome) => async (...args) => {
        chamadas.push([nome, ...args]);
        if (nome === "negocio") return { status: args[0] === 2139 ? "lost" : "open", stage_id: 36 };
        if (nome.startsWith("achar")) return null;
        return 500 + chamadas.length;
      },
    },
  );
  const planning = {
    contratados: async () => [PLANNING.contratadoCella],
    detalhe: async () => ({
      empresa: { nome: "Grupo Exemplo", cnpj: null, cidade: null, uf: null, regime: null, faixa: null },
      contato: null,
    }),
  };
  const store = { salvar: async (e) => void salvos.push(e), log: async (l) => void logs.push(l) };
  return {
    chamadas,
    salvos,
    logs,
    rodar: (fontes, ativo) =>
      rodarCella({ fontes, estados: new Map(estados.map((e) => [e.deal_id, e])), planning, cella, store, ativo, agora: new Date("2026-10-22T15:00:00Z") }),
  };
}

test("prévia não chama o Pipedrive deles e não repete o mesmo registro", async () => {
  const s = simulado();
  const r = await s.rodar([card({ deal_id: 1, stage_id: 291 })], false);
  assert.equal(r.simulados.entrou, 1);
  assert.equal(s.chamadas.length, 0);
  assert.equal(s.logs[0].simulado, true);
  const s2 = simulado([{ ...s.salvos[0] }]);
  const r2 = await s2.rodar([card({ deal_id: 1, stage_id: 291 })], false);
  assert.equal(r2.simulados.entrou, 0);
});

test("ligado: cria organização, negócio e reunião; existente só recebe etapa; fechado deles fica parado", async () => {
  const s = simulado([
    conhecido({ deal_id: 2, cella_deal_id: 2160 }),
    conhecido({ deal_id: 3, cella_deal_id: 2139 }),
  ]);
  const r = await s.rodar(
    [card({ deal_id: 1, stage_id: 291 }), card({ deal_id: 2, stage_id: 288 }), card({ deal_id: 3, stage_id: 278 })],
    true,
  );
  assert.equal(r.criados, 1);
  const nomes = s.chamadas.map((c) => c[0]);
  assert.ok(nomes.includes("criarOrganizacao") && nomes.includes("criarNegocio") && nomes.includes("criarAtividade"));
  assert.ok(!nomes.includes("criarPessoa"), "sem contato não cria pessoa");
  const put = s.chamadas.find((c) => c[0] === "atualizarNegocio");
  assert.deepEqual(put.slice(1), [2160, { status: "open", stage_id: 37 }]);
  assert.deepEqual(r.parados_deles, [3]);
  assert.equal(s.salvos.find((x) => x.deal_id === 3).estado, "parado_deles");
  assert.equal(s.chamadas.filter((c) => c[0] === "atualizarNegocio").length, 1);
});

test("espelho dos pipes 39 e 40", () => {
  const f39 = fonte39({ id: 98022, org: "Alves", status: "won", stage_id: 278, offered: ["cella"], moves: [{ stage_id: 291, date: "2026-10-01" }], org_id: 7 });
  assert.equal(f39.cella, true);
  assert.equal(f39.reuniao, "2026-10-01");
  const f40 = fonte40({ id: 100701, org: "N9", status: "open", stage_id: 299, produtos: [{ product_id: 63 }], moves: [{ stage_id: 299, at: "2026-11-02 10:00:00" }] });
  assert.equal(f40.cella, true);
  assert.equal(f40.reuniao, "2026-11-02");
  assert.equal(fonte40({ id: 1, status: "open", stage_id: 299, produtos: [{ product_id: 62 }] }).cella, false);
});
