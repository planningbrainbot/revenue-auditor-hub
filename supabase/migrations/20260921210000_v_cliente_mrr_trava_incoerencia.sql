-- Trava de coerência no MRR vindo do Pipefy (21/09/2026)
--
-- Assim que o sync passou a ler "Honorário Médio mensal do contrato", um card
-- sozinho levou o MRR do Pipefy na tela para R$ 13,6 milhões: o card 1440464579
-- (GRUPO MAGANHA, Patos de Minas) tem **12.900.000,00** digitado no mensal e
-- 154.800,00 no total do contrato. O total é 12.900 × 12, então o mensal certo
-- é R$ 12.900 e o card tem três zeros a mais. É erro de digitação no Pipefy,
-- não de leitura — o valor cru foi conferido na API.
--
-- A trava não é limite arbitrário, é coerência interna do próprio card: valor
-- mensal não pode ser maior que o valor total do contrato. Medido sobre os 166
-- cards que têm os dois campos, 159 batem com total ÷ 12 e apenas 2 violam a
-- regra. Um deles (Nohraan Distribuidora) tem total zerado, que é campo não
-- preenchido e não incoerência — por isso a trava só vale quando o total é
-- maior que zero.
--
-- Card travado não vira zero: ele apenas deixa de responder, e a cascata segue
-- para o Pipedrive. É o comportamento certo para dado que não se sustenta.

set search_path to ops, public;

create or replace view v_cliente_mrr as
with omie as (
  select
    cnpj_digitos as cnpj,
    sum(valor_mensal) as valor,
    count(*) as contratos
  from omie_contratos_servico
  where situacao = '10'
    and coalesce(valor_mensal, 0) > 0
    and cnpj_digitos <> ''
  group by 1
),
pipefy_cards as (
  select
    id,
    empresa_id,
    pipedrive_deal_id,
    mrr_mensal,
    data_assinatura,
    data_venda
  from contratos_documentos
  where coalesce(mrr_mensal, 0) > 0
    and coalesce(tipo, '') <> 'Distrato'
    and coalesce(fase_atual, '') <> 'Churn no Contrato'
    -- Coerência interna: mensal maior que o contrato inteiro é digitação.
    and not (
      coalesce(valor_total_contrato, 0) > 0
      and mrr_mensal > valor_total_contrato
    )
),
pipefy as (
  select distinct on (empresa_id)
    empresa_id,
    mrr_mensal as valor,
    data_assinatura
  from pipefy_cards
  where empresa_id is not null
  order by empresa_id, coalesce(data_assinatura, data_venda) desc nulls last, id desc
),
pipefy_por_deal as (
  select distinct on (pipedrive_deal_id)
    pipedrive_deal_id,
    mrr_mensal as valor,
    data_assinatura
  from pipefy_cards
  where pipedrive_deal_id is not null
  order by pipedrive_deal_id, coalesce(data_assinatura, data_venda) desc nulls last, id desc
),
pipedrive as (
  select
    pipedrive_deal_id,
    sum(mrr_mensal) as valor,
    max(entrada_contrato_assinado_em) as data_assinatura
  from contratos
  where status_contrato = 'Ativo'
    and pipedrive_deal_id is not null
  group by 1
)
select
  e.id as empresa_id,
  e.unidade,
  e.pipedrive_id,
  coalesce(o.valor, pe.valor, pd.valor, pv.valor) as mrr_mensal,
  case
    when o.valor  is not null then 'omie'
    when pe.valor is not null then 'pipefy'
    when pd.valor is not null then 'pipefy'
    when pv.valor is not null then 'pipedrive'
  end as mrr_fonte,
  coalesce(pe.data_assinatura, pd.data_assinatura, pv.data_assinatura) as data_assinatura,
  case
    when pe.data_assinatura is not null or pd.data_assinatura is not null then 'pipefy'
    when pv.data_assinatura is not null then 'pipedrive'
  end as data_assinatura_fonte,
  o.valor as mrr_omie,
  coalesce(pe.valor, pd.valor) as mrr_pipefy,
  pv.valor as mrr_pipedrive,
  o.contratos as omie_contratos_ativos
from empresas e
left join omie o
  on o.cnpj = regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')
 and regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g') <> ''
left join pipefy pe on pe.empresa_id = e.id
left join pipefy_por_deal pd on pd.pipedrive_deal_id = e.pipedrive_id
left join pipedrive pv on pv.pipedrive_deal_id = e.pipedrive_id;

alter view v_cliente_mrr set (security_invoker = true);
grant select on v_cliente_mrr to authenticated;
grant select on v_cliente_mrr to service_role;

notify pgrst, 'reload schema';
