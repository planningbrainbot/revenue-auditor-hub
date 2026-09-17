-- Gate da migration 20260917100000_gestao_acessos_niveis.sql
--
-- Roda num único bloco, com a migration no lugar do marcador, e TERMINA EM
-- EXCEPTION de propósito: o resultado sai na mensagem e tudo volta atrás.
-- Critério para aplicar de verdade: todas as linhas com ok = true.
--
--   1. Equivalência: can_user de todas as pessoas em todas as chaves, antes e
--      depois, tem que bater 100%. As chaves novas (edit.*) têm que bater com
--      as de ver que substituem.
--   2. acesso_do_usuario devolve as mesmas áreas e chaves que o app monta hoje.
--   3. Cenários de delegação, com contas de teste criadas e desfeitas aqui.

create temp table gate_antes on commit drop as
select u.id as uid, k.key, ops.can_user(u.id, k.key) as pode
  from auth.users u
 cross join (select distinct permission_key as key from ops.area_chaves
             union select 'data.scope.own_unit_only') k;

create temp table gate_areas_antes on commit drop as
select distinct ur.user_id as uid, ra.area
  from ops.user_roles ur
  join ops.role_areas ra on ra.role = ur.role and ra.allowed
  join ops.areas a on a.slug = ra.area and a.ativa;

-- @@MIGRATION@@

create temp table gate_res (ordem serial, teste text, ok boolean, detalhe text) on commit drop;

-- 1. Equivalência
insert into gate_res (teste, ok, detalhe)
select 'equivalencia can_user (' || count(*) || ' pares)',
       count(*) filter (where ops.can_user(uid, key) is distinct from pode) = 0,
       count(*) filter (where ops.can_user(uid, key) is distinct from pode) || ' divergências'
  from gate_antes;

insert into gate_res (teste, ok, detalhe)
select 'edit.nps = view.disparos_whatsapp de antes',
       count(*) filter (where ops.can_user(uid, 'edit.nps') is distinct from pode) = 0,
       count(*) filter (where pode) || ' pessoas com a chave'
  from gate_antes where key = 'view.disparos_whatsapp';

insert into gate_res (teste, ok, detalhe)
select 'edit.gente.conversas = view.gente.* de antes',
       count(*) filter (where ops.can_user(f.uid, 'edit.gente.conversas') is distinct from (f.pode or o.pode)) = 0,
       count(*) filter (where f.pode or o.pode) || ' pessoas com a chave'
  from gate_antes f join gate_antes o on o.uid = f.uid and o.key = 'view.gente.um_a_um'
 where f.key = 'view.gente.feedback';

-- 2. O que o app vai ler
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into gate_res (teste, ok, detalhe)
select 'acesso_do_usuario = áreas e chaves de hoje',
       count(*) filter (where not x.igual) = 0,
       count(*) filter (where not x.igual) || ' pessoas divergentes de ' || count(*)
  from (
    select u.id,
           (select coalesce(array_agg(v order by v), '{}') from jsonb_array_elements_text(ops.acesso_do_usuario(u.id)->'areas') v)
             = (select coalesce(array_agg(area order by area), '{}') from gate_areas_antes where uid = u.id)
           and
           (select coalesce(array_agg(v order by v), '{}') from jsonb_array_elements_text(ops.acesso_do_usuario(u.id)->'permissions') v
             where v not in ('edit.nps', 'edit.gente.conversas'))
             = (select coalesce(array_agg(key order by key), '{}') from gate_antes
                 where uid = u.id and pode and key <> 'data.scope.own_unit_only')
             as igual
      from auth.users u
  ) x;

-- 3. Cenários
create function pg_temp.como(_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true)::text is not null;
$$;
-- Devolve null se rodou, ou a mensagem do erro.
create function pg_temp.tenta(_sql text) returns text language plpgsql as $$
begin
  execute _sql;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.tenta_como_authenticated(_sql text) returns text language plpgsql as $$
