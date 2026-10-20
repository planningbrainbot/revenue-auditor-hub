-- Gate da revisão do Portal de Faturamento (20/10/2026): migration 20261020220000_portal_faturamento_revisao.sql.
-- Rollback: supabase/rollback/20261020220000_portal_faturamento_revisao_rollback.sql.
-- Revisões: e1/revisao-banco-seguranca.md (achados 1 a 14) e e1/revisao-app-conector.md (A1, A2, M1 a M5, B2). Cada
-- prova da revisão está aqui e agora falha do jeito certo (o comentário de cada teste diz o que a revisão viu antes).
--
-- Transação que termina em ROLLBACK. Resposta [] = tudo passou; falha = HTTP 400 com o código (FALHOU Xn). Antes de
-- aplicar: e1/ensaio.py com --migration e --rollback. Depois: --vazio (o bloco Z só confere quando o rollback rodou).
-- Medição: e1/medir_t1b.py com este gate (o último bloco devolve os tempos).
-- Pessoas de teste criadas DENTRO da transação (00000000-0000-4000-9100-0000000000xx, @ensaio.invalid):
--   a1, b1 donos da DOC (b1 com substituto x1) · x1, s1 solicitantes da DOC · g1 gestor da DOC · dp dono da PIS sem pedido
--   t1 tesouraria de todas · t2 tesouraria só da PIS · c1 controladoria de todas · cp controladoria só da PAC
--   z1 só a porta · ad admin do Brain (NÃO ativador) · pd controladoria de todas e ativador (só nesta transação)
-- Número de pedido de uma sequence de ensaio (FAT-1997-…): a de produção não é gasta.

begin;

-- @@MIGRATION@@

-- 0. Ferramentas e massa ------------------------------------------------------------------------------------------
create function pg_temp.u(_n text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-9100-0000000000' || case _n
    when 'a1' then 'a1' when 'b1' then 'b1' when 'x1' then 'e2' when 's1' then '51' when 'g1' then '61' when 'dp' then '63'
    when 't1' then '81' when 't2' then '82' when 'c1' then '91' when 'cp' then '92' when 'z1' then 'e1' when 'ad' then 'ad'
    when 'pd' then 'aa' end)::uuid
$$;
create function pg_temp.como(_n text) returns void language plpgsql as $$
begin
  if _n = 'postgres' then
    perform set_config('role', 'none', true); perform set_config('request.jwt.claims', '', true);
  elsif _n = 'conector' then
    perform set_config('role', 'service_role', true); perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  elsif _n = 'anon' then
    perform set_config('role', 'anon', true); perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    if auth.uid() is distinct from pg_temp.u(_n) then raise exception 'ENSAIO INVÁLIDO: uid não trocou para %', _n; end if;
  end if;
end $$;
create function pg_temp.erro(_sql text, _code text, _rotulo text) returns text language plpgsql as $$
declare st text; msg text; det text;
begin
  begin
    execute _sql;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text, det = pg_exception_detail;
    if st <> _code then raise exception 'FALHOU %: esperava erro % e veio % (%)', _rotulo, _code, st, msg; end if;
    return msg || ' | ' || coalesce(det, '');
  end;
  raise exception 'FALHOU %: passou e devia falhar com %', _rotulo, _code;
end $$;
create function pg_temp.guarda(_nome text, _id uuid) returns void language sql as $$
  select set_config('ens.p_' || _nome, _id::text, true) $$;
create function pg_temp.p(_nome text) returns uuid language sql stable as $$
  select nullif(current_setting('ens.p_' || _nome, true), '')::uuid $$;
create function pg_temp.svc(_emissora uuid) returns uuid language sql stable as $$
  select s.id from receita.fat_servicos s where s.emissora_id = _emissora and s.ativo and s.no_omie and s.tem_tributacao
   order by s.codigo_omie limit 1 $$;
create function pg_temp.dados(_emissora uuid, _dono text) returns jsonb language sql stable as $$
  select jsonb_build_object('emissora_id', _emissora, 'dono_id', pg_temp.u(_dono), 'tomador_documento', '11.222.333/0001-81',
    'tomador_nome', 'CLIENTE ENSAIO REVISAO LTDA', 'emails_envio', jsonb_build_array('fin@cliente-ensaio.com.br'),
    'projeto', 'Ensaio revisão', 'servico_id', pg_temp.svc(_emissora), 'descricao_nf', 'Serviço de ensaio', 'valor', 100.00,
    'forma', 'parcelado', 'parcelas', 3, 'primeiro_vencimento', '2026-11-13', 'documento', 'nf', 'meio', 'pix',
    'observacoes', 'ensaio da revisão') $$;
-- Cria (e envia) como "quem"; volta como postgres.
create function pg_temp.criar(_nome text, _quem text, _d jsonb, _enviar boolean) returns text language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.como(_quem);
  r := ops.fat_pedido_salvar(null, _d);
  perform pg_temp.guarda(_nome, (r ->> 'id')::uuid);
  if _enviar then r := ops.fat_pedido_enviar((r ->> 'id')::uuid); end if;
  perform pg_temp.como('postgres');
  return r ->> 'status';
