import test from "node:test";
import assert from "node:assert/strict";
import {
  montarDefinicao,
  resumirClientes,
  DEFINICOES_CLIENTE,
} from "../src/lib/cockpit-ceo/clientes-ativos.ts";

// CNPJs fictícios de 14 dígitos (não validam dígito verificador de propósito).
const c = (n) => String(n).padStart(14, "9");

test("Documento: pontuação sai, CPF e vazio ficam fora e são contados, CNPJ repetido conta uma vez", () => {
  const d = montarDefinicao("contrato_omie", [
    "99.999.999/9999-01",
    "99999999999901",
    "123.456.789-01",
    null,
    "",
  ]);
  assert.deepEqual(d.cnpjs, ["99999999999901"]);
  assert.equal(d.foraDoFormato, 1);
  assert.equal(d.semDocumento, 2);
  assert.equal(d.estado, "parcial", "registro sem documento não some em silêncio");
  assert.equal(d.titulo, DEFINICOES_CLIENTE.contrato_omie.titulo);
});

const contas = [
  { key: "k1", orgs: [10], cnpjs: [c(1)] },
  { key: "k2", orgs: [20], cnpjs: [c(2), c(5)] },
  { key: "k3", orgs: [30], cnpjs: [c(3)] },
  { key: "k4", orgs: [40], cnpjs: [c(9)] },
];
const negocios = [
  { org_id: 10, route: "consultoria", status: "won" },
  { org_id: 20, route: "consultoria", status: "open" },
  { org_id: 30, route: "finance", status: "won" },
  { org_id: 30, route: "finance", status: "won" },
  { org_id: 40, route: "cella", status: "won" },
];

test("Cada definição conta CNPJ distinto, casa com a Base por conta e mostra sobreposição", () => {
  const defs = [
    montarDefinicao("contrato_omie", [c(1), c(2), c(3)]),
    montarDefinicao("recebeu_90d", [c(2), c(3), c(4)]),
    montarDefinicao("mrr_positivo", [c(2), c(5)]),
    { ...montarDefinicao("qb_ativos", []), estado: "acesso_insuficiente", nota: "sem acesso" },
  ];
  const r = resumirClientes(defs, contas, negocios, { acessoNegocios: true });
  const [a, b, m, q] = r.definicoes;
  assert.equal(a.cnpjs, 3);
  assert.equal(a.contasBase, 3);
  assert.equal(a.semContaBase, 0);
  assert.equal(b.cnpjs, 3);
  assert.equal(b.contasBase, 2);
  assert.equal(b.semContaBase, 1, "CNPJ 4 não tem conta na Base");
  assert.equal(m.contasBase, 1, "conta com dois CNPJs na definição conta uma vez");
  assert.equal(q.cnpjs, null, "sem acesso não vira zero");
  assert.equal(q.penetracao, null);
  const pen = (d, p) => d.penetracao.find((x) => x.produto === p);
  assert.equal(pen(a, "consultoria").contas, 1);
  assert.ok(Math.abs(pen(a, "consultoria").parcela - 1 / 3) < 1e-9);
  assert.equal(pen(a, "finance").contas, 1, "dois ganhos na mesma conta contam uma vez");
  assert.equal(pen(b, "consultoria").contas, 0, "negócio aberto não é contratado");
  assert.equal(pen(a, "cella").contas, 0);
  const par = (x, y) => r.sobreposicao.find((s) => s.a === x && s.b === y).ambos;
  assert.equal(par("contrato_omie", "recebeu_90d"), 2);
  assert.equal(par("contrato_omie", "mrr_positivo"), 1);
  assert.equal(r.uniao, 5);
  assert.equal(r.emTodas, 1);
  assert.ok(!r.sobreposicao.some((s) => s.a === "qb_ativos" || s.b === "qb_ativos"));
  assert.ok(r.avisos.some((x) => /fora da união/.test(x)));
});

test("Sem acesso aos negócios, a penetração fica em acesso insuficiente; sem Base, não casa conta", () => {
  const defs = [montarDefinicao("contrato_omie", [c(1), c(2)])];
  const semNeg = resumirClientes(defs, contas, [], { acessoNegocios: false });
  assert.equal(semNeg.penetracaoEstado, "acesso_insuficiente");
  assert.equal(semNeg.definicoes[0].penetracao, null);
  assert.equal(semNeg.definicoes[0].contasBase, 2);
  const semBase = resumirClientes(defs, null, negocios, { acessoNegocios: true });
  assert.equal(semBase.definicoes[0].contasBase, null);
  assert.equal(semBase.definicoes[0].cnpjs, 2);
  assert.equal(semBase.penetracaoEstado, "acesso_insuficiente");
});

test("Rótulo da penetração diz que é ganho no CRM, não consumo", () => {
  const r = resumirClientes([montarDefinicao("contrato_omie", [c(1)])], contas, negocios, {
    acessoNegocios: true,
  });
  assert.ok(r.avisos.some((x) => /ganho no CRM/.test(x) && /não é consumo/.test(x)));
  assert.ok(
    r.avisos.some((x) => /4 negócios ganhos/.test(x)),
    "diz de quantos ganhos a conta parte",
  );
});

test("Registro sem documento torna a definição parcial; CNPJ em mais de uma conta é declarado", () => {
  const d = montarDefinicao("mrr_positivo", [c(1), null, null]);
  assert.equal(d.estado, "parcial");
  assert.match(d.nota, /2 registros sem documento/);
  const soCpf = montarDefinicao("recebeu_90d", [c(1), "123.456.789-01"]);
  assert.equal(soCpf.estado, "disponivel", "CPF é exclusão declarada, não lacuna");
  const duplicada = [...contas, { key: "k5", orgs: [], cnpjs: [c(1)] }];
  const r = resumirClientes([montarDefinicao("contrato_omie", [c(1), c(3)])], duplicada, [], {
    acessoNegocios: true,
  });
  assert.equal(r.definicoes[0].contasBase, 3);
  assert.ok(r.avisos.some((x) => /1 CNPJ está em mais de uma conta/.test(x)));
});
