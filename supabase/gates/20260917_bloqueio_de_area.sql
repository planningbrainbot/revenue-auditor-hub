-- Gate da migration 20260917220000_bloqueio_de_area_por_pessoa.sql.
-- Mesmo formato do gate anterior: termina em EXCEPTION e desfaz tudo.

create temp table gate_antes on commit drop as
select u.id as uid, k.key, ops.can_user(u.id, k.key) as pode
  from auth.users u
 cross join (select distinct permission_key as key from ops.area_chaves
             union select 'data.scope.own_unit_only') k;

-- @@MIGRATION@@

create temp table gate_res (ordem serial, teste text, ok boolean, detalhe text) on commit drop;

insert into gate_res (teste, ok, detalhe)
select 'equivalencia can_user sem bloqueios (' || count(*) || ' pares)',
       count(*) filter (where ops.can_user(uid, key) is distinct from pode) = 0,
       count(*) filter (where ops.can_user(uid, key) is distinct from pode) || ' divergências'
  from gate_antes;

create function pg_temp.como(_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true)::text is not null;
$$;
create function pg_temp.tenta(_sql text) returns text language plpgsql as $$
begin execute _sql; return null; exception when others then return sqlerrm; end $$;
create function pg_temp.espera(_teste text, _erro text, _deve_falhar boolean) returns void language sql as $$
  insert into gate_res (teste, ok, detalhe) values (_teste, (_erro is not null) = _deve_falhar, coalesce(_erro, 'rodou'));
$$;
create function pg_temp.confere(_teste text, _ok boolean) returns void language sql as $$
  insert into gate_res (teste, ok, detalhe) values (_teste, coalesce(_ok, false), '');
$$;

do $$
declare
  sa      constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  diretor constant uuid := 'dd9d83f2-1538-46c2-918c-f0f7986a5a69';
  cs      constant uuid := 'f6c5b487-cf97-4a51-a8ad-c5cb0f938513';
  mateus  constant uuid := '5a431596-1062-46cd-8f78-fa1b15efede5';  -- admin de Clientes
  tinha_idu boolean := ops.can_user('dd9d83f2-1538-46c2-918c-f0f7986a5a69', 'view.idu');
begin
  perform pg_temp.confere('antes: diretor vê Headcount (Rede)', ops.can_user(diretor, 'view.rede_headcount'));

  perform pg_temp.como(mateus);
  perform pg_temp.espera('admin de área NÃO bloqueia',
    pg_temp.tenta(format('select ops.acesso_bloquear_area(%L, %L, true)', cs, 'clientes')), true);

  perform pg_temp.como(sa);
  perform pg_temp.espera('super admin bloqueia Rede do diretor',
    pg_temp.tenta(format('select ops.acesso_bloquear_area(%L, %L, true)', diretor, 'rede')), false);
  perform pg_temp.confere('diretor perde Headcount', not ops.can_user(diretor, 'view.rede_headcount'));
  perform pg_temp.confere('diretor mantém Clientes (outra área)', ops.can_user(diretor, 'view.clientes'));
  perform pg_temp.confere('IDU depende só de Rede para o diretor: some',
    not ops.can_user(diretor, 'view.idu') or not tinha_idu);
  perform pg_temp.confere('Rede sai do menu do diretor',
    not ((ops.acesso_do_usuario(diretor)->'areas') ? 'rede'));
  perform pg_temp.confere('Clientes continua no menu do diretor',
    (ops.acesso_do_usuario(diretor)->'areas') ? 'clientes');
  perform pg_temp.confere('nível do diretor em Rede vira 0', ops.nivel_na_area(diretor, 'rede') = 0);
  perform pg_temp.espera('super admin NÃO bloqueia outro super admin',
    pg_temp.tenta(format('select ops.acesso_bloquear_area(%L, %L, true)', '12fa2abb-058d-4467-86c5-93a7aefd9d98', 'rede')), true);

  perform pg_temp.espera('super admin bloqueia Clientes do CS',
    pg_temp.tenta(format('select ops.acesso_bloquear_area(%L, %L, true)', cs, 'clientes')), false);
  perform pg_temp.como(mateus);
  perform pg_temp.espera('admin de Clientes NÃO desfaz o bloqueio convidando de novo',
    pg_temp.tenta(format('select ops.acesso_adicionar_na_area(%L, %L, %L::int[], %L::text[])',
      cs, 'clientes', '{}'::int[], array['view.clientes'])), true);
  perform pg_temp.espera('admin de Clientes NÃO desfaz nomeando sócio',
    pg_temp.tenta(format('select ops.acesso_nomear(%L, %L, %L)', cs, 'clientes', 'socio')), true);
  perform pg_temp.tenta(format('select ops.acesso_remover_da_area(%L, %L)', cs, 'clientes'));
  perform pg_temp.confere('tirar da área não apaga o bloqueio',
    exists (select 1 from ops.usuario_areas where user_id = cs and area = 'clientes' and not allowed));
  perform pg_temp.confere('CS continua sem Clientes', not ops.can_user(cs, 'view.clientes'));

  perform pg_temp.como(sa);
  perform pg_temp.espera('super admin desbloqueia Rede do diretor',
    pg_temp.tenta(format('select ops.acesso_bloquear_area(%L, %L, false)', diretor, 'rede')), false);
  perform pg_temp.confere('diretor volta a ver Headcount', ops.can_user(diretor, 'view.rede_headcount'));
  perform pg_temp.confere('desbloqueio registrado no log',
    exists (select 1 from ops.acessos_log where alvo = diretor and acao = 'desbloquear_area'));
end $$;

do $$
declare _f int; _t text;
begin
  select count(*) filter (where not ok),
         string_agg(case when ok then 'OK   ' else 'FALHA' end || ' | ' || teste || ' | ' || detalhe, E'\n' order by ordem)
    into _f, _t from gate_res;
  raise exception E'GATE: % falha(s)\n%', _f, _t;
end $$;
