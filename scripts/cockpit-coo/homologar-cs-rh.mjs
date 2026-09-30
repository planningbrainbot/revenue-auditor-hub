// Homologação SÓ LEITURA do tema Qua · CS e RH do Cockpit do COO.
//
// 1. Reproduz no Node a carga de `lerCsRh`: as mesmas tabelas e colunas, com a sessão do Paulo
//    Carvalho simulada dentro de `begin transaction read only` (papel `authenticated` e o `sub` dele
//    no JWT: RLS e escopo de unidade valem como no app).
// 2. Roda `montarCsRh` sobre essa carga, com o cadastro real de unidades.
// 3. Confere contra SQL independente (agregado direto no Postgres, sem o código do tema): churn do
//    trimestre, tratativas abertas, NPS e taxa de resposta, auditorias em andamento e vencidas,
//    admissões do mês e detratores sem ligação.
//
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/cockpit-coo/homologar-cs-rh.mjs [AAAA-MM-DD]
// Só agregados por unidade vão para a saída: nenhum nome de cliente, CNPJ ou pessoa.
import { consultar } from "../cockpit-ceo/brain-ro.mjs";
import { lerUnidades } from "../../src/lib/cockpit-coo/unidades.ts";
import { inicioDoTrimestre, montarCsRh } from "../../src/lib/cockpit-coo/temas/cs-rh.ts";

const COO = "acf379ff-3674-4545-86b7-79e0a18360eb"; // Paulo Carvalho (diretor, todas as unidades)
const hoje =
  process.argv[2] ??
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new Error("Data inválida: use AAAA-MM-DD.");
const iniTri = inicioDoTrimestre(hoje);
const iniMes = `${hoje.slice(0, 7)}-01`;

const ro = { transacaoSomenteLeitura: true };
const comoCoo = (sql) =>
  consultar(
    `set local role authenticated; set local request.jwt.claims to '{"sub":"${COO}","role":"authenticated"}'; ${sql}`,
    ro,
  );
const ok = (linhas, extra = {}) => ({ ok: true, linhas, ...extra });
const max = (xs, f) => xs.map(f).filter(Boolean).sort().at(-1) ?? null;

// ── 1. A carga, como o servidor do cockpit lê ──────────────────────────
const [cadastro, trat, carteira, nps, lig, aud, pessoas, [meta]] = await Promise.all([
  consultar("select id, nome_da_praca, tipo, data_inauguracao from ops.unidades order by id", ro),
  comoCoo(
    "select id, status, unidade, data_churn::text, pipedrive_deal_id, pipefy_criado_em::text, created_at::text, sincronizado_em::text from ops.central_tratativas order by id",
  ),
  comoCoo("select unidade, num_contratos, mrr_total from ops.v_mrr_por_unidade order by unidade"),
  comoCoo(
    "select id, unidade, nps_recomendacao, data_envio::text, created_at::text, updated_at::text, canal_resposta from ops.nps_pesquisas order by id",
  ),
  comoCoo("select id, nps_pesquisa_id, created_at::text from ops.nps_ligacoes order by id"),
  comoCoo(
    "select pipefy_card_id, unidade, fase_atual, auditoria_finalizada, prazo_atual::text, synced_at::text from ops.auditorias_internas order by pipefy_card_id",
  ),
  comoCoo("select id, unidade_id, data_admissao::text, updated_at::text from ops.gente_pessoas order by id"),
  comoCoo(
    `select (select meta from ops.idu_metas_padrao where escopo='rede' and indicador='churn' and periodo_inicio='${iniTri}') meta`,
  ),
]);
const deals = [...new Set(trat.map((t) => t.pipedrive_deal_id).filter((x) => x !== null))].map(String);
if (!deals.every((d) => /^\d+$/.test(d))) throw new Error("deal fora do formato");
const contratos = deals.length
  ? await comoCoo(
      `select id, pipedrive_deal_id, mrr_mensal from ops.contratos where pipedrive_deal_id in (${deals
        .map((d) => `'${d}'`)
        .join(",")}) order by id`,
    )
  : [];

const unidades = lerUnidades(cadastro);
const dados = {
  tratativas: ok(trat, { atualizadoEm: max(trat, (t) => t.sincronizado_em) }),
  contratos: ok(contratos),
  carteira: ok(carteira),
  metaChurn: { ok: true, valor: meta.meta === null ? null : Number(meta.meta) },
  nps: ok(nps, { atualizadoEm: max(nps, (p) => p.updated_at) }),
  ligacoes: {
    ok: true,
    pesquisaIds: [...new Set(lig.map((l) => l.nps_pesquisa_id).filter((x) => x !== null))],
    atualizadoEm: max(lig, (l) => l.created_at),
  },
  auditorias: ok(aud, { atualizadoEm: max(aud, (a) => a.synced_at) }),
  pessoas: ok(pessoas, { atualizadoEm: max(pessoas, (p) => p.updated_at) }),
};
const leitura = montarCsRh(dados, unidades, "", hoje);
const n = (id) => leitura.numeros.find((x) => x.id === id);

