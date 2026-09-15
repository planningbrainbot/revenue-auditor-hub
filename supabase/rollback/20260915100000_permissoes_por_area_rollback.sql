-- Rollback de 20260915100000_permissoes_por_area.
--
-- Restaura as 5 funções para a versão que lia ops.role_permissions e
-- ops.socios.unidade. As tabelas novas podem ficar: inertes, não afetam nada.
-- role_permissions nunca foi tocada, então o acesso volta exatamente ao que era.

create or replace function ops.can(_key text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  SELECT COALESCE(bool_or(rp.allowed), false)
  FROM ops.user_roles ur
  JOIN ops.role_permissions rp ON rp.role = ur.role
  WHERE ur.user_id = auth.uid()
    AND rp.permission_key = _key
$function$;

create or replace function ops.current_user_unidade()
returns text language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  SELECT s.unidade FROM ops.socios s WHERE s.user_id = auth.uid() LIMIT 1
$function$;

create or replace function ops.minhas_unidades()
returns setof integer language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select u.id from socios s join unidades u on u.nome_da_praca = s.unidade
   where s.user_id = auth.uid()
$function$;

create or replace function ops.unidades_do_usuario()
returns text[] language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  with alvo as (select nullif(ops.norm_unidade(ops.current_user_unidade()), '') as u),
  pares (a, b) as (
    values ('rio de janeiro',   'sudeste (rj)'),
           ('rio de janeiro',   'rj'),
           ('goiania / matriz', 'matriz'),
           ('goiania / matriz', 'goiania')
  )
  select case
           when (select u from alvo) is null then null
           else array(
             select distinct v
             from (
                    select (select u from alvo)
               union all select p.b from pares p where p.a = (select u from alvo)
               union all select p.a from pares p where p.b = (select u from alvo)
             ) t(v)
             where v is not null
           )
         end
$function$;

drop function if exists ops.tem_area(text);
