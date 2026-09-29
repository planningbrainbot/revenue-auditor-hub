// Homologação SÓ LEITURA do tema Qui · Monetização do Cockpit do COO.
//
// 1. Reproduz no Node a carga que o navegador do COO recebe: as mesmas RPCs e tabelas de
//    `carregarMonetizacao` + `carregarContasBase` (`ops.base_carteira_pagina` página a página), com a
//    sessão do Paulo Carvalho simulada dentro de `begin transaction read only` (papel
//    `authenticated` e o `sub` dele no JWT: RLS e escopo de unidade valem como no app), e o mesmo
//    `aplicarBase` de `lerContasBase`.
// 2. Roda o adaptador (`dadosDaCarga`) e o montador (`montarMonetizacao`) do tema sobre essa carga.
// 3. Confere contra SQL independente: a coorte madura, os ganhos e as validadas do mês por unidade,
//    contados direto de `ops.monetizacao_deals.unidade_ids` (a coluna gravada pelo sync, que a carga
//    do navegador não traz) e dos eventos em jsonb.
//
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/cockpit-coo/homologar-monetizacao.mjs [AAAA-MM-DD]
// Só agregados por unidade vão para a saída: nenhum nome de empresa, CNPJ ou contato.
import { consultar } from "../cockpit-ceo/brain-ro.mjs";
import { aplicarBase } from "../../src/lib/clientes-base.ts";
import { juntarCarteira } from "../../src/lib/monetizacao/juntar-carteira.ts";
import { lerUnidades } from "../../src/lib/cockpit-coo/unidades.ts";
import {
  coorteDaUnidade,
  janelaDaCoorte,
  montarMonetizacao,
  reguaDasUnidades,
  ROTULO_FAIXA,
  cobertura,
} from "../../src/lib/cockpit-coo/temas/monetizacao.ts";
import { dadosDaCarga } from "../../src/lib/cockpit-coo/temas/monetizacao.carga.ts";

const COO = "acf379ff-3674-4545-86b7-79e0a18360eb"; // Paulo Carvalho (diretor, todas as unidades)
const hoje =
  process.argv[2] ??
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new Error("Data inválida: use AAAA-MM-DD.");

const comoCoo = (sql) =>
  consultar(
    `set local role authenticated; set local request.jwt.claims to '{"sub":"${COO}","role":"authenticated"}'; ${sql}`,
    { transacaoSomenteLeitura: true },
  );
const CHAVE = /^[A-Za-z0-9_-]{1,80}$/;

// ── 1. A carga, como o navegador do COO recebe ─────────────────────────
const [[meta], cadastro, unidadesMon, cards] = await Promise.all([
  comoCoo(
    `select ops.monetizacao_can('view.aquario') aquario, ops.monetizacao_can('view.monetizacao') monetizacao,
      ops.monetizacao_scope('{}') todas, ops.base_carteira_manifesto() manifesto,
      (select to_jsonb(s) from (select status, measured_at, catalog_at, error from ops.monetizacao_sync) s) sync`,
  ),
  consultar("select id, nome_da_praca, tipo, data_inauguracao from ops.unidades order by id"),
  comoCoo("select key, unidade_id, nome, classification from ops.monetizacao_unidades order by key"),
  comoCoo("select id, payload from ops.monetizacao_deals order by id"),
]);
if (!meta.aquario && !meta.monetizacao) throw new Error("O COO não lê a Monetização.");
const manifesto = meta.manifesto;

const contas = [];
for (const pagina of manifesto.pages) {
  if ((pagina.after && !CHAVE.test(pagina.after)) || !CHAVE.test(pagina.through))
    throw new Error("Chave de paginação fora do formato.");
  const [{ pg }] = await comoCoo(
    `select ops.base_carteira_pagina(${pagina.after ? `'${pagina.after}'` : "null"}, '${pagina.through}') pg`,
  );
  if (pg.rows.length !== pagina.count || pg.catalog_at !== manifesto.catalog_at)
    throw new Error("A base mudou durante a leitura; rode de novo.");
  const porChave = new Map(pg.base.map((m) => [m.key, m]));
  for (const r of pg.rows)
    contas.push({ ...aplicarBase(r.perfil, porChave.get(r.key)), unit_ids: r.unidade_ids });
}
if (contas.length !== manifesto.count) throw new Error("Contagem da base não bate com o manifesto.");

const sync = meta.sync ?? {};
const carga = juntarCarteira(
  {
    base_count: manifesto.count,
    catalog_pages: manifesto.pages,
    scope_signature: manifesto.scope_signature,
    forecasts: [],
    reservations: [],
    accounts: [],
    units: unidadesMon.map((u) => ({
      id: u.unidade_id,
      key: u.key,
      name: u.nome,
      classification: u.classification,
      account_keys: [],
    })),
    cards: cards.map((c) => c.payload),
    lists: [],
    plans: [],
    records: [],
    measured_at: sync.measured_at ?? null,
    catalog_at: manifesto.catalog_at,
    sync_status: sync.status ?? "pending",
    sync_error: sync.error ?? null,
    stages: [],
    permissions: { view: meta.monetizacao, manage: false, send: false, all_units: meta.todas },
  },
  contas,
);

