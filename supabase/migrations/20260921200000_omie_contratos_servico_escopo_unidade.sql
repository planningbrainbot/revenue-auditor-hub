-- Escopo de unidade em omie_contratos_servico (21/09/2026)
--
-- A tabela nasceu na mesma sessão em que 15 tabelas ganharam policy
-- RESTRICTIVE de unidade, e nasceu sem uma. Do jeito que estava, sócio
-- regional travado lia o valor mensal de contrato de toda a rede consultando
-- a tabela direto, mesmo sem enxergar o cliente correspondente em `empresas`.
--
-- Por que o escopo NÃO é pela coluna `unidade`, ao contrário das outras 15:
-- aqui `unidade` é o nome do aplicativo Omie, não o da unidade de negócio.
-- Curitiba responde por três contas ("Curitiba", "Planning CWB 01" e
-- "Planning CWB 02") e `norm_unidade` devolve as três diferentes, sem
-- casamento com `unidades.nome_da_praca`. Amarrar por esse nome esconderia de
-- Curitiba a maior parte dos próprios contratos.
--
-- O escopo certo é o do cliente: a linha aparece se o CNPJ dela pertence a uma
-- empresa que a pessoa já pode ver. Como `empresas` tem a sua própria policy
-- RESTRICTIVE de unidade, o EXISTS herda o recorte em vez de repetir a regra,
-- e continua valendo se a regra de lá mudar.

set search_path to ops, public;

-- Coluna gerada em vez de regexp na policy: sem ela o EXISTS não usa índice e
-- vira varredura por linha dos dois lados.
alter table omie_contratos_servico
  add column if not exists cnpj_digitos text
  generated always as (regexp_replace(coalesce(cnpj, ''), '\D', '', 'g')) stored;

create index if not exists omie_contratos_servico_cnpj_digitos_idx
  on omie_contratos_servico (cnpj_digitos);

create index if not exists empresas_cnpj_digitos_idx
  on empresas ((regexp_replace(coalesce(cnpj, ''), '\D', '', 'g')));

drop policy if exists escopo_unidade on omie_contratos_servico;
create policy escopo_unidade on omie_contratos_servico
  as restrictive for all to authenticated
  using (
    (not (select can('data.scope.own_unit_only')))
    or exists (
      select 1 from empresas e
       where regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g') = cnpj_digitos
         and cnpj_digitos <> ''
    )
  );

-- A view passa a usar a coluna gerada dos dois lados do join.
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
pipefy as (
  select distinct on (empresa_id)
    empresa_id,
    mrr_mensal as valor,
    data_assinatura
  from contratos_documentos
  where empresa_id is not null
    and coalesce(mrr_mensal, 0) > 0
    and coalesce(tipo, '') <> 'Distrato'
    and coalesce(fase_atual, '') <> 'Churn no Contrato'
  order by empresa_id, coalesce(data_assinatura, data_venda) desc nulls last, id desc
),
pipefy_por_deal as (
  select distinct on (pipedrive_deal_id)
    pipedrive_deal_id,
    mrr_mensal as valor,
    data_assinatura
  from contratos_documentos
  where pipedrive_deal_id is not null
    and coalesce(mrr_mensal, 0) > 0
    and coalesce(tipo, '') <> 'Distrato'
    and coalesce(fase_atual, '') <> 'Churn no Contrato'
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
