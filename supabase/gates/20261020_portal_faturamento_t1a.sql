-- Ensaio da T1a do Portal de Faturamento (20/10/2026): migration 20261020100000_portal_faturamento_t1a.sql, a semente
-- 20261020101000_portal_faturamento_servicos_e0.sql e os rollbacks das duas.
--
-- Roda tudo numa transação que termina em ROLLBACK: nada sobrevive. Cada teste levanta exceção quando falha, então a
-- Management API responde [] só se TODOS passarem; uma falha volta como HTTP 400 com o código do teste (FALHOU Xn).
-- Pré-requisitos: F1 (20261015150000) aplicada, e os segredos omie_<sigla> no Vault (e1/vault_omie.py --gravar).
--
-- Como rodar (e1/ensaio.py faz isso): troque a linha MIGRATION pela T1a seguida da semente e a linha ROLLBACK pelo
-- rollback da semente seguido do da T1a, todos SEM as linhas begin;/commit;, e mande o texto inteiro em UMA chamada.
-- Depois de aplicar, rode de novo com a linha MIGRATION vazia (mantendo os rollbacks): os testes valem nos dois
-- modos. A massa de teste usa números de pedido explícitos (FAT-1999-…), então o gate não gasta a sequence de
-- produção; o teste do número automático só roda quando a sequence nasceu nesta mesma transação.
--
-- A API roda como postgres, que ignora RLS. Os testes de acesso trocam para `authenticated` (com request.jwt.claims de
-- cada pessoa) e para `service_role` com `set local role`, e conferem o papel antes de testar.
-- Pessoas reais (só leitura delas):
--   pedro   5c4d0e46-fc33-4132-bcca-47c05ad001c7  admin: abre a área (view.faturamento), mas não lê tabela nova direto
--   daniel  55f8d99a-a371-418e-aa34-2e596b9506f6  papel financeiro e todas_empresas, nada do faturamento
--   isabela c1efc06b-4a47-4445-80d4-eca5c6c119e9  CS, usuária comum, nada do faturamento
-- Nenhum valor de chave é lido para fora: o bloco E só compara app_key e app_secret com vazio.

begin;

-- Retrato do modelo de acesso antes de tudo (a T1a não mexe nele).
do $retrato$
begin
  perform set_config('ensaio.acesso_antes', md5(
       coalesce((select string_agg(role || '|' || area || '|' || allowed, ',' order by role, area) from ops.role_areas), '')
    || '#' || coalesce((select string_agg(area || '|' || permission_key, ',' order by area, permission_key) from ops.area_chaves), '')
    || '#' || coalesce((select string_agg(key || '|' || label || '|' || is_system, ',' order by key) from ops.roles), '')
    || '#' || coalesce((select string_agg(slug || '|' || nome || '|' || escopo || '|' || ativa, ',' order by slug) from ops.areas), '')
    || '#' || coalesce((select string_agg(user_id || '|' || role, ',' order by user_id, role) from ops.user_roles), '')
    || '#' || coalesce((select string_agg(user_id || '|' || area || '|' || allowed, ',' order by user_id, area) from ops.usuario_areas), '')
    || '#' || coalesce((select string_agg(user_id || '|' || permission_key || '|' || allowed, ',' order by user_id, permission_key) from ops.usuario_chaves), '')), true);
end $retrato$;

-- @@MIGRATION@@

-- A. Estrutura (como postgres) ------------------------------------------------------------------------------------
do $a$
declare
  n int;
  m text;
  t regclass;
  p text;
  novas constant regclass[] := array['receita.fat_pedidos', 'receita.fat_pedido_parcelas', 'integracoes.omie_envios',
                                     'integracoes.pipefy_envios', 'integracoes.omie_vinculo_cliente']::regclass[];
