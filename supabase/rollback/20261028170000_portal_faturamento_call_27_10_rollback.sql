-- Rollback de 20261028170000_portal_faturamento_call_27_10.sql: tira a busca de clientes e a lista de projetos, e
-- devolve o receita.fat_transicao de antes (envio do Pipefy sempre montado; o conector decide pelo pipefy_sync).

begin;

drop function if exists ops.fat_clientes_busca(uuid, text);
drop function if exists ops.fat_projetos(uuid);

create or replace function receita.fat_transicao(p_pedido uuid, p_para text, p_motivo text DEFAULT NULL::text, p_evento text DEFAULT NULL::text, p_diff jsonb DEFAULT '{}'::jsonb)
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
                              when p_para = 'devolvido' or (p_para = 'na_fila_omie' and _p.status <> 'erro_omie') then null
                              else conferido_por end
   where id = p_pedido
  returning * into _n;
  perform set_config('receita.fat_transicao', '', true);

  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('pedido', _n.id, _n.emissora_id, coalesce(p_evento, p_para), _p.status, p_para,
          coalesce(p_diff, '{}'::jsonb)
            || case when _motivo is not null then jsonb_build_object('motivo', _motivo) else '{}'::jsonb end,
          auth.uid());

  -- Pedido cancelado: o que ainda esperava a fila não sai mais (Omie, Pipefy e e-mail). O envio em curso termina e o
  -- resultado vira omie_resultado_ignorado.
  if p_para = 'cancelado' then
    update integracoes.omie_envios set status = 'cancelado', erro_legivel = 'Pedido cancelado antes do envio.'
     where origem = 'fat_pedido' and origem_id = _n.id and status in ('pendente', 'bloqueado');
    update integracoes.pipefy_envios set status = 'cancelado', erro_legivel = 'Pedido cancelado antes do envio.'
     where origem = 'fat_pedido' and origem_id = _n.id and status in ('pendente', 'erro', 'bloqueado');
    update integracoes.notificacoes set status = 'cancelado', erro_legivel = 'Pedido cancelado antes do envio.'
     where pedido_id = _n.id and status = 'pendente';
  end if;

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
  elsif _n.na_fila_em is not null
        and (p_para <> 'cancelado'
             or exists (select 1 from integracoes.pipefy_envios x
                         where x.origem = 'fat_pedido' and x.origem_id = _n.id and x.operacao = 'criar_card'
                           and x.status in ('ok', 'simulado'))) then
    insert into integracoes.pipefy_envios (emissora_id, origem, origem_id, operacao, payload)
    values (_n.emissora_id, 'fat_pedido', _n.id, 'mover_fase', jsonb_build_object(
      'versao', 1, 'de', _p.status, 'para', p_para, 'evento', coalesce(p_evento, p_para), 'motivo', _motivo,
      'pedido', jsonb_build_object('id', _n.id, 'numero', _n.numero, 'omie_os_codigo', _n.omie_os_codigo,
                                   'omie_nf_numero', _n.omie_nf_numero, 'omie_nf_link', _n.omie_nf_link,
                                   'omie_nf_emitida_em', _n.omie_nf_emitida_em)));
  end if;
  return _n;
end $function$;

commit;
