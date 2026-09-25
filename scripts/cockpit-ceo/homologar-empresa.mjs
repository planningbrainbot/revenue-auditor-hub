// Homologação do Cockpit do CEO empresarial com dado real (somente leitura, 23/09/2026).
//
// Passa as leituras reais pelos MESMOS módulos puros da tela (financeiro.ts, aquisicao.ts,
// operacao.ts, cadeia.ts) e confere cada resultado com uma conta SQL independente — outra consulta,
// não a mesma função:
//   · Financeiro canônico (Financial Brain): ponte classificada em SQL sobre as linhas por cliente
//     da função oficial, contra a ponte do TypeScript; e a série do cockpit contra a cópia
//     congelada do banco único (a divergência que motivou a troca de fonte);
//   · margem por grupo: agregação SQL de `por_empresa` contra a do TypeScript;
//   · inadimplência: soma das faixas em SQL contra o total;
//   · Growth: vendas e MRR ganhos contados direto em `growth.deals` contra a série do Growth; plano;
//     pipeline aberto por mês contra SQL;
//   · onboarding: contagem SQL por fase e por idade na fase contra o TypeScript;
//   · cadeia: safra, onboarding e saídas contados em SQL no banco único;
//   · permissões: porta de cada leitura nova para perfis reais, com JWT simulado.
// Grava só agregados: nenhum nome de cliente, CNPJ, e-mail ou id de pessoa.
//
// Uso: SUPABASE_ACCESS_TOKEN=… node --experimental-strip-types scripts/cockpit-ceo/homologar-empresa.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { consultar } from "./brain-ro.mjs";
import { extrairFaturamento } from "../../src/lib/cockpit-ceo/receita-fontes.ts";
import {
  extrairIndicadores,
  extrairInadimplencia,
  extrairPorCliente,
  montarPonte,
} from "../../src/lib/cockpit-ceo/financeiro.ts";
import { montarAquisicao } from "../../src/lib/cockpit-ceo/aquisicao.ts";
import { lerCard, montarOnboarding } from "../../src/lib/cockpit-ceo/operacao.ts";
import { docDigitos, montarCadeia, normContraparte } from "../../src/lib/cockpit-ceo/cadeia.ts";
import { hoje as hojeSP } from "../../src/lib/monetizacao/model.ts";

const FIN = "itpddzjfrgrbathcqbpo";
const SAIDA = "docs/dev_notes/cockpit-ceo-empresa/homologacao";
const hoje = hojeSP();
const agora = new Date().toISOString();
const mesHoje = hoje.slice(0, 7);
const de = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 24, 1))
  .toISOString()
  .slice(0, 10);
const ate = `${mesHoje}-01`;
const fin = (sql) => consultar(sql, { ref: FIN, transacaoSomenteLeitura: true });
const ro = (sql) => consultar(sql, { transacaoSomenteLeitura: true });
const tempos = {};
const medir = async (nome, fn) => {
  const t = performance.now();
  const r = await fn();
  tempos[nome] = Math.round(performance.now() - t);
  return r;
};
const cent = (v) => Math.round(Number(v) * 100);
const r = { lidoEm: agora, hoje, conferencias: {} };
const conf = (nome, ok, detalhe) => {
  r.conferencias[nome] = { ok, ...detalhe };
  console.log(`${ok ? "✓" : "✗"} ${nome}`, JSON.stringify(detalhe).slice(0, 300));
};

// ── 1. Financeiro canônico e ponte ─────────────────────────────────────────
const [{ j: fat }] = await medir("fn_faturamento_mensal (sem limite)", () =>
  fin(`select public.fn_faturamento_mensal(p_comp_de => '${de}', p_comp_ate => '${ate}') j`),
);
const f = extrairFaturamento(fat);
const parciais = new Set([
  ...f.serie.filter((s) => s.parcial).map((s) => s.mes),
  ...f.meses.filter((m) => m.parcial || m.semCobertura).map((m) => m.mes),
]);
const fechados = f.serie.map((s) => s.mes).filter((m) => m < mesHoje && !parciais.has(m));
const ponte = montarPonte(extrairPorCliente(fat), fechados);
r.financeiro = {
  serie: f.serie.map((s) => ({ mes: s.mes, valor: s.valor, parcial: s.parcial })),
  fechados,
  ponte: ponte.meses,
};

