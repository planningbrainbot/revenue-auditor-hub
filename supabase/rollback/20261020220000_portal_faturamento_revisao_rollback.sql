-- Rollback da 20261020220000_portal_faturamento_revisao.sql (20/10/2026).
--
-- Volta o texto exato das funções de antes da revisão (pg_get_functiondef de 20/10), as assinaturas antigas dos
-- resultados do conector, o job da fila, a policy de fat_eventos, os checks das filas e os privilégios do service_role.
-- Envio bloqueado vira pendente e cancelado vira erro com o motivo (os status saem do check). A lista de ativadores some.
-- Ensaiado no gate supabase/gates/20261020_portal_faturamento_revisao.sql (bloco Z).

begin;

select cron.unschedule('faturamento-omie-fila')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-fila');
select cron.schedule('faturamento-omie-fila', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-omie',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-faturamento-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'faturamento_cron_secret')),
    body := '{"acao":"processar","origem":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
   where exists (
     select 1 from integracoes.omie_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'))
      or exists (
     select 1 from integracoes.pipefy_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'))
      or exists (
     select 1 from integracoes.notificacoes n
      where (n.status = 'pendente' and n.proxima_tentativa_em <= now())
         or (n.status = 'processando' and n.updated_at < now() - interval '15 minutes'));
$cron$);

drop policy fat_eventos_ler on receita.fat_eventos;
create policy fat_eventos_ler on receita.fat_eventos
  for select to authenticated
  using (receita.fat_ve_tudo(emissora_id) or receita.fat_tem_papel(emissora_id, array['gestor']));
drop function receita.fat_evento_visivel(text, uuid, uuid);

drop function ops.fat_conector_envio_resultado(uuid, text, jsonb, text, jsonb, uuid);
drop function integracoes.fat_envio_resultado(uuid, text, jsonb, text, jsonb, uuid);
drop function ops.fat_conector_pipefy_resultado(uuid, text, jsonb, text, text, uuid);
drop function integracoes.pipefy_envio_resultado(uuid, text, jsonb, text, text, uuid);
drop function ops.fat_conector_emissora_bloquear(uuid, timestamptz, text);
drop function integracoes.fat_emissora_bloquear(uuid, timestamptz, text);
drop function integracoes.fat_tem_trabalho();

-- Funções com o texto de antes da revisão

CREATE OR REPLACE FUNCTION receita.fat_acoes(_e receita.fat_escopo_t, _p receita.fat_pedidos)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  autor boolean := _p.solicitante_id = _e.uid;
  enviou boolean := _p.enviado_por is not distinct from _e.uid;
  dono boolean := _p.dono_id = _e.uid and _p.emissora_id = any (_e.dono);
  subst boolean := receita.fat_e_substituto(_e, _p);
  gestor boolean := _p.emissora_id = any (_e.gestor);
  tes boolean := _p.emissora_id = any (_e.tesouraria);
  pede boolean := _p.emissora_id = any (_e.papel);
  tem_os boolean := _p.omie_os_codigo is not null;
  rotulo text := receita.fat_status_rotulo(_p.status);
  apelido text := (select g.apelido from organizacao.empresas_grupo g where g.id = _p.emissora_id);
  faturando boolean;
  em_curso boolean;
  faturado_ok boolean;
  r jsonb := '{}'::jsonb;

  -- pode / não pode, com o código do motivo (42501 papel, 55000 situação)
  sim constant jsonb := '{"pode": true, "motivo": null, "codigo": null}';
begin
  select coalesce(bool_or(x.operacao = 'faturar_os' and x.status in ('pendente', 'processando')), false),
         coalesce(bool_or(x.status = 'processando'), false),
         coalesce(bool_or(x.operacao = 'faturar_os' and x.status = 'ok'), false)
    into faturando, em_curso, faturado_ok
    from integracoes.omie_envios x
   where x.origem = 'fat_pedido' and x.origem_id = _p.id;

  -- editar e enviar
  r := r || jsonb_build_object('editar', case
    when _p.status = 'rascunho' then case
      when not autor then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Só quem escreveu o rascunho mexe nele.')
      when not pede then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', format('Você não pede mais faturamento pela %s.', apelido))
      else sim end
    when _p.status = 'devolvido' then case
      when (autor and pede) or dono or gestor then sim
      else jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem corrige o devolvido é o autor, o dono ou o gestor.') end
    else jsonb_build_object('pode', false, 'codigo', '55000',
           'motivo', format('Pedido em %s: só volta a ser editável se for devolvido.', rotulo)) end);
  r := r || jsonb_build_object('enviar', r -> 'editar');

  -- descartar
  r := r || jsonb_build_object('descartar', case
    when _p.status not in ('rascunho', 'devolvido') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', format('Pedido em %s não se descarta.', rotulo))
    when not autor then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Só o autor descarta o pedido.')
    when tem_os then jsonb_build_object('pode', false, 'codigo', '55000',
           'motivo', format('A OS %s já existe no Omie da %s: peça o cancelamento.', _p.omie_os_codigo, apelido))
    else sim end);

  -- dar o OK
  r := r || jsonb_build_object('aprovar', case
    when _p.status <> 'aguardando_ok' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Só pedido Aguardando OK recebe o OK.')
    when autor or enviou then
      jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem enviou não dá o OK no próprio pedido.')
    when dono or subst or gestor then sim
    else jsonb_build_object('pode', false, 'codigo', '42501',
           'motivo', format('Só o dono, o substituto dele ou o gestor da %s dá o OK.', apelido)) end);

  -- devolver
  r := r || jsonb_build_object('devolver', case
    when _p.status = 'aguardando_ok' then case
      when dono or subst or gestor then sim
      else jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Antes do OK, quem devolve é o dono, o substituto ou o gestor.') end
    when _p.status in ('simulado', 'os_criada', 'em_conferencia', 'erro_omie') then case
      when not tes then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Depois do Omie, quem devolve é a tesouraria.')
      when faturando or em_curso then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Há um envio ao Omie em curso: espere a resposta.')
      else sim end
    else jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', format('Pedido em %s não se devolve.', rotulo)) end);

  -- reenviar
  r := r || jsonb_build_object('reenviar', case
    when _p.status <> 'erro_omie' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Só pedido com erro no Omie se reenvia.')
    when not (autor or enviou or dono or tes) then
      jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Reenvia o autor, o dono ou a tesouraria.')
    when em_curso then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Há um envio ao Omie em curso: espere a resposta.')
    else sim end);

  -- pedir cancelamento (dono, substituto, gestor) e confirmar (tesouraria)
  r := r || jsonb_build_object('pedir_cancelamento', case
    when _p.status = 'rascunho' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Rascunho se descarta, não se cancela.')
    when _p.status = 'cancelamento_pedido' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'O cancelamento já foi pedido.')
    when _p.status = 'cancelado' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Pedido já cancelado.')
    when dono or subst or gestor then sim
    else jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem pede o cancelamento é o dono, o substituto ou o gestor.') end);
  r := r || jsonb_build_object('confirmar_cancelamento', case
    when _p.status <> 'cancelamento_pedido' then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Não há cancelamento pedido.')
    when not tes then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem confirma o cancelamento é a tesouraria.')
    else sim end);

  -- tesouraria: conferir e faturar
  r := r || jsonb_build_object('conferir', case
    when _p.status = 'em_conferencia' then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Já está em conferência.')
    when _p.status not in ('os_criada', 'simulado') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Só dá para conferir depois de a OS existir no Omie (ou ser simulada).')
    when not tes then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem confere é a tesouraria.')
    else sim end);
  r := r || jsonb_build_object('faturar', case
    when faturado_ok or _p.status in ('faturado', 'em_atraso', 'recebido') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Pedido já faturado.')
    when _p.status not in ('os_criada', 'simulado', 'em_conferencia') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Só dá para faturar depois de a OS existir no Omie.')
    when not tes then jsonb_build_object('pode', false, 'codigo', '42501', 'motivo', 'Quem fatura é a tesouraria.')
    when faturando then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Faturando: espere a resposta do Omie.')
    when not tem_os and not _p.simulacao then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'O pedido ainda não tem OS no Omie.')
    else sim end);

  -- atualizar a situação no Omie (quem vê o pedido)
  r := r || jsonb_build_object('atualizar_status', case
    when _p.simulacao then jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Pedido simulado: não há OS no Omie para ler.')
    when not tem_os or _p.status not in ('os_criada', 'em_conferencia', 'faturado', 'em_atraso', 'recebido', 'cancelamento_pedido') then
      jsonb_build_object('pode', false, 'codigo', '55000', 'motivo', 'Ainda não há OS no Omie para ler.')
    else sim end);
  return r;
end $function$;

CREATE OR REPLACE FUNCTION receita.fat_transicao(p_pedido uuid, p_para text, p_motivo text DEFAULT NULL::text, p_evento text DEFAULT NULL::text, p_diff jsonb DEFAULT '{}'::jsonb)
 RETURNS receita.fat_pedidos
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  _p receita.fat_pedidos;
  _n receita.fat_pedidos;
  _motivo text := nullif(btrim(p_motivo), '');
begin
  select * into _p from receita.fat_pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_transicao_permitida(_p.status, p_para) then
    raise exception 'Pedido % está em %: não vai para %.', _p.numero, receita.fat_status_rotulo(_p.status),
      receita.fat_status_rotulo(p_para) using errcode = '55000';
  end if;
  if p_para in ('devolvido', 'cancelamento_pedido') and _motivo is null then
    perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo.'));
  end if;

  perform set_config('receita.fat_transicao', p_pedido::text, true);
  update receita.fat_pedidos
     set status = p_para,
         motivo_status = case when p_para = 'cancelado' then coalesce(_motivo, motivo_status) else _motivo end,
         status_em = now(),
         na_fila_em = case when p_para = 'na_fila_omie' and _p.status <> 'erro_omie' then now() else na_fila_em end,
         faturado_em = case when p_para = 'faturado' and faturado_em is null then now() else faturado_em end,
         conferido_por = case when p_para = 'em_conferencia' then auth.uid()
                              when p_para in ('devolvido', 'na_fila_omie') then null else conferido_por end
   where id = p_pedido
  returning * into _n;
  perform set_config('receita.fat_transicao', '', true);

  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _n.id, _n.emissora_id, coalesce(p_evento, p_para), _p.status, p_para,
          coalesce(p_diff, '{}'::jsonb)
            || case when _motivo is not null then jsonb_build_object('motivo', _motivo) else '{}'::jsonb end,
          auth.uid());

  -- Pipefy (decisão 4): o card nasce na primeira chegada à fila e anda a cada mudança depois disso. Sempre gravado; o
  -- conector decide pelo pipefy_sync da emissora se executa ou só monta.
  if p_para = 'na_fila_omie'
     and not exists (select 1 from integracoes.pipefy_envios x
                      where x.origem = 'fat_pedido' and x.origem_id = _n.id and x.operacao = 'criar_card') then
    insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao, payload)
    values (_n.emissora_id, 'fat_pedido', _n.id, 'criar_card',
            receita.fat_snapshot(_n.id) || jsonb_build_object(
              'status', p_para,
              'solicitante', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', u.email)
                                from public.profiles u where u.user_id = _n.solicitante_id),
              'dono', (select jsonb_build_object('id', u.user_id, 'nome', u.nome, 'email', u.email)
                         from public.profiles u where u.user_id = _n.dono_id)));
  elsif _n.na_fila_em is not null then
    insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao, payload)
    values (_n.emissora_id, 'fat_pedido', _n.id, 'mover_fase', jsonb_build_object(
      'versao', 1, 'de', _p.status, 'para', p_para, 'evento', coalesce(p_evento, p_para), 'motivo', _motivo,
      'pedido', jsonb_build_object('id', _n.id, 'numero', _n.numero, 'omie_os_codigo', _n.omie_os_codigo,
                                   'omie_nf_numero', _n.omie_nf_numero, 'omie_nf_link', _n.omie_nf_link,
                                   'omie_nf_emitida_em', _n.omie_nf_emitida_em)));
  end if;
  return _n;
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_pedido_reenviar(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _n int;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  perform receita.fat_exigir(_e, _p, 'reenviar');
  -- A mesma linha volta para a fila, com o mesmo código de integração: nunca uma segunda OS (CA-06, CA-12).
  update integracoes.omie_envios
     set status = 'pendente', proxima_tentativa_em = now(), tentativas = 0, erro_legivel = null
   where origem = 'fat_pedido' and origem_id = _p.id and status = 'erro'
     and operacao in ('garantir_cliente', 'incluir_os', 'alterar_os', 'faturar_os');
  get diagnostics _n = row_count;
  _p := receita.fat_transicao(_p.id, 'na_fila_omie', null, 'reenviado', jsonb_build_object('reenfileirados', _n));
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status, 'reenfileirados', _n);
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_tesouraria_acao(p_id uuid, p_acao text, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  _p receita.fat_pedidos;
  _modo text;
  _st text;
  _faturando boolean := false;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  select * into _p from receita.fat_pedidos where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = 'P0002'; end if;
  if not receita.fat_ve(_e, _p) then raise exception 'Este pedido não está no seu escopo.' using errcode = '42501'; end if;
  if not _p.emissora_id = any (_e.tesouraria) then
    raise exception 'Só a tesouraria desta empresa faz isso.' using errcode = '42501';
  end if;

  case p_acao
    when 'em_conferencia' then
      perform receita.fat_exigir(_e, _p, 'conferir');
      _p := receita.fat_transicao(_p.id, 'em_conferencia', null, 'conferencia');
    when 'devolver' then
      if nullif(btrim(p_motivo), '') is null then
        perform receita.fat_recusar(receita.fat_erro('motivo', 'Escreva o motivo da devolução.'));
      end if;
      perform receita.fat_exigir(_e, _p, 'devolver');
      _p := receita.fat_transicao(_p.id, 'devolvido', p_motivo, 'devolvido');
    when 'faturar' then
      perform receita.fat_exigir(_e, _p, 'faturar');
      select x.status into _st from integracoes.omie_envios x where x.operacao = 'faturar_os' and x.codigo_integracao = _p.numero;
      if _st = 'ok' then raise exception 'Pedido % já foi faturado no Omie.', _p.numero using errcode = '55000'; end if;
      select case when _p.simulacao then 'simular' else g.modo_omie end into _modo
        from organizacao.empresas_grupo g where g.id = _p.emissora_id;
      insert into integracoes.omie_envios as x
        (emissora_id, origem, origem_id, operacao, codigo_integracao, payload, modo, status, tentativas,
         proxima_tentativa_em, resposta, erro_legivel)
      values (_p.emissora_id, 'fat_pedido', _p.id, 'faturar_os', _p.numero,
              jsonb_build_object('versao', 1, 'pedido', jsonb_build_object('id', _p.id, 'numero', _p.numero),
                                 'emissora', jsonb_build_object('id', _p.emissora_id),
                                 'omie_os_codigo', _p.omie_os_codigo,
                                 'parcelas', (receita.fat_snapshot(_p.id) -> 'parcelas')),
              _modo, 'pendente', 0, now(), null, null)
      on conflict (operacao, codigo_integracao) do update
         set payload = excluded.payload, modo = excluded.modo, status = 'pendente', tentativas = 0,
             proxima_tentativa_em = now(), resposta = null, erro_legivel = null;
      perform receita.fat_evento_pedido(_p, 'faturar_pedido', jsonb_build_object('modo', _modo));
      _faturando := true;
    else
      perform receita.fat_recusar(receita.fat_erro('p_acao', 'Ação da tesouraria desconhecida (em_conferencia, faturar ou devolver).'));
  end case;
  return jsonb_build_object('id', _p.id, 'numero', _p.numero, 'status', _p.status, 'faturando', _faturando);
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_emissora_config(p_emissora uuid, p_modo_omie text DEFAULT NULL::text, p_pipefy_sync boolean DEFAULT NULL::boolean, p_fatura_por text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  g organizacao.empresas_grupo;
  n organizacao.empresas_grupo;
  _diff jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is null or not p_emissora = any (_e.controladoria) then
    raise exception 'Esta empresa não está no seu recorte da controladoria.' using errcode = '42501';
  end if;
  if p_modo_omie is not null and p_modo_omie not in ('simular', 'gravar') then
    perform receita.fat_recusar(receita.fat_erro('p_modo_omie', 'Use simular ou gravar.'));
  end if;
  if p_fatura_por is not null and p_fatura_por not in ('os', 'contrato', 'ambos') then
    perform receita.fat_recusar(receita.fat_erro('p_fatura_por', 'Use os, contrato ou ambos.'));
  end if;
  select * into g from organizacao.empresas_grupo where id = p_emissora for update;
  if p_modo_omie = 'gravar' and g.modo_omie <> 'gravar' then
    if not _e.admin then
      raise exception 'Só o administrador do Brain liga a gravação no Omie (trava da E1).' using errcode = '42501';
    end if;
    if not g.ativa or g.omie_credencial_ref is null
       or not exists (select 1 from vault.secrets v where v.name = g.omie_credencial_ref) then
      raise exception 'A % não tem chave do Omie no cofre.', g.apelido using errcode = '55000';
    end if;
  end if;
  update organizacao.empresas_grupo
     set modo_omie = coalesce(p_modo_omie, modo_omie), pipefy_sync = coalesce(p_pipefy_sync, pipefy_sync),
         fatura_por = coalesce(p_fatura_por, fatura_por)
   where id = p_emissora returning * into n;
  _diff := receita.fat_diff(to_jsonb(g), to_jsonb(n), array['modo_omie', 'pipefy_sync', 'fatura_por']);
  if _diff <> '{}'::jsonb then
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('emissora', n.id, n.id, 'configurado', g.modo_omie, n.modo_omie, _diff, auth.uid());
  end if;
  return jsonb_build_object('id', n.id, 'apelido', n.apelido, 'modo_omie', n.modo_omie, 'pipefy_sync', n.pipefy_sync,
                            'fatura_por', n.fatura_por);
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if cardinality(_e.controladoria) = 0 then
    raise exception 'Só a controladoria abre a configuração do faturamento.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'pode_gravar_omie', _e.admin,
    'emissoras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'apelido', g.apelido, 'razao_social', g.razao_social, 'cnpj', g.cnpj, 'ativa', g.ativa,
               'fatura_por', g.fatura_por, 'modo_omie', g.modo_omie, 'pipefy_sync', g.pipefy_sync,
               'conta_corrente_padrao', g.conta_corrente_padrao,
               'tem_chave', g.omie_credencial_ref is not null
                            and exists (select 1 from vault.secrets v where v.name = g.omie_credencial_ref),
               'tem_pedido', exists (select 1 from receita.fat_pedidos p where p.emissora_id = g.id),
               'omie', jsonb_build_object('indisponivel', coalesce(s.indisponivel, false), 'motivo', s.motivo,
                                          'bloqueada_ate', s.bloqueada_ate, 'ultimo_ok_em', s.ultimo_ok_em,
                                          'ultima_falha_em', s.ultima_falha_em),
               'pessoas', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', d.id, 'pessoa', receita.fat_pessoa(d.user_id), 'email', u.email, 'papel', d.papel,
                          'substituto', receita.fat_pessoa(d.substituto_id), 'ativo', d.ativo, 'desde', d.created_at,
                          'abre_faturamento', ops.can_user(d.user_id, 'view.faturamento'),
                          'aguardando_ok', case when d.papel = 'dono' then (
                            select count(*) from receita.fat_pedidos p
                             where p.emissora_id = g.id and p.dono_id = d.user_id and p.status = 'aguardando_ok') end)
                        order by d.papel, u.nome)
                   from receita.fat_donos d left join public.profiles u on u.user_id = d.user_id
                  where d.emissora_id = g.id), '[]'::jsonb),
               'contagem', (select jsonb_build_object(
                              'donos', count(*) filter (where d.papel = 'dono'),
                              'gestores', count(*) filter (where d.papel = 'gestor'),
                              'solicitantes', count(*) filter (where d.papel = 'solicitante'))
                              from receita.fat_donos d where d.emissora_id = g.id and d.ativo),
               'servicos', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', v.id, 'codigo_omie', v.codigo_omie, 'codigo', v.codigo, 'descricao', v.descricao,
                          'codigo_lc116', v.codigo_lc116, 'codigo_municipal', v.codigo_municipal,
                          'tem_tributacao', v.tem_tributacao, 'ativo', v.ativo, 'no_omie', v.no_omie,
                          'categoria_padrao', v.categoria_padrao, 'conta_corrente_padrao', v.conta_corrente_padrao,
                          'sincronizado_em', v.sincronizado_em) order by v.descricao)
                   from receita.fat_servicos v where v.emissora_id = g.id), '[]'::jsonb),
               'servicos_liberados', (select count(*) from receita.fat_servicos v
                                       where v.emissora_id = g.id and v.ativo and v.no_omie and v.tem_tributacao),
               'servicos_total', (select count(*) from receita.fat_servicos v where v.emissora_id = g.id),
               'sincronizacao', (select jsonb_build_object('status', x.status, 'erro_legivel', x.erro_legivel, 'em', x.updated_at)
                                   from integracoes.omie_envios x
                                  where x.origem = 'fat_emissora' and x.origem_id = g.id and x.operacao = 'sincronizar_servicos'))
             order by g.ativa desc, g.apelido)
        from organizacao.empresas_grupo g left join integracoes.omie_emissora_estado s on s.emissora_id = g.id
       where g.id = any (_e.controladoria)), '[]'::jsonb),
    'pessoas_ativas', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.user_id, 'nome', coalesce(nullif(btrim(u.nome), ''), u.email),
                                          'email', u.email, 'abre_faturamento', ops.can_user(u.user_id, 'view.faturamento'))
                       order by u.nome)
        from public.profiles u where u.ativo), '[]'::jsonb));
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_tomador(p_documento text, p_emissora uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  _doc text := coalesce(receita.fat_documento_normalizar(p_documento), '');
  _tipo text;
  rc integracoes.receita_cnpj;
  _b_id integer;
  _b_razao text;
  _b_uf text;
  _emails jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if p_emissora is not null and not p_emissora = any (_e.papel || _e.tesouraria || _e.controladoria) then
    raise exception 'Você não pede faturamento por esta empresa.' using errcode = '42501';
  end if;
  _tipo := case char_length(_doc) when 14 then 'pj' when 11 then 'pf' end;
  if _tipo is null or not receita.fat_documento_valido(_doc) then
    return jsonb_build_object('documento', _doc, 'tipo', _tipo, 'valido', false,
      'erro', case when _tipo is null then 'O documento precisa ter 11 dígitos (CPF) ou 14 caracteres (CNPJ).'
                   when _tipo = 'pf' and _doc ~ '[^0-9]' then 'CPF só tem dígitos.'
                   when _tipo = 'pj' and _doc !~ '^[0-9A-Z]{12}[0-9]{2}$' then 'CNPJ: 12 letras ou dígitos e 2 dígitos verificadores no fim.'
                   when _tipo = 'pf' then 'CPF com dígito verificador errado.' else 'CNPJ com dígito verificador errado.' end,
      'nome', null, 'nome_fonte', null, 'municipio', null, 'uf', null, 'situacao', null, 'situacao_desde', null,
      'situacao_fonte', null, 'situacao_consultada_em', null, 'consultar_receita', false, 'emails', '[]'::jsonb,
      'bloqueio', null, 'contratos_outra_emissora', '[]'::jsonb, 'contratos_lidos_em', null, 'base', null);
  end if;

  select * into rc from integracoes.receita_cnpj r where r.cnpj = _doc;
  select x.id, x.razao_social, x.uf into _b_id, _b_razao, _b_uf
    from ops.empresas x where (ops.qb_so_digitos(x.cnpj) = _doc or (_doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc)) order by x.id limit 1;

  select coalesce(jsonb_agg(m.email order by m.ordem, m.email), '[]'::jsonb) into _emails
    from (select e.email, min(e.ordem) as ordem
            from (select lower(btrim(u)) as email, 1 as ordem from unnest(rc.emails) u
                  union all
                  select lower(btrim(x.email_fiscal)), 2 from ops.empresas x
                   where (ops.qb_so_digitos(x.cnpj) = _doc or (_doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc)) and nullif(btrim(x.email_fiscal), '') is not null
                  union all
                  select u, 3 from receita.fat_pedidos p, unnest(p.emails_envio) u
                   where p.tomador_documento = _doc and receita.fat_ve(_e, p)) e
           where receita.fat_email_valido(e.email)
           group by e.email) m;

  return jsonb_build_object(
    'documento', _doc, 'tipo', _tipo, 'valido', true, 'erro', null,
    'nome', coalesce(rc.razao_social, _b_razao),
    'nome_fonte', case when rc.razao_social is not null then 'Receita' when _b_razao is not null then 'base de clientes' end,
    'municipio', rc.municipio, 'uf', coalesce(rc.uf, _b_uf),
    'situacao', rc.situacao, 'situacao_desde', rc.situacao_desde, 'situacao_fonte', rc.fonte,
    'situacao_consultada_em', rc.consultado_em,
    'consultar_receita', _tipo = 'pj' and (rc.cnpj is null or rc.consultado_em < now() - interval '30 days'),
    'emails', _emails,
    'bloqueio', case when receita.fat_bloqueio(_doc) is not null then jsonb_build_object('motivo', receita.fat_bloqueio(_doc)) end,
    'contratos_outra_emissora', receita.fat_contratos_outra_emissora(_doc, p_emissora),
    'contratos_lidos_em', (select max(k.sincronizado_em) from ops.omie_contratos_servico k),
    'base', case when _b_id is not null then jsonb_build_object('empresa_id', _b_id, 'razao_social', _b_razao, 'uf', _b_uf) end);
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_pedidos(p_filtro jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  _f jsonb := coalesce(p_filtro, '{}'::jsonb);
  _k text;
  _erros jsonb := '[]'::jsonb;
  _sit text[];
  _a_faturar boolean := false;
  _pend text;
  _emis uuid[];
  _dono uuid;
  _mes date;
  _fim date;
  _regua text;
  _sim boolean;
  _busca text;
  _busca_doc text;
  _ordem text;
  _dir text;
  _pag int;
  _pp int;
  _hoje date;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  _hoje := receita.fat_hoje();
  if jsonb_typeof(_f) <> 'object' then perform receita.fat_recusar(receita.fat_erro(null, 'p_filtro precisa ser um objeto.')); end if;

  for _k in select jsonb_object_keys(_f) loop
    begin
      case _k
        when 'situacao' then
          _sit := array(select jsonb_array_elements_text(_f -> 'situacao'));
          _a_faturar := 'a_faturar' = any (_sit);
          if exists (select 1 from unnest(_sit) s where s not in ('a_faturar', 'rascunho', 'aguardando_ok', 'devolvido',
               'na_fila_omie', 'simulado', 'erro_omie', 'os_criada', 'em_conferencia', 'faturado', 'recebido', 'em_atraso',
               'cancelamento_pedido', 'cancelado')) then raise exception 'situacao'; end if;
        when 'pendencia' then
          _pend := _f ->> 'pendencia';
          if _pend not in ('ok', 'devolvido', 'erro') then raise exception 'pendencia'; end if;
        when 'emissoras' then _emis := array(select (jsonb_array_elements_text(_f -> 'emissoras'))::uuid);
        when 'dono' then _dono := (_f ->> 'dono')::uuid;
        when 'mes' then _mes := to_date(_f ->> 'mes' || '-01', 'YYYY-MM-DD');
                        if _f ->> 'mes' !~ '^[0-9]{4}-[0-9]{2}$' then raise exception 'mes'; end if;
        when 'regua' then
          _regua := _f ->> 'regua';
          if _regua not in ('competencia', 'nota', 'pagamento', 'atraso') then raise exception 'regua'; end if;
        when 'simulacao' then _sim := (_f -> 'simulacao')::boolean;
        when 'busca' then _busca := nullif(btrim(_f ->> 'busca'), '');
        when 'ordem' then
          _ordem := _f ->> 'ordem';
          if _ordem not in ('atualizado', 'valor', 'vencimento', 'numero') then raise exception 'ordem'; end if;
        when 'direcao' then
          _dir := _f ->> 'direcao';
          if _dir not in ('asc', 'desc') then raise exception 'direcao'; end if;
        when 'pagina' then _pag := (_f ->> 'pagina')::int; if _pag < 1 then raise exception 'pagina'; end if;
        when 'por_pagina' then _pp := (_f ->> 'por_pagina')::int; if _pp not between 1 and 200 then raise exception 'por_pagina'; end if;
        else raise exception 'desconhecido';
      end case;
    exception when others then
      _erros := _erros || receita.fat_erro(_k, case when sqlerrm = 'desconhecido' then 'Filtro desconhecido.' else 'Valor inválido.' end);
    end;
  end loop;
  if _regua in ('competencia', 'nota', 'pagamento') and _mes is null then
    _erros := _erros || receita.fat_erro('mes', 'A régua pede o mês (AAAA-MM).');
  end if;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;

  _fim := (_mes + interval '1 month')::date;
  _ordem := coalesce(_ordem, 'atualizado');
  _dir := coalesce(_dir, case when _ordem = 'vencimento' then 'asc' else 'desc' end);
  _pag := coalesce(_pag, 1);
  _pp := coalesce(_pp, 50);
  _busca_doc := case when char_length(coalesce(receita.fat_documento_normalizar(_busca), '')) >= 3 then receita.fat_documento_normalizar(_busca) end;

  with filt as materialized (
    select p.id, p.numero, p.valor, p.updated_at, p.primeiro_vencimento, pc.pago_mes, pc.atraso
      from receita.fat_pedidos p
      left join lateral (
        select sum(x.valor) filter (where x.situacao = 'pago' and x.pago_em >= _mes and x.pago_em < _fim) as pago_mes,
               sum(x.valor) filter (where x.situacao not in ('pago', 'cancelado') and x.vencimento < _hoje) as atraso
          from receita.fat_pedido_parcelas x where x.pedido_id = p.id) pc on true
     where receita.fat_ve(_e, p)
       and (case when _sit is null then p.status <> 'cancelado'
                 else p.status = any (_sit)
                      or (_a_faturar and not p.simulacao
                          and p.status in ('aguardando_ok', 'na_fila_omie', 'erro_omie', 'os_criada', 'em_conferencia')) end)
       and (_pend is null
            or (_pend = 'ok' and receita.fat_pend_ok(_e, p))
            or (_pend = 'devolvido' and receita.fat_pend_devolvido(_e, p))
            or (_pend = 'erro' and receita.fat_pend_erro(_e, p)))
       and (_emis is null or p.emissora_id = any (_emis))
       and (_dono is null or p.dono_id = _dono)
       and (_sim is null or p.simulacao = _sim)
       and (_regua is null
            or (_regua = 'competencia' and p.competencia >= _mes and p.competencia < _fim)
            or (_regua = 'nota' and not p.simulacao and p.status <> 'cancelado' and p.faturado_em is not null
                and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date >= _mes
                and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date < _fim)
            or (_regua = 'pagamento' and not p.simulacao and pc.pago_mes is not null)
            or (_regua = 'atraso' and not p.simulacao and p.status in ('faturado', 'em_atraso') and pc.atraso is not null))
       and (_busca is null
            or p.numero ilike '%' || _busca || '%' or p.tomador_nome ilike '%' || _busca || '%'
            or p.projeto ilike '%' || _busca || '%'
            or (_busca_doc is not null and p.tomador_documento like '%' || _busca_doc || '%'))
  ), ordenado as (
    select f.*, row_number() over (order by
       case when _ordem = 'atualizado' and _dir = 'asc' then f.updated_at end asc,
       case when _ordem = 'atualizado' and _dir = 'desc' then f.updated_at end desc,
       case when _ordem = 'valor' and _dir = 'asc' then f.valor end asc nulls last,
       case when _ordem = 'valor' and _dir = 'desc' then f.valor end desc nulls last,
       case when _ordem = 'vencimento' and _dir = 'asc' then f.primeiro_vencimento end asc nulls last,
       case when _ordem = 'vencimento' and _dir = 'desc' then f.primeiro_vencimento end desc nulls last,
       case when _ordem = 'numero' and _dir = 'asc' then f.numero end asc,
       case when _ordem = 'numero' and _dir = 'desc' then f.numero end desc,
       f.numero desc) as ord
      from filt f
  ), pagina as (
    select o.* from ordenado o where o.ord > (_pag - 1) * _pp and o.ord <= _pag * _pp
  )
  select jsonb_build_object(
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'numero', p.numero, 'status', p.status, 'simulacao', p.simulacao,
               'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
               'tomador', jsonb_build_object('tipo', p.tomador_tipo, 'documento', p.tomador_documento, 'nome', p.tomador_nome),
               'projeto', p.projeto, 'valor', p.valor,
               'dono', receita.fat_pessoa(p.dono_id), 'solicitante', receita.fat_pessoa(p.solicitante_id),
               'primeiro_vencimento', p.primeiro_vencimento, 'competencia', p.competencia,
               'proximo_passo', receita.fat_proximo_passo(_e, p),
               'atualizado_em', p.updated_at,
               'pago_no_mes', case when _regua = 'pagamento' then f.pago_mes end,
               'em_atraso', case when _regua = 'atraso' then f.atraso end)
             order by f.ord)
        from pagina f
        join receita.fat_pedidos p on p.id = f.id
        join organizacao.empresas_grupo g on g.id = p.emissora_id), '[]'::jsonb),
    'total', (select count(*) from filt),
    'total_recorte', (select count(*) from receita.fat_pedidos p where receita.fat_ve(_e, p)),
    'soma', (select coalesce(sum(f.valor), 0) from filt f),
    'soma_parcelas', case when _regua = 'pagamento' then (select coalesce(sum(f.pago_mes), 0) from filt f)
                          when _regua = 'atraso' then (select coalesce(sum(f.atraso), 0) from filt f) end,
    'pagina', _pag, 'por_pagina', _pp)
  into _r;
  return _r;
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_resumo(p_periodo date DEFAULT NULL::date, p_emissoras uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  _hoje date;
  _mes date;
  _fim date;
  _rec uuid[];
  _sim text[];
  _estado text;
  _tipo text;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  _hoje := receita.fat_hoje();
  _mes := date_trunc('month', coalesce(p_periodo, _hoje))::date;
  _fim := (_mes + interval '1 month')::date;
  _rec := array(select g.id from organizacao.empresas_grupo g
                 where g.ativa and g.id = any (_e.tesouraria || _e.controladoria || _e.papel)
                   and (p_emissoras is null or g.id = any (p_emissoras)));
  _sim := array(select g.apelido from organizacao.empresas_grupo g where g.id = any (_rec) and g.modo_omie = 'simular'
                 order by g.apelido);
  _estado := case when cardinality(_rec) > 0 and cardinality(_sim) = cardinality(_rec) then 'nao_apurado'
                  when cardinality(_sim) > 0 then 'parcial' else 'ok' end;
  _tipo := case when cardinality(_e.tesouraria) > 0 then 'tesouraria'
                when cardinality(_e.controladoria) > 0 then 'controladoria'
                when cardinality(_e.gestor) > 0 then 'gestor' else 'pessoal' end;

  with vis as materialized (
    select p.* from receita.fat_pedidos p
     where receita.fat_ve(_e, p) and (p_emissoras is null or p.emissora_id = any (p_emissoras))
  ), af as (
    select coalesce(sum(p.valor), 0) v, count(*) n from vis p
     where not p.simulacao and p.status in ('aguardando_ok', 'na_fila_omie', 'erro_omie', 'os_criada', 'em_conferencia')
  ), fm as (
    select coalesce(sum(p.valor), 0) v, count(*) n from vis p
     where not p.simulacao and p.status <> 'cancelado' and p.faturado_em is not null
       and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date >= _mes
       and (coalesce(p.omie_nf_emitida_em, p.faturado_em) at time zone 'America/Sao_Paulo')::date < _fim
  ), rm as (
    select coalesce(sum(x.valor), 0) v, count(*) n
      from vis p join receita.fat_pedido_parcelas x on x.pedido_id = p.id
     where not p.simulacao and p.status <> 'cancelado' and x.situacao = 'pago' and x.pago_em >= _mes and x.pago_em < _fim
  ), at as (
    select coalesce(sum(x.valor), 0) v, count(*) n
      from vis p join receita.fat_pedido_parcelas x on x.pedido_id = p.id
     where not p.simulacao and p.status in ('faturado', 'em_atraso') and x.situacao not in ('pago', 'cancelado')
       and x.vencimento < _hoje
  )
  select jsonb_build_object(
    'periodo', _mes,
    'recorte', jsonb_build_object('tipo', _tipo, 'emissoras', coalesce((
      select jsonb_agg(jsonb_build_object('id', g.id, 'apelido', g.apelido, 'modo_omie', g.modo_omie) order by g.apelido)
        from organizacao.empresas_grupo g where g.id = any (_rec)), '[]'::jsonb)),
    'simulacao', jsonb_build_object('todas', _estado = 'nao_apurado', 'emissoras', to_jsonb(_sim)),
    'numeros', jsonb_build_object(
      'a_faturar', (select jsonb_build_object('valor', af.v, 'quantidade', af.n, 'unidade', 'pedido', 'estado', 'ok',
                                              'filtro', '{"situacao": ["a_faturar"]}'::jsonb) from af),
      'faturado_no_mes', (select jsonb_build_object('valor', fm.v, 'quantidade', fm.n, 'unidade', 'nota', 'estado', _estado,
                                                    'filtro', jsonb_build_object('mes', to_char(_mes, 'YYYY-MM'), 'regua', 'nota')) from fm),
      'recebido_no_mes', (select jsonb_build_object('valor', rm.v, 'quantidade', rm.n, 'unidade', 'parcela', 'estado', _estado,
                                                    'filtro', jsonb_build_object('mes', to_char(_mes, 'YYYY-MM'), 'regua', 'pagamento')) from rm),
      'em_atraso', (select jsonb_build_object('valor', at.v, 'quantidade', at.n, 'unidade', 'parcela', 'estado', _estado,
                                              'filtro', '{"regua": "atraso"}'::jsonb) from at)),
    'por_situacao', coalesce((
      select jsonb_agg(jsonb_build_object('situacao', s.status, 'quantidade', s.n,
                                          'filtro', jsonb_build_object('situacao', jsonb_build_array(s.status)))
                       order by array_position(array['aguardando_ok', 'devolvido', 'na_fila_omie', 'simulado', 'erro_omie',
                                                     'os_criada', 'em_conferencia'], s.status))
        from (select p.status, count(*) n from vis p
               where p.status in ('aguardando_ok', 'devolvido', 'na_fila_omie', 'simulado', 'erro_omie', 'os_criada', 'em_conferencia')
               group by p.status) s), '[]'::jsonb),
    'sem_pedido', not exists (select 1 from vis))
  into _r;
  return _r;
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_fila_tesouraria(p_emissora uuid DEFAULT NULL::uuid, p_filtro jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _e receita.fat_escopo_t;
  _f jsonb := coalesce(p_filtro, '{}'::jsonb);
  _k text;
  _erros jsonb := '[]'::jsonb;
  _emis uuid[];
  _sit text;
  _hig text;
  _dia date;
  _busca text;
  _busca_doc text;
  _lim int := 300;
  _hoje date;
  _r jsonb;
begin
  if not ops.can('view.faturamento') then
    raise exception 'Sem acesso ao Portal de Faturamento.' using errcode = '42501';
  end if;
  _e := receita.fat_escopo();
  perform receita.fat_exigir_porta(_e);
  if cardinality(_e.tesouraria) = 0 then
    raise exception 'Só a tesouraria abre a fila.' using errcode = '42501';
  end if;
  if p_emissora is not null and not p_emissora = any (_e.tesouraria) then
    raise exception 'Esta empresa não está no seu recorte da tesouraria.' using errcode = '42501';
  end if;
  _hoje := receita.fat_hoje();
  _emis := case when p_emissora is null then _e.tesouraria else array[p_emissora] end;
  if jsonb_typeof(_f) <> 'object' then perform receita.fat_recusar(receita.fat_erro(null, 'p_filtro precisa ser um objeto.')); end if;

  for _k in select jsonb_object_keys(_f) loop
    begin
      case _k
        when 'situacao' then
          _sit := _f ->> 'situacao';
          if _sit not in ('para_faturar', 'em_conferencia', 'erro_omie', 'na_fila_omie', 'faturado', 'cancelamento_pedido') then
            raise exception 'situacao'; end if;
        when 'higiene' then
          _hig := _f ->> 'higiene';
          if _hig not in ('erro', 'vence_3d', 'parado_1du') then raise exception 'higiene'; end if;
        when 'dia' then _dia := case when _f ->> 'dia' = 'hoje' then _hoje else (_f ->> 'dia')::date end;
        when 'busca' then _busca := nullif(btrim(_f ->> 'busca'), '');
        when 'limite' then _lim := (_f ->> 'limite')::int; if _lim not between 1 and 1000 then raise exception 'limite'; end if;
        else raise exception 'desconhecido';
      end case;
    exception when others then
      _erros := _erros || receita.fat_erro(_k, case when sqlerrm = 'desconhecido' then 'Filtro desconhecido.' else 'Valor inválido.' end);
    end;
  end loop;
  if jsonb_array_length(_erros) > 0 then perform receita.fat_recusar(_erros); end if;
  _busca_doc := case when char_length(coalesce(receita.fat_documento_normalizar(_busca), '')) >= 3 then receita.fat_documento_normalizar(_busca) end;

  with base as materialized (
    select p.*,
           (p.na_fila_em at time zone 'America/Sao_Paulo')::date as dia_chegada,
           exists (select 1 from integracoes.omie_envios x where x.origem = 'fat_pedido' and x.origem_id = p.id
                     and x.operacao = 'faturar_os' and x.status in ('pendente', 'processando')) as faturando,
           p.status in ('na_fila_omie', 'erro_omie', 'simulado', 'os_criada', 'em_conferencia')
             and p.primeiro_vencimento <= _hoje + 3 as vence_3d,
           p.status in ('os_criada', 'simulado', 'em_conferencia')
             and receita.fat_dias_uteis((p.status_em at time zone 'America/Sao_Paulo')::date, _hoje) > 1 as parado_1du
      from receita.fat_pedidos p
     where p.emissora_id = any (_e.tesouraria) and p.enviado_em is not null
       and (p.status in ('na_fila_omie', 'erro_omie', 'simulado', 'os_criada', 'em_conferencia', 'cancelamento_pedido')
            or (p.status = 'faturado' and (p.faturado_em at time zone 'America/Sao_Paulo')::date = _hoje))
  ), fila as (
    select b.* from base b where b.emissora_id = any (_emis)
  ), filt as (
    select f.* from fila f
     where (_sit is null and f.status <> 'faturado'
            or _sit = 'para_faturar' and f.status in ('os_criada', 'simulado')
            or _sit = f.status)
       and (_hig is null or (_hig = 'erro' and f.status = 'erro_omie') or (_hig = 'vence_3d' and f.vence_3d)
            or (_hig = 'parado_1du' and f.parado_1du))
       and (_dia is null or f.dia_chegada = _dia or (_sit = 'faturado' and (f.faturado_em at time zone 'America/Sao_Paulo')::date = _dia))
       and (_busca is null or f.numero ilike '%' || _busca || '%' or f.tomador_nome ilike '%' || _busca || '%'
            or f.projeto ilike '%' || _busca || '%' or (_busca_doc is not null and f.tomador_documento like '%' || _busca_doc || '%'))
  ), pagina as (
    select f.*,
           row_number() over (order by f.dia_chegada,
             array_position(array['erro_omie', 'cancelamento_pedido', 'em_conferencia', 'os_criada', 'simulado',
                                  'na_fila_omie', 'faturado'], f.status),
             f.primeiro_vencimento, f.numero) as ord
      from filt f
     order by ord
     limit _lim
  )
  select jsonb_build_object(
    'emissoras', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', g.id, 'apelido', g.apelido, 'modo_omie', g.modo_omie,
               'trabalho', (select count(*) from base b where b.emissora_id = g.id
                             and b.status in ('erro_omie', 'simulado', 'os_criada', 'em_conferencia', 'cancelamento_pedido')),
               'omie', jsonb_build_object('indisponivel', coalesce(s.indisponivel, false), 'motivo', s.motivo,
                                          'bloqueada_ate', s.bloqueada_ate))
             order by g.apelido)
        from organizacao.empresas_grupo g left join integracoes.omie_emissora_estado s on s.emissora_id = g.id
       where g.ativa and g.id = any (_e.tesouraria)), '[]'::jsonb),
    'ritmo', jsonb_build_object(
      'para_faturar', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                 'filtro', '{"situacao": "para_faturar"}'::jsonb)
                         from fila f where f.status in ('os_criada', 'simulado')),
      'em_conferencia', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                   'filtro', '{"situacao": "em_conferencia"}'::jsonb)
                           from fila f where f.status = 'em_conferencia'),
      'faturados_hoje', (select jsonb_build_object('quantidade', count(*), 'valor', coalesce(sum(f.valor), 0),
                                                   'filtro', '{"situacao": "faturado", "dia": "hoje"}'::jsonb)
                           from fila f where f.status = 'faturado')),
    'higiene', (select jsonb_build_object('erro', count(*) filter (where f.status = 'erro_omie'),
                                          'vence_3d', count(*) filter (where f.vence_3d),
                                          'parado_1du', count(*) filter (where f.parado_1du)) from fila f),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', f.id, 'numero', f.numero, 'chegou_em', f.na_fila_em, 'dia', f.dia_chegada,
               'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
               'tomador', jsonb_build_object('nome', f.tomador_nome, 'documento', f.tomador_documento,
                                             'situacao_conferida', f.tomador_situacao is not null),
               'servico', jsonb_build_object('descricao', s.descricao, 'codigo', s.codigo),
               'projeto', f.projeto, 'documento', f.documento, 'forma', f.forma, 'parcelas', f.parcelas,
               'valor', f.valor, 'primeiro_vencimento', f.primeiro_vencimento, 'status', f.status,
               'simulacao', f.simulacao, 'faturando', f.faturando, 'conferido_por', receita.fat_pessoa(f.conferido_por),
               'erro_legivel', case when f.status = 'erro_omie' then f.motivo_status end,
               'onde_parou', (select jsonb_build_object('evento', v.evento, 'em', v.em, 'autor', receita.fat_pessoa(v.autor_id),
                                                        'motivo', v.diff ->> 'motivo')
                                from receita.fat_eventos v where v.entidade = 'pedido' and v.entidade_id = f.id
                               order by v.em desc, v.id desc limit 1),
               'proxima_acao', jsonb_build_object(
                 'acao', case when f.faturando then 'aguardar_omie'
                              when f.status = 'erro_omie' then 'reenviar'
                              when f.status = 'cancelamento_pedido' then 'confirmar_cancelamento'
                              when f.status = 'em_conferencia' then 'faturar'
                              when f.status in ('os_criada', 'simulado') then 'conferir'
                              when f.status = 'na_fila_omie' then 'aguardar_omie' end,
                 'data', case when f.status in ('em_conferencia', 'os_criada', 'simulado') then f.primeiro_vencimento end,
                 'desde', f.status_em,
                 'tentar_em', case when f.status = 'na_fila_omie' or f.faturando then (
                   select min(x.proxima_tentativa_em) from integracoes.omie_envios x
                    where x.origem = 'fat_pedido' and x.origem_id = f.id and x.status = 'pendente') end),
               'higiene', jsonb_build_object('erro', f.status = 'erro_omie', 'vence_3d', f.vence_3d, 'parado_1du', f.parado_1du))
             order by f.ord)
        from pagina f
        join organizacao.empresas_grupo g on g.id = f.emissora_id
        left join receita.fat_servicos s on s.id = f.servico_id), '[]'::jsonb),
    'total', (select count(*) from filt),
    'total_fila', (select count(*) from fila f where f.status <> 'faturado'),
    'lido_em', now())
  into _r;
  return _r;
