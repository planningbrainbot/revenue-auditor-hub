-- Pré-venda para a daily de 15/10/2026 (PRD https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4, fase 1).
-- 1. O ritmo conta cada abordagem (re-abordagem incluída), de quem moveu o card.
-- 2. As atividades das cadências ativas, uma linha por atividade, para a visão Hoje da Pré-venda.

create or replace function ops.monetizacao_pre_venda_ritmo(p_de date, p_ate date)
returns table (
  dia date,
  user_id bigint,
  pessoa text,
  abordagens integer,
  atividades_previstas integer,
  atividades_feitas integer,
  atividades_vencidas integer,
  ligacoes integer,
  ligacoes_atendidas integer,
  minutos_falados numeric
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
declare
  v_de timestamptz;
  v_ate timestamptz;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if p_ate - p_de > 366 then
    raise exception 'Período maior que um ano' using errcode = '22023';
  end if;
  v_de := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_ate := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  return query
  -- Abordagem = cada saída da Base que a carga grava em events.started, de quem moveu o card (14/10/2026: a
  -- re-abordagem conta no ritmo, decisão do Pedro). Antes era só o primeiro started_at, atribuído ao dono atual.
  with abord as (
    select (e ->> 'date')::date as dia,
           case when e ->> 'actor_id' ~ '^\d+$' then (e ->> 'actor_id')::bigint end as user_id,
           case when e ->> 'actor_id' = d.payload ->> 'owner_id' then nullif(btrim(d.payload ->> 'owner'), '') end as nome
      from ops.monetizacao_deals d
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(d.payload -> 'events' -> 'started') = 'array'
             then d.payload -> 'events' -> 'started' else '[]'::jsonb end) e
     where (e ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$'
  ),
  atv as (
    select c.dono as user_id,
           ops.monetizacao_pre_venda_instante(
             (a ->> 'due_date') || ' ' || coalesce(nullif(a ->> 'due_time', ''), '00:00')) as vence,
           coalesce((a ->> 'feita')::boolean, false) as feita,
           case when c.status = 'encerrada' then coalesce(c.encerrado_em, now()) else now() end as corte
      from ops.monetizacao_cadencia c
      cross join lateral jsonb_array_elements(c.atividades) a
     where c.status in ('ativa', 'encerrada')
       and nullif(a ->> 'due_date', '') is not null
  ),
  atv_validas as (
    select * from atv a where a.feita or a.corte >= now() or a.vence < a.corte
  ),
  lig as (
    select (l.inicio at time zone 'America/Sao_Paulo')::date as dia, l.user_id, l.atendida, l.duracao_seg
      from ops.monetizacao_ligacoes l
     where l.inicio >= v_de and l.inicio < v_ate and l.user_id is not null
  ),
  tudo as (
    select a.dia, a.user_id, a.nome, 1 as abordagens, 0 as previstas, 0 as feitas, 0 as vencidas,
           0 as ligacoes, 0 as atendidas, 0::numeric as segundos
      from abord a
     where a.dia between p_de and p_ate
    union all
    select (v.vence at time zone 'America/Sao_Paulo')::date, v.user_id, null, 0, 1,
           case when v.feita then 1 else 0 end,
           case when not v.feita and v.vence < v.corte then 1 else 0 end,
           0, 0, 0
      from atv_validas v
     where v.vence >= v_de and v.vence < v_ate
    union all
    select g.dia, g.user_id, null, 0, 0, 0, 0, 1,
           case when g.atendida then 1 else 0 end,
           case when g.atendida then g.duracao_seg else 0 end
      from lig g
  )
  select t.dia,
         t.user_id,
         coalesce(p.pessoa, max(t.nome), 'Sem responsável') as pessoa,
         sum(t.abordagens)::integer,
         sum(t.previstas)::integer,
         sum(t.feitas)::integer,
         sum(t.vencidas)::integer,
         sum(t.ligacoes)::integer,
         sum(t.atendidas)::integer,
         round(sum(t.segundos) / 60.0, 1)
    from tudo t
    left join ops.monetizacao_pre_venda_pessoas() p on p.user_id = t.user_id
   group by t.dia, t.user_id, p.pessoa
  having sum(t.abordagens) + sum(t.previstas) + sum(t.feitas) + sum(t.vencidas) + sum(t.ligacoes)
         + sum(t.atendidas) + sum(t.segundos) > 0
   order by t.dia, 3;
end
$$;

create or replace function ops.monetizacao_pre_venda_cadencias()
returns table (
  deal_id bigint,
  empresa text,
  user_id bigint,
  pessoa text,
  dia_cadencia integer,
  canal text,
  turno text,
  vence timestamptz,
  feita boolean,
  url text
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  return query
  select c.deal_id,
         coalesce(nullif(d.payload ->> 'org', ''), d.payload ->> 'title'),
         c.dono,
         coalesce(n.pessoa, d.payload ->> 'owner'),
         nullif(a ->> 'dia', '')::integer,
         nullif(a ->> 'canal', ''),
         nullif(a ->> 'turno', ''),
         ops.monetizacao_pre_venda_instante(
           (a ->> 'due_date') || ' ' || coalesce(nullif(a ->> 'due_time', ''), '00:00')),
         coalesce((a ->> 'feita')::boolean, false),
         'https://grupoplanning.pipedrive.com/deal/' || c.deal_id
    from ops.monetizacao_cadencia c
    cross join lateral jsonb_array_elements(c.atividades) a
    left join ops.monetizacao_deals d on d.id = c.deal_id
    left join ops.monetizacao_pre_venda_pessoas() n on n.user_id = c.dono
   where c.status = 'ativa'
     and nullif(a ->> 'due_date', '') is not null
   order by 8, 1;
end
$$;
revoke all on function ops.monetizacao_pre_venda_cadencias() from public, anon;
grant execute on function ops.monetizacao_pre_venda_cadencias() to authenticated;