// Ponte em SQL, classificando as mesmas linhas por cliente por outro código.
const ponteSql = await fin(`
  with j as (select public.fn_faturamento_mensal(p_comp_de => '${de}', p_comp_ate => '${ate}') j),
  l as (
    select x->>'cliente' cli, to_char((m->>'competencia')::date, 'YYYY-MM') mes,
           round(coalesce((m->>'receita')::numeric, 0) * 100)::bigint c
    from j, jsonb_array_elements(j->'linhas') x, jsonb_array_elements(x->'meses') m),
  s as (select cli, mes, sum(c) c from l group by 1, 2),
  meses as (select unnest(array[${fechados.map((m) => `'${m}'`).join(",")}]::text[]) mes),
  pares as (
    select m.mes, to_char((m.mes || '-01')::date - interval '1 month', 'YYYY-MM') ant from meses m
    where to_char((m.mes || '-01')::date - interval '1 month', 'YYYY-MM') in (select mes from meses)),
  base as (
    select p.mes, s.cli,
      coalesce(sum(s.c) filter (where s.mes = p.ant), 0) a,
      coalesce(sum(s.c) filter (where s.mes = p.mes), 0) b,
      coalesce(bool_or(s.mes < p.ant and s.c <> 0), false) antes
    from pares p join s on s.mes <= p.mes
    group by p.mes, s.cli)
  select mes,
    sum(b - a) filter (where a <> 0 and b <> 0 and b > a) expansao,
    sum(b - a) filter (where a <> 0 and b <> 0 and b < a) contracao,
    sum(b) filter (where a = 0 and b <> 0 and not antes) novos,
    sum(b) filter (where a = 0 and b <> 0 and antes) retornos,
    -sum(a) filter (where a <> 0 and b = 0) sem,
    count(*) filter (where a = 0 and b <> 0 and not antes) n_novos,
    count(*) filter (where a <> 0 and b = 0) n_sem
  from base group by mes order by mes`);
const difs = [];
for (const s of ponteSql) {
  const t = ponte.meses.find((m) => m.mes === s.mes);
  const par = [
    ["expansao", t?.expansao.valor, s.expansao],
    ["contracao", t?.contracao.valor, s.contracao],
    ["novos", t?.novos.valor, s.novos],
    ["retornos", t?.retornos.valor, s.retornos],
    ["semFaturamento", t?.semFaturamento.valor, s.sem],
  ];
  for (const [k, ts, sq] of par)
    if (cent(ts ?? 0) !== Number(sq ?? 0))
      difs.push({ mes: s.mes, k, ts, sql: Number(sq ?? 0) / 100 });
  if (
    t &&
    (t.novos.clientes !== Number(s.n_novos) || t.semFaturamento.clientes !== Number(s.n_sem))
  )
    difs.push({
      mes: s.mes,
      k: "clientes",
      ts: [t.novos.clientes, t.semFaturamento.clientes],
      sql: [s.n_novos, s.n_sem],
    });
}
conf(
  "ponte TS × SQL (parcelas e clientes)",
  difs.length === 0 && ponteSql.length === ponte.meses.length,
  {
    meses: ponte.meses.length,
    diferencas: difs.slice(0, 5),
  },
);
conf(
  "ponte fecha com a série da fonte em todos os meses",
  ponte.meses.every((m) => m.fecha),
  {
    naoFecham: ponte.meses.filter((m) => !m.fecha).map((m) => m.mes),
  },
);

// A cópia congelada no banco único (o que o cockpit lia até 23/09).
const copia = await ro(`
  select to_char((s->>'competencia')::date,'YYYY-MM') mes, (s->>'receita')::numeric receita
  from jsonb_array_elements(financeiro.fn_faturamento_mensal(p_comp_de => '${de}', p_comp_ate => '${ate}', p_limite_clientes => 1)->'serie') s`);
