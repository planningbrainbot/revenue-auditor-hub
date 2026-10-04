-- Ranking entre unidades (/ranking-unidades). Pedido do Eliezek em 02/10/2026: "ranking de quem está vendendo mais,
-- ranking IDU, melhor retenção, melhor monetização e outros rankings que façam sentido".
--
-- Decisões do Eliezek em 02/10/2026:
--   1. Todos os sócios veem o ranking, com posição e números, como o IDU (ranking aberto, decisão de 28/08). Nada de
--      royalties nem de taxas aqui: o sócio não lê isso de outra unidade (migration 20261002130000).
--   2. O período é o trimestre, com seletor.
--   3. Venda da máquina (Pipedrive pipeline 2) e venda de sócio (pipeline 4) são rankings separados.
--   4. Sem ranking de venda da máquina nem de ticket médio: quem atribui o cliente da máquina às unidades é a matriz,
--      então o número mede a distribuição e não a unidade. No lugar, a carteira por MRR.
--
-- Por que uma função SECURITY DEFINER: o sócio não lê contratos, faturas nem NPS de outra unidade, e não deve ler. A
-- função devolve só o agregado por unidade, e a trava é a chave view.ranking_unidades.
--
-- Medido em 02/10/2026 sobre o 3º trimestre, nas 8 regionais: vendas tem dado nas 8; IDU dá 100 nas 8, porque só 15 a
-- 45 dos 100 pontos têm dado; retenção e inadimplência só existem onde há Omie da unidade (Belém, Campo Novo,
-- Curitiba, Rio); NPS tem no máximo 8 respostas por unidade; monetização, 3 oportunidades ganhas na rede. Por isso
-- cada linha diz a sua situação, e unidade sem dado não fica em último lugar:
--   ok                    entra no ranking e tem posição
--   amostra_insuficiente  tem dado, mas abaixo do mínimo do ranking (sem posição)
--   sem_dado              não há fonte para a unidade (sem posição)
--
-- Os rankings e as réguas:
--   mrr_carteira    MRR da carteira hoje, pela cascata de v_cliente_mrr, um CNPJ uma vez (desempate: clientes).
--   hunter_socio    o mesmo no pipeline 4, com a unidade do sócio dono do deal quando o deal não tem unidade (a regra
--                   de v_hunter_socio). Sempre ok.
--   idu             nota do IDU (ops.idu_ranking). Só ranqueia com pelo menos metade dos 100 pontos medidos.
--   retencao        dos clientes recorrentes do período anterior (mesma duração; título em 2 meses ou mais), % que
--                   tiveram título neste.
--                   Por data de vencimento, títulos não cancelados do Omie da unidade. Mínimo de 20 clientes.
--   inadimplencia   % do valor ainda não recebido dos títulos que venceram no período e já têm 60 dias (DATA-RULES:
--                   por vencimento, safra madura). Menor é melhor. Mínimo de 10 títulos.
--   nps             % promotores − % detratores das respostas do período. Mínimo de 10 respostas.
--   monetizacao     oportunidades do pipe Caixa (39) ganhas no período (desempate: validadas no período). Ranqueia
--                   quem tem ao menos uma oportunidade no pipe.

insert into ops.area_chaves (area, permission_key) values
  ('minha_unidade', 'view.ranking_unidades'),
  ('rede', 'view.ranking_unidades')
on conflict do nothing;

create or replace function ops.ranking_unidades(p_inicio date, p_fim date)
returns table (
  ranking text,
  unidade_id integer,
  unidade text,
  valor numeric,
  valor_secundario numeric,
  amostra integer,
  situacao text,
  posicao integer
)
language sql
stable
security definer
set search_path = ops, public, extensions
as $$
with
guarda as (select (select ops.can('view.ranking_unidades')) as ok),
u as (
  select un.id, un.nome_da_praca as nome, ops.norm_unidade(un.nome_da_praca) as k
    from ops.unidades un, guarda g
   where g.ok and un.tipo = 'regional' and un.data_inauguracao <= p_fim
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
$$;

revoke all on function ops.ranking_unidades(date, date) from public, anon;
grant execute on function ops.ranking_unidades(date, date) to authenticated, service_role;
