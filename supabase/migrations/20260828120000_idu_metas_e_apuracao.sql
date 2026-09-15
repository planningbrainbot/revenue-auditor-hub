-- Método IDU — Índice de Desempenho da Unidade
--
-- Régua (ver wiki/outputs/2026-08-metodologia-metas-trimestrais-unidades.md no repo AI Projects):
--   Crescimento 30/50 · Retenção 35/15 · Qualidade 25/25 · Gestão 10/10   (madura/ramp-up)
--   atingimento: maior-é-melhor = realizado/meta · menor-é-melhor = meta/realizado
--   piso 50% zera o indicador · teto 120% · nota final limitada a 100
--   liberação: <50 → 0% · 50–74 → a própria nota · 75–89 → 100% · 90–100 → até 120%
--
-- Decisões registradas em 28/08/2026:
--   - Churn é APENAS o que está lançado no pipe de Tratativas (central_tratativas).
--     Unidade com carteira e sem card no período tem churn zero. Inadimplência é
--     sinal para o time de CS investigar e lançar, não fonte automática.
--   - Meta de churn da rede: 5% do MRR da carteira no trimestre.
--   - Indicador SEM META PACTUADA sai do denominador. É deliberado: força a meta a
--     ser registrada antes do trimestre, em vez de a régua inventar um número.

-- ---------------------------------------------------------------- helper