// ── 2. SQL independente ─────────────────────────────────────────────────
// Unidade casada por nome sem acento e sem caixa, com os apelidos de Goiânia (Matriz) e do Rio.
const slug = (col) => `(case lower(ops.idu_slug(${col}))
  when 'matriz' then 'goiania' when 'goiania / matriz' then 'goiania' when 'partners' then 'goiania'
  when 'sudeste (rj)' then 'rio de janeiro' else lower(ops.idu_slug(${col})) end)`;
const U = `u as (select id, nome_da_praca nome, lower(ops.idu_slug(nome_da_praca)) s,
  (tipo = 'interna' or data_inauguracao is not null) em_operacao from ops.unidades)`;

const [churnSql] = await consultar(
  `with ${U},
   usa as (select distinct ${slug("unidade")} s from ops.central_tratativas),
   cart as (select ${slug("unidade")} s, sum(mrr_total) m from ops.v_mrr_por_unidade group by 1),
   mrr_deal as (select pipedrive_deal_id, sum(mrr_mensal) m from ops.contratos group by 1),
   perd as (select ${slug("t.unidade")} s, count(*) n, coalesce(sum(d.m), 0) m, count(*) filter (where d.m is null) sem
     from ops.central_tratativas t left join mrr_deal d on d.pipedrive_deal_id = t.pipedrive_deal_id::text
     where t.status = 'lost' and t.data_churn between '${iniTri}' and '${hoje}' group by 1)
   select round(100 * sum(coalesce(p.m, 0)) / nullif(sum(c.m), 0), 1)::float churn,
     sum(coalesce(p.n, 0))::int perdidos, sum(coalesce(p.sem, 0))::int sem_mrr,
     round(sum(c.m), 2)::float carteira, round(sum(coalesce(p.m, 0)), 2)::float mrr_perdido,
     (select string_agg(u.nome, ', ' order by u.nome) from u where u.em_operacao and u.s not in (select s from usa)) sem_registro
   from u join usa on usa.s = u.s left join cart c on c.s = u.s left join perd p on p.s = u.s
   where u.em_operacao`,
  ro,
);
const churnIduT = await consultar(
  `select unidade, realizado::float from ops.idu_apuracao('${iniTri}', (date '${iniTri}' + interval '3 months')::date)
   where indicador = 'churn' order by unidade`,
  ro,
);
const [abertasSql] = await consultar(
  `with ${U} select count(*)::int abertas, max(current_date - (coalesce(t.pipefy_criado_em, t.created_at) at time zone 'America/Sao_Paulo')::date)::int mais_antiga
   from ops.central_tratativas t join u on u.s = ${slug("t.unidade")} where t.status = 'open'`,
  ro,
);
const [npsSql] = await consultar(
  `with ${U}, p as (select *, coalesce(data_envio, (created_at at time zone 'America/Sao_Paulo')::date) envio,
     case when nps_recomendacao ~ '^\\d{1,2}$' and nps_recomendacao::int <= 10 then nps_recomendacao::int end nota
     from ops.nps_pesquisas)
   select count(*)::int enviadas, count(nota)::int respostas,
     round(100.0 * (count(*) filter (where nota >= 9) - count(*) filter (where nota <= 6)) / nullif(count(nota), 0))::int nps,
     round(100.0 * count(nota) / nullif(count(*), 0), 1)::float taxa
   from p join u on u.s = ${slug("p.unidade")} and u.em_operacao
   where p.envio between '${iniTri}' and '${hoje}'`,
  ro,
);
const [audSql] = await consultar(
  `with ${U}, a as (select *, (prazo_atual at time zone 'America/Sao_Paulo')::date prazo from ops.auditorias_internas
     where not coalesce(auditoria_finalizada, false)
       and coalesce(fase_atual, '') not in ('Projeto Concluído', 'Reforma Tributária Concluida', 'Solicitações Comerciais'))
   select count(*)::int andamento, count(*) filter (where prazo < '${hoje}')::int vencidas,
     count(*) filter (where prazo < date '${hoje}' - 30)::int vencidas_30,
     (select count(*) from a where ${slug("a.unidade")} not in (select s from u))::int fora_do_cadastro
   from a join u on u.s = ${slug("a.unidade")}`,
  ro,
);
const [admSql] = await consultar(
  `select count(*) filter (where unidade_id is not null)::int admissoes, count(*) filter (where unidade_id is null)::int sem_unidade,
     (select count(distinct unidade_id) from ops.gente_pessoas where unidade_id is not null)::int unidades_com_cadastro
   from ops.gente_pessoas where data_admissao between '${iniMes}' and '${hoje}'`,
  ro,
);
const detSql = await consultar(
  `with ${U}, p as (select p.*, coalesce(data_envio, (created_at at time zone 'America/Sao_Paulo')::date) envio from ops.nps_pesquisas p
     where nps_recomendacao ~ '^\\d{1,2}$' and nps_recomendacao::int <= 6)
   select u.nome, count(*)::int n, max(date '${hoje}' - p.envio)::int dias
   from p join u on u.s = ${slug("p.unidade")}
   where p.envio between date '${hoje}' - 90 and '${hoje}' and coalesce(lower(p.canal_resposta), '') <> 'ligacao'
     and not exists (select 1 from ops.nps_ligacoes l where l.nps_pesquisa_id = p.id)
   group by u.nome order by u.nome`,
  ro,
);

