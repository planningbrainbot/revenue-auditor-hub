-- Gates da T1b do Portal de Faturamento (20/10/2026): a API das telas (ops.fat_*) e do conector (integracoes.*).
-- Migration: 20261020120000_portal_faturamento_t1b.sql. Rollback: supabase/rollback/20261020120000_portal_faturamento_t1b_rollback.sql.
-- Contrato da API: PM Work/execution/portal-faturamento-prd-20261013/e1/API.md.
--
-- Roda tudo numa transação que termina em ROLLBACK: nada sobrevive. Cada teste levanta exceção quando falha; a
-- Management API responde [] só se TODOS passarem, e a falha volta como HTTP 400 com o código (FALHOU Xn).
-- Como rodar (e1/ensaio.py): antes de aplicar, troque a linha MIGRATION pela migration e a ROLLBACK pelo rollback,
-- sem begin;/commit;. Depois de aplicar, rode com --vazio (os dois marcadores somem): os testes valem nos dois modos,
-- e o bloco Z (rollback) só confere quando o rollback rodou.
--
-- Pessoas de teste: criadas DENTRO da transação (auth.users, public.profiles, produto_acesso, papéis e escopo),
-- com uuid 00000000-0000-4000-8000-0000000000xx e e-mail @ensaio.invalid. Nenhuma pessoa real é usada.
--   a1, b1 donos da DOC (b1 com substituto s2) · s1 solicitante da DOC · g1 gestor da DOC · p1 dono da PAC
--   t1 tesouraria com todas as empresas · t2 tesouraria só da PIS · c1 controladoria · ad admin do Brain
--   z1 porta do faturamento e nenhum papel · n1 sem a porta
-- O número do pedido sai de uma sequence de ensaio (FAT-1999-…): o gate não gasta a sequence de produção.
-- A API roda como postgres; os testes trocam para authenticated (com request.jwt.claims), service_role e anon por
-- set_config('role'), sempre dentro da transação.
-- Medição: com ens.medir = 'sim' (e1/medir_t1b.py), o último bloco devolve os tempos em vez de terminar limpo.

begin;

-- @@MIGRATION@@

-- 0. Ferramentas do ensaio (pg_temp: morrem com a sessão) ---------------------------------------------------------
create function pg_temp.u(_n text) returns uuid language sql immutable as $$
  select (case _n
    when 'a1' then '00000000-0000-4000-8000-0000000000a1' when 'b1' then '00000000-0000-4000-8000-0000000000b1'
    when 's1' then '00000000-0000-4000-8000-000000000051' when 's2' then '00000000-0000-4000-8000-000000000052'
    when 'g1' then '00000000-0000-4000-8000-000000000061' when 'p1' then '00000000-0000-4000-8000-000000000071'
    when 't1' then '00000000-0000-4000-8000-000000000081' when 't2' then '00000000-0000-4000-8000-000000000082'
    when 'c1' then '00000000-0000-4000-8000-000000000091' when 'z1' then '00000000-0000-4000-8000-0000000000e1'
    when 'n1' then '00000000-0000-4000-8000-0000000000f1' when 'ad' then '00000000-0000-4000-8000-0000000000ad'
  end)::uuid
$$;

create function pg_temp.como(_n text) returns void language plpgsql as $$
begin
  if _n = 'postgres' then
    perform set_config('role', 'none', true);
    perform set_config('request.jwt.claims', '', true);
  elsif _n = 'conector' then
    perform set_config('role', 'service_role', true);
    perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  elsif _n = 'anon' then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    if pg_temp.u(_n) is null then raise exception 'ENSAIO INVÁLIDO: pessoa % desconhecida', _n; end if;
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    if auth.uid() is distinct from pg_temp.u(_n) then raise exception 'ENSAIO INVÁLIDO: auth.uid() não trocou para %', _n; end if;
  end if;
end $$;

-- Executa _sql e exige o erro _code; devolve "mensagem | detalhe".
create function pg_temp.erro(_sql text, _code text, _rotulo text) returns text language plpgsql as $$
declare
  st text;
  msg text;
  det text;
begin
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text, det = pg_exception_detail;
    if st <> _code then
      raise exception 'FALHOU %: esperava erro % e veio % (%)', _rotulo, _code, st, msg;
    end if;
    return msg || ' | ' || coalesce(det, '');
  end;
  raise exception 'FALHOU %: passou e devia falhar com %', _rotulo, _code;
end $$;

create function pg_temp.guarda(_nome text, _id uuid) returns void language sql as $$
  select set_config('ens.p_' || _nome, _id::text, true)
$$;
create function pg_temp.p(_nome text) returns uuid language sql stable as $$
  select nullif(current_setting('ens.p_' || _nome, true), '')::uuid
$$;

-- Primeiro serviço liberado (ativo, no Omie, com tributação) da emissora.
create function pg_temp.svc(_emissora uuid) returns uuid language sql stable as $$
  select s.id from receita.fat_servicos s
   where s.emissora_id = _emissora and s.ativo and s.no_omie and s.tem_tributacao order by s.codigo_omie limit 1
$$;

-- Que pedidos de teste (PA, PS, PG, RD, PP) a pessoa enxerga pela lista.
create function pg_temp.vistos(_quem text) returns text language plpgsql as $$
declare
  r jsonb;
  n text;
  res text[] := '{}';
begin
  perform pg_temp.como(_quem);
  r := ops.fat_pedidos(jsonb_build_object('busca', 'FAT-1999', 'por_pagina', 200, 'situacao', jsonb_build_array(
         'rascunho', 'aguardando_ok', 'devolvido', 'na_fila_omie', 'simulado', 'erro_omie', 'os_criada',
         'em_conferencia', 'faturado', 'recebido', 'em_atraso', 'cancelamento_pedido', 'cancelado')));
  foreach n in array array['PA', 'PS', 'PG', 'RD', 'PP'] loop
    if exists (select 1 from jsonb_array_elements(r -> 'itens') i where (i ->> 'id')::uuid = pg_temp.p(n)) then
      res := res || n;
    end if;
  end loop;
  perform pg_temp.como('postgres');
  return array_to_string(res, ',');
end $$;

-- Conector: reserva a fila, devolve a pendente o que não é o alvo e devolve o id do envio-alvo (fica processando).
create function pg_temp.reservar(_origem uuid, _operacao text) returns uuid language plpgsql as $$
declare
  r jsonb;
  i jsonb;
  alvo uuid;
  papel text := current_setting('role');
  claims text := current_setting('request.jwt.claims', true);
begin
  perform pg_temp.como('conector');
  r := integracoes.fat_envio_proximos(100);
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = _origem and i ->> 'operacao' = _operacao and alvo is null then
      alvo := (i ->> 'id')::uuid;
    else
      perform integracoes.fat_envio_resultado((i ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
    end if;
  end loop;
  perform set_config('role', papel, true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  if alvo is null then
    raise exception 'FALHOU OMIE: % de % não ficou disponível na fila (%)', _operacao, _origem, r;
  end if;
  return alvo;
end $$;

-- Conector: reserva e responde.
create function pg_temp.omie(_origem uuid, _operacao text, _status text, _codigos jsonb default '{}',
                             _erro text default null) returns jsonb language plpgsql as $$
declare
  alvo uuid := pg_temp.reservar(_origem, _operacao);
  res jsonb;
  papel text := current_setting('role');
  claims text := current_setting('request.jwt.claims', true);
begin
  perform pg_temp.como('conector');
  res := integracoes.fat_envio_resultado(alvo, _status, jsonb_build_object('ensaio', true), _erro, _codigos);
  perform set_config('role', papel, true);
  perform set_config('request.jwt.claims', coalesce(claims, ''), true);
  return res;
end $$;

create function pg_temp.status(_nome text) returns text language sql stable as $$
  select p.status from receita.fat_pedidos p where p.id = pg_temp.p(_nome)
$$;

create function pg_temp.medir(_rotulo text, _quem text, _sql text, _limite_ms numeric) returns numeric
language plpgsql as $$
declare
  t0 timestamptz;
  ms numeric;
  r jsonb;
begin
  perform pg_temp.como(_quem);
  t0 := clock_timestamp();
  execute _sql into r;
  ms := round((extract(epoch from clock_timestamp() - t0) * 1000)::numeric, 1);
  perform pg_temp.como('postgres');
  perform set_config('ens.tempos', (coalesce(nullif(current_setting('ens.tempos', true), ''), '{}')::jsonb
                                    || jsonb_build_object(_rotulo, ms))::text, true);
  if ms > _limite_ms then raise exception 'FALHOU TEMPO %: % ms (limite % ms)', _rotulo, ms, _limite_ms; end if;
  return ms;
end $$;

-- Massa de teste (como postgres) -----------------------------------------------------------------------------------
create sequence receita.fat_ensaio_seq;
alter table receita.fat_pedidos
  alter column numero set default ('FAT-1999-' || lpad(nextval('receita.fat_ensaio_seq')::text, 6, '0'));

insert into auth.users (id, email)
select pg_temp.u(n), 'ensaio.t1b.' || n || '@ensaio.invalid'
  from unnest(array['a1', 'b1', 's1', 's2', 'g1', 'p1', 't1', 't2', 'c1', 'z1', 'n1', 'ad']) n;
insert into public.profiles (user_id, nome, email, ativo)
select pg_temp.u(n), 'Ensaio ' || upper(n), 'ensaio.t1b.' || n || '@ensaio.invalid', true
  from unnest(array['a1', 'b1', 's1', 's2', 'g1', 'p1', 't1', 't2', 'c1', 'z1', 'n1', 'ad']) n;
insert into public.produto_acesso (user_id, produto)
select pg_temp.u(n), 'ops' from unnest(array['a1', 'b1', 's1', 's2', 'g1', 'p1', 't1', 't2', 'c1', 'z1', 'n1', 'ad']) n;
insert into ops.usuario_areas (user_id, area, allowed)
select pg_temp.u(n), 'faturamento', true from unnest(array['a1', 'b1', 's1', 's2', 'g1', 'p1', 'z1']) n;
insert into ops.usuario_chaves (user_id, permission_key, allowed)
select pg_temp.u(n), 'view.faturamento', true from unnest(array['a1', 'b1', 's1', 's2', 'g1', 'p1', 'z1']) n;
insert into ops.user_roles (user_id, role) values
  (pg_temp.u('t1'), 'fat_tesouraria'), (pg_temp.u('t2'), 'fat_tesouraria'),
  (pg_temp.u('c1'), 'fat_controladoria'), (pg_temp.u('ad'), 'admin');
insert into ops.usuario_escopo (user_id, todas_unidades, todas_empresas) values
  (pg_temp.u('t1'), false, true), (pg_temp.u('t2'), false, false),
  (pg_temp.u('c1'), false, true), (pg_temp.u('ad'), true, true);
insert into ops.usuario_empresas (user_id, empresa_id) values (pg_temp.u('t2'), '92eabf46-07a2-44c6-8f23-b7588e89314e');  -- PIS
insert into receita.fat_donos (emissora_id, user_id, papel, substituto_id) values
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('a1'), 'dono', null),
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('b1'), 'dono', pg_temp.u('s2')),
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('s1'), 'solicitante', null),
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('g1'), 'gestor', null),
  ('8cdf5de7-683f-4d8e-a194-f303677ac6ea', pg_temp.u('p1'), 'dono', null);
insert into receita.fat_servicos (emissora_id, codigo_omie, descricao, ativo)
values ('c243e5e4-8309-43e6-ac33-146b9771a44e', 'ensaio-t1b-sem-trib', 'Serviço de ensaio sem tributação', true);

-- A. Estrutura e privilégios (como postgres) -----------------------------------------------------------------------
do $a$
declare
  n int;
  f regprocedure;
  m text;
  t regclass;
  internas constant text[] := array['fat_hoje', 'fat_dias_uteis', 'fat_status_rotulo', 'fat_documento_valido',
    'fat_email_valido', 'fat_parcelas_calcular', 'fat_recusar', 'fat_erro', 'fat_pessoa', 'fat_diff', 'fat_escopo',
    'fat_exigir_porta', 'fat_ve', 'fat_e_substituto', 'fat_pend_ok', 'fat_pend_devolvido', 'fat_pend_erro', 'fat_acoes',
    'fat_exigir', 'fat_contratos_vigentes', 'fat_contratos_outra_emissora', 'fat_bloqueio', 'fat_pedido_validar',
    'fat_snapshot', 'fat_transicao_permitida', 'fat_transicao', 'fat_evento_pedido', 'fat_entrar_na_fila',
    'fat_proximo_passo', 'fat_pedidos_status_guarda'];
  conector constant text[] := array['omie_credencial', 'fat_envio_proximos', 'fat_envio_resultado', 'fat_status_aplicar',
    'fat_status_enfileirar', 'fat_servicos_aplicar', 'pipefy_envio_proximos', 'pipefy_envio_resultado', 'receita_cnpj_gravar'];