begin
  if current_user <> 'postgres' then raise exception 'ENSAIO INVÁLIDO: o bloco A roda como %', current_user; end if;

  if md5(
       coalesce((select string_agg(role || '|' || area || '|' || allowed, ',' order by role, area) from ops.role_areas), '')
    || '#' || coalesce((select string_agg(area || '|' || permission_key, ',' order by area, permission_key) from ops.area_chaves), '')
    || '#' || coalesce((select string_agg(key || '|' || label || '|' || is_system, ',' order by key) from ops.roles), '')
    || '#' || coalesce((select string_agg(slug || '|' || nome || '|' || escopo || '|' || ativa, ',' order by slug) from ops.areas), '')
    || '#' || coalesce((select string_agg(user_id || '|' || role, ',' order by user_id, role) from ops.user_roles), '')
    || '#' || coalesce((select string_agg(user_id || '|' || area || '|' || allowed, ',' order by user_id, area) from ops.usuario_areas), '')
    || '#' || coalesce((select string_agg(user_id || '|' || permission_key || '|' || allowed, ',' order by user_id, permission_key) from ops.usuario_chaves), ''))
     <> current_setting('ensaio.acesso_antes') then
    raise exception 'FALHOU A0: a T1a mexeu no modelo de acesso ou nas concessões por pessoa';
  end if;

  -- A1. Empresas: 22, 17 no portal, as 4 novas com o id do Financial Brain, fatura_por do E0.
  select count(*) into n from organizacao.empresas_grupo;
  if n <> 22 then raise exception 'FALHOU A1: % empresas (esperava 22)', n; end if;
  select string_agg(apelido, ',' order by apelido collate "C") into m from organizacao.empresas_grupo where ativa;
  if m <> 'ASCENDIA,BPO,CONCILIADOR,DOC,FINANCE,MAROX,NEO,PAC,PAC SP,PARTNERS,PAT,PCC,PGE,PIS,PMC,PNE,PRJ' then
    raise exception 'FALHOU A1: ativas no portal = %', m;
  end if;
  select count(*) into n from organizacao.empresas_grupo
   where (id, apelido, cnpj, omie_credencial_ref) in (
     ('c2f915ce-960c-40a4-a659-2c8bb3580c75', 'ASCENDIA', '68061952000159', 'omie_ascendia'),
     ('ead599c5-8491-46a9-889e-461e165db9b6', 'CONCILIADOR', '63279474000134', 'omie_conciliador'),
     ('a601d0e7-f23f-4f1b-a65d-bff5c0b6b449', 'FINANCE', '68616679000181', 'omie_finance'),
     ('3bac1e6e-bd25-4071-84ea-07ac26bef99f', 'PNE', '68387855000150', 'omie_pne'));
  if n <> 4 then raise exception 'FALHOU A1: % das 4 empresas novas com id, CNPJ e segredo certos', n; end if;
  select string_agg(apelido || '=' || coalesce(fatura_por, '-'), ',' order by apelido collate "C") into m
    from organizacao.empresas_grupo;
  if m <> 'AGRO=-,ASCENDIA=-,BPO=ambos,CONCILIADOR=-,DOC=ambos,FINANCE=-,MAROX=ambos,NEO=ambos,PAC=ambos,'
          'PAC SP=ambos,PAI=-,PARTNERS=os,PAT=ambos,PCC=ambos,PGE=contrato,PIS=ambos,PMC=ambos,PMN=-,PNC=-,PNE=-,'
          'PRJ=ambos,ROIT=-' then
    raise exception 'FALHOU A1: fatura_por = %', m;
  end if;

  -- A2. Travas: todas em simular, Pipefy desligado; valor fora da lista recusado.
  select count(*) into n from organizacao.empresas_grupo
   where modo_omie = 'simular' and not pipefy_sync and conta_corrente_padrao is null;
  if n <> 22 then raise exception 'FALHOU A2: % de 22 empresas em simular e sem Pipefy', n; end if;
  begin
    update organizacao.empresas_grupo set modo_omie = 'producao' where apelido = 'DOC';
    raise exception 'FALHOU A2: modo_omie aceitou valor fora de simular/gravar';
  exception when check_violation then null;
  end;

  -- A3. RLS e comentário nas 5 tabelas novas; nenhuma policy (ninguém de fora lê direto).
  select count(*) into n from pg_class
   where oid = any (novas) and relrowsecurity and obj_description(oid, 'pg_class') is not null;
  if n <> 5 then raise exception 'FALHOU A3: RLS ou comentário faltando (% de 5)', n; end if;
  select count(*) into n from pg_policy where polrelid = any (novas);
  if n <> 0 then raise exception 'FALHOU A3: % policies nas tabelas novas (esperava nenhuma)', n; end if;

  -- A4. Privilégios: anon e authenticated sem nada nas tabelas novas, sem USAGE em integracoes, sem EXECUTE na
  --     credencial; service_role com o que o conector precisa e sem DELETE.
  foreach t in array novas loop
    foreach p in array array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger'] loop
      if has_table_privilege('authenticated', t, p) or has_table_privilege('anon', t, p) then
        raise exception 'FALHOU A4: authenticated ou anon tem % em %', p, t;
      end if;
    end loop;
    if has_any_column_privilege('authenticated', t, 'select') or has_any_column_privilege('anon', t, 'select') then
      raise exception 'FALHOU A4: authenticated ou anon lê coluna de %', t;
    end if;
    if not (has_table_privilege('service_role', t, 'select') and has_table_privilege('service_role', t, 'insert')
            and has_table_privilege('service_role', t, 'update')) then
      raise exception 'FALHOU A4: service_role sem select/insert/update em %', t;
    end if;
    if has_table_privilege('service_role', t, 'delete') or has_table_privilege('service_role', t, 'truncate') then
      raise exception 'FALHOU A4: service_role pode apagar %', t;
    end if;
  end loop;
  if has_schema_privilege('authenticated', 'integracoes', 'usage') or has_schema_privilege('anon', 'integracoes', 'usage') then
    raise exception 'FALHOU A4: authenticated ou anon tem USAGE em integracoes';
  end if;
  if has_function_privilege('authenticated', 'integracoes.omie_credencial(uuid)', 'execute')
     or has_function_privilege('anon', 'integracoes.omie_credencial(uuid)', 'execute')
     or exists (select 1 from pg_proc pp, aclexplode(pp.proacl) acl
                 where pp.oid = 'integracoes.omie_credencial(uuid)'::regprocedure and acl.grantee = 0)
     or not has_function_privilege('service_role', 'integracoes.omie_credencial(uuid)', 'execute') then
    raise exception 'FALHOU A4: EXECUTE de integracoes.omie_credencial fora de "só service_role"';
  end if;
  if has_sequence_privilege('authenticated', 'receita.fat_pedidos_numero_seq', 'usage')
     or has_sequence_privilege('anon', 'receita.fat_pedidos_numero_seq', 'usage') then
    raise exception 'FALHOU A4: authenticated ou anon usa a sequence dos pedidos';
  end if;
  select count(*) into n from pg_proc pp
   where pp.pronamespace in ('receita'::regnamespace, 'organizacao'::regnamespace, 'integracoes'::regnamespace)
     and (has_function_privilege('anon', pp.oid, 'execute')
          or (pp.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', pp.oid, 'execute'))
          or (pp.pronamespace = 'integracoes'::regnamespace and has_function_privilege('authenticated', pp.oid, 'execute')));
  if n <> 0 then raise exception 'FALHOU A4: % funções executáveis por anon (ou gatilho/integracoes por authenticated)', n; end if;
  select count(*) into n from pg_proc pp
   where pp.pronamespace in ('receita'::regnamespace, 'integracoes'::regnamespace) and pp.prosecdef
     and not exists (select 1 from unnest(pp.proconfig) c where c like 'search_path=%');
  if n <> 0 then raise exception 'FALHOU A4: % SECURITY DEFINER sem search_path fixo', n; end if;

  -- A5. Soma das parcelas: dois gatilhos de restrição, adiáveis e adiados por padrão.
  select count(*) into n from pg_trigger
   where tgname in ('fat_pedido_parcelas_soma', 'fat_pedidos_parcelas_soma')
     and tgconstraint <> 0 and tgdeferrable and tginitdeferred;
  if n <> 2 then raise exception 'FALHOU A5: % de 2 gatilhos de restrição adiados', n; end if;

  -- A6. Numeração (função pura: não gasta a sequence).
  if receita.fat_pedido_numero_formatar(1, '2026-10-20 12:00-03') <> 'FAT-2026-000001'
     or receita.fat_pedido_numero_formatar(123, '2027-01-01 02:00+00') <> 'FAT-2026-000123'   -- 31/12 23h em SP
     or receita.fat_pedido_numero_formatar(1234567, '2027-03-01 12:00-03') <> 'FAT-2027-1234567' then
    raise exception 'FALHOU A6: formato do número do pedido';
  end if;
end $a$;

-- A7. Número automático: só quando a sequence nasceu nesta transação (ensaio antes de aplicar), para não gastar
--     número de produção.
do $a7$
declare
  r record;
  ano text := extract(year from now() at time zone 'America/Sao_Paulo')::int::text;
begin
  if (select c.xmin::text from pg_class c where c.oid = 'receita.fat_pedidos_numero_seq'::regclass)
     = (pg_current_xact_id()::text::bigint % 4294967296)::text then
    insert into receita.fat_pedidos (emissora_id, solicitante_id)
    values ('c243e5e4-8309-43e6-ac33-146b9771a44e', '5c4d0e46-fc33-4132-bcca-47c05ad001c7')
    returning numero, codigo_integracao, status into r;
    if r.numero <> 'FAT-' || ano || '-000001' or r.codigo_integracao <> r.numero or r.status <> 'rascunho' then
      raise exception 'FALHOU A7: primeiro pedido saiu como % / % / %', r.numero, r.codigo_integracao, r.status;
    end if;
  end if;
end $a7$;

-- S. Semente do catálogo do E0 ------------------------------------------------------------------------------------
do $s$
declare
  n int;
  m text;
begin
  select count(*) into n from receita.fat_servicos where sincronizado_em = timestamptz '2026-10-15 11:50:00-03';
  if n <> 138 then raise exception 'FALHOU S1: % serviços da foto do E0 (esperava 138)', n; end if;
  select count(*) into n from receita.fat_servicos where sincronizado_em = timestamptz '2026-10-15 11:50:00-03' and ativo;
  if n <> 130 then raise exception 'FALHOU S1: % serviços ativos (esperava 130)', n; end if;
  select count(*) into n from receita.fat_servicos
   where sincronizado_em = timestamptz '2026-10-15 11:50:00-03' and ativo and tem_tributacao;
  if n <> 126 then raise exception 'FALHOU S1: % ativos com tributação (esperava 126)', n; end if;
  select string_agg(g.apelido || '=' || x.total || '/' || x.ativos, ',' order by g.apelido collate "C") into m
    from (select emissora_id, count(*) total, count(*) filter (where ativo) ativos
            from receita.fat_servicos where sincronizado_em = timestamptz '2026-10-15 11:50:00-03'
           group by emissora_id) x
    join organizacao.empresas_grupo g on g.id = x.emissora_id;
  if m <> 'BPO=7/5,DOC=42/42,MAROX=7/7,NEO=4/4,PAC=11/11,PAC SP=6/6,PARTNERS=10/10,PAT=10/4,PCC=9/9,PGE=7/7,'
          'PIS=2/2,PMC=9/9,PNC=1/1,PRJ=5/5,ROIT=8/8' then
    raise exception 'FALHOU S2: serviços por emissora = %', m;
  end if;
  select count(*) into n from receita.fat_servicos
   where sincronizado_em = timestamptz '2026-10-15 11:50:00-03'
     and (coalesce(btrim(codigo), '') = '' or codigo_omie !~ '^[0-9]+$' or jsonb_typeof(tributacao) <> 'object'
          or tributacao = '{}'::jsonb);
  if n <> 0 then raise exception 'FALHOU S3: % serviços com codigo, nCodServ ou tributação fora do formato', n; end if;
  if exists (select 1 from receita.fat_servicos s
              where s.emissora_id = 'c243e5e4-8309-43e6-ac33-146b9771a44e' and s.codigo_omie = '6931061282'
                and not (s.codigo = 'SRV00001' and s.codigo_lc116 = '17.01' and s.codigo_municipal = '170101/17.01'
                         and s.id_tributacao = '01' and s.categoria_padrao = '1.01.85' and s.ativo and s.tem_tributacao
                         and s.tributacao ->> 'cClassTrib' = '200052')) then
    raise exception 'FALHOU S3: o primeiro serviço da DOC não veio como o E0 leu';
  end if;
end $s$;

-- Massa de teste (como postgres) ---------------------------------------------------------------------------------
insert into receita.fat_servicos (emissora_id, codigo_omie, descricao, codigo_lc116, codigo_municipal, id_tributacao) values
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', 'ensaio-t1a-doc', 'Serviço de ensaio da DOC', '17.01', '170101/17.01', '01'),
  ('8cdf5de7-683f-4d8e-a194-f303677ac6ea', 'ensaio-t1a-pac', 'Serviço de ensaio da PAC', '17.19', '171901/17.19', '01');

-- B. Pedido e parcelas (como postgres) ----------------------------------------------------------------------------
do $b$
declare
  doc   constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  pac   constant uuid := '8cdf5de7-683f-4d8e-a194-f303677ac6ea';
  pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  svc_doc uuid;
  ped uuid;
  n int;
  msg text;
  r record;
begin
  select id into svc_doc from receita.fat_servicos where emissora_id = doc and codigo_omie = 'ensaio-t1a-doc';

  insert into receita.fat_pedidos
    (numero, emissora_id, tomador_tipo, tomador_documento, tomador_nome, servico_id, descricao_nf, valor, forma,
     parcelas, primeiro_vencimento, competencia, documento, meio, dono_id, solicitante_id, status)
  values ('FAT-1999-000001', doc, 'pj', '11222333000181', 'Tomador de ensaio', svc_doc, 'Serviço de ensaio', 300.00,
          'parcelado', 3, '2026-11-10', '2026-10-01', 'nf', 'boleto', pedro, pedro, 'na_fila_omie')
  returning id into ped;

  -- B1. codigo_integracao é o número.
  select numero, codigo_integracao into r from receita.fat_pedidos where id = ped;
  if r.codigo_integracao is distinct from r.numero then raise exception 'FALHOU B1: codigo_integracao ≠ numero'; end if;

  -- B2. Parcelas somando 299,99 num pedido de 300: recusado.
  begin
    insert into receita.fat_pedido_parcelas (pedido_id, n, vencimento, valor) values
      (ped, 1, '2026-11-10', 100.00), (ped, 2, '2026-12-10', 100.00), (ped, 3, '2027-01-10', 99.99);
    set constraints receita.fat_pedido_parcelas_soma immediate;
    raise exception 'FALHOU B2: parcelas somando 299,99 num pedido de 300 passaram';
  exception when check_violation then
    get stacked diagnostics msg = message_text;
    if msg not like 'Parcelas do pedido FAT-1999-000001 não fecham%' then
      raise exception 'FALHOU B2: erro inesperado: %', msg;
    end if;
  end;

  -- B3. Soma certa em 2 parcelas num pedido de 3: recusado.
  begin
    insert into receita.fat_pedido_parcelas (pedido_id, n, vencimento, valor) values
      (ped, 1, '2026-11-10', 150.00), (ped, 2, '2026-12-10', 150.00);
    set constraints receita.fat_pedido_parcelas_soma immediate;
    raise exception 'FALHOU B3: 2 parcelas num pedido de 3 passaram';
  exception when check_violation then null;
  end;

  -- B4. Parcelas pulando o n (1, 2, 4): recusado.
  begin
    insert into receita.fat_pedido_parcelas (pedido_id, n, vencimento, valor) values
      (ped, 1, '2026-11-10', 100.00), (ped, 2, '2026-12-10', 100.00), (ped, 4, '2027-01-10', 100.00);
    set constraints receita.fat_pedido_parcelas_soma immediate;
    raise exception 'FALHOU B4: parcelas 1, 2 e 4 passaram';
  exception when check_violation then null;
  end;

  -- B5. Parcelas certas passam (conferidas agora, não só no commit).
  insert into receita.fat_pedido_parcelas (pedido_id, n, vencimento, valor) values
    (ped, 1, '2026-11-10', 100.00), (ped, 2, '2026-12-10', 100.00), (ped, 3, '2027-01-10', 100.00);
  set constraints receita.fat_pedido_parcelas_soma immediate;
  set constraints receita.fat_pedido_parcelas_soma deferred;

  -- B6. Mudar o valor do pedido sem mexer nas parcelas: recusado.
  begin
    update receita.fat_pedidos set valor = 310.00 where id = ped;
    set constraints receita.fat_pedidos_parcelas_soma immediate;
    raise exception 'FALHOU B6: valor do pedido mudou e as parcelas ficaram somando o antigo';
  exception when check_violation then null;
  end;

  -- B7. Adiado de verdade: valor e parcelas mudando em dois comandos da mesma transação passa.
  update receita.fat_pedidos set valor = 330.00 where id = ped;
  update receita.fat_pedido_parcelas set valor = 110.00 where pedido_id = ped;
  set constraints receita.fat_pedido_parcelas_soma, receita.fat_pedidos_parcelas_soma immediate;
  set constraints receita.fat_pedido_parcelas_soma, receita.fat_pedidos_parcelas_soma deferred;

  -- B8. Fora do rascunho, pedido incompleto é recusado; rascunho incompleto passa.
  begin
    insert into receita.fat_pedidos (numero, emissora_id, solicitante_id, status)
    values ('FAT-1999-000002', doc, pedro, 'na_fila_omie');
    raise exception 'FALHOU B8: pedido incompleto entrou na fila do Omie';
  exception when check_violation then null;
  end;
  insert into receita.fat_pedidos (numero, emissora_id, solicitante_id) values ('FAT-1999-000002', doc, pedro);

  -- B9. Serviço de outra emissora: recusado.
  begin
    insert into receita.fat_pedidos (numero, emissora_id, solicitante_id, servico_id)
    values ('FAT-1999-000003', pac, pedro, svc_doc);
    raise exception 'FALHOU B9: pedido da PAC aceitou serviço da DOC';
  exception when foreign_key_violation then null;
  end;

  -- B10. Regras de campo: devolvido sem motivo, CPF em PJ, avulso em 2 parcelas, status fora da lista, número fora
  --      do formato, competência fora do dia 1.
  begin
    update receita.fat_pedidos set status = 'devolvido' where numero = 'FAT-1999-000002';
    raise exception 'FALHOU B10: devolvido sem motivo';
  exception when check_violation then null;
  end;
  begin
    update receita.fat_pedidos set tomador_tipo = 'pj', tomador_documento = '12345678901' where numero = 'FAT-1999-000002';
    raise exception 'FALHOU B10: PJ com 11 dígitos';
  exception when check_violation then null;
  end;
  begin
    update receita.fat_pedidos set forma = 'avulso', parcelas = 2 where numero = 'FAT-1999-000002';
    raise exception 'FALHOU B10: avulso em 2 parcelas';
  exception when check_violation then null;
  end;
  begin
    update receita.fat_pedidos set status = 'aprovado' where numero = 'FAT-1999-000002';
    raise exception 'FALHOU B10: status fora dos 13';
  exception when check_violation then null;
  end;
  begin
    insert into receita.fat_pedidos (numero, emissora_id, solicitante_id) values ('PED-1', doc, pedro);
    raise exception 'FALHOU B10: número fora do formato';
  exception when check_violation then null;
  end;
  begin
    update receita.fat_pedidos set competencia = '2026-10-15' where numero = 'FAT-1999-000002';
    raise exception 'FALHOU B10: competência no dia 15';
  exception when check_violation then null;
  end;

  -- B11. Os 13 estados do plano são aceitos (num pedido completo, com motivo).
  n := 0;
  foreach msg in array array['rascunho', 'aguardando_ok', 'devolvido', 'na_fila_omie', 'simulado', 'erro_omie',
                             'os_criada', 'em_conferencia', 'faturado', 'recebido', 'em_atraso',
                             'cancelamento_pedido', 'cancelado'] loop
    update receita.fat_pedidos set status = msg, motivo_status = 'ensaio' where id = ped;
    n := n + 1;
  end loop;
  if n <> 13 then raise exception 'FALHOU B11: % estados testados (esperava 13)', n; end if;
  update receita.fat_pedidos set status = 'na_fila_omie', motivo_status = null where id = ped;
  update receita.fat_pedidos set status = 'cancelado', motivo_status = 'ensaio' where numero = 'FAT-1999-000002';
end $b$;

-- C. Filas de saída (como postgres) -------------------------------------------------------------------------------
do $c$
declare
  doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  ped uuid;
begin
  select id into ped from receita.fat_pedidos where numero = 'FAT-1999-000001';

  insert into integracoes.omie_envios (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, status)
  values (doc, 'fat_pedido', ped, 'incluir_os', 'FAT-1999-000001', '{"Cabecalho": {"cCodIntOS": "FAT-1999-000001"}}', 'simulado');

  -- C1. Duplicata de (operacao, codigo_integracao): recusada.
  begin
    insert into integracoes.omie_envios (emissora_id, origem, origem_id, operacao, codigo_integracao)
    values (doc, 'fat_pedido', ped, 'incluir_os', 'FAT-1999-000001');
    raise exception 'FALHOU C1: a fila aceitou incluir_os duas vezes para o mesmo pedido';
  exception when unique_violation then null;
  end;
  -- C2. Mesmo código em outra operação: aceito.
  insert into integracoes.omie_envios (emissora_id, origem, origem_id, operacao, codigo_integracao)
  values (doc, 'fat_pedido', ped, 'faturar_os', 'FAT-1999-000001');
  -- C3. Chave do Omie no payload ou na resposta: recusada.
  begin
    insert into integracoes.omie_envios (emissora_id, origem, origem_id, operacao, codigo_integracao, payload)
    values (doc, 'fat_pedido', ped, 'consultar_status', 'FAT-1999-000001', '{"app_key": "x", "param": []}');
    raise exception 'FALHOU C3: payload com app_key entrou na fila';
  exception when check_violation then null;
  end;
  begin
    update integracoes.omie_envios set resposta = '{"app_secret": "x"}' where operacao = 'incluir_os' and codigo_integracao = 'FAT-1999-000001';
    raise exception 'FALHOU C3: resposta com app_secret entrou na fila';
  exception when check_violation then null;
  end;
  -- C4. Erro sem erro legível, operação ou status fora da lista: recusados.
  begin
    update integracoes.omie_envios set status = 'erro' where operacao = 'faturar_os' and codigo_integracao = 'FAT-1999-000001';
    raise exception 'FALHOU C4: status erro sem erro_legivel';
  exception when check_violation then null;
  end;
  begin
    insert into integracoes.omie_envios (emissora_id, origem, origem_id, operacao, codigo_integracao)
    values (doc, 'fat_contrato', ped, 'alterar_contrato', 'CTR-ENSAIO');
    raise exception 'FALHOU C4: operação fora da E1 aceita';
  exception when check_violation then null;
  end;
  begin
    update integracoes.omie_envios set status = 'feito' where operacao = 'faturar_os' and codigo_integracao = 'FAT-1999-000001';
    raise exception 'FALHOU C4: status fora da lista aceito';
  exception when check_violation then null;
  end;

  -- C5. Pipefy: criar_card simulado aceito; operação fora da lista recusada.
  insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao, payload, status)
  values (doc, 'fat_pedido', ped, 'criar_card', '{"query": "mutation { createCard }", "variables": {}}', 'simulado');
  begin
    insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao) values (doc, 'fat_pedido', ped, 'apagar_card');
    raise exception 'FALHOU C5: operação do Pipefy fora da lista aceita';
  exception when check_violation then null;
  end;

  -- C6. Vínculo de cliente: um por emissora e documento.
  insert into integracoes.omie_vinculo_cliente (emissora_id, documento, codigo_cliente_omie) values (doc, '11222333000181', 1);
  begin
    insert into integracoes.omie_vinculo_cliente (emissora_id, documento, codigo_cliente_omie) values (doc, '11222333000181', 2);
    raise exception 'FALHOU C6: dois vínculos para o mesmo documento na mesma emissora';
  exception when unique_violation then null;
  end;
  begin
    insert into integracoes.omie_vinculo_cliente (emissora_id, documento, codigo_cliente_omie) values (doc, '123', 3);
    raise exception 'FALHOU C6: documento fora do formato';
  exception when check_violation then null;
  end;
