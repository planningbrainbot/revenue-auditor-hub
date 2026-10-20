-- Gate dos ajustes da T1b (20/10/2026): passagem do conector em ops e CNPJ alfanumérico.
-- Migration: 20261020170000_portal_faturamento_t1b_ajustes.sql. Rollback: supabase/rollback/20261020170000_…_rollback.sql.
--
-- Transação que termina em ROLLBACK: nada sobrevive. Resposta [] = todos os blocos passaram; falha volta como HTTP 400
-- com o código (FALHOU Xn). Antes de aplicar: e1/ensaio.py com --migration e --rollback. Depois de aplicar: --vazio
-- (o bloco Z só confere quando o rollback rodou). Pré-requisito: T1b (20261020120000) aplicada.
-- Pessoa de teste criada DENTRO da transação: a1, dona da DOC (00000000-0000-4000-8000-0000000000a1, @ensaio.invalid).
-- Número de pedido de uma sequence de ensaio (FAT-1999-…): não gasta a de produção.

begin;

-- @@MIGRATION@@

-- 0. Ferramentas e massa ------------------------------------------------------------------------------------------
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
  elsif _n = 'a1' then
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
  else
    raise exception 'ENSAIO INVÁLIDO: papel %', _n;
  end if;
end $$;

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

create sequence receita.fat_ensaio_seq;
alter table receita.fat_pedidos
  alter column numero set default ('FAT-1999-' || lpad(nextval('receita.fat_ensaio_seq')::text, 6, '0'));
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'ensaio.ajustes.a1@ensaio.invalid');
insert into public.profiles (user_id, nome, email, ativo)
values ('00000000-0000-4000-8000-0000000000a1', 'Ensaio A1', 'ensaio.ajustes.a1@ensaio.invalid', true);
insert into public.produto_acesso (user_id, produto) values ('00000000-0000-4000-8000-0000000000a1', 'ops');
insert into ops.usuario_areas (user_id, area, allowed) values ('00000000-0000-4000-8000-0000000000a1', 'faturamento', true);
insert into ops.usuario_chaves (user_id, permission_key, allowed)
values ('00000000-0000-4000-8000-0000000000a1', 'view.faturamento', true);
insert into receita.fat_donos (emissora_id, user_id, papel)
values ('c243e5e4-8309-43e6-ac33-146b9771a44e', '00000000-0000-4000-8000-0000000000a1', 'dono');

-- A. As 9 passagens do conector: só service_role ---------------------------------------------------------------------
do $a$
declare
  f regprocedure;
  n int;
  q text;
  nomes constant text[] := array['fat_conector_credencial', 'fat_conector_envio_proximos', 'fat_conector_envio_resultado',
    'fat_conector_status_aplicar', 'fat_conector_status_enfileirar', 'fat_conector_servicos_aplicar',
    'fat_conector_pipefy_proximos', 'fat_conector_pipefy_resultado', 'fat_receita_cnpj_gravar'];
  chamadas constant text[] := array[
    $s$select ops.fat_conector_credencial('c243e5e4-8309-43e6-ac33-146b9771a44e')$s$,
    'select ops.fat_conector_envio_proximos(1)',
    $s$select ops.fat_conector_envio_resultado(gen_random_uuid(), 'ok')$s$,
    $s$select ops.fat_conector_status_aplicar(gen_random_uuid(), '{}')$s$,
    'select ops.fat_conector_status_enfileirar()',
    $s$select ops.fat_conector_servicos_aplicar(gen_random_uuid(), '[]')$s$,
    'select ops.fat_conector_pipefy_proximos(1)',
    $s$select ops.fat_conector_pipefy_resultado(gen_random_uuid(), 'ok')$s$,
    $s$select ops.fat_receita_cnpj_gravar('12ABC34501DE35', '{"fonte": "x"}')$s$];
