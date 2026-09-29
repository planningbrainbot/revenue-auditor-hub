// Homologação SÓ LEITURA do tema Seg · Growth do Cockpit do COO.
//
// 1. Reproduz no Node a carga do servidor (`lerGrowth`) com a sessão do Paulo Carvalho simulada
//    dentro de `begin transaction read only` (papel `authenticated` e o `sub` dele no JWT: a RLS vale
//    como no app).
// 2. Roda `montarGrowth` sobre essa carga (todas as unidades, rede, própria).
// 3. Confere cada número e cada alerta contra SQL independente, que não passa pelas funções puras
//    do cockpit nem pelas views do Growth: growth.deals e growth.midia_paga crus (e não
//    serie_mensal / dist_metas), ops.contratos com o casamento de unidade feito no SQL,
//    ops.royalties_apuracao e ops.broker_oportunidades.
//
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/cockpit-coo/homologar-growth.mjs [AAAA-MM-DD]
// Só agregados por unidade vão para a saída.
import { consultar } from "../cockpit-ceo/brain-ro.mjs";
import { lerUnidades } from "../../src/lib/cockpit-coo/unidades.ts";
import {
  montarGrowth,
  janelaTrimestre,
  trimestreAnterior,
  LIMIAR_RITMO,
  DIAS_BROKER_PARADA,
} from "../../src/lib/cockpit-coo/temas/growth.ts";

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
const ro = (sql) => consultar(sql, { transacaoSomenteLeitura: true });

