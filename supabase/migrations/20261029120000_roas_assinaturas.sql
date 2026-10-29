-- BI Financeiro, aba "ROAS e assinaturas" (/bi-financeiro?aba=assinaturas, 29/10/2026).
-- Contrato: docs/design/contratos/bi-financeiro.md §7.
--
-- Uma linha por venda do Inside Sales (deal ganho no pipeline Inside Sales desde jan/26) com a
-- data em que o contrato foi assinado. Mesma régua de tools/comissoes_historico_roas.py
-- (planilha validada em 26/10/2026):
--   assinatura = Pipefy Central de Contratos (contratos_documentos.data_assinatura)
--              → entrada no stage 170 do Pipedrive (contratos.entrada_contrato_assinado_em)
--              → Funil de CAC (v_cac_funil_servico.data_assinatura).
--   Nunca a "Data da Venda" (decisão de 21/09/2026).
--   "(cópia)" ganho no mesmo dia que o original é o mesmo cliente contado duas vezes: sai.
-- Só o service_role lê (a server fn confere a área bi_financeiro antes).

create or replace view ops.v_roas_assinaturas as
with doc as (
  select pipedrive_deal_id::text deal,
         min(data_assinatura)::date assinatura,
         string_agg(distinct fase_atual, ', ') fase,
         min(pipefy_card_id::text) card
  from ops.contratos_documentos
  where pipedrive_deal_id is not null
  group by 1),
ct as (
  select distinct on (c.pipedrive_deal_id) c.pipedrive_deal_id::text deal, c.id, c.closer, c.sdr,
         c.unidade, c.entrada_contrato_assinado_em::date assinado_pd
  from ops.contratos c
  where c.pipedrive_deal_id is not null
  order by c.pipedrive_deal_id, c.ganho_em)
select d.deal_id,
       d.title as cliente,
       coalesce(ct.unidade, d.unidade_negocio) as unidade,
       coalesce(ct.closer, d.closer) as closer,
       coalesce(ct.sdr, d.sdr) as sdr,
       (d.won_time at time zone 'America/Sao_Paulo')::date as ganho,
       coalesce(d.mrr_efetivo, d.mrr, 0)::numeric(12,2) as mrr,
       ct.id is not null as tem_contrato,
       coalesce(doc.assinatura, ct.assinado_pd, f.data_assinatura::date) as assinatura,
       case when doc.assinatura is not null then 'Pipefy'
            when ct.assinado_pd is not null then 'Pipedrive (stage 170)'
            when f.data_assinatura is not null then 'Funil de CAC' end as fonte_assinatura,
       doc.fase as fase_contrato,
       doc.card as pipefy_card_id
from growth.deals d
left join ct on ct.deal = d.deal_id::text
left join doc on doc.deal = d.deal_id::text
left join ops.v_cac_funil_servico f on f.contrato_id = ct.id
where d.pipeline = 'Inside Sales' and d.status = 'won' and d.won_time >= '2026-01-01'
  and not (d.title ilike '%(c_pia)' and exists (
        select 1 from growth.deals o
        where o.pipeline = 'Inside Sales' and o.status = 'won' and o.deal_id <> d.deal_id
          and o.title = trim(regexp_replace(d.title, '\s*\(c.pia\)$', ''))
          and o.won_time::date = d.won_time::date));

-- Mídia do Inside Sales por mês (finalidade inside_sales), a mesma da aba Vendas e ROAS.
create or replace view ops.v_roas_midia_inside_sales as
select to_char(data, 'YYYY-MM') as mes, sum(investimento)::numeric(14,2) as midia
from growth.investimento_finalidade_dia
where finalidade = 'inside_sales' and data >= '2026-01-01'
group by 1;

revoke all on ops.v_roas_assinaturas, ops.v_roas_midia_inside_sales from public, anon, authenticated;
grant select on ops.v_roas_assinaturas, ops.v_roas_midia_inside_sales to service_role;

comment on view ops.v_roas_assinaturas is
  'Vendas do Inside Sales (2026) com a data de assinatura do contrato; só service_role (BI Financeiro, aba ROAS e assinaturas).';
comment on view ops.v_roas_midia_inside_sales is
  'Mídia do Inside Sales por mês; só service_role (BI Financeiro, aba ROAS e assinaturas).';

-- Rollback:
-- drop view if exists ops.v_roas_assinaturas;
-- drop view if exists ops.v_roas_midia_inside_sales;