end $$;
-- Conector: reserva tudo, devolve a pendente o que não é o alvo, e devolve o item reservado (fica processando).
create function pg_temp.reservar(_origem uuid, _operacao text) returns jsonb language plpgsql as $$
declare r jsonb; i jsonb; alvo jsonb;
begin
  perform pg_temp.como('conector');
  r := ops.fat_conector_envio_proximos(100);
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = _origem and i ->> 'operacao' = _operacao and alvo is null then alvo := i;
    else perform ops.fat_conector_envio_resultado((i ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
    end if;
  end loop;
  perform pg_temp.como('postgres');
  if alvo is null then raise exception 'FALHOU OMIE: % de % não ficou disponível na fila', _operacao, _origem; end if;
  return alvo;
end $$;
create function pg_temp.omie(_origem uuid, _operacao text, _status text, _codigos jsonb default '{}',
                             _erro text default null) returns jsonb language plpgsql as $$
declare alvo jsonb := pg_temp.reservar(_origem, _operacao); res jsonb;
begin
  perform pg_temp.como('conector');
  res := ops.fat_conector_envio_resultado((alvo ->> 'id')::uuid, _status, jsonb_build_object('ensaio', true), _erro, _codigos,
                                          (alvo ->> 'reserva')::uuid);
  perform pg_temp.como('postgres');
  return res;
end $$;
create function pg_temp.status(_nome text) returns text language sql stable as $$
  select p.status from receita.fat_pedidos p where p.id = pg_temp.p(_nome) $$;
create function pg_temp.medir(_rotulo text, _quem text, _sql text, _limite_ms numeric) returns numeric language plpgsql as $$
declare t0 timestamptz; ms numeric; r jsonb;
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

create sequence receita.fat_ensaio_seq;
alter table receita.fat_pedidos
  alter column numero set default ('FAT-1997-' || lpad(nextval('receita.fat_ensaio_seq')::text, 6, '0'));
insert into auth.users (id, email) select pg_temp.u(n), 'rev2.' || n || '@ensaio.invalid'
  from unnest(array['a1','b1','x1','s1','g1','dp','t1','t2','c1','cp','z1','ad','pd']) n;
insert into public.profiles (user_id, nome, email, ativo) select pg_temp.u(n), 'Rev ' || upper(n), 'rev2.' || n || '@ensaio.invalid', true
  from unnest(array['a1','b1','x1','s1','g1','dp','t1','t2','c1','cp','z1','ad','pd']) n;
insert into public.produto_acesso (user_id, produto) select pg_temp.u(n), 'ops'
  from unnest(array['a1','b1','x1','s1','g1','dp','t1','t2','c1','cp','z1','ad','pd']) n;
insert into ops.usuario_areas (user_id, area, allowed) select pg_temp.u(n), 'faturamento', true
  from unnest(array['a1','b1','x1','s1','g1','dp','z1']) n;
insert into ops.usuario_chaves (user_id, permission_key, allowed) select pg_temp.u(n), 'view.faturamento', true
  from unnest(array['a1','b1','x1','s1','g1','dp','z1']) n;
insert into ops.user_roles (user_id, role) values
  (pg_temp.u('t1'), 'fat_tesouraria'), (pg_temp.u('t2'), 'fat_tesouraria'), (pg_temp.u('c1'), 'fat_controladoria'),
  (pg_temp.u('cp'), 'fat_controladoria'), (pg_temp.u('pd'), 'fat_controladoria'), (pg_temp.u('ad'), 'admin');
insert into ops.usuario_escopo (user_id, todas_unidades, todas_empresas) values
  (pg_temp.u('t1'), false, true), (pg_temp.u('t2'), false, false), (pg_temp.u('c1'), false, true),
  (pg_temp.u('cp'), false, false), (pg_temp.u('pd'), false, true), (pg_temp.u('ad'), true, true);
insert into ops.usuario_empresas (user_id, empresa_id) values
  (pg_temp.u('t2'), '92eabf46-07a2-44c6-8f23-b7588e89314e'), (pg_temp.u('cp'), '8cdf5de7-683f-4d8e-a194-f303677ac6ea');
insert into receita.fat_donos (emissora_id, user_id, papel, substituto_id) values
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('a1'), 'dono', null),
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('b1'), 'dono', pg_temp.u('x1')),
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('x1'), 'solicitante', null),
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('s1'), 'solicitante', null),
  ('c243e5e4-8309-43e6-ac33-146b9771a44e', pg_temp.u('g1'), 'gestor', null),
  ('92eabf46-07a2-44c6-8f23-b7588e89314e', pg_temp.u('dp'), 'dono', null);
insert into receita.fat_ativadores (user_id, motivo) values (pg_temp.u('pd'), 'ensaio do gate da revisão');
do $base$
begin
  perform set_config('ens.doc', 'c243e5e4-8309-43e6-ac33-146b9771a44e', true);
  perform set_config('ens.pac', '8cdf5de7-683f-4d8e-a194-f303677ac6ea', true);
  -- Linha de base: as filas de produção sem trabalho processável (se houver, o teste R5c só não confere o "falso").
  perform set_config('ens.base_trabalho', integracoes.fat_tem_trabalho()::text, true);
end $base$;

-- A. Estrutura e privilégios das peças novas ------------------------------------------------------------------------
do $a$
declare
  f regprocedure;
  q text;
begin
  -- A1. Ativadores: só o Pedro (mais a pessoa de ensaio desta transação); ninguém de fora lê.
  if (select count(*) from receita.fat_ativadores a join auth.users u on u.id = a.user_id
       where lower(u.email) = 'pedro.luca@planning.com.br') <> 1
     or (select count(*) from receita.fat_ativadores where user_id <> pg_temp.u('pd')) <> 1 then
    raise exception 'FALHOU A1: a lista de ativadores não é só o Pedro';
  end if;
  if has_table_privilege('authenticated', 'receita.fat_ativadores', 'select') or has_table_privilege('service_role', 'receita.fat_ativadores', 'select')
     or has_table_privilege('authenticated', 'integracoes.fat_omie_reservaveis', 'select')
     or has_table_privilege('service_role', 'integracoes.fat_pipefy_reservaveis', 'select') then
    raise exception 'FALHOU A1: ativadores ou visões das filas legíveis de fora';
  end if;
  -- A2. Passagens e funções novas do conector: só service_role; authenticated e anon recebem 42501.
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where (s.nspname, p.proname) in (('ops', 'fat_conector_envio_resultado'), ('ops', 'fat_conector_pipefy_resultado'),
                   ('ops', 'fat_conector_emissora_bloquear'), ('integracoes', 'fat_tem_trabalho'),
                   ('integracoes', 'fat_emissora_bloquear')) loop
    if not has_function_privilege('service_role', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
       or has_function_privilege('anon', f, 'execute')
       or exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.oid = f and x.grantee = 0) then
      raise exception 'FALHOU A2: acesso de % fora de "só service_role"', f;
    end if;
  end loop;
  foreach q in array array[
    $s$select ops.fat_conector_emissora_bloquear('c243e5e4-8309-43e6-ac33-146b9771a44e', now() + interval '5 minutes', 'x')$s$,
    $s$select ops.fat_conector_envio_resultado(gen_random_uuid(), 'ok', null, null, '{}', gen_random_uuid())$s$,
    $s$select ops.fat_conector_pipefy_resultado(gen_random_uuid(), 'ok', null, null, null, gen_random_uuid())$s$] loop
    perform pg_temp.como('a1'); perform pg_temp.erro(q, '42501', 'A2 authenticated: ' || q);
    perform pg_temp.como('anon'); perform pg_temp.erro(q, '42501', 'A2 anon: ' || q);
    perform pg_temp.como('postgres'); perform pg_temp.erro(q, '42501', 'A2 postgres sem SET ROLE: ' || q);
  end loop;
  -- A3. Assinaturas antigas sumiram; o cron usa a regra única.
  if to_regprocedure('ops.fat_conector_envio_resultado(uuid, text, jsonb, text, jsonb)') is not null
     or to_regprocedure('integracoes.pipefy_envio_resultado(uuid, text, jsonb, text, text)') is not null then
    raise exception 'FALHOU A3: sobrou assinatura antiga';
  end if;
  if not exists (select 1 from cron.job where jobname = 'faturamento-omie-fila' and command like '%integracoes.fat_tem_trabalho()%') then
    raise exception 'FALHOU A3: o job da fila não usa fat_tem_trabalho';
  end if;
