// Homologação SOMENTE LEITURA do tema Ter · Financeiro e Operações do Cockpit do COO.
//
// Monta a leitura com o mesmo `montarFinanceiroOperacoes` da tela, a partir dos dados de hoje, e
// confere cada número contra SQL independente. Duas fontes:
// - Financial Brain (itpddzjfrgrbathcqbpo): as mesmas RPCs que o servidor chama, como postgres —
//   é o que o COO veria se a porta do Financeiro abrisse (hoje ela está fechada para ele);
// - banco único (npknehhyyzelmrbbxvtu): com a sessão do COO (RLS dele), como a tela lê.
// Tudo dentro de `begin transaction read only`. O token vem de SUPABASE_ACCESS_TOKEN no ambiente e
// nunca é impresso. A saída é agregada: unidades e totais, nenhum cliente.
//
// Uso: SUPABASE_ACCESS_TOKEN=… node scripts/cockpit-coo/homologar-financeiro-operacoes.mjs [AAAA-MM-DD]
import { consultar } from "../cockpit-ceo/brain-ro.mjs";
import {
  montarFinanceiroOperacoes,
  extrairCaixaLivre,
  extrairFluxo,
  extrairDre,
  extrairExposicao,
  janelasFinanceiro,
  fimDoMes,
  mesesAte,
  somarDias,
} from "../../src/lib/cockpit-coo/temas/financeiro-operacoes.ts";
import { lerUnidades } from "../../src/lib/cockpit-coo/unidades.ts";
import { mesAnterior } from "../../src/lib/cockpit-coo/montar.ts";

const FIN = "itpddzjfrgrbathcqbpo";
const OPS = "npknehhyyzelmrbbxvtu";
const COO = "acf379ff-3674-4545-86b7-79e0a18360eb";
const hoje =
  process.argv[2] ??
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const fin = (sql) => consultar(sql, { ref: FIN, transacaoSomenteLeitura: true });
const comoCoo = (sql) =>
  consultar(
    `set local role authenticated; set local request.jwt.claims to '{"sub":"${COO}","role":"authenticated"}'; ${sql}`,
    { ref: OPS, transacaoSomenteLeitura: true },
  );
const q = (s) => `'${s}'`;

const j = janelasFinanceiro(hoje);
const fechado = mesAnterior(hoje.slice(0, 7));

// ── Leitura (as mesmas chamadas do servidor) ──────────────────────────────────────────────────
console.log(`Homologação Financeiro e Operações · hoje ${hoje}`);
const ate30 = somarDias(hoje, 29);
// A exposição e a conferência dela saem na MESMA consulta: os títulos são sincronizados ao vivo, e
// em 29/09 uma baixa entre duas chamadas deu R$ 9.385,00 de diferença que não era do cálculo.
const [saldosCru, fluxoCru, dreCru, expCru] = await Promise.all([
  fin(`select m, public.fn_cockpit_caixa_livre(null,null,null, (m||'-01')::date, (date_trunc('month',(m||'-01')::date) + interval '1 month - 1 day')::date) r
       from unnest(array[${j.saldoMeses.map(q).join(",")}]) m`),
  fin(`select public.fn_dfc_matriz_calcular(p_comp_de=>${q(j.fluxo.de)}::date, p_comp_ate=>${q(j.fluxo.ate)}::date, p_nivel_max=>1) r`),
  fin(`select public.fn_dre_comp_caixa(p_comp_de=>${q(j.dre.de)}::date, p_comp_ate=>${q(j.dre.ate)}::date, p_nivel_max=>1) r`),
  fin(`
  with rpc as (select public.fn_aprovacoes_caixa(null,null,${q(j.exposicao.competencia)}::date,${q(j.exposicao.ate)}::date,${q(j.exposicao.de)}::date) r),
  alvo as (select id from public.empresas where ativa),
  s as (select coalesce(sum(s.saldo_final), 0) v from public.saldo_abertura s join alvo a on a.id = s.empresa_id
         where s.competencia = (select (r->>'competencia')::date from rpc)),
  r as (select coalesce(sum(t.valor_aberto), 0) v from public.titulos_receber_live t join alvo a on a.id = t.empresa_id
         where t.data_vencimento is null or t.data_vencimento between ${q(hoje)} and ${q(ate30)}),
  p as (select coalesce(sum(t.valor_aberto), 0) v from public.titulos_pagar_live t join alvo a on a.id = t.empresa_id
         where t.data_vencimento is null or t.data_vencimento between ${q(hoje)} and ${q(ate30)}),
  vp as (select coalesce(sum(t.valor_aberto), 0) v from public.titulos_pagar_live t join alvo a on a.id = t.empresa_id
          where t.data_vencimento < ${q(hoje)}),
  vr as (select coalesce(sum(t.valor_aberto), 0) v from public.titulos_receber_live t join alvo a on a.id = t.empresa_id
          where t.data_vencimento < ${q(hoje)})
  select (select r from rpc) r, round(s.v, 2) saldo, round(r.v, 2) receber, round(p.v, 2) pagar,
         round(s.v + r.v - p.v, 2) previsto, round(vp.v, 2) vencido_pagar, round(vr.v, 2) vencido_receber
    from s, r, p, vp, vr`),
]);
const indExp = expCru[0];
const saldoMeses = saldosCru.map((x) => extrairCaixaLivre(x.m, x.r));
const exposicao = extrairExposicao(expCru[0].r);