// ── 2. Adaptador e montador ────────────────────────────────────────────
const unidades = lerUnidades(cadastro);
// `agora` = a hora da carga: a homologação confere a regra, não o relógio de quem roda.
const agora = Date.parse(sync.measured_at ?? new Date().toISOString());
const dados = dadosDaCarga(carga, hoje, { agora });
const leitura = montarMonetizacao(dados, unidades, "", hoje);
if (!dados.base.ok || !dados.negocios.ok) throw new Error("Carga incompleta: " + JSON.stringify(dados));
const regua = reguaDasUnidades(dados.base.grupos, dados.negocios.lista, unidades, hoje);

const pct = (a, b) => (b ? Math.round((100 * a) / b) : "-");
console.log(`\nRégua de engajamento em ${hoje} (carga do CRM ${sync.measured_at}, catálogo ${manifesto.catalog_at})`);
console.log(`${contas.length} contas · ${cards.length} negócios no pipe · coorte ${JSON.stringify(janelaDaCoorte(hoje))}\n`);
console.log("unidade | eleg | contato% | cob% | leads | c/reunião | valid | A/B/C | nota | faixa | há 7 d");
for (const l of regua)
  console.log(
    [
      l.unidade.nome + (l.unidade.emOperacao ? "" : "*"),
      l.elegiveis,
      pct(l.comContato, l.elegiveis),
      cobertura(l) ?? "-",
      l.coorte.leads,
      l.coorte.comReuniao,
      l.coorte.validadas,
      l.nota ? [l.nota.A, l.nota.B, l.nota.C].map(Math.round).join("/") : "-",
      l.nota?.nota ?? "-",
      ROTULO_FAIXA[l.faixa],
      l.antes.nota ? `${l.antes.nota.nota} ${ROTULO_FAIXA[l.antes.faixa]}` : ROTULO_FAIXA[l.antes.faixa],
    ].join(" | "),
  );
console.log("(* em implantação)\n\nNúmeros (todas as unidades):");
for (const n of leitura.numeros)
  console.log(`- ${n.rotulo}: ${n.valor ?? n.estado}${n.nota ? ` (${n.nota})` : ""}${n.motivo ? ` [${n.motivo}]` : ""}`);
console.log("\nAlertas:");
for (const a of leitura.alertas) console.log(`- [${a.gravidade}] ${a.titulo}  (${a.chave})`);
console.log("\nAvisos:", leitura.avisos.join(" | "));

// ── 3. Conferência contra SQL independente ─────────────────────────────
const j = janelaDaCoorte(hoje);
const mes = hoje.slice(0, 7) + "-01";
const temEvento = (k, cond) =>
  `exists(select 1 from jsonb_array_elements(coalesce(payload->'events'->'${k}','[]')) e where ${cond})`;
const sql = `
with d as (
  select id, unidade_ids, payload,
    (select min(e->>'date') from jsonb_array_elements(coalesce(payload->'events'->'started','[]')) e) primeiro
  from ops.monetizacao_deals
), u as (
  select d.*, x.u from d cross join lateral unnest(case when cardinality(d.unidade_ids) = 0 then array[0] else d.unidade_ids end) x(u)
)
select u,
  count(*) filter (where primeiro between '${j.de}' and '${j.ate}') leads,
  count(*) filter (where primeiro between '${j.de}' and '${j.ate}' and (${temEvento("scheduled", `e->>'date' <= '${hoje}'`)} or ${temEvento("meeting", `e->>'date' <= '${hoje}'`)})) reuniao,
  count(*) filter (where primeiro between '${j.de}' and '${j.ate}' and ${temEvento("validated", `e->>'date' <= '${hoje}'`)}) validadas,
  count(*) filter (where ${temEvento("signed", `e->>'date' between '${mes}' and '${hoje}'`)}) ganhos_mes,
  count(*) filter (where ${temEvento("validated", `e->>'date' between '${mes}' and '${hoje}'`)}) validadas_mes
from u group by u order by u`;
const independente = await comoCoo(sql);
const porId = new Map(independente.map((r) => [r.u, r]));
const lista = dados.negocios.lista;
const doMes = (id, k) =>
  lista.filter(
    (n) =>
      (id === 0 ? n.unidade_ids.length === 0 : n.unidade_ids.includes(id)) &&
      n[k].some((d) => d >= mes && d <= hoje),
  ).length;
let divergencias = 0;
for (const id of [0, ...unidades.map((u) => u.id)]) {
  const l = regua.find((x) => x.unidade.id === id);
  const app = {
    leads: l ? l.coorte.leads : 0,
    reuniao: l ? l.coorte.comReuniao : 0,
    validadas: l ? l.coorte.validadas : 0,
    ganhos_mes: doMes(id, "signed"),
    validadas_mes: doMes(id, "validated"),
  };
  if (id === 0) {
    const c = coorteDaUnidade(lista, null, hoje);
    Object.assign(app, { leads: c.leads, reuniao: c.comReuniao, validadas: c.validadas });
  }
  const sqlRow = porId.get(id) ?? {};
  const diff = Object.keys(app).filter((k) => Number(sqlRow[k] ?? 0) !== app[k]);
  if (diff.length) {
    divergencias++;
    const nome = id === 0 ? "(sem unidade)" : unidades.find((u) => u.id === id)?.nome;
    console.log(`DIVERGE ${nome}: ${diff.map((k) => `${k} app ${app[k]} × sql ${sqlRow[k] ?? 0}`).join("; ")}`);
  }
}
console.log(
  divergencias
    ? `\n${divergencias} unidade(s) com diferença entre o adaptador e o SQL independente.`
    : "\nCoorte, reuniões, validadas, ganhos e validadas do mês: o adaptador bate com o SQL independente em todas as unidades.",
);
