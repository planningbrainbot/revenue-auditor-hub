-- Corrige a trava do IDU e abre uma porta estreita para o backend da consultoria.
--
-- 1. `ops.idu_pode_ver()` liberava quando `current_user` era `postgres`. Dentro de
--    função SECURITY DEFINER o `current_user` é o dono da função, que é `postgres`,
--    então a trava sempre dava verdadeiro: qualquer usuário logado (Growth, financeiro,
--    login sem papel no Ops) lia o IDU e a apuração de todas as unidades pela API.
--    `session_user` não muda dentro de SECURITY DEFINER: é quem abriu a conexão.
--    Conexão direta (scripts, painel) segue entrando; a API do Ops entra como
--    `authenticator` e passa a depender de `view.idu`, como as telas já conferiam.
-- 2. `ops.ranking_unidades` aceita também a conexão direta e a do backend da
--    consultoria (`consultoria_app`), que não tem usuário logado. Corpo idêntico ao de produção
--    em 08/10/2026; só a linha da guarda muda.
--
-- Achado em 08/10/2026 (PRD da Consultoria de Campo v1, D-06).

create or replace function ops.idu_pode_ver()
returns boolean
language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  -- usuário do app: segue role_permissions. Conexão direta (backoffice/scripts),
  -- service_role pela API e o backend da consultoria enxergam.
  select ops.can('view.idu')
      or session_user in ('postgres', 'supabase_admin', 'consultoria_app')
      or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
$$;

