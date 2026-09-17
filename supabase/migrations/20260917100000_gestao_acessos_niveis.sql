-- Gestão de acessos por nível: super admin, admin, sócio e usuário
--
-- Plano: ~/Desktop/AI Projects/PLANO-ADMIN-DELEGADO.md (Fase 1). As 11 decisões
-- foram confirmadas pelo dono em 17/09/2026.
--
-- O que muda:
--
--   · A concessão deixa de ser só por PAPEL. Papel vale para a rede toda, então
--     o sócio do Rio não tinha como dar acesso a um colaborador sem mexer em
--     Curitiba junto. Agora existe concessão por PESSOA, em três tabelas:
--       area_admins    quem administra a área, e em que nível (admin | socio)
--       usuario_areas  quem é membro da área
--       usuario_chaves quais páginas o membro vê (allowed = true), e quais
--                      páginas foram negadas a alguém (allowed = false)
--
--   · Os níveis, por área:
--       super admin  papel `admin`. Acesso total, e o único que nomeia admin.
--       admin        todas as unidades e empresas, só nas áreas que recebeu.
--                    Nomeia sócios.
--       sócio        acesso total nas áreas e unidades que o admin liberou.
--                    Convida a equipe e libera páginas para ela.
--       usuário      só as páginas que recebeu. SÓ CONSULTA, por enquanto: a
--                    constraint de usuario_chaves só aceita chave `view.*`.
--
--   · Os limites moram AQUI, não na tela (decisão 4). Toda escrita delegada
--     passa por uma função `acesso_*` que confere nível e recorte. Escrita
--     direta nas tabelas novas é só do super admin.
--
--   · Três gravações eram liberadas por chave de VER. Ganham chave de operar,
--     concedida às mesmas áreas, para que "usuário só consulta" valha de fato:
--       nps (envio, pesquisa, ligação, gravação)  view.disparos_whatsapp -> edit.nps
--       feedback e 1:1 do Gente                   view.gente.*           -> edit.gente.conversas
--
-- Equivalência (decisão 11): as tabelas novas nascem vazias e as chaves novas
-- vão para as mesmas áreas das antigas. Ninguém ganha nem perde acesso nesta
-- migration. O gate que prova isso está em tools/gate_gestao_acessos.sql.

-- ─────────────────────────────────────────────────────────────
-- 1. Tabelas
-- ─────────────────────────────────────────────────────────────
create table if not exists ops.area_admins (
  user_id        uuid not null references auth.users(id) on delete cascade,
  area           text not null references ops.areas(slug) on delete cascade,
  nivel          text not null check (nivel in ('admin', 'socio')),
  concedido_por  uuid references auth.users(id) on delete set null,
  criado_em      timestamptz not null default now(),
  primary key (user_id, area)
);

create table if not exists ops.usuario_areas (
  user_id        uuid not null references auth.users(id) on delete cascade,
  area           text not null references ops.areas(slug) on delete cascade,
  allowed        boolean not null default true,
  concedido_por  uuid references auth.users(id) on delete set null,
  atualizado_em  timestamptz not null default now(),
  primary key (user_id, area)
);

create table if not exists ops.usuario_chaves (
  user_id         uuid not null references auth.users(id) on delete cascade,
  permission_key  text not null,
  allowed         boolean not null,
  concedido_por   uuid references auth.users(id) on delete set null,
  atualizado_em   timestamptz not null default now(),
  primary key (user_id, permission_key),
  -- Usuário só consulta (decisão de 17/09, "por enquanto"). Negar qualquer
  -- chave continua possível; conceder, só as de ver. Soltar esta constraint é
  -- o jeito de liberar operação para usuário no futuro.
  constraint usuario_chaves_usuario_so_consulta
    check (not allowed or permission_key like 'view.%')
);

create table if not exists ops.area_perfis (
  area       text not null references ops.areas(slug) on delete cascade,
  slug       text not null,
  nome       text not null,
  descricao  text,
  primary key (area, slug)
);

create table if not exists ops.area_perfil_chaves (
  area            text not null,
  perfil          text not null,
  permission_key  text not null,
  primary key (area, perfil, permission_key),
  foreign key (area, perfil) references ops.area_perfis(area, slug) on delete cascade,
  foreign key (area, permission_key) references ops.area_chaves(area, permission_key) on delete cascade
);

