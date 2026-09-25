-- Gate da migration 20260925100000_acessos_travas.sql.
-- Mesmo formato dos gates de 17/09: roda a migration no lugar de @@MIGRATION@@,
-- testa, e termina em EXCEPTION para desfazer tudo. O resultado vem na
-- mensagem do erro. Pessoas reais, porque a pergunta é "o que muda para quem
-- existe"; nada sobrevive ao fim da transação.

select set_config('request.jwt.claims',
  '{"sub":"12fa2abb-058d-4467-86c5-93a7aefd9d98","role":"authenticated"}', true);

create temp table gate_antes on commit drop as
select u.user_id as uid, k.key, ops.can_user(u.user_id, k.key) as pode
  from public.profiles u
 cross join (select distinct permission_key as key from ops.area_chaves
             union select 'data.scope.own_unit_only') k;

create temp table gate_menu_antes on commit drop as
select u.user_id as uid, ops.acesso_do_usuario(u.user_id) as acesso from public.profiles u;

-- @@MIGRATION@@

create temp table gate_res (ordem serial, teste text, ok boolean, detalhe text) on commit drop;
grant all on gate_res to authenticated;
grant all on sequence gate_res_ordem_seq to authenticated;

insert into gate_res (teste, ok, detalhe)
select 'equivalência can_user, todas as pessoas × chaves (' || count(*) || ' pares)',
       count(*) filter (where ops.can_user(uid, key) is distinct from pode) = 0,
       count(*) filter (where ops.can_user(uid, key) is distinct from pode) || ' divergências'
  from gate_antes;

insert into gate_res (teste, ok, detalhe)
select 'equivalência do menu (acesso_do_usuario) para ' || count(*) || ' pessoas',
       count(*) filter (where ops.acesso_do_usuario(uid) is distinct from acesso) = 0,
       count(*) filter (where ops.acesso_do_usuario(uid) is distinct from acesso) || ' divergências'
  from gate_menu_antes;

create function pg_temp.como(_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true)::text is not null;
$$;
create function pg_temp.tenta(_sql text) returns text language plpgsql as $$
begin execute _sql; return null; exception when others then return sqlerrm; end $$;
create function pg_temp.espera(_teste text, _erro text, _deve_falhar boolean) returns void language sql as $$
  insert into gate_res (teste, ok, detalhe) values (_teste, (_erro is not null) = _deve_falhar, coalesce(_erro, 'rodou'));
$$;
create function pg_temp.confere(_teste text, _ok boolean, _detalhe text default '') returns void language sql as $$
  insert into gate_res (teste, ok, detalhe) values (_teste, coalesce(_ok, false), _detalhe);
$$;

do $$
declare
  sa      constant uuid := '12fa2abb-058d-4467-86c5-93a7aefd9d98';  -- victor.eliezek, super admin
  helo    constant uuid := 'ad67cb7c-ad5f-434c-b6b6-07433a4e3430';  -- admin de People, tem cadastro no Gente
  mateus  constant uuid := '5a431596-1062-46cd-8f78-fa1b15efede5';  -- admin de Clientes
  jordana constant uuid := '8120fb42-ed9a-4fc9-9f2e-bdb699acc508';  -- diretoria comercial, fora de People
  paula   constant uuid := '786f7ec9-ec53-4900-be11-c0f54a28ab90';  -- gente_gestao: People pelo perfil
  italo   constant uuid := '9bb70b7c-196f-4ef3-82df-07adfcba9c01';  -- sócio regional de Belém (f,t)
  sarah   constant uuid := '642d9421-6076-4e5d-9a06-d5ff8c97eb9a';  -- colaboradora de Clientes
  daniel  constant uuid := '55f8d99a-a371-418e-aa34-2e596b9506f6';  -- financeiro
  isabela constant uuid := 'c1efc06b-4a47-4445-80d4-eca5c6c119e9';  -- CS
  willian constant uuid := '08b9e0e4-17bd-4c73-99d3-f859deec3d94';  -- monetização, fora de People, sem recorte
  _n int;
  _esc text;
