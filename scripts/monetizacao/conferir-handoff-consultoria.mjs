// Confere a tela Handoff Consultoria contra uma recontagem INDEPENDENTE, somente leitura.
//
// Lado da tela: o payload do RPC `ops.handoff_consultoria_painel()` (lido ao vivo com a sessão de uma
// pessoa, numa transação só de leitura, ou de um arquivo) passado por `montarPainel`, a mesma régua
// que a tela usa (src/lib/monetizacao/handoff-consultoria.ts).
// Lado independente: monetizacao/medicoes/2026-10-02-handoff-consultoria/medir_independente.py, que
// lê Pipefy, Pipedrive, a plataforma da Consultoria e o Financial Brain sem passar pelo Brain.
//
// Confere: o conjunto de clientes que chegaram; por mês, chegaram, trabalhados, recebido, base,
// repasse e recuperado; por cliente, chegada, trabalhado, base do repasse, "já pagava a PAT" e faixa;
// e as regras do funil (etapa só desce, cabe na de cima, taxa = etapa ÷ de cima, tudo inteiro).
// Sai com código 1 se alguma checagem falhar. A saída é agregada; nas falhas, só o id do card.
//
//   node scripts/monetizacao/conferir-handoff-consultoria.mjs --independente <json> --payload <json>
//   SUPABASE_ACCESS_TOKEN=… node scripts/monetizacao/conferir-handoff-consultoria.mjs --independente <json> --usuario <uuid>
import { readFileSync } from "node:fs";
import { consultar } from "../cockpit-ceo/brain-ro.mjs";
import { montarPainel } from "../../src/lib/monetizacao/handoff-consultoria.ts";

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const indep = JSON.parse(readFileSync(arg("independente"), "utf8"));
const hoje = arg("hoje") ?? new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

async function payload() {
  if (arg("payload")) return JSON.parse(readFileSync(arg("payload"), "utf8"));
  const uid = arg("usuario");
  if (!/^[0-9a-f-]{36}$/.test(uid ?? "")) throw new Error("--usuario <uuid> ou --payload <json>");
  const claims = JSON.stringify({ sub: uid, role: "authenticated" }).replace(/'/g, "''");
  const r = await consultar(
    `select set_config('request.jwt.claims', '${claims}', true); set local role authenticated; select ops.handoff_consultoria_painel() as j;`,
    { transacaoSomenteLeitura: true },
  );
  return r[0].j;
}

const p = montarPainel(await payload(), {}, hoje);
const falhas = [];
let checagens = 0;
const checar = (ok, texto) => {
  checagens++;
  if (!ok) falhas.push(texto);
};
const perto = (a, b) => Math.abs((a ?? 0) - (b ?? 0)) <= 0.05;

// ── clientes ─────────────────────────────────────────────────────────────────────────────────────
const chave = (c) => c.cnpj ?? `card:${c.card}`;
const I = new Map(indep.clientes.map((c) => [chave(c), c]));
const T = new Map(p.todos.map((c) => [c.chave, c]));
checar(T.size === I.size, `clientes: tela ${T.size} × independente ${I.size}`);
const chegTela = new Set(p.chegaram.map((c) => c.chave));
const chegInd = new Set(indep.clientes.filter((c) => c.chegada && c.chegada >= p.de && c.chegada <= p.ate).map(chave));
for (const k of new Set([...chegTela, ...chegInd]))
  checar(chegTela.has(k) === chegInd.has(k), `chegou diverge: ${T.get(k)?.card ?? I.get(k)?.card}`);
for (const [k, t] of T) {
  const i = I.get(k);
  if (!i) {
    checar(false, `só na tela: card ${t.card}`);
    continue;
  }
  checar(t.chegada === i.chegada, `chegada ${t.card}: ${t.chegada} × ${i.chegada}`);
  checar(t.trabalhado === i.trabalhado, `trabalhado ${t.card}`);
  checar(t.naBase === i.na_base, `base do repasse ${t.card}`);
  checar(t.jaPagavaPat === i.ja_pagava, `já pagava a PAT ${t.card}`);
  checar((t.faixa === "Sem faixa declarada" ? null : t.faixa) === i.faixa, `faixa ${t.card}: ${t.faixa} × ${i.faixa}`);
  checar(t.encaminhado === i.encaminhado, `encaminhado ${t.card}`);
}

// ── mês a mês ────────────────────────────────────────────────────────────────────────────────────
for (const m of p.porMes) {
  const i = indep.por_mes[m.mes];
  if (!i) continue;
  checar(m.chegaram.length === i.chegaram, `${m.mes} chegaram ${m.chegaram.length} × ${i.chegaram}`);
  checar(m.trabalhados.length === i.trabalhados, `${m.mes} trabalhados ${m.trabalhados.length} × ${i.trabalhados}`);
  checar(perto(m.recebido, i.recebido), `${m.mes} recebido ${m.recebido} × ${i.recebido}`);
  checar(perto(m.base, i.base), `${m.mes} base ${m.base} × ${i.base}`);
  checar(perto(m.expansao, i.expansao), `${m.mes} a repassar ${m.expansao} × ${i.expansao}`);
  checar(perto(m.recuperado, i.recuperado), `${m.mes} recuperado ${m.recuperado} × ${i.recuperado}`);
}

// ── funil e contagens ────────────────────────────────────────────────────────────────────────────
p.funil.forEach((e, n) => {
  checar(Number.isInteger(e.clientes.length), `${e.rotulo} não é inteiro`);
  if (!n) return;
  const cima = p.funil[n - 1].clientes;
  checar(e.clientes.length <= cima.length, `${e.rotulo} sobe em relação à etapa de cima`);
  checar(e.clientes.every((c) => cima.includes(c)), `${e.rotulo} não cabe na etapa de cima`);
  checar(e.taxa === (cima.length ? Math.round((e.clientes.length / cima.length) * 100) : null), `${e.rotulo}: taxa ≠ etapa ÷ de cima`);
});
checar(perto(p.dinheiro.expansao, (p.dinheiro.base ?? 0) * (p.regras.expansao ?? 0)), "repasse ≠ base × regra");

console.log(
  JSON.stringify(
    {
      lido_em: p.lidoEm,
      independente_em: indep.medido_em,
      periodo: [p.de, p.ate],
      clientes: p.todos.length,
      chegaram: p.chegaram.length,
      trabalhados: p.trabalhados.length,
      funil: p.funil.map((e) => [e.rotulo, e.clientes.length, e.taxa]),
      dinheiro: p.dinheiro,
      por_mes: p.porMes.map((m) => [m.mes, m.chegaram.length, m.trabalhados.length, m.recebido, m.expansao]),
      checagens,
      falhas: falhas.length,
    },
    null,
    1,
  ),
);
if (falhas.length) {
  console.error(falhas.slice(0, 40).join("\n"));
  process.exit(1);
}