end $c$;

-- E0. A credencial recusa quem não é service_role, mesmo o postgres (conferência no corpo, além do GRANT).
do $e0$
begin
  if current_user <> 'postgres' then raise exception 'ENSAIO INVÁLIDO: o bloco E0 roda como %', current_user; end if;
  begin
    perform integracoes.omie_credencial('c243e5e4-8309-43e6-ac33-146b9771a44e');
    raise exception 'FALHOU E0: postgres sem SET ROLE leu a credencial';
  exception when insufficient_privilege then null;
  end;
end $e0$;

-- D. Acesso como authenticated --------------------------------------------------------------------------------------
set local role authenticated;

do $d$
declare
  pedro   constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  daniel  constant uuid := '55f8d99a-a371-418e-aa34-2e596b9506f6';
  isabela constant uuid := 'c1efc06b-4a47-4445-80d4-eca5c6c119e9';
  doc     constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  quem uuid;
  q text;
  n int;
  proibidas constant text[] := array[
    'select count(*) from receita.fat_pedidos',
    'select count(*) from receita.fat_pedido_parcelas',
    'select count(*) from integracoes.omie_envios',
    'select count(*) from integracoes.pipefy_envios',
    'select count(*) from integracoes.omie_vinculo_cliente',
    'insert into receita.fat_pedidos (numero, emissora_id, solicitante_id) values (''FAT-1999-000009'', ''c243e5e4-8309-43e6-ac33-146b9771a44e'', auth.uid())',
    'update receita.fat_pedidos set status = ''faturado''',
    'select integracoes.omie_credencial(''c243e5e4-8309-43e6-ac33-146b9771a44e'')',
    'select receita.fat_pedido_numero()',
    'select nextval(''receita.fat_pedidos_numero_seq'')',
    'update organizacao.empresas_grupo set modo_omie = ''gravar''',
    'update organizacao.empresas_grupo set pipefy_sync = true'];