r.financeiro.copiaCongelada = copia.map((c) => {
  const canon = f.serie.find((s) => s.mes === c.mes)?.valor ?? null;
  return {
    mes: c.mes,
    copia: Number(c.receita),
    canonico: canon,
    diferencaPct: canon ? Number(((Number(c.receita) / canon - 1) * 100).toFixed(1)) : null,
  };
});

// ── 2. Caixa e margem ──────────────────────────────────────────────────────
const ultimoFechado = fechados.at(-1);
const fimUltimo = new Date(
  Date.UTC(Number(ultimoFechado.slice(0, 4)), Number(ultimoFechado.slice(5, 7)), 0),
)
  .toISOString()
  .slice(0, 10);
const [{ j: indj }] = await medir("fn_cockpit_indicadores", () =>
  fin(
    `select public.fn_cockpit_indicadores(null, null, null, '${ultimoFechado.slice(0, 4)}-01-01', '${fimUltimo}') j`,
  ),
);
const ind = extrairIndicadores(indj);
const grupoSql = await fin(`
  select e->>'grupo_apuracao' g, round(sum((e->>'receita_bruta')::numeric) * 100)::bigint c
  from jsonb_array_elements(public.fn_cockpit_indicadores(null, null, null, '${ultimoFechado.slice(0, 4)}-01-01', '${fimUltimo}')->'por_empresa') e
  group by 1`);
const difG = grupoSql.filter(
  (g) => cent(ind.porGrupo.find((x) => x.grupo === g.g)?.receitaBruta ?? -1) !== Number(g.c),
);
conf("margem por grupo TS × SQL", difG.length === 0, {
  grupos: ind.porGrupo.length,
  diferencas: difG.map((g) => g.g),
});
r.caixa = {
  receitaBruta: ind.receitaBruta,
  lucroBruto: ind.lucroBruto,
  margem: ind.margem,
  porGrupo: ind.porGrupo,
  caixaLivre: ind.caixa,
};
const [{ j: inaj }] = await medir("fn_inadimplencia_live", () =>
  fin(`select public.fn_inadimplencia_live(null, null, null, null) j`),
);
const ina = extrairInadimplencia(inaj);
const somaFaixas = ina.faixas.reduce((s, x) => s + cent(x.valor), 0);
conf("inadimplência: faixas somam o vencido", Math.abs(somaFaixas - cent(ina.atrasado)) <= 1, {
  atrasado: ina.atrasado,
  somaFaixas: somaFaixas / 100,
  sincronizadoEm: ina.sincronizadoEm,
});
r.caixa.inadimplencia = {
  emAberto: ina.emAberto,
  atrasado: ina.atrasado,
  titulos: ina.titulosAtrasados,
  faixas: ina.faixas,
  semSync: ina.empresasSemSync,
};
const [frescor] = await fin(
  `select max(carregado_em) carregado, max(cobre_ate) cobre from public.dado_frescor where dataset = 'lancamentos'`,
);
r.financeiro.frescor = frescor;

// ── 3. Growth ──────────────────────────────────────────────────────────────
const [serie, metas, abertos, dist] = await Promise.all([
  ro(`select mes, vendas, mrr, investimento, leads, mql from growth.serie_mensal order by mes`),
  ro(`select mes, papel, metrica, alvo from growth.metas where papel = 'funil'`),
  ro(
    `select deal_id, mrr, mrr_efetivo, expected_close_date from growth.deals where pipeline = 'Inside Sales' and status = 'open'`,
  ),
  ro(`select unidade, quarter, meta, vendido from growth.dist_metas`),
]);
const aq = montarAquisicao({ serie, metas, mesCorrente: [], abertos, distMetas: dist }, hoje);
const ganhosSql = await ro(`
  select to_char(won_time at time zone 'America/Sao_Paulo', 'YYYY-MM') mes, count(*)::int vendas, round(sum(mrr_efetivo))::bigint mrr
  from growth.deals where status = 'won' and pipeline = 'Inside Sales' and not growth.deal_arquivado(stage)
    and won_time >= '2026-01-01' group by 1 order by 1`);