end $a$;

-- R5. Achado 4: envios mortos (roda primeiro, com as filas ainda limpas) ----------------------------------------------
do $r5$
declare
  doc uuid := current_setting('ens.doc')::uuid;
  r jsonb; i jsonb; m text;
begin
  -- R5a. Erro no garantir_cliente: o incluir_os fica bloqueado (antes: pendente para sempre); descartado, fecha tudo.
  perform pg_temp.criar('P4', 'a1', pg_temp.dados(doc, 'a1'), true);
  perform pg_temp.omie(pg_temp.p('P4'), 'garantir_cliente', 'erro', '{}', 'Omie recusou o cliente.');
  select string_agg(x.operacao || ':' || x.status, ',' order by x.operacao) into m from integracoes.omie_envios x where x.origem_id = pg_temp.p('P4');
  if m <> 'garantir_cliente:erro,incluir_os:bloqueado' then raise exception 'FALHOU R5a: fila do P4 depois do erro = %', m; end if;
  perform pg_temp.como('t1'); perform ops.fat_pedido_devolver(pg_temp.p('P4'), 'Cliente errado.');
  perform pg_temp.como('a1'); perform ops.fat_pedido_descartar(pg_temp.p('P4'));
  perform pg_temp.como('postgres');
  select string_agg(x.operacao || ':' || x.status, ',' order by x.operacao) into m from integracoes.omie_envios x where x.origem_id = pg_temp.p('P4');
  if pg_temp.status('P4') <> 'cancelado' or m <> 'garantir_cliente:erro,incluir_os:cancelado' then
    raise exception 'FALHOU R5a (antes B39 "incluir_os:pendente"): P4 % | %', pg_temp.status('P4'), m;
  end if;
  if exists (select 1 from integracoes.pipefy_envios x where x.origem_id = pg_temp.p('P4') and x.status in ('pendente', 'erro'))
     or exists (select 1 from integracoes.notificacoes n where n.pedido_id = pg_temp.p('P4') and n.status = 'pendente') then
    raise exception 'FALHOU R5a: cancelado deixou Pipefy ou e-mail esperando';
  end if;
  if not exists (select 1 from integracoes.notificacoes n where n.pedido_id = pg_temp.p('P4') and n.status = 'cancelado') then
    raise exception 'FALHOU R5a: nenhuma notificação do P4 foi marcada cancelada';
  end if;
  -- R5b. Pipefy em erro: os seguintes esperam (não reserváveis) e a tesouraria reenvia (antes: nenhuma RPC).
  perform pg_temp.criar('P2', 'a1', pg_temp.dados(doc, 'a1'), true);
  perform pg_temp.omie(pg_temp.p('P2'), 'garantir_cliente', 'simulado', '{}');
  perform pg_temp.omie(pg_temp.p('P2'), 'incluir_os', 'simulado', '{}');
  perform pg_temp.como('conector');
  r := ops.fat_conector_pipefy_proximos(100);
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = pg_temp.p('P2') then
      perform ops.fat_conector_pipefy_resultado((i ->> 'id')::uuid, 'erro', null, 'O e-mail do solicitante não está na Table Colaboradores.', null, (i ->> 'reserva')::uuid);
    else
      perform ops.fat_conector_pipefy_resultado((i ->> 'id')::uuid, 'simulado', null, null, null, (i ->> 'reserva')::uuid);
    end if;
  end loop;
  perform pg_temp.como('postgres');
  if exists (select 1 from integracoes.fat_pipefy_reservaveis v join integracoes.pipefy_envios e on e.id = v.id where e.origem_id = pg_temp.p('P2')) then
    raise exception 'FALHOU R5b: envio do Pipefy atrás de um erro ficou reservável';
  end if;
  -- R5c. O cron não acorda à toa (antes B40/D03: o predicado do cron dava verdadeiro).
  if current_setting('ens.base_trabalho') = 'false' and integracoes.fat_tem_trabalho() then
    raise exception 'FALHOU R5c: fat_tem_trabalho verdadeiro só com envios mortos';
  end if;
  perform pg_temp.como('a1');
  perform pg_temp.erro(format($q$select ops.fat_tesouraria_acao(%L, 'reenviar_pipefy')$q$, pg_temp.p('P2')), '42501', 'R5b dono reenvia o Pipefy');
  perform pg_temp.como('t1');
  r := ops.fat_tesouraria_acao(pg_temp.p('P2'), 'reenviar_pipefy');
  if (r ->> 'reenfileirados')::int <> 1 then raise exception 'FALHOU R5b: reenviar o Pipefy devolveu %', r; end if;
  perform pg_temp.como('postgres');
  if not exists (select 1 from integracoes.fat_pipefy_reservaveis v join integracoes.pipefy_envios e on e.id = v.id
                  where e.origem_id = pg_temp.p('P2') and e.operacao = 'criar_card') then
    raise exception 'FALHOU R5b: o criar_card reenviado não voltou à fila';
  end if;
  -- R5d. Pedir cancelamento com o faturamento em curso (antes B33: OK, e o faturar_os ficava pendente para sempre).
  perform pg_temp.criar('P5', 'a1', pg_temp.dados(doc, 'a1'), true);
  perform pg_temp.omie(pg_temp.p('P5'), 'garantir_cliente', 'simulado', '{}');
  perform pg_temp.omie(pg_temp.p('P5'), 'incluir_os', 'simulado', '{}');
  perform pg_temp.como('t1'); perform ops.fat_tesouraria_acao(pg_temp.p('P5'), 'faturar');
  perform pg_temp.como('a1');
  m := pg_temp.erro(format($q$select ops.fat_pedido_cancelar(%L, 'desistiu')$q$, pg_temp.p('P5')), '55000', 'R5d cancelar faturando');
  perform pg_temp.como('postgres');