create or replace function public.idu_slug(txt text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(trim(translate(
    coalesce(txt, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'
  )));
$$;

-- ---------------------------------------------------------------- metas

create table if not exists public.idu_metas (
  id             bigint generated always as identity primary key,
  unidade_id     integer not null references public.unidades(id) on delete cascade,
  periodo_inicio date    not null,
  periodo_fim    date    not null,
  indicador      text    not null check (indicador in (
                   'novos','base','churn','satisfacao','exposicao','enps')),
  meta           numeric not null,
  observacao     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (unidade_id, periodo_inicio, indicador)
);

comment on table public.idu_metas is
  'Metas por unidade e por trimestre do Método IDU. Sem meta registrada, o indicador sai do denominador da nota.';

create index if not exists idu_metas_periodo_idx on public.idu_metas (periodo_inicio, periodo_fim);

alter table public.idu_metas enable row level security;

-- SELECT segue role_permissions: quem enxerga o painel enxerga as metas.
drop policy if exists idu_metas_select on public.idu_metas;
create policy idu_metas_select on public.idu_metas
  for select using (public.can('view.idu'));

-- Escrita é restrita a quem pactua as metas.
drop policy if exists idu_metas_write on public.idu_metas;
create policy idu_metas_write on public.idu_metas
  for all using (public.can('edit.idu_metas')) with check (public.can('edit.idu_metas'));

-- ---------------------------------------------------------------- catálogo

create or replace function public.idu_indicadores_catalogo()
returns table (
  indicador text, rotulo text, pilar text,
  peso_madura int, peso_ramp int, direcao text, unidade_medida text
)
language sql immutable set search_path = public as $$
  values
    ('novos',      'Venda de novos clientes', 'Crescimento', 20, 40, 'maior', 'R$/mês'),
    ('base',       'Venda para a base',       'Crescimento', 10, 10, 'maior', 'R$/mês'),
    ('churn',      'Churn de MRR',            'Retenção',    35, 15, 'menor', '%'),
    ('satisfacao', 'Satisfação do cliente',   'Qualidade',   15, 15, 'maior', 'NPS'),
    ('exposicao',  'Exposição de carteira',   'Qualidade',   10, 10, 'menor', '%'),
    ('enps',       'e-NPS',                   'Gestão',      10, 10, 'maior', 'NPS');
$$;

-- ---------------------------------------------------------------- apuração

create or replace function public.idu_apuracao(p_inicio date, p_fim date)
returns table (
  unidade_id     integer,
  unidade        text,
  curva          text,
  trimestres     integer,
  indicador      text,
  rotulo         text,
  pilar          text,
  peso           integer,
  direcao        text,
  unidade_medida text,
  meta           numeric,
  realizado      numeric,
  atingimento    numeric,
  ajuste         text,
  pontos         numeric
)
language sql
stable
security definer
set search_path = public
as $$
with u as (
  select id, nome_da_praca as nome, data_inauguracao,
         ((extract(year from p_fim) - extract(year from data_inauguracao)) * 4
          + floor((extract(month from p_fim) - 1) / 3)
          - floor((extract(month from data_inauguracao) - 1) / 3))::int as trimestres
  from public.unidades
  where data_inauguracao is not null and nome_da_praca is not null
),
carteira as (
  select u.id, coalesce(sum(v.mrr_total), 0) as mrr_base
  from u left join public.v_mrr_por_unidade v
    on public.idu_slug(v.unidade) = public.idu_slug(u.nome)
  group by u.id
),
-- vendas: mrr_mensal é o MRR mensal. A coluna contratos.mrr é o valor de 12 meses.
vendas as (
  select u.id,
         coalesce(sum(c.mrr_mensal) filter (where coalesce(c.origem_pipeline, 'inside_sales') <> 'socios'), 0) as novos,
         coalesce(sum(c.mrr_mensal) filter (where c.origem_pipeline = 'socios'), 0) as base
  from u left join public.contratos c
    on public.idu_slug(c.unidade) = public.idu_slug(u.nome)
   and c.ganho_em >= p_inicio and c.ganho_em < p_fim
  group by u.id
),
churn as (
  select u.id, coalesce(sum(t.mrr), 0) as mrr_perdido, count(t.id) as n
  from u left join public.central_tratativas t
    on public.idu_slug(t.unidade) = public.idu_slug(u.nome)
   and t.data_churn >= p_inicio and t.data_churn < p_fim
  group by u.id
),
sat as (
  select u.id,
         count(p.id) as respostas,
         count(p.id) filter (where substring(p.nps_recomendacao from '^\d+')::int >= 9) as prom,
         count(p.id) filter (where substring(p.nps_recomendacao from '^\d+')::int <= 6) as det
  from u left join public.nps_pesquisas p
    on public.idu_slug(p.unidade) = public.idu_slug(u.nome)
   and p.nps_recomendacao ~ '^\d'
   and coalesce(p.data_envio, p.created_at::date) >= p_inicio
   and coalesce(p.data_envio, p.created_at::date) < p_fim
  group by u.id
),
expo as (
  select u.id,
         coalesce(sum(coalesce(a.oportunidades_valor, 0) + coalesce(a.contingencias_valor, 0)), 0) as valor,
         count(a.pipefy_card_id) as n
  from u left join public.auditorias_internas a
    on public.idu_slug(a.unidade) = public.idu_slug(u.nome)
   and a.data_conclusao >= p_inicio and a.data_conclusao < p_fim
  group by u.id
),
realizados as (
  select u.id, u.nome, u.trimestres,
         (u.trimestres >= 5) as madura,
         cat.indicador, cat.rotulo, cat.pilar, cat.direcao, cat.unidade_medida,
         case when u.trimestres >= 5 then cat.peso_madura else cat.peso_ramp end as peso,
         case cat.indicador
           when 'novos'      then vendas.novos
           when 'base'       then vendas.base
           -- churn é o que está lançado em Tratativas; sem card e com carteira = zero
           when 'churn'      then case when carteira.mrr_base > 0
                                       then churn.mrr_perdido / carteira.mrr_base * 100 end
           when 'satisfacao' then case when sat.respostas >= 5
                                       then (sat.prom - sat.det)::numeric / sat.respostas * 100 end
           when 'exposicao'  then case when carteira.mrr_base > 0 and expo.n > 0
                                       then expo.valor / (carteira.mrr_base * 3) * 100 end
           else null  -- e-NPS ainda não tem fonte
         end as realizado
  from u
  cross join public.idu_indicadores_catalogo() cat
  join carteira on carteira.id = u.id
  join vendas   on vendas.id = u.id
  join churn    on churn.id = u.id
  join sat      on sat.id = u.id
  join expo     on expo.id = u.id
),
com_meta as (
  select r.*,
         case when r.indicador = 'churn' then coalesce(m.meta, 5.0) else m.meta end as meta
  from realizados r
  left join public.idu_metas m
    on m.unidade_id = r.id and m.indicador = r.indicador
   and m.periodo_inicio = p_inicio
),
bruto as (
  select cm.*,
         case
           when cm.meta is null or cm.realizado is null then null
           when cm.direcao = 'menor' then
             case when cm.realizado <= 0 then 120
                  when cm.meta <= 0 then 0
                  else cm.meta / cm.realizado * 100 end
           else
             case when cm.meta <= 0 then case when cm.realizado > 0 then 120 else 0 end
                  else cm.realizado / cm.meta * 100 end
         end as at_bruto
  from com_meta cm
)
select b.id, b.nome,
       case when b.madura then 'Madura' else 'Ramp-up' end,
       b.trimestres, b.indicador, b.rotulo, b.pilar, b.peso, b.direcao, b.unidade_medida,
       round(b.meta, 2), round(b.realizado, 2), round(b.at_bruto, 1),
       case when b.at_bruto is null then 'sem dado'
            when b.at_bruto < 50 then 'piso'
            when b.at_bruto > 120 then 'teto'
            else '' end,
       case when b.at_bruto is null then null
            when b.at_bruto < 50 then 0
            else round(b.peso * least(b.at_bruto, 120) / 100, 2) end
from bruto b
where public.can('view.idu')
order by b.nome, b.pilar, b.indicador;
$$;

comment on function public.idu_apuracao(date, date) is
  'Apura o IDU por unidade e indicador. Indicador sem meta ou sem dado devolve pontos nulos e sai do denominador.';

-- ---------------------------------------------------------------- ranking

create or replace function public.idu_ranking(p_inicio date, p_fim date)
returns table (
  posicao       integer,
  unidade_id    integer,
  unidade       text,
  curva         text,
  soma_pontos   numeric,
  base_efetiva  integer,
  idu           numeric,
  faixa         text,
  liberado_pct  numeric,
  falta_corte   numeric,
  pilar_fraco   text
)
language sql
stable
security definer
set search_path = public
as $$
with a as (select * from public.idu_apuracao(p_inicio, p_fim)),
agg as (
  select a.unidade_id, a.unidade, a.curva,
         sum(a.pontos) as soma,
         sum(a.peso) filter (where a.pontos is not null) as base
  from a group by 1, 2, 3
),
nota as (
  select agg.*,
         case when coalesce(agg.base, 0) > 0
              then least(100, agg.soma / agg.base * 100) end as idu
  from agg
),
fraco as (
  select distinct on (a.unidade_id) a.unidade_id, a.pilar
  from a where a.pontos is not null
  order by a.unidade_id, (a.peso - a.pontos) desc
)
select
  (row_number() over (order by n.idu desc nulls last))::int,
  n.unidade_id, n.unidade, n.curva,
  round(n.soma, 1), n.base::int, round(n.idu, 1),
  case when n.idu is null then 'sem base'
       when n.idu < 50 then 'Crítico'
       when n.idu < 75 then 'Abaixo'
       when n.idu < 90 then 'Na meta'
       else 'Superação' end,
  case when n.idu is null then null
       when n.idu < 50 then 0
       when n.idu < 75 then round(n.idu, 1)
       when n.idu < 90 then 100
       else round(100 + (n.idu - 90) / 10 * 20, 1) end,
  case when n.idu is null then null else round(greatest(0, 75 - n.idu), 1) end,
  fraco.pilar
from nota n
left join fraco on fraco.unidade_id = n.unidade_id
where public.can('view.idu')
order by n.idu desc nulls last;
$$;

comment on function public.idu_ranking(date, date) is
  'Nota final do IDU por unidade, com faixa, percentual liberado e o pilar que mais deixou pontos na mesa.';

grant execute on function public.idu_indicadores_catalogo() to authenticated;
grant execute on function public.idu_apuracao(date, date) to authenticated;
grant execute on function public.idu_ranking(date, date) to authenticated;