begin
  if current_user <> 'authenticated' then
    raise exception 'ENSAIO INVÁLIDO: os testes de acesso rodam como %, não como authenticated', current_user;
  end if;

  -- D0. Sem login: nada.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  if auth.uid() is not null then raise exception 'ENSAIO INVÁLIDO: auth.uid() deveria ser nulo'; end if;
  if ops.can('view.faturamento') then raise exception 'FALHOU D0: sem login abre a área'; end if;
  select count(*) into n from receita.fat_servicos;
  if n <> 0 then raise exception 'FALHOU D0: sem login leu % serviços', n; end if;
  select count(*) into n from organizacao.empresas_grupo;
  if n <> 0 then raise exception 'FALHOU D0: sem login leu % empresas', n; end if;

  -- D1. Sem papel no faturamento (financeiro com todas_empresas; CS): não abre a área e não lê nada do portal.
  foreach quem in array array[daniel, isabela] loop
    perform set_config('request.jwt.claims', json_build_object('sub', quem, 'role', 'authenticated')::text, true);
    if auth.uid() is distinct from quem then raise exception 'ENSAIO INVÁLIDO: auth.uid() não trocou para %', quem; end if;
    if ops.can('view.faturamento') then raise exception 'FALHOU D1: % (sem papel) abre a área do faturamento', quem; end if;
    select count(*) into n from receita.fat_servicos;
    if n <> 0 then raise exception 'FALHOU D1: % (sem papel) leu % serviços', quem, n; end if;
    select count(*) into n from receita.fat_donos;
    if n <> 0 then raise exception 'FALHOU D1: % (sem papel) leu % donos', quem, n; end if;
    select count(*) into n from receita.fat_eventos;
    if n <> 0 then raise exception 'FALHOU D1: % (sem papel) leu % eventos', quem, n; end if;
  end loop;

  -- D2. Admin: abre a área (porta e as três chaves de área)...
  perform set_config('request.jwt.claims', json_build_object('sub', pedro, 'role', 'authenticated')::text, true);
  if auth.uid() is distinct from pedro then raise exception 'ENSAIO INVÁLIDO: auth.uid() não trocou para pedro'; end if;
  if not (ops.can('view.faturamento') and ops.can('edit.faturamento_pedido')
          and ops.can('edit.faturamento_tesouraria') and ops.can('admin.faturamento')) then
    raise exception 'FALHOU D2: o admin não abre a área do faturamento';
  end if;
  select count(*) into n from organizacao.empresas_grupo;
  if n <> 22 then raise exception 'FALHOU D2: o admin leu % empresas (esperava 22)', n; end if;

  -- D3. ... e nem ele, nem quem não tem papel, lê ou grava tabela nova direto, chama a credencial, gasta número ou
  --     liga as travas pelo navegador.
  foreach quem in array array[pedro, daniel, isabela] loop
    perform set_config('request.jwt.claims', json_build_object('sub', quem, 'role', 'authenticated')::text, true);
    foreach q in array proibidas loop
      begin
        execute q;
        raise exception 'FALHOU D3: "%" passou como %', q, quem;
      exception when insufficient_privilege then null;
      end;
    end loop;
  end loop;
