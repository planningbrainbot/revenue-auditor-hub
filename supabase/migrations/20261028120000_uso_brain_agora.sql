-- Uso do Brain: quem está no Ops agora (bloco "Agora no Ops" da tela /uso-brain).
-- Pedido em 28/10/2026, dentro do PRD 2026-10-ops-uso-do-brain. Nenhum dado novo:
-- lê a mesma ops.uso_minutos, com a mesma chave view.admin.uso.
--
-- "Agora" = teve minuto ativo registrado nos últimos 2 minutos. A coleta grava um
-- minuto por pessoa a cada 60 s enquanto a aba está visível e houve interação no
-- último minuto, então 2 minutos de folga cobrem o atraso entre uma batida e outra
-- sem deixar quem saiu aparecendo por muito tempo.
-- "Desde" = início da sessão atual (minutos com intervalo de até p_gap_min), igual
-- à regra de sessão do painel.

begin;

create or replace function ops.uso_brain_agora(p_gap_min integer default 15)
returns jsonb
language sql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
with
pode as (select ops.can('view.admin.uso') as ok),
agora as (
  select u.user_id, max(u.minuto) as ultimo
    from ops.uso_minutos u, pode
   where pode.ok
     and u.minuto >= date_trunc('minute', now()) - interval '2 minutes'
   group by 1
),
-- Só as últimas 12 horas: sessão mais longa que isso não existe na prática.
recente as (
  select u.user_id, u.minuto, u.rota
    from ops.uso_minutos u
    join agora a on a.user_id = u.user_id
   where u.minuto >= now() - interval '12 hours'
),
marcado as (
  select user_id, minuto,
         case when lag(minuto) over w is null
                or minuto - lag(minuto) over w > make_interval(mins => p_gap_min)
              then minuto end as inicio
    from recente
  window w as (partition by user_id order by minuto)
),
sessao as (
  select user_id, max(inicio) as inicio from marcado group by 1
)
select coalesce(jsonb_agg(jsonb_build_object(
         'user_id', a.user_id,
         'email', lower(coalesce(p.email, au.email)),
         'nome', p.nome,
         'papeis', (select string_agg(ur.role, ',' order by ur.role) from ops.user_roles ur
                     where ur.user_id = a.user_id),
         'rota', (select r.rota from recente r
                   where r.user_id = a.user_id and r.minuto = a.ultimo),
         'ultimo', a.ultimo,
         'desde', s.inicio)
       order by s.inicio), '[]'::jsonb)
  from agora a
  join auth.users au on au.id = a.user_id
  left join public.profiles p on p.user_id = a.user_id
  left join sessao s on s.user_id = a.user_id
$$;

revoke all on function ops.uso_brain_agora(integer) from public, anon;
grant execute on function ops.uso_brain_agora(integer) to authenticated;

commit;