// ── 3. Conferência ──────────────────────────────────────────────────────
const linhas = [];
const conferir = (o, tema, sql) => {
  const bate = JSON.stringify(tema) === JSON.stringify(sql);
  linhas.push({ numero: o, tema: JSON.stringify(tema), sql: JSON.stringify(sql), bate: bate ? "sim" : "NÃO" });
};
conferir("churn no trimestre (%)", n("churn-trimestre").valor, churnSql.churn);
conferir("clientes perdidos no trimestre", n("churn-trimestre").nota, `${churnSql.perdidos} ${churnSql.perdidos === 1 ? "cliente perdido" : "clientes perdidos"} no T${Math.floor((Number(hoje.slice(5, 7)) - 1) / 3) + 1}/${hoje.slice(0, 4)}`);
conferir("tratativas abertas", n("tratativas-abertas").valor, abertasSql.abertas);
conferir(
  "tratativa mais antiga (dias)",
  n("tratativas-abertas").nota,
  abertasSql.abertas ? `a mais antiga está aberta há ${abertasSql.mais_antiga} dias` : "nenhuma tratativa aberta",
);
conferir("NPS no trimestre", n("nps-trimestre").valor, npsSql.respostas >= 5 ? npsSql.nps : null);
conferir(
  "respostas / enviadas",
  n("nps-trimestre").nota?.match(/(\d+) (?:respostas de|de) (\d+)/)?.slice(1).map(Number) ?? null,
  [npsSql.respostas, npsSql.enviadas],
);
conferir("auditorias em andamento", n("auditorias-em-andamento").valor, audSql.andamento);
conferir("auditorias com prazo vencido", n("auditorias-em-andamento").nota, `${audSql.vencidas} com prazo vencido`);
conferir(
  "unidades com auditoria vencida > 30 dias (alertas)",
  leitura.alertas.filter((a) => a.regra === "auditoria-prazo-vencido").length,
  (await consultar(
    `with ${U} select count(distinct u.id)::int n from ops.auditorias_internas a join u on u.s = ${slug("a.unidade")}
     where not coalesce(a.auditoria_finalizada, false)
       and coalesce(a.fase_atual, '') not in ('Projeto Concluído', 'Reforma Tributária Concluida', 'Solicitações Comerciais')
       and (a.prazo_atual at time zone 'America/Sao_Paulo')::date < date '${hoje}' - 30`,
    ro,
  ))[0].n,
);
conferir("admissões no mês", n("admissoes-mes").valor, admSql.admissoes);
conferir(
  "detratores sem ligação (unidade, dias)",
  leitura.alertas
    .filter((a) => a.regra === "detrator-sem-ligacao")
    .map((a) => [a.unidade, a.peso])
    .sort((a, b) => a[0].localeCompare(b[0])),
  detSql.map((d) => [d.nome, d.dias]).sort((a, b) => a[0].localeCompare(b[0])),
);
conferir("vagas abertas", n("vagas-abertas").estado, "nao_apurado");

console.log(`\nCockpit do COO · Qua · CS e RH · hoje ${hoje} · trimestre desde ${iniTri} · ${leitura.universo}\n`);
console.table(
  leitura.numeros.map((x) => ({ numero: x.rotulo, estado: x.estado, valor: x.valor, nota: x.nota ?? "" })),
);
console.log("Alertas:");
for (const a of leitura.alertas) console.log(`  [${a.gravidade}] ${a.titulo}`);
console.log(
  `Gráfico (${leitura.graficos[0].estado}): ${leitura.graficos[0].pontos.map((p) => `${p.rotulo} ${p.churn ?? "—"}`).join(" · ")}`,
);
console.log(`\nConferência contra SQL independente:`);
console.table(linhas);
console.log(
  `Detalhe do churn (SQL): carteira de quem usa a Central R$ ${churnSql.carteira}, MRR perdido R$ ${churnSql.mrr_perdido}, ` +
    `cards sem contrato ${churnSql.sem_mrr}, sem registro: ${churnSql.sem_registro}`,
);
console.log(
  `Churn do IDU no mesmo trimestre (MRR do card): ${churnIduT.map((r) => `${r.unidade} ${r.realizado}%`).join(" · ")}`,
);
console.log(
  `Auditoria: ${audSql.vencidas_30} vencidas há mais de 30 dias; ${audSql.fora_do_cadastro} em andamento sem unidade do cadastro.`,
);
console.log(
  `Admissões: ${admSql.sem_unidade} do mês sem unidade; ${admSql.unidades_com_cadastro} unidades com gente cadastrada.`,
);
const falhas = linhas.filter((l) => l.bate !== "sim").length;
console.log(falhas ? `\n${falhas} conferência(s) NÃO bateram.` : "\nTodas as conferências bateram.");
process.exit(falhas ? 1 : 0);
