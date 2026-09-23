// Homologação de clientes ativos e penetração com dado real (somente leitura).
//
// Lê as quatro definições com o JWT de um super admin simulado (mesmos filtros do servidor), passa
// por `montarDefinicao`/`resumirClientes` com a carga real da Base e dos negócios, e confere:
//   · CNPJs por definição, sobreposição par a par, união e interseção — contra SQL independente;
//   · contas da Base casadas e penetração por produto — contra SQL sobre base_conta_estado,
//     monetizacao_contas (orgs do perfil) e monetizacao_deals (ganhos).
// CNPJs só trafegam para o banco; o arquivo guarda contagens.
//
// Uso: SUPABASE_ACCESS_TOKEN=… node scripts/cockpit-ceo/homologar-clientes.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { consultar } from "./brain-ro.mjs";
import { carregarBaseReal } from "./carga-real.mjs";
import {
  ORDEM_DEFINICOES,
  montarDefinicao,
  resumirClientes,
} from "../../src/lib/cockpit-ceo/clientes-ativos.ts";
import { hoje as hojeSP } from "../../src/lib/monetizacao/model.ts";
import { PRODUTOS } from "../../src/lib/monetizacao/types.ts";

const SAIDA = "docs/dev_notes/cockpit-ceo-piloto/homologacao";
const ro = { transacaoSomenteLeitura: true };
const hoje = hojeSP();
const d = new Date(`${hoje}T12:00:00Z`);
d.setUTCDate(d.getUTCDate() - 90);
const desde90 = d.toISOString().slice(0, 10);
const tempos = {};
const medir = async (nome, fn) => {
  const t = performance.now();
  const r = await fn();
  tempos[nome] = Math.round(performance.now() - t);
  return r;
};

const [adm] = await consultar(
  `select user_id::text id from ops.user_roles where role='admin' order by user_id limit 1`,
  ro,
);
if (!/^[0-9a-f-]{36}$/.test(adm.id)) throw new Error("id fora do formato");
const comoAdmin = `set local role authenticated; set local statement_timeout = '8s';
  set local request.jwt.claims to '${JSON.stringify({ sub: adm.id, role: "authenticated" })}';`;

// ── As quatro leituras, com os filtros do servidor ─────────────────────────
const SQL_DEF = {
  contrato_omie: `select coalesce(nullif(cnpj_digitos, ''), cnpj) doc from ops.omie_contratos_servico
                  where situacao = '10' and valor_mensal > 0`,
  recebeu_90d: `select cpf_cnpj doc from ops.contas_receber
                where status_pagamento in ('RECEBIDO', 'recebido') and data_pagamento >= '${desde90}'`,
  qb_ativos: `select cnpj_num doc from ops.qb_clientes_ativos`,
  mrr_positivo: `select e.cnpj doc from ops.v_cliente_mrr v left join ops.empresas e on e.id = v.empresa_id
                 where v.mrr_mensal > 0`,
};
const definicoes = [];
for (const id of ORDEM_DEFINICOES) {
  const linhas = await medir(`leitura_${id}_ms`, () =>
    consultar(`${comoAdmin} ${SQL_DEF[id]}`, ro),
  );
  definicoes.push(
    montarDefinicao(
      id,
      linhas.map((l) => l.doc),
    ),
  );
}

// ── Carga real da Base e dos negócios, e o resumo do cockpit ───────────────
const { base, tempos: temposCarga } = await medir("carga_base_ms", () => carregarBaseReal());
const contas = base.accounts.map((a) => ({ key: a.key, orgs: a.orgs, cnpjs: a.base?.cnpjs ?? [] }));
const resumo = resumirClientes(definicoes, contas, base.cards, { acessoNegocios: true });

// ── SQL independente: contagens, sobreposição, casamento e penetração ─────
const arr = (xs) => `array[${xs.map((x) => `'${x}'`).join(",")}]::text[]`;
for (const def of definicoes)
  if (!def.cnpjs.every((c) => /^\d{14}$/.test(c))) throw new Error("CNPJ fora do formato");
const conj = Object.fromEntries(definicoes.map((x) => [x.id, x.cnpjs]));
const sqlConjunto = (id) =>
  `(select distinct regexp_replace(doc, '\\D', '', 'g') c from (${SQL_DEF[id]}) s
     where length(regexp_replace(coalesce(doc, ''), '\\D', '', 'g')) = 14)`;