begin
  if current_user <> 'postgres' then raise exception 'ENSAIO INVÁLIDO: A roda como %', current_user; end if;
  select count(*) into n from pg_proc p where p.pronamespace = 'ops'::regnamespace and p.proname = any (nomes);
  if n <> 9 then raise exception 'FALHOU A1: % de 9 passagens', n; end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace = 'ops'::regnamespace and p.proname = any (nomes) loop
    if not (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
              from pg_proc p where p.oid = f) then
      raise exception 'FALHOU A1: % sem security definer ou search_path fixo', f;
    end if;
    if not has_function_privilege('service_role', f, 'execute') then raise exception 'FALHOU A1: service_role não executa %', f; end if;
    if has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = f and a.grantee = 0) then
      raise exception 'FALHOU A1: authenticated, anon ou public executa %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'receita.fat_documento_normalizar(text)', 'execute')
     or has_function_privilege('anon', 'receita.fat_documento_normalizar(text)', 'execute') then
    raise exception 'FALHOU A1: normalização executável de fora';
  end if;
  -- A2. Chamada de verdade: authenticated e anon recebem 42501 em todas; postgres sem SET ROLE também (conferência no corpo).
  foreach q in array chamadas loop
    perform pg_temp.como('a1');
    perform pg_temp.erro(q, '42501', 'A2 authenticated: ' || q);
    perform pg_temp.como('anon');
    perform pg_temp.erro(q, '42501', 'A2 anon: ' || q);
    perform pg_temp.como('postgres');
    perform pg_temp.erro(q, '42501', 'A2 postgres sem SET ROLE: ' || q);
  end loop;
end $a$;

-- B. As passagens funcionam para o service_role, ponta a ponta, com um CNPJ alfanumérico ------------------------------
do $b$
declare
  doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  svc uuid := (select s.id from receita.fat_servicos s where s.emissora_id = doc and s.ativo and s.no_omie and s.tem_tributacao
                order by s.codigo_omie limit 1);
  r jsonb;
  i jsonb;
  ped uuid;
  c jsonb;
  m text;