-- Delegar sem log é delegar no escuro.
create table if not exists ops.acessos_log (
  id        bigint generated always as identity primary key,
  ator      uuid,
  alvo      uuid,
  acao      text not null,
  area      text,
  detalhe   jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists acessos_log_alvo_idx on ops.acessos_log (alvo, criado_em desc);
create index if not exists area_admins_area_idx on ops.area_admins (area);
create index if not exists usuario_areas_area_idx on ops.usuario_areas (area);

-- ─────────────────────────────────────────────────────────────
-- 2. Quem é quem
-- ─────────────────────────────────────────────────────────────
create or replace function ops.eh_super_admin(_user uuid)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $$
  select exists (
    select 1 from ops.user_roles where user_id = _user and role::text = 'admin'
  )
$$;

-- 4 super admin · 3 admin · 2 sócio · 1 usuário · 0 fora da área.
-- Quem entra na área por PAPEL conta como usuário: o papel é modelo, não
-- delegação (decisão 11).
create or replace function ops.nivel_na_area(_user uuid, _area text)
returns int language sql stable security definer
set search_path to 'ops', 'public'
as $$
  select case
    when _user is null then 0
    when ops.eh_super_admin(_user) then 4
    when exists (select 1 from ops.area_admins
                  where user_id = _user and area = _area and nivel = 'admin') then 3
    when exists (select 1 from ops.area_admins
                  where user_id = _user and area = _area and nivel = 'socio') then 2
    when exists (select 1 from ops.usuario_areas
                  where user_id = _user and area = _area and allowed) then 1
    when exists (select 1
                   from ops.user_roles ur
                   join ops.role_areas ra on ra.role = ur.role and ra.allowed
                  where ur.user_id = _user and ra.area = _area) then 1
    else 0
  end
$$;

-- As unidades do alvo cabem nas do ator?
create or replace function ops.escopo_contido(_alvo uuid, _ator uuid)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $$
  select
    coalesce((select todas_unidades from ops.usuario_escopo where user_id = _ator), false)
    or (
      not coalesce((select todas_unidades from ops.usuario_escopo where user_id = _alvo), false)
      and not exists (
        select 1 from ops.usuario_unidades a
         where a.user_id = _alvo
           and not exists (select 1 from ops.usuario_unidades b
                            where b.user_id = _ator and b.unidade_id = a.unidade_id)
      )
    )
$$;

-- A regra de não escalada, uma só para os quatro níveis: cada um só mexe em
-- quem está abaixo dele na área, e o sócio só dentro das unidades dele.
create or replace function ops.pode_administrar(_ator uuid, _alvo uuid, _area text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public'
as $$
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
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. can_user: soma o que o papel dá, o que a delegação dá, e subtrai o negado
-- ─────────────────────────────────────────────────────────────
create or replace function ops.can_user(_user_id uuid, _key text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select case
    when _user_id is null then false
    -- Escopo, não permissão. Mantido igual ao corpo anterior, inclusive o
    -- coalesce: "sem linha" vale como LIMITADA.
    when _key = 'data.scope.own_unit_only' then
      not coalesce(
        (select e.todas_unidades from ops.usuario_escopo e where e.user_id = _user_id),
        false
      )
    -- Negação vence concessão (decisão 3). Super admin é imune: acesso total.
    when exists (select 1 from ops.usuario_chaves n
                  where n.user_id = _user_id and n.permission_key = _key and not n.allowed)
         and not ops.eh_super_admin(_user_id) then false
    else
      -- papel -> área (o caminho de sempre)
      exists (
        select 1
          from ops.user_roles ur
          join ops.role_areas  ra on ra.role = ur.role and ra.allowed
          join ops.area_chaves ac on ac.area = ra.area
          join ops.areas       a  on a.slug  = ra.area and a.ativa
         where ur.user_id = _user_id
           and ac.permission_key = _key
      )
      -- admin e sócio: acesso total na área que administram
      or exists (
        select 1
          from ops.area_admins aa
          join ops.area_chaves ac on ac.area = aa.area
          join ops.areas       a  on a.slug  = aa.area and a.ativa
         where aa.user_id = _user_id
           and ac.permission_key = _key
      )
      -- usuário: membro da área E a página foi liberada para ele
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

create or replace function ops.tem_area(_area text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select exists (
      select 1
        from ops.user_roles ur
        join ops.role_areas ra on ra.role = ur.role and ra.allowed
        join ops.areas      a  on a.slug  = ra.area and a.ativa
       where ur.user_id = auth.uid() and ra.area = _area
    )
    or exists (
      select 1 from ops.area_admins aa join ops.areas a on a.slug = aa.area and a.ativa
       where aa.user_id = auth.uid() and aa.area = _area
    )
    or exists (
      select 1 from ops.usuario_areas ua join ops.areas a on a.slug = ua.area and a.ativa
       where ua.user_id = auth.uid() and ua.area = _area and ua.allowed
    )
$function$;

-- O que o app precisa para montar menu e checar página, na MESMA regra do
-- can_user. Antes o app remontava isso em TypeScript lendo só role_areas, e
-- quem entrasse por delegação ficaria sem menu.
create or replace function ops.acesso_do_usuario(_user uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _areas text[];
  _chaves text[];
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
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. Escritas delegadas. Toda a checagem mora aqui.
-- ─────────────────────────────────────────────────────────────
create or replace function ops._acesso_log(_alvo uuid, _acao text, _area text, _detalhe jsonb)
returns void language sql security definer
set search_path to 'ops', 'public'
as $$
  insert into ops.acessos_log (ator, alvo, acao, area, detalhe)
  values (auth.uid(), _alvo, _acao, _area, coalesce(_detalhe, '{}'::jsonb))
$$;

-- As chaves pedidas são todas desta área, de ver, e o ator as tem?
create or replace function ops._acesso_validar_chaves(_ator uuid, _area text, _chaves text[])
returns void language plpgsql stable security definer
set search_path to 'ops', 'public'
as $$
declare
  _k text;
begin
  foreach _k in array coalesce(_chaves, '{}') loop
    if not exists (select 1 from ops.area_chaves where area = _area and permission_key = _k) then
      raise exception 'A página % não pertence à área %.', _k, _area using errcode = '22023';
    end if;
    if _k not like 'view.%' then
      raise exception 'Usuário só consulta: % não pode ser liberada.', _k using errcode = '42501';
    end if;
    if not ops.can_user(_ator, _k) then
      raise exception 'Você não pode liberar % porque não tem essa página.', _k using errcode = '42501';
    end if;
  end loop;
end
$$;

-- Chaves liberadas que pertencem a esta área e a NENHUMA outra área de que o
-- alvo é membro. É o que pode sair quando a área sai, sem derrubar a outra.
create or replace function ops._acesso_chaves_so_desta_area(_alvo uuid, _area text)
returns setof text language sql stable security definer
set search_path to 'ops', 'public'
as $$
  select ac.permission_key
    from ops.area_chaves ac
   where ac.area = _area
     and not exists (
       select 1
         from ops.area_chaves outra
         join ops.usuario_areas ua on ua.area = outra.area and ua.user_id = _alvo and ua.allowed
        where outra.permission_key = ac.permission_key
          and outra.area <> _area
     )
$$;

-- Convidar alguém para dentro da área, com unidades e páginas.
create or replace function ops.acesso_adicionar_na_area(
  _alvo uuid, _area text, _unidades int[] default '{}', _chaves text[] default '{}'
) returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $$
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
$$;

-- Trocar as páginas que um membro da área vê.
create or replace function ops.acesso_definir_paginas(_alvo uuid, _area text, _chaves text[])
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $$
declare
  _ator uuid := auth.uid();
begin
  if not ops.pode_administrar(_ator, _alvo, _area) then
    raise exception 'Você não pode alterar o acesso desta pessoa nesta área.' using errcode = '42501';
  end if;
  if not exists (select 1 from ops.usuario_areas where user_id = _alvo and area = _area and allowed) then
    raise exception 'Esta pessoa não é membro da área %.', _area using errcode = '22023';
  end if;
  perform ops._acesso_validar_chaves(_ator, _area, _chaves);

  delete from ops.usuario_chaves
   where user_id = _alvo and allowed
     and permission_key in (select ops._acesso_chaves_so_desta_area(_alvo, _area))
     and permission_key <> all (coalesce(_chaves, '{}'));

  insert into ops.usuario_chaves (user_id, permission_key, allowed, concedido_por)
  select _alvo, k, true, _ator from unnest(coalesce(_chaves, '{}')) k
  on conflict (user_id, permission_key) do update
    set allowed = true, concedido_por = excluded.concedido_por, atualizado_em = now();

  perform ops._acesso_log(_alvo, 'definir_paginas', _area, jsonb_build_object('chaves', _chaves));
end
$$;

-- Tirar alguém da área. Não desativa a conta: ela pode estar em outra área
-- (furo 2). Devolve true quando a pessoa ficou sem área nenhuma, para o
-- servidor desativar a conta.
create or replace function ops.acesso_remover_da_area(_alvo uuid, _area text)
returns boolean language plpgsql security definer
set search_path to 'ops', 'public'
as $$
declare
  _ator uuid := auth.uid();
begin
  if not ops.pode_administrar(_ator, _alvo, _area) then
    raise exception 'Você não pode alterar o acesso desta pessoa nesta área.' using errcode = '42501';
  end if;

  delete from ops.usuario_chaves
   where user_id = _alvo
     and permission_key in (select ops._acesso_chaves_so_desta_area(_alvo, _area));
  delete from ops.usuario_areas where user_id = _alvo and area = _area;
  delete from ops.area_admins  where user_id = _alvo and area = _area;

  perform ops._acesso_log(_alvo, 'remover_da_area', _area, '{}'::jsonb);

  return not exists (select 1 from ops.user_roles    where user_id = _alvo)
     and not exists (select 1 from ops.area_admins   where user_id = _alvo)
     and not exists (select 1 from ops.usuario_areas where user_id = _alvo and allowed);
end
$$;

-- Nomear admin (só super admin) ou sócio (super admin ou admin da área).
create or replace function ops.acesso_nomear(_alvo uuid, _area text, _nivel text)
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $$
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
$$;

-- As unidades de alguém: super admin, ou admin de uma área onde a pessoa está.
create or replace function ops.acesso_definir_unidades(_alvo uuid, _unidades int[])
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $$
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
$$;

-- Negar (ou devolver) uma página a alguém, inclusive a quem entra por papel.
create or replace function ops.acesso_negar_pagina(_alvo uuid, _chave text, _negar boolean)
returns void language plpgsql security definer
set search_path to 'ops', 'public'
as $$
declare
  _ator uuid := auth.uid();
begin
  if not exists (
    select 1 from ops.area_chaves ac
     where ac.permission_key = _chave
       and ops.pode_administrar(_ator, _alvo, ac.area)
  ) then
    raise exception 'Você não pode alterar esta página para esta pessoa.' using errcode = '42501';
  end if;
  if not ops.can_user(_ator, _chave) and not ops.eh_super_admin(_ator) then
    raise exception 'Você não tem a página %.', _chave using errcode = '42501';
  end if;

  if _negar then
    insert into ops.usuario_chaves (user_id, permission_key, allowed, concedido_por)
    values (_alvo, _chave, false, _ator)
    on conflict (user_id, permission_key) do update
      set allowed = false, concedido_por = excluded.concedido_por, atualizado_em = now();
  else
    delete from ops.usuario_chaves
     where user_id = _alvo and permission_key = _chave and not allowed;
  end if;

  perform ops._acesso_log(_alvo, case when _negar then 'negar_pagina' else 'devolver_pagina' end,
    null, jsonb_build_object('chave', _chave));
end
$$;

-- ─────────────────────────────────────────────────────────────
-- 5. RLS das tabelas novas
-- ─────────────────────────────────────────────────────────────
alter table ops.area_admins        enable row level security;
alter table ops.usuario_areas      enable row level security;
alter table ops.usuario_chaves     enable row level security;
alter table ops.area_perfis        enable row level security;
alter table ops.area_perfil_chaves enable row level security;
alter table ops.acessos_log        enable row level security;

-- Leitura: a própria linha, o super admin, e quem administra a pessoa naquela
-- área (furo 1: a lista de pessoas não vaza para fora da área).
create policy area_admins_select on ops.area_admins for select to authenticated
  using (user_id = (select auth.uid())
         or ops.eh_super_admin((select auth.uid()))
         or ops.nivel_na_area((select auth.uid()), area) >= 3);
create policy usuario_areas_select on ops.usuario_areas for select to authenticated
  using (user_id = (select auth.uid())
         or ops.pode_administrar((select auth.uid()), user_id, area));
create policy usuario_chaves_select on ops.usuario_chaves for select to authenticated
  using (user_id = (select auth.uid())
         or exists (select 1 from ops.area_chaves ac
                     where ac.permission_key = usuario_chaves.permission_key
                       and ops.pode_administrar((select auth.uid()), usuario_chaves.user_id, ac.area)));
create policy area_perfis_select on ops.area_perfis for select to authenticated
  using (tem_produto('ops'));
create policy area_perfil_chaves_select on ops.area_perfil_chaves for select to authenticated
  using (tem_produto('ops'));
create policy acessos_log_select on ops.acessos_log for select to authenticated
  using (ator = (select auth.uid()) or ops.eh_super_admin((select auth.uid())));

-- Escrita direta: só o super admin. Delegado escreve pelas funções acesso_*.
create policy area_admins_write on ops.area_admins for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));
create policy usuario_areas_write on ops.usuario_areas for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));
create policy usuario_chaves_write on ops.usuario_chaves for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));
create policy area_perfis_write on ops.area_perfis for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));
create policy area_perfil_chaves_write on ops.area_perfil_chaves for all to authenticated
  using (ops.eh_super_admin((select auth.uid())))
  with check (ops.eh_super_admin((select auth.uid())));

