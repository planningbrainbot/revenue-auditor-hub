-- Travas da gestão de acessos (auditoria de 24/09/2026).
--
-- A auditoria achou três furos no banco, e esta migration fecha os três sem
-- reescrever nenhuma das 392 policies do schema `ops`:
--
-- 1. DESLIGAR NÃO DESLIGAVA. `profiles.ativo = false` e a porta do produto
--    fechada só valiam nas 202 policies que perguntam `tem_produto()`. As
--    outras 162 (Gente inteiro, contratos, Omie, financeiro_dashboard) decidem
--    por `can()`, pelas funções de nível ou por `minha_pessoa_id()`, e nenhuma
--    delas olhava se a pessoa ainda estava ativa. Quem tinha sessão aberta
--    continuava lendo. A trava entra nessas funções centrais, e com isso as
--    162 passam a respeitar o desligamento de uma vez.
--
-- 2. ADMIN DE ÁREA ALCANÇAVA QUALQUER UM. `pode_administrar` no nível 3 só
--    exigia que o alvo estivesse abaixo, e quem nem é da área está no nível 0.
--    O admin de People podia reescrever as unidades de um sócio de Clientes.
--    Agora o alvo tem de ser da área (ou conta em branco, no convite).
--
-- 3. DUAS ESCRITAS DESFAZIAM DECISÃO DO SUPER ADMIN. Tirar alguém da área
--    apagava também as páginas que o super admin tinha NEGADO a essa pessoa. E
--    nomear admin marcava "todas as unidades e empresas" (decisão 9, que fica)
--    sem nada que desfizesse isso no rebaixamento.
--
-- Mais: desativar e reativar pessoa pelo banco (com log e derrubando as
-- sessões abertas), a Administração deixa de ser delegável, as policies de
-- escrita da matriz passam a pedir super admin (antes pediam uma chave que a
-- tela nunca exigiu), e as FKs que faziam "Excluir" falhar sem explicação.
--
-- Nada muda para quem está ativo e com a porta aberta: o gate
-- `supabase/gates/20260925_acessos_travas.sql` compara todas as pessoas ×
-- todas as chaves antes e depois.

set search_path to ops, public;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Pessoa ativa
-- ─────────────────────────────────────────────────────────────────────────

create or replace function ops.pessoa_ativa(_user uuid)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $function$
  select exists (select 1 from public.profiles p where p.user_id = _user and p.ativo)
$function$;

create or replace function ops.eh_super_admin(_user uuid)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $function$
  select exists (
    select 1 from ops.user_roles where user_id = _user and role::text = 'admin'
  ) and ops.pessoa_ativa(_user)
$function$;

