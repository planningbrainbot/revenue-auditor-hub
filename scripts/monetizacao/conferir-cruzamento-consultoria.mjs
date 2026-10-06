// Confere a tela Cruzamento Consultoria contra uma recontagem INDEPENDENTE em SQL, somente leitura.
//
// Lado da tela: o payload do RPC `ops.cruzamento_consultoria_painel()` (lido com a sessão de uma pessoa, numa transação
// só de leitura) passado por `montarCruzamento`, a mesma régua que a tela usa.
// Lado independente: cada número refeito direto nas tabelas (ops.consultoria_clientes, ops.consultoria_propostas,
// ops.contratos), sem passar pela régua.
// Confere os 12 cartões "dito × medido", a máquina mês a mês, a janela de 28 dias e as regras da coorte (cada etapa
// dentro da anterior, tudo inteiro). Sai com código 1 se alguma checagem falhar.
//
//   SUPABASE_ACCESS_TOKEN=… node scripts/monetizacao/conferir-cruzamento-consultoria.mjs --usuario <uuid> [--hoje AAAA-MM-DD]
import { consultar } from "../cockpit-ceo/brain-ro.mjs";
import { montarCruzamento } from "../../src/lib/monetizacao/cruzamento-consultoria.ts";

const arg = (k) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const uid = arg("usuario");
if (!/^[0-9a-f-]{36}$/.test(uid ?? "")) throw new Error("--usuario <uuid>");
const hoje = arg("hoje") ?? new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

const claims = JSON.stringify({ sub: uid, role: "authenticated" }).replace(/'/g, "''");
const [linha] = await consultar(
  `select set_config('request.jwt.claims', '${claims}', true); set local role authenticated; select ops.cruzamento_consultoria_painel() as j;`,
  { transacaoSomenteLeitura: true },
);
const p = montarCruzamento(linha.j, hoje);

const H = `'${hoje}'::date`;
const [sql] = await consultar(`
with c as (select * from ops.consultoria_clientes where ausente_desde is null),
pr as (
  select c.id, c.regime_tributario reg, (x->>'cadastrado_em')::date cad, (x->>'entregue_em')::date ent, x->>'etapa' etapa,
         coalesce((x->>'encerrado')::boolean, false) enc, coalesce((x->>'valor_identificado')::numeric, 0) val
  from c, jsonb_array_elements(coalesce(c.payload->'projetos', '[]'::jsonb)) x),
porcli as (select id, max(reg) reg, sum(val) val from pr group by id),
k as (select distinct on (pipedrive_deal_id) pipedrive_deal_id, ganho_em, origem_pipeline from ops.contratos
      where ganho_em >= '2026-01-01' and pipedrive_deal_id is not null order by pipedrive_deal_id, ganho_em, id)
select
  (select sum(val) from pr where val > 0) oportunidades,
  (select avg(percentual_exito) / 100 from ops.consultoria_propostas where ausente_desde is null and percentual_exito is not null) honorario,
  (select count(distinct id) from pr where etapa = 'pos_entrega' and val > 0) diagnostico_valor,
  (select round(count(*) / 4.0) from pr where cad between ${H} - 27 and ${H}) entram_semana,
  (select round(count(*) / 4.0) from pr where ent between ${H} - 27 and ${H}) saem_semana,
  (select count(*) from pr where ent between ${H} - 29 and ${H}) entregues_mes,
  (select count(*) from pr where etapa = 'fluxo_documentos' and not enc and ent is null) fluxo_documentos,
  (select count(*) from porcli where reg ilike '%real%' and val > 0) lucro_real,
  (select count(*) filter (where reg ilike '%real%')::numeric / nullif(count(*), 0) from pr) lucro_real_projetos,
  (select sum(val) / nullif(count(*), 0) from porcli where reg ilike '%real%' and val > 0) media_lucro_real,
  (select count(*) from pr where cad between '2026-07-01' and '2026-09-30') chegaram_3_meses,
  (select count(*) from k where origem_pipeline = 'inside_sales' and to_char(ganho_em, 'YYYY-MM') = '2026-09') maquina_setembro,
  (select jsonb_object_agg(m, n) from (select to_char(ganho_em, 'YYYY-MM') m, count(*) n from k
     where origem_pipeline = 'inside_sales' group by 1) x) maquina_por_mes,
  (select count(*) from pr) projetos,
  (select count(*) from c) clientes`);

const falhas = [];
let checagens = 0;
const checar = (ok, texto) => {
  checagens++;
  if (!ok) falhas.push(texto);
};
const perto = (a, b, tol = 1e-6) =>
  Math.abs(Number(a ?? 0) - Number(b ?? 0)) <= tol * Math.max(1, Math.abs(Number(b ?? 0)));

checar(
  p.clientes.length === Number(sql.clientes),
  `clientes: tela ${p.clientes.length} × SQL ${sql.clientes}`,
);
checar(
  p.projetos.length === Number(sql.projetos),
  `projetos: tela ${p.projetos.length} × SQL ${sql.projetos}`,
);
const chave = (id) => id.replace(/-/g, "_");
for (const c of p.cartoes) {
  checar(perto(c.medido, sql[chave(c.id)]), `${c.id}: tela ${c.medido} × SQL ${sql[chave(c.id)]}`);
  checar(c.registros.itens.length >= 0, `${c.id}: sem lista`);
  if (Number.isInteger(c.dito))
    checar(
      c.formato === "pct" || c.formato === "brl" || Number.isInteger(c.medido ?? 0),
      `${c.id}: contagem quebrada`,
    );
}
for (const m of p.maquinaPorMes)
  checar(
    m.ganhos.length === Number(sql.maquina_por_mes?.[m.mes] ?? 0),
    `máquina ${m.mes}: tela ${m.ganhos.length} × SQL ${sql.maquina_por_mes?.[m.mes] ?? 0}`,
  );
const ordem = ["ganhos", "cnpj", "plataforma", "trabalhados", "faturou"];
for (const l of p.coorte)
  for (let i = 1; i < ordem.length; i++) {
    const de = l.etapas[ordem[i - 1]],
      para = l.etapas[ordem[i]];
    if (!de || !para) continue;
    checar(
      para.length <= de.length && para.every((x) => de.includes(x)),
      `coorte ${l.mes}: ${ordem[i]} fora de ${ordem[i - 1]}`,
    );
  }

console.log(
  JSON.stringify({ hoje, checagens, falhas: falhas.length, placar: p.contagem }, null, 1),
);
for (const c of p.cartoes)
  console.log(
    `${c.status.padEnd(11)} ${c.tema.padEnd(36)} dito ${c.dito} · tela ${c.medido} · SQL ${sql[chave(c.id)]}`,
  );
if (falhas.length) {
  console.log(falhas.slice(0, 30).join("\n"));
  process.exit(1);
}
