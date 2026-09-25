-- Rollback de 20260925100000_acessos_travas.sql.
-- Gerado em 24/09/2026 a partir das definições em produção antes da migration
-- (pg_get_functiondef e pg_policy do npknehhyyzelmrbbxvtu). Devolve as funções,
-- as policies e as FKs exatamente como estavam, e apaga o que a migration criou.

set search_path to ops, public;

drop trigger if exists area_admins_guarda_escopo on ops.area_admins;
drop trigger if exists area_admins_devolve_escopo on ops.area_admins;
drop function if exists ops._area_admins_guarda_escopo();
drop function if exists ops._area_admins_devolve_escopo();
alter table ops.area_admins drop column if exists escopo_anterior;
drop function if exists ops.acesso_desativar(uuid, text);
drop function if exists ops.acesso_reativar(uuid);
drop function if exists ops.acesso_registrar(uuid, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION ops.eh_super_admin(_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
  select exists (
    select 1 from ops.user_roles where user_id = _user and role::text = 'admin'
  )
$function$

;

CREATE OR REPLACE FUNCTION ops.can_user(_user_id uuid, _key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
  select case
    when _user_id is null then false
    when _key = 'data.scope.own_unit_only' then
      not coalesce(
        (select e.todas_unidades from ops.usuario_escopo e where e.user_id = _user_id),
        false
      )
    when exists (select 1 from ops.usuario_chaves n
                  where n.user_id = _user_id and n.permission_key = _key and not n.allowed)
         and not ops.eh_super_admin(_user_id) then false
    else
      exists (
        select 1
          from ops.user_roles ur
          join ops.role_areas  ra on ra.role = ur.role and ra.allowed
          join ops.area_chaves ac on ac.area = ra.area
          join ops.areas       a  on a.slug  = ra.area and a.ativa
         where ur.user_id = _user_id
           and ac.permission_key = _key
           -- área bloqueada para a pessoa não conta, exceto para super admin
           and (ur.role::text = 'admin' or not exists (
                 select 1 from ops.usuario_areas b
                  where b.user_id = _user_id and b.area = ra.area and not b.allowed))
      )
      or exists (
        select 1
          from ops.area_admins aa
          join ops.area_chaves ac on ac.area = aa.area
          join ops.areas       a  on a.slug  = aa.area and a.ativa
         where aa.user_id = _user_id
           and ac.permission_key = _key
      )
      or exists (
        select 1
          from ops.usuario_areas ua
          join ops.area_chaves    ac on ac.area = ua.area
          join ops.areas          a  on a.slug  = ua.area and a.ativa
          join ops.usuario_chaves uc on uc.user_id = ua.user_id
                                    and uc.permission_key = ac.permission_key
                                    and uc.allowed
         where ua.user_id = _user_id
           and ua.allowed
           and ac.permission_key = _key
      )
  end
$function$

;

CREATE OR REPLACE FUNCTION ops.acesso_do_usuario(_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare
  _areas text[];
  _chaves text[];
  _super boolean := ops.eh_super_admin(_user);
begin
  if _user is null then
    return jsonb_build_object('areas', '[]'::jsonb, 'permissions', '[]'::jsonb);
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and _user is distinct from auth.uid()
     and not ops.eh_super_admin(auth.uid()) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct x.area order by x.area), '{}') into _areas
    from (
      select ra.area
        from ops.user_roles ur
        join ops.role_areas ra on ra.role = ur.role and ra.allowed
       where ur.user_id = _user
         and (_super or not exists (
               select 1 from ops.usuario_areas b
                where b.user_id = _user and b.area = ra.area and not b.allowed))
      union
      select area from ops.area_admins where user_id = _user
      union
      select area from ops.usuario_areas where user_id = _user and allowed
    ) x
    join ops.areas a on a.slug = x.area and a.ativa;

  select coalesce(array_agg(distinct k.permission_key order by k.permission_key), '{}') into _chaves
    from (select distinct permission_key from ops.area_chaves) k
   where ops.can_user(_user, k.permission_key);

  return jsonb_build_object('areas', to_jsonb(_areas), 'permissions', to_jsonb(_chaves));
end
$function$

;

CREATE OR REPLACE FUNCTION ops.minha_pessoa_id()
 RETURNS bigint
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
  select id from gente_pessoas where user_id = auth.uid() limit 1
$function$

;

CREATE OR REPLACE FUNCTION ops.e_gestor_de(_pessoa_id bigint)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
  with recursive eu as (
    select id from gente_pessoas where user_id = auth.uid()
  ),
  cadeia as (
    select p.id, p.gestor_id, 1 as nivel
      from gente_pessoas p
     where p.id = _pessoa_id
    union all
    select p.id, p.gestor_id, c.nivel + 1
      from gente_pessoas p
      join cadeia c on p.id = c.gestor_id
     where c.nivel < 12
  )
  select exists (
    select 1 from cadeia c join eu on eu.id = c.id where c.nivel > 1
  )
$function$

;

CREATE OR REPLACE FUNCTION ops.nivel_na_area(_user uuid, _area text)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
  select case
    when _user is null then 0
    when ops.eh_super_admin(_user) then 4
    when exists (select 1 from ops.area_admins
                  where user_id = _user and area = _area and nivel = 'admin') then 3
    when exists (select 1 from ops.area_admins
                  where user_id = _user and area = _area and nivel = 'socio') then 2
    when exists (select 1 from ops.usuario_areas
                  where user_id = _user and area = _area and not allowed) then 0
    when exists (select 1 from ops.usuario_areas
                  where user_id = _user and area = _area and allowed) then 1
    when exists (select 1
                   from ops.user_roles ur
                   join ops.role_areas ra on ra.role = ur.role and ra.allowed
                  where ur.user_id = _user and ra.area = _area) then 1
    else 0
  end
$function$

;

CREATE OR REPLACE FUNCTION ops.pode_administrar(_ator uuid, _alvo uuid, _area text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
  select case
    when _ator is null or _alvo is null then false
    when ops.eh_super_admin(_ator) then true
    when _ator = _alvo then false
    when ops.eh_super_admin(_alvo) then false
    else
      ops.nivel_na_area(_ator, _area) >= 2
      and ops.nivel_na_area(_alvo, _area) < ops.nivel_na_area(_ator, _area)
      and (
        ops.nivel_na_area(_ator, _area) = 3
        -- Sócio: o alvo precisa TER unidade, e todas dentro das dele. Sem a
        -- primeira condição, quem não tem unidade nenhuma caberia "no vazio"
        -- e ficaria administrável por qualquer sócio.
        or (exists (select 1 from ops.usuario_unidades where user_id = _alvo)
            and ops.escopo_contido(_alvo, _ator))
      )
  end
$function$

;

CREATE OR REPLACE FUNCTION ops.acesso_adicionar_na_area(_alvo uuid, _area text, _unidades integer[] DEFAULT '{}'::integer[], _chaves text[] DEFAULT '{}'::text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
declare
  _ator uuid := auth.uid();
  _nivel_ator int := ops.nivel_na_area(_ator, _area);
  _em_branco boolean;
  _u int;
begin
  if _ator is null then raise exception 'Sessão ausente.' using errcode = '42501'; end if;
  if not exists (select 1 from ops.areas where slug = _area and ativa) then
    raise exception 'Área % não existe.', _area using errcode = '22023';
  end if;

  if _nivel_ator < 4 then
    if _nivel_ator < 2 then
      raise exception 'Você não administra a área %.', _area using errcode = '42501';
    end if;
    if _ator = _alvo or ops.eh_super_admin(_alvo) then
      raise exception 'Você não pode alterar este acesso.' using errcode = '42501';
    end if;
    if ops.nivel_na_area(_alvo, _area) >= _nivel_ator then
      raise exception 'Esta pessoa está no seu nível ou acima dele nesta área.' using errcode = '42501';
    end if;

    if _nivel_ator = 2 then
      if coalesce(array_length(_unidades, 1), 0) = 0 then
        raise exception 'Informe a unidade da pessoa.' using errcode = '22023';
      end if;
      foreach _u in array _unidades loop
        if not coalesce((select todas_unidades from ops.usuario_escopo where user_id = _ator), false)
           and not exists (select 1 from ops.usuario_unidades where user_id = _ator and unidade_id = _u) then
          raise exception 'A unidade % não é sua.', _u using errcode = '42501';
        end if;
      end loop;

      -- Conta em branco: sem papel, sem delegação, sem área, sem unidade.
      _em_branco :=
        not exists (select 1 from ops.user_roles where user_id = _alvo)
        and not exists (select 1 from ops.area_admins where user_id = _alvo)
        and not exists (select 1 from ops.usuario_areas where user_id = _alvo)
        and not exists (select 1 from ops.usuario_unidades where user_id = _alvo)
        and not coalesce((select todas_unidades from ops.usuario_escopo where user_id = _alvo), false);

      if not _em_branco and not ops.pode_administrar(_ator, _alvo, _area) then
        raise exception 'Esta pessoa pertence a outra unidade ou a outro nível.' using errcode = '42501';
      end if;
    end if;
  end if;

  if _nivel_ator < 4 and exists (select 1 from ops.usuario_areas
                                   where user_id = _alvo and area = _area and not allowed) then
    raise exception 'O super admin bloqueou esta área para esta pessoa.' using errcode = '42501';
  end if;

  perform ops._acesso_validar_chaves(_ator, _area, _chaves);

  insert into ops.usuario_escopo (user_id, todas_unidades, todas_empresas)
  values (_alvo, false, false)
  on conflict (user_id) do nothing;

  insert into ops.usuario_unidades (user_id, unidade_id)
  select _alvo, u from unnest(coalesce(_unidades, '{}')) u
  on conflict do nothing;

  insert into ops.usuario_areas (user_id, area, allowed, concedido_por)
  values (_alvo, _area, true, _ator)
  on conflict (user_id, area) do update
    set allowed = true, concedido_por = excluded.concedido_por, atualizado_em = now();

  insert into ops.usuario_chaves (user_id, permission_key, allowed, concedido_por)
  select _alvo, k, true, _ator from unnest(coalesce(_chaves, '{}')) k
  on conflict (user_id, permission_key) do update
    set allowed = true, concedido_por = excluded.concedido_por, atualizado_em = now();

  perform ops._acesso_log(_alvo, 'adicionar_na_area', _area,
    jsonb_build_object('unidades', _unidades, 'chaves', _chaves));
end
$function$

;

CREATE OR REPLACE FUNCTION ops.acesso_remover_da_area(_alvo uuid, _area text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
declare
  _ator uuid := auth.uid();
begin
  if not ops.pode_administrar(_ator, _alvo, _area) then
    raise exception 'Você não pode alterar o acesso desta pessoa nesta área.' using errcode = '42501';
  end if;

  delete from ops.usuario_chaves
   where user_id = _alvo
     and permission_key in (select ops._acesso_chaves_so_desta_area(_alvo, _area));
  -- Só a participação: o bloqueio do super admin fica.
  delete from ops.usuario_areas where user_id = _alvo and area = _area and allowed;
  delete from ops.area_admins  where user_id = _alvo and area = _area;

  perform ops._acesso_log(_alvo, 'remover_da_area', _area, '{}'::jsonb);

  return not exists (select 1 from ops.user_roles    where user_id = _alvo)
     and not exists (select 1 from ops.area_admins   where user_id = _alvo)
     and not exists (select 1 from ops.usuario_areas where user_id = _alvo and allowed);
end
$function$

;

CREATE OR REPLACE FUNCTION ops.acesso_nomear(_alvo uuid, _area text, _nivel text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
declare
  _ator uuid := auth.uid();
begin
  if _nivel not in ('admin', 'socio') then
    raise exception 'Nível inválido: %.', _nivel using errcode = '22023';
  end if;
  if not exists (select 1 from ops.areas where slug = _area and ativa) then
    raise exception 'Área % não existe.', _area using errcode = '22023';
  end if;
  if _nivel = 'admin' and not ops.eh_super_admin(_ator) then
    raise exception 'Só o super admin nomeia admin.' using errcode = '42501';
  end if;
  if _nivel = 'socio' and ops.nivel_na_area(_ator, _area) < 3 then
    raise exception 'Só o admin da área nomeia sócio.' using errcode = '42501';
  end if;
  if ops.eh_super_admin(_alvo) or (_ator = _alvo and not ops.eh_super_admin(_ator)) then
    raise exception 'Você não pode alterar este acesso.' using errcode = '42501';
  end if;
  if _nivel = 'socio' and ops.nivel_na_area(_alvo, _area) >= 3 then
    raise exception 'Esta pessoa já administra a área num nível acima.' using errcode = '42501';
  end if;
  if _nivel = 'socio' and not exists (select 1 from ops.usuario_unidades where user_id = _alvo) then
    raise exception 'Defina a unidade do sócio antes de nomeá-lo.' using errcode = '22023';
  end if;

  if not ops.eh_super_admin(_ator) and exists (
       select 1 from ops.usuario_areas where user_id = _alvo and area = _area and not allowed) then
    raise exception 'O super admin bloqueou esta área para esta pessoa.' using errcode = '42501';
  end if;

  insert into ops.area_admins (user_id, area, nivel, concedido_por)
  values (_alvo, _area, _nivel, _ator)
  on conflict (user_id, area) do update
    set nivel = excluded.nivel, concedido_por = excluded.concedido_por, criado_em = now();

  insert into ops.usuario_areas (user_id, area, allowed, concedido_por)
  values (_alvo, _area, true, _ator)
  on conflict (user_id, area) do update set allowed = true, atualizado_em = now();

  -- Admin vê todas as unidades e empresas, sempre (decisão 9).
  if _nivel = 'admin' then
    insert into ops.usuario_escopo (user_id, todas_unidades, todas_empresas)
    values (_alvo, true, true)
    on conflict (user_id) do update set todas_unidades = true, todas_empresas = true;
  else
    insert into ops.usuario_escopo (user_id, todas_unidades, todas_empresas)
    values (_alvo, false, false)
    on conflict (user_id) do nothing;
  end if;

  perform ops._acesso_log(_alvo, 'nomear', _area, jsonb_build_object('nivel', _nivel));
end
$function$

;

CREATE OR REPLACE FUNCTION ops.acesso_definir_unidades(_alvo uuid, _unidades integer[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
declare
  _ator uuid := auth.uid();
begin
  if not ops.eh_super_admin(_ator) and not exists (
    select 1 from ops.area_admins aa
     where aa.user_id = _ator and aa.nivel = 'admin'
       and ops.nivel_na_area(_alvo, aa.area) < 3
       and ops.pode_administrar(_ator, _alvo, aa.area)
  ) then
    raise exception 'Você não pode alterar as unidades desta pessoa.' using errcode = '42501';
  end if;

  insert into ops.usuario_escopo (user_id, todas_unidades, todas_empresas)
  values (_alvo, false, false)
  on conflict (user_id) do nothing;

  delete from ops.usuario_unidades
   where user_id = _alvo and unidade_id <> all (coalesce(_unidades, '{}'));
  insert into ops.usuario_unidades (user_id, unidade_id)
  select _alvo, u from unnest(coalesce(_unidades, '{}')) u
  on conflict do nothing;

  perform ops._acesso_log(_alvo, 'definir_unidades', null, jsonb_build_object('unidades', _unidades));
end
$function$;

-- Funções novas que as antigas não usam mais (depois de recriar as antigas).
drop function if exists ops._alvo_so_nas_areas_do_ator(uuid, uuid);
drop function if exists ops.tem_porta_da_chave(uuid, text);
drop function if exists ops.pessoa_ativa(uuid);

alter function ops.tem_papel(text) set search_path to 'ops, public';

drop policy if exists areas_write on ops.areas;
create policy areas_write on ops.areas for all to authenticated using (can('view.admin.permissions'::text)) with check (can('view.admin.permissions'::text));
drop policy if exists area_chaves_write on ops.area_chaves;
create policy area_chaves_write on ops.area_chaves for all to authenticated using (can('view.admin.permissions'::text)) with check (can('view.admin.permissions'::text));
drop policy if exists role_areas_write on ops.role_areas;
create policy role_areas_write on ops.role_areas for all to authenticated using (can('view.admin.permissions'::text)) with check (can('view.admin.permissions'::text));
drop policy if exists usuario_escopo_write on ops.usuario_escopo;
create policy usuario_escopo_write on ops.usuario_escopo for all to authenticated using (can('view.admin.users'::text)) with check (can('view.admin.users'::text));
drop policy if exists usuario_unidades_write on ops.usuario_unidades;
create policy usuario_unidades_write on ops.usuario_unidades for all to authenticated using (can('view.admin.users'::text)) with check (can('view.admin.users'::text));
drop policy if exists usuario_empresas_write on ops.usuario_empresas;
create policy usuario_empresas_write on ops.usuario_empresas for all to authenticated using (can('view.admin.users'::text)) with check (can('view.admin.users'::text));

alter table ops.acesso_pedidos drop constraint if exists acesso_pedidos_decidido_por_fkey;
alter table ops.acesso_pedidos add constraint acesso_pedidos_decidido_por_fkey FOREIGN KEY (decidido_por) REFERENCES auth.users(id);
alter table ops.monetizacao_audit drop constraint if exists monetizacao_audit_actor_id_fkey;
alter table ops.monetizacao_audit add constraint monetizacao_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id);
alter table ops.monetizacao_listas drop constraint if exists monetizacao_listas_validated_by_fkey;
alter table ops.monetizacao_listas add constraint monetizacao_listas_validated_by_fkey FOREIGN KEY (validated_by) REFERENCES auth.users(id);
alter table public.produto_acesso drop constraint if exists produto_acesso_concedido_por_fkey;
alter table public.produto_acesso add constraint produto_acesso_concedido_por_fkey FOREIGN KEY (concedido_por) REFERENCES auth.users(id);