end $d$;

reset role;

-- E. O conector (service_role) ------------------------------------------------------------------------------------
set local role service_role;

do $e$
declare
  r record;
  c jsonb;
  n int := 0;
  st text;
begin
  if current_user <> 'service_role' or current_setting('role') <> 'service_role' then
    raise exception 'ENSAIO INVÁLIDO: o bloco E roda como % (role %)', current_user, current_setting('role');
  end if;

  -- E1. Toda emissora ativa com Omie tem credencial com app_key e app_secret (o valor não sai daqui).
  for r in select id, apelido from organizacao.empresas_grupo where ativa and omie_credencial_ref is not null loop
    begin
      c := integracoes.omie_credencial(r.id);
    exception when others then
      get stacked diagnostics st = message_text;
      raise exception 'FALHOU E1: credencial da % não leu: %', r.apelido, st;
    end;
    if coalesce(btrim(c ->> 'app_key'), '') = '' or coalesce(btrim(c ->> 'app_secret'), '') = ''
       or (select count(*) from jsonb_object_keys(c)) <> 2 then
      raise exception 'FALHOU E1: credencial da % sem app_key/app_secret (ou com campo a mais)', r.apelido;
    end if;
    n := n + 1;
  end loop;
  c := null;
  if n <> 17 then raise exception 'FALHOU E1: % credenciais lidas (esperava 17)', n; end if;

  -- E2. Emissora fora do portal, sem Omie ou inexistente: exceção limpa, sem valor.
  begin
    perform integracoes.omie_credencial('59028b02-f52f-4a64-a933-ad4b5028c985');  -- AGRO, ativa = false
    raise exception 'FALHOU E2: a credencial da AGRO (fora do portal) saiu';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform integracoes.omie_credencial('edb1ab3c-0f41-4191-b86f-04c01ebd53db');  -- PAI, sem Omie
    raise exception 'FALHOU E2: a PAI (sem Omie) devolveu credencial';
  exception when sqlstate '55000' then null;
  end;
  begin
    perform integracoes.omie_credencial(gen_random_uuid());
    raise exception 'FALHOU E2: emissora inexistente devolveu credencial';
  exception when sqlstate 'P0002' then null;
  end;

  -- E3. O conector lê o pedido, grava na fila e no pedido, e não apaga.
  select count(*) into n from receita.fat_pedidos where numero like 'FAT-1999-%';
  if n <> 2 then raise exception 'FALHOU E3: service_role leu % pedidos de ensaio (esperava 2)', n; end if;
  insert into integracoes.omie_envios (emissora_id, origem, origem_id, operacao, codigo_integracao)
  select emissora_id, 'fat_pedido', id, 'consultar_status', numero from receita.fat_pedidos where numero = 'FAT-1999-000001';
  update receita.fat_pedidos set status = 'simulado' where numero = 'FAT-1999-000001';
  begin
    delete from receita.fat_pedidos where numero = 'FAT-1999-000002';
    raise exception 'FALHOU E3: service_role apagou pedido';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from integracoes.omie_envios;
    raise exception 'FALHOU E3: service_role apagou a fila do Omie';
  exception when insufficient_privilege then null;
  end;