begin
  -- ── Desativar ──────────────────────────────────────────────────────────
  perform pg_temp.confere('antes: Heloísa vê o Gente e tem pessoa', ops.can_user(helo, 'view.gente'));
  perform pg_temp.como(mateus);
  perform pg_temp.espera('admin de área NÃO desativa ninguém',
    pg_temp.tenta(format('select ops.acesso_desativar(%L)', isabela)), true);
  perform pg_temp.como(sa);
  perform pg_temp.espera('super admin NÃO desativa a si mesmo',
    pg_temp.tenta(format('select ops.acesso_desativar(%L)', sa)), true);
  perform pg_temp.espera('super admin desativa a Heloísa',
    pg_temp.tenta(format('select ops.acesso_desativar(%L, %L)', helo, 'teste do gate')), false);
  perform pg_temp.confere('desativada: nenhuma chave (view.gente)', not ops.can_user(helo, 'view.gente'));
  perform pg_temp.confere('desativada: recorte de unidade trava', ops.can_user(helo, 'data.scope.own_unit_only'));
  perform pg_temp.confere('desativada: menu vazio',
    ops.acesso_do_usuario(helo) = '{"areas": [], "permissions": []}'::jsonb);
  perform pg_temp.confere('desativada: deixa de ser admin de People (nível 0)', ops.nivel_na_area(helo, 'people') = 0);
  select count(*) into _n from auth.sessions where user_id = helo;
  perform pg_temp.confere('desativada: sessões abertas apagadas', _n = 0, _n || ' sessões');
  perform pg_temp.como(helo);
  perform pg_temp.confere('desativada: minha_pessoa_id() nulo (1:1, feedback, PDI)', ops.minha_pessoa_id() is null);
  perform pg_temp.como(sa);
  perform pg_temp.confere('desativar registrado no log',
    exists (select 1 from ops.acessos_log where alvo = helo and acao = 'desativar' and detalhe->>'motivo' = 'teste do gate'));
  perform pg_temp.espera('super admin reativa a Heloísa',
    pg_temp.tenta(format('select ops.acesso_reativar(%L)', helo)), false);
  perform pg_temp.confere('reativada: volta a ver o Gente', ops.can_user(helo, 'view.gente'));
  perform pg_temp.confere('reativada: volta a ser admin de People', ops.nivel_na_area(helo, 'people') = 3);

  -- ── Porta fechada ──────────────────────────────────────────────────────
  delete from public.produto_acesso where user_id = isabela and produto = 'ops';
  perform pg_temp.confere('porta do Ops fechada: CS perde view.clientes', not ops.can_user(isabela, 'view.clientes'));
  perform pg_temp.confere('porta do Ops fechada: menu sem áreas',
    jsonb_array_length(ops.acesso_do_usuario(isabela)->'areas') = 0);
  delete from public.produto_acesso where user_id = daniel and produto = 'ops';
  perform pg_temp.confere('só com a porta do Financeiro: mantém view.brain_financeiro',
    ops.can_user(daniel, 'view.brain_financeiro'));
  perform pg_temp.confere('só com a porta do Financeiro: menu mantém a área financeiro',
    ops.acesso_do_usuario(daniel)->'areas' ? 'financeiro');

  -- ── Admin de área fica na área dele ────────────────────────────────────
  perform pg_temp.confere('admin de People NÃO administra quem não é de People',
    not ops.pode_administrar(helo, jordana, 'people'));
  perform pg_temp.confere('admin de People administra quem é de People pelo perfil',
    ops.pode_administrar(helo, paula, 'people'));
  perform pg_temp.como(helo);
  perform pg_temp.espera('admin de People NÃO redefine as unidades da diretora comercial',
    pg_temp.tenta(format('select ops.acesso_definir_unidades(%L, %L::int[])', jordana, '{1}')), true);
  perform pg_temp.espera('admin de People NÃO soma unidade a quem é de fora ao convidar',
    pg_temp.tenta(format('select ops.acesso_adicionar_na_area(%L, %L, %L::int[], %L::text[])',
      willian, 'people', '{1}', '{}')), true);
  perform pg_temp.espera('admin de People convida quem é de fora SEM mexer nas unidades',
    pg_temp.tenta(format('select ops.acesso_adicionar_na_area(%L, %L, %L::int[], %L::text[])',
      jordana, 'people', '{}', '{}')), false);
  perform pg_temp.confere('o convite não tocou nas unidades da Jordana',
    not exists (select 1 from ops.usuario_unidades where user_id = jordana));
  -- O ataque em dois passos da revisão: já "da área", ainda de fora das outras.
  perform pg_temp.espera('2º passo: admin de People NÃO soma unidade à Jordana, que também é de Clientes',
    pg_temp.tenta(format('select ops.acesso_adicionar_na_area(%L, %L, %L::int[], %L::text[])',
      jordana, 'people', '{1}', '{}')), true);
  perform pg_temp.espera('2º passo: admin de People NÃO redefine as unidades da Jordana',
    pg_temp.tenta(format('select ops.acesso_definir_unidades(%L, %L::int[])', jordana, '{1}')), true);
  perform pg_temp.espera('admin de People redefine as unidades de quem só é de People (Paula)',
    pg_temp.tenta(format('select ops.acesso_definir_unidades(%L, %L::int[])', paula, '{1}')), false);

  -- ── Administração não é delegável ──────────────────────────────────────
  perform pg_temp.como(sa);
  perform pg_temp.espera('nem o super admin nomeia admin da área Administração',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L)', mateus, 'admin', 'admin')), true);
  perform pg_temp.espera('nem o super admin põe alguém na área Administração',
    pg_temp.tenta(format('select ops.acesso_adicionar_na_area(%L, %L)', mateus, 'admin')), true);

  -- ── Tirar da área não apaga negação ────────────────────────────────────
  perform pg_temp.espera('super admin nega view.aquario à Sarah',
    pg_temp.tenta(format('select ops.acesso_negar_pagina(%L, %L, true)', sarah, 'view.aquario')), false);
  perform pg_temp.como(mateus);
  perform pg_temp.espera('admin de Clientes tira a Sarah da área',
    pg_temp.tenta(format('select ops.acesso_remover_da_area(%L, %L)', sarah, 'clientes')), false);
  perform pg_temp.confere('a negação do super admin sobreviveu',
    exists (select 1 from ops.usuario_chaves where user_id = sarah and permission_key = 'view.aquario' and not allowed));
  perform pg_temp.confere('as páginas liberadas saíram',
    not exists (select 1 from ops.usuario_chaves where user_id = sarah and permission_key = 'view.clientes'));

  -- ── Recorte volta quando o admin sai ───────────────────────────────────
  perform pg_temp.como(sa);
  perform pg_temp.espera('super admin nomeia o Italo admin de Clientes',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L)', italo, 'clientes', 'admin')), false);
  select row(todas_unidades, todas_empresas)::text into _esc from ops.usuario_escopo where user_id = italo;
  perform pg_temp.confere('admin: vê todas as unidades e empresas (decisão 9)', _esc = '(t,t)', _esc);
  perform pg_temp.espera('super admin tira o Italo de Clientes',
    pg_temp.tenta(format('select ops.acesso_remover_da_area(%L, %L)', italo, 'clientes')), false);
  select row(todas_unidades, todas_empresas)::text into _esc from ops.usuario_escopo where user_id = italo;
  perform pg_temp.confere('fora da administração: recorte volta ao de antes (f,t)', _esc = '(f,t)', _esc);
  perform pg_temp.confere('o Italo continua travado em Belém',
    ops.can_user(italo, 'data.scope.own_unit_only'));
  perform pg_temp.espera('nomear admin de novo e rebaixar a sócio',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L); select ops.acesso_nomear(%L, %L, %L)',
      italo, 'clientes', 'admin', italo, 'clientes', 'socio')), false);
  select row(todas_unidades, todas_empresas)::text into _esc from ops.usuario_escopo where user_id = italo;
  perform pg_temp.confere('rebaixado a sócio: recorte volta ao de antes (f,t)', _esc = '(f,t)', _esc);