const difA = ganhosSql
  .map((g) => ({ g, s: aq.meses.find((m) => m.mes === g.mes) }))
  .filter(
    ({ g, s }) => !s || s.vendas !== g.vendas || Math.abs((s.mrrNovo ?? 0) - Number(g.mrr)) > 1,
  )
  .map(({ g, s }) => ({
    mes: g.mes,
    serie: s ? [s.vendas, Math.round(s.mrrNovo ?? 0)] : null,
    deals: [g.vendas, Number(g.mrr)],
  }));
conf("Growth: série mensal × ganhos contados em growth.deals", difA.length === 0, {
  diferencas: difA,
});
const pipeSql = await ro(`
  select coalesce(to_char(expected_close_date, 'YYYY-MM'), 'sem data') mes, count(*)::int n,
         round(sum(coalesce(mrr_efetivo, mrr, 0)) * 100)::bigint c
  from growth.deals where pipeline = 'Inside Sales' and status = 'open' group by 1`);
const semDataSql = pipeSql.find((p) => p.mes === "sem data");
const totalSql = pipeSql.reduce((s, p) => s + Number(p.c), 0);
conf(
  "pipeline aberto TS × SQL",
  cent(aq.pipeline.mrr) === totalSql && aq.pipeline.semData.negocios === (semDataSql?.n ?? 0),
  {
    negocios: aq.pipeline.negocios,
    mrr: aq.pipeline.mrr,
    semData: aq.pipeline.semData,
    vencidos: aq.pipeline.vencidos,
  },
);
r.aquisicao = {
  meses: aq.meses,
  pipeline: aq.pipeline,
  unidadesPorTrimestre: Object.entries(
    aq.unidades.reduce(
      (o, u) => (
        (o[u.trimestre] ??= { unidades: 0, meta: 0, vendido: 0 }),
        o[u.trimestre].unidades++,
        (o[u.trimestre].meta += u.meta),
        (o[u.trimestre].vendido += u.vendido),
        o
      ),
      {},
    ),
  ),
};

// ── 4. Onboarding e cadeia ─────────────────────────────────────────────────
const cardsCrus = await ro(
  `select fase_atual, fase_atual_ordem, entrou_fase_atual_em, criado_em, concluido, empresa_id, fases_history from ops.cs_onboarding_cards`,
);
const contratos = await ro(
  `select id, empresa_id, cnpj, ganho_em::text ganho_em, pipedrive_deal_id from ops.contratos where origem_pipeline = 'inside_sales'`,
);
const ganhosPorEmpresa = new Map();
for (const k of contratos)
  if (k.empresa_id !== null)
    ganhosPorEmpresa.set(Number(k.empresa_id), [
      ...(ganhosPorEmpresa.get(Number(k.empresa_id)) ?? []),
      k.ganho_em.slice(0, 10),
    ]);
const cards = cardsCrus.map(lerCard);
const onb = montarOnboarding(cards, ganhosPorEmpresa, agora, { de: `${mesHoje}-01`, ate: hoje });
const [onbSql] = await ro(`
  select count(*) filter (where fase_atual not in ('Concluído','Churn no Onboarding'))::int em_curso,
         count(*) filter (where fase_atual not in ('Concluído','Churn no Onboarding') and floor(extract(epoch from (now() - entrou_fase_atual_em)) / 86400) > 30)::int p30,
         count(*) filter (where fase_atual not in ('Concluído','Churn no Onboarding') and floor(extract(epoch from (now() - entrou_fase_atual_em)) / 86400) > 60)::int p60,
         count(*) filter (where fase_atual = 'Concluído')::int concluidos
  from ops.cs_onboarding_cards`);