begin
  set local role authenticated;
  execute _sql;
  reset role;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.espera(_teste text, _erro text, _deve_falhar boolean) returns void language sql as $$
  insert into gate_res (teste, ok, detalhe)
  values (_teste, (_erro is not null) = _deve_falhar, coalesce(_erro, 'rodou'));
$$;
create function pg_temp.confere(_teste text, _ok boolean) returns void language sql as $$
  insert into gate_res (teste, ok, detalhe) values (_teste, coalesce(_ok, false), '');
$$;

do $$
declare
  sa    constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';  -- super admin
  rio   constant uuid := 'b73f6a7c-db83-4a68-acc7-f2c7fde4caa4';  -- sócio regional do Rio
  ana   constant uuid := 'c68b4fcb-9e15-4180-822c-9f03cbf898c7';  -- financeiro_admin (ana.carvalhais desde 20260917233000)
  italo constant uuid := '9bb70b7c-196f-4ef3-82df-07adfcba9c01';  -- sócio sem unidade
  novo  uuid := gen_random_uuid();
  novo2 uuid := gen_random_uuid();
  rj    constant int := 4;
  cwb   constant int := 1;
  r     text;
begin
  insert into auth.users (id, instance_id, aud, role, email)
  values (novo,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate-novo@teste.invalid'),
         (novo2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gate-novo2@teste.invalid');

  perform pg_temp.como(sa);
  perform pg_temp.espera('super admin nomeia o sócio do Rio em minha_unidade',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L)', rio, 'minha_unidade', 'socio')), false);

  perform pg_temp.como(rio);
  perform pg_temp.espera('sócio convida conta nova no Rio com NPS e Clientes',
    pg_temp.tenta(format('select ops.acesso_adicionar_na_area(%L, %L, %L::int[], %L::text[])',
      novo, 'minha_unidade', array[rj], array['view.nps', 'view.clientes'])), false);
  perform pg_temp.confere('colaborador vê NPS', ops.can_user(novo, 'view.nps'));
  perform pg_temp.confere('colaborador NÃO vê CS (não foi liberado)', not ops.can_user(novo, 'view.painel_cs'));
  perform pg_temp.confere('colaborador NÃO vê Meus Royalties', not ops.can_user(novo, 'view.meus_royalties'));
  perform pg_temp.confere('colaborador NÃO opera NPS (só consulta)', not ops.can_user(novo, 'edit.nps'));
  perform pg_temp.confere('colaborador fica limitado à unidade', ops.can_user(novo, 'data.scope.own_unit_only'));
  perform pg_temp.como(novo);
  perform pg_temp.confere('colaborador enxerga a área no menu',
    (select ops.acesso_do_usuario(novo)->'areas' ? 'minha_unidade'));
  perform pg_temp.espera('colaborador NÃO lê o acesso de outra pessoa',
    pg_temp.tenta(format('select ops.acesso_do_usuario(%L)', rio)), true);
  perform pg_temp.como(rio);

  perform pg_temp.espera('sócio NÃO convida para Curitiba',
    pg_temp.tenta(format('select ops.acesso_adicionar_na_area(%L, %L, %L::int[], %L::text[])',
      novo2, 'minha_unidade', array[cwb], array['view.nps'])), true);
  perform pg_temp.espera('sócio NÃO libera página de fora da área (Meus Royalties)',
    pg_temp.tenta(format('select ops.acesso_definir_paginas(%L, %L, %L::text[])',
      novo, 'minha_unidade', array['view.meus_royalties'])), true);
  perform pg_temp.espera('sócio NÃO nomeia outro sócio',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L)', novo, 'minha_unidade', 'socio')), true);
  perform pg_temp.espera('sócio NÃO mexe no Italo (sem unidade)',
    pg_temp.tenta(format('select ops.acesso_negar_pagina(%L, %L, true)', italo, 'view.nps')), true);
  perform pg_temp.espera('sócio NÃO mexe em si mesmo',
    pg_temp.tenta(format('select ops.acesso_negar_pagina(%L, %L, true)', rio, 'view.nps')), true);
  perform pg_temp.espera('sócio NÃO tira a Ana (Matriz) da área',
    pg_temp.tenta(format('select ops.acesso_remover_da_area(%L, %L)', ana, 'minha_unidade')), true);
  perform pg_temp.espera('sócio NÃO grava direto em area_admins',
    pg_temp.tenta_como_authenticated(format(
      'insert into ops.area_admins (user_id, area, nivel) values (%L, %L, %L)', novo, 'minha_unidade', 'socio')), true);

  perform pg_temp.espera('sócio troca as páginas do colaborador para CS',
    pg_temp.tenta(format('select ops.acesso_definir_paginas(%L, %L, %L::text[])',
      novo, 'minha_unidade', array['view.painel_cs'])), false);
  perform pg_temp.confere('depois da troca: vê CS', ops.can_user(novo, 'view.painel_cs'));
  perform pg_temp.confere('depois da troca: não vê mais NPS', not ops.can_user(novo, 'view.nps'));

  perform pg_temp.como(ana);
  perform pg_temp.espera('Ana NÃO convida ninguém em Minha Unidade (não é área dela)',
    pg_temp.tenta(format('select ops.acesso_adicionar_na_area(%L, %L, %L::int[], %L::text[])',
      novo2, 'minha_unidade', array[rj], array['view.nps'])), true);

  perform pg_temp.como(sa);
  perform pg_temp.espera('super admin nomeia a Ana admin do Financeiro',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L)', ana, 'financeiro', 'admin')), false);
  perform pg_temp.espera('usuário NÃO recebe chave de operar, nem pelo super admin',
    pg_temp.tenta(format('insert into ops.usuario_chaves (user_id, permission_key, allowed) values (%L, %L, true)',
      novo, 'edit.nps')), true);

  perform pg_temp.como(ana);
  perform pg_temp.espera('admin NÃO nomeia outro admin',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L)', novo, 'financeiro', 'admin')), true);
  perform pg_temp.espera('admin nomeia sócio na área dela',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L)', novo, 'financeiro', 'socio')), false);
  perform pg_temp.confere('sócio do Financeiro tem a área inteira', ops.can_user(novo, 'view.brain_financeiro'));
  perform pg_temp.confere('e continua sem o Growth nem a Rede', not ops.can_user(novo, 'view.rede_headcount'));

  perform pg_temp.como(sa);
  perform pg_temp.espera('super admin nega CS ao colaborador',
    pg_temp.tenta(format('select ops.acesso_negar_pagina(%L, %L, true)', novo, 'view.painel_cs')), false);
  perform pg_temp.confere('negação vence a liberação', not ops.can_user(novo, 'view.painel_cs'));

  perform pg_temp.como(rio);
  r := pg_temp.tenta(format('select ops.acesso_remover_da_area(%L, %L)', novo, 'minha_unidade'));
  perform pg_temp.espera('sócio tira o colaborador da área', r, false);
  perform pg_temp.confere('fora da área, a conta segue viva porque está no Financeiro',
    exists (select 1 from ops.area_admins where user_id = novo and area = 'financeiro'));
  perform pg_temp.confere('e perdeu a área Minha Unidade',
    not exists (select 1 from ops.usuario_areas where user_id = novo and area = 'minha_unidade'));

  perform pg_temp.confere('tudo ficou no log',
    (select count(*) from ops.acessos_log where alvo in (novo, ana, rio)) >= 7);
end $$;

do $$
declare
  _falhas int;
  _txt text;
begin
  select count(*) filter (where not ok),
         string_agg(case when ok then 'OK   ' else 'FALHA' end || ' | ' || teste || ' | ' || detalhe, E'\n' order by ordem)
    into _falhas, _txt
    from gate_res;
  raise exception E'GATE: % falha(s)\n%', _falhas, _txt;
end $$;
