-- Ensaio de 20261020200000_portal_faturamento_notificacoes.sql (T6, 20/10/2026) e do rollback dela.
--
-- Uma transação que termina em ROLLBACK: nada sobrevive (nem os eventos e o papel de teste criados aqui). Cada teste
-- levanta exceção quando falha (FALHOU Nn). Como rodar: python3 -I e1/ensaio.py <este arquivo> --migration <migration>
-- --rollback <rollback>; depois de aplicar, com --vazio (o bloco R só confere quando o rollback entrou).
-- Amostra: o pedido mais antigo do portal (precisa existir um). As transições são eventos inseridos à mão em
-- receita.fat_eventos, como receita.fat_transicao grava; o pedido não muda. Pessoas: o Pedro (admin, tesouraria) e a
-- conta "Teste" (teste@planning.com.br) como substituta num papel de dono criado só dentro da transação.

begin;

select set_config('ensaio.outros_jobs', (
  select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
    from cron.job where jobname <> 'faturamento-omie-fila'), true);

-- @@MIGRATION@@

do $n$
declare
  _p receita.fat_pedidos;
  _pedro constant uuid := '5c4d0e46-fc33-4132-bcca-47c05ad001c7';
  _teste constant uuid := '55c21a76-52ca-47b4-b541-54e867aacbea';
  _e bigint;
  n int;
  r record;
begin
  -- N1. Estrutura e acesso.
  if to_regclass('integracoes.notificacoes') is null then raise exception 'FALHOU N1: fila ausente'; end if;
  if has_table_privilege('authenticated', 'integracoes.notificacoes', 'select')
     or has_table_privilege('anon', 'integracoes.notificacoes', 'select') then
    raise exception 'FALHOU N1: navegador lê a fila';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'integracoes.notificacoes'::regclass) then
    raise exception 'FALHOU N1: RLS desligada';
  end if;

  select * into _p from receita.fat_pedidos order by created_at limit 1;
  if _p.id is null then return; end if;
  -- Para o teste: o dono do pedido é o Pedro, com a conta Teste de substituta, e o Pedro é também o autor.
  update receita.fat_pedidos set dono_id = _pedro, solicitante_id = _pedro where id = _p.id;
  insert into receita.fat_donos (emissora_id, user_id, papel, substituto_id, ativo)
  values (_p.emissora_id, _pedro, 'dono', _teste, true)
  on conflict (emissora_id, user_id, papel) do update set ativo = true, substituto_id = _teste;

  -- N2. OK pendente: dono e substituto.
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, 'enviado', 'rascunho', 'aguardando_ok', '{}', _pedro) returning id into _e;
  select count(*) into n from integracoes.notificacoes
   where transicao_id = _e and evento = 'ok_pendente'
     and ((destinatario_id = _pedro and papel = 'dono') or (destinatario_id = _teste and papel = 'substituto'));
  if n <> 2 then raise exception 'FALHOU N2: OK pendente foi para % de 2 (dono e substituto)', n; end if;
  if exists (select 1 from integracoes.notificacoes where transicao_id = _e and status <> 'pendente') then
    raise exception 'FALHOU N2: notificação nova fora de pendente';
  end if;
  -- Sem linha ativa de dono: os gestores (nenhum na amostra = nenhuma notificação, e a transição segue).
  update receita.fat_donos set ativo = false where emissora_id = _p.emissora_id and user_id = _pedro and papel = 'dono';
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, 'enviado', 'devolvido', 'aguardando_ok', '{}', _pedro) returning id into _e;
  select count(*) into n from integracoes.notificacoes where transicao_id = _e and papel <> 'gestor';
  if n <> 0 then raise exception 'FALHOU N2: sem dono ativo, OK pendente foi para quem não é gestor'; end if;

  -- N3. Devolvido: o autor, com o motivo do evento.
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, 'devolvido', 'aguardando_ok', 'devolvido', '{"motivo":"Falta o projeto"}', _teste)
  returning id into _e;
  select * into r from integracoes.notificacoes where transicao_id = _e;
  if r.destinatario_id is distinct from _pedro or r.papel <> 'autor' or r.dados ->> 'motivo' <> 'Falta o projeto' then
    raise exception 'FALHOU N3: devolvido foi para % (%) com motivo %', r.destinatario_id, r.papel, r.dados ->> 'motivo';
  end if;
  if r.dados ? 'tomador_documento' or r.dados::text ~ '[0-9]{11,14}' and r.dados::text ~ _p.tomador_documento then
    raise exception 'FALHOU N3: documento do tomador nos dados da notificação';
  end if;

  -- N4. Faturado: dono e solicitante; a mesma pessoa recebe uma vez. A volta de em atraso não notifica.
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, 'faturado', 'os_criada', 'faturado', '{}', null) returning id into _e;
  select count(*) into n from integracoes.notificacoes where transicao_id = _e;
  if n <> 1 then raise exception 'FALHOU N4: faturado com dono = solicitante gerou % notificações (esperava 1)', n; end if;
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, 'faturado', 'em_atraso', 'faturado', '{}', null) returning id into _e;
  if exists (select 1 from integracoes.notificacoes where transicao_id = _e) then
    raise exception 'FALHOU N4: a volta de em atraso para faturado notificou';
  end if;

  -- N5. Em atraso: o dono.
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, 'em_atraso', 'faturado', 'em_atraso', '{}', null) returning id into _e;
  if (select count(*) from integracoes.notificacoes where transicao_id = _e and papel = 'dono' and destinatario_id = _pedro) <> 1 then
    raise exception 'FALHOU N5: em atraso não foi para o dono';
  end if;

  -- N6. Erro no Omie: o autor e a tesouraria da emissora (o Pedro é os dois: uma notificação, como autor).
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, 'omie_erro', 'na_fila_omie', 'erro_omie', '{"motivo":"Chave suspensa"}', null)
  returning id into _e;
  if (select count(*) from integracoes.notificacoes where transicao_id = _e and destinatario_id = _pedro and papel = 'autor') <> 1 then
    raise exception 'FALHOU N6: erro no Omie não foi para o autor';
  end if;
  if exists (select 1 from integracoes.notificacoes x where x.transicao_id = _e and x.papel = 'tesouraria'
              and not ops.can_user(x.destinatario_id, 'edit.faturamento_tesouraria')) then
    raise exception 'FALHOU N6: tesouraria sem a chave recebeu';
  end if;

  -- N7. Evento sem transição de situação (omie_cliente) e de outra entidade não notificam.
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _p.id, _p.emissora_id, 'omie_cliente', 'na_fila_omie', 'na_fila_omie', '{}', null) returning id into _e;
  if exists (select 1 from integracoes.notificacoes where transicao_id = _e) then raise exception 'FALHOU N7: evento sem transição notificou'; end if;