end $function$;

CREATE OR REPLACE FUNCTION integracoes.fat_notificacoes_resultado(p_id uuid, p_status text, p_email text DEFAULT NULL::text, p_assunto text DEFAULT NULL::text, p_corpo text DEFAULT NULL::text, p_erro_legivel text DEFAULT NULL::text, p_resposta jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _n integracoes.notificacoes;
  _erro text := nullif(btrim(p_erro_legivel), '');
begin
  perform integracoes.fat_exigir_conector();
  select * into _n from integracoes.notificacoes where id = p_id for update;
  if not found then raise exception 'Notificação não encontrada.' using errcode = 'P0002'; end if;
  if _n.status <> 'processando' then
    raise exception 'A notificação % está %, não processando.', _n.id, _n.status using errcode = '55000';
  end if;
  if p_status not in ('simulado', 'enviado', 'erro', 'pendente') then
    raise exception 'p_status: simulado, enviado, erro ou pendente.' using errcode = '22023';
  end if;
  if p_status = 'erro' and _erro is null then
    raise exception 'Erro sem p_erro_legivel.' using errcode = '22023';
  end if;
  if p_status = 'enviado' and nullif(btrim(p_email), '') is null then
    raise exception 'Enviado sem p_email.' using errcode = '22023';
  end if;
  if p_resposta is not null and jsonb_typeof(p_resposta) = 'object' and p_resposta ?| array['api_key', 'authorization'] then
    raise exception 'p_resposta não guarda chave.' using errcode = '22023';
  end if;
  update integracoes.notificacoes
     set status = p_status,
         email = coalesce(nullif(btrim(p_email), ''), email),
         assunto = coalesce(p_assunto, assunto),
         corpo = coalesce(p_corpo, corpo),
         erro_legivel = _erro,
         resposta = p_resposta,
         enviado_em = case when p_status = 'enviado' then now() else enviado_em end,
         proxima_tentativa_em = case when p_status = 'pendente' then now() + case
             when tentativas <= 1 then interval '1 minute' when tentativas = 2 then interval '5 minutes'
             when tentativas = 3 then interval '15 minutes' else interval '60 minutes' end
           else proxima_tentativa_em end
   where id = _n.id returning * into _n;
  return jsonb_build_object('notificacao', jsonb_build_object('id', _n.id, 'status', _n.status));
end $function$;

CREATE OR REPLACE FUNCTION receita.fat_notificar_evento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _p receita.fat_pedidos;
  _apelido text;
  _evento text;
  _dados jsonb;
  _dono_ativo receita.fat_donos;
  _dest jsonb := '[]'::jsonb;
begin
  if new.entidade <> 'pedido' or new.para is null or new.de is not distinct from new.para then return new; end if;
  _evento := case new.para
    when 'aguardando_ok' then 'ok_pendente'
    when 'devolvido' then 'devolvido'
    when 'faturado' then case when new.de in ('em_atraso', 'recebido') then null else 'faturado' end
    when 'em_atraso' then 'em_atraso'
    when 'erro_omie' then 'erro_omie'
  end;
  if _evento is null then return new; end if;

  begin
    select * into _p from receita.fat_pedidos where id = new.entidade_id;
    if not found then return new; end if;
    select g.apelido into _apelido from organizacao.empresas_grupo g where g.id = _p.emissora_id;
    _dados := jsonb_build_object(
      'numero', _p.numero, 'emissora', _apelido, 'tomador_nome', _p.tomador_nome, 'tomador_tipo', _p.tomador_tipo,
      'valor', _p.valor, 'projeto', _p.projeto, 'primeiro_vencimento', _p.primeiro_vencimento,
      'parcelas', _p.parcelas, 'documento', _p.documento,
      'motivo', coalesce(nullif(btrim(new.diff ->> 'motivo'), ''), _p.motivo_status),
      'nf_numero', _p.omie_nf_numero, 'nf_link', _p.omie_nf_link, 'simulacao', _p.simulacao,
      'de', new.de, 'para', new.para, 'evento_origem', new.evento);

    -- Lista (destinatário, papel) na ordem de prioridade: o unique deixa a primeira quando a pessoa se repete.

    if _evento = 'ok_pendente' then
      select * into _dono_ativo from receita.fat_donos d
       where d.emissora_id = _p.emissora_id and d.user_id = _p.dono_id and d.papel = 'dono' and d.ativo
       limit 1;
      if found then
        _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.dono_id, 'p', 'dono'));
        if _dono_ativo.substituto_id is not null then
          _dest := _dest || jsonb_build_object('o', 2, 'u', _dono_ativo.substituto_id, 'p', 'substituto');
        end if;
      else
        _dest := coalesce((select jsonb_agg(jsonb_build_object('o', 3, 'u', d.user_id, 'p', 'gestor'))
                             from receita.fat_donos d
                            where d.emissora_id = _p.emissora_id and d.papel = 'gestor' and d.ativo), '[]'::jsonb);
      end if;
    elsif _evento = 'devolvido' then
      _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.solicitante_id, 'p', 'autor'));
    elsif _evento = 'faturado' then
      _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.dono_id, 'p', 'dono'),
                                 jsonb_build_object('o', 2, 'u', _p.solicitante_id, 'p', 'solicitante'));
    elsif _evento = 'em_atraso' then
      _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.dono_id, 'p', 'dono'));
    elsif _evento = 'erro_omie' then
      _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.solicitante_id, 'p', 'autor'))
        || coalesce((
        select jsonb_agg(jsonb_build_object('o', 2, 'u', u.user_id, 'p', 'tesouraria'))
          from public.profiles u
         where u.ativo
           and ops.can_user(u.user_id, 'view.faturamento')
           and ops.can_user(u.user_id, 'edit.faturamento_tesouraria')
           and (coalesce((select e.todas_empresas from ops.usuario_escopo e where e.user_id = u.user_id), false)
                or exists (select 1 from ops.usuario_empresas ue
                            where ue.user_id = u.user_id and ue.empresa_id = _p.emissora_id))), '[]'::jsonb);
    end if;

    insert into integracoes.notificacoes (evento, pedido_id, emissora_id, transicao_id, destinatario_id, papel, dados)
    select _evento, _p.id, _p.emissora_id, new.id, d.u, d.p, _dados
      from jsonb_to_recordset(_dest) as d(o int, u uuid, p text)
      join public.profiles pr on pr.user_id = d.u
     where d.u is not null
     order by d.o
    on conflict on constraint notificacoes_unica do nothing;
  exception when others then
    -- A notificação nunca desfaz a transição do pedido.
    raise warning 'fat_notificar_evento (pedido %, evento %): %', new.entidade_id, _evento, sqlerrm;
  end;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION receita.fat_donos_registrar_evento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _diff jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('dono', new.id, new.emissora_id, 'criado', null,
            case when new.ativo then 'ativo' else 'inativo' end,
            jsonb_build_object(
              'user_id', jsonb_build_object('de', null, 'para', new.user_id),
              'papel', jsonb_build_object('de', null, 'para', new.papel),
              'substituto_id', jsonb_build_object('de', null, 'para', new.substituto_id),
              'ativo', jsonb_build_object('de', null, 'para', new.ativo)),
            auth.uid());
    return new;
  end if;

  if new.emissora_id is distinct from old.emissora_id then
    _diff := _diff || jsonb_build_object('emissora_id', jsonb_build_object('de', old.emissora_id, 'para', new.emissora_id));
  end if;
  if new.user_id is distinct from old.user_id then
    _diff := _diff || jsonb_build_object('user_id', jsonb_build_object('de', old.user_id, 'para', new.user_id));
  end if;
  if new.papel is distinct from old.papel then
    _diff := _diff || jsonb_build_object('papel', jsonb_build_object('de', old.papel, 'para', new.papel));
  end if;
  if new.substituto_id is distinct from old.substituto_id then
    _diff := _diff || jsonb_build_object('substituto_id', jsonb_build_object('de', old.substituto_id, 'para', new.substituto_id));
  end if;
  if new.ativo is distinct from old.ativo then
    _diff := _diff || jsonb_build_object('ativo', jsonb_build_object('de', old.ativo, 'para', new.ativo));
  end if;
  if _diff = '{}'::jsonb then
    return new;
  end if;

  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('dono', new.id, new.emissora_id,
          case when new.ativo is distinct from old.ativo
               then case when new.ativo then 'reativado' else 'desativado' end
               else 'alterado' end,
          case when old.ativo then 'ativo' else 'inativo' end,
          case when new.ativo then 'ativo' else 'inativo' end,
          _diff, auth.uid());
  return new;