grant select, insert, update, delete on ops.area_admins, ops.usuario_areas, ops.usuario_chaves,
  ops.area_perfis, ops.area_perfil_chaves to authenticated;
grant select on ops.acessos_log to authenticated;
grant all on ops.area_admins, ops.usuario_areas, ops.usuario_chaves,
  ops.area_perfis, ops.area_perfil_chaves, ops.acessos_log to service_role;

-- Funções: nada para anon.
revoke all on function ops.eh_super_admin(uuid), ops.nivel_na_area(uuid, text),
  ops.escopo_contido(uuid, uuid), ops.pode_administrar(uuid, uuid, text),
  ops.acesso_do_usuario(uuid), ops._acesso_log(uuid, text, text, jsonb),
  ops._acesso_validar_chaves(uuid, text, text[]), ops._acesso_chaves_so_desta_area(uuid, text),
  ops.acesso_adicionar_na_area(uuid, text, int[], text[]),
  ops.acesso_definir_paginas(uuid, text, text[]), ops.acesso_remover_da_area(uuid, text),
  ops.acesso_nomear(uuid, text, text), ops.acesso_definir_unidades(uuid, int[]),
  ops.acesso_negar_pagina(uuid, text, boolean)
  from public, anon;
grant execute on function ops.eh_super_admin(uuid), ops.nivel_na_area(uuid, text),
  ops.escopo_contido(uuid, uuid), ops.pode_administrar(uuid, uuid, text),
  ops.acesso_do_usuario(uuid),
  ops.acesso_adicionar_na_area(uuid, text, int[], text[]),
  ops.acesso_definir_paginas(uuid, text, text[]), ops.acesso_remover_da_area(uuid, text),
  ops.acesso_nomear(uuid, text, text), ops.acesso_definir_unidades(uuid, int[]),
  ops.acesso_negar_pagina(uuid, text, boolean)
  to authenticated, service_role;