end $n$;

-- N8. O conector reserva e responde (service_role); o navegador não chama.
set local role service_role;
do $n8$
declare
  j jsonb;
  _id uuid;
begin
  j := ops.fat_conector_notificacoes_proximos(100);
  if jsonb_typeof(j) <> 'array' then raise exception 'FALHOU N8: reserva não devolveu lista'; end if;
  if jsonb_array_length(j) > 0 then
    _id := (j -> 0 ->> 'id')::uuid;
    if not (j -> 0 -> 'destinatario' ? 'email') then raise exception 'FALHOU N8: reserva sem o e-mail do destinatário'; end if;
    perform ops.fat_conector_notificacoes_resultado(_id, 'simulado', j -> 0 -> 'destinatario' ->> 'email', 'Assunto', '<p>Corpo</p>', null, '{"simulado":true}');
    if (select status from integracoes.notificacoes where id = _id) <> 'simulado' then raise exception 'FALHOU N8: resultado não gravou'; end if;
    begin
      perform ops.fat_conector_notificacoes_resultado(_id, 'enviado', 'x@y.com', null, null, null, null);
      raise exception 'FALHOU N8: respondeu duas vezes';
    exception when sqlstate '55000' then null;
    end;
  end if;
end $n8$;
reset role;
set local role authenticated;
do $n9$
begin
  begin
    perform ops.fat_conector_notificacoes_proximos(1);
    raise exception 'FALHOU N9: authenticated reservou notificação';
  exception when insufficient_privilege then null;
  end;
end $n9$;
reset role;

-- N10. O job da fila olha as três filas; os outros jobs não mudaram.
do $n10$
declare c text;
begin
  select command into c from cron.job where jobname = 'faturamento-omie-fila' and active;
  -- Desde a revisão de 20/10 o job pergunta integracoes.fat_tem_trabalho(): as filas olhadas estão no corpo dela.
  if (c || coalesce((select pg_get_functiondef(to_regprocedure('integracoes.fat_tem_trabalho()')) where to_regprocedure('integracoes.fat_tem_trabalho()') is not null), '')) not like '%integracoes.omie_envios%'
     or (c || coalesce((select pg_get_functiondef(to_regprocedure('integracoes.fat_tem_trabalho()')) where to_regprocedure('integracoes.fat_tem_trabalho()') is not null), '')) not like '%integracoes.pipefy_envios%'
     or (c || coalesce((select pg_get_functiondef(to_regprocedure('integracoes.fat_tem_trabalho()')) where to_regprocedure('integracoes.fat_tem_trabalho()') is not null), '')) not like '%integracoes.notificacoes%' then
    raise exception 'FALHOU N10: job da fila não olha as três filas';
  end if;
  execute 'explain ' || regexp_replace(btrim(c), ';\s*$', '');
  if (select coalesce(string_agg(jobname || '|' || schedule || '|' || md5(command) || '|' || active, ',' order by jobname), '')
        from cron.job where jobname <> 'faturamento-omie-fila') <> current_setting('ensaio.outros_jobs') then
    raise exception 'FALHOU N10: outro job do pg_cron mudou';
  end if;
end $n10$;

select set_config('ensaio.fila_antes_do_rollback', (to_regclass('integracoes.notificacoes') is not null)::text, true);

-- @@ROLLBACK@@

do $r$
begin
  if (to_regclass('integracoes.notificacoes') is not null)::text = current_setting('ensaio.fila_antes_do_rollback') then
    return;  -- --vazio: o rollback não entrou
  end if;
  if exists (select 1 from pg_trigger where tgname = 'fat_eventos_notificar') then raise exception 'FALHOU R1: gatilho sobrou'; end if;
  if exists (select 1 from cron.job where jobname = 'faturamento-omie-fila' and command like '%notificacoes%') then
    raise exception 'FALHOU R1: job da fila ainda olha as notificações';
  end if;
end $r$;

rollback;