conf(
  "onboarding TS × SQL",
  onb.emCurso === onbSql.em_curso &&
    onb.parados30 === onbSql.p30 &&
    onb.parados60 === onbSql.p60 &&
    onb.concluidos === onbSql.concluidos,
  {
    ts: {
      emCurso: onb.emCurso,
      p30: onb.parados30,
      p60: onb.parados60,
      concluidos: onb.concluidos,
    },
    sql: onbSql,
  },
);
const [medSql] = await ro(`
  with c as (
    select o.empresa_id, o.criado_em::date criado,
      coalesce((select min((h->>'entrou_em')::timestamptz) from jsonb_array_elements(o.fases_history) h where h->>'fase' = 'Concluído'), case when o.fase_atual = 'Concluído' then o.entrou_fase_atual_em end) conc
    from ops.cs_onboarding_cards o where o.fase_atual = 'Concluído'),
  g as (
    select c.conc, (select max(k.ganho_em) from ops.contratos k where k.origem_pipeline = 'inside_sales' and k.empresa_id = c.empresa_id and k.ganho_em <= c.criado) ganho from c)
  select count(*) filter (where ganho is not null and conc >= ganho)::int casos,
         percentile_cont(0.5) within group (order by round(extract(epoch from (conc - ganho::timestamptz)) / 86400)) filter (where ganho is not null and conc >= ganho) mediana
  from g`);
conf(
  "onboarding: mediana do ganho à conclusão TS × SQL",
  onb.ganhoAteConclusao.casos === medSql.casos &&
    Math.abs((onb.ganhoAteConclusao.mediana ?? -1) - Number(medSql.mediana)) <= 1,
  { ts: onb.ganhoAteConclusao, sql: medSql },
);
r.onboarding = onb;

const desde = onb.desde;
const cnpjEmpresa = new Map(
  (await ro(`select id, cnpj from ops.empresas`)).map((e) => [Number(e.id), docDigitos(e.cnpj)]),
);
const vendas = contratos
  .filter((k) => k.ganho_em >= desde && k.ganho_em <= hoje)
  .map((k) => ({
    empresaId: k.empresa_id === null ? null : Number(k.empresa_id),
    cnpj:
      docDigitos(k.cnpj) ??
      (k.empresa_id === null ? null : (cnpjEmpresa.get(Number(k.empresa_id)) ?? null)),
    ganhoEm: k.ganho_em.slice(0, 10),
    dealId: k.pipedrive_deal_id === null ? null : String(k.pipedrive_deal_id),
  }));
const titulosUnidadePorCnpj = new Map();
for (const t of await ro(
  `select regexp_replace(cpf_cnpj, '[^0-9]', '', 'g') d, data_vencimento::text v, data_pagamento is not null pago from ops.contas_receber where regexp_replace(cpf_cnpj, '[^0-9]', '', 'g') in (${[...new Set(vendas.map((v) => v.cnpj).filter(Boolean))].map((c) => `'${c}'`).join(",") || "''"})`,
)) {
  const l = titulosUnidadePorCnpj.get(t.d) ?? [];
  l.push({ vencimento: t.v, pago: t.pago });
  titulosUnidadePorCnpj.set(t.d, l);
}
const churn = await ro(
  `select empresa_id, pipedrive_deal_id from ops.central_tratativas where status = 'lost'`,
);
const cnpjs = [...new Set(vendas.map((v) => v.cnpj).filter(Boolean))];
const cadastro = cnpjs.length
  ? await fin(
      `select doc_digitos, nome_norm, fantasia_norm from public.omie_contraparte where doc_digitos in (${cnpjs.map((c) => `'${c}'`).join(",")})`,
    )
  : [];
const nomesPorCnpj = new Map();
for (const c of cadastro) {
  const s = nomesPorCnpj.get(c.doc_digitos) ?? new Set();
  for (const n of [c.nome_norm, c.fantasia_norm]) if (n) s.add(n);
  nomesPorCnpj.set(c.doc_digitos, s);
}
const nomes = [...new Set([...nomesPorCnpj.values()].flatMap((s) => [...s]))];
const docs = nomes.length
  ? await fin(
      `select n, count(distinct doc_digitos)::int d from (select nome_norm n, doc_digitos from public.omie_contraparte where nome_norm in (${nomes.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")}) union all select fantasia_norm, doc_digitos from public.omie_contraparte where fantasia_norm in (${nomes.map((n) => `'${n.replace(/'/g, "''")}'`).join(",")})) x where doc_digitos is not null group by 1`,
    )
  : [];