end $function$;

CREATE OR REPLACE FUNCTION receita.fat_contratos_outra_emissora(_doc text, _emissora uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when _emissora is not null and exists (select 1 from receita.fat_contratos_vigentes(_doc) v where v.emissora_id = _emissora)
      then '[]'::jsonb
    else coalesce((
      select jsonb_agg(jsonb_build_object(
               'emissora', jsonb_build_object('id', v.emissora_id, 'apelido', v.apelido), 'unidade', v.unidade,
               'numero', v.numero, 'valor_mensal', v.valor_mensal, 'vigencia_inicial', v.vigencia_inicial,
               'vigencia_final', v.vigencia_final) order by v.apelido, v.numero)
        from receita.fat_contratos_vigentes(_doc) v
       where _emissora is null or v.emissora_id <> _emissora), '[]'::jsonb) end
$function$;

CREATE OR REPLACE FUNCTION integracoes.fat_envio_proximos(p_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _ids uuid[];
begin
  perform integracoes.fat_exigir_conector();
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'p_limite vai de 1 a 100.' using errcode = '22023';
  end if;
  -- Conector que caiu no meio: o envio volta para a fila (o Omie reconhece pelo código de integração).
  update integracoes.omie_envios set status = 'pendente', proxima_tentativa_em = now()
   where status = 'processando' and updated_at < now() - interval '15 minutes';

  with cand as (
    select e.id
      from integracoes.omie_envios e
      join organizacao.empresas_grupo g on g.id = e.emissora_id and g.ativa
      left join integracoes.omie_emissora_estado s on s.emissora_id = e.emissora_id
      left join integracoes.omie_envios d on d.id = e.depende_de
      left join receita.fat_pedidos p on e.origem = 'fat_pedido' and p.id = e.origem_id
     where e.status = 'pendente' and e.proxima_tentativa_em <= now()
       and (s.bloqueada_ate is null or s.bloqueada_ate <= now())
       and (e.depende_de is null or d.status in ('ok', 'simulado'))
       and (e.origem <> 'fat_pedido'
            or (e.operacao = 'consultar_status' and p.status not in ('rascunho', 'aguardando_ok'))
            or (e.operacao <> 'consultar_status'
                and p.status not in ('rascunho', 'aguardando_ok', 'devolvido', 'cancelamento_pedido', 'cancelado')))
     order by e.proxima_tentativa_em, e.created_at
     limit p_limite
     for update of e skip locked
  ), upd as (
    update integracoes.omie_envios e set status = 'processando', tentativas = e.tentativas + 1
      from cand where e.id = cand.id
    returning e.id
  )
  select array_agg(upd.id) into _ids from upd;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido),
             'origem', e.origem, 'origem_id', e.origem_id, 'operacao', e.operacao,
             'codigo_integracao', e.codigo_integracao, 'modo', e.modo, 'tentativas', e.tentativas,
             'payload', e.payload,
             'cliente_omie', (select jsonb_build_object('codigo_cliente_omie', v.codigo_cliente_omie,
                                                        'codigo_cliente_integracao', v.codigo_cliente_integracao)
                                from integracoes.omie_vinculo_cliente v
                               where v.emissora_id = e.emissora_id and v.documento = e.payload -> 'tomador' ->> 'documento'),
             'dependencia', (select jsonb_build_object('operacao', d.operacao, 'status', d.status, 'codigos', d.resposta -> 'codigos')
                               from integracoes.omie_envios d where d.id = e.depende_de))
           order by e.proxima_tentativa_em, e.created_at)
      from integracoes.omie_envios e join organizacao.empresas_grupo g on g.id = e.emissora_id
     where e.id = any (_ids)), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION integracoes.pipefy_envio_proximos(p_limite integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _ids uuid[];
begin
  perform integracoes.fat_exigir_conector();
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'p_limite vai de 1 a 100.' using errcode = '22023';
  end if;
  update integracoes.pipefy_envios set status = 'pendente', proxima_tentativa_em = now()
   where status = 'processando' and updated_at < now() - interval '15 minutes';

  with cand as (
    select e.id
      from integracoes.pipefy_envios e
     where e.status = 'pendente' and e.proxima_tentativa_em <= now()
       and not exists (select 1 from integracoes.pipefy_envios x
                        where x.origem = e.origem and x.origem_id = e.origem_id and x.seq < e.seq
                          and x.status in ('pendente', 'processando', 'erro'))
     order by e.seq
     limit p_limite
     for update of e skip locked
  ), upd as (
    update integracoes.pipefy_envios e set status = 'processando', tentativas = e.tentativas + 1
      from cand where e.id = cand.id
    returning e.id
  )
  select array_agg(upd.id) into _ids from upd;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', e.id, 'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido), 'pipefy_sync', g.pipefy_sync,
             'origem', e.origem, 'origem_id', e.origem_id, 'operacao', e.operacao, 'tentativas', e.tentativas,
             'card_id', coalesce(e.card_id, (select x.card_id from integracoes.pipefy_envios x
                                              where x.origem = e.origem and x.origem_id = e.origem_id
                                                and x.operacao = 'criar_card' and x.card_id is not null
                                              order by x.seq desc limit 1)),
             'payload', e.payload)
           order by e.seq)
      from integracoes.pipefy_envios e join organizacao.empresas_grupo g on g.id = e.emissora_id
     where e.id = any (_ids)), '[]'::jsonb);