begin
  if current_user <> 'postgres' then raise exception 'ENSAIO INVÁLIDO: o bloco A roda como %', current_user; end if;

  -- A1. As 25 RPCs de tela: definer, search_path vazio; authenticated executa; anon, public e service_role não.
  --     (As passagens do conector, ops.fat_conector_* e ops.fat_receita_cnpj_gravar, são da migration de ajustes e
  --     têm o gate dela: só service_role.)
  select count(*) into n from pg_proc p where p.pronamespace = 'ops'::regnamespace and p.proname like 'fat\_%'
     and p.proname not like 'fat\_conector\_%' and p.proname <> 'fat_receita_cnpj_gravar';
  if n <> 25 then raise exception 'FALHOU A1: % RPCs ops.fat_* (esperava 25)', n; end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'ops'::regnamespace and p.proname like 'fat\_%'
              and p.proname not like 'fat\_conector\_%' and p.proname <> 'fat_receita_cnpj_gravar' loop
    if not (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
              from pg_proc p where p.oid = f) then
      raise exception 'FALHOU A1: % sem security definer ou search_path fixo', f;
    end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'FALHOU A1: authenticated não executa %', f; end if;
    if has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then
      raise exception 'FALHOU A1: anon, service_role ou public executa %', f;
    end if;
  end loop;

  -- A2. Conector: só service_role; authenticated nem tem USAGE no schema.
  select count(*) into n from pg_proc p where p.pronamespace = 'integracoes'::regnamespace and p.proname = any (conector);
  if n <> 9 then raise exception 'FALHOU A2: % funções do conector (esperava 9)', n; end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'integracoes'::regnamespace and p.proname = any (conector) loop
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'FALHOU A2: service_role não executa %', f; end if;
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then
      raise exception 'FALHOU A2: authenticated, anon ou public executa %', f;
    end if;
    if not (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
              from pg_proc p where p.oid = f) then
      raise exception 'FALHOU A2: % sem security definer ou search_path fixo', f;
    end if;
  end loop;
  if has_schema_privilege('authenticated', 'integracoes', 'usage') or has_schema_privilege('anon', 'integracoes', 'usage') then
    raise exception 'FALHOU A2: authenticated ou anon tem USAGE em integracoes';
  end if;

  -- A3. Funções internas: ninguém além do dono (postgres) executa; a máquina de estados não é chamável de fora.
  select count(*) into n from pg_proc p where p.pronamespace = 'receita'::regnamespace and p.proname = any (internas);
  if n <> cardinality(internas) then raise exception 'FALHOU A3: % de % funções internas', n, cardinality(internas); end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'receita'::regnamespace and p.proname = any (internas) loop
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or has_function_privilege('service_role', f, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then
      raise exception 'FALHOU A3: % executável de fora', f;
    end if;
  end loop;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'integracoes'::regnamespace and p.proname = 'fat_exigir_conector'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'));
  if n <> 0 then raise exception 'FALHOU A3: integracoes.fat_exigir_conector executável de fora'; end if;

  -- A4. Tabelas novas: RLS, comentário, nenhuma policy, nada para anon e authenticated.
  foreach t in array array['receita.fat_departamentos', 'integracoes.omie_emissora_estado', 'integracoes.receita_cnpj']::regclass[] loop
    if not (select c.relrowsecurity and obj_description(c.oid, 'pg_class') is not null from pg_class c where c.oid = t) then
      raise exception 'FALHOU A4: % sem RLS ou comentário', t;
    end if;
    if exists (select 1 from pg_policy where polrelid = t) then raise exception 'FALHOU A4: % tem policy', t; end if;
    foreach m in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege('authenticated', t, m) or has_table_privilege('anon', t, m) then
        raise exception 'FALHOU A4: authenticated ou anon tem % em %', m, t;
      end if;
    end loop;
  end loop;

  -- A5. Departamentos: as 19 opções do pipe, na ordem.
  select string_agg(nome, '|' order by ordem) into m from receita.fat_departamentos where ativo;
  if m <> 'Facilities|Financeiro|Comercial|Gente e Gestão|Marketing|Sucesso do Cliente|Gestão de Risco|Tecnologia|'
          'Implantação|Jurídico|Operação|Contábil|Fiscal|Sócios|Folha|Negócios Estruturados|Expansão|Finance|Controladoria' then
    raise exception 'FALHOU A5: departamentos = %', m;
  end if;

  -- A6. Guarda da situação, operações novas da fila e entidades novas do evento.
  if not exists (select 1 from pg_trigger where tgname = 'fat_pedidos_status_guarda' and tgrelid = 'receita.fat_pedidos'::regclass) then
    raise exception 'FALHOU A6: gatilho de guarda da situação ausente';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'omie_envios_operacao_check')) not like '%alterar_os%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'omie_envios_operacao_check')) not like '%sincronizar_servicos%'
     or pg_get_constraintdef((select oid from pg_constraint where conname = 'fat_eventos_entidade_check')) not like '%emissora%' then
    raise exception 'FALHOU A6: checks de omie_envios ou fat_eventos sem as operações/entidades novas';
  end if;
end $a$;

-- P. Regras puras: parcelas, documento, e-mail, dia útil, tabela de transições ------------------------------------
do $p$
declare
  m text;
  r jsonb;
begin
  -- P1. 100,00 em 3: 33,33 + 33,33 + 33,34; vencimento no mesmo dia ou no último dia do mês.
  select string_agg(c.n || '=' || c.vencimento || '=' || c.valor, ',' order by c.n) into m
    from receita.fat_parcelas_calcular(100.00, 3, '2026-01-31') c;
  if m <> '1=2026-01-31=33.33,2=2026-02-28=33.33,3=2026-03-31=33.34' then raise exception 'FALHOU P1: %', m; end if;
  -- P2. CA-02: 16.000,00 em 3.
  select string_agg(c.valor::text, ',' order by c.n) || '=' || sum(c.valor) into m
    from receita.fat_parcelas_calcular(16000.00, 3, '2026-11-10') c;
  if m <> '5333.33,5333.33,5333.34=16000.00' then raise exception 'FALHOU P2: %', m; end if;
  -- P3. Soma exata em casos de borda; 29/02 mantém o dia 29.
  if (select sum(c.valor) from receita.fat_parcelas_calcular(1000.00, 36, '2026-01-31') c) <> 1000.00
     or (select sum(c.valor) from receita.fat_parcelas_calcular(999.99, 7, '2026-05-31') c) <> 999.99
     or (select count(*) from receita.fat_parcelas_calcular(1000.00, 36, '2026-01-31') c) <> 36
     or (select string_agg(c.valor::text, ',') from receita.fat_parcelas_calcular(0.05, 5, '2026-01-01') c) <> '0.01,0.01,0.01,0.01,0.01'
     or (select string_agg(c.vencimento::text, ',' order by c.n) from receita.fat_parcelas_calcular(30.00, 3, '2028-02-29') c)
        <> '2028-02-29,2028-03-29,2028-04-29'
     or (select string_agg(c.vencimento::text, ',' order by c.n) from receita.fat_parcelas_calcular(30.00, 3, '2026-10-31') c)
        <> '2026-10-31,2026-11-30,2026-12-31' then
    raise exception 'FALHOU P3: soma ou vencimento das parcelas fora da regra';
  end if;
  -- P4. Recusas: parcela menor que 1 centavo, 37 parcelas, valor zero ou negativo, 3 casas decimais.
  perform pg_temp.erro($q$select * from receita.fat_parcelas_calcular(0.02, 3, '2026-01-01')$q$, '22023', 'P4 0,02 em 3');
  perform pg_temp.erro($q$select * from receita.fat_parcelas_calcular(100, 37, '2026-01-01')$q$, '22023', 'P4 37 parcelas');
  perform pg_temp.erro($q$select * from receita.fat_parcelas_calcular(0, 1, '2026-01-01')$q$, '22023', 'P4 valor zero');
  perform pg_temp.erro($q$select * from receita.fat_parcelas_calcular(-5, 1, '2026-01-01')$q$, '22023', 'P4 valor negativo');
  perform pg_temp.erro($q$select * from receita.fat_parcelas_calcular(10.005, 1, '2026-01-01')$q$, '22023', 'P4 três casas');
  -- P5. Documento e e-mail.
  if not (receita.fat_documento_valido('11222333000181') and receita.fat_documento_valido('52998224725')
          and receita.fat_documento_valido('12345678000195'))
     or receita.fat_documento_valido('11222333000180') or receita.fat_documento_valido('11111111111111')
     or receita.fat_documento_valido('52998224724') or receita.fat_documento_valido('123')
     or receita.fat_documento_valido('1122233300018a') then
    raise exception 'FALHOU P5: dígito verificador';
  end if;
  if not receita.fat_email_valido('a.b+c@cliente-x.com.br') or receita.fat_email_valido('a@b')
     or receita.fat_email_valido('sem arroba') or receita.fat_email_valido('a b@c.com') then
    raise exception 'FALHOU P5: e-mail';
  end if;
  -- P6. Dia útil (sexta 16/10 → segunda 19/10 = 1) e a tabela de transições.
  if receita.fat_dias_uteis('2026-10-16', '2026-10-19') <> 1 or receita.fat_dias_uteis('2026-10-19', '2026-10-21') <> 2
     or receita.fat_dias_uteis('2026-10-21', '2026-10-21') <> 0 then
    raise exception 'FALHOU P6: dias úteis';
  end if;
  if receita.fat_transicao_permitida('rascunho', 'recebido') or receita.fat_transicao_permitida('cancelado', 'rascunho')
     or receita.fat_transicao_permitida('na_fila_omie', 'em_conferencia') or receita.fat_transicao_permitida('faturado', 'devolvido')
     or not receita.fat_transicao_permitida('aguardando_ok', 'na_fila_omie')
     or not receita.fat_transicao_permitida('cancelamento_pedido', 'cancelado') then
    raise exception 'FALHOU P6: tabela de transições';
  end if;
  -- P7. A prévia da tela é a mesma regra.
  perform pg_temp.como('a1');
  r := ops.fat_parcelas_previa(100.00, 3, '2026-01-31');
  if r ->> 'total' <> '100.00' or (select string_agg(x ->> 'valor', ',' order by (x ->> 'n')::int) from jsonb_array_elements(r -> 'parcelas') x)
     <> '33.33,33.33,33.34' then
    raise exception 'FALHOU P7: prévia = %', r;
  end if;
  perform pg_temp.erro($q$select ops.fat_parcelas_previa(0.02, 3, '2026-01-01')$q$, '22023', 'P7 prévia inválida');
  perform pg_temp.como('postgres');
end $p$;

-- T0. Tempos com a base sem pedidos (limite 300 ms; cada RPC é chamada uma vez para aquecer e de novo para medir) --
do $t0$
declare
  q text;
begin
  foreach q in array array['select ops.fat_contexto()', 'select ops.fat_resumo()', $s$select ops.fat_pedidos('{}')$s$,
                           'select ops.fat_fila_tesouraria()', 'select ops.fat_config()'] loop
    perform pg_temp.medir('vazio_frio ' || q, 'ad', q, 300);
    perform pg_temp.medir('vazio ' || q, 'ad', q, 300);
  end loop;
end $t0$;

-- F. Fluxo do pedido e auto-OK -------------------------------------------------------------------------------------
do $f$
declare
  doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  pac constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  base jsonb;
  r jsonb;
  ped uuid;
  rec record;
  n int;
  m text;