end $$;

-- ── RLS de ponta a ponta, como a pessoa (role authenticated) ─────────────
select pg_temp.como('12fa2abb-058d-4467-86c5-93a7aefd9d98');
select ops.acesso_desativar('ad67cb7c-ad5f-434c-b6b6-07433a4e3430', 'gate RLS');
select pg_temp.como('ad67cb7c-ad5f-434c-b6b6-07433a4e3430');
set local role authenticated;
insert into gate_res (teste, ok, detalhe)
select 'desativada lendo pelo PostgREST: gente_pessoas só o próprio cadastro',
       count(*) filter (where user_id is distinct from 'ad67cb7c-ad5f-434c-b6b6-07433a4e3430') = 0,
       count(*) || ' linhas'
  from ops.gente_pessoas;
insert into gate_res (teste, ok, detalhe)
select 'desativada lendo pelo PostgREST: empresas vazia', count(*) = 0, count(*) || ' linhas'
  from ops.empresas;
reset role;

select pg_temp.como('12fa2abb-058d-4467-86c5-93a7aefd9d98');
select ops.acesso_reativar('ad67cb7c-ad5f-434c-b6b6-07433a4e3430');
select pg_temp.como('ad67cb7c-ad5f-434c-b6b6-07433a4e3430');
set local role authenticated;
insert into gate_res (teste, ok, detalhe)
select 'reativada lendo pelo PostgREST: gente_pessoas volta', count(*) > 0, count(*) || ' linhas'
  from ops.gente_pessoas;
reset role;

select pg_temp.como('5a431596-1062-46cd-8f78-fa1b15efede5');
set local role authenticated;
do $$
begin
  begin
    insert into ops.role_areas (role, area, allowed) values ('head', 'admin', true);
    insert into gate_res (teste, ok, detalhe) values ('admin de área NÃO grava a matriz direto', false, 'gravou');
  exception when others then
    insert into gate_res (teste, ok, detalhe) values ('admin de área NÃO grava a matriz direto', true, sqlerrm);
  end;
  begin
    update ops.usuario_escopo set todas_unidades = true where user_id = '9bb70b7c-196f-4ef3-82df-07adfcba9c01';
    insert into gate_res (teste, ok, detalhe)
    values ('admin de área NÃO grava o recorte de ninguém direto', not found, case when found then 'gravou' else 'nenhuma linha' end);
  exception when others then
    insert into gate_res (teste, ok, detalhe) values ('admin de área NÃO grava o recorte de ninguém direto', true, sqlerrm);
  end;
end $$;
reset role;

do $$
declare _f int; _t text;
begin
  select count(*) filter (where not ok),
         string_agg(case when ok then 'OK   ' else 'FALHA' end || ' | ' || teste || ' | ' || detalhe, E'\n' order by ordem)
    into _f, _t from gate_res;
  raise exception E'GATE: % falha(s)\n%', _f, _t;
end $$;