const [{ j: fatSafra }] = await fin(
  `select public.fn_faturamento_mensal(p_comp_de => '${desde.slice(0, 7)}-01', p_comp_ate => '${ate}') j`,
);
const mesesFaturadosPorNome = new Map();
for (const l of fatSafra.linhas ?? []) {
  const n = normContraparte(l.cliente);
  if (!n) continue;
  const s = mesesFaturadosPorNome.get(n) ?? new Set();
  for (const m of l.meses ?? [])
    if (m.receita !== null && Number(m.receita) !== 0) s.add(m.competencia.slice(0, 7));
  mesesFaturadosPorNome.set(n, s);
}
const cad = montarCadeia({
  vendas,
  onboarding: new Map(
    cards
      .filter((c) => c.empresaId !== null)
      .map((c) => [c.empresaId, { concluido: c.fase === "Concluído" }]),
  ),
  nomesPorCnpj,
  documentosPorNome: new Map(docs.map((d) => [d.n, d.d])),
  mesesFaturadosPorNome,
  churnEmpresas: new Set(
    churn.filter((c) => c.empresa_id !== null).map((c) => Number(c.empresa_id)),
  ),
  churnNegocios: new Set(
    churn.filter((c) => c.pipedrive_deal_id !== null).map((c) => String(c.pipedrive_deal_id)),
  ),
  faturamentoLido: true,
  titulosUnidadePorCnpj,
  unidadesLidas: true,
});
const [cadSql] = await ro(`
  with v as (select id, empresa_id, pipedrive_deal_id, cnpj, ganho_em from ops.contratos where origem_pipeline = 'inside_sales' and ganho_em between '${desde}' and '${hoje}')
  select count(*)::int vendas,
    count(*) filter (where exists (select 1 from ops.cs_onboarding_cards o where o.empresa_id = v.empresa_id))::int iniciada,
    count(*) filter (where exists (select 1 from ops.cs_onboarding_cards o where o.empresa_id = v.empresa_id and o.fase_atual = 'Concluído'))::int concluida,
    count(*) filter (where exists (select 1 from ops.central_tratativas t where t.status = 'lost' and (t.empresa_id = v.empresa_id or t.pipedrive_deal_id::text = v.pipedrive_deal_id)))::int saidas,
    count(*) filter (where exists (select 1 from ops.contas_receber r where regexp_replace(r.cpf_cnpj, '[^0-9]', '', 'g') = coalesce(case when length(regexp_replace(v.cnpj, '[^0-9]', '', 'g')) = 14 then regexp_replace(v.cnpj, '[^0-9]', '', 'g') end, (select case when length(regexp_replace(e.cnpj, '[^0-9]', '', 'g')) = 14 then regexp_replace(e.cnpj, '[^0-9]', '', 'g') end from ops.empresas e where e.id = v.empresa_id)) and r.data_vencimento >= v.ganho_em))::int na_unidade,
    count(*) filter (where exists (select 1 from ops.contas_receber r where regexp_replace(r.cpf_cnpj, '[^0-9]', '', 'g') = coalesce(case when length(regexp_replace(v.cnpj, '[^0-9]', '', 'g')) = 14 then regexp_replace(v.cnpj, '[^0-9]', '', 'g') end, (select case when length(regexp_replace(e.cnpj, '[^0-9]', '', 'g')) = 14 then regexp_replace(e.cnpj, '[^0-9]', '', 'g') end from ops.empresas e where e.id = v.empresa_id)) and r.data_vencimento >= v.ganho_em and r.data_pagamento is not null))::int recebidas
  from v`);
conf(
  "cadeia TS × SQL (venda, ativação, título e pagamento na unidade, saída)",
  cad.vendas === cadSql.vendas &&
    cad.ativacaoIniciada === cadSql.iniciada &&
    cad.ativacaoConcluida === cadSql.concluida &&
    cad.saidas === cadSql.saidas &&
    cad.faturadasNaUnidade === cadSql.na_unidade &&
    cad.recebidasNaUnidade === cadSql.recebidas,
  {
    ts: {
      vendas: cad.vendas,
      iniciada: cad.ativacaoIniciada,
      concluida: cad.ativacaoConcluida,
      naUnidade: cad.faturadasNaUnidade,
      recebidas: cad.recebidasNaUnidade,
      saidas: cad.saidas,
    },
    sql: cadSql,
  },
);
r.cadeia = cad;

