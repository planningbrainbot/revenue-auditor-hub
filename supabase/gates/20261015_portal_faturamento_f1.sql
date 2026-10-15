-- Ensaio da migration 20261015150000_portal_faturamento_f1.sql e do rollback dela (15/10/2026).
--
-- Roda tudo numa transação que termina em ROLLBACK: nada sobrevive. Cada teste levanta exceção quando falha, então a
-- Management API responde [] só se TODOS passarem; uma falha volta como HTTP 400 com o código do teste (FALHOU Xn).
-- Como rodar: troque a linha @@MIGRATION@@ pela migration e a @@ROLLBACK@@ pelo rollback, os dois SEM as linhas
-- begin;/commit; deles, e mande o arquivo inteiro em UMA chamada (POST /v1/projects/<ref>/database/query).
-- Confira antes de mandar que o texto final não tem commit nenhum fora de corpo de função.
--
-- A API roda como postgres, que ignora RLS. Os testes de escopo trocam para `authenticated` com `set local role` e
-- vestem cada pessoa com request.jwt.claims; o bloco C confere que está mesmo como authenticated antes de testar.
-- Pessoas reais, ativas e com a porta do Ops (só leitura delas; papéis, portas e linhas de teste morrem no rollback):
--   ana     c68b4fcb-9e15-4180-822c-9f03cbf898c7  ganha fat_controladoria aqui; todas_empresas
--   daniel  55f8d99a-a371-418e-aa34-2e596b9506f6  papel financeiro e todas_empresas, nada do faturamento
--   isabela c1efc06b-4a47-4445-80d4-eca5c6c119e9  CS, nada do faturamento
--   jordana 8120fb42-ed9a-4fc9-9f2e-bdb699acc508  dona na DOC (porta por pessoa)
--   mateus  5a431596-1062-46cd-8f78-fa1b15efede5  dono na PAC (porta por pessoa)
--   paula   786f7ec9-ec53-4900-be11-c0f54a28ab90  gestora da DOC (porta por pessoa)
--   victor  12fa2abb-058d-4467-86c5-93a7aefd9d98  super admin com recorte só da PARTNERS
--   pedro   5c4d0e46-fc33-4132-bcca-47c05ad001c7  dono na PARTNERS (só linha; ninguém testa como ele)

begin;

-- Retrato do modelo de acesso e das concessões por pessoa antes de tudo (num DO, para nenhuma linha voltar na resposta).
do $retrato$
begin
  perform set_config('ensaio.acesso_antes', md5(
       coalesce((select string_agg(role || '|' || area || '|' || allowed, ',' order by role, area) from ops.role_areas), '')
    || '#' || coalesce((select string_agg(area || '|' || permission_key, ',' order by area, permission_key) from ops.area_chaves), '')
    || '#' || coalesce((select string_agg(key || '|' || label || '|' || is_system, ',' order by key) from ops.roles), '')
    || '#' || coalesce((select string_agg(slug || '|' || nome || '|' || escopo || '|' || ativa, ',' order by slug) from ops.areas), '')), true);
  perform set_config('ensaio.pessoas_antes', md5(
       coalesce((select string_agg(user_id || '|' || role, ',' order by user_id, role) from ops.user_roles), '')
    || '#' || coalesce((select string_agg(user_id || '|' || area || '|' || allowed, ',' order by user_id, area) from ops.usuario_areas), '')
    || '#' || coalesce((select string_agg(user_id || '|' || permission_key || '|' || allowed, ',' order by user_id, permission_key) from ops.usuario_chaves), '')), true);
end $retrato$;

-- @@MIGRATION@@

-- A. Estrutura (como postgres) -----------------------------------------------------------------------------------
do $a$
declare
  n int;
  m text;