begin
  -- B1. A dona pede com o CNPJ alfanumérico digitado com máscara e minúsculas: grava normalizado, sem pendência.
  perform pg_temp.como('a1');
  r := ops.fat_pedido_salvar(null, jsonb_build_object(
         'emissora_id', doc, 'tomador_documento', '12.abc.345/01de-35', 'tomador_nome', 'EMPRESA ALFANUMERICA LTDA',
         'emails_envio', jsonb_build_array('fin@alfa.com.br'), 'projeto', 'Projeto alfanumérico', 'servico_id', svc,
         'descricao_nf', 'Serviço de ensaio', 'valor', 100.00, 'forma', 'avulso', 'primeiro_vencimento', '2026-11-10',
         'documento', 'nf', 'meio', 'pix', 'observacoes', 'Ensaio do CNPJ alfanumérico'));
  ped := (r ->> 'id')::uuid;
  perform set_config('ens.ped', ped::text, true);
  if jsonb_array_length(r -> 'pendencias') <> 0 then raise exception 'FALHOU B1: pendências %', r -> 'pendencias'; end if;
  r := ops.fat_pedido_enviar(ped);
  if r ->> 'status' <> 'na_fila_omie' then raise exception 'FALHOU B1: enviar devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if (select tomador_tipo || ':' || tomador_documento from receita.fat_pedidos where id = ped) <> 'pj:12ABC34501DE35' then
    raise exception 'FALHOU B1: documento gravado = %', (select tomador_documento from receita.fat_pedidos where id = ped);
  end if;
  -- B2. Credencial pela passagem (o valor não sai do bloco).
  perform pg_temp.como('conector');
  c := ops.fat_conector_credencial(doc);
  if coalesce(btrim(c ->> 'app_key'), '') = '' or coalesce(btrim(c ->> 'app_secret'), '') = '' then
    raise exception 'FALHOU B2: credencial pela passagem sem app_key/app_secret';
  end if;
  c := null;
  -- B3. Fila do Omie pela passagem: garantir_cliente (o vínculo aceita o documento alfanumérico), depois incluir_os.
  r := ops.fat_conector_envio_proximos(100);
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = ped and i ->> 'operacao' = 'garantir_cliente' then
      perform ops.fat_conector_envio_resultado((i ->> 'id')::uuid, 'simulado', null, null,
                '{"codigo_cliente_omie": 777, "cliente_existia": true, "codigo_cliente_integracao": "12ABC34501DE35"}');
    else
      perform ops.fat_conector_envio_resultado((i ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
    end if;
  end loop;
  r := ops.fat_conector_envio_proximos(100);
  m := null;
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = ped and i ->> 'operacao' = 'incluir_os' then
      if i #>> '{cliente_omie,codigo_cliente_omie}' <> '777' or i #>> '{payload,tomador,documento}' <> '12ABC34501DE35' then
        raise exception 'FALHOU B3: incluir_os sem o cliente do Omie ou com outro documento: %', i;
      end if;
      perform ops.fat_conector_envio_resultado((i ->> 'id')::uuid, 'simulado', null, null, '{"cliente_existe": true, "servico_existe": true}');
      m := 'ok';
    else
      perform ops.fat_conector_envio_resultado((i ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
    end if;
  end loop;
  if m is null then raise exception 'FALHOU B3: incluir_os não saiu pela passagem'; end if;
  -- B4. Pipefy, leitura de status, cron e catálogo pela passagem.
  r := ops.fat_conector_pipefy_proximos(100);
  select x into i from jsonb_array_elements(r) x where (x ->> 'origem_id')::uuid = ped;
  if i ->> 'operacao' <> 'criar_card' then raise exception 'FALHOU B4: Pipefy pela passagem = %', r; end if;
  for i in select * from jsonb_array_elements(r) loop
    perform ops.fat_conector_pipefy_resultado((i ->> 'id')::uuid, 'simulado', '{"fase": "SOLICITAÇÃO ABERTA"}', null, null);
  end loop;
  if ops.fat_conector_status_aplicar(ped, '{}') ->> 'ignorado' <> 'simulado' then raise exception 'FALHOU B4: status_aplicar'; end if;
  if not (ops.fat_conector_status_enfileirar(doc) ? 'enfileirados') then raise exception 'FALHOU B4: status_enfileirar'; end if;
  perform pg_temp.erro(format($q$select ops.fat_conector_servicos_aplicar(%L, '[]')$q$, doc), '22023', 'B4 catálogo vazio pela passagem');
  perform pg_temp.erro($q$select ops.fat_conector_envio_resultado(gen_random_uuid(), 'ok')$q$, 'P0002', 'B4 envio inexistente');
  -- B5. A server function da tela grava a consulta da CNPJá pela passagem, com o CNPJ alfanumérico.
  r := ops.fat_receita_cnpj_gravar('12.abc.345/01de-35', '{"situacao": "ativa", "fonte": "CNPJá aberta (ensaio)", "razao_social": "EMPRESA ALFANUMERICA LTDA", "uf": "sp"}');
  if r ->> 'cnpj' <> '12ABC34501DE35' or r ->> 'situacao' <> 'ATIVA' then raise exception 'FALHOU B5: gravar devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if (select status from receita.fat_pedidos where id = ped) <> 'simulado'
     or not exists (select 1 from integracoes.omie_vinculo_cliente v where v.emissora_id = doc and v.documento = '12ABC34501DE35') then
    raise exception 'FALHOU B: pedido em % ou sem vínculo alfanumérico', (select status from receita.fat_pedidos where id = ped);
  end if;
end $b$;

-- C. CNPJ alfanumérico (IN RFB 2.229/2024) -------------------------------------------------------------------------
do $c$
declare
  doc constant uuid := 'c243e5e4-8309-43e6-ac33-146b9771a44e';
  r jsonb;
  m text;
begin
  -- C1. O DV de 12ABC34501DE na mão: cada caractere vale ASCII − 48 (1, 2, A=17, B=18, C=19, 3, 4, 5, 0, 1, D=20, E=21).
  --     1º DV, pesos 5 4 3 2 9 8 7 6 5 4 3 2: soma 459; 459 mod 11 = 8; DV = 11 − 8 = 3.
  --     2º DV, pesos 6 5 4 3 2 9 8 7 6 5 4 3 2 (com o 3): soma 424; 424 mod 11 = 6; DV = 11 − 6 = 5. CNPJ: 12ABC34501DE35.
  if ascii('A') - 48 <> 17 or ascii('E') - 48 <> 21 or ascii('0') - 48 <> 0 then raise exception 'FALHOU C1: tabela ASCII'; end if;
  if 1*5 + 2*4 + 17*3 + 18*2 + 19*9 + 3*8 + 4*7 + 5*6 + 0*5 + 1*4 + 20*3 + 21*2 <> 459 or 459 % 11 <> 8
     or 1*6 + 2*5 + 17*4 + 18*3 + 19*2 + 3*9 + 4*8 + 5*7 + 0*6 + 1*5 + 20*4 + 21*3 + 3*2 <> 424 or 424 % 11 <> 6 then
    raise exception 'FALHOU C1: a conta do DV na mão não fecha';
  end if;
  -- C2. Validação: CNPJ numérico real (a DOC, 49.726.267/0001-50), alfanumérico de exemplo e um inválido de cada.
  if not receita.fat_documento_valido('49726267000150') then raise exception 'FALHOU C2: CNPJ numérico real recusado'; end if;
  if not receita.fat_documento_valido('12ABC34501DE35') then raise exception 'FALHOU C2: CNPJ alfanumérico de exemplo recusado'; end if;
  if receita.fat_documento_valido('49726267000151') then raise exception 'FALHOU C2: CNPJ numérico com DV errado aceito'; end if;
  if receita.fat_documento_valido('12ABC34501DE36') then raise exception 'FALHOU C2: CNPJ alfanumérico com DV errado aceito'; end if;
  if receita.fat_documento_valido('12ABC34501DEA5') or receita.fat_documento_valido('12abc34501de35')
     or receita.fat_documento_valido('5299822472A') or not receita.fat_documento_valido('52998224725')
     or receita.fat_documento_valido('AAAAAAAAAAAA00') then
    raise exception 'FALHOU C2: letra no DV, minúscula sem normalizar, CPF com letra ou CPF válido';
  end if;
  if receita.fat_documento_normalizar(' 12.abc.345/01de-35 ') <> '12ABC34501DE35'
     or receita.fat_documento_normalizar('49.726.267/0001-50') <> '49726267000150' or receita.fat_documento_normalizar(' - ') is not null then
    raise exception 'FALHOU C2: normalização';
  end if;
  -- C3. O tomador pela tela: valida, normaliza e explica o erro.
  perform pg_temp.como('a1');
  r := ops.fat_tomador('12.abc.345/01de-35', doc);
  if not (r ->> 'valido')::boolean or r ->> 'tipo' <> 'pj' or r ->> 'documento' <> '12ABC34501DE35'
     or r ->> 'situacao' <> 'ATIVA' or r ->> 'nome' <> 'EMPRESA ALFANUMERICA LTDA' or r ->> 'emails' <> '["fin@alfa.com.br"]' then
    raise exception 'FALHOU C3: tomador alfanumérico = %', r;
  end if;
  if not (ops.fat_tomador('49.726.267/0001-50', doc) ->> 'valido')::boolean then raise exception 'FALHOU C3: CNPJ numérico real'; end if;
  if ops.fat_tomador('12ABC34501DE36', doc) ->> 'erro' <> 'CNPJ com dígito verificador errado.'
     or ops.fat_tomador('12ABC34501DEA5', doc) ->> 'erro' <> 'CNPJ: 12 letras ou dígitos e 2 dígitos verificadores no fim.'
     or ops.fat_tomador('529.982.247-2A', doc) ->> 'erro' <> 'CPF só tem dígitos.'
     or ops.fat_tomador('49726267000151', doc) ->> 'erro' <> 'CNPJ com dígito verificador errado.' then
    raise exception 'FALHOU C3: mensagens de documento inválido';
  end if;
  -- C4. Salvar: letra no DV e CPF com letra são recusados; DV errado salva e fica pendente.
  perform pg_temp.erro(format('select ops.fat_pedido_salvar(null, %L)', jsonb_build_object('emissora_id', doc, 'tomador_documento', '12ABC34501DE3A')),
                       '22023', 'C4 letra no DV');
  perform pg_temp.erro(format('select ops.fat_pedido_salvar(null, %L)', jsonb_build_object('emissora_id', doc, 'tomador_tipo', 'pf',
                         'tomador_documento', '5299822472A')), '22023', 'C4 CPF com letra');
  r := ops.fat_pedido_salvar(null, jsonb_build_object('emissora_id', doc, 'tomador_documento', '12ABC34501DE36'));
  if not exists (select 1 from jsonb_array_elements(r -> 'pendencias') x
                  where x ->> 'campo' = 'tomador_documento' and x ->> 'mensagem' = 'CNPJ com dígito verificador errado.') then
    raise exception 'FALHOU C4: DV errado sem pendência: %', r -> 'pendencias';
  end if;
  -- C5. Busca pela lista com pedaço do documento alfanumérico.
  if (ops.fat_pedidos('{"busca": "abc.345", "situacao": ["simulado"]}') ->> 'total')::int <> 1 then
    raise exception 'FALHOU C5: busca pelo documento alfanumérico';
  end if;
  -- C6. RF-P03 com CNPJ alfanumérico (cnpj_digitos do Omie tira as letras: o casamento é pelo documento normalizado).
  perform pg_temp.como('postgres');
  insert into ops.omie_contratos_servico (unidade, contrato_id, cnpj, numero, situacao, valor_mensal, vigencia_inicial, vigencia_final, sincronizado_em)
  values ('Rio de Janeiro', 'ensaio-ajustes-1', '12.ABC.345/01DE-35', 'ENS-A1', '10', 1000, '2026-01-01', null, now());
  perform pg_temp.como('a1');
  r := ops.fat_tomador('12abc34501de35', doc);
  if jsonb_array_length(r -> 'contratos_outra_emissora') <> 1 or r #>> '{contratos_outra_emissora,0,emissora,apelido}' <> 'PRJ' then
    raise exception 'FALHOU C6: aviso de contrato para CNPJ alfanumérico = %', r -> 'contratos_outra_emissora';
  end if;
  perform pg_temp.como('postgres');
end $c$;

-- Z. Rollback -----------------------------------------------------------------------------------------------------
set constraints all immediate;

-- @@ROLLBACK@@

do $z$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'receita'::regnamespace and p.proname = 'fat_documento_normalizar') then
    return;  -- rodado depois de aplicar (--vazio)
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'ops'::regnamespace
               and (p.proname like 'fat\_conector\_%' or p.proname = 'fat_receita_cnpj_gravar')) then
    raise exception 'FALHOU Z1: o rollback deixou as passagens do conector';
  end if;
  if receita.fat_documento_valido('12ABC34501DE35') or not receita.fat_documento_valido('49726267000150') then
    raise exception 'FALHOU Z1: a validação não voltou à da T1b';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'fat_pedidos_documento_tomador')) not like '%[0-9]{14}%'
     or to_regprocedure('ops.fat_contexto()') is null then
    raise exception 'FALHOU Z1: o rollback não devolveu a T1b';
  end if;
end $z$;

rollback;
