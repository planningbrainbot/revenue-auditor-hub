-- IDU passa a incluir toda unidade regional sozinho.
--
-- Até aqui `idu_apuracao` pegava só unidade com `data_inauguracao` preenchida, e por isso
-- São Bernardo, Recife e Sorocaba (cadastradas em 16/09/2026 sem a data) ficaram fora do
-- IDU e do ranking da rede. A regra nova não depende de ninguém lembrar de preencher nada:
--
--   entra:  ops.unidades.tipo = 'regional'  (as internas, como Goiânia e Consultoria, não)
--   desde:  o trimestre da inauguração; sem inauguração, o trimestre do cadastro
--
-- Unidade cadastrada pela tela /unidades aparece no IDU do trimestre corrente como
-- Ramp-up. Quando a data de inauguração for preenchida, ela passa a valer para a curva.
-- Efeito colateral desejado: trimestre anterior à inauguração não lista mais a unidade
-- (antes Maceió aparecia no 1º tri/2026 com trimestres negativos).
--
-- `ranking_unidades` usa a mesma data de início, para o ranking não divergir do IDU.
-- `idu_ranking` lê `idu_apuracao` e não muda.

CREATE OR REPLACE FUNCTION ops.idu_apuracao(p_inicio date, p_fim date)
 RETURNS TABLE(unidade_id integer, unidade text, curva text, trimestres integer, indicador text, rotulo text, pilar text, peso integer, direcao text, unidade_medida text, meta numeric, realizado numeric, atingimento numeric, ajuste text, pontos numeric, meta_origem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
with u as (
  select id, nome, inicio,
         ((extract(year from p_fim) - extract(year from inicio)) * 4
          + floor((extract(month from p_fim) - 1) / 3)
          - floor((extract(month from inicio) - 1) / 3))::int as trimestres
  from (
    select id, nome_da_praca as nome, coalesce(data_inauguracao, created_at::date) as inicio
    from ops.unidades
    where tipo = 'regional' and nome_da_praca is not null
  ) un
  where inicio <= p_fim
),
carteira as (
  select u.id, coalesce(sum(v.mrr_total), 0) as mrr_base
  from u left join ops.v_mrr_por_unidade v on ops.idu_slug(v.unidade) = ops.idu_slug(u.nome)
  group by u.id
),
vendas as (
  select u.id,
         coalesce(sum(c.mrr_mensal) filter (where coalesce(c.origem_pipeline, 'inside_sales') <> 'socios'), 0) as novos,
         coalesce(sum(c.mrr_mensal) filter (where c.origem_pipeline = 'socios'), 0) as base
  from u left join ops.contratos c
    on ops.idu_slug(c.unidade) = ops.idu_slug(u.nome)
   and c.ganho_em >= p_inicio and c.ganho_em < p_fim
  group by u.id
),
churn as (
  select u.id, coalesce(sum(t.mrr), 0) as mrr_perdido, count(t.id) as n
  from u left join ops.central_tratativas t
    on ops.idu_slug(t.unidade) = ops.idu_slug(u.nome)
   and t.data_churn >= p_inicio and t.data_churn < p_fim
  group by u.id
),
sat as (
  select u.id, count(p.id) as respostas,
         count(p.id) filter (where (substring(p.nps_recomendacao from '^[0-9]+'))::int >= 9) as prom,
         count(p.id) filter (where (substring(p.nps_recomendacao from '^[0-9]+'))::int <= 6) as det
  from u left join ops.nps_pesquisas p
    on ops.idu_slug(p.unidade) = ops.idu_slug(u.nome)
   and p.nps_recomendacao ~ '^[0-9]'
   and coalesce(p.data_envio, p.created_at::date) >= p_inicio
   and coalesce(p.data_envio, p.created_at::date) < p_fim
  group by u.id
),
expo as (
  select u.id,
         coalesce(sum(coalesce(a.oportunidades_valor, 0) + coalesce(a.contingencias_valor, 0)), 0) as valor,
         count(a.pipefy_card_id) as n
  from u left join ops.auditorias_internas a
    on ops.idu_slug(a.unidade) = ops.idu_slug(u.nome)
   and a.data_conclusao >= p_inicio and a.data_conclusao < p_fim
  group by u.id
),
realizados as (
  select u.id, u.nome, u.trimestres, (u.trimestres >= 5) as madura,
         cat.indicador, cat.rotulo, cat.pilar, cat.direcao, cat.unidade_medida,
         case when u.trimestres >= 5 then cat.peso_madura else cat.peso_ramp end as peso,
         case cat.indicador
           when 'novos' then vendas.novos
           when 'base'  then vendas.base
           when 'churn' then case when carteira.mrr_base > 0 then churn.mrr_perdido / carteira.mrr_base * 100 end
           when 'satisfacao' then case when sat.respostas >= 5 then (sat.prom - sat.det)::numeric / sat.respostas * 100 end
           when 'exposicao'  then case when carteira.mrr_base > 0 and expo.n > 0 then expo.valor / (carteira.mrr_base * 3) * 100 end
           else null
         end as realizado
  from u
  cross join ops.idu_indicadores_catalogo() cat
  join carteira on carteira.id = u.id
  join vendas   on vendas.id = u.id
  join churn    on churn.id = u.id
  join sat      on sat.id = u.id
  join expo     on expo.id = u.id
),
-- cascata: unidade > tier > rede > 5% fixo de churn
com_meta as (
  select r.*,
         coalesce(m.meta, pt.meta, pr.meta,
                  case when r.indicador = 'churn' then 5.0 end) as meta,
         case when m.meta  is not null then 'unidade'
              when pt.meta is not null then 'tier'
              when pr.meta is not null then 'rede'
              when r.indicador = 'churn' then 'fixa'
         end as meta_origem
  from realizados r
  left join ops.idu_metas m
    on m.unidade_id = r.id and m.indicador = r.indicador and m.periodo_inicio = p_inicio
  left join ops.idu_metas_padrao pt
    on pt.periodo_inicio = p_inicio and pt.indicador = r.indicador
   and pt.escopo = case when r.madura then 'Madura' else 'Ramp-up' end
  left join ops.idu_metas_padrao pr
    on pr.periodo_inicio = p_inicio and pr.indicador = r.indicador and pr.escopo = 'rede'
),
bruto as (
  select cm.*,
         case when cm.meta is null or cm.realizado is null then null
              when cm.direcao = 'menor' then
                case when cm.realizado <= 0 then 120 when cm.meta <= 0 then 0
                     else cm.meta / cm.realizado * 100 end
              else case when cm.meta <= 0 then case when cm.realizado > 0 then 120 else 0 end
                        else cm.realizado / cm.meta * 100 end
         end as at_bruto
  from com_meta cm
)
select b.id, b.nome, case when b.madura then 'Madura' else 'Ramp-up' end,
       b.trimestres, b.indicador, b.rotulo, b.pilar, b.peso, b.direcao, b.unidade_medida,
       round(b.meta, 2), round(b.realizado, 2), round(b.at_bruto, 1),
       case when b.at_bruto is null then 'sem dado'
            when b.at_bruto < 50 then 'piso'
            when b.at_bruto > 120 then 'teto' else '' end,
       case when b.at_bruto is null then null when b.at_bruto < 50 then 0
            else round(b.peso * least(b.at_bruto, 120) / 100, 2) end,
       b.meta_origem
from bruto b
where ops.idu_pode_ver()
order by b.nome, b.pilar, b.indicador;
$function$;

CREATE OR REPLACE FUNCTION ops.ranking_unidades(p_inicio date, p_fim date)
 RETURNS TABLE(ranking text, unidade_id integer, unidade text, valor numeric, valor_secundario numeric, amostra integer, situacao text, posicao integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
with
guarda as (select (select ops.can('view.ranking_unidades')) as ok),
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
