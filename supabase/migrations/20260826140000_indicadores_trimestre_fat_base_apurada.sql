-- Indicadores do Trimestre — faturamento e take rate passam a sair da apuração de royalties
--
-- Problema (achado no RJ, Q2/2026): o card "Faturamento base nova" somava `contas_receber`
-- por `data_competencia` e valor BRUTO (R$ 1.924.338), enquanto a unidade lê o faturamento
-- na base apurada de royalties (R$ 1.529.024) — recebido LÍQUIDO, por caixa, com os ajustes
-- manuais da apuração. Gap de 25,9%. Pior: o take rate dividia um numerador da apuração
-- (royalties + CSC, caixa/líquido/ajustado) por um denominador de competência/bruto — duas
-- réguas diferentes no mesmo percentual.
--
-- Decisão 26/08/2026: `fat_base_nova` e `take_rate_pct` passam a usar `royalties_apuracao`,
-- a mesma fonte do numerador. Consequências conhecidas e aceitas:
--   * O número é o que a unidade vê e assina na apuração — inclui os ajustes manuais
--     (no RJ jun/2026, 26 itens editados para baixo por backlog de emissão de maio).
--   * Mês sem apuração confirmada não entra: `fat_base_nova` fica NULL em vez de virar um
--     número Omie que ninguém conciliou. `meses_apurados` diz quantos dos 3 entraram.
--   * `fat_total` = base nova + base antiga apuradas (Patos é a única com base antiga).
--   * `data_competencia` sai de vez do cálculo — DATA-RULES 25/08/2026 já marcava o campo
--     como inconfiável (no RJ: abr 719k / mai 94k / jun 1.110k, distribuição impossível).
--   * Corrige de tabela as unidades que hoje aparecem sem faturamento por falha de join ou
--     CNPJ ausente nos itens: Patos, São Luís, Fortaleza e Maceió passam a exibir número.
--
-- `clientes_base_nova`, churn, inadimplência e estoque continuam vindo do Omie — não são
-- faturamento e a apuração não tem granularidade de CNPJ confiável em todas as unidades
-- (Patos, Fortaleza e Maceió gravam item sem CNPJ).

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
set search_path to 'public'
as $function$
  with guard as (
    select case when public.can('view.indicadores_trimestre') then true else (select null::boolean) end ok
  ),
  antiga as (
    select a.unidade_id, regexp_replace(i.cnpj,'\D','','g') cnpj
    from royalties_itens i join royalties_apuracao a on a.id=i.apuracao_id
    where i.cnpj is not null
      and (i.motivo_exclusao ilike '%base antiga%' or i.motivo_exclusao ilike '%anterior a 04/2025%')
    group by 1,2
  ),
  nova as (
    select a.unidade_id, regexp_replace(i.cnpj,'\D','','g') cnpj
    from royalties_itens i join royalties_apuracao a on a.id=i.apuracao_id
    where i.cnpj is not null and i.categoria='royalties'
      and (i.excluido_em is null or i.motivo_exclusao ilike '%Cancelado no Omie%')
    group by 1,2
    except select unidade_id, cnpj from antiga
  ),
  apur as (
    select a.unidade_id,
      sum(a.royalties_valor + coalesce(a.csc_valor_fixo,0) + coalesce(a.csc_base_antiga_valor,0)) roy_csc,
      sum(coalesce(a.csc_trafego_pago,0)) midia,
      sum(a.receita_base) base_nova,
      sum(coalesce(a.receita_base_antiga,0)) base_antiga,
      count(*)::integer meses
    from royalties_apuracao a
    where a.status='confirmado' and a.mes_referencia between _ini and _fim group by 1
  ),
  vendas as (
    select u.id unidade_id, count(*)::integer n, sum(c.mrr_mensal) mrr, sum(c.valor_total) v12
    from contratos c join unidades u on c.unidade ilike '%'||u.nome_da_praca||'%'
    where c.ganho_em between _ini and _fim group by 1
  ),
  fat as (
    select u.id unidade_id,
      bool_or(true) tem_omie,
      count(distinct cr.cpf_cnpj) filter (where n.cnpj is not null)::integer cli_nova
    from contas_receber cr join unidades u on cr.unidade ilike '%'||u.nome_da_praca||'%'
    left join nova n on n.unidade_id=u.id and n.cnpj=regexp_replace(cr.cpf_cnpj,'\D','','g')
    where cr.data_competencia between _ini and _fim and cr.status_pagamento<>'CANCELADO' group by 1
  ),
  inad as (
    select u.id unidade_id,
      sum(cr.valor) filter (where cr.status_pagamento<>'CANCELADO') a_cobrar,
      sum(cr.valor) filter (where cr.status_pagamento='ATRASADO') aberto
    from contas_receber cr join unidades u on cr.unidade ilike '%'||u.nome_da_praca||'%'
    where cr.data_vencimento between _ini and _fim group by 1
  ),
  estoque as (
    select u.id unidade_id, sum(cr.valor) aberto,
      sum(cr.valor) filter (where current_date - cr.data_vencimento > 365) mais_1ano
    from contas_receber cr join unidades u on cr.unidade ilike '%'||u.nome_da_praca||'%'
    where cr.status_pagamento='ATRASADO' group by 1
  ),
  churn_pipefy as (
    select u.id unidade_id, count(*)::integer n, sum(t.mrr) mrr
    from central_tratativas t join unidades u on t.unidade ilike '%'||u.nome_da_praca||'%'
    where t.data_churn between _ini and _fim group by 1
  ),
  ult_fat as (
    select u.id unidade_id, regexp_replace(cr.cpf_cnpj,'\D','','g') cnpj, max(cr.data_competencia) ultima
    from contas_receber cr join unidades u on cr.unidade ilike '%'||u.nome_da_praca||'%'
    join nova n on n.unidade_id=u.id and n.cnpj=regexp_replace(cr.cpf_cnpj,'\D','','g')
    where cr.status_pagamento<>'CANCELADO' group by 1,2
  ),
  churn_fat as (
    select uf.unidade_id, count(*)::integer n,
      sum((select sum(cr2.valor) from contas_receber cr2
           join unidades u2 on cr2.unidade ilike '%'||u2.nome_da_praca||'%'
           where u2.id=uf.unidade_id
             and regexp_replace(cr2.cpf_cnpj,'\D','','g')=uf.cnpj
             and cr2.status_pagamento<>'CANCELADO'
             and date_trunc('month',cr2.data_competencia)=date_trunc('month',uf.ultima))) mrr
    from ult_fat uf where uf.ultima between _ini and _fim group by 1
  )
  select u.id, u.nome_da_praca, u.data_inauguracao, coalesce(apur.meses,0),
    coalesce(fat.tem_omie,false),
    round(apur.base_nova,2), round(apur.base_nova + apur.base_antiga,2),
    coalesce(fat.cli_nova,0), round(inad.a_cobrar,2), round(coalesce(inad.aberto,0),2),
    round(100.0*coalesce(inad.aberto,0)/nullif(inad.a_cobrar,0),2), round(apur.roy_csc,2),
    round(100.0*apur.roy_csc/nullif(apur.base_nova,0),2), round(apur.midia,2),
    coalesce(v.n,0), round(v.mrr,2), round(v.mrr/nullif(v.n,0),2), round(v.mrr*12,2),
    round(v.mrr*60,2), round(v.v12/nullif(apur.midia,0),2),
    coalesce(cp.n,0), round(coalesce(cp.mrr,0),2), coalesce(cf.n,0), round(coalesce(cf.mrr,0),2),
    round(coalesce(e.aberto,0),2), round(coalesce(e.mais_1ano,0),2)
  from unidades u cross join guard g
  left join apur on apur.unidade_id=u.id
  left join vendas v on v.unidade_id=u.id
  left join fat on fat.unidade_id=u.id
  left join inad on inad.unidade_id=u.id
  left join estoque e on e.unidade_id=u.id
  left join churn_pipefy cp on cp.unidade_id=u.id
  left join churn_fat cf on cf.unidade_id=u.id
  where u.tipo='regional' and g.ok
  order by u.id;
$function$;