const de = `${mesesAte(fechado, 12)[0]}-01`;
const [cadastro, apur, fat, cards] = await Promise.all([
  comoCoo(`select id, nome_da_praca, tipo, data_inauguracao from ops.unidades order by id`),
  comoCoo(`select unidade_id, mes_referencia, status, royalties_valor, csc_valor_fixo, csc_base_antiga_valor, total_fatura, updated_at
           from ops.royalties_apuracao where mes_referencia >= ${q(de)} and mes_referencia < ${q(hoje.slice(0, 7) + "-01")} order by id`),
  comoCoo(`select f.unidade_id, f.competencia, f.status, f.valor_total, f.vence_em,
             (select json_build_object('status', c.status_pagamento, 'vencimento', c.data_vencimento, 'pagoEm', c.data_pagamento)
                from ops.contas_receber c
               where c.unidade = 'Partners'
                 and (c.codigo_omie = f.cod_titulo
                      or (f.cod_titulo is null and c.data_vencimento = f.vence_em and c.valor = f.valor_total and c.status_pagamento <> 'CANCELADO'))
               order by (c.codigo_omie = f.cod_titulo) desc nulls last, c.id limit 1) titulo
           from ops.royalties_faturas f order by f.id`),
  comoCoo(`select fase_atual, unidade, entrou_fase_atual_em, concluido, synced_at from ops.cs_onboarding_cards order by pipefy_card_id`),
]);
const unidades = lerUnidades(cadastro);
const N = (x) => (x === null || x === undefined ? null : Number(x));
const dados = {
  lidoEm: new Date().toISOString(),
  saldo: { ok: true, meses: saldoMeses },
  fluxo: { ok: true, meses: extrairFluxo(fluxoCru[0].r), janela: j.fluxo },
  exposicao: { ok: true, dado: exposicao },
  dre: { ok: true, ...extrairDre(dreCru[0].r) },
  repasse: {
    ok: true,
    apuracoes: apur.map((a) => ({
      unidadeId: a.unidade_id,
      mes: String(a.mes_referencia).slice(0, 7),
      status: a.status,
      royalties: N(a.royalties_valor),
      cscFixo: N(a.csc_valor_fixo),
      cscBaseAntiga: N(a.csc_base_antiga_valor),
      total: N(a.total_fatura),
      atualizadoEm: a.updated_at,
    })),
    faturas: {
      ok: true,
      linhas: fat.map((f) => ({
        unidadeId: f.unidade_id,
        competencia: String(f.competencia).slice(0, 7),
        status: f.status,
        valor: Number(f.valor_total),
        venceEm: f.vence_em,
        titulo: f.titulo,
      })),
    },
  },
  onboarding: {
    ok: true,
    atualizadoEm: cards.map((c) => c.synced_at).filter(Boolean).sort().at(-1) ?? null,
    cards: cards.map((c) => ({
      fase: String(c.fase_atual ?? "").trim(),
      unidade: c.unidade,
      entrouNaFase: c.entrou_fase_atual_em,
      concluido: c.concluido === true,
    })),
  },
};
const leitura = montarFinanceiroOperacoes(dados, unidades, "", hoje);
const n = (id) => leitura.numeros.find((x) => x.id === id);