begin
  if pg_temp.svc(doc) is null or pg_temp.svc(pac) is null then
    raise exception 'ENSAIO INVÁLIDO: DOC ou PAC sem serviço liberado no catálogo';
  end if;
  base := jsonb_build_object(
    'emissora_id', doc, 'tomador_tipo', 'pj', 'tomador_documento', '11.222.333/0001-81',
    'tomador_nome', 'CLIENTE ENSAIO LTDA',
    'emails_envio', jsonb_build_array('Financeiro@Cliente-Ensaio.com.br', ' financeiro@cliente-ensaio.com.br ', 'contas@cliente-ensaio.com.br'),
    'projeto', '  Alteração   contratual 2026 ', 'servico_id', pg_temp.svc(doc), 'descricao_nf', 'Serviço de ensaio · 11/2026',
    'valor', 300.00, 'forma', 'parcelado', 'parcelas', 3, 'primeiro_vencimento', '2026-11-10', 'documento', 'nf',
    'meio', 'boleto', 'departamento', 'Jurídico', 'observacoes', 'Pedido de ensaio da T1b');
  perform set_config('ens.base', base::text, true);

  -- F1. PA: o dono cria e envia; vai direto para a fila.
  perform pg_temp.como('a1');
  r := ops.fat_pedido_salvar(null, base);
  ped := (r ->> 'id')::uuid;
  perform pg_temp.guarda('PA', ped);
  if r ->> 'status' <> 'rascunho' or r ->> 'numero' !~ '^FAT-1999-[0-9]{6}$' then raise exception 'FALHOU F1: salvar devolveu %', r; end if;
  if jsonb_array_length(r -> 'pendencias') <> 0 then raise exception 'FALHOU F1: pendências %', r -> 'pendencias'; end if;
  if (select string_agg(x ->> 'valor', ',' order by (x ->> 'n')::int) from jsonb_array_elements(r -> 'parcelas') x) <> '100.00,100.00,100.00' then
    raise exception 'FALHOU F1: prévia das parcelas %', r -> 'parcelas';
  end if;
  r := ops.fat_pedido_enviar(ped);
  if r ->> 'status' <> 'na_fila_omie' or not (r ->> 'simulacao_emissora')::boolean or r -> 'aguardando' <> 'null'::jsonb then
    raise exception 'FALHOU F1: enviar devolveu %', r;
  end if;
  perform pg_temp.como('postgres');
  select * into rec from receita.fat_pedidos where id = ped;
  if rec.projeto <> 'Alteração contratual 2026' or rec.emails_envio <> array['financeiro@cliente-ensaio.com.br', 'contas@cliente-ensaio.com.br']
     or rec.tomador_documento <> '11222333000181' or rec.dono_id <> pg_temp.u('a1') or rec.competencia <> '2026-11-01'
     or rec.enviado_por <> pg_temp.u('a1') or rec.enviado_em is null or rec.na_fila_em is null then
    raise exception 'FALHOU F1: normalização ou carimbos do pedido (projeto %, e-mails %, competência %)', rec.projeto, rec.emails_envio, rec.competencia;
  end if;
  select string_agg(x.n || '=' || x.vencimento || '=' || x.valor, ',' order by x.n) into m from receita.fat_pedido_parcelas x where x.pedido_id = ped;
  if m <> '1=2026-11-10=100.00,2=2026-12-10=100.00,3=2027-01-10=100.00' then raise exception 'FALHOU F1: parcelas gravadas %', m; end if;
  set constraints receita.fat_pedido_parcelas_soma, receita.fat_pedidos_parcelas_soma immediate;
  set constraints receita.fat_pedido_parcelas_soma, receita.fat_pedidos_parcelas_soma deferred;
  select string_agg(x.operacao || ':' || x.status || ':' || x.modo || ':' || (x.codigo_integracao = rec.numero)
                    || ':' || coalesce((select d.operacao from integracoes.omie_envios d where d.id = x.depende_de), '-'), ','
                    order by x.operacao) into m
    from integracoes.omie_envios x where x.origem_id = ped;
  if m <> 'garantir_cliente:pendente:simular:true:-,incluir_os:pendente:simular:true:garantir_cliente' then
    raise exception 'FALHOU F1: fila do Omie = %', m;
  end if;
  select string_agg(x.operacao || ':' || x.status, ',') into m from integracoes.pipefy_envios x where x.origem_id = ped;
  if m <> 'criar_card:pendente' then raise exception 'FALHOU F1: fila do Pipefy = %', m; end if;
  select string_agg(v.evento || ':' || coalesce(v.de, '-') || '>' || v.para || ':' || (v.autor_id = pg_temp.u('a1')), ',' order by v.id) into m
    from receita.fat_eventos v where v.entidade = 'pedido' and v.entidade_id = ped;
  if m <> 'criado:rascunho>rascunho:true,enviado:rascunho>na_fila_omie:true' then raise exception 'FALHOU F1: eventos = %', m; end if;

  -- F2. CA-06: enviar de novo é recusado e não cria envio.
  perform pg_temp.como('a1');
  perform pg_temp.erro(format('select ops.fat_pedido_enviar(%L)', ped), '55000', 'F2 enviar duas vezes');
  perform pg_temp.como('postgres');
  select count(*) into n from integracoes.omie_envios where origem_id = ped;
  if n <> 2 then raise exception 'FALHOU F2: % envios depois do segundo enviar (esperava 2)', n; end if;

  -- F3. PS: a solicitante pede com dono b1 → Aguardando OK; ela não dá OK no próprio pedido; o substituto dá.
  perform pg_temp.como('s1');
  r := ops.fat_pedido_salvar(null, base || jsonb_build_object('dono_id', pg_temp.u('b1'), 'tomador_documento', '12345678000195',
                                                              'valor', 1500.00, 'forma', 'avulso', 'parcelas', 3));
  ped := (r ->> 'id')::uuid;
  perform pg_temp.guarda('PS', ped);
  r := ops.fat_pedido_enviar(ped);
  if r ->> 'status' <> 'aguardando_ok' or (r -> 'aguardando' ->> 'id')::uuid <> pg_temp.u('b1') then
    raise exception 'FALHOU F3: enviar da solicitante devolveu %', r;
  end if;
  m := pg_temp.erro(format('select ops.fat_pedido_aprovar(%L)', ped), '42501', 'F3 auto-OK da solicitante');
  if m not like 'Quem enviou não dá o OK no próprio pedido.%' then raise exception 'FALHOU F3: mensagem do auto-OK: %', m; end if;
  perform pg_temp.como('b1');
  m := pg_temp.erro(format('select ops.fat_pedido_devolver(%L, null)', ped), '22023', 'F3 devolver sem motivo');
  if m not like '%"campo": "motivo"%' then raise exception 'FALHOU F3: devolver sem motivo não apontou o campo: %', m; end if;
  if (ops.fat_contexto() #>> '{pendencias,ok_a_dar,quantidade}')::int <> 1 then raise exception 'FALHOU F3: OK a dar do dono'; end if;
  perform pg_temp.como('s2');
  if (ops.fat_contexto() #>> '{pendencias,ok_a_dar,quantidade}')::int <> 1 then raise exception 'FALHOU F3: OK a dar do substituto'; end if;
  perform pg_temp.como('g1');
  if (ops.fat_contexto() #>> '{pendencias,ok_a_dar,quantidade}')::int <> 0 then raise exception 'FALHOU F3: gestor com OK a dar antes de 2 dias úteis'; end if;
  perform pg_temp.como('s1');
  if (ops.fat_contexto() #>> '{pendencias,ok_a_dar,quantidade}')::int <> 0 then raise exception 'FALHOU F3: autor com OK a dar do próprio pedido'; end if;
  perform pg_temp.como('postgres');
  if (select count(*) from integracoes.omie_envios where origem_id = ped) + (select count(*) from integracoes.pipefy_envios where origem_id = ped) <> 0 then
    raise exception 'FALHOU F3: pedido aguardando OK já foi para as filas';
  end if;
  if (select forma || parcelas from receita.fat_pedidos where id = ped) <> 'avulso1' then raise exception 'FALHOU F3: avulso não virou 1 parcela'; end if;
  perform pg_temp.como('s2');
  r := ops.fat_pedido_aprovar(ped);
  if r ->> 'status' <> 'na_fila_omie' then raise exception 'FALHOU F3: OK do substituto devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if not exists (select 1 from receita.fat_eventos v where v.entidade_id = ped and v.evento = 'aprovado' and v.autor_id = pg_temp.u('s2')) then
    raise exception 'FALHOU F3: evento aprovado sem o substituto como autor';
  end if;

  -- F4. PG: o gestor pede com dono a1; o gestor não dá OK no que enviou; o dono dá.
  perform pg_temp.como('g1');
  r := ops.fat_pedido_salvar(null, base || jsonb_build_object('dono_id', pg_temp.u('a1'), 'tomador_documento', '74185296000107'));
  ped := (r ->> 'id')::uuid;
  perform pg_temp.guarda('PG', ped);
  r := ops.fat_pedido_enviar(ped);
  if r ->> 'status' <> 'aguardando_ok' then raise exception 'FALHOU F4: enviar do gestor devolveu %', r; end if;
  m := pg_temp.erro(format('select ops.fat_pedido_aprovar(%L)', ped), '42501', 'F4 auto-OK do gestor');
  if m not like 'Quem enviou não dá o OK no próprio pedido.%' then raise exception 'FALHOU F4: mensagem: %', m; end if;
  perform pg_temp.como('a1');
  r := ops.fat_pedido_aprovar(ped);
  if r ->> 'status' <> 'na_fila_omie' then raise exception 'FALHOU F4: OK do dono devolveu %', r; end if;

  -- F5. RD: rascunho da solicitante, nunca enviado.
  perform pg_temp.como('s1');
  r := ops.fat_pedido_salvar(null, jsonb_build_object('emissora_id', doc, 'projeto', 'Rascunho de ensaio'));
  perform pg_temp.guarda('RD', (r ->> 'id')::uuid);
  if jsonb_array_length(r -> 'pendencias') < 5 then raise exception 'FALHOU F5: rascunho incompleto sem pendências: %', r -> 'pendencias'; end if;

  -- F6. PP: o dono da PAC pede e envia.
  perform pg_temp.como('p1');
  r := ops.fat_pedido_salvar(null, base || jsonb_build_object('emissora_id', pac, 'servico_id', pg_temp.svc(pac)));
  perform pg_temp.guarda('PP', (r ->> 'id')::uuid);
  r := ops.fat_pedido_enviar(pg_temp.p('PP'));
  if r ->> 'status' <> 'na_fila_omie' then raise exception 'FALHOU F6: PP devolveu %', r; end if;
  perform pg_temp.como('postgres');
end $f$;

-- E. CA-09: escopo por chamada direta ------------------------------------------------------------------------------
do $e$
declare
  r jsonb;
  m text;
begin
  -- E1. Quem vê o quê (PA e PG: DOC, dono a1; PS: DOC, dono b1, autora s1; RD: rascunho de s1; PP: PAC, dono p1).
  foreach m in array array['a1=PA,PG', 'b1=PS', 's2=PS', 's1=PS,RD', 'g1=PA,PS,PG', 'p1=PP', 't1=PA,PS,PG,PP',
                           'c1=PA,PS,PG,PP', 'ad=PA,PS,PG,PP', 't2=', 'z1='] loop
    if pg_temp.vistos(split_part(m, '=', 1)) <> split_part(m, '=', 2) then
      raise exception 'FALHOU E1: % vê "%" (esperava "%")', split_part(m, '=', 1), pg_temp.vistos(split_part(m, '=', 1)), split_part(m, '=', 2);
    end if;
  end loop;

  -- E2. A ficha fora do escopo não mostra nada; id inexistente é não encontrado.
  perform pg_temp.como('a1');
  perform pg_temp.erro(format('select ops.fat_pedido(%L)', pg_temp.p('PS')), '42501', 'E2 dono A abre pedido do dono B');
  perform pg_temp.erro(format('select ops.fat_pedido(%L)', gen_random_uuid()), 'P0002', 'E2 id inexistente');
  perform pg_temp.erro(format('select ops.fat_tomador(%L, %L)', '11222333000181', '8cdf5de7-683f-4d8e-a194-f303677ac6ea'), '42501', 'E2 tomador em empresa sem papel');
  perform pg_temp.erro(format('select ops.fat_servicos(%L)', '8cdf5de7-683f-4d8e-a194-f303677ac6ea'), '42501', 'E2 catálogo de empresa sem papel');
  perform pg_temp.erro('select ops.fat_fila_tesouraria()', '42501', 'E2 dono abre a fila da tesouraria');
  perform pg_temp.erro('select ops.fat_config()', '42501', 'E2 dono abre a configuração');
  perform pg_temp.como('g1');
  perform pg_temp.erro(format('select ops.fat_pedido(%L)', pg_temp.p('PP')), '42501', 'E2 gestor da DOC abre pedido da PAC');
  perform pg_temp.erro(format('select ops.fat_pedido(%L)', pg_temp.p('RD')), '42501', 'E2 gestor abre rascunho alheio');
  perform pg_temp.como('t1');
  perform pg_temp.erro(format('select ops.fat_pedido(%L)', pg_temp.p('RD')), '42501', 'E2 tesouraria abre rascunho');
  perform pg_temp.erro('select ops.fat_config()', '42501', 'E2 tesouraria abre a configuração');
  perform pg_temp.como('t2');
  perform pg_temp.erro(format('select ops.fat_pedido(%L)', pg_temp.p('PA')), '42501', 'E2 tesouraria fora do recorte');
  perform pg_temp.erro(format('select ops.fat_fila_tesouraria(%L)', 'c243e5e4-8309-43e6-ac33-146b9771a44e'), '42501', 'E2 fila de empresa fora do recorte');
  perform pg_temp.como('z1');
  perform pg_temp.erro(format('select ops.fat_pedido(%L)', pg_temp.p('PA')), '42501', 'E2 porta sem papel');
  perform pg_temp.erro($q$select ops.fat_pedido_salvar(null, '{"emissora_id": "c243e5e4-8309-43e6-ac33-146b9771a44e"}')$q$, '42501', 'E2 porta sem papel cria pedido');
  -- E3. Sem a porta: nenhuma RPC responde.
  perform pg_temp.como('n1');
  perform pg_temp.erro('select ops.fat_contexto()', '42501', 'E3 sem porta: contexto');
  perform pg_temp.erro($q$select ops.fat_pedidos('{}')$q$, '42501', 'E3 sem porta: lista');
  perform pg_temp.erro('select ops.fat_resumo()', '42501', 'E3 sem porta: resumo');
  perform pg_temp.erro(format('select ops.fat_pedido(%L)', pg_temp.p('PA')), '42501', 'E3 sem porta: ficha');
  perform pg_temp.erro('select ops.fat_departamentos()', '42501', 'E3 sem porta: departamentos');

  -- E4. Contexto e resumo do dono e do gestor batem com a lista.
  perform pg_temp.como('a1');
  r := ops.fat_contexto();
  if (select string_agg(x ->> 'apelido', ',') from jsonb_array_elements(r -> 'emissoras') x) <> 'DOC'
     or r #>> '{emissoras,0,meus_papeis}' <> '["dono"]' or jsonb_array_length(r #> '{emissoras,0,donos}') <> 2
     or (r #>> '{papeis,tesouraria}')::boolean or r #> '{pendencias,para_faturar}' <> 'null'::jsonb then
    raise exception 'FALHOU E4: contexto do dono = %', r;
  end if;
  r := ops.fat_resumo();
  if r #>> '{recorte,tipo}' <> 'pessoal' or r #>> '{numeros,a_faturar,valor}' <> '600.00' or r #>> '{numeros,a_faturar,quantidade}' <> '2'
     or (ops.fat_pedidos(r #> '{numeros,a_faturar,filtro}') ->> 'soma') <> '600.00' then
    raise exception 'FALHOU E4: A faturar do dono = % (lista %)', r -> 'numeros', ops.fat_pedidos(r #> '{numeros,a_faturar,filtro}') ->> 'soma';
  end if;
  perform pg_temp.como('g1');
  r := ops.fat_resumo();
  if r #>> '{recorte,tipo}' <> 'gestor' or r #>> '{numeros,a_faturar,valor}' <> '2100.00'
     or (ops.fat_pedidos(r #> '{numeros,a_faturar,filtro}') ->> 'soma') <> '2100.00' then
    raise exception 'FALHOU E4: A faturar do gestor = %', r -> 'numeros';
  end if;
  perform pg_temp.como('postgres');
end $e$;

-- C. Conector: dependência, CA-12 (Omie de uma emissora fora) e CA-06 (reenviar não duplica) -------------------------
do $c$
declare
  doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  r jsonb;
  i jsonb;
  m text;
  n int;
  alvo uuid;
  chave_suspensa constant text := 'Chave do Omie da DOC suspensa: peça uma nova ao administrador da empresa.';
begin
  -- C1. Só os garantir_cliente saem; os incluir_os esperam a dependência.
  perform pg_temp.como('conector');
  r := integracoes.fat_envio_proximos(100);
  select string_agg(nome || ':' || (x ->> 'operacao'), ',' order by nome) into m
    from jsonb_array_elements(r) x
    join (values ('PA'), ('PS'), ('PG'), ('PP')) v (nome) on pg_temp.p(v.nome) = (x ->> 'origem_id')::uuid;
  if m <> 'PA:garantir_cliente,PG:garantir_cliente,PP:garantir_cliente,PS:garantir_cliente' then
    raise exception 'FALHOU C1: reservados = %', m;
  end if;
  if exists (select 1 from jsonb_array_elements(r) x where x ->> 'operacao' = 'incluir_os') then
    raise exception 'FALHOU C1: incluir_os saiu antes do garantir_cliente';
  end if;
  if exists (select 1 from jsonb_array_elements(r) x where x ->> 'modo' <> 'simular' or x -> 'payload' ? 'app_key') then
    raise exception 'FALHOU C1: envio fora de simulação ou com chave no payload';
  end if;
  -- C2. A chave da DOC suspensa: erro legível, emissora indisponível e bloqueada; a PAC segue.
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = pg_temp.p('PA') then
      perform integracoes.fat_envio_resultado((i ->> 'id')::uuid, 'erro', jsonb_build_object('http', 403), chave_suspensa,
                jsonb_build_object('emissora_indisponivel', true, 'bloquear_emissora_ate', now() + interval '10 minutes'));
    elsif (i ->> 'origem_id')::uuid = pg_temp.p('PP') then
      perform integracoes.fat_envio_resultado((i ->> 'id')::uuid, 'simulado', null, null, '{"cliente_existia": false}');
    else
      perform integracoes.fat_envio_resultado((i ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
    end if;
  end loop;
  perform pg_temp.como('postgres');
  if pg_temp.status('PA') <> 'erro_omie' or (select motivo_status from receita.fat_pedidos where id = pg_temp.p('PA')) <> chave_suspensa then
    raise exception 'FALHOU C2: PA em % sem o erro legível', pg_temp.status('PA');
  end if;
  if not exists (select 1 from integracoes.omie_emissora_estado s where s.emissora_id = doc and s.indisponivel
                    and s.motivo = chave_suspensa and s.bloqueada_ate > now()) then
    raise exception 'FALHOU C2: DOC não ficou indisponível e bloqueada';
  end if;
  perform pg_temp.como('conector');
  r := integracoes.fat_envio_proximos(100);
  if exists (select 1 from jsonb_array_elements(r) x where (x #>> '{emissora,id}')::uuid = doc) then
    raise exception 'FALHOU C2: a fila da DOC andou com a emissora bloqueada';
  end if;
  alvo := null;
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = pg_temp.p('PP') and i ->> 'operacao' = 'incluir_os' then
      alvo := (i ->> 'id')::uuid;
    else
      perform integracoes.fat_envio_resultado((i ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
    end if;
  end loop;
  if alvo is null then raise exception 'FALHOU C2 (CA-12): a PAC não seguiu com a DOC fora: %', r; end if;
  perform pg_temp.erro(format($q$select integracoes.fat_envio_resultado(%L, 'ok', null, null, '{"nCodOS": 1}')$q$, alvo), '22023', 'C2 ok em envio simulado');
  perform integracoes.fat_envio_resultado(alvo, 'simulado', null, null, '{"cliente_existe": false, "servico_existe": true}');
  perform pg_temp.como('postgres');
  if pg_temp.status('PP') <> 'simulado' or not (select simulacao from receita.fat_pedidos where id = pg_temp.p('PP')) then
    raise exception 'FALHOU C2: PP em % sem simulação', pg_temp.status('PP');
  end if;

  -- C3. O erro aparece para o autor e para a tesouraria; a ficha da empresa mostra indisponível.
  perform pg_temp.como('a1');
  r := ops.fat_contexto();
  if (r #>> '{pendencias,erro_omie,quantidade}')::int <> 1 or r #>> '{erros_omie,0,erro_legivel}' <> chave_suspensa then
    raise exception 'FALHOU C3: erro do Omie no contexto do autor = %', r -> 'erros_omie';
  end if;
  perform pg_temp.como('t1');
  r := ops.fat_fila_tesouraria();
  if not (select (x #>> '{omie,indisponivel}')::boolean from jsonb_array_elements(r -> 'emissoras') x where x ->> 'apelido' = 'DOC')
     or (r #>> '{higiene,erro}')::int < 1 then
    raise exception 'FALHOU C3: fila da tesouraria sem a DOC indisponível ou sem o erro';
  end if;

  -- C4. Reenviar (a chave nova entrou): a mesma linha volta, nenhuma linha nova; o ciclo termina em simulado.
  perform pg_temp.como('a1');
  r := ops.fat_pedido_reenviar(pg_temp.p('PA'));
  if r ->> 'status' <> 'na_fila_omie' or (r ->> 'reenfileirados')::int <> 1 then raise exception 'FALHOU C4: reenviar devolveu %', r; end if;
  perform pg_temp.como('postgres');
  update integracoes.omie_emissora_estado set bloqueada_ate = null where emissora_id = doc;  -- passou o bloqueio
  perform pg_temp.omie(pg_temp.p('PA'), 'garantir_cliente', 'simulado', '{"cliente_existia": true}');
  perform pg_temp.omie(pg_temp.p('PA'), 'incluir_os', 'simulado', '{"cliente_existe": true, "servico_existe": true}');
  perform pg_temp.omie(pg_temp.p('PS'), 'garantir_cliente', 'simulado', '{"cliente_existia": false}');
  perform pg_temp.omie(pg_temp.p('PS'), 'incluir_os', 'simulado', '{"cliente_existe": false, "servico_existe": true}');
  perform pg_temp.omie(pg_temp.p('PG'), 'garantir_cliente', 'simulado', '{"cliente_existia": false}');
  perform pg_temp.omie(pg_temp.p('PG'), 'incluir_os', 'simulado', '{"cliente_existe": false, "servico_existe": true}');
  if pg_temp.status('PA') || pg_temp.status('PS') || pg_temp.status('PG') <> 'simuladosimuladosimulado' then
    raise exception 'FALHOU C4: situações depois da simulação: % % %', pg_temp.status('PA'), pg_temp.status('PS'), pg_temp.status('PG');
  end if;
  select string_agg(x.operacao || ':' || x.status, ',' order by x.operacao) into m from integracoes.omie_envios x where x.origem_id = pg_temp.p('PA');
  if m <> 'garantir_cliente:simulado,incluir_os:simulado' then raise exception 'FALHOU C4 (CA-06): envios do PA = %', m; end if;
  if exists (select 1 from integracoes.omie_emissora_estado s where s.emissora_id = doc and s.indisponivel) then
    raise exception 'FALHOU C4: a DOC continuou indisponível depois de responder';
  end if;
  select string_agg(v.evento, ',' order by v.id) into m from receita.fat_eventos v where v.entidade_id = pg_temp.p('PA');
  if m <> 'criado,enviado,omie_erro,reenviado,omie_cliente,omie_simulado' then raise exception 'FALHOU C4: linha do tempo do PA = %', m; end if;

  -- C5. Pipefy: por pedido, só o envio mais antigo sai (o card antes de mover a fase).
  perform pg_temp.como('conector');
  r := integracoes.pipefy_envio_proximos(100);
  if exists (select 1 from jsonb_array_elements(r) x where x ->> 'operacao' <> 'criar_card')
     or (select count(*) from jsonb_array_elements(r) x where (x ->> 'origem_id')::uuid = pg_temp.p('PA')) <> 1 then
    raise exception 'FALHOU C5: primeira rodada do Pipefy = %', r;
  end if;
  for i in select * from jsonb_array_elements(r) loop
    perform integracoes.pipefy_envio_resultado((i ->> 'id')::uuid, 'simulado', '{"fase": "SOLICITAÇÃO ABERTA"}', null, null);
  end loop;
  r := integracoes.pipefy_envio_proximos(100);
  select x into i from jsonb_array_elements(r) x where (x ->> 'origem_id')::uuid = pg_temp.p('PA');
  if i ->> 'operacao' <> 'mover_fase' or i #>> '{payload,de}' <> 'na_fila_omie' or i #>> '{payload,para}' <> 'erro_omie' then
    raise exception 'FALHOU C5: segundo envio do Pipefy do PA = %', i;
  end if;
  for i in select * from jsonb_array_elements(r) loop
    perform integracoes.pipefy_envio_resultado((i ->> 'id')::uuid, 'simulado', null, null, null);
  end loop;
  perform pg_temp.como('postgres');
end $c$;

-- V. CA-10: devolução -------------------------------------------------------------------------------------------------
do $v$
declare
  r jsonb;
  m text;
  ped uuid := pg_temp.p('PS');
  motivo constant text := 'Falta o e-mail do financeiro do cliente.';
begin
  perform pg_temp.como('t1');
  perform pg_temp.erro(format($q$select ops.fat_tesouraria_acao(%L, 'devolver', null)$q$, ped), '22023', 'V1 devolver sem motivo');
  perform pg_temp.erro(format($q$select ops.fat_pedido_devolver(%L, '   ')$q$, ped), '22023', 'V1 devolver com motivo em branco');
  r := ops.fat_pedido_devolver(ped, motivo);
  if r ->> 'status' <> 'devolvido' or (r #>> '{devolvido_a,id}')::uuid <> pg_temp.u('s1') then raise exception 'FALHOU V2: devolver devolveu %', r; end if;
  perform pg_temp.como('postgres');
  select v.evento || '|' || v.de || '>' || v.para || '|' || (v.diff ->> 'motivo') || '|' || (v.autor_id = pg_temp.u('t1')) into m
    from receita.fat_eventos v where v.entidade_id = ped order by v.id desc limit 1;
  if m <> 'devolvido|simulado>devolvido|' || motivo || '|true' then raise exception 'FALHOU V2: evento da devolução = %', m; end if;
  -- V3. Volta ao autor: aparece nas pendências dele e na linha do tempo da ficha.
  perform pg_temp.como('s1');
  r := ops.fat_contexto();
  if (r #>> '{pendencias,devolvidos,quantidade}')::int <> 1 then raise exception 'FALHOU V3: devolvidos do autor = %', r -> 'pendencias'; end if;
  if (ops.fat_pedidos('{"pendencia": "devolvido"}') ->> 'total')::int <> 1 then raise exception 'FALHOU V3: lista de devolvidos do autor'; end if;
  r := ops.fat_pedido(ped);
  if r #>> '{eventos,0,evento}' <> 'devolvido' or r #>> '{eventos,0,diff,motivo}' <> motivo or r #>> '{pedido,motivo_status}' <> motivo
     or not (r #>> '{acoes,editar,pode}')::boolean then
    raise exception 'FALHOU V3: ficha do devolvido = %', r -> 'eventos' -> 0;
  end if;
  -- V4. O autor corrige e reenvia; o dono dá o OK; a fila reaproveita as linhas (sem OS ainda: incluir_os de novo).
  r := ops.fat_pedido_salvar(ped, '{"projeto": "Projeto corrigido"}');
  if r ->> 'status' <> 'devolvido' then raise exception 'FALHOU V4: salvar do devolvido devolveu %', r; end if;
  r := ops.fat_pedido_enviar(ped);
  if r ->> 'status' <> 'aguardando_ok' then raise exception 'FALHOU V4: reenvio do devolvido foi para %', r ->> 'status'; end if;
  perform pg_temp.como('b1');
  r := ops.fat_pedido_aprovar(ped);
  perform pg_temp.como('postgres');
  select string_agg(x.operacao || ':' || x.status, ',' order by x.operacao) into m from integracoes.omie_envios x where x.origem_id = ped;
  if m <> 'garantir_cliente:pendente,incluir_os:pendente' or (select simulacao from receita.fat_pedidos where id = ped) then
    raise exception 'FALHOU V4: fila do PS depois do reenvio = %', m;
  end if;
  if not exists (select 1 from receita.fat_eventos v where v.entidade_id = ped and v.evento = 'alterado'
                    and v.diff -> 'projeto' ->> 'para' = 'Projeto corrigido') then
    raise exception 'FALHOU V4: alteração do devolvido sem evento com diff';
  end if;
end $v$;

-- G. Gravação no Omie, alterar_os depois da devolução, faturar, status (RF-P08, RF-P09) ------------------------------
do $g$
declare
  doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  base jsonb := current_setting('ens.base')::jsonb;
  r jsonb;
  m text;
  ped uuid;
  alvo uuid;
  hoje date := receita.fat_hoje();  -- calculado como postgres: a função é interna
  mes text := to_char(receita.fat_hoje(), 'YYYY-MM');
begin
  -- G1. Ligar a gravação: a controladoria não liga; o admin liga; vira evento. O envio já na fila segue em simulação.
  perform pg_temp.como('c1');
  m := pg_temp.erro(format($q$select ops.fat_emissora_config(%L, 'gravar')$q$, doc), '42501', 'G1 controladoria liga a gravação');
  perform pg_temp.como('ad');
  r := ops.fat_emissora_config(doc, 'gravar');
  if r ->> 'modo_omie' <> 'gravar' then raise exception 'FALHOU G1: config devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if not exists (select 1 from receita.fat_eventos v where v.entidade = 'emissora' and v.entidade_id = doc and v.evento = 'configurado'
                    and v.diff -> 'modo_omie' ->> 'para' = 'gravar' and v.autor_id = pg_temp.u('ad')) then
    raise exception 'FALHOU G1: ligar a gravação não virou evento';
  end if;
  if (select modo from integracoes.omie_envios where origem_id = pg_temp.p('PS') and operacao = 'incluir_os') <> 'simular' then
    raise exception 'FALHOU G1: envio que já estava na fila mudou de modo';
  end if;

  -- G2. PG2: o dono pede R$ 1.000 em 3 com 1º vencimento em 31/01; os envios saem em gravar.
  perform pg_temp.como('a1');
  r := ops.fat_pedido_salvar(null, base || jsonb_build_object('tomador_documento', '74185296000107', 'valor', 1000.00,
                                                              'parcelas', 3, 'primeiro_vencimento', '2026-01-31'));
  ped := (r ->> 'id')::uuid;
  perform pg_temp.guarda('PG2', ped);
  r := ops.fat_pedido_enviar(ped);
  if r ->> 'status' <> 'na_fila_omie' or (r ->> 'simulacao_emissora')::boolean then raise exception 'FALHOU G2: enviar devolveu %', r; end if;
  perform pg_temp.como('postgres');
  select string_agg(x.valor || '@' || x.vencimento, ',' order by x.n) into m from receita.fat_pedido_parcelas x where x.pedido_id = ped;
  if m <> '333.33@2026-01-31,333.33@2026-02-28,333.34@2026-03-31' then raise exception 'FALHOU G2: parcelas = %', m; end if;
  if exists (select 1 from integracoes.omie_envios x where x.origem_id = ped and x.modo <> 'gravar') then
    raise exception 'FALHOU G2: envio da emissora em gravar saiu em simular';
  end if;

  -- G3. Cliente garantido e OS criada (ok exige modo gravar e nCodOS).
  alvo := pg_temp.reservar(ped, 'garantir_cliente');
  perform pg_temp.como('conector');
  perform pg_temp.erro(format($q$select integracoes.fat_envio_resultado(%L, 'simulado')$q$, alvo), '22023', 'G3 simulado em envio que grava');
  perform integracoes.fat_envio_resultado(alvo, 'ok', '{"retorno": "ok"}', null,
            '{"codigo_cliente_omie": 555, "codigo_cliente_integracao": "74185296000107", "cliente_existia": false}');
  perform pg_temp.como('postgres');
  alvo := pg_temp.reservar(ped, 'incluir_os');
  perform pg_temp.como('conector');
  perform pg_temp.erro(format($q$select integracoes.fat_envio_resultado(%L, 'ok')$q$, alvo), '22023', 'G3 ok sem nCodOS');
  perform pg_temp.erro(format($q$select integracoes.fat_envio_resultado(%L, 'erro')$q$, alvo), '22023', 'G3 erro sem mensagem legível');
  perform integracoes.fat_envio_resultado(alvo, 'ok', null, null, '{"nCodOS": 3021, "cEtapa": "10"}');
  perform pg_temp.como('postgres');
  if pg_temp.status('PG2') <> 'os_criada' or (select omie_os_codigo from receita.fat_pedidos where id = ped) <> 3021
     or not exists (select 1 from integracoes.omie_vinculo_cliente v where v.emissora_id = doc and v.documento = '74185296000107'
                       and v.codigo_cliente_omie = 555) then
    raise exception 'FALHOU G3: PG2 em % ou sem vínculo do cliente', pg_temp.status('PG2');
  end if;

  -- G4. A tesouraria devolve com a OS criada; a empresa não troca; o reenvio altera a OS em vez de criar outra.
  perform pg_temp.como('t1');
  r := ops.fat_pedido_devolver(ped, 'Valor errado: são R$ 1.200,00.');
  perform pg_temp.como('a1');
  m := pg_temp.erro(format($q$select ops.fat_pedido_salvar(%L, '{"emissora_id": "8cdf5de7-683f-4d8e-a194-f303677ac6ea"}')$q$, ped), '22023', 'G4 trocar a empresa com OS');
  if m not like '%3021%' then raise exception 'FALHOU G4: mensagem da troca de empresa: %', m; end if;
  r := ops.fat_pedido_salvar(ped, '{"valor": 1200}');
  r := ops.fat_pedido_enviar(ped);
  if r ->> 'status' <> 'na_fila_omie' then raise exception 'FALHOU G4: reenvio devolveu %', r; end if;
  perform pg_temp.como('postgres');
  select string_agg(x.operacao || ':' || x.status, ',' order by x.operacao) into m from integracoes.omie_envios x where x.origem_id = ped;
  if m <> 'alterar_os:pendente,garantir_cliente:pendente,incluir_os:ok' then raise exception 'FALHOU G4: fila depois da devolução = %', m; end if;
  if (select (payload ->> 'omie_os_codigo')::bigint from integracoes.omie_envios where origem_id = ped and operacao = 'alterar_os') <> 3021 then
    raise exception 'FALHOU G4: alterar_os sem o código da OS';
  end if;
  select string_agg(x.valor::text, ',' order by x.n) into m from receita.fat_pedido_parcelas x where x.pedido_id = ped;
  if m <> '400.00,400.00,400.00' then raise exception 'FALHOU G4: parcelas regeradas = %', m; end if;
  set constraints receita.fat_pedido_parcelas_soma, receita.fat_pedidos_parcelas_soma immediate;
  set constraints receita.fat_pedido_parcelas_soma, receita.fat_pedidos_parcelas_soma deferred;
  perform pg_temp.omie(ped, 'garantir_cliente', 'ok', '{"codigo_cliente_omie": 555, "cliente_existia": true}');
  perform pg_temp.omie(ped, 'alterar_os', 'ok', '{"nCodOS": 3021}');
  if pg_temp.status('PG2') <> 'os_criada'
     or not exists (select 1 from receita.fat_eventos v where v.entidade_id = ped and v.evento = 'omie_os_alterada') then
    raise exception 'FALHOU G4: OS não foi alterada (situação %)', pg_temp.status('PG2');
  end if;

  -- G5. Conferir e faturar; faturar duas vezes e devolver durante o faturamento são recusados.
  perform pg_temp.como('t1');
  r := ops.fat_tesouraria_acao(ped, 'em_conferencia');
  if r ->> 'status' <> 'em_conferencia' then raise exception 'FALHOU G5: conferir devolveu %', r; end if;
  r := ops.fat_tesouraria_acao(ped, 'faturar');
  if not (r ->> 'faturando')::boolean or r ->> 'status' <> 'em_conferencia' then raise exception 'FALHOU G5: faturar devolveu %', r; end if;
  perform pg_temp.erro(format($q$select ops.fat_tesouraria_acao(%L, 'faturar')$q$, ped), '55000', 'G5 faturar duas vezes');
  perform pg_temp.erro(format($q$select ops.fat_pedido_devolver(%L, 'x')$q$, ped), '55000', 'G5 devolver faturando');
  perform pg_temp.como('postgres');
  if (select conferido_por from receita.fat_pedidos where id = ped) <> pg_temp.u('t1') then raise exception 'FALHOU G5: conferido_por'; end if;
  perform pg_temp.omie(ped, 'faturar_os', 'ok', jsonb_build_object('nf_numero', '4521', 'nf_link', 'https://nfse.exemplo/4521',
            'nf_emitida_em', now(), 'titulos', jsonb_build_array(jsonb_build_object('parcela', 1, 'codigo', 901),
            jsonb_build_object('parcela', 2, 'codigo', 902), jsonb_build_object('parcela', 3, 'codigo', 903))));
  if pg_temp.status('PG2') <> 'faturado' or (select omie_nf_numero from receita.fat_pedidos where id = ped) <> '4521'
     or (select string_agg(omie_titulo_codigo::text, ',' order by n) from receita.fat_pedido_parcelas where pedido_id = ped) <> '901,902,903' then
    raise exception 'FALHOU G5: faturado sem nota ou títulos (situação %)', pg_temp.status('PG2');
  end if;
  perform pg_temp.como('t1');
  perform pg_temp.erro(format($q$select ops.fat_tesouraria_acao(%L, 'faturar')$q$, ped), '55000', 'G5 faturar o faturado');

  -- G6. Títulos pagos: recebido. Os números de Meu faturamento batem com a lista.
  perform pg_temp.como('conector');
  r := integracoes.fat_status_aplicar(ped, jsonb_build_object('titulos', jsonb_build_array(
         jsonb_build_object('parcela', 1, 'situacao', 'pago', 'pago_em', hoje),
         jsonb_build_object('parcela', 2, 'situacao', 'pago', 'pago_em', hoje),
         jsonb_build_object('parcela', 3, 'situacao', 'pago', 'pago_em', hoje))));
  if r #>> '{pedido,status}' <> 'recebido' or not (r ->> 'mudou')::boolean then raise exception 'FALHOU G6: status_aplicar devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if (select count(*) from receita.fat_eventos v where v.entidade_id = ped and v.evento = 'parcela_paga') <> 3 then
    raise exception 'FALHOU G6: eventos de parcela paga';
  end if;
  perform pg_temp.como('a1');
  r := ops.fat_resumo();
  if r #>> '{numeros,faturado_no_mes,valor}' <> '1200.00' or r #>> '{numeros,faturado_no_mes,quantidade}' <> '1'
     or r #>> '{numeros,recebido_no_mes,valor}' <> '1200.00' or r #>> '{numeros,recebido_no_mes,quantidade}' <> '3'
     or r #>> '{numeros,faturado_no_mes,estado}' <> 'ok' then
    raise exception 'FALHOU G6: números do dono = %', r -> 'numeros';
  end if;
  if ops.fat_pedidos(r #> '{numeros,faturado_no_mes,filtro}') ->> 'soma' <> '1200.00'
     or ops.fat_pedidos(r #> '{numeros,recebido_no_mes,filtro}') ->> 'soma_parcelas' <> '1200.00' then
    raise exception 'FALHOU G6: a lista não bate com Faturado/Recebido no mês';
  end if;

  -- G7. PE: vencido e não pago vira Em atraso; o número bate com a lista; cancelar: o dono pede, a tesouraria efetiva.
  r := ops.fat_pedido_salvar(null, base || jsonb_build_object('valor', 500.00, 'parcelas', 2,
                                                              'primeiro_vencimento', hoje - 40));
  ped := (r ->> 'id')::uuid;
  perform pg_temp.guarda('PE', ped);
  perform ops.fat_pedido_enviar(ped);
  perform pg_temp.como('postgres');
  perform pg_temp.omie(ped, 'garantir_cliente', 'ok', '{"codigo_cliente_omie": 556}');
  perform pg_temp.omie(ped, 'incluir_os', 'ok', '{"nCodOS": 3022}');
  perform pg_temp.como('t1');
  perform ops.fat_tesouraria_acao(ped, 'faturar');
  perform pg_temp.como('postgres');
  perform pg_temp.omie(ped, 'faturar_os', 'ok', '{"nf_numero": "4522"}');
  perform pg_temp.como('conector');
  r := integracoes.fat_status_aplicar(ped, '{"titulos": [{"parcela": 1, "situacao": "a_vencer"}, {"parcela": 2, "situacao": "a_vencer"}]}');
  if r #>> '{pedido,status}' <> 'em_atraso' then raise exception 'FALHOU G7: PE em %', r #>> '{pedido,status}'; end if;
  perform pg_temp.como('a1');
  r := ops.fat_resumo();
  if r #>> '{numeros,em_atraso,valor}' <> '500.00' or r #>> '{numeros,em_atraso,quantidade}' <> '2'
     or ops.fat_pedidos(r #> '{numeros,em_atraso,filtro}') ->> 'soma_parcelas' <> '500.00'
     or (ops.fat_pedido(ped) #>> '{resumo,em_atraso}') <> '500.00' then
    raise exception 'FALHOU G7: Em atraso = % (lista %)', r #> '{numeros,em_atraso}', ops.fat_pedidos(r #> '{numeros,em_atraso,filtro}');
  end if;
  perform pg_temp.erro(format('select ops.fat_pedido_cancelar(%L)', ped), '22023', 'G7 pedir cancelamento sem motivo');
  r := ops.fat_pedido_cancelar(ped, 'Cliente desistiu do serviço.');
  if r ->> 'status' <> 'cancelamento_pedido' then raise exception 'FALHOU G7: pedir cancelamento devolveu %', r; end if;
  perform pg_temp.erro(format($q$select ops.fat_pedido_cancelar(%L, 'de novo')$q$, ped), '42501', 'G7 dono confirma o próprio cancelamento');
  perform pg_temp.como('t1');
  r := ops.fat_pedido_cancelar(ped);
  if r ->> 'status' <> 'cancelado' then raise exception 'FALHOU G7: confirmar cancelamento devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if (select motivo_status from receita.fat_pedidos where id = ped) <> 'Cliente desistiu do serviço.'
     or exists (select 1 from receita.fat_pedido_parcelas where pedido_id = ped and situacao <> 'cancelado') then
    raise exception 'FALHOU G7: cancelado sem o motivo do pedido ou com parcela viva';
  end if;
  perform pg_temp.como('a1');
  if ops.fat_resumo() #>> '{numeros,em_atraso,valor}' <> '0' then raise exception 'FALHOU G7: cancelado continua em atraso'; end if;

  -- G8. RF-P08/RF-P09: nota emitida direto no Omie aparece pela leitura; "Atualizar agora" não duplica a leitura.
  r := ops.fat_pedido_salvar(null, base);
  ped := (r ->> 'id')::uuid;
  perform pg_temp.guarda('PF', ped);
  perform ops.fat_pedido_enviar(ped);
  perform pg_temp.como('postgres');
  perform pg_temp.omie(ped, 'garantir_cliente', 'ok', '{"codigo_cliente_omie": 557}');
  perform pg_temp.omie(ped, 'incluir_os', 'ok', '{"nCodOS": 3023}');
  perform pg_temp.como('a1');
  r := ops.fat_atualizar_status(ped);
  if not (r ->> 'enfileirado')::boolean then raise exception 'FALHOU G8: atualizar devolveu %', r; end if;
  if (ops.fat_atualizar_status(ped) ->> 'enfileirado')::boolean then raise exception 'FALHOU G8: segunda leitura enfileirada'; end if;
  perform pg_temp.erro(format('select ops.fat_atualizar_status(%L)', pg_temp.p('PA')), '55000', 'G8 atualizar pedido simulado');
  perform pg_temp.como('conector');
  if (integracoes.fat_status_enfileirar(doc) ->> 'enfileirados')::int <> 0 then raise exception 'FALHOU G8: leitura duplicada pelo cron'; end if;
  r := integracoes.fat_status_aplicar(ped, '{"os": {"etapa": "60"}, "nf": {"numero": "4523", "link": "https://nfse.exemplo/4523"}}');
  if r #>> '{pedido,status}' <> 'faturado' then raise exception 'FALHOU G8: leitura com nota levou a %', r; end if;
  perform pg_temp.como('postgres');
  if not exists (select 1 from receita.fat_eventos v where v.entidade_id = ped and v.evento = 'faturado_no_omie') then
    raise exception 'FALHOU G8: faturamento direto no Omie sem o evento faturado_no_omie';
  end if;
  if (select count(*) from integracoes.omie_envios where origem_id = ped and operacao = 'consultar_status') <> 1 then
    raise exception 'FALHOU G8: mais de uma linha de leitura para o pedido';
  end if;
end $g$;

-- R. RF-P03/CA-04 (contrato em outra empresa), CA-05 (CNPJ inapto) e validações -----------------------------------
do $r$
declare
  doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  prj constant uuid := 'f85b9ff8-d04f-4cf3-b045-86c177c82237';
  base jsonb := current_setting('ens.base')::jsonb;
  r jsonb;
  m text;
  ped uuid;
  svc_pac uuid := pg_temp.svc('8cdf5de7-683f-4d8e-a194-f303677ac6ea');  -- calculados como postgres
  sem_trib uuid := (select s.id from receita.fat_servicos s where s.codigo_omie = 'ensaio-t1b-sem-trib');
begin
  if not exists (select 1 from ops.omie_credentials c join ops.unidades u on u.id = c.unidade_id
                  where c.unidade = 'Rio de Janeiro' and regexp_replace(u.cnpj, '\D', '', 'g') = '55909495000168') then
    raise exception 'ENSAIO INVÁLIDO: a unidade Rio de Janeiro do Omie não casa mais com a PRJ';
  end if;
  insert into ops.omie_contratos_servico (unidade, contrato_id, cnpj, numero, situacao, valor_mensal, vigencia_inicial, vigencia_final, sincronizado_em) values
    ('Rio de Janeiro', 'ensaio-t1b-1', '98.765.432/0001-98', 'ENS-1', '10', 2500, '2026-01-01', null, now()),
    ('Rio de Janeiro', 'ensaio-t1b-2', '98.765.432/0001-98', 'ENS-2', '10', 900, '2020-01-01', '2021-01-01', now()),
    ('Rio de Janeiro', 'ensaio-t1b-3', '98.765.432/0001-98', 'ENS-3', '99', 700, '2026-01-01', null, now()),
    ('Belém', 'ensaio-t1b-4', '74.185.296/0001-07', 'ENS-4', '10', 800, '2026-01-01', null, now());

  -- R1. O aviso: contrato vigente na PRJ (só o vigente e ativo); sem aviso na própria PRJ e para unidade franqueada.
  perform pg_temp.como('a1');
  r := ops.fat_tomador('98.765.432/0001-98', doc);
  if jsonb_array_length(r -> 'contratos_outra_emissora') <> 1 or r #>> '{contratos_outra_emissora,0,emissora,apelido}' <> 'PRJ'
     or r #>> '{contratos_outra_emissora,0,numero}' <> 'ENS-1' or r -> 'contratos_lidos_em' = 'null'::jsonb then
    raise exception 'FALHOU R1: aviso de contrato = %', r -> 'contratos_outra_emissora';
  end if;
  if jsonb_array_length(ops.fat_tomador('74185296000107', doc) -> 'contratos_outra_emissora') <> 0 then
    raise exception 'FALHOU R1: contrato de unidade franqueada gerou aviso';
  end if;
  perform pg_temp.como('t1');
  if jsonb_array_length(ops.fat_tomador('98765432000198', prj) -> 'contratos_outra_emissora') <> 0 then
    raise exception 'FALHOU R1: aviso na própria emissora do contrato';
  end if;

  -- R2. CA-04: só envia com "confirmo a empresa".
  perform pg_temp.como('a1');
  r := ops.fat_pedido_salvar(null, base || '{"tomador_documento": "98765432000198"}');
  ped := (r ->> 'id')::uuid;
  perform pg_temp.guarda('PR', ped);
  if not exists (select 1 from jsonb_array_elements(r -> 'pendencias') x where x ->> 'campo' = 'confirmou_emissora')
     or jsonb_array_length(r -> 'contratos_outra_emissora') <> 1 then
    raise exception 'FALHOU R2: pendência de confirmar a empresa ausente: %', r;
  end if;
  m := pg_temp.erro(format('select ops.fat_pedido_enviar(%L)', ped), '22023', 'R2 enviar sem confirmar a empresa');
  if m not like '%confirmou_emissora%' or m not like '%PRJ%' then raise exception 'FALHOU R2: erro sem o campo ou a empresa: %', m; end if;
  perform ops.fat_pedido_salvar(ped, '{"confirmou_emissora": true}');
  if ops.fat_pedido_enviar(ped) ->> 'status' <> 'na_fila_omie' then raise exception 'FALHOU R2: confirmado não foi para a fila'; end if;

  -- R3. CA-05: CNPJ baixado na Receita bloqueia o envio com o motivo; o rascunho salva.
  perform pg_temp.erro($q$select integracoes.receita_cnpj_gravar('45612378000184', '{"fonte": "x"}')$q$, '42501', 'R3 navegador grava a Receita');
  perform pg_temp.como('conector');
  r := integracoes.receita_cnpj_gravar('45.612.378/0001-84', jsonb_build_object('situacao', 'baixada', 'situacao_desde', '2024-02-01',
         'fonte', 'ensaio', 'razao_social', 'EMPRESA BAIXADA LTDA', 'municipio', 'Curitiba', 'uf', 'pr',
         'emails', jsonb_build_array('Fin@Baixada.com.br', 'invalido')));
  perform pg_temp.como('a1');
  r := ops.fat_tomador('45612378000184', doc);
  if r #>> '{bloqueio,motivo}' not like 'CNPJ BAIXADA na Receita desde 01/02/2024%' or r ->> 'nome' <> 'EMPRESA BAIXADA LTDA'
     or r ->> 'nome_fonte' <> 'Receita' or r ->> 'uf' <> 'PR' or r ->> 'emails' <> '["fin@baixada.com.br"]'
     or (r ->> 'consultar_receita')::boolean then
    raise exception 'FALHOU R3: tomador baixado = %', r;
  end if;
  if not (ops.fat_tomador('11222333000181', doc) ->> 'consultar_receita')::boolean then
    raise exception 'FALHOU R3: CNPJ sem consulta não pediu a Receita';
  end if;
  r := ops.fat_pedido_salvar(null, (base - 'tomador_nome') || '{"tomador_documento": "45612378000184"}');
  ped := (r ->> 'id')::uuid;
  if r -> 'bloqueio' = 'null'::jsonb then
    raise exception 'FALHOU R3: salvar sem o bloqueio: %', r;
  end if;
  m := pg_temp.erro(format('select ops.fat_pedido_enviar(%L)', ped), '22023', 'R3 enviar CNPJ baixado');
  if m not like '%BAIXADA%' then raise exception 'FALHOU R3: recusa sem o motivo: %', m; end if;
  perform pg_temp.como('postgres');
  if (select tomador_nome from receita.fat_pedidos where id = ped) <> 'EMPRESA BAIXADA LTDA' then
    raise exception 'FALHOU R3: nome do tomador não veio da Receita';
  end if;

  -- R4. Validações duras ao salvar (o banco não guarda) e brandas (pendências que só barram o envio).
  perform pg_temp.como('a1');
  perform pg_temp.erro($q$select ops.fat_pedido_salvar(null, '{"emissora_id": "c243e5e4-8309-43e6-ac33-146b9771a44e", "valor": 0}')$q$, '22023', 'R4 valor zero');
  perform pg_temp.erro($q$select ops.fat_pedido_salvar(null, '{"emissora_id": "c243e5e4-8309-43e6-ac33-146b9771a44e", "parcelas": 37}')$q$, '22023', 'R4 37 parcelas');
  perform pg_temp.erro($q$select ops.fat_pedido_salvar(null, '{"emissora_id": "c243e5e4-8309-43e6-ac33-146b9771a44e", "xpto": 1}')$q$, '22023', 'R4 campo desconhecido');
  perform pg_temp.erro($q$select ops.fat_pedido_salvar(null, '{"emissora_id": "c243e5e4-8309-43e6-ac33-146b9771a44e", "tomador_documento": "123"}')$q$, '22023', 'R4 documento curto');
  perform pg_temp.erro($q$select ops.fat_pedido_salvar(null, '{"emissora_id": "c243e5e4-8309-43e6-ac33-146b9771a44e", "departamento": "Nada"}')$q$, '22023', 'R4 departamento fora da lista');
  perform pg_temp.erro($q$select ops.fat_pedido_salvar(null, '{"emissora_id": "c243e5e4-8309-43e6-ac33-146b9771a44e", "emails_envio": "a@b.com"}')$q$, '22023', 'R4 e-mails fora de lista');
  perform pg_temp.erro($q$select ops.fat_pedido_salvar(null, '{"emissora_id": "c243e5e4-8309-43e6-ac33-146b9771a44e", "dono_id": "00000000-0000-4000-8000-000000000051"}')$q$, '22023', 'R4 dono que não é dono');
  if svc_pac is null or sem_trib is null then raise exception 'ENSAIO INVÁLIDO: serviços de R4 ausentes'; end if;
  perform pg_temp.erro(format('select ops.fat_pedido_salvar(null, %L)', jsonb_build_object('emissora_id', doc, 'servico_id', svc_pac)),
                       '22023', 'R4 serviço de outra emissora');
  r := ops.fat_pedido_salvar(null, base || jsonb_build_object(
         'tomador_documento', '11.222.333/0001-80', 'emails_envio', jsonb_build_array('nao-e-email'), 'forma', 'parcelado', 'parcelas', 1,
         'servico_id', sem_trib));
  select string_agg(x ->> 'campo', ',' order by x ->> 'campo') into m from jsonb_array_elements(r -> 'pendencias') x;
  if m <> 'emails_envio,parcelas,servico_id,tomador_documento' then raise exception 'FALHOU R4: pendências brandas = %', m; end if;
  r := ops.fat_servicos(doc);
  if exists (select 1 from jsonb_array_elements(r -> 'servicos') x where x ->> 'codigo_omie' = 'ensaio-t1b-sem-trib')
     or (r ->> 'sem_tributacao')::int < 1 then
    raise exception 'FALHOU R4: serviço sem tributação apareceu no catálogo ou não foi contado';
  end if;
  if (ops.fat_tomador('11.222.333/0001-80') ->> 'valido')::boolean then raise exception 'FALHOU R4: tomador com DV errado válido'; end if;
  if jsonb_array_length(ops.fat_departamentos() -> 'departamentos') <> 19 then raise exception 'FALHOU R4: departamentos pela RPC'; end if;
  perform pg_temp.como('postgres');
end $r$;

-- X. Transições proibidas, ações fora do papel e a guarda da situação ----------------------------------------------
do $x$
declare
  pa uuid := pg_temp.p('PA');
  pr uuid := pg_temp.p('PR');
begin
  perform pg_temp.como('a1');
  perform pg_temp.erro(format('select ops.fat_pedido_aprovar(%L)', pa), '55000', 'X1 aprovar simulado');
  perform pg_temp.erro(format('select ops.fat_pedido_reenviar(%L)', pa), '55000', 'X1 reenviar sem erro');
  perform pg_temp.erro(format('select ops.fat_pedido_descartar(%L)', pa), '55000', 'X1 descartar enviado');
  perform pg_temp.erro(format($q$select ops.fat_pedido_salvar(%L, '{"projeto": "x"}')$q$, pa), '55000', 'X1 editar enviado');
  perform pg_temp.erro(format($q$select ops.fat_tesouraria_acao(%L, 'em_conferencia')$q$, pa), '42501', 'X1 dono confere');
  perform pg_temp.como('g1');
  perform pg_temp.erro(format('select ops.fat_pedido_aprovar(%L)', pa), '55000', 'X1 gestor aprova simulado');
  perform pg_temp.como('s1');
  perform pg_temp.erro(format($q$select ops.fat_pedido_salvar(%L, '{"projeto": "x"}')$q$, pa), '42501', 'X1 editar pedido fora do escopo');
  perform pg_temp.como('t1');
  perform pg_temp.erro(format($q$select ops.fat_tesouraria_acao(%L, 'em_conferencia')$q$, pr), '55000', 'X2 conferir na fila');
  perform pg_temp.erro(format($q$select ops.fat_tesouraria_acao(%L, 'faturar')$q$, pr), '55000', 'X2 faturar sem OS');
  perform pg_temp.erro(format($q$select ops.fat_tesouraria_acao(%L, 'xyz')$q$, pr), '22023', 'X2 ação desconhecida');
  perform pg_temp.erro(format($q$select ops.fat_pedido_cancelar(%L, 'x')$q$, pr), '42501', 'X2 tesouraria pede cancelamento');
  perform pg_temp.erro(format($q$select ops.fat_pedido_devolver(%L, 'x')$q$, pr), '55000', 'X2 devolver na fila');
  perform pg_temp.como('postgres');
  perform pg_temp.erro(format($q$update receita.fat_pedidos set status = 'recebido' where id = %L$q$, pa), '42501', 'X3 situação mudada por fora');
  perform pg_temp.erro(format($q$select receita.fat_transicao(%L, 'recebido')$q$, pa), '55000', 'X3 simulado para recebido');
  perform pg_temp.erro(format($q$select receita.fat_transicao(%L, 'devolvido', null)$q$, pa), '22023', 'X3 devolvido sem motivo');
  perform pg_temp.erro(format($q$select receita.fat_transicao(%L, 'cancelamento_pedido', '  ')$q$, pa), '22023', 'X3 cancelamento sem motivo');
end $x$;

-- D. Rascunho descartado vira cancelado "descartado pelo autor" (decisão de 20/10) ----------------------------------
do $d$
declare
  rd uuid := pg_temp.p('RD');
  r jsonb;
begin
  perform pg_temp.como('g1');
  perform pg_temp.erro(format('select ops.fat_pedido_descartar(%L)', rd), '42501', 'D1 gestor descarta rascunho alheio');
  perform pg_temp.como('s1');
  r := ops.fat_pedido_descartar(rd);
  if r ->> 'status' <> 'cancelado' then raise exception 'FALHOU D1: descartar devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if (select motivo_status from receita.fat_pedidos where id = rd) <> 'descartado pelo autor'
     or not exists (select 1 from receita.fat_eventos v where v.entidade_id = rd and v.evento = 'descartado' and v.para = 'cancelado') then
    raise exception 'FALHOU D1: descarte sem o motivo ou o evento';
  end if;
  if pg_temp.vistos('t1') like '%RD%' or pg_temp.vistos('s1') not like '%RD%' then raise exception 'FALHOU D1: descartado visível a outros'; end if;
end $d$;

-- I. integracoes.* negado a authenticated, anon e postgres sem SET ROLE ----------------------------------------------
do $i$
declare
  q text;
begin
  perform pg_temp.como('a1');
  foreach q in array array[
    'select integracoes.fat_envio_proximos(1)',
    $s$select integracoes.fat_envio_resultado(gen_random_uuid(), 'ok')$s$,
    $s$select integracoes.fat_status_aplicar(gen_random_uuid(), '{}')$s$,
    $s$select integracoes.fat_servicos_aplicar(gen_random_uuid(), '[]')$s$,
    'select integracoes.pipefy_envio_proximos(1)',
    $s$select integracoes.omie_credencial('c243e5e4-8309-43e6-ac33-146b9771a44e')$s$,
    'select count(*) from integracoes.omie_envios',
    'select count(*) from integracoes.receita_cnpj',
    'select count(*) from receita.fat_departamentos',
    'select count(*) from receita.fat_pedidos',
    'select receita.fat_escopo()',
    $s$select receita.fat_transicao(gen_random_uuid(), 'cancelado')$s$,
    $s$select receita.fat_entrar_na_fila(gen_random_uuid(), 'x')$s$] loop
    perform pg_temp.erro(q, '42501', 'I1 authenticated: ' || q);
  end loop;
  perform pg_temp.como('anon');
  perform pg_temp.erro('select ops.fat_contexto()', '42501', 'I2 anon: contexto');
  perform pg_temp.erro('select integracoes.fat_envio_proximos(1)', '42501', 'I2 anon: conector');
  perform pg_temp.como('conector');
  perform pg_temp.erro('select ops.fat_contexto()', '42501', 'I3 service_role nas RPCs de tela');
  perform pg_temp.como('postgres');
  perform pg_temp.erro('select integracoes.fat_envio_proximos(1)', '42501', 'I4 postgres sem SET ROLE no conector');
  perform pg_temp.erro($s$select integracoes.receita_cnpj_gravar('45612378000184', '{"fonte": "x"}')$s$, '42501', 'I4 postgres grava a Receita');
end $i$;

-- S. Configuração: donos, serviços, sincronização e travas ----------------------------------------------------------
do $s$
declare
  doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  r jsonb;
  e jsonb;
  dono_id uuid;
  envio uuid;
  novo uuid;
  real_cod text;
  n_vivos int;
begin
  -- S1. A configuração da controladoria.
  perform pg_temp.como('c1');
  r := ops.fat_config();
  select x into e from jsonb_array_elements(r -> 'emissoras') x where x ->> 'apelido' = 'DOC';
  if (r ->> 'pode_gravar_omie')::boolean or e #>> '{contagem,donos}' <> '2' or e #>> '{contagem,gestores}' <> '1'
     or e #>> '{contagem,solicitantes}' <> '1' or not (e ->> 'tem_chave')::boolean or not (e ->> 'tem_pedido')::boolean
     or (select (x #>> '{substituto,id}')::uuid from jsonb_array_elements(e -> 'pessoas') x where (x #>> '{pessoa,id}')::uuid = pg_temp.u('b1'))
        <> pg_temp.u('s2')
     or not exists (select 1 from jsonb_array_elements(r -> 'pessoas_ativas') x where (x ->> 'id')::uuid = pg_temp.u('z1')) then
    raise exception 'FALHOU S1: configuração da DOC = %', e - 'servicos';
  end if;
  -- S2. Cadastrar, recusar troca de papel e desativar; tudo vira evento com o autor.
  r := ops.fat_dono_salvar(jsonb_build_object('emissora_id', doc, 'user_id', pg_temp.u('z1'), 'papel', 'solicitante'));
  dono_id := (r ->> 'id')::uuid;
  if not (r ->> 'abre_faturamento')::boolean or r ->> 'papel' <> 'solicitante' then raise exception 'FALHOU S2: cadastro devolveu %', r; end if;
  perform pg_temp.erro(format('select ops.fat_dono_salvar(%L)', jsonb_build_object('id', dono_id, 'papel', 'dono')), '22023', 'S2 trocar papel');
  perform pg_temp.erro(format('select ops.fat_dono_salvar(%L)', jsonb_build_object('emissora_id', doc, 'user_id', pg_temp.u('a1'),
                         'papel', 'gestor', 'substituto_id', pg_temp.u('b1'))), '22023', 'S2 substituto em gestor');
  r := ops.fat_dono_remover(dono_id);
  if (r ->> 'ativo')::boolean then raise exception 'FALHOU S2: remover não desativou'; end if;
  perform pg_temp.como('postgres');
  if (select string_agg(v.evento, ',' order by v.id) from receita.fat_eventos v where v.entidade = 'dono' and v.entidade_id = dono_id
        and v.autor_id = pg_temp.u('c1')) <> 'criado,desativado' then
    raise exception 'FALHOU S2: eventos do cadastro de dono';
  end if;
  perform pg_temp.como('a1');
  perform pg_temp.erro(format('select ops.fat_dono_salvar(%L)', jsonb_build_object('emissora_id', doc, 'user_id', pg_temp.u('z1'),
                         'papel', 'dono')), '42501', 'S2 dono cadastra dono');
  -- S3. Pipefy e fatura_por pela controladoria; desligar a gravação ela também faz.
  perform pg_temp.como('c1');
  r := ops.fat_emissora_config(doc, null, true, 'os');
  if not (r ->> 'pipefy_sync')::boolean or r ->> 'fatura_por' <> 'os' then raise exception 'FALHOU S3: config devolveu %', r; end if;
  r := ops.fat_emissora_config(doc, 'simular');
  if r ->> 'modo_omie' <> 'simular' then raise exception 'FALHOU S3: desligar a gravação devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if (select count(*) from receita.fat_eventos v where v.entidade = 'emissora' and v.entidade_id = doc and v.autor_id = pg_temp.u('c1')) <> 2 then
    raise exception 'FALHOU S3: mudanças da controladoria sem evento';
  end if;
  -- S4. Sincronizar o catálogo: enfileira uma vez; o conector aplica; serviço novo entra desligado, o que sumiu sai.
  perform pg_temp.como('c1');
  r := ops.fat_servicos_sincronizar(doc);
  envio := (r ->> 'envio_id')::uuid;
  if (ops.fat_servicos_sincronizar(doc) ->> 'envio_id')::uuid <> envio then raise exception 'FALHOU S4: sincronização duplicada'; end if;
  perform pg_temp.como('postgres');
  real_cod := (select s.codigo_omie from receita.fat_servicos s where s.id = pg_temp.svc(doc));
  select count(*) into n_vivos from receita.fat_servicos s where s.emissora_id = doc and s.no_omie;
  envio := pg_temp.reservar(doc, 'sincronizar_servicos');
  perform pg_temp.como('conector');
  perform pg_temp.erro(format($q$select integracoes.fat_servicos_aplicar(%L, '[]')$q$, doc), '22023', 'S4 catálogo vazio');
  r := integracoes.fat_servicos_aplicar(doc, (
         select jsonb_build_array(
                  jsonb_build_object('codigo_omie', s.codigo_omie, 'codigo', s.codigo, 'descricao', s.descricao,
                                     'codigo_lc116', s.codigo_lc116, 'codigo_municipal', s.codigo_municipal,
                                     'id_tributacao', s.id_tributacao, 'tributacao', s.tributacao, 'categoria', s.categoria_padrao),
                  jsonb_build_object('codigo_omie', 'ensaio-novo', 'codigo', 'SRV09999', 'descricao', 'Serviço novo de ensaio',
                                     'codigo_lc116', '17.01', 'codigo_municipal', '170101/17.01', 'id_tributacao', '01',
                                     'tributacao', '{}'::jsonb, 'categoria', '1.01.85'))
           from receita.fat_servicos s where s.emissora_id = doc and s.codigo_omie = real_cod));
  if (r ->> 'entraram')::int <> 1 or (r ->> 'mudaram')::int <> 0 or (r ->> 'sairam')::int <> n_vivos - 1 then
    raise exception 'FALHOU S4: aplicar devolveu % (vivos antes: %)', r, n_vivos;
  end if;
  perform integracoes.fat_envio_resultado(envio, 'ok', null, null, '{}');
  perform pg_temp.como('a1');
  r := ops.fat_servicos(doc);
  if (select string_agg(x ->> 'codigo_omie', ',') from jsonb_array_elements(r -> 'servicos') x) <> real_cod then
    raise exception 'FALHOU S4: catálogo depois da sincronização = %', r -> 'servicos';
  end if;
  -- S5. Liberar o serviço novo e mudar os padrões: vira evento; só a controladoria faz.
  novo := (select s.id from receita.fat_servicos s where s.emissora_id = doc and s.codigo_omie = 'ensaio-novo');
  perform pg_temp.erro(format('select ops.fat_servico_ativar(%L, true)', novo), '42501', 'S5 dono libera serviço');
  perform pg_temp.como('c1');
  if not (ops.fat_servico_ativar(novo, true) ->> 'ativo')::boolean then raise exception 'FALHOU S5: liberar'; end if;
  r := ops.fat_servico_padroes(novo, '1.01.99', 123);
  perform pg_temp.como('a1');
  if jsonb_array_length(ops.fat_servicos(doc) -> 'servicos') <> 2 then raise exception 'FALHOU S5: serviço liberado não apareceu'; end if;
  perform pg_temp.como('postgres');
  if (select string_agg(v.evento, ',' order by v.id) from receita.fat_eventos v where v.entidade = 'servico' and v.entidade_id = novo)
     <> 'entrou,liberado,alterado' then
    raise exception 'FALHOU S5: eventos do serviço novo';
  end if;
  if (select status from integracoes.omie_envios where id = envio) <> 'ok' then raise exception 'FALHOU S4: envio da sincronização'; end if;
end $s$;

-- T. Tempos com 2.000 pedidos simulados dentro da transação (limite 1 s) -------------------------------------------
insert into receita.fat_pedidos
  (numero, emissora_id, tomador_tipo, tomador_documento, tomador_nome, servico_id, descricao_nf, valor, forma, parcelas,
   primeiro_vencimento, competencia, documento, meio, observacoes, projeto, emails_envio, dono_id, solicitante_id,
   enviado_por, enviado_em, na_fila_em, status, status_em, motivo_status, simulacao, faturado_em, omie_os_codigo)
select 'FAT-1998-' || lpad(g::text, 6, '0'), e.id, 'pj', '11222333000181', 'Cliente ' || g, pg_temp.svc(e.id),
       'Descrição ' || g, 100 + g, 'avulso', 1, receita.fat_hoje() + (g % 40) - 10,
       date_trunc('month', receita.fat_hoje())::date, 'nf', 'boleto', 'Observação', 'Projeto ' || (g % 50),
       array['financeiro@cliente.com.br'], e.dono, e.dono, e.dono, now() - (g || ' minutes')::interval,
       now() - (g || ' minutes')::interval, s.status, now() - ((g % 96) || ' hours')::interval, 'ensaio',
       s.status = 'simulado', case when s.status in ('faturado', 'recebido') then now() - (g || ' minutes')::interval end,
       case when s.status in ('os_criada', 'em_conferencia', 'faturado', 'recebido') then 900000 + g end
  from generate_series(1, 2000) g
  cross join lateral (select (array['aguardando_ok', 'na_fila_omie', 'erro_omie', 'os_criada', 'em_conferencia',
                                    'faturado', 'recebido', 'simulado', 'devolvido'])[1 + g % 9] as status) s
  cross join lateral (select case g % 3 when 0 then 'c243e5e4-8309-43e6-ac33-146b9771a44e'::uuid
                                        when 1 then '8cdf5de7-683f-4d8e-a194-f303677ac6ea'::uuid
                                        else '92eabf46-07a2-44c6-8f23-b7588e89314e'::uuid end as id,
                             case g % 3 when 1 then pg_temp.u('p1') else pg_temp.u('a1') end as dono) e;
insert into receita.fat_pedido_parcelas (pedido_id, n, vencimento, valor, situacao, pago_em)
select p.id, 1, p.primeiro_vencimento, p.valor, case when p.status = 'recebido' then 'pago' else 'a_vencer' end,
       case when p.status = 'recebido' then receita.fat_hoje() end
  from receita.fat_pedidos p where p.numero like 'FAT-1998-%' and p.status in ('faturado', 'recebido');

do $t$
declare
  q text;
begin
  if (select count(*) from receita.fat_pedidos where numero like 'FAT-1998-%') <> 2000 then
    raise exception 'ENSAIO INVÁLIDO: massa de 2.000 pedidos não entrou';
  end if;
  foreach q in array array[
    $q$select ops.fat_pedidos('{}')$q$,
    $q$select ops.fat_pedidos('{"situacao": ["a_faturar"], "ordem": "valor", "pagina": 3}')$q$,
    $q$select ops.fat_pedidos('{"busca": "Cliente 19", "regua": "atraso"}')$q$,
    'select ops.fat_fila_tesouraria()',
    $q$select ops.fat_fila_tesouraria('c243e5e4-8309-43e6-ac33-146b9771a44e', '{"higiene": "vence_3d"}')$q$,
    'select ops.fat_resumo()',
    'select ops.fat_contexto()'] loop
    perform pg_temp.medir('2000_frio t1 ' || q, 't1', q, 1000);
    perform pg_temp.medir('2000 t1 ' || q, 't1', q, 1000);
  end loop;
  perform pg_temp.medir('2000 a1 fat_pedidos', 'a1', $q$select ops.fat_pedidos('{}')$q$, 1000);
  perform pg_temp.medir('2000 a1 fat_resumo', 'a1', 'select ops.fat_resumo()', 1000);
  perform pg_temp.medir('2000 g1 fat_pedidos', 'g1', $q$select ops.fat_pedidos('{"pendencia": "ok"}')$q$, 1000);
  perform pg_temp.como('t1');
  if (ops.fat_pedidos('{}') ->> 'total_recorte')::int < 2000 or jsonb_array_length(ops.fat_pedidos('{}') -> 'itens') <> 50 then
    raise exception 'FALHOU T: a lista não viu os 2.000 pedidos ou não paginou';
  end if;
  if (ops.fat_fila_tesouraria() ->> 'total_fila')::int < 1000 then raise exception 'FALHOU T: fila da tesouraria sem a massa'; end if;
  perform pg_temp.como('postgres');
end $t$;

-- Z. Rollback -----------------------------------------------------------------------------------------------------
-- Antes, os gatilhos adiados das parcelas disparam agora: confere a soma de todas as parcelas gravadas no ensaio
-- (e o ALTER TABLE do rollback não aceita evento de gatilho pendente).
set constraints all immediate;

-- @@ROLLBACK@@

do $z$
begin
  if to_regclass('receita.fat_departamentos') is not null then
    return;  -- rodado depois de aplicar (--vazio): o rollback não entrou no texto
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'ops'::regnamespace and p.proname like 'fat\_%')
     or to_regclass('integracoes.omie_emissora_estado') is not null or to_regclass('integracoes.receita_cnpj') is not null
     or to_regtype('receita.fat_escopo_t') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'receita' and table_name = 'fat_pedidos'
                  and column_name in ('enviado_por', 'simulacao', 'na_fila_em'))
     or exists (select 1 from information_schema.columns where table_schema = 'integracoes' and table_name = 'omie_envios'
                  and column_name in ('modo', 'depende_de'))
     or exists (select 1 from pg_trigger where tgname = 'fat_pedidos_status_guarda') then
    raise exception 'FALHOU Z1: o rollback deixou objetos da T1b';
  end if;
  if to_regprocedure('integracoes.omie_credencial(uuid)') is null or to_regclass('receita.fat_pedidos') is null then
    raise exception 'FALHOU Z1: o rollback apagou objetos da T1a';
  end if;
end $z$;

do $fim$
begin
  if current_setting('ens.medir', true) = 'sim' then
    raise exception 'MEDIDAS:%', current_setting('ens.tempos', true);
  end if;
end $fim$;

rollback;