CREATE OR REPLACE FUNCTION ops.ranking_unidades(p_inicio date, p_fim date)
 RETURNS TABLE(ranking text, unidade_id integer, unidade text, valor numeric, valor_secundario numeric, amostra integer, situacao text, posicao integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
with
-- O backend da consultoria (sistema novo) entra sem usuário logado; o usuário da sessão é o dele.
-- Conexão direta (scripts, painel) também enxerga, como no IDU.
guarda as (select (select ops.can('view.ranking_unidades')) or session_user in ('postgres', 'supabase_admin', 'consultoria_app') as ok),
u as (
  select un.id, un.nome_da_praca as nome, ops.norm_unidade(un.nome_da_praca) as k
    from ops.unidades un, guarda g
   where g.ok and un.tipo = 'regional' and coalesce(un.data_inauguracao, un.created_at::date) <= p_fim
),
anterior as (select p_inicio - (p_fim - p_inicio + 1) as ini, p_inicio - 1 as fim),

-- Vendas -------------------------------------------------------------------------------------------------------------
dono as (
  select s.email, ud.nome_da_praca as unidade
    from ops.socios s join ops.unidades ud on ud.id = s.unidade_id
   where s.email is not null
),
vendas as (
  select ops.norm_unidade(coalesce(c.unidade, d.unidade)) as k,
         c.origem_pipeline = 'socios' as de_socio,
         coalesce(c.empresa_id::text, c.pipedrive_deal_id, c.id::text) as cliente,
         c.mrr_mensal
    from ops.contratos c
    left join dono d on c.origem_pipeline = 'socios' and c.unidade is null
                    and lower(d.email) = lower(c.pipedrive_owner_email)
   where c.ganho_em between p_inicio and p_fim
),
vendas_u as (
  select k, de_socio, count(distinct cliente) as clientes, sum(mrr_mensal) as mrr, count(*) as n
    from vendas group by 1, 2
),

-- Carteira ---------------------------------------------------------------------------------------------------------
-- MRR de cada cliente pela cascata Omie > Pipefy > Pipedrive (ops.v_cliente_mrr, decisão de 21/09/2026), um CNPJ uma
-- vez só: a carga do Omie criou empresas com o código no lugar do nome, e o mesmo contrato aparecia em duas (3E, no
-- Rio, contava R$ 33.899 duas vezes). Retrato de hoje: não muda com o trimestre escolhido.
carteira_cli as (
  select ops.norm_unidade(m.unidade) as k,
         coalesce(nullif(regexp_replace(e.cnpj, '\D', '', 'g'), ''), 'e' || m.empresa_id) as cliente,
         max(m.mrr_mensal) as mrr
    from ops.v_cliente_mrr m
    left join ops.empresas e on e.id = m.empresa_id
   where m.mrr_mensal > 0
   group by 1, 2
),
carteira as (select k, count(*) as clientes, sum(mrr) as mrr from carteira_cli group by 1),

-- IDU ----------------------------------------------------------------------------------------------------------------
idu as (select r.unidade_id, r.idu, r.base_efetiva from ops.idu_ranking(p_inicio, p_fim) r),

-- Omie da unidade ----------------------------------------------------------------------------------------------------
titulos as (
  select ops.norm_unidade(cr.unidade) as k, regexp_replace(cr.cpf_cnpj, '\D', '', 'g') as doc,
         cr.data_vencimento, cr.valor, cr.status_pagamento
    from ops.contas_receber cr
   where cr.status_pagamento <> 'CANCELADO'
     and cr.data_vencimento between (select ini from anterior) and p_fim
),
tem_omie as (select distinct k from titulos),
ret as (
  select k,
         count(*) filter (where antes) as base,
         count(*) filter (where antes and agora) as ficaram
    from (
      -- Recorrente é quem teve título em pelo menos 2 meses do período anterior: serviço avulso (IRPF, ITR,
      -- alteração contratual) não é cliente que se perde. Sem esse corte Campo Novo, que vende muito avulso, caía
      -- para 45% no 3º trimestre de 2026.
      select k, doc,
             count(distinct date_trunc('month', data_vencimento))
               filter (where data_vencimento <= (select fim from anterior)) >= 2 as antes,
             bool_or(data_vencimento >= p_inicio) as agora
        from titulos where doc <> '' group by 1, 2
    ) x
   group by 1
),
inad as (
  select k, count(*) as n, sum(valor) as total,
         sum(valor) filter (where status_pagamento <> 'RECEBIDO') as aberto
    from titulos
   where data_vencimento >= p_inicio and data_vencimento <= least(p_fim, current_date - 60)
   group by 1
),

-- NPS ----------------------------------------------------------------------------------------------------------------
nps as (
  select ops.norm_unidade(n.unidade) as k, count(*) as n,
         100.0 * (count(*) filter (where n.nps_recomendacao::int >= 9)
                - count(*) filter (where n.nps_recomendacao::int <= 6)) / count(*) as nota
    from ops.nps_pesquisas n
   where n.nps_recomendacao ~ '^([0-9]|10)$'
     and coalesce(n.data_envio::date, n.created_at::date) between p_inicio and p_fim
   group by 1
),

-- Monetização (pipe Caixa) -------------------------------------------------------------------------------------------
mon as (
  select x.uid as unidade_id,
         count(*) as oportunidades,
         count(*) filter (where (d.payload->>'won_on')::date between p_inicio and p_fim) as ganhas,
         count(*) filter (where left(d.payload->>'validated_at', 10)::date between p_inicio and p_fim) as validadas
    from ops.monetizacao_deals d
    cross join unnest(d.unidade_ids) x(uid)
   where left(d.payload->>'created_at', 10)::date <= p_fim
   group by 1
),

-- Uma linha por ranking e unidade ------------------------------------------------------------------------------------
linhas as (
  select 'mrr_carteira'::text as ranking, u.id, u.nome, c.mrr as valor, c.clientes::numeric as valor_secundario,
         coalesce(c.clientes, 0)::int as amostra,
         case when coalesce(c.clientes, 0) > 0 then 'ok' else 'sem_dado' end::text as situacao,
         c.mrr as ordem1, c.clientes::numeric as ordem2
    from u left join carteira c on c.k = u.k
  union all
  select 'hunter_socio', u.id, u.nome, coalesce(v.clientes, 0), coalesce(v.mrr, 0), coalesce(v.n, 0)::int, 'ok',
         coalesce(v.clientes, 0), coalesce(v.mrr, 0)
    from u left join vendas_u v on v.k = u.k and v.de_socio
  union all
  select 'idu', u.id, u.nome, i.idu, i.base_efetiva, coalesce(i.base_efetiva, 0),
         case when i.idu is null then 'sem_dado' when i.base_efetiva >= 50 then 'ok' else 'amostra_insuficiente' end,
         i.idu, 0
    from u left join idu i on i.unidade_id = u.id
  union all
  select 'retencao', u.id, u.nome, case when r.base > 0 then 100.0 * r.ficaram / r.base end, r.ficaram,
         coalesce(r.base, 0)::int,
         case when o.k is null then 'sem_dado' when coalesce(r.base, 0) >= 20 then 'ok' else 'amostra_insuficiente' end,
         case when r.base > 0 then 100.0 * r.ficaram / r.base end, r.base
    from u left join ret r on r.k = u.k left join tem_omie o on o.k = u.k
  union all
  select 'inadimplencia', u.id, u.nome, case when i.total > 0 then 100.0 * coalesce(i.aberto, 0) / i.total end,
         coalesce(i.aberto, 0), coalesce(i.n, 0)::int,
         case when o.k is null then 'sem_dado' when coalesce(i.n, 0) >= 10 then 'ok' else 'amostra_insuficiente' end,
         -(case when i.total > 0 then 100.0 * coalesce(i.aberto, 0) / i.total end), i.total
    from u left join inad i on i.k = u.k left join tem_omie o on o.k = u.k
  union all
  select 'nps', u.id, u.nome, n.nota, n.n, coalesce(n.n, 0)::int,
         case when n.k is null then 'sem_dado' when n.n >= 10 then 'ok' else 'amostra_insuficiente' end,
         n.nota, n.n
    from u left join nps n on n.k = u.k
  union all
  select 'monetizacao', u.id, u.nome, coalesce(m.ganhas, 0), coalesce(m.validadas, 0),
         coalesce(m.oportunidades, 0)::int,
         case when coalesce(m.oportunidades, 0) > 0 then 'ok' else 'sem_dado' end,
         coalesce(m.ganhas, 0), coalesce(m.validadas, 0)
    from u left join mon m on m.unidade_id = u.id
)
select l.ranking, l.id, l.nome, round(l.valor, 2), round(l.valor_secundario, 2), l.amostra, l.situacao,
       case when l.situacao = 'ok' then
         (rank() over (partition by l.ranking, (l.situacao = 'ok')
                       order by l.ordem1 desc nulls last, l.ordem2 desc nulls last))::int
       end
  from linhas l
$function$;