// ── 5. Permissões: a porta de cada leitura nova, por perfil ────────────────
const UUID = /^[0-9a-f-]{36}$/;
const perfis = await ro(`
  select 'super admin' rotulo, (select user_id::text from ops.user_roles where role='admin' order by user_id limit 1) id
  union all select 'financeiro (rede toda)', (select r.user_id::text from ops.user_roles r join ops.usuario_escopo e on e.user_id=r.user_id where r.role='financeiro' and e.todas_unidades and not exists (select 1 from ops.user_roles x where x.user_id=r.user_id and x.role='admin') order by 1 limit 1)
  union all select 'cs (rede toda)', (select r.user_id::text from ops.user_roles r join ops.usuario_escopo e on e.user_id=r.user_id where r.role='cs' and e.todas_unidades and not exists (select 1 from ops.user_roles x where x.user_id=r.user_id and x.role='admin') order by 1 limit 1)
  union all select 'sócio regional', (select user_id::text from ops.user_roles where role='socio_regional' order by user_id limit 1)
  union all select 'conta sem papel', (select u.id::text from auth.users u where not exists (select 1 from ops.user_roles r where r.user_id=u.id) order by u.created_at limit 1)`);
r.permissoes = [];
for (const p of perfis) {
  if (!p.id || !UUID.test(p.id)) {
    r.permissoes.push({ perfil: p.rotulo, observacao: "nenhuma conta com esse perfil" });
    continue;
  }
  const claims = JSON.stringify({ sub: p.id, role: "authenticated" });
  const [x] = await ro(`
    set local role authenticated; set local statement_timeout = '8s';
    set local request.jwt.claims to '${claims}';
    select public.tem_produto('financeiro') financeiro,
      coalesce((select todas_empresas from ops.usuario_escopo where user_id = auth.uid()), false) todas_empresas,
      coalesce((select todas_unidades from ops.usuario_escopo where user_id = auth.uid()), false) todas_unidades,
      public.tem_produto('growth') growth, growth.e_membro() membro_growth,
      ops.can('view.painel_cs') painel_cs, ops.can('view.fila_cella') fila_cella,
      (select count(*) from growth.midia_paga)::int midia_visivel,
      (select count(*) from ops.cs_onboarding_cards)::int onboarding_visivel`).catch((e) => [
    { erro: e.message.slice(0, 160) },
  ]);
  r.permissoes.push({
    perfil: p.rotulo,
    ...x,
    portas: x.erro
      ? null
      : {
          financeiro: x.financeiro && x.todas_empresas ? "abre" : "acesso insuficiente",
          growth: x.growth && x.membro_growth ? "abre" : "acesso insuficiente",
          onboarding:
            (x.painel_cs || x.fila_cella) && x.todas_unidades ? "abre" : "acesso insuficiente",
        },
  });
}
const [totais] = await ro(
  `select (select count(*) from growth.midia_paga)::int midia, (select count(*) from ops.cs_onboarding_cards)::int onboarding`,
);
const divergencias = r.permissoes.filter(
  (p) =>
    p.portas &&
    ((p.portas.growth === "abre" && p.midia_visivel !== totais.midia) ||
      (p.portas.onboarding === "abre" && p.onboarding_visivel !== totais.onboarding)),
);
conf("porta abre ⇒ RLS entrega a tabela inteira", divergencias.length === 0, {
  divergencias: divergencias.map((d) => d.perfil),
  totais,
});

r.tempos = tempos;
mkdirSync(SAIDA, { recursive: true });
const arq = `${SAIDA}/resultado-${agora.slice(0, 16).replace(/[:T]/g, "")}.json`;
writeFileSync(arq, JSON.stringify(r, null, 2));
console.log("gravado", arq);