begin
  if current_user <> 'postgres' then raise exception 'ENSAIO INVÁLIDO: o bloco A roda como %', current_user; end if;

  select md5(
       coalesce((select string_agg(role || '|' || area || '|' || allowed, ',' order by role, area) from ops.role_areas
                  where role not in ('fat_tesouraria', 'fat_controladoria') and area not like 'faturamento%'), '')
    || '#' || coalesce((select string_agg(area || '|' || permission_key, ',' order by area, permission_key) from ops.area_chaves
                  where area not like 'faturamento%'), '')
    || '#' || coalesce((select string_agg(key || '|' || label || '|' || is_system, ',' order by key) from ops.roles
                  where key not in ('fat_tesouraria', 'fat_controladoria')), '')
    || '#' || coalesce((select string_agg(slug || '|' || nome || '|' || escopo || '|' || ativa, ',' order by slug) from ops.areas
                  where slug not like 'faturamento%'), ''))
    into m;
  if m <> current_setting('ensaio.acesso_antes') then raise exception 'FALHOU A1: alguma linha antiga do modelo de acesso mudou'; end if;

  select count(*) into n from ops.areas where slug in ('faturamento', 'faturamento_tesouraria', 'faturamento_controladoria') and ativa and escopo = 'empresa';
  if n <> 3 then raise exception 'FALHOU A2: % áreas novas (esperava 3)', n; end if;
  select count(*) into n from ops.area_chaves
   where (area, permission_key) in (('faturamento', 'view.faturamento'), ('faturamento', 'edit.faturamento_pedido'),
                                    ('faturamento_tesouraria', 'edit.faturamento_tesouraria'), ('faturamento_controladoria', 'admin.faturamento'));
  if n <> 4 then raise exception 'FALHOU A2: % chaves novas (esperava 4)', n; end if;
  select count(*) into n from ops.roles where key in ('fat_tesouraria', 'fat_controladoria') and is_system;
  if n <> 2 then raise exception 'FALHOU A2: % papéis novos de sistema (esperava 2)', n; end if;
  select count(*) into n from ops.role_areas where allowed and (role in ('fat_tesouraria', 'fat_controladoria') or area like 'faturamento%');
  if n <> 7 then raise exception 'FALHOU A2: % concessões novas em role_areas (esperava 7)', n; end if;

  select count(*) into n from organizacao.empresas_grupo;
  if n <> 18 then raise exception 'FALHOU A3: % empresas (esperava 18)', n; end if;
  select count(*) into n from organizacao.empresas_grupo where omie_credencial_ref is not null;
  if n <> 16 then raise exception 'FALHOU A3: % empresas com credencial (esperava 16)', n; end if;
  select count(*) into n from organizacao.empresas_grupo where fatura_por is not null;
  if n <> 0 then raise exception 'FALHOU A3: fatura_por preenchido em % empresas (esperava nulo)', n; end if;
  if not exists (select 1 from organizacao.empresas_grupo where apelido = 'DOC' and id = 'c243e5e4-8309-43e6-ac33-146b9771a44e' and cnpj = '49726267000150')
     or not exists (select 1 from organizacao.empresas_grupo where apelido = 'PMC' and cnpj = '30459798000103' and omie_credencial_ref = 'omie_pmc')
     or not exists (select 1 from organizacao.empresas_grupo where apelido = 'MAROX' and cnpj = '55950467000194' and omie_credencial_ref = 'omie_marox') then
    raise exception 'FALHOU A3: DOC, PMC ou MAROX fora do esperado';
  end if;

  select count(*) into n from ops.usuario_empresas ue
   where not exists (select 1 from organizacao.empresas_grupo g where g.id = ue.empresa_id);
  if n <> 0 then raise exception 'FALHOU A4: % linhas de ops.usuario_empresas sem empresa correspondente', n; end if;

  select count(*) into n from pg_class
   where oid in ('organizacao.empresas_grupo'::regclass, 'receita.fat_donos'::regclass,
                 'receita.fat_servicos'::regclass, 'receita.fat_eventos'::regclass)
     and relrowsecurity and obj_description(oid, 'pg_class') is not null;
  if n <> 4 then raise exception 'FALHOU A5: RLS ou comentário faltando (% de 4)', n; end if;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'receita'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%');
  if n <> 0 then raise exception 'FALHOU A5: % SECURITY DEFINER sem search_path fixo', n; end if;
  select count(*) into n from pg_proc p
   where p.pronamespace in ('receita'::regnamespace, 'organizacao'::regnamespace)
     and (has_function_privilege('anon', p.oid, 'execute') or (p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')));
  if n <> 0 then raise exception 'FALHOU A5: % funções executáveis por anon (ou gatilho por authenticated)', n; end if;
  if has_schema_privilege('anon', 'receita', 'usage') or has_schema_privilege('anon', 'organizacao', 'usage') then
    raise exception 'FALHOU A5: anon tem USAGE num schema novo';
  end if;
  if has_table_privilege('authenticated', 'receita.fat_eventos', 'update') or has_table_privilege('authenticated', 'receita.fat_eventos', 'delete')
     or has_table_privilege('authenticated', 'receita.fat_eventos', 'insert') or has_table_privilege('service_role', 'receita.fat_eventos', 'update')
     or has_table_privilege('service_role', 'receita.fat_eventos', 'delete') or has_table_privilege('service_role', 'receita.fat_eventos', 'truncate') then
    raise exception 'FALHOU A5: privilégio de escrita indevido em fat_eventos';
  end if;

  begin
    update organizacao.empresas_grupo set omie_credencial_ref = '1234567890123' where apelido = 'DOC';
    raise exception 'FALHOU A6: omie_credencial_ref aceitou algo com cara de chave';
  exception when check_violation then null;
  end;

  begin
    perform '2026-11-15'::date::receita.competencia;
    raise exception 'FALHOU A7: competência aceitou dia 15';
  exception when check_violation then null;
  end;
  perform '2026-11-01'::date::receita.competencia;

  select count(*) into n from receita.fat_servicos;
  if n <> 0 then raise exception 'FALHOU A8: fat_servicos nasceu com % linhas', n; end if;
end $a$;

-- Massa de teste (como postgres) ------------------------------------------------------------------------------------
insert into ops.user_roles (user_id, role) values ('c68b4fcb-9e15-4180-822c-9f03cbf898c7', 'fat_controladoria');
insert into ops.usuario_areas (user_id, area, allowed) values
  ('8120fb42-ed9a-4fc9-9f2e-bdb699acc508', 'faturamento', true),
  ('5a431596-1062-46cd-8f78-fa1b15efede5', 'faturamento', true),
  ('786f7ec9-ec53-4900-be11-c0f54a28ab90', 'faturamento', true);
insert into ops.usuario_chaves (user_id, permission_key, allowed) values
  ('8120fb42-ed9a-4fc9-9f2e-bdb699acc508', 'view.faturamento', true),
  ('5a431596-1062-46cd-8f78-fa1b15efede5', 'view.faturamento', true),
  ('786f7ec9-ec53-4900-be11-c0f54a28ab90', 'view.faturamento', true);
insert into receita.fat_donos (emissora_id, user_id, papel) values
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', '8120fb42-ed9a-4fc9-9f2e-bdb699acc508', 'dono'),
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', '786f7ec9-ec53-4900-be11-c0f54a28ab90', 'gestor'),
  ('8cdf5de7-683f-4d8e-a194-f303677ac6ea', '5a431596-1062-46cd-8f78-fa1b15efede5', 'dono'),
  ('769854a7-0b0b-48e2-ace8-9b0636e19a56', '5c4d0e46-fc33-4132-bcca-47c05ad001c7', 'dono');
insert into receita.fat_servicos (emissora_id, codigo_omie, descricao) values
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', 'ensaio-1', 'Serviço de ensaio da DOC'),
  ('8cdf5de7-683f-4d8e-a194-f303677ac6ea', 'ensaio-2', 'Serviço de ensaio da PAC');

-- B. O cadastro de donos virou evento (como postgres, autor nulo = sistema) -----------------------------------------
do $b$
declare n int;
begin
  select count(*) into n from receita.fat_eventos where entidade = 'dono' and evento = 'criado' and autor_id is null and para = 'ativo';
  if n <> 4 then raise exception 'FALHOU B1: % eventos de criação de dono (esperava 4)', n; end if;
end $b$;

-- C. Escopo, como authenticated -------------------------------------------------------------------------------------
set local role authenticated;

do $c$
declare
  ana      constant uuid := 'c68b4fcb-9e15-4180-822c-9f03cbf898c7';
  daniel   constant uuid := '55f8d99a-a371-418e-aa34-2e596b9506f6';
  isabela  constant uuid := 'c1efc06b-4a47-4445-80d4-eca5c6c119e9';
  jordana  constant uuid := '8120fb42-ed9a-4fc9-9f2e-bdb699acc508';
  mateus   constant uuid := '5a431596-1062-46cd-8f78-fa1b15efede5';
  paula    constant uuid := '786f7ec9-ec53-4900-be11-c0f54a28ab90';
  victor   constant uuid := '12fa2abb-058d-4467-86c5-93a7aefd9d98';
  doc      constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  pac      constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  neo      constant uuid := '505278f4-b1be-4cef-b56d-2f03273988f9';
  partners constant uuid := '769854a7-0b0b-48e2-ace8-9b0636e19a56';
  n int;
  r record;
begin
  if current_user <> 'authenticated' then
    raise exception 'ENSAIO INVÁLIDO: os testes de RLS rodam como %, não como authenticated', current_user;
  end if;

  -- C0. Sem login.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  if auth.uid() is not null then raise exception 'ENSAIO INVÁLIDO: auth.uid() deveria ser nulo'; end if;
  select count(*) into n from receita.fat_donos;
  if n <> 0 then raise exception 'FALHOU C0: sem login leu % linhas de fat_donos', n; end if;
  select count(*) into n from organizacao.empresas_grupo;
  if n <> 0 then raise exception 'FALHOU C0: sem login leu % empresas', n; end if;

  -- C1. Papel financeiro e todas_empresas, mas nada do faturamento: o recorte sozinho não abre nada.
  perform set_config('request.jwt.claims', json_build_object('sub', daniel, 'role', 'authenticated')::text, true);
  if auth.uid() is distinct from daniel then raise exception 'ENSAIO INVÁLIDO: auth.uid() não trocou para daniel'; end if;
  select count(*) into n from receita.fat_donos;
  if n <> 0 then raise exception 'FALHOU C1: sem papel leu % linhas de fat_donos', n; end if;
  select count(*) into n from receita.fat_servicos;
  if n <> 0 then raise exception 'FALHOU C1: sem papel leu % serviços', n; end if;
  select count(*) into n from receita.fat_eventos;
  if n <> 0 then raise exception 'FALHOU C1: sem papel leu % eventos', n; end if;
  begin
    insert into receita.fat_donos (emissora_id, user_id, papel) values (doc, daniel, 'dono');
    raise exception 'FALHOU C1: sem papel se cadastrou como dono';
  exception when insufficient_privilege then null;
  end;

  -- C2. CS sem nada do faturamento: fat_donos vazio; o cadastro de empresas do grupo é legível por quem está ativo.
  perform set_config('request.jwt.claims', json_build_object('sub', isabela, 'role', 'authenticated')::text, true);
  select count(*) into n from receita.fat_donos;
  if n <> 0 then raise exception 'FALHOU C2: CS leu % linhas de fat_donos', n; end if;
  select count(*) into n from organizacao.empresas_grupo;
  if n <> 18 then raise exception 'FALHOU C2: pessoa ativa leu % empresas (esperava 18)', n; end if;

  -- C3. Controladoria: lê tudo, cadastra, desativa, e não escreve no histórico nem fora das colunas liberadas.
  perform set_config('request.jwt.claims', json_build_object('sub', ana, 'role', 'authenticated')::text, true);
  select count(*) into n from receita.fat_donos;
  if n <> 4 then raise exception 'FALHOU C3: controladoria leu % linhas de fat_donos (esperava todas, 4)', n; end if;
  select count(*) into n from receita.fat_servicos;
  if n <> 2 then raise exception 'FALHOU C3: controladoria leu % serviços (esperava 2)', n; end if;
  select count(*) into n from receita.fat_eventos;
  if n <> 4 then raise exception 'FALHOU C3: controladoria leu % eventos (esperava 4)', n; end if;

  insert into receita.fat_donos (emissora_id, user_id, papel) values (neo, daniel, 'solicitante');
  select * into r from receita.fat_eventos order by id desc limit 1;
  if r.entidade <> 'dono' or r.evento <> 'criado' or r.autor_id is distinct from ana or r.emissora_id <> neo then
    raise exception 'FALHOU C3: o cadastro da controladoria não virou evento com autor (%)', row_to_json(r);
  end if;

  update receita.fat_donos set ativo = false where emissora_id = neo and user_id = daniel;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHOU C3: controladoria desativou % linhas (esperava 1)', n; end if;
  select * into r from receita.fat_eventos order by id desc limit 1;
  if r.evento <> 'desativado' or r.de <> 'ativo' or r.para <> 'inativo' or r.diff -> 'ativo' ->> 'para' <> 'false' or r.autor_id is distinct from ana then
    raise exception 'FALHOU C3: a desativação não virou evento certo (%)', row_to_json(r);
  end if;
  select count(*) into n from receita.fat_eventos;
  if n <> 6 then raise exception 'FALHOU C3: % eventos depois de criar e desativar (esperava 6)', n; end if;

  begin
    update receita.fat_donos set user_id = ana where emissora_id = neo and user_id = daniel;
    raise exception 'FALHOU C3: controladoria trocou o user_id de uma linha (devia desativar e criar outra)';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from receita.fat_donos where emissora_id = neo;
    raise exception 'FALHOU C3: controladoria apagou linha de fat_donos';
  exception when insufficient_privilege then null;
  end;

  update organizacao.empresas_grupo set fatura_por = 'os' where id = doc;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHOU C3: controladoria alterou fatura_por em % linhas (esperava 1)', n; end if;
  begin
    update organizacao.empresas_grupo set omie_credencial_ref = 'omie_pac' where id = doc;
    raise exception 'FALHOU C3: controladoria trocou o segredo do Omie de uma empresa';
  exception when insufficient_privilege then null;
  end;

  begin
    update receita.fat_eventos set evento = 'adulterado';
    raise exception 'FALHOU C3: UPDATE em fat_eventos passou';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from receita.fat_eventos;
    raise exception 'FALHOU C3: DELETE em fat_eventos passou';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento) values ('dono', gen_random_uuid(), doc, 'forjado');
    raise exception 'FALHOU C3: o navegador gravou evento direto';
  exception when insufficient_privilege then null;
  end;

  -- C4. Dona da DOC: vê o cadastro da DOC (ela e a gestora), o serviço da DOC, nenhum evento (só gestor lê em F1),
  --     e não grava cadastro nem empresa.
  perform set_config('request.jwt.claims', json_build_object('sub', jordana, 'role', 'authenticated')::text, true);
  select count(*) into n from receita.fat_donos;
  if n <> 2 then raise exception 'FALHOU C4: dona da DOC leu % linhas de fat_donos (esperava 2)', n; end if;
  select count(*) into n from receita.fat_donos where emissora_id <> doc;
  if n <> 0 then raise exception 'FALHOU C4: dona da DOC leu % linhas de outra empresa', n; end if;
  select count(*) into n from receita.fat_servicos;
  if n <> 1 then raise exception 'FALHOU C4: dona da DOC leu % serviços (esperava 1)', n; end if;
  select count(*) into n from receita.fat_eventos;
  if n <> 0 then raise exception 'FALHOU C4: dona leu % eventos (esperava 0 em F1)', n; end if;
  begin
    insert into receita.fat_donos (emissora_id, user_id, papel) values (doc, jordana, 'gestor');
    raise exception 'FALHOU C4: dona se promoveu a gestora';
  exception when insufficient_privilege then null;
  end;
  update receita.fat_donos set ativo = false where user_id = jordana;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU C4: dona alterou % linhas de fat_donos', n; end if;
  update organizacao.empresas_grupo set fatura_por = 'contrato' where id = doc;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU C4: dona alterou % empresas', n; end if;

  -- C5. Dono da PAC não vê nada da DOC (CA-09: dono A não vê o dono B).
  perform set_config('request.jwt.claims', json_build_object('sub', mateus, 'role', 'authenticated')::text, true);
  select count(*) into n from receita.fat_donos;
  if n <> 1 then raise exception 'FALHOU C5: dono da PAC leu % linhas de fat_donos (esperava 1)', n; end if;
  select count(*) into n from receita.fat_donos where emissora_id = doc;
  if n <> 0 then raise exception 'FALHOU C5: dono da PAC leu % linhas da DOC', n; end if;
  select count(*) into n from receita.fat_servicos where emissora_id <> pac;
  if n <> 0 then raise exception 'FALHOU C5: dono da PAC leu % serviços de outra empresa', n; end if;

  -- C6. Gestora da DOC: vê a empresa inteira, inclusive os eventos dela, e nada das outras.
  perform set_config('request.jwt.claims', json_build_object('sub', paula, 'role', 'authenticated')::text, true);
  select count(*) into n from receita.fat_donos;
  if n <> 2 then raise exception 'FALHOU C6: gestora da DOC leu % linhas de fat_donos (esperava 2)', n; end if;
  select count(*) into n from receita.fat_eventos;
  if n <> 2 then raise exception 'FALHOU C6: gestora da DOC leu % eventos (esperava os 2 da DOC)', n; end if;
  select count(*) into n from receita.fat_eventos where emissora_id <> doc;
  if n <> 0 then raise exception 'FALHOU C6: gestora leu % eventos de outra empresa', n; end if;

  -- C7. Super admin com recorte só da PARTNERS: vê só a PARTNERS e não cadastra fora dela.
  perform set_config('request.jwt.claims', json_build_object('sub', victor, 'role', 'authenticated')::text, true);
  select count(*) into n from receita.fat_donos;
  if n <> 1 then raise exception 'FALHOU C7: super admin com recorte leu % linhas (esperava 1, a da PARTNERS)', n; end if;
  select count(*) into n from receita.fat_donos where emissora_id <> partners;
  if n <> 0 then raise exception 'FALHOU C7: super admin leu % linhas fora do recorte', n; end if;
  begin
    insert into receita.fat_donos (emissora_id, user_id, papel) values (doc, victor, 'dono');
    raise exception 'FALHOU C7: super admin cadastrou dono fora do recorte';
  exception when insufficient_privilege then null;
  end;
end $c$;

reset role;

-- D. fat_eventos é append-only também para quem ignora RLS -----------------------------------------------------------
do $d$
declare
  n int;
  msg text;
begin
  if current_user <> 'postgres' then raise exception 'ENSAIO INVÁLIDO: o bloco D roda como %', current_user; end if;
  begin
    update receita.fat_eventos set evento = 'adulterado';
    raise exception 'FALHOU D1: UPDATE em fat_eventos passou como postgres';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    if msg not like '%append-only%' then raise exception 'FALHOU D1: erro inesperado: %', msg; end if;
  end;
  begin
    delete from receita.fat_eventos;
    raise exception 'FALHOU D2: DELETE em fat_eventos passou como postgres';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    if msg not like '%append-only%' then raise exception 'FALHOU D2: erro inesperado: %', msg; end if;
  end;
  begin
    truncate receita.fat_eventos;
    raise exception 'FALHOU D3: TRUNCATE em fat_eventos passou como postgres';
  exception when insufficient_privilege then
    get stacked diagnostics msg = message_text;
    if msg not like '%append-only%' then raise exception 'FALHOU D3: erro inesperado: %', msg; end if;
  end;
  select count(*) into n from receita.fat_eventos;
  if n <> 6 then raise exception 'FALHOU D4: % eventos depois das tentativas (esperava 6)', n; end if;
end $d$;

set local role service_role;

do $e$
declare n int;
begin
  if current_user <> 'service_role' then raise exception 'ENSAIO INVÁLIDO: o bloco E roda como %', current_user; end if;
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento)
  values ('dono', gen_random_uuid(), '505278f4-b1be-4cef-b56d-2f03273988f9', 'ensaio_service_role');
  begin
    update receita.fat_eventos set evento = 'adulterado';
    raise exception 'FALHOU E1: UPDATE em fat_eventos passou como service_role';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from receita.fat_eventos;
    raise exception 'FALHOU E2: DELETE em fat_eventos passou como service_role';
  exception when insufficient_privilege then null;
  end;
  select count(*) into n from receita.fat_eventos;
  if n <> 7 then raise exception 'FALHOU E3: % eventos (esperava 7: 6 + o da service role)', n; end if;
