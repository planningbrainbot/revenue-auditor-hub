-- Indicadores do Trimestre por Unidade
--
-- Alimenta a página /indicadores-trimestre, que reproduz os dois slides do deck de
-- Expansão ("Indicadores financeiros do trimestre" e "Performance comercial do trimestre")
-- para todas as unidades regionais.
--
-- Regras de dado aplicadas (ver DATA-RULES.md, decisões de 25/08/2026):
--   * Inadimplência é cortada por `data_vencimento`, NUNCA por `data_competencia`
--     (233 títulos de Curitiba têm competência gravada >60 dias depois do vencimento).
--   * Receita anualizada = MRR das vendas do período x 12; LTV = MRR x 60 (régua do
--     Power BI "Mkt e Vendas – BUs", que é a fonte oficial dos cards do deck).
--   * Royalties + CSC soma `csc_valor_fixo` E `csc_base_antiga_valor`: Patos grava a
--     mesma taxa de 4% em colunas diferentes dependendo do mês.
--   * Base nova = CNPJ com item não-excluído em qualquer apuração da unidade, menos os
--     marcados como base antiga. Usar só a última apuração derruba cliente que
--     simplesmente não pagou naquele mês (a apuração é por caixa).

create or replace function public.indicadores_trimestre(_ini date, _fim date)
returns table (
  unidade_id integer,
  unidade text,
  data_inauguracao date,
  meses_apurados integer,
  tem_omie boolean,
  fat_base_nova numeric,
  fat_total numeric,
  clientes_base_nova integer,
  inad_a_cobrar numeric,
  inad_aberto numeric,
  inad_pct numeric,
  roy_csc numeric,
  take_rate_pct numeric,
  midia numeric,
  novos_contratos integer,
  mrr_vendido numeric,
  ticket_medio numeric,
  receita_anualizada numeric,
  receita_bookada_ltv numeric,
  roas numeric,
  churn_pipefy_n integer,
  churn_pipefy_mrr numeric,
  churn_faturamento_n integer,
  churn_faturamento_mrr numeric,
  estoque_aberto numeric,
  estoque_mais_1ano numeric
)
language sql
security definer
set search_path = public
as $$
  with guard as (
    select case when public.can('view.indicadores_trimestre')
                then true
                else (select null::boolean) end ok
  ),
  antiga as (
    select a.unidade_id, regexp_replace(i.cnpj, '\D', '', 'g') cnpj
    from royalties_itens i
    join royalties_apuracao a on a.id = i.apuracao_id
    where i.cnpj is not null
      and (i.motivo_exclusao ilike '%base antiga%' or i.motivo_exclusao ilike '%anterior a 04/2025%')
    group by 1, 2
  ),
  nova as (
    select a.unidade_id, regexp_replace(i.cnpj, '\D', '', 'g') cnpj
    from royalties_itens i
    join royalties_apuracao a on a.id = i.apuracao_id
    where i.cnpj is not null
      and i.categoria = 'royalties'
      and (i.excluido_em is null or i.motivo_exclusao ilike '%Cancelado no Omie%')
    group by 1, 2
    except
    select unidade_id, cnpj from antiga
  ),
  apur as (
    select a.unidade_id,
      sum(a.royalties_valor + coalesce(a.csc_valor_fixo, 0) + coalesce(a.csc_base_antiga_valor, 0)) roy_csc,
      sum(coalesce(a.csc_trafego_pago, 0)) midia,
      count(*)::integer meses
    from royalties_apuracao a
    where a.status = 'confirmado' and a.mes_referencia between _ini and _fim
    group by 1
  ),
  vendas as (
    select u.id unidade_id, count(*)::integer n, sum(c.mrr_mensal) mrr, sum(c.valor_total) v12
    from contratos c
    join unidades u on c.unidade ilike '%' || u.nome_da_praca || '%'
    where c.ganho_em between _ini and _fim
    group by 1
  ),
  fat as (
    select u.id unidade_id,
      sum(cr.valor) filter (where cr.status_pagamento <> 'CANCELADO' and n.cnpj is not null) fat_nova,
      sum(cr.valor) filter (where cr.status_pagamento <> 'CANCELADO') fat_total,
      count(distinct cr.cpf_cnpj) filter (where n.cnpj is not null)::integer cli_nova
    from contas_receber cr
    join unidades u on cr.unidade ilike '%' || u.nome_da_praca || '%'
    left join nova n on n.unidade_id = u.id and n.cnpj = regexp_replace(cr.cpf_cnpj, '\D', '', 'g')
    where cr.data_competencia between _ini and _fim
    group by 1
  ),
  -- inadimplência SEMPRE por data_vencimento
  inad as (
    select u.id unidade_id,
      sum(cr.valor) filter (where cr.status_pagamento <> 'CANCELADO') a_cobrar,
      sum(cr.valor) filter (where cr.status_pagamento = 'ATRASADO') aberto
    from contas_receber cr
    join unidades u on cr.unidade ilike '%' || u.nome_da_praca || '%'
    where cr.data_vencimento between _ini and _fim
    group by 1
  ),
  -- estoque de aging: independe do trimestre, é a foto de hoje
  estoque as (
    select u.id unidade_id,
      sum(cr.valor) aberto,
      sum(cr.valor) filter (where current_date - cr.data_vencimento > 365) mais_1ano
    from contas_receber cr
    join unidades u on cr.unidade ilike '%' || u.nome_da_praca || '%'
    where cr.status_pagamento = 'ATRASADO'
    group by 1
  ),
  churn_pipefy as (
    select u.id unidade_id, count(*)::integer n, sum(t.mrr) mrr
    from central_tratativas t
    join unidades u on t.unidade ilike '%' || u.nome_da_praca || '%'
    where t.data_churn between _ini and _fim
    group by 1
  ),
  -- churn medido pelo faturamento: cliente da base nova cuja última fatura caiu no período
  ult_fat as (
    select u.id unidade_id,
      regexp_replace(cr.cpf_cnpj, '\D', '', 'g') cnpj,
      max(cr.data_competencia) ultima
    from contas_receber cr
    join unidades u on cr.unidade ilike '%' || u.nome_da_praca || '%'
    join nova n on n.unidade_id = u.id and n.cnpj = regexp_replace(cr.cpf_cnpj, '\D', '', 'g')
    where cr.status_pagamento <> 'CANCELADO'
    group by 1, 2
  ),
  churn_fat as (
    select uf.unidade_id, count(*)::integer n,
      sum((
        select sum(cr2.valor) from contas_receber cr2
        join unidades u2 on cr2.unidade ilike '%' || u2.nome_da_praca || '%'
        where u2.id = uf.unidade_id
          and regexp_replace(cr2.cpf_cnpj, '\D', '', 'g') = uf.cnpj
          and cr2.status_pagamento <> 'CANCELADO'
          and date_trunc('month', cr2.data_competencia) = date_trunc('month', uf.ultima)
      )) mrr
    from ult_fat uf
    where uf.ultima between _ini and _fim
    group by 1
  )
  select
    u.id,
    u.nome_da_praca,
    u.data_inauguracao,
    coalesce(apur.meses, 0),
    (fat.fat_total is not null),
    round(fat.fat_nova, 2),
    round(fat.fat_total, 2),
    coalesce(fat.cli_nova, 0),
    round(inad.a_cobrar, 2),
    round(coalesce(inad.aberto, 0), 2),
    round(100.0 * coalesce(inad.aberto, 0) / nullif(inad.a_cobrar, 0), 2),
    round(apur.roy_csc, 2),
    round(100.0 * apur.roy_csc / nullif(fat.fat_nova, 0), 2),
    round(apur.midia, 2),
    coalesce(v.n, 0),
    round(v.mrr, 2),
    round(v.mrr / nullif(v.n, 0), 2),
    round(v.mrr * 12, 2),
    round(v.mrr * 60, 2),
    round(v.v12 / nullif(apur.midia, 0), 2),
    coalesce(cp.n, 0),
    round(coalesce(cp.mrr, 0), 2),
    coalesce(cf.n, 0),
    round(coalesce(cf.mrr, 0), 2),
    round(coalesce(e.aberto, 0), 2),
    round(coalesce(e.mais_1ano, 0), 2)
  from unidades u
  cross join guard g
  left join apur on apur.unidade_id = u.id
  left join vendas v on v.unidade_id = u.id
  left join fat on fat.unidade_id = u.id
  left join inad on inad.unidade_id = u.id
  left join estoque e on e.unidade_id = u.id
  left join churn_pipefy cp on cp.unidade_id = u.id
  left join churn_fat cf on cf.unidade_id = u.id
  where u.tipo = 'regional' and g.ok
  order by u.id;
$$;

revoke execute on function public.indicadores_trimestre(date, date) from public, anon;
grant execute on function public.indicadores_trimestre(date, date) to authenticated;

comment on function public.indicadores_trimestre(date, date) is
  'Indicadores trimestrais por unidade regional para a página /indicadores-trimestre. '
  'SECURITY DEFINER com guarda interna em public.can(''view.indicadores_trimestre'') — '
  'retorna zero linhas para quem não tem a permissão, sem depender de RLS das tabelas base.';

-- Semente de permissão: mesmo padrão de view.ebit_operacional (admin + diretor liberados).
-- Sem estas linhas public.can() devolve false para todo mundo — inclusive admin, que não
-- tem bypass — e a página abre vazia.
insert into public.role_permissions (role, permission_key, allowed)
values ('admin', 'view.indicadores_trimestre', true),
       ('diretor', 'view.indicadores_trimestre', true)
on conflict (role, permission_key) do update set allowed = excluded.allowed;