end $function$;

CREATE OR REPLACE FUNCTION integracoes.fat_envio_resultado(p_envio uuid, p_status text, p_resposta jsonb DEFAULT NULL::jsonb, p_erro_legivel text DEFAULT NULL::text, p_codigos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _x integracoes.omie_envios;
  _p receita.fat_pedidos;
  _c jsonb := coalesce(p_codigos, '{}'::jsonb);
  _escrita boolean;
  _erro text := nullif(btrim(p_erro_legivel), '');
  _ate timestamptz;
  _os bigint;
  _de_ok text[];
  _ev text;
begin
  perform integracoes.fat_exigir_conector();
  select * into _x from integracoes.omie_envios where id = p_envio for update;
  if not found then raise exception 'Envio não encontrado.' using errcode = 'P0002'; end if;
  if _x.status <> 'processando' then
    raise exception 'O envio % está %, não processando: reserve antes por fat_envio_proximos.', _x.id, _x.status
      using errcode = '55000';
  end if;
  if p_status not in ('ok', 'simulado', 'erro', 'pendente') then
    raise exception 'p_status: ok, simulado, erro ou pendente.' using errcode = '22023';
  end if;
  if jsonb_typeof(_c) <> 'object' then raise exception 'p_codigos precisa ser um objeto.' using errcode = '22023'; end if;
  _escrita := _x.operacao in ('garantir_cliente', 'incluir_os', 'alterar_os', 'faturar_os', 'incluir_conta_receber');
  if _escrita and p_status = 'ok' and _x.modo <> 'gravar' then
    raise exception 'Envio em modo simular não pode voltar ok: responda simulado.' using errcode = '22023';
  end if;
  if _escrita and p_status = 'simulado' and _x.modo <> 'simular' then
    raise exception 'Envio em modo gravar não pode voltar simulado.' using errcode = '22023';
  end if;
  if p_status = 'erro' and _erro is null then
    raise exception 'Erro sem p_erro_legivel: escreva a mensagem para quem opera.' using errcode = '22023';
  end if;
  if p_status = 'ok' and _x.operacao in ('incluir_os', 'alterar_os') and nullif(_c ->> 'nCodOS', '') is null then
    raise exception 'incluir_os/alterar_os ok sem nCodOS em p_codigos.' using errcode = '22023';
  end if;

  -- Envio
  update integracoes.omie_envios
     set status = p_status,
         resposta = case when p_resposta is null or jsonb_typeof(p_resposta) <> 'object'
                         then jsonb_build_object('retorno', p_resposta, 'codigos', _c)
                         else p_resposta || jsonb_build_object('codigos', _c) end,
         erro_legivel = _erro,
         proxima_tentativa_em = case when p_status = 'pendente' then coalesce(
             (_c ->> 'tentar_em')::timestamptz,
             now() + case when _x.tentativas <= 1 then interval '1 minute' when _x.tentativas = 2 then interval '5 minutes'
                          when _x.tentativas = 3 then interval '15 minutes' else interval '60 minutes' end)
           else proxima_tentativa_em end
   where id = _x.id
  returning * into _x;

  -- Estado do Omie da emissora (CA-12: bloqueia só a fila dela)
  _ate := (_c ->> 'bloquear_emissora_ate')::timestamptz;
  if _ate is not null or _c ? 'emissora_indisponivel' or p_status in ('ok', 'simulado', 'erro') then
    insert into integracoes.omie_emissora_estado as s
      (emissora_id, bloqueada_ate, indisponivel, motivo, ultimo_ok_em, ultima_falha_em)
    values (_x.emissora_id, _ate,
            coalesce((_c ->> 'emissora_indisponivel')::boolean, false),
            case when coalesce((_c ->> 'emissora_indisponivel')::boolean, false) then coalesce(_erro, 'Omie indisponível.') end,
            case when p_status in ('ok', 'simulado') then now() end,
            case when p_status = 'erro' then now() end)
    on conflict (emissora_id) do update
       set bloqueada_ate = coalesce(excluded.bloqueada_ate, s.bloqueada_ate),
           indisponivel = case when _c ? 'emissora_indisponivel' then excluded.indisponivel
                               when p_status in ('ok', 'simulado') then false else s.indisponivel end,
           motivo = case when _c ? 'emissora_indisponivel' then excluded.motivo
                         when p_status in ('ok', 'simulado') then null else s.motivo end,
           ultimo_ok_em = coalesce(excluded.ultimo_ok_em, s.ultimo_ok_em),
           ultima_falha_em = coalesce(excluded.ultima_falha_em, s.ultima_falha_em);
  end if;

  if p_status = 'pendente' or _x.origem <> 'fat_pedido' or _x.operacao = 'consultar_status' then
    return jsonb_build_object('envio', jsonb_build_object('id', _x.id, 'status', _x.status), 'pedido', null);
  end if;

  select * into _p from receita.fat_pedidos where id = _x.origem_id for update;

  if _x.operacao = 'garantir_cliente' and p_status in ('ok', 'simulado') then
    if nullif(_c ->> 'codigo_cliente_omie', '') is not null then
      insert into integracoes.omie_vinculo_cliente as v (emissora_id, documento, codigo_cliente_omie, codigo_cliente_integracao, sincronizado_em)
      values (_x.emissora_id, _p.tomador_documento, (_c ->> 'codigo_cliente_omie')::bigint, _c ->> 'codigo_cliente_integracao', now())
      on conflict (emissora_id, documento) do update
         set codigo_cliente_omie = excluded.codigo_cliente_omie,
             codigo_cliente_integracao = coalesce(excluded.codigo_cliente_integracao, v.codigo_cliente_integracao),
             sincronizado_em = now();
    end if;
    perform receita.fat_evento_pedido(_p, 'omie_cliente', jsonb_build_object(
      'modo', _x.modo, 'cliente_existia', _c -> 'cliente_existia', 'codigo_cliente_omie', _c -> 'codigo_cliente_omie'));
    return jsonb_build_object('envio', jsonb_build_object('id', _x.id, 'status', _x.status),
                              'pedido', jsonb_build_object('id', _p.id, 'status', _p.status));
  end if;

  if p_status = 'erro' then
    if _p.status in ('na_fila_omie', 'os_criada', 'simulado', 'em_conferencia') then
      _p := receita.fat_transicao(_p.id, 'erro_omie', _erro, 'omie_erro', jsonb_build_object('operacao', _x.operacao));
    else
      perform receita.fat_evento_pedido(_p, 'omie_resultado_ignorado', jsonb_build_object(
        'operacao', _x.operacao, 'status', p_status, 'erro', _erro));
    end if;
  elsif _x.operacao in ('incluir_os', 'alterar_os') then
    _os := nullif(_c ->> 'nCodOS', '')::bigint;
    if _os is not null or _c ? 'cEtapa' then
      update receita.fat_pedidos set omie_os_codigo = coalesce(_os, omie_os_codigo),
                                     omie_os_etapa = coalesce(_c ->> 'cEtapa', omie_os_etapa)
       where id = _p.id returning * into _p;
    end if;
    if p_status = 'simulado' then
      update receita.fat_pedidos set simulacao = true where id = _p.id returning * into _p;
    end if;
    if _p.status in ('na_fila_omie', 'erro_omie') then
      _p := receita.fat_transicao(_p.id, case when p_status = 'ok' then 'os_criada' else 'simulado' end, null,
              case when p_status = 'simulado' then 'omie_simulado'
                   when _x.operacao = 'alterar_os' then 'omie_os_alterada' else 'omie_os_criada' end,
              jsonb_build_object('omie_os_codigo', jsonb_build_object('de', null, 'para', _os), 'modo', _x.modo)
                || case when p_status = 'simulado'
                        then jsonb_build_object('cliente_existe', _c -> 'cliente_existe', 'servico_existe', _c -> 'servico_existe')
                        else '{}'::jsonb end);
    else
      perform receita.fat_evento_pedido(_p, 'omie_resultado_ignorado', jsonb_build_object(
        'operacao', _x.operacao, 'status', p_status, 'omie_os_codigo', _os));
    end if;
  elsif _x.operacao = 'faturar_os' then
    update receita.fat_pedidos
       set omie_nf_numero = coalesce(nullif(_c ->> 'nf_numero', ''), omie_nf_numero),
           omie_nf_link = coalesce(nullif(_c ->> 'nf_link', ''), omie_nf_link),
           omie_nf_emitida_em = coalesce((_c ->> 'nf_emitida_em')::timestamptz, omie_nf_emitida_em),
           simulacao = simulacao or p_status = 'simulado'
     where id = _p.id returning * into _p;
    if jsonb_typeof(_c -> 'titulos') = 'array' then
      update receita.fat_pedido_parcelas x set omie_titulo_codigo = (t ->> 'codigo')::bigint
        from jsonb_array_elements(_c -> 'titulos') t
       where x.pedido_id = _p.id and x.n = (t ->> 'parcela')::int and nullif(t ->> 'codigo', '') is not null;
    end if;
    if _p.status in ('na_fila_omie', 'erro_omie', 'os_criada', 'simulado', 'em_conferencia') then
      _p := receita.fat_transicao(_p.id, 'faturado', null, case when p_status = 'simulado' then 'faturado_simulado' else 'faturado' end,
              jsonb_build_object('omie_nf_numero', _p.omie_nf_numero, 'modo', _x.modo));
    else
      perform receita.fat_evento_pedido(_p, 'omie_resultado_ignorado', jsonb_build_object(
        'operacao', _x.operacao, 'status', p_status, 'omie_nf_numero', _p.omie_nf_numero));
    end if;
  end if;

  return jsonb_build_object('envio', jsonb_build_object('id', _x.id, 'status', _x.status),
                            'pedido', jsonb_build_object('id', _p.id, 'status', _p.status));
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_conector_envio_resultado(p_envio uuid, p_status text, p_resposta jsonb DEFAULT NULL::jsonb, p_erro_legivel text DEFAULT NULL::text, p_codigos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_envio_resultado(p_envio, p_status, p_resposta, p_erro_legivel, p_codigos);
end $function$;

CREATE OR REPLACE FUNCTION integracoes.pipefy_envio_resultado(p_envio uuid, p_status text, p_resposta jsonb DEFAULT NULL::jsonb, p_erro_legivel text DEFAULT NULL::text, p_card_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _x integracoes.pipefy_envios;
  _erro text := nullif(btrim(p_erro_legivel), '');
begin
  perform integracoes.fat_exigir_conector();
  select * into _x from integracoes.pipefy_envios where id = p_envio for update;
  if not found then raise exception 'Envio não encontrado.' using errcode = 'P0002'; end if;
  if _x.status <> 'processando' then
    raise exception 'O envio % está %, não processando.', _x.id, _x.status using errcode = '55000';
  end if;
  if p_status not in ('ok', 'simulado', 'erro', 'pendente') then
    raise exception 'p_status: ok, simulado, erro ou pendente.' using errcode = '22023';
  end if;
  if p_status = 'erro' and _erro is null then
    raise exception 'Erro sem p_erro_legivel.' using errcode = '22023';
  end if;
  update integracoes.pipefy_envios
     set status = p_status, resposta = p_resposta, erro_legivel = _erro,
         card_id = coalesce(nullif(btrim(p_card_id), ''), card_id),
         proxima_tentativa_em = case when p_status = 'pendente' then now() + case
             when tentativas <= 1 then interval '1 minute' when tentativas = 2 then interval '5 minutes'
             when tentativas = 3 then interval '15 minutes' else interval '60 minutes' end
           else proxima_tentativa_em end
   where id = _x.id returning * into _x;
  return jsonb_build_object('envio', jsonb_build_object('id', _x.id, 'status', _x.status, 'card_id', _x.card_id));
end $function$;

CREATE OR REPLACE FUNCTION ops.fat_conector_pipefy_resultado(p_envio uuid, p_status text, p_resposta jsonb DEFAULT NULL::jsonb, p_erro_legivel text DEFAULT NULL::text, p_card_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.pipefy_envio_resultado(p_envio, p_status, p_resposta, p_erro_legivel, p_card_id);
end $function$;

revoke all on function integracoes.fat_envio_resultado(uuid, text, jsonb, text, jsonb),
                       ops.fat_conector_envio_resultado(uuid, text, jsonb, text, jsonb),
                       integracoes.pipefy_envio_resultado(uuid, text, jsonb, text, text),
                       ops.fat_conector_pipefy_resultado(uuid, text, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function integracoes.fat_envio_resultado(uuid, text, jsonb, text, jsonb),
                          ops.fat_conector_envio_resultado(uuid, text, jsonb, text, jsonb),
                          integracoes.pipefy_envio_resultado(uuid, text, jsonb, text, text),
                          ops.fat_conector_pipefy_resultado(uuid, text, jsonb, text, text)
  to service_role;

drop view integracoes.fat_omie_reservaveis;
drop view integracoes.fat_pipefy_reservaveis;
drop function receita.fat_payload(uuid, text);

update integracoes.omie_envios set status = 'pendente' where status = 'bloqueado';
update integracoes.omie_envios set status = 'erro', erro_legivel = coalesce(erro_legivel, 'Pedido cancelado antes do envio.')
 where status = 'cancelado';
update integracoes.pipefy_envios set status = 'pendente' where status = 'bloqueado';
update integracoes.pipefy_envios set status = 'erro', erro_legivel = coalesce(erro_legivel, 'Pedido cancelado antes do envio.')
 where status = 'cancelado';
update integracoes.notificacoes set status = 'erro', erro_legivel = coalesce(erro_legivel, 'Pedido cancelado antes do envio.')
 where status = 'cancelado';

drop index integracoes.omie_envios_processando_idx;
alter table integracoes.omie_envios drop constraint omie_envios_status_check;
alter table integracoes.omie_envios add constraint omie_envios_status_check
  check (status in ('pendente', 'processando', 'ok', 'simulado', 'erro'));
alter table integracoes.omie_envios drop constraint omie_envios_payload_check;
alter table integracoes.omie_envios add constraint omie_envios_payload_check
  check (jsonb_typeof(payload) = 'object' and not (payload ?| array['app_key', 'app_secret']));
alter table integracoes.omie_envios drop constraint omie_envios_resposta_check;
alter table integracoes.omie_envios add constraint omie_envios_resposta_check
  check (resposta is null or jsonb_typeof(resposta) <> 'object' or not (resposta ?| array['app_key', 'app_secret']));
alter table integracoes.omie_envios drop column reserva, drop column reservado_ate;
comment on column integracoes.omie_envios.status is null;

alter table integracoes.pipefy_envios drop constraint pipefy_envios_status_check;
alter table integracoes.pipefy_envios add constraint pipefy_envios_status_check
  check (status in ('pendente', 'processando', 'ok', 'simulado', 'erro'));
alter table integracoes.pipefy_envios drop constraint pipefy_envios_payload_check;
alter table integracoes.pipefy_envios add constraint pipefy_envios_payload_check check (jsonb_typeof(payload) = 'object');
alter table integracoes.pipefy_envios drop constraint pipefy_envios_resposta_check;
alter table integracoes.pipefy_envios drop column reserva, drop column reservado_ate;

alter table integracoes.notificacoes drop constraint notificacoes_status_check;
alter table integracoes.notificacoes add constraint notificacoes_status_check
  check (status in ('pendente', 'processando', 'simulado', 'enviado', 'erro'));
alter table integracoes.notificacoes drop constraint notificacoes_resposta_check;

grant insert, update on receita.fat_pedidos, receita.fat_pedido_parcelas to service_role;

drop table receita.fat_ativadores;

commit;
