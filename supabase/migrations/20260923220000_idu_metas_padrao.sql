-- IDU · metas padrão por trimestre: uma para a rede inteira e uma por tier.
--
-- Até aqui a meta só existia por unidade (`ops.idu_metas`), e pactuar um trimestre era
-- preencher 8 unidades × 6 indicadores célula por célula. Agora a meta resolve em cascata:
--
--   meta da unidade  >  meta do tier da unidade  >  meta da rede  >  (churn: 5% fixo)
--
-- Tier é a curva que o IDU já usa para os pesos: 'Madura' (5+ trimestres desde a
-- inauguração) ou 'Ramp-up'. Não é coluna em `unidades`: é calculado no trimestre, então
-- a unidade que amadurece passa sozinha para a meta de Madura, sem ninguém remanejar.
--
-- A regra do dado ausente continua: sem meta em nenhum dos níveis, o indicador sai do
-- denominador. Meta padrão só existe se alguém a gravou para aquele trimestre.
--
-- Não há `unidade_id` aqui, então a RESTRICTIVE `escopo_unidade` não se aplica: a meta
-- padrão é a mesma para todos e fica visível a quem enxerga o IDU, como o ranking.
--
-- `idu_apuracao` ganha a coluna `meta_origem` ('unidade' | 'tier' | 'rede' | 'fixa'),
-- e por isso é recriada (mudar o tipo de retorno exige DROP). `idu_ranking` não muda.
--
-- Rollback:
--   drop table if exists ops.idu_metas_padrao;
--   e recriar ops.idu_apuracao a partir da versão anterior (sem meta_origem).

begin;

create table if not exists ops.idu_metas_padrao (
  id             bigint generated always as identity primary key,
  periodo_inicio date    not null,
  periodo_fim    date    not null,
  escopo         text    not null check (escopo in ('rede', 'Madura', 'Ramp-up')),
  indicador      text    not null check (indicador in (
                   'novos','base','churn','satisfacao','exposicao','enps')),
  meta           numeric not null,
  observacao     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (periodo_inicio, escopo, indicador)
);

comment on table ops.idu_metas_padrao is
  'Metas do IDU que valem para várias unidades de uma vez: a rede inteira ou um tier (Madura / Ramp-up). A meta própria da unidade em idu_metas vence.';

alter table ops.idu_metas_padrao enable row level security;

grant select, insert, update, delete on ops.idu_metas_padrao to authenticated, service_role;

-- Escrita em três policies, nunca `for all`: `for all` também concede SELECT.
drop policy if exists idu_metas_padrao_select on ops.idu_metas_padrao;
create policy idu_metas_padrao_select on ops.idu_metas_padrao
  for select to authenticated
  using (tem_produto('ops') and (select can('view.idu')));

drop policy if exists idu_metas_padrao_insert on ops.idu_metas_padrao;
create policy idu_metas_padrao_insert on ops.idu_metas_padrao
  for insert to authenticated
  with check (tem_produto('ops') and (select can('edit.idu_metas')));

drop policy if exists idu_metas_padrao_update on ops.idu_metas_padrao;
create policy idu_metas_padrao_update on ops.idu_metas_padrao
  for update to authenticated
  using (tem_produto('ops') and (select can('edit.idu_metas')))
  with check (tem_produto('ops') and (select can('edit.idu_metas')));

drop policy if exists idu_metas_padrao_delete on ops.idu_metas_padrao;
create policy idu_metas_padrao_delete on ops.idu_metas_padrao
  for delete to authenticated
  using (tem_produto('ops') and (select can('edit.idu_metas')));

-- ---------------------------------------------------------------- apuração

drop function if exists ops.idu_apuracao(date, date);

create function ops.idu_apuracao(p_inicio date, p_fim date)
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
  pontos         numeric,
  meta_origem    text
)
language sql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
with u as (
  select id, nome_da_praca as nome, data_inauguracao,
         ((extract(year from p_fim) - extract(year from data_inauguracao)) * 4
          + floor((extract(month from p_fim) - 1) / 3)
          - floor((extract(month from data_inauguracao) - 1) / 3))::int as trimestres
  from ops.unidades
  where data_inauguracao is not null and nome_da_praca is not null
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

comment on function ops.idu_apuracao(date, date) is
  'Apura o IDU por unidade e indicador. Meta em cascata: unidade > tier (Madura/Ramp-up) > rede. Indicador sem meta ou sem dado devolve pontos nulos e sai do denominador.';

-- Mesmo ACL da versão anterior: sem PUBLIC.
revoke all on function ops.idu_apuracao(date, date) from public;
grant execute on function ops.idu_apuracao(date, date) to authenticated, service_role;

commit;