// ── SQL independente ─────────────────────────────────────────────────────────────────────────
const [indSaldo] = await fin(`
  with emp as (select id from public.empresas where entra_no_fechamento),
  ref as (select max(s.competencia) m from public.saldo_abertura s join emp on emp.id = s.empresa_id
           where s.saldo_final is not null and s.competencia <= date_trunc('month', ${q(hoje)}::date))
  select round(sum(s.saldo_final), 2) saldo, count(*) com_saldo, (select count(*) from emp) escopo,
         min(substring(s.fonte from '@(\\d{4}-\\d{2}-\\d{2})')) foto_mais_antiga
    from public.saldo_abertura s join emp on emp.id = s.empresa_id, ref
   where s.competencia = ref.m and s.saldo_final is not null`);
// Aritmética do cockpit (média, fôlego, acumulado, projeção) refeita em SQL sobre o payload das RPCs.
const [indRitmo] = await fin(`
  with dfc as (select public.fn_dfc_matriz_calcular(p_comp_de=>${q(j.fluxo.de)}::date, p_comp_ate=>${q(j.fluxo.ate)}::date, p_nivel_max=>1) r),
  f as (select k::date m, (v->>'total_geral')::numeric t from dfc, jsonb_each(r->'totais') e(k, v)
         where k in (select jsonb_array_elements_text(r->'cobertura'->'meses_com_dado') from dfc)
           and k not in (select jsonb_array_elements_text(r->'cobertura'->'meses_parciais') from dfc)
         order by 1 desc limit 3),
  dre as (select public.fn_dre_comp_caixa(p_comp_de=>${q(j.dre.de)}::date, p_comp_ate=>${q(j.dre.ate)}::date, p_nivel_max=>1) r),
  d as (select k::date m, v::numeric t from dre, jsonb_each_text(r->'total_geral'->'valores') e(k, v)
         where k not in (select jsonb_array_elements_text(r->'cobertura'->'meses_parciais') from dre)),
  d3 as (select * from d order by m desc limit 3),
  ano as (select coalesce(sum(t), 0) acum, max(m) ult from d where extract(year from m) = extract(year from ${q(hoje)}::date))
  select round(avg(f.t), 2) media_fluxo, (select round(acum, 2) from ano) acumulado_dre,
         (select round((select acum from ano) + (select avg(t) from d3) * (12 - extract(month from (select ult from ano))), 2)) projecao_dre
    from f`);
const [indOps] = await comoCoo(`
  select
   (select round(sum(coalesce(a.royalties_valor,0) + coalesce(a.csc_valor_fixo,0) + coalesce(a.csc_base_antiga_valor,0)), 2)
      from ops.royalties_apuracao a join ops.unidades u on u.id = a.unidade_id
     where u.tipo = 'regional' and u.data_inauguracao is not null and a.status in ('confirmado','faturado')
       and a.royalties_valor is not null and a.mes_referencia = ${q(fechado + "-01")}) repasse,
   (select count(*) from ops.unidades u where u.tipo = 'regional' and u.data_inauguracao is not null) em_operacao,
   (select count(*) from ops.cs_onboarding_cards c
     where not coalesce(c.concluido, false) and c.fase_atual not in ('Concluído','Churn no Onboarding')
       and ${q(hoje)}::date - (c.entrou_fase_atual_em at time zone 'America/Sao_Paulo')::date > 30) onboarding_parado,
   (select string_agg(u.nome_da_praca, ', ' order by u.nome_da_praca)
      from ops.royalties_apuracao a join ops.unidades u on u.id = a.unidade_id
     where u.tipo = 'regional' and a.status in ('confirmado','faturado') and a.mes_referencia = ${q(fechado + "-01")}
       and not exists (select 1 from ops.royalties_faturas f where f.unidade_id = a.unidade_id and f.competencia = a.mes_referencia)) sem_fatura,
   (select string_agg(distinct u.nome_da_praca, ', ')
      from ops.royalties_faturas f join ops.unidades u on u.id = f.unidade_id
      left join ops.contas_receber c on c.unidade = 'Partners' and (c.codigo_omie = f.cod_titulo
           or (f.cod_titulo is null and c.data_vencimento = f.vence_em and c.valor = f.valor_total and c.status_pagamento <> 'CANCELADO'))
     where f.status not in ('erro','cancelada') and coalesce(c.status_pagamento, '') <> 'RECEBIDO'
       and coalesce(c.data_vencimento, f.vence_em) < ${q(somarDias(hoje, -15))}::date) nao_recebido_15d`);