-- A PORTA de uma chave. Toda chave de `area_chaves` é do Ops, exceto as que
-- moram SÓ nas áreas do Financeiro: essas abrem com a porta do Financeiro, que
-- é como entra quem só usa o cockpit. Uma chave que também mora numa área do
-- Ops exige a porta do Ops.
create or replace function ops.tem_porta_da_chave(_user uuid, _key text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $function$
  select exists (
    select 1 from public.produto_acesso pa
     where pa.user_id = _user
       and (
         pa.produto = 'ops'
         or (pa.produto = 'financeiro'
             and exists (select 1 from ops.area_chaves x where x.permission_key = _key)
             and not exists (select 1 from ops.area_chaves x
                              where x.permission_key = _key
                                and x.area not in ('financeiro', 'admin_financeiro')))
       )
  )
$function$;

create or replace function ops.can_user(_user_id uuid, _key text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select case
    when _user_id is null then false
    -- Desativada: nenhuma chave, e o recorte fecha (a trava de unidade liga).
    when not ops.pessoa_ativa(_user_id) then _key = 'data.scope.own_unit_only'
    when _key = 'data.scope.own_unit_only' then
      not coalesce(
        (select e.todas_unidades from ops.usuario_escopo e where e.user_id = _user_id),
        false
      )
    -- Porta fechada: o papel e as áreas continuam guardados (reabrir devolve a
    -- pessoa como estava), mas não abrem nada.
    when not ops.tem_porta_da_chave(_user_id, _key) then false
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
$function$;

-- O menu segue a mesma regra: desativado não tem área nenhuma, e sem a porta
-- do Ops só sobram as áreas do Financeiro (para o /inicio levar ao cockpit).
create or replace function ops.acesso_do_usuario(_user uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
declare
  _areas text[];
  _chaves text[];
  _super boolean := ops.eh_super_admin(_user);
  _ops boolean;
  _fin boolean;
begin
  if _user is null then
    return jsonb_build_object('areas', '[]'::jsonb, 'permissions', '[]'::jsonb);
  end if;
  if coalesce(auth.role(), '') <> 'service_role'
     and _user is distinct from auth.uid()
     and not ops.eh_super_admin(auth.uid()) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  if not ops.pessoa_ativa(_user) then
    return jsonb_build_object('areas', '[]'::jsonb, 'permissions', '[]'::jsonb);
  end if;

  _ops := exists (select 1 from public.produto_acesso where user_id = _user and produto = 'ops');
  _fin := exists (select 1 from public.produto_acesso where user_id = _user and produto = 'financeiro');

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
    join ops.areas a on a.slug = x.area and a.ativa
   where _ops or (_fin and x.area in ('financeiro', 'admin_financeiro'));

  select coalesce(array_agg(distinct k.permission_key order by k.permission_key), '{}') into _chaves
    from (select distinct permission_key from ops.area_chaves) k
   where ops.can_user(_user, k.permission_key);

  return jsonb_build_object('areas', to_jsonb(_areas), 'permissions', to_jsonb(_chaves));
end
$function$;

-- Gente: 1:1, feedback, elogio, PDI e prioridades decidem por "é a MINHA
-- pessoa" ou "sou gestor dela". Desativado não tem pessoa.
create or replace function ops.minha_pessoa_id()
returns bigint language sql stable security definer
set search_path to 'ops', 'public'
as $function$
  select id from gente_pessoas
   where user_id = auth.uid() and ops.pessoa_ativa(auth.uid())
   limit 1
$function$;

create or replace function ops.e_gestor_de(_pessoa_id bigint)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $function$
  with recursive eu as (
    select id from gente_pessoas
     where user_id = auth.uid() and ops.pessoa_ativa(auth.uid())
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Quem administra quem
-- ─────────────────────────────────────────────────────────────────────────

create or replace function ops.nivel_na_area(_user uuid, _area text)
returns integer language sql stable security definer
set search_path to 'ops', 'public'
as $function$
  select case
    when _user is null then 0
    when not ops.pessoa_ativa(_user) then 0
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
$function$;

-- Regra nova: o delegado (sócio ou admin) só administra quem JÁ É da área.
-- Antes o admin (nível 3) alcançava qualquer pessoa que não fosse admin, e
-- como as unidades valem para todas as áreas, o admin de People reescrevia o
-- recorte de quem só é de Clientes. Quem ainda não é da área entra pelo
-- convite (`acesso_adicionar_na_area`), que tem regra própria.
--
-- Desativado e super admin (mesmo desativado) só o super admin mexe. A
-- Administração nunca é delegada.
create or replace function ops.pode_administrar(_ator uuid, _alvo uuid, _area text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $function$
  select case
    when _ator is null or _alvo is null then false
    when ops.eh_super_admin(_ator) then true
    when _ator = _alvo then false
    when exists (select 1 from ops.user_roles where user_id = _alvo and role::text = 'admin') then false
    when not ops.pessoa_ativa(_alvo) then false
    when _area = 'admin' then false
    else
      ops.nivel_na_area(_ator, _area) >= 2
      and ops.nivel_na_area(_alvo, _area) >= 1
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
$function$;

-- O recorte (unidades) vale em TODAS as áreas da pessoa. Então só mexe nele
-- quem responde por todas elas: o alvo não pode ter acesso em área que o ator
-- não administra como admin. Sem isto, o admin de People convidava alguém de
-- Clientes para People sem unidades e, no passo seguinte, já "da área",
-- reescrevia o recorte dele (revisão de 25/09/2026).
create or replace function ops._alvo_so_nas_areas_do_ator(_alvo uuid, _ator uuid)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $function$
  select ops.eh_super_admin(_ator) or not exists (
    select 1 from ops.areas a
     where a.ativa
       and ops.nivel_na_area(_alvo, a.slug) >= 1
       and ops.nivel_na_area(_ator, a.slug) < 3
  )
$function$;

revoke all on function ops._alvo_so_nas_areas_do_ator(uuid, uuid) from public, anon, authenticated;

create or replace function ops.acesso_adicionar_na_area(
  _alvo uuid, _area text, _unidades integer[] default '{}'::integer[], _chaves text[] default '{}'::text[])
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $function$
declare
  _ator uuid := auth.uid();
  _nivel_ator int := ops.nivel_na_area(_ator, _area);
  _em_branco boolean;
  _u int;
begin
  if _ator is null then raise exception 'Sessão ausente.' using errcode = '42501'; end if;
  if _area = 'admin' then
    raise exception 'A Administração só se concede pelo perfil Super admin.' using errcode = '42501';
  end if;
  if not exists (select 1 from ops.areas where slug = _area and ativa) then
    raise exception 'Área % não existe.', _area using errcode = '22023';
  end if;

  if _nivel_ator < 4 then
    if _nivel_ator < 2 then
      raise exception 'Você não administra a área %.', _area using errcode = '42501';
    end if;
    if _ator = _alvo or exists (select 1 from ops.user_roles where user_id = _alvo and role::text = 'admin') then
      raise exception 'Você não pode alterar este acesso.' using errcode = '42501';
    end if;
    if not ops.pessoa_ativa(_alvo) then
      raise exception 'Esta conta está desativada. Só o super admin reativa.' using errcode = '42501';
    end if;
    if ops.nivel_na_area(_alvo, _area) >= _nivel_ator then
      raise exception 'Esta pessoa está no seu nível ou acima dele nesta área.' using errcode = '42501';
    end if;

    -- Conta em branco: sem papel, sem delegação, sem área, sem unidade.
    _em_branco :=
      not exists (select 1 from ops.user_roles where user_id = _alvo)
      and not exists (select 1 from ops.area_admins where user_id = _alvo)
      and not exists (select 1 from ops.usuario_areas where user_id = _alvo)
      and not exists (select 1 from ops.usuario_unidades where user_id = _alvo)
      and not coalesce((select todas_unidades from ops.usuario_escopo where user_id = _alvo), false);

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

      if not _em_branco
         and not (exists (select 1 from ops.usuario_unidades where user_id = _alvo)
                  and ops.escopo_contido(_alvo, _ator)) then
        raise exception 'Esta pessoa pertence a outra unidade ou a outro nível.' using errcode = '42501';
      end if;
    else
      -- Admin da área convida quem quiser para ELA, mas só mexe no recorte de
      -- quem está em branco ou já é da área. Para os outros, as unidades valem
      -- em áreas que ele não administra.
      if not _em_branco
         and not ops._alvo_so_nas_areas_do_ator(_alvo, _ator)
         and exists (
           select 1 from unnest(coalesce(_unidades, '{}')) u
            where not exists (select 1 from ops.usuario_unidades x
                               where x.user_id = _alvo and x.unidade_id = u)) then
        raise exception 'Esta pessoa já tem acesso fora da sua área: convide sem mudar as unidades dela.'
          using errcode = '42501';
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
$function$;

-- Só redefine as unidades de alguém quem administra (como admin) todas as
-- áreas dessa pessoa. Mesma razão de `_alvo_so_nas_areas_do_ator`.
create or replace function ops.acesso_definir_unidades(_alvo uuid, _unidades integer[])
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $function$
declare
  _ator uuid := auth.uid();
begin
  if not ops.eh_super_admin(_ator) and not (
    exists (
      select 1 from ops.area_admins aa
       where aa.user_id = _ator and aa.nivel = 'admin'
         and ops.nivel_na_area(_alvo, aa.area) < 3
         and ops.pode_administrar(_ator, _alvo, aa.area)
    )
    and ops._alvo_so_nas_areas_do_ator(_alvo, _ator)
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

-- Tirar da área apaga as páginas LIBERADAS, nunca as NEGADAS. A negação é do
-- super admin (ou de quem administra) e tem de sobreviver a sair e voltar.
create or replace function ops.acesso_remover_da_area(_alvo uuid, _area text)
returns boolean language plpgsql security definer
set search_path to 'ops', 'public'
as $function$
declare
  _ator uuid := auth.uid();
begin
  if not ops.pode_administrar(_ator, _alvo, _area) then
    raise exception 'Você não pode alterar o acesso desta pessoa nesta área.' using errcode = '42501';
  end if;

  delete from ops.usuario_chaves
   where user_id = _alvo and allowed
     and permission_key in (select ops._acesso_chaves_so_desta_area(_alvo, _area));
  -- Só a participação: o bloqueio do super admin fica.
  delete from ops.usuario_areas where user_id = _alvo and area = _area and allowed;
  delete from ops.area_admins  where user_id = _alvo and area = _area;

  perform ops._acesso_log(_alvo, 'remover_da_area', _area, '{}'::jsonb);

  return not exists (select 1 from ops.user_roles    where user_id = _alvo)
     and not exists (select 1 from ops.area_admins   where user_id = _alvo)
     and not exists (select 1 from ops.usuario_areas where user_id = _alvo and allowed);
end
$function$;

create or replace function ops.acesso_nomear(_alvo uuid, _area text, _nivel text)
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $function$
declare
  _ator uuid := auth.uid();
begin
  if _nivel not in ('admin', 'socio') then
    raise exception 'Nível inválido: %.', _nivel using errcode = '22023';
  end if;
  if _area = 'admin' then
    raise exception 'A Administração só se concede pelo perfil Super admin.' using errcode = '42501';
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
  if exists (select 1 from ops.user_roles where user_id = _alvo and role::text = 'admin')
     or (_ator = _alvo and not ops.eh_super_admin(_ator)) then
    raise exception 'Você não pode alterar este acesso.' using errcode = '42501';
  end if;
  if not ops.pessoa_ativa(_alvo) then
    raise exception 'Esta conta está desativada. Reative antes de nomear.' using errcode = '42501';
  end if;
  -- Rebaixar admin a sócio é do super admin. Antes esta checagem valia para
  -- ele também, e a tela de Acessos recusava o rebaixamento com esta mesma
  -- mensagem.
  if _nivel = 'socio' and ops.nivel_na_area(_alvo, _area) >= 3 and not ops.eh_super_admin(_ator) then
    raise exception 'Esta pessoa já administra a área num nível acima.' using errcode = '42501';
  end if;
  if _nivel = 'socio' and not exists (select 1 from ops.usuario_unidades where user_id = _alvo) then
    raise exception 'Defina a unidade do sócio antes de nomeá-lo.' using errcode = '22023';
  end if;
  -- O admin da área só nomeia sócio quem já é da área dele.
  if _nivel = 'socio' and not ops.eh_super_admin(_ator)
     and not ops.pode_administrar(_ator, _alvo, _area) then
    raise exception 'Esta pessoa não é da sua área.' using errcode = '42501';
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

  -- Admin vê todas as unidades e empresas, sempre (decisão 9). O recorte de
  -- antes fica guardado em `area_admins.escopo_anterior` pelo gatilho abaixo,
  -- e volta sozinho quando a pessoa deixa de ser admin de qualquer área.
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. O recorte de antes de virar admin volta quando o admin sai
-- ─────────────────────────────────────────────────────────────────────────
--
-- Gatilho e não código em cada função: admin sai por `acesso_nomear`
-- (rebaixado a sócio), `acesso_remover_da_area`, `acesso_bloquear_area` e pela
-- escrita direta do super admin. Um gatilho cobre os quatro.
--
-- Quem já era admin antes desta migration fica com `escopo_anterior` nulo e
-- nada volta para ele: não há como saber o que ele tinha.

alter table ops.area_admins add column if not exists escopo_anterior jsonb;

create or replace function ops._area_admins_guarda_escopo()
returns trigger language plpgsql security definer
set search_path to 'ops', 'public'
as $function$
declare
  _outro ops.area_admins;
begin
  if new.nivel = 'admin' and (tg_op = 'INSERT' or old.nivel is distinct from 'admin') then
    select * into _outro from ops.area_admins
     where user_id = new.user_id and nivel = 'admin' and area <> new.area
     limit 1;
    if found then
      -- Já era admin de outra área: o recorte de hoje já é o de admin, então o
      -- "de antes" é o que essa outra linha guardou.
      new.escopo_anterior := _outro.escopo_anterior;
    else
      new.escopo_anterior := coalesce(
        (select jsonb_build_object('existia', true,
                                   'todas_unidades', e.todas_unidades,
                                   'todas_empresas', e.todas_empresas)
           from ops.usuario_escopo e where e.user_id = new.user_id),
        '{"existia": false}'::jsonb);
    end if;
  end if;
  return new;
end
$function$;

create or replace function ops._area_admins_devolve_escopo()
returns trigger language plpgsql security definer
set search_path to 'ops', 'public'
as $function$
begin
  if old.nivel = 'admin'
     and (tg_op = 'DELETE' or new.nivel is distinct from 'admin')
     and old.escopo_anterior is not null
     and not exists (select 1 from ops.area_admins
                      where user_id = old.user_id and nivel = 'admin'
                        and not (area = old.area and tg_op = 'UPDATE')) then
    update ops.usuario_escopo
       set todas_unidades = coalesce((old.escopo_anterior->>'todas_unidades')::boolean, false),
           todas_empresas = coalesce((old.escopo_anterior->>'todas_empresas')::boolean, false),
           updated_at = now()
     where user_id = old.user_id;
    perform ops._acesso_log(old.user_id, 'escopo_devolvido', old.area, old.escopo_anterior);
  end if;
  return null;
end
$function$;

drop trigger if exists area_admins_guarda_escopo on ops.area_admins;
create trigger area_admins_guarda_escopo
  before insert or update of nivel on ops.area_admins
  for each row execute function ops._area_admins_guarda_escopo();

drop trigger if exists area_admins_devolve_escopo on ops.area_admins;
create trigger area_admins_devolve_escopo
  after delete or update of nivel on ops.area_admins
  for each row execute function ops._area_admins_devolve_escopo();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Desativar e reativar
-- ─────────────────────────────────────────────────────────────────────────
--
-- Desativar é o desligamento: a pessoa sai dos três produtos na hora, mas
-- nada do que ela tinha é apagado (papel, áreas, recorte, portas). Reativar
-- devolve exatamente o que era. `ativo = false` fecha o banco (item 1) e
-- apagar `auth.sessions` derruba os refresh tokens em cascata, então ela não
-- renova a sessão. O banimento no Auth e o cockpit do Financeiro ficam com o
-- servidor, que tem a service role deles.

create or replace function ops.acesso_desativar(_alvo uuid, _motivo text default null)
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $function$
declare
  _ator uuid := auth.uid();
begin
  if not ops.eh_super_admin(_ator) then
    raise exception 'Só o super admin desativa uma conta.' using errcode = '42501';
  end if;
  if _alvo = _ator then
    raise exception 'Você não pode desativar a sua própria conta.' using errcode = '42501';
  end if;
  update public.profiles set ativo = false where user_id = _alvo;
  if not found then raise exception 'Pessoa não encontrada.' using errcode = '22023'; end if;
  delete from auth.sessions where user_id = _alvo;
  delete from ops.ver_como where user_id = _alvo;
  perform ops._acesso_log(_alvo, 'desativar', null,
    jsonb_build_object('motivo', nullif(trim(coalesce(_motivo, '')), '')));
end
$function$;

create or replace function ops.acesso_reativar(_alvo uuid)
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $function$
declare
  _ator uuid := auth.uid();
begin
  if not ops.eh_super_admin(_ator) then
    raise exception 'Só o super admin reativa uma conta.' using errcode = '42501';
  end if;
  update public.profiles set ativo = true where user_id = _alvo;
  if not found then raise exception 'Pessoa não encontrada.' using errcode = '22023'; end if;
  perform ops._acesso_log(_alvo, 'reativar', null, '{}'::jsonb);
end
$function$;

-- O log de quem administra do lado do servidor (criar conta, trocar perfil,
-- abrir porta, senha). Antes só as funções `acesso_*` escreviam no log, e a
-- metade mais sensível das ações não deixava rastro. Só a service role chama:
-- o ator vem do servidor, que já validou o token.
create or replace function ops.acesso_registrar(_ator uuid, _alvo uuid, _acao text, _detalhe jsonb default '{}'::jsonb)
returns void language sql security definer
set search_path to 'ops', 'public'
as $function$
  insert into ops.acessos_log (ator, alvo, acao, area, detalhe)
  values (_ator, _alvo, _acao, null, coalesce(_detalhe, '{}'::jsonb))
$function$;

revoke all on function ops.pessoa_ativa(uuid) from public, anon;
revoke all on function ops.tem_porta_da_chave(uuid, text) from public, anon;
revoke all on function ops.acesso_desativar(uuid, text) from public, anon;
revoke all on function ops.acesso_reativar(uuid) from public, anon;
revoke all on function ops.acesso_registrar(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function ops._area_admins_guarda_escopo() from public, anon, authenticated;
revoke all on function ops._area_admins_devolve_escopo() from public, anon, authenticated;
grant execute on function ops.pessoa_ativa(uuid) to authenticated, service_role;
grant execute on function ops.tem_porta_da_chave(uuid, text) to authenticated, service_role;
grant execute on function ops.acesso_desativar(uuid, text) to authenticated, service_role;
grant execute on function ops.acesso_reativar(uuid) to authenticated, service_role;
grant execute on function ops.acesso_registrar(uuid, uuid, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Uma definição de admin nas policies de escrita da matriz
-- ─────────────────────────────────────────────────────────────────────────
--
-- Estas seis pediam `can('view.admin.*')`, que vem da ÁREA Administração. As
-- server functions que escrevem nelas pedem o PERFIL admin. Quem ganhasse a
-- área por outro caminho gravaria direto pelo PostgREST, por exemplo dando ao
-- próprio perfil todas as áreas. Agora as duas camadas pedem a mesma coisa.

drop policy if exists role_areas_write on ops.role_areas;
create policy role_areas_write on ops.role_areas for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));

drop policy if exists areas_write on ops.areas;
create policy areas_write on ops.areas for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));

drop policy if exists area_chaves_write on ops.area_chaves;
create policy area_chaves_write on ops.area_chaves for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));

drop policy if exists usuario_escopo_write on ops.usuario_escopo;
create policy usuario_escopo_write on ops.usuario_escopo for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));