const tri = janelaTrimestre(hoje);
const ant = trimestreAnterior(tri);
const amanha = new Date(Date.parse(`${hoje}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const mesAnt = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 2, 1))
  .toISOString()
  .slice(0, 10);
const mesesTri = tri.meses.filter((m) => m <= hoje.slice(0, 7));

// ── 1. A carga, como o servidor lê ─────────────────────────────────────
const maxTexto = (linhas, col) => linhas.reduce((m, l) => (l[col] && (!m || l[col] > m) ? l[col] : m), null);
const [cadastro, metas, contratos, serie, planos, [ultMidia], midiaUn, broker] = await Promise.all([
  comoCoo("select id, nome_da_praca, tipo, data_inauguracao::text from ops.unidades order by id"),
  comoCoo("select unidade, quarter, meta, vendido, atualizado_em::text from growth.dist_metas"),
  comoCoo(
    `select id, unidade, ganho_em::text, mrr_mensal, created_at::text from ops.contratos
      where origem_pipeline = 'inside_sales' and ganho_em >= '${ant.inicio}' order by id`,
  ),
  comoCoo(`select mes, vendas, mrr, investimento from growth.serie_mensal where mes >= '${ant.meses[0]}' order by mes`),
  comoCoo(
    `select mes, metrica, alvo from growth.metas where papel = 'funil' and metrica = 'investimento_mes' and mes >= '${ant.meses[0]}' order by mes`,
  ),
  comoCoo("select data::text from growth.midia_paga order by data desc limit 1"),
  comoCoo(
    `select unidade_id, mes_referencia::text, csc_trafego_pago, updated_at::text from ops.royalties_apuracao
      where status = 'confirmado' and mes_referencia = '${mesAnt}' order by unidade_id`,
  ),
  comoCoo(
    "select id, status, reservado_por, updated_at::text, fechado_em::text, mrr_precificado from ops.broker_oportunidades order by id",
  ),
]);

const unidades = lerUnidades(cadastro);
const dados = {
  metas: { ok: true, dado: metas, atualizadoEm: maxTexto(metas.filter((m) => m.quarter === tri.chave), "atualizado_em") },
  contratos: { ok: true, dado: contratos, atualizadoEm: maxTexto(contratos, "created_at") },
  midia: { ok: true, dado: { serie, planos }, atualizadoEm: ultMidia?.data ?? null },
  midiaUnidades: { ok: true, dado: midiaUn, atualizadoEm: maxTexto(midiaUn, "updated_at") },
  broker: { ok: true, dado: broker, atualizadoEm: maxTexto(broker, "updated_at") },
};

const leituras = Object.fromEntries(["", "rede", "propria"].map((f) => [f || "todas", montarGrowth(dados, unidades, f, hoje)]));
const L = leituras.todas;
const n = (id, l = L) => l.numeros.find((x) => x.id === id);

// ── 2. SQL independente ────────────────────────────────────────────────
// Casamento de unidade no SQL: os apelidos escritos à mão, sem chaveUnidade().
const casar = (col) => `case ${col} when 'Matriz' then 'Goiânia' when 'Marox' then 'Construção Civil' else ${col} end`;
const emOperacao = "(u.tipo = 'interna' or u.data_inauguracao is not null)";
const grupoSql = { todas: "true", rede: "u.tipo = 'regional'", propria: "u.tipo <> 'regional'" };

const [metasSql, dealsSql, contratosSql, contratosAntSql, midiaSql, midiaAntSql, brokerSql, midiaSemContratoSql, ritmoSql, brokerParadasSql] =
  await Promise.all([
    ro(`select ${Object.entries(grupoSql)
      .map(([g, cond]) => `sum(m.vendido) filter (where ${cond}) vend_${g}, sum(m.meta) filter (where ${cond}) meta_${g}`)
      .join(", ")}
      from growth.dist_metas m join ops.unidades u on u.nome_da_praca = ${casar("m.unidade")}
      where m.quarter = '${tri.chave}' and ${emOperacao}`),
    // O vendido sem a foto do sync: negócios ganhos no Inside Sales, direto de growth.deals.
    ro(`select sum(coalesce(d.mrr_efetivo, d.mrr, 0)) vend
      from growth.deals d join ops.unidades u on u.nome_da_praca = ${casar("d.unidade_negocio")}
      where d.status = 'won' and d.pipeline = 'Inside Sales' and d.won_time >= '${tri.inicio}' and d.won_time < '${tri.fim}'
        and ${emOperacao}
        and exists (select 1 from growth.dist_metas m where m.quarter = '${tri.chave}' and ${casar("m.unidade")} = u.nome_da_praca)`),
    ro(`select ${Object.entries(grupoSql)
      .map(([g, cond]) => `count(*) filter (where ${cond} and ${emOperacao}) n_${g}, sum(c.mrr_mensal) filter (where ${cond} and ${emOperacao}) mrr_${g}`)
      .join(", ")}, count(*) filter (where u.id is null) sem_unidade
      from ops.contratos c left join ops.unidades u on u.nome_da_praca = ${casar("c.unidade")}
      where c.origem_pipeline = 'inside_sales' and c.ganho_em >= '${tri.inicio}' and c.ganho_em < '${amanha}'`),
    ro(`select count(*) n, sum(c.mrr_mensal) mrr
      from ops.contratos c join ops.unidades u on u.nome_da_praca = ${casar("c.unidade")}
      where c.origem_pipeline = 'inside_sales' and c.ganho_em >= '${ant.inicio}' and c.ganho_em < '${ant.fim}' and ${emOperacao}`),
    // Mídia e vendas crus (sem a view serie_mensal).
    ro(`select (select sum(investimento) from growth.midia_paga
                 where not growth.campanha_fora_do_funil(campanha) and to_char(data, 'YYYY-MM') = any(array['${mesesTri.join("','")}'])) inv,
               (select sum(mrr_efetivo) from growth.deals where status = 'won' and not growth.deal_arquivado(stage)
                 and to_char(won_time at time zone 'America/Sao_Paulo', 'YYYY-MM') = any(array['${mesesTri.join("','")}'])) mrr,
               (select count(*) from growth.deals where status = 'won' and not growth.deal_arquivado(stage)
                 and to_char(won_time at time zone 'America/Sao_Paulo', 'YYYY-MM') = any(array['${mesesTri.join("','")}'])) vendas,
               (select sum(alvo) from growth.metas where papel = 'funil' and metrica = 'investimento_mes' and mes = any(array['${tri.meses.join("','")}'])) plano,
               (select count(*) from growth.metas where papel = 'funil' and metrica = 'investimento_mes' and mes = any(array['${tri.meses.join("','")}'])) meses_plano`),
    ro(`select (select sum(investimento) from growth.midia_paga
                 where not growth.campanha_fora_do_funil(campanha) and to_char(data, 'YYYY-MM') = any(array['${ant.meses.join("','")}'])) inv,
               (select count(*) from growth.deals where status = 'won' and not growth.deal_arquivado(stage)
                 and to_char(won_time at time zone 'America/Sao_Paulo', 'YYYY-MM') = any(array['${ant.meses.join("','")}'])) vendas`),
    ro(`select count(*) filter (where status in ('disponivel', 'reservado')) abertas,
               count(*) filter (where status = 'comprado' and fechado_em >= '${tri.inicio}' and fechado_em < '${tri.fim}') convertidas
        from ops.broker_oportunidades`),
    ro(`select u.nome_da_praca unidade, a.csc_trafego_pago midia
        from ops.royalties_apuracao a join ops.unidades u on u.id = a.unidade_id
        where a.status = 'confirmado' and a.mes_referencia = '${mesAnt}' and coalesce(a.csc_trafego_pago, 0) > 0
          and u.tipo = 'regional' and u.data_inauguracao is not null
          and not exists (select 1 from ops.contratos c where c.origem_pipeline = 'inside_sales'
                            and c.unidade = u.nome_da_praca and date_trunc('month', c.ganho_em) = '${mesAnt}'::date)
        order by 1`),
    ro(`select u.nome_da_praca unidade, m.meta, m.vendido, round(m.vendido / (m.meta * ${tri.decorridos}::numeric / ${tri.dias}) * 100) pct_ritmo
        from growth.dist_metas m join ops.unidades u on u.nome_da_praca = ${casar("m.unidade")}
        where m.quarter = '${tri.chave}' and m.meta > 0 and ${emOperacao}
          and m.vendido < ${LIMIAR_RITMO} * m.meta * ${tri.decorridos}::numeric / ${tri.dias}
        order by 1`),
    ro(`select status, reservado_por, count(*) n from ops.broker_oportunidades
        where status in ('disponivel', 'reservado') and '${hoje}'::date - updated_at::date > ${DIAS_BROKER_PARADA}
        group by 1, 2 order by 1, 2`),
  ]);

// ── 3. Comparação ──────────────────────────────────────────────────────
const linhas = [];
const conferir = (rotulo, cockpit, sql, tolerancia = 0.01) => {
  const a = cockpit === null || cockpit === undefined ? null : Number(cockpit);
  const b = sql === null || sql === undefined ? null : Number(sql);
  const bate = a !== null && b !== null ? Math.abs(a - b) <= tolerancia : a === b;
  linhas.push({ rotulo, cockpit: a, sql: b, bate: bate ? "sim" : "NÃO" });
};
const r2 = (x) => Math.round(Number(x) * 100) / 100;

const [ms] = metasSql;
for (const g of ["todas", "rede", "propria"]) {
  conferir(`MRR vendido (${g})`, n("mrr-vendido-meta", leituras[g]).valor, ms[`vend_${g}`]);
  conferir(`Meta do trimestre (${g})`, n("mrr-vendido-meta", leituras[g]).meta?.valor, ms[`meta_${g}`]);
}
// Informativo: a foto diária do sync contra growth.deals agora (diferença = venda depois das 08h10).
linhas.push({
  rotulo: "MRR vendido × growth.deals cru agora (informativo)",
  cockpit: n("mrr-vendido-meta").valor,
  sql: r2(dealsSql[0].vend),
  bate: "info",
});
const [cs] = contratosSql;
for (const g of ["todas", "rede", "propria"]) {
  conferir(`Contratos novos (${g})`, n("contratos-novos", leituras[g]).valor, cs[`n_${g}`]);
  conferir(`Ticket médio (${g})`, n("ticket-medio", leituras[g]).valor, cs[`n_${g}`] ? r2(cs[`mrr_${g}`] / cs[`n_${g}`]) : null);
}
conferir("Ticket do trimestre anterior (delta)", r2(n("ticket-medio").valor - n("ticket-medio").delta.valor), r2(contratosAntSql[0].mrr / contratosAntSql[0].n));
const [md] = midiaSql;
conferir("Mídia investida", n("midia-roas").valor, md.inv);
conferir("Plano de mídia", n("midia-roas").meta?.valor ?? null, Number(md.meses_plano) === 3 ? md.plano : null);
conferir("ROAS (MRR novo ÷ mídia)", Number((n("midia-roas").nota.match(/ROAS ([\d,]+)/)?.[1] ?? "").replace(",", ".")), r2(md.mrr / md.inv));
conferir("Custo de mídia por contrato", n("cac-midia").valor, r2(md.inv / md.vendas));
conferir("Custo por contrato do trimestre anterior", r2(n("cac-midia").valor - n("cac-midia").delta.valor), r2(midiaAntSql[0].inv / midiaAntSql[0].vendas), 0.02);
conferir("Broker: abertas", n("broker").valor, brokerSql[0].abertas);
conferir("Broker: convertidas no trimestre", Number(n("broker").nota.match(/^(\d+)/)[1]), brokerSql[0].convertidas);

const alertas = (regra) => L.alertas.filter((a) => a.regra === regra).map((a) => a.unidade).sort().join(", ");
const listaSql = (rs) => rs.map((r) => r.unidade).sort().join(", ");
const alinhar = (rotulo, a, b) => linhas.push({ rotulo, cockpit: a || "—", sql: b || "—", bate: a === b ? "sim" : "NÃO" });
alinhar("Alertas de ritmo < 50%", alertas("abaixo-do-ritmo"), listaSql(ritmoSql));
alinhar("Alertas de mídia sem contrato", alertas("midia-sem-contrato"), listaSql(midiaSemContratoSql));
const nomeUn = new Map(unidades.map((u) => [u.id, u.nome]));
alinhar(
  "Alertas do Broker",
  L.alertas.filter((a) => a.regra.startsWith("broker")).map((a) => a.titulo.split(" · ")[0]).sort().join(", "),
  brokerParadasSql
    .map((r) => (r.status === "disponivel" ? "Broker" : nomeUn.get(Number(r.reservado_por)) ?? "?"))
    .sort()
    .join(", "),
);

console.log(`\nTema Growth · ${hoje} · ${tri.rotulo} (${tri.decorridos}/${tri.dias} dias) · ${L.universo}\n`);
console.log("Números (todas as unidades):");
for (const x of L.numeros)
  console.log(`  ${x.rotulo}: ${x.valor ?? "—"} [${x.estado}]${x.meta ? ` · ${x.meta.rotulo} ${x.meta.valor}` : ""}${x.nota ? ` · ${x.nota}` : ""}`);
console.log("\nAlertas:");
for (const a of L.alertas) console.log(`  [${a.gravidade}] ${a.titulo}`);
console.log("\nGráfico:", L.graficos[0].pontos.map((p) => `${p.rotulo} ${Math.round((p.vendido / p.meta) * 100)}%`).join(" · "));
console.log("\nAvisos:");
for (const a of L.avisos) console.log(`  ${a}`);
console.log(`\nContratos do Inside Sales sem unidade no cadastro (SQL): ${cs.sem_unidade}\n`);
console.table(linhas);
const falhas = linhas.filter((l) => l.bate === "NÃO");
console.log(falhas.length ? `${falhas.length} divergência(s).` : "Tudo bate.");
process.exitCode = falhas.length ? 1 : 0;
