-- Uso do Brain no Ops (/uso-brain). PRD: wiki/prds/2026-10-ops-uso-do-brain.md,
-- aprovado em 27/10/2026 com as três propostas da seção 11: só admin vê, só o
-- uso do Ops na v1, sócios de unidade também são medidos.
--
-- Mesmo desenho do Growth (growth.uso_minutos + growth.uso_brain_painel): uma
-- linha por pessoa por minuto ativo, e uma função que devolve o painel em JSON.
-- Diferenças de propósito:
--   * a chave é user_id, não e-mail (e-mail muda; o nome vem de profiles);
--   * o minuto vem do relógio do servidor, nunca do navegador;
--   * a rota é normalizada aqui (sem query, ids viram :id), para o ranking de
--     telas não pulverizar e nenhum id de cliente ficar guardado.

begin;

create table if not exists ops.uso_minutos (
  user_id uuid        not null references auth.users (id) on delete cascade,
  minuto  timestamptz not null,
  rota    text        not null,
  primary key (user_id, minuto)
);

create index if not exists uso_minutos_minuto_idx on ops.uso_minutos (minuto);

-- Sem policy: ninguém lê nem grava direto. Tudo passa pelas duas funções.
alter table ops.uso_minutos enable row level security;
revoke all on ops.uso_minutos from anon, authenticated;

create or replace function ops.normalizar_rota_uso(p_rota text)
returns text
language sql
immutable
as $$
  select left(
    coalesce(nullif(
      regexp_replace(
        regexp_replace(
          regexp_replace(split_part(split_part(coalesce(p_rota, ''), '?', 1), '#', 1),
                         '/[0-9a-fA-F]{8}-[0-9a-fA-F-]{27,}', '/:id', 'g'),
          '/[0-9]+(?=/|$)', '/:id', 'g'),
        '/+$', ''),
      ''), '/'),
    120)
$$;

-- Duas abas no mesmo minuto contam 1 (chave primária). Simulação de "ver como"
-- não conta: é o admin olhando a tela do sócio, não o sócio usando.
create or replace function ops.registrar_uso(p_rota text)
returns void
language sql
volatile
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  insert into ops.uso_minutos (user_id, minuto, rota)
  select auth.uid(), date_trunc('minute', now()), ops.normalizar_rota_uso(p_rota)
   where auth.uid() is not null
     and not ops.ver_como_ativa()
  on conflict do nothing
$$;

revoke all on function ops.registrar_uso(text) from public, anon;
grant execute on function ops.registrar_uso(text) to authenticated;

-- Painel. Semana segunda a domingo e dia em horário de Brasília (igual ao
-- Growth). Sessão = minutos com intervalo de até p_gap_min entre eles.
-- Membros = quem tem acesso ao produto Ops (base do "% ativos").
create or replace function ops.uso_brain_painel(p_desde date, p_gap_min integer, p_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
with
pode as (select ops.can('view.admin.uso') as ok),
alvo as (
  select pa.user_id, lower(coalesce(p.email, au.email)) as email, p.nome,
         coalesce(p.ativo, true) as ativo, pa.concedido_em,
         (select string_agg(ur.role, ',' order by ur.role) from ops.user_roles ur
           where ur.user_id = pa.user_id) as papeis,
         au.last_sign_in_at as ultimo_login
    from public.produto_acesso pa
    join auth.users au on au.id = pa.user_id
    left join public.profiles p on p.user_id = pa.user_id, pode
   where pode.ok
     and pa.produto = 'ops'
     and (p_user_id is null or pa.user_id = p_user_id)
),
bruto as (
  select u.user_id, u.minuto, u.rota
    from ops.uso_minutos u, pode
   where pode.ok
     and u.minuto >= p_desde::timestamp at time zone 'America/Sao_Paulo'
     and (p_user_id is null or u.user_id = p_user_id)
),
-- A chave primária já garante um minuto por pessoa; o nome segue o Growth.
unicos as (select user_id, minuto from bruto),
marcado as (
  select user_id, minuto,
         case when lag(minuto) over w is null
                or minuto - lag(minuto) over w > make_interval(mins => p_gap_min)
              then 1 else 0 end as novo
    from unicos
  window w as (partition by user_id order by minuto)
),
numerado as (
  select user_id, minuto, sum(novo) over (partition by user_id order by minuto) as sid
    from marcado
),
sessoes as (
  select user_id, sid, min(minuto) as inicio, max(minuto) as fim, count(*) as minutos
    from numerado group by user_id, sid
),
dia as (
  select user_id, (minuto at time zone 'America/Sao_Paulo')::date as dia,
         count(*) as minutos, min(minuto) as primeiro, max(minuto) as ultimo
    from unicos group by 1, 2
),
dia_sess as (
  select user_id, (inicio at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
    from sessoes group by 1, 2
),
historico as (
  select u.user_id,
         (min(u.minuto) at time zone 'America/Sao_Paulo')::date as primeiro_dia,
         max(u.minuto) as ultimo_uso
    from ops.uso_minutos u, pode
   where pode.ok
     and (p_user_id is null or u.user_id = p_user_id)
   group by 1
)
select jsonb_build_object(
  'membros', coalesce((select jsonb_agg(to_jsonb(a)) from alvo a), '[]'::jsonb),
  'dia', coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', d.user_id, 'dia', d.dia, 'minutos', d.minutos,
      'sessoes', coalesce(s.n, 0), 'primeiro', d.primeiro, 'ultimo', d.ultimo))
      from dia d left join dia_sess s on s.user_id = d.user_id and s.dia = d.dia
  ), '[]'::jsonb),
  'sessoes', case when p_user_id is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id, 'inicio', s.inicio, 'fim', s.fim, 'minutos', s.minutos,
      'rotas', (select coalesce(jsonb_agg(distinct b.rota), '[]'::jsonb) from bruto b
                 where b.user_id = s.user_id and b.minuto between s.inicio and s.fim))
      order by s.inicio desc)
      from sessoes s
  ), '[]'::jsonb) end,
  'rota_semana', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', user_id, 'semana', semana, 'rota', rota, 'minutos', minutos))
      from (
        select user_id, (date_trunc('week', minuto at time zone 'America/Sao_Paulo'))::date as semana,
               rota, count(*) as minutos
          from bruto group by 1, 2, 3
      ) r
  ), '[]'::jsonb),
  'calor', coalesce((
    select jsonb_agg(jsonb_build_object('user_id', user_id, 'dow', dow, 'hora', hora, 'minutos', minutos))
      from (
        select user_id,
               extract(isodow from minuto at time zone 'America/Sao_Paulo')::int - 1 as dow,
               extract(hour from minuto at time zone 'America/Sao_Paulo')::int as hora,
               count(*) as minutos
          from unicos group by 1, 2, 3
      ) c
  ), '[]'::jsonb),
  'historico', coalesce((select jsonb_agg(to_jsonb(h)) from historico h), '[]'::jsonb)
)
$$;

revoke all on function ops.uso_brain_painel(date, integer, uuid) from public, anon;
grant execute on function ops.uso_brain_painel(date, integer, uuid) to authenticated;

-- Chave da tela, na área Administração (hoje só o papel admin tem a área).
insert into ops.area_chaves (area, permission_key)
values ('admin', 'view.admin.uso')
on conflict do nothing;

-- Legado: role_permissions ainda é lido por telas antigas de permissão.
insert into ops.role_permissions (role, permission_key, allowed)
select role, 'view.admin.uso', allowed
  from ops.role_permissions
 where permission_key = 'view.admin.users'
on conflict do nothing;

commit;