drop policy if exists usuario_unidades_write on ops.usuario_unidades;
create policy usuario_unidades_write on ops.usuario_unidades for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));

drop policy if exists usuario_empresas_write on ops.usuario_empresas;
create policy usuario_empresas_write on ops.usuario_empresas for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Excluir conta: as FKs que recusavam sem explicar
-- ─────────────────────────────────────────────────────────────────────────
--
-- Colunas de "quem fez", que podem ficar vazias quando a conta sai. As de
-- autoria obrigatória do Aquário (created_by, actor_id NOT NULL) ficam como
-- estão: quem já registrou trabalho se desativa, não se exclui, e o servidor
-- passa a dizer isso em vez de "Falha ao excluir".

alter table ops.acesso_pedidos drop constraint if exists acesso_pedidos_decidido_por_fkey;
alter table ops.acesso_pedidos add constraint acesso_pedidos_decidido_por_fkey
  foreign key (decidido_por) references auth.users(id) on delete set null;

alter table public.produto_acesso drop constraint if exists produto_acesso_concedido_por_fkey;
alter table public.produto_acesso add constraint produto_acesso_concedido_por_fkey
  foreign key (concedido_por) references auth.users(id) on delete set null;

alter table ops.monetizacao_listas drop constraint if exists monetizacao_listas_validated_by_fkey;
alter table ops.monetizacao_listas add constraint monetizacao_listas_validated_by_fkey
  foreign key (validated_by) references auth.users(id) on delete set null;

alter table ops.monetizacao_audit drop constraint if exists monetizacao_audit_actor_id_fkey;
alter table ops.monetizacao_audit add constraint monetizacao_audit_actor_id_fkey
  foreign key (actor_id) references auth.users(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Miudezas
-- ─────────────────────────────────────────────────────────────────────────

-- `SET search_path TO 'ops, public'` (aspas únicas) é UM schema chamado
-- "ops, public". A função qualifica a tabela e não quebrava, mas é a armadilha
-- que já derrubou 20 funções no port do banco único.
alter function ops.tem_papel(text) set search_path to 'ops', 'public';