-- Os internos (_acesso_*) só rodam por dentro das funções acima.
grant execute on function ops._acesso_log(uuid, text, text, jsonb),
  ops._acesso_validar_chaves(uuid, text, text[]), ops._acesso_chaves_so_desta_area(uuid, text)
  to service_role;

-- ─────────────────────────────────────────────────────────────
-- 6. Ver e operar deixam de ser a mesma chave
-- ─────────────────────────────────────────────────────────────
insert into ops.area_chaves (area, permission_key)
select area, 'edit.nps' from ops.area_chaves where permission_key = 'view.disparos_whatsapp'
on conflict do nothing;

insert into ops.area_chaves (area, permission_key)
select distinct area, 'edit.gente.conversas' from ops.area_chaves
 where permission_key in ('view.gente.feedback', 'view.gente.um_a_um')
on conflict do nothing;

drop policy if exists "Permission-based update" on ops.nps_envio_map;
create policy "Permission-based update" on ops.nps_envio_map for update to authenticated
  using (tem_produto('ops') and (select ops.can('edit.nps')))
  with check (tem_produto('ops') and (select ops.can('edit.nps')));

drop policy if exists "Permission-based update" on ops.nps_pesquisas;
create policy "Permission-based update" on ops.nps_pesquisas for update to authenticated
  using (tem_produto('ops') and (select ops.can('edit.nps')))
  with check (tem_produto('ops') and (select ops.can('edit.nps')));

drop policy if exists "Permission-based insert" on ops.nps_ligacoes;
create policy "Permission-based insert" on ops.nps_ligacoes for insert to authenticated
  with check (tem_produto('ops') and (select ops.can('edit.nps')));

drop policy if exists "nps_gravacoes upload" on storage.objects;
create policy "nps_gravacoes upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'nps-gravacoes' and tem_produto('ops') and ops.can('edit.nps'));

drop policy if exists gente_feedback_insert on ops.gente_feedback;
create policy gente_feedback_insert on ops.gente_feedback for insert to authenticated
  with check (ops.can('edit.gente.conversas') and de_id = ops.minha_pessoa_id());

drop policy if exists gente_1a1_insert on ops.gente_um_a_um;
create policy gente_1a1_insert on ops.gente_um_a_um for insert to authenticated
  with check (ops.can('edit.gente.conversas') and gestor_id = ops.minha_pessoa_id());