const [cont] = await consultar(
  `${comoAdmin}
   with ${ORDEM_DEFINICOES.map((id) => `${id} as ${sqlConjunto(id)}`).join(",\n")}
   select ${ORDEM_DEFINICOES.map((id) => `(select count(*) from ${id})::int ${id}`).join(", ")},
     ${ORDEM_DEFINICOES.flatMap((a, i) =>
       ORDEM_DEFINICOES.slice(i + 1).map(
         (b) => `(select count(*) from ${a} join ${b} using (c))::int "${a}|${b}"`,
       ),
     ).join(", ")},
     (select count(*) from (${ORDEM_DEFINICOES.map((id) => `select c from ${id}`).join(" union ")}) u)::int uniao,
     (select count(*) from (${ORDEM_DEFINICOES.map((id) => `select c from ${id}`).join(" intersect ")}) i)::int em_todas`,
  ro,
);
const casamentoSql = {};
for (const def of definicoes) {
  const [r] = await consultar(
    `with def as (select unnest(${arr(conj[def.id])}) c),
     casadas as (
       select distinct a.key from ops.base_conta_estado a join ops.monetizacao_contas m on m.key = a.key
       where exists (select 1 from unnest(a.cnpjs) x where regexp_replace(x, '\\D', '', 'g') in (select c from def))),
     ganhos as (
       select distinct (payload->>'org_id')::bigint org, payload->>'route' rota
       from ops.monetizacao_deals where payload->>'status' = 'won' and payload->>'org_id' is not null),
     pen as (
       select g.rota, count(distinct k.key)::int n from casadas k
       join ops.monetizacao_contas m on m.key = k.key
       cross join lateral jsonb_array_elements_text(m.perfil->'orgs') o(org)
       join ganhos g on g.org = o.org::bigint group by 1)
     select (select count(*) from casadas)::int contas,
            (select coalesce(jsonb_object_agg(rota, n), '{}') from pen) penetracao,
            (select count(*) from def d where not exists (
               select 1 from ops.base_conta_estado a join ops.monetizacao_contas m on m.key = a.key
               where regexp_replace(d.c, '\\D', '', 'g') in (select regexp_replace(x, '\\D', '', 'g') from unnest(a.cnpjs) x)))::int sem_conta`,
    ro,
  );
  casamentoSql[def.id] = r;
}

// ── Comparação ────────────────────────────────────────────────────────────
const conferencia = resumo.definicoes.map((r) => {
  const sql = casamentoSql[r.id];
  const penCockpit = Object.fromEntries(r.penetracao.map((p) => [p.produto, p.contas]));
  const penSql = Object.fromEntries(PRODUTOS.map((p) => [p, sql.penetracao[p] ?? 0]));
  return {
    id: r.id,
    cnpjs: { cockpit: r.cnpjs, sql: cont[r.id] },
    contas_base: { cockpit: r.contasBase, sql: sql.contas },
    sem_conta: { cockpit: r.semContaBase, sql: sql.sem_conta },
    penetracao: { cockpit: penCockpit, sql: penSql },
    fora_do_formato: r.foraDoFormato,
    sem_documento: r.semDocumento,
    confere:
      r.cnpjs === cont[r.id] &&
      r.contasBase === sql.contas &&
      r.semContaBase === sql.sem_conta &&
      PRODUTOS.every((p) => penCockpit[p] === penSql[p]),
  };
});
const sobreposicao = resumo.sobreposicao.map((s) => ({
  par: `${s.a}|${s.b}`,
  cockpit: s.ambos,
  sql: cont[`${s.a}|${s.b}`],
  confere: s.ambos === cont[`${s.a}|${s.b}`],
}));
const saida = {
  quando: new Date().toISOString(),
  hoje,
  desde90,
  fonte:
    "banco único Planning Brain (npknehhyyzelmrbbxvtu), somente leitura, JWT de super admin simulado",
  definicoes: conferencia,
  sobreposicao,
  uniao: { cockpit: resumo.uniao, sql: cont.uniao },
  em_todas: { cockpit: resumo.emTodas, sql: cont.em_todas },
  negocios_ganhos: base.cards.filter((c) => c.status === "won").length,
  avisos: resumo.avisos,
  confere:
    conferencia.every((c) => c.confere) &&
    sobreposicao.every((s) => s.confere) &&
    resumo.uniao === cont.uniao &&
    resumo.emTodas === cont.em_todas,
  tempos: { ...tempos, carga: temposCarga },
};
mkdirSync(SAIDA, { recursive: true });
const arquivo = `${SAIDA}/clientes-${hoje}.json`;
writeFileSync(arquivo, JSON.stringify(saida, null, 2) + "\n");
console.log(JSON.stringify({ arquivo, ...saida, tempos: undefined, avisos: undefined }, null, 2));