// ── Comparação ───────────────────────────────────────────────────────────────────────────────
const linhas = [];
const conf = (nome, cockpit, sql) => {
  const bate = cockpit === sql || (typeof cockpit === "number" && typeof sql === "number" && Math.abs(cockpit - sql) < 0.005);
  linhas.push({ numero: nome, cockpit, sql, bate: bate ? "sim" : "NÃO" });
};
const num = (x) => (x === null || x === undefined ? null : Number(x));
conf("Saldo em caixa", n("saldo-caixa").valor, num(indSaldo.saldo));
conf("Saldo · foto mais antiga", n("saldo-caixa").dataDado, indSaldo.foto_mais_antiga);
conf("Geração de caixa (média 3m)", n("geracao-caixa").valor, num(indRitmo.media_fluxo));
conf("Exposição em 30 dias", n("exposicao-30d").valor, num(indExp.previsto));
conf("Exposição · a receber", exposicao.aReceber, num(indExp.receber));
conf("Exposição · a pagar", exposicao.aPagar, num(indExp.pagar));
conf("Vencido a pagar (gaveta)", exposicao.vencidoAPagar.valor, num(indExp.vencido_pagar));
conf("Vencido a receber (gaveta)", exposicao.vencidoAReceber.valor, num(indExp.vencido_receber));
conf("DRE acumulado no ano", n("resultado-dre").valor, num(indRitmo.acumulado_dre));
conf(`Repasse da rede ${fechado}`, n("repasse-rede").valor, num(indOps.repasse));
conf("Onboarding parado > 30 dias", n("onboarding-parado").valor, num(indOps.onboarding_parado));
const semFat = leitura.alertas.filter((a) => a.regra === "apuracao-sem-fatura").map((a) => a.unidade).sort().join(", ");
conf("Alerta · apuração sem fatura", semFat || null, indOps.sem_fatura ?? null);
const nr = leitura.alertas.filter((a) => a.regra === "faturado-nao-recebido").map((a) => a.unidade).sort().join(", ");
conf("Alerta · não recebido > 15 dias", nr || null, indOps.nao_recebido_15d ?? null);
console.table(linhas);

console.log("\nNúmeros (todas as unidades):");
for (const x of leitura.numeros)
  console.log(`- ${x.rotulo}: ${x.valor === null ? `— (${x.estado}: ${x.motivo})` : x.valor} [${x.estado}] · ${x.nota ?? ""}`);
console.log(`  Projeção DRE recalculada em SQL: ${indRitmo.projecao_dre}`);
console.log("\nAlertas:");
for (const a of leitura.alertas) console.log(`- [${a.gravidade}] ${a.titulo} (peso ${a.peso}) · ${a.chave}`);
console.log("\nGráficos:", leitura.graficos.map((g) => `${g.titulo} [${g.estado}]`).join(" | "));
console.log("Avisos:", leitura.avisos.join(" | ") || "—");
const falhas = linhas.filter((l) => l.bate !== "sim");
if (falhas.length) {
  console.error(`\n${falhas.length} conferência(s) não bateram.`);
  process.exitCode = 1;
} else console.log(`\n${linhas.length} de ${linhas.length} conferências bateram. Janela do fluxo: ${j.fluxo.de} a ${j.fluxo.ate}; DRE ${j.dre.de} a ${j.dre.ate}; fim do mês fechado ${fimDoMes(fechado)}.`);