end $e$;

reset role;

-- F. Rollback ------------------------------------------------------------------------------------------------------
-- @@ROLLBACK@@

do $f$
begin
  if exists (select 1 from pg_namespace where nspname in ('receita', 'organizacao')) then
    raise exception 'FALHOU F1: o rollback deixou os schemas';
  end if;
  if exists (select 1 from ops.areas where slug like 'faturamento%')
     or exists (select 1 from ops.roles where key in ('fat_tesouraria', 'fat_controladoria'))
     or exists (select 1 from ops.area_chaves
                 where permission_key in ('view.faturamento', 'edit.faturamento_pedido',
                                          'edit.faturamento_tesouraria', 'admin.faturamento')) then
    raise exception 'FALHOU F1: o rollback deixou área, papel ou chave do faturamento';
  end if;
  if md5(
       coalesce((select string_agg(role || '|' || area || '|' || allowed, ',' order by role, area) from ops.role_areas), '')
    || '#' || coalesce((select string_agg(area || '|' || permission_key, ',' order by area, permission_key) from ops.area_chaves), '')
    || '#' || coalesce((select string_agg(key || '|' || label || '|' || is_system, ',' order by key) from ops.roles), '')
    || '#' || coalesce((select string_agg(slug || '|' || nome || '|' || escopo || '|' || ativa, ',' order by slug) from ops.areas), ''))
     <> current_setting('ensaio.acesso_antes') then
    raise exception 'FALHOU F2: depois do rollback o modelo de acesso não é o de antes';
  end if;
  if md5(
       coalesce((select string_agg(user_id || '|' || role, ',' order by user_id, role) from ops.user_roles), '')
    || '#' || coalesce((select string_agg(user_id || '|' || area || '|' || allowed, ',' order by user_id, area) from ops.usuario_areas), '')
    || '#' || coalesce((select string_agg(user_id || '|' || permission_key || '|' || allowed, ',' order by user_id, permission_key) from ops.usuario_chaves), ''))
     <> current_setting('ensaio.pessoas_antes') then
    raise exception 'FALHOU F3: depois do rollback as concessões por pessoa não são as de antes';
  end if;
end $f$;

rollback;