end $r5$;

-- R2. Achados A2 e 5: quem liga a gravação e o Pipefy é a lista de ativadores ----------------------------------------
do $r2$
declare doc uuid := current_setting('ens.doc')::uuid; r jsonb;
begin
  perform pg_temp.como('ad');   -- antes E01: o admin ligava a gravação
  perform pg_temp.erro(format($q$select ops.fat_emissora_config(%L, 'gravar')$q$, doc), '42501', 'R2 admin não ativador liga gravar');
  perform pg_temp.erro(format($q$select ops.fat_emissora_config(%L, null, true)$q$, doc), '42501', 'R2 admin liga o Pipefy');
  if (ops.fat_config() ->> 'pode_gravar_omie')::boolean then raise exception 'FALHOU R2: pode_gravar_omie para o admin'; end if;
  perform pg_temp.como('c1');   -- antes T16: a controladoria ligava o Pipefy
  perform pg_temp.erro(format($q$select ops.fat_emissora_config(%L, null, true)$q$, doc), '42501', 'R2 controladoria liga o Pipefy');
  perform pg_temp.como('pd');
  r := ops.fat_emissora_config(doc, 'gravar', true);
  if r ->> 'modo_omie' <> 'gravar' or not (r ->> 'pipefy_sync')::boolean then raise exception 'FALHOU R2: ativador não ligou: %', r; end if;
  if not (ops.fat_config() ->> 'pode_ligar_pipefy')::boolean then raise exception 'FALHOU R2: pode_ligar_pipefy do ativador'; end if;
  perform pg_temp.como('c1');   -- desligar a controladoria faz
  r := ops.fat_emissora_config(doc, 'simular', false);
  if r ->> 'modo_omie' <> 'simular' or (r ->> 'pipefy_sync')::boolean then raise exception 'FALHOU R2: a controladoria não desligou: %', r; end if;
  perform pg_temp.como('postgres');
end $r2$;

-- R1. Achado 1, A1, M2, M4: o freio do simular segura o que já está na fila ------------------------------------------
do $r1$
declare
  doc uuid := current_setting('ens.doc')::uuid;
  alvo jsonb; m text; r jsonb;
  svc uuid := pg_temp.svc(current_setting('ens.doc')::uuid);