end $e$;

reset role;

-- F. Rollback ------------------------------------------------------------------------------------------------------
-- @@ROLLBACK@@

do $f$
declare
  n int;
  m text;
begin
  if exists (select 1 from pg_namespace where nspname = 'integracoes') then
    raise exception 'FALHOU F1: o rollback deixou o schema integracoes';
  end if;
  if to_regclass('receita.fat_pedidos') is not null or to_regclass('receita.fat_pedido_parcelas') is not null
     or to_regclass('receita.fat_pedidos_numero_seq') is not null
     or to_regprocedure('receita.fat_pedido_numero()') is not null
     or to_regprocedure('receita.fat_parcelas_conferir()') is not null then
    raise exception 'FALHOU F1: o rollback deixou pedido, parcela, sequence ou função da T1a';
  end if;
  select string_agg(table_name || '.' || column_name, ', ') into m from information_schema.columns
   where (table_schema = 'organizacao' and table_name = 'empresas_grupo'
          and column_name in ('modo_omie', 'pipefy_sync', 'conta_corrente_padrao'))
      or (table_schema = 'receita' and table_name = 'fat_servicos'
          and column_name in ('codigo', 'id_tributacao', 'tem_tributacao'));  -- conta_corrente_padrao dela é da F1
  if m is not null then
    raise exception 'FALHOU F1: o rollback deixou coluna nova: %', m;
  end if;
  -- Volta ao estado da F1: as 18 empresas, 16 ativas, fatura_por nulo; os objetos da F1 seguem de pé.
  select string_agg(apelido || ':' || ativa::text || ':' || coalesce(fatura_por, '-'), ',' order by apelido collate "C") into m
    from organizacao.empresas_grupo;
  if m <> 'AGRO:true:-,BPO:true:-,DOC:true:-,MAROX:true:-,NEO:true:-,PAC:true:-,PAC SP:true:-,PAI:false:-,'
          'PARTNERS:true:-,PAT:true:-,PCC:true:-,PGE:true:-,PIS:true:-,PMC:true:-,PMN:false:-,PNC:true:-,PRJ:true:-,'
          'ROIT:true:-' then
    raise exception 'FALHOU F2: depois do rollback as empresas não são as da F1: %', m;
  end if;
  if to_regclass('receita.fat_donos') is null or to_regclass('receita.fat_eventos') is null
     or to_regclass('receita.fat_servicos') is null
     or (select count(*) from ops.areas where slug like 'faturamento%') <> 3 then
    raise exception 'FALHOU F3: o rollback da T1a levou junto algo da F1';
  end if;
  select count(*) into n from receita.fat_servicos where sincronizado_em = timestamptz '2026-10-15 11:50:00-03';
  if n <> 0 then raise exception 'FALHOU F4: o rollback da semente deixou % serviços do E0', n; end if;
  if md5(
       coalesce((select string_agg(role || '|' || area || '|' || allowed, ',' order by role, area) from ops.role_areas), '')
    || '#' || coalesce((select string_agg(area || '|' || permission_key, ',' order by area, permission_key) from ops.area_chaves), '')
    || '#' || coalesce((select string_agg(key || '|' || label || '|' || is_system, ',' order by key) from ops.roles), '')
    || '#' || coalesce((select string_agg(slug || '|' || nome || '|' || escopo || '|' || ativa, ',' order by slug) from ops.areas), '')
    || '#' || coalesce((select string_agg(user_id || '|' || role, ',' order by user_id, role) from ops.user_roles), '')
    || '#' || coalesce((select string_agg(user_id || '|' || area || '|' || allowed, ',' order by user_id, area) from ops.usuario_areas), '')
    || '#' || coalesce((select string_agg(user_id || '|' || permission_key || '|' || allowed, ',' order by user_id, permission_key) from ops.usuario_chaves), ''))
     <> current_setting('ensaio.acesso_antes') then
    raise exception 'FALHOU F5: depois do rollback o modelo de acesso não é o de antes';
  end if;
end $f$;

rollback;