begin
  -- R1a. Enfileirado em gravar, a emissora volta para simular: sai como simular e "ok" é recusado (antes E04/E05).
  perform pg_temp.como('pd'); perform ops.fat_emissora_config(doc, 'gravar');
  perform pg_temp.criar('P6', 'a1', pg_temp.dados(doc, 'a1'), true);
  if (select string_agg(distinct modo, ',') from integracoes.omie_envios where origem_id = pg_temp.p('P6')) <> 'gravar' then
    raise exception 'FALHOU R1a: P6 não entrou na fila em gravar';
  end if;
  perform pg_temp.como('c1'); perform ops.fat_emissora_config(doc, 'simular');
  alvo := pg_temp.reservar(pg_temp.p('P6'), 'garantir_cliente');
  if alvo ->> 'modo' <> 'simular' or alvo #>> '{emissora,modo_omie}' <> 'simular' then
    raise exception 'FALHOU R1a (antes "modo gravar"): reserva entregou %', alvo - 'payload';
  end if;
  perform pg_temp.como('conector');
  perform pg_temp.erro(format($q$select ops.fat_conector_envio_resultado(%L, 'ok', '{}', null, '{"codigo_cliente_omie": 999002}')$q$, alvo ->> 'id'),
                       '22023', 'R1a ok de escrita em simulação');
  perform ops.fat_conector_envio_resultado((alvo ->> 'id')::uuid, 'simulado', null, null, '{}', (alvo ->> 'reserva')::uuid);
  -- R1b. Reservado em gravar e a emissora vai para simular no meio: "ok" recusado; volta para a fila e sai simulado.
  perform pg_temp.como('pd'); perform ops.fat_emissora_config(doc, 'gravar');
  perform pg_temp.criar('P7', 'a1', pg_temp.dados(doc, 'a1'), true);
  alvo := pg_temp.reservar(pg_temp.p('P7'), 'garantir_cliente');
  if alvo ->> 'modo' <> 'gravar' then raise exception 'FALHOU R1b: reserva com a emissora em gravar saiu %', alvo ->> 'modo'; end if;
  perform pg_temp.como('c1'); perform ops.fat_emissora_config(doc, 'simular');
  perform pg_temp.como('conector');
  perform pg_temp.erro(format($q$select ops.fat_conector_envio_resultado(%L, 'ok', '{}', null, '{"codigo_cliente_omie": 1}')$q$, alvo ->> 'id'),
                       '22023', 'R1b ok com a emissora em simular agora');
  perform ops.fat_conector_envio_resultado((alvo ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
  alvo := pg_temp.reservar(pg_temp.p('P7'), 'garantir_cliente');
  if alvo ->> 'modo' <> 'simular' then raise exception 'FALHOU R1b: reenfileirado não saiu em simular'; end if;
  perform pg_temp.como('conector');
  perform ops.fat_conector_envio_resultado((alvo ->> 'id')::uuid, 'simulado', null, null, '{}', (alvo ->> 'reserva')::uuid);
  perform pg_temp.como('postgres');
  -- R1c. M2: reenviar renova a foto (a conta corrente corrigida na Configuração vale) e o modo.
  perform pg_temp.criar('P8', 'a1', pg_temp.dados(doc, 'a1'), true);
  perform pg_temp.omie(pg_temp.p('P8'), 'garantir_cliente', 'simulado', '{}');
  perform pg_temp.omie(pg_temp.p('P8'), 'incluir_os', 'erro', '{}', 'Falta a conta corrente do Omie da DOC: a controladoria escolhe em Configuração antes de gravar.');
  perform pg_temp.como('c1'); perform ops.fat_servico_padroes(svc, '1.01.85', 4242);
  perform pg_temp.como('a1'); perform ops.fat_pedido_reenviar(pg_temp.p('P8'));
  perform pg_temp.como('postgres');
  select x.payload #>> '{servico,conta_corrente}' || '|' || x.modo into m from integracoes.omie_envios x
   where x.origem_id = pg_temp.p('P8') and x.operacao = 'incluir_os';
  if m <> '4242|simular' then raise exception 'FALHOU R1c (antes: a foto antiga voltava): incluir_os reenviado = %', m; end if;
end $r1$;

-- R3. Achado 2 e M5: fat_tomador -----------------------------------------------------------------------------------
do $r3$
declare
  doc uuid := current_setting('ens.doc')::uuid;
  cpf text;
  r jsonb;
begin
  insert into ops.omie_contratos_servico (unidade, contrato_id, cnpj, numero, situacao, valor_mensal, vigencia_inicial, vigencia_final, sincronizado_em)
  values ('Rio de Janeiro', 'ensaio-revisao-1', '98.765.432/0001-98', 'ENS-R1', '10', 2500, '2026-01-01', null, now());
  select d into cpf from (select ops.qb_so_digitos(x.cnpj) d from ops.empresas x where nullif(btrim(x.razao_social), '') is not null) y
   where d ~ '^[0-9]{11}$' and receita.fat_documento_valido(d) limit 1;
  if cpf is null then raise exception 'ENSAIO INVÁLIDO: nenhum CPF válido com nome na base'; end if;
  -- R3a. Só a porta: recusado com e sem empresa (antes T31: devolvia contrato, valor e base).
  perform pg_temp.como('z1');
  perform pg_temp.erro($q$select ops.fat_tomador('98765432000198')$q$, '42501', 'R3a só a porta, sem empresa');
  perform pg_temp.erro(format($q$select ops.fat_tomador('98765432000198', %L)$q$, doc), '42501', 'R3a só a porta, com empresa');
  -- R3b. O aviso de contrato diz só a empresa.
  perform pg_temp.como('a1');
  r := ops.fat_tomador('98.765.432/0001-98', doc);
  if jsonb_array_length(r -> 'contratos_outra_emissora') <> 1 or r #>> '{contratos_outra_emissora,0,emissora,apelido}' <> 'PRJ'
     or r #> '{contratos_outra_emissora,0,numero}' <> 'null'::jsonb or r #> '{contratos_outra_emissora,0,valor_mensal}' <> 'null'::jsonb
     or r -> 'base' <> 'null'::jsonb then
    raise exception 'FALHOU R3b (antes: número e valor mensal): %', r -> 'contratos_outra_emissora';
  end if;
  -- R3c. Nome de pessoa física da base: só com papel na empresa (antes T38: com_nome 5 de 5 para quem só tinha a porta).
  if (ops.fat_tomador(cpf, doc) ->> 'nome') is null then raise exception 'FALHOU R3c: a dona da DOC não viu o nome do CPF'; end if;
  perform pg_temp.como('t1');
  if (ops.fat_tomador(cpf, doc) ->> 'nome') is not null or (ops.fat_tomador(cpf) ->> 'nome') is not null then
    raise exception 'FALHOU R3c: tesouraria sem papel viu o nome da pessoa física';
  end if;
  if (ops.fat_tomador('98765432000198') ->> 'valido')::boolean is not true then raise exception 'FALHOU R3c: tesouraria sem empresa'; end if;
  perform pg_temp.como('t2');
  if (ops.fat_tomador('98765432000198') ->> 'valido')::boolean is not true then raise exception 'FALHOU R3c: tesouraria da PIS sem empresa'; end if;
  perform pg_temp.como('postgres');
end $r3$;

-- R4. Achado 3: só a tesouraria refaz o faturamento, e a conferência fica ----------------------------------------------
do $r4$
declare doc uuid := current_setting('ens.doc')::uuid; m text; alvo jsonb;
begin
  perform pg_temp.criar('P1', 's1', pg_temp.dados(doc, 'b1'), true);
  perform pg_temp.como('b1'); perform ops.fat_pedido_aprovar(pg_temp.p('P1'));
  perform pg_temp.omie(pg_temp.p('P1'), 'garantir_cliente', 'simulado', '{}');
  perform pg_temp.omie(pg_temp.p('P1'), 'incluir_os', 'simulado', '{}');
  perform pg_temp.como('t1');
  perform ops.fat_tesouraria_acao(pg_temp.p('P1'), 'em_conferencia');
  perform ops.fat_tesouraria_acao(pg_temp.p('P1'), 'faturar');
  -- M4: o faturar leva a foto inteira, com o meio de pagamento.
  alvo := pg_temp.reservar(pg_temp.p('P1'), 'faturar_os');
  if alvo #>> '{payload,pedido,meio}' <> 'pix' then raise exception 'FALHOU R4 (M4): faturar_os sem pedido.meio'; end if;
  perform pg_temp.como('conector');
  perform ops.fat_conector_envio_resultado((alvo ->> 'id')::uuid, 'erro', null, 'Omie recusou o faturamento.', '{}', (alvo ->> 'reserva')::uuid);
  perform pg_temp.como('s1');   -- antes B29: o solicitante reenviava o faturar
  m := pg_temp.erro(format('select ops.fat_pedido_reenviar(%L)', pg_temp.p('P1')), '42501', 'R4 solicitante refaz o faturar');
  if m not like 'Quem refaz o faturamento é a tesouraria.%' then raise exception 'FALHOU R4: mensagem %', m; end if;
  perform pg_temp.como('b1');
  perform pg_temp.erro(format('select ops.fat_pedido_reenviar(%L)', pg_temp.p('P1')), '42501', 'R4 dono refaz o faturar');
  perform pg_temp.como('t1');
  perform ops.fat_pedido_reenviar(pg_temp.p('P1'));
  perform pg_temp.como('postgres');
  if (select conferido_por from receita.fat_pedidos where id = pg_temp.p('P1')) is distinct from pg_temp.u('t1') then
    raise exception 'FALHOU R4 (antes B30: conferido_por apagado): a conferência sumiu no reenvio';
  end if;
  perform pg_temp.omie(pg_temp.p('P1'), 'faturar_os', 'simulado', '{}');
  if pg_temp.status('P1') <> 'faturado' then raise exception 'FALHOU R4: reenvio da tesouraria não faturou (%)', pg_temp.status('P1'); end if;
end $r4$;

-- R6. Achado 5: Pipefy de pedido simulado nunca grava ---------------------------------------------------------------
do $r6$
declare doc uuid := current_setting('ens.doc')::uuid; r jsonb; i jsonb; achou boolean := false;
begin
  perform pg_temp.como('pd'); perform ops.fat_emissora_config(doc, null, true);   -- Pipefy ligado, DOC em simular
  perform pg_temp.criar('P9', 'a1', pg_temp.dados(doc, 'a1'), true);
  perform pg_temp.como('conector');
  r := ops.fat_conector_pipefy_proximos(100);
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = pg_temp.p('P9') then
      achou := true;
      if (i ->> 'pipefy_sync')::boolean then raise exception 'FALHOU R6 (antes: gravava card real): pipefy_sync verdadeiro com a DOC em simulação'; end if;
      perform pg_temp.erro(format($q$select ops.fat_conector_pipefy_resultado(%L, 'ok', null, null, '123')$q$, i ->> 'id'), '22023', 'R6 ok do Pipefy em simulação');
    end if;
    perform ops.fat_conector_pipefy_resultado((i ->> 'id')::uuid, 'simulado', null, null, null, (i ->> 'reserva')::uuid);
  end loop;
  if not achou then raise exception 'FALHOU R6: criar_card do P9 não saiu'; end if;
  -- Com a DOC em gravar, o pedido simulado (P2) também não grava; um pedido novo grava.
  perform pg_temp.como('pd'); perform ops.fat_emissora_config(doc, 'gravar');
  perform pg_temp.criar('P10', 'a1', pg_temp.dados(doc, 'a1'), true);
  perform pg_temp.como('conector');
  r := ops.fat_conector_pipefy_proximos(100);
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'origem_id')::uuid = pg_temp.p('P2') and (i ->> 'pipefy_sync')::boolean then
      raise exception 'FALHOU R6: pedido simulado com pipefy_sync verdadeiro';
    end if;
    if (i ->> 'origem_id')::uuid = pg_temp.p('P10') and not (i ->> 'pipefy_sync')::boolean then
      raise exception 'FALHOU R6: pedido em gravar com Pipefy ligado saiu em simulação';
    end if;
    perform ops.fat_conector_pipefy_resultado((i ->> 'id')::uuid, 'pendente', null, null, null, (i ->> 'reserva')::uuid);
  end loop;
  perform pg_temp.como('c1'); perform ops.fat_emissora_config(doc, 'simular', false);
  perform pg_temp.como('postgres');
end $r6$;

-- R7. M1, M3, achado 10: uma rodada por emissora, prazo e ficha da reserva, bloqueio pela edge ----------------------------
do $r7$
declare
  doc uuid := current_setting('ens.doc')::uuid;
  pac uuid := current_setting('ens.pac')::uuid;
  r jsonb; i jsonb; doc_env jsonb; reserva_velha uuid; reserva_nova uuid;
begin
  insert into receita.fat_donos (emissora_id, user_id, papel) values (pac, pg_temp.u('a1'), 'dono');
  perform pg_temp.criar('PX', 'a1', pg_temp.dados(doc, 'a1'), true);
  perform pg_temp.criar('PY', 'a1', pg_temp.dados(pac, 'a1'), true);
  -- R7a. A DOC em curso não sai para outra rodada; a PAC sai.
  doc_env := pg_temp.reservar(pg_temp.p('PX'), 'garantir_cliente');           -- fica processando
  reserva_velha := (doc_env ->> 'reserva')::uuid;
  perform pg_temp.como('conector');
  r := ops.fat_conector_envio_proximos(100);
  if exists (select 1 from jsonb_array_elements(r) x where (x #>> '{emissora,id}')::uuid = doc) then
    raise exception 'FALHOU R7a (M1): a DOC saiu para outra rodada com envio dela em curso';
  end if;
  if not exists (select 1 from jsonb_array_elements(r) x where (x ->> 'origem_id')::uuid = pg_temp.p('PY')) then
    raise exception 'FALHOU R7a: a PAC não seguiu';
  end if;
  for i in select * from jsonb_array_elements(r) loop
    perform ops.fat_conector_envio_resultado((i ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
  end loop;
  -- R7b. Prazo vencido: volta, sai de novo com ficha nova, e o resultado da ficha velha é recusado (antes: aceito).
  perform pg_temp.como('postgres');
  update integracoes.omie_envios set reservado_ate = now() - interval '1 minute' where id = (doc_env ->> 'id')::uuid;
  doc_env := pg_temp.reservar(pg_temp.p('PX'), 'garantir_cliente');
  reserva_nova := (doc_env ->> 'reserva')::uuid;
  if reserva_nova is null or reserva_nova = reserva_velha then raise exception 'FALHOU R7b: a reserva não trocou de ficha'; end if;
  perform pg_temp.como('conector');
  perform pg_temp.erro(format($q$select ops.fat_conector_envio_resultado(%L, 'simulado', null, null, '{}', %L)$q$, doc_env ->> 'id', reserva_velha),
                       '55000', 'R7b resultado da ficha vencida');
  perform ops.fat_conector_envio_resultado((doc_env ->> 'id')::uuid, 'simulado', null, null, '{}', reserva_nova);
  -- R7c. A edge grava o bloqueio (425) e a reserva pula a emissora até lá.
  perform pg_temp.erro(format($q$select ops.fat_conector_emissora_bloquear(%L, now() - interval '1 minute', 'x')$q$, pac), '22023', 'R7c bloqueio no passado');
  r := ops.fat_conector_emissora_bloquear(pac, now() + interval '5 minutes', 'O Omie da PAC bloqueou a chave por excesso de chamadas.');
  r := ops.fat_conector_envio_proximos(100);
  if exists (select 1 from jsonb_array_elements(r) x where (x #>> '{emissora,id}')::uuid = pac) then
    raise exception 'FALHOU R7c: a reserva entregou a PAC bloqueada';
  end if;
  for i in select * from jsonb_array_elements(r) loop
    perform ops.fat_conector_envio_resultado((i ->> 'id')::uuid, 'pendente', null, null, jsonb_build_object('tentar_em', now()));
  end loop;
  -- R7d. 403: a emissora fica bloqueada 1 h (antes M3: só a rodada parava); o reenvio depois da chave nova libera.
  perform pg_temp.omie(pg_temp.p('PX'), 'incluir_os', 'erro', '{"emissora_indisponivel": true}',
                       'A chave do Omie da DOC está suspensa: peça uma nova ao administrador da empresa no Omie.');
  perform pg_temp.como('postgres');
  if not exists (select 1 from integracoes.omie_emissora_estado s where s.emissora_id = doc and s.indisponivel
                    and s.bloqueada_ate between now() + interval '59 minutes' and now() + interval '61 minutes') then
    raise exception 'FALHOU R7d: 403 não bloqueou a DOC por 1 h';
  end if;
  perform pg_temp.como('a1'); perform ops.fat_pedido_reenviar(pg_temp.p('PX'));
  perform pg_temp.como('postgres');
  if exists (select 1 from integracoes.omie_emissora_estado s where s.emissora_id = doc and s.bloqueada_ate > now()) then
    raise exception 'FALHOU R7d: o reenvio não liberou a DOC';
  end if;
  update integracoes.omie_emissora_estado set bloqueada_ate = null where emissora_id = pac;
end $r7$;

-- R8. Baixos: eventos, notificação, trava de chave, escrita direta, pessoas, autocadastro -----------------------------------
do $r8$
declare
  doc uuid := current_setting('ens.doc')::uuid;
  pac uuid := current_setting('ens.pac')::uuid;
  r jsonb; i jsonb; alvo jsonb; n int;
begin
  -- R8a. Achado 7: o gestor não lê pela tabela o evento do rascunho alheio (antes T10: 1 linha com documento e e-mails).
  perform pg_temp.criar('RD', 's1', pg_temp.dados(doc, 'b1'), false);
  perform pg_temp.como('g1');
  select count(*) into n from receita.fat_eventos where entidade_id = pg_temp.p('RD');
  if n <> 0 then raise exception 'FALHOU R8a: gestor leu % eventos do rascunho alheio', n; end if;
  perform pg_temp.como('s1');
  select count(*) into n from receita.fat_eventos where entidade_id = pg_temp.p('RD');
  if n < 1 then raise exception 'FALHOU R8a: o autor não lê o evento do próprio rascunho'; end if;
  -- R8b. Achado 12 e B2: erro do Omie de emissora em simulação gera e-mail simulado, e "enviado" é recusado (antes B43).
  perform pg_temp.criar('PN', 'a1', pg_temp.dados(doc, 'a1'), true);
  perform pg_temp.omie(pg_temp.p('PN'), 'garantir_cliente', 'erro', '{}', 'Omie recusou o cliente.');
  perform pg_temp.como('postgres');
  if not exists (select 1 from integracoes.notificacoes x where x.pedido_id = pg_temp.p('PN') and x.evento = 'erro_omie'
                    and (x.dados ->> 'simulacao')::boolean) then
    raise exception 'FALHOU R8b (B2): erro do Omie da DOC em simulação sem a marca de simulação';
  end if;
  perform pg_temp.como('conector');
  r := ops.fat_conector_notificacoes_proximos(100);
  for i in select * from jsonb_array_elements(r) loop
    if (i ->> 'pedido_id')::uuid = pg_temp.p('PN') then
      perform pg_temp.erro(format($q$select ops.fat_conector_notificacoes_resultado(%L, 'enviado', 'a@b.com', 'a', 'b')$q$, i ->> 'id'), '22023', 'R8b enviado de simulado');
      perform pg_temp.erro(format($q$select ops.fat_conector_notificacoes_resultado(%L, 'simulado', null, 'a', 'b', null, '{"x": {"api_key": "ENSAIO"}}')$q$, i ->> 'id'), '22023', 'R8b chave aninhada na notificação');
    end if;
    perform ops.fat_conector_notificacoes_resultado((i ->> 'id')::uuid, 'simulado', null, 'a', 'b');
  end loop;
  -- R8c. Achado 9: chave em qualquer nível do JSON é recusada (antes E06: aceita).
  perform pg_temp.como('a1'); perform ops.fat_pedido_reenviar(pg_temp.p('PN'));
  alvo := pg_temp.reservar(pg_temp.p('PN'), 'garantir_cliente');
  perform pg_temp.como('conector');
  perform pg_temp.erro(format($q$select ops.fat_conector_envio_resultado(%L, 'simulado', '{"chamada": {"app_key": "ENSAIO-NAO-E-CHAVE", "app_secret": "ENSAIO"}}')$q$, alvo ->> 'id'),
                       '23514', 'R8c chave aninhada na resposta do Omie');
  perform ops.fat_conector_envio_resultado((alvo ->> 'id')::uuid, 'simulado', null, null, '{}', (alvo ->> 'reserva')::uuid);
  r := ops.fat_conector_pipefy_proximos(100);
  for i in select * from jsonb_array_elements(r) loop
    perform pg_temp.erro(format($q$select ops.fat_conector_pipefy_resultado(%L, 'simulado', '{"x": {"token": "ENSAIO"}}')$q$, i ->> 'id'), '23514', 'R8c token aninhado no Pipefy');
    perform ops.fat_conector_pipefy_resultado((i ->> 'id')::uuid, 'simulado', null, null, null, (i ->> 'reserva')::uuid);
  end loop;
  -- R8d. Achado 11: o service_role não muda a situação nem insere pedido direto (antes B16: mudava sem evento).
  perform pg_temp.erro(format($q$update receita.fat_pedidos set status = 'recebido' where id = %L$q$, pg_temp.p('PN')), '42501', 'R8d update direto');
  perform pg_temp.erro(format($q$insert into receita.fat_pedidos (emissora_id, solicitante_id, status) values (%L, %L, 'faturado')$q$, doc, pg_temp.u('a1')), '42501', 'R8d insert direto');
  -- R8e. Achado 13: a controladoria com recorte (só PAC) não recebe a lista inteira de pessoas.
  perform pg_temp.como('cp');
  r := ops.fat_config();
  perform pg_temp.como('c1');
  if jsonb_array_length(r -> 'pessoas_ativas') >= jsonb_array_length(ops.fat_config() -> 'pessoas_ativas') then
    raise exception 'FALHOU R8e: controladoria só da PAC recebeu a lista inteira de pessoas';
  end if;
  -- R8f. Achado 6: a controladoria pode se cadastrar dona, e o evento diz que foi autocadastro.
  r := ops.fat_dono_salvar(jsonb_build_object('emissora_id', doc, 'user_id', pg_temp.u('c1'), 'papel', 'dono'));
  perform pg_temp.como('postgres');
  if not exists (select 1 from receita.fat_eventos v where v.entidade = 'dono' and v.entidade_id = (r ->> 'id')::uuid
                    and (v.diff ->> 'autocadastro')::boolean and v.autor_id = pg_temp.u('c1')) then
    raise exception 'FALHOU R8f: o autocadastro de dono não ficou marcado no evento';
  end if;
end $r8$;

-- T. Achado 8: a lista não varre tudo (6.000 pedidos: 5.000 da DOC e 1.000 da PAC) -------------------------------------
insert into receita.fat_pedidos
  (numero, emissora_id, tomador_tipo, tomador_documento, tomador_nome, servico_id, descricao_nf, valor, forma, parcelas,
   primeiro_vencimento, competencia, documento, meio, observacoes, projeto, emails_envio, dono_id, solicitante_id,
   enviado_por, enviado_em, na_fila_em, status, status_em, motivo_status)
select 'FAT-1996-' || lpad(g::text, 6, '0'), e.id, 'pj', '11222333000181', 'Cliente ' || g, pg_temp.svc(e.id),
       'Descrição', 100 + g, 'avulso', 1, current_date + (g % 40), date_trunc('month', current_date)::date, 'nf', 'boleto',
       'Observação', 'Projeto ' || (g % 50), array['financeiro@cliente.com.br'], pg_temp.u('a1'), pg_temp.u('a1'),
       pg_temp.u('a1'), now(), now(), (array['aguardando_ok', 'na_fila_omie', 'erro_omie', 'os_criada', 'em_conferencia'])[1 + g % 5],
       now(), 'ensaio'
  from generate_series(1, 6000) g
  cross join lateral (select case when g <= 5000 then 'c243e5e4-8309-43e6-ac33-146b9771a44e'::uuid
                                  else '8cdf5de7-683f-4d8e-a194-f303677ac6ea'::uuid end as id) e;
insert into receita.fat_pedido_parcelas (pedido_id, n, vencimento, valor)
select p.id, 1, p.primeiro_vencimento, p.valor from receita.fat_pedidos p where p.numero like 'FAT-1996-%';

do $t$
declare q text;
begin
  -- Quem não tem pedido nenhum (dono da PIS) não paga a lista inteira (antes C03: 359 ms).
  perform pg_temp.medir('6000 dono sem pedido: lista', 'dp', $q$select ops.fat_pedidos('{}')$q$, 100);
  perform pg_temp.medir('6000 dono sem pedido: resumo', 'dp', 'select ops.fat_resumo()', 100);
  foreach q in array array[$q$select ops.fat_pedidos('{}')$q$, $q$select ops.fat_pedidos('{"pagina": 100}')$q$,
                           $q$select ops.fat_pedidos('{"busca": "Cliente 19"}')$q$, 'select ops.fat_resumo()',
                           'select ops.fat_contexto()', 'select ops.fat_fila_tesouraria()'] loop
    perform pg_temp.medir('6000 tesouraria: ' || q, 't1', q, 1000);
  end loop;
  perform pg_temp.medir('6000 gestor DOC: lista', 'g1', $q$select ops.fat_pedidos('{}')$q$, 1000);
  perform pg_temp.medir('6000 dono DOC: lista', 'a1', $q$select ops.fat_pedidos('{}')$q$, 1000);
  perform pg_temp.como('dp');
  if (ops.fat_pedidos('{}') ->> 'total_recorte')::int <> 0 then raise exception 'FALHOU T: o dono da PIS viu pedidos'; end if;
  perform pg_temp.como('t1');
  if (ops.fat_pedidos('{}') ->> 'total_recorte')::int < 6000 then raise exception 'FALHOU T: a tesouraria não viu os 6.000'; end if;
  perform pg_temp.como('postgres');
end $t$;

-- Z. Rollback -----------------------------------------------------------------------------------------------------
set constraints all immediate;

-- @@ROLLBACK@@

do $z$
begin
  if to_regclass('receita.fat_ativadores') is not null then
    return;  -- rodado depois de aplicar (--vazio)
  end if;
  if to_regclass('integracoes.fat_omie_reservaveis') is not null or to_regprocedure('integracoes.fat_tem_trabalho()') is not null
     or to_regprocedure('ops.fat_conector_envio_resultado(uuid, text, jsonb, text, jsonb)') is null
     or to_regprocedure('ops.fat_conector_envio_resultado(uuid, text, jsonb, text, jsonb, uuid)') is not null
     or exists (select 1 from cron.job where jobname = 'faturamento-omie-fila' and command like '%fat_tem_trabalho%')
     or not has_table_privilege('service_role', 'receita.fat_pedidos', 'insert') then
    raise exception 'FALHOU Z1: o rollback não devolveu o estado de antes da revisão';
  end if;
end $z$;

do $fim$
begin
  if current_setting('ens.medir', true) = 'sim' then
    raise exception 'MEDIDAS:%', current_setting('ens.tempos', true);
  end if;
end $fim$;

rollback;
