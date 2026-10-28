-- Rollback de 20261028200000_base_pedidos_unidade.sql.
-- Volta as quatro funções ao que estavam antes (copiadas do banco em 28/10/2026) e tira o que a migration criou.
-- Antes de rodar: publicar o base-clientes-sync anterior (sem os campos novos), senão o ingest recusa contatos.
-- As colunas novas (contatos.contato_nps, contatos.ativo, empresas.situacao_cadastro) e os pedidos ficam: apagar dado é decisão à parte.

CREATE OR REPLACE FUNCTION ops.base_conta_situacao(_ficha jsonb, _perfil jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare
  pv jsonb := coalesce(_ficha->'prova', '{}'::jsonb);
  nivel text := pv->>'nivel';
  provas jsonb := coalesce(pv->'provas', '[]'::jsonb);
  classe text := _ficha->'omie'->>'classe';
  so_matriz boolean := _ficha->'omie'->>'classe' = 'cliente'
    and coalesce(_ficha->'omie'->'cliente_em', '[]'::jsonb) = '["Planning Partners (Matriz)"]'::jsonb;
  criterios text[] := '{}';
  receita text := lower(coalesce(_perfil->>'situacao_receita', ''));
  recente boolean;
  grau integer;
begin
  if _ficha->'distrato'->>'estado' = 'concluido' then
    return jsonb_build_object('estado', 'ex_cliente', 'grau', null, 'rotulo', 'Ex-cliente', 'cita', 'nao',
      'motivo', 'Ex-cliente: distrato concluído na Central de Tratativas.');
  end if;
  if nivel = 'grupo' then
    return jsonb_build_object('estado', 'grupo', 'grau', null, 'rotulo', 'Empresa do grupo', 'cita', 'nao',
      'motivo', coalesce(pv->>'motivo', 'Empresa do grupo Planning.'));
  end if;
  if nivel = 'fornecedor' or classe in ('fornecedor', 'cliente_e_fornecedor') then
    return jsonb_build_object('estado', 'fornecedor', 'grau', null, 'rotulo', 'Fornecedor', 'cita', 'nao',
      'motivo', case
        when classe = 'cliente_e_fornecedor' then 'Fornecedor: tem as tags Cliente e Fornecedor no Omie, e qualquer tag Fornecedor tira da Base.'
        when classe = 'fornecedor' then 'Fornecedor: tag Fornecedor no Omie.'
        else coalesce(pv->>'motivo', 'Fornecedor.') end);
  end if;
  -- Contrato cancelado no Omie (Pedro, 27/10): quem só tem contrato cancelado e não pagou nos últimos 90 dias é
  -- ex-cliente, com a vigência final como data de saída. Vem depois de grupo e fornecedor, como o distrato vem antes.
  if coalesce((pv->>'contrato_cancelado')::boolean, false)
     and not coalesce((pv->>'recebido_em')::date >= current_date - 90, false)
     and not coalesce((pv->>'faturado_grupo_em')::date >= date_trunc('month', current_date - 90)::date, false) then
    return jsonb_build_object('estado', 'ex_cliente', 'grau', null, 'rotulo', 'Ex-cliente', 'cita', 'nao',
      'saida_em', pv->>'contrato_fim',
      'motivo', 'Ex-cliente: contrato cancelado no Omie' ||
        coalesce(' (fim em ' || to_char((pv->>'contrato_fim')::date, 'MM/YYYY') || ')', '') ||
        ' e sem pagamento nos últimos 90 dias.');
  end if;
  if provas ? 'ganho_pipedrive' then criterios := array_append(criterios, 'negócio ganho no Pipedrive'); end if;
  if provas ?| array['contrato', 'receber', 'faturado_grupo'] then
    criterios := array_append(criterios, 'contrato ou recebimento no Omie');
  end if;
  if jsonb_array_length(coalesce(_ficha->'empresa_ids', '[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(_ficha->'pipefy_ids', '[]'::jsonb)) > 0 then
    criterios := array_append(criterios, 'base de clientes do Pipefy');
  end if;
  if classe = 'cliente' and not so_matriz then criterios := array_append(criterios, 'tag Cliente no Omie da unidade'); end if;
  if cardinality(criterios) > 0 then
    recente := coalesce((pv->>'contrato_ativo')::boolean, false)
      or coalesce((pv->>'recebido_em')::date >= current_date - 90, false)
      or coalesce((pv->>'faturado_grupo_em')::date >= date_trunc('month', current_date - 90)::date, false);
    grau := case when recente then 4 when nivel = 'comprovado' then 3 when _ficha->>'origin' = 'antiga' then 2 else 1 end;
    return jsonb_build_object('estado', 'cliente', 'grau', grau, 'cita', 'sim', 'criterios', to_jsonb(criterios),
      'rotulo', case grau when 4 then 'Pagamento visto' when 3 then 'Prova de cliente' when 2 then 'Base Antiga sem prova'
                          else 'Base Nova sem prova' end,
      'motivo', 'Cliente pela regra: ' || array_to_string(criterios, ', ') || '.');
  end if;
  if so_matriz then
    if receita in ('baixada', 'inapta', 'suspensa', 'nula') then
      return jsonb_build_object('estado', 'nao_cliente', 'grau', null, 'rotulo', 'Não é cliente', 'cita', 'nao',
        'motivo', 'Não é cliente: só a tag Cliente do Omie da Matriz, com CNPJ ' || receita || ' na Receita.');
    end if;
    -- Lote da Matriz com CNPJ ativo (Pedro, 15/10 à tarde): conta como cliente, no grau mais baixo. Continua fora das
    -- ofertas (soTagDaMatriz, 06/10) até o sócio de Goiânia confirmar.
    return jsonb_build_object('estado', 'cliente', 'grau', case when _ficha->>'origin' = 'antiga' then 2 else 1 end,
      'cita', 'sim', 'criterios', to_jsonb(array['tag Cliente no Omie da Matriz']),
      'rotulo', case when _ficha->>'origin' = 'antiga' then 'Base Antiga sem prova' else 'Base Nova sem prova' end,
      'motivo', 'Cliente pela regra: tag Cliente no Omie da Matriz (lote de mar/2025), sem faturamento do grupo em 2026. O sócio de Goiânia confirma.');
  end if;
  return jsonb_build_object('estado', 'nao_cliente', 'grau', null, 'rotulo', 'Não é cliente', 'cita', 'nao',
    'motivo', 'Não é cliente: sem negócio ganho, base do Pipefy, tag Cliente, contrato nem recebimento' ||
      case when provas ? 'ecd' then ' (só a ECD na Planning)' else '' end || '.');
end $function$;

CREATE OR REPLACE FUNCTION ops.base_contatos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select c.id,c.nome_completo name,c.email,c.whatsapp phone,c.cargo role,array_agg(distinct a.key) accounts
 from ops.contatos c join ops.monetizacao_contas a on c.empresa_id=any(a.empresa_ids)
 left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
 where auth.uid() is not null and ops.monetizacao_can('view.contatos') and (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario')) and ops.monetizacao_scope(a.unidade_ids) and s.status is distinct from 'ausente'
   and ((select ops.base_ve_fornecedor()) or ops.base_conta_liberada(a.key))
 group by c.id,c.nome_completo,c.email,c.whatsapp,c.cargo
 ) x
$function$;

CREATE OR REPLACE FUNCTION ops.base_ingest_pipefy(_fonte text, _registro_id text, _fonte_at timestamp with time zone, _lido_em timestamp with time zone, _campos jsonb, _vinculos jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare s ops.base_sync_registros; e ops.empresas; c ops.contatos; eid integer; cid bigint;
 matches integer[]; refs text[]; un integer; schema_keys text[]; mapped jsonb; effective jsonb:=_campos; pending jsonb:='{}'; col text; old_value jsonb; previous jsonb;
begin
 if _fonte not in ('pipefy_empresa','pipefy_contato') or nullif(_registro_id,'') is null then raise exception 'Fonte ou registro inválido'; end if;
 perform pg_advisory_xact_lock(hashtextextended(_fonte||':'||_registro_id,0));
 select * into s from ops.base_sync_registros where fonte=_fonte and registro_id=_registro_id for update;
 if s.registro_id is not null and ((s.fonte_at is not null and _fonte_at is not null and s.fonte_at>_fonte_at) or (s.fonte_at is not distinct from _fonte_at and s.lido_em>_lido_em)) then
  return jsonb_build_object('status','stale','empresa_id',s.empresa_id,'contato_id',s.contato_id);
 end if;
 if _fonte='pipefy_empresa' then
  schema_keys:=array['titulo','razao_social','cnpj','segmento','unidade','regime_tributario','email_fiscal','telefone','erp','origem_da_base','pipedrive_id','origem_venda'];
  if exists(select 1 from jsonb_object_keys(_campos) k where not(k=any(schema_keys))) then raise exception 'Campo de empresa fora do contrato'; end if;
  select * into e from ops.empresas where pipefy_record_id=_registro_id for update;
  if e.id is null and coalesce((_vinculos->>'cnpj_valido')::boolean,false) and length(regexp_replace(coalesce(_campos->>'cnpj',''),'\D','','g'))=14 then
   select array_agg(id) into matches from ops.empresas where pipefy_record_id is null and regexp_replace(coalesce(cnpj,''),'\D','','g')=regexp_replace(_campos->>'cnpj','\D','','g');
   if cardinality(matches)=1 then select * into e from ops.empresas where id=matches[1] for update; end if;
  end if;
  -- Empresa que o sync do Pipedrive criou no dia do ganho, antes de o cadastro chegar ao Pipefy: o
  -- cadastro do Pipefy traz o mesmo deal em pipedrive_id e adota a linha em vez de colidir na chave única.
  if e.id is null and nullif(trim(coalesce(_campos->>'pipedrive_id','')),'') is not null then
   select * into e from ops.empresas where pipefy_record_id is null and pipedrive_id=trim(_campos->>'pipedrive_id') for update;
  end if;
  if _vinculos->>'unidade_id' ~ '^\d+$' then
   select id into un from ops.unidades where id=(_vinculos->>'unidade_id')::integer;
  end if;
  -- Primeiro espelhamento: não apaga dado enriquecido nem troca documento/vínculo
  -- sem revisão. O valor remoto fica no snapshot; a divergência é explícita.
  if e.id is not null then
   for col in select jsonb_object_keys(_campos) loop
    old_value:=to_jsonb(e)->col;
    if old_value is distinct from _campos->col and old_value not in ('null'::jsonb,'""'::jsonb)
     and ((s.registro_id is null and (coalesce(_campos->col,'null')='null'::jsonb or col in ('cnpj','pipedrive_id')))
       or (s.vinculos->'pendencias' ? col and s.campos->col is not distinct from _campos->col)) then
     effective:=jsonb_set(effective,array[col],old_value);
     pending:=pending||jsonb_build_object(col,jsonb_build_object('anterior',old_value,'pipefy',_campos->col));
    end if;
   end loop;
  end if;
  -- Um negócio pode estar repetido em cadastros da fonte. A tabela legada
  -- exige unicidade; manter o vínculo existente e registrar a colisão sem
  -- interromper a página inteira nem fundir empresas diferentes.
  if nullif(effective->>'pipedrive_id','') is not null and exists(
   select 1 from ops.empresas other where other.pipedrive_id=effective->>'pipedrive_id' and other.id is distinct from e.id
  ) then
   pending:=pending||jsonb_build_object('pipedrive_id',jsonb_build_object('anterior',e.pipedrive_id,'pipefy',_campos->'pipedrive_id','motivo','vinculo_ja_usado_por_outro_cadastro'));
   effective:=jsonb_set(effective,'{pipedrive_id}',coalesce(to_jsonb(e.pipedrive_id),'null'));
  end if;
  _vinculos:=_vinculos||jsonb_build_object('pendencias',pending);
  mapped:=effective||jsonb_build_object('pipefy_record_id',_registro_id,'unidade_id',un,'pipefy_sincronizado_em',_lido_em,'pipefy_atualizado_em',_fonte_at,'pipefy_situacao',case when pending='{}' then 'ok' else 'pendente' end);
  perform set_config('planning.pipefy_ingest','on',true);
  if e.id is null then
   e:=jsonb_populate_record(null::ops.empresas,mapped);
   insert into ops.empresas(pipefy_record_id,titulo,razao_social,cnpj,segmento,unidade,unidade_id,regime_tributario,email_fiscal,telefone,erp,origem_da_base,pipedrive_id,origem_venda,fonte_cadastro,tipo_unidade,pipefy_sincronizado_em,pipefy_atualizado_em,pipefy_situacao)
    values(_registro_id,e.titulo,e.razao_social,e.cnpj,e.segmento,e.unidade,un,e.regime_tributario,e.email_fiscal,e.telefone,e.erp,e.origem_da_base,e.pipedrive_id,e.origem_venda,'Pipefy',case when exists(select 1 from ops.unidades where id=un and tipo='regional') then 'franquia' else null end,_lido_em,_fonte_at,'ok') returning id into eid;
  else
   e:=jsonb_populate_record(e,mapped);
   update ops.empresas set pipefy_record_id=_registro_id,titulo=e.titulo,razao_social=e.razao_social,cnpj=e.cnpj,segmento=e.segmento,unidade=e.unidade,unidade_id=un,regime_tributario=e.regime_tributario,email_fiscal=e.email_fiscal,telefone=e.telefone,erp=e.erp,origem_da_base=e.origem_da_base,pipedrive_id=e.pipedrive_id,origem_venda=e.origem_venda,pipefy_sincronizado_em=_lido_em,pipefy_atualizado_em=_fonte_at,pipefy_situacao=case when pending='{}' then 'ok' else 'pendente' end where id=e.id returning id into eid;
  end if;
  perform set_config('planning.pipefy_ingest','off',true);
 else
  schema_keys:=array['nome_completo','cpf','email','whatsapp','cargo'];
  if exists(select 1 from jsonb_object_keys(_campos) k where not(k=any(schema_keys))) then raise exception 'Campo de contato fora do contrato'; end if;
  select * into c from ops.contatos where pipefy_record_id=_registro_id for update;
  select array_agg(value) into refs from jsonb_array_elements_text(coalesce(_vinculos->'empresas','[]')) v(value);
  if cardinality(refs)=1 then select id into eid from ops.empresas where pipefy_record_id=refs[1]; end if;
  if c.id is not null then
   for col in select jsonb_object_keys(_campos) loop
    old_value:=to_jsonb(c)->col;
    if old_value is distinct from _campos->col and old_value not in ('null'::jsonb,'""'::jsonb)
      and ((s.registro_id is null and coalesce(_campos->col,'null')='null'::jsonb)
        or (s.vinculos->'pendencias' ? col and s.campos->col is not distinct from _campos->col)) then
     effective:=jsonb_set(effective,array[col],old_value);pending:=pending||jsonb_build_object(col,jsonb_build_object('anterior',old_value,'pipefy',_campos->col));
    end if;
   end loop;
  end if;
  _vinculos:=_vinculos||jsonb_build_object('pendencias',pending);
  c:=jsonb_populate_record(c,effective);
  if c.id is null then
   insert into ops.contatos(pipefy_record_id,nome_completo,cpf,email,whatsapp,cargo,empresa_pipefy_record_id,empresa_id,synced_at)
    values(_registro_id,c.nome_completo,c.cpf,c.email,c.whatsapp,c.cargo,case when cardinality(refs)=1 then refs[1] else null end,eid,_lido_em) returning id into cid;
  else
   update ops.contatos set nome_completo=c.nome_completo,cpf=c.cpf,email=c.email,whatsapp=c.whatsapp,cargo=c.cargo,empresa_pipefy_record_id=case when cardinality(refs)=1 then refs[1] else null end,empresa_id=eid,synced_at=_lido_em,updated_at=now() where id=c.id returning id into cid;
  end if;
 end if;
 insert into ops.base_sync_registros(fonte,registro_id,empresa_id,contato_id,fonte_at,lido_em,campos,vinculos,status)
  values(_fonte,_registro_id,eid,cid,_fonte_at,_lido_em,_campos,_vinculos,case when pending='{}' then 'ok' else 'pendente' end)
 on conflict(fonte,registro_id) do update set empresa_id=excluded.empresa_id,contato_id=excluded.contato_id,fonte_at=excluded.fonte_at,lido_em=excluded.lido_em,campos=excluded.campos,vinculos=excluded.vinculos,status=excluded.status;
 update ops.monetizacao_sync set catalog_at=now() where id;
 return jsonb_build_object('status',case when pending='{}' then 'ok' else 'pending' end,'pending_fields',(select coalesce(jsonb_agg(k),'[]') from jsonb_object_keys(pending) k),'empresa_id',eid,'contato_id',cid);
end $function$;

CREATE OR REPLACE FUNCTION ops.base_unica_ficha(_keys text[] DEFAULT NULL::text[])
 RETURNS TABLE(key text, unidade_ids integer[], ficha jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 -- Regra de cliente (15/10): a ficha leva a situação (cliente, a confirmar, não é cliente, ex-cliente, fornecedor, grupo)
 -- e o grau de confiança de quem é cliente, calculados sobre a própria ficha.
 select f.key, f.unidade_ids, f.ficha || jsonb_build_object('situacao', ops.base_conta_situacao(f.ficha, f.perfil))
 from (
   select a.key, a.unidade_ids, a.perfil, jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end],
     'distrato',s.distrato,'consultoria',s.consultoria,'omie',om.omie,'prova',pv.prova) ficha
   from ops.base_conta_estado a
   left join ops.base_conta_sinais(_keys) s on s.key = a.key
   left join lateral ops.base_conta_omie_tags(a.cnpjs) om on true  -- tags do cadastro do Omie
   left join lateral (select ops.base_conta_prova(a.cnpjs, a.empresa_ids, a.ecd_registros, a.perfil, om.omie) prova) pv on true  -- prova de cliente (01/10)
   where _keys is null or a.key=any(_keys)
 ) f
$function$;

drop function if exists ops.base_pedido_abrir(text,text,bigint,jsonb,uuid), ops.base_pedido_churn_card(uuid,text,text),
 ops.base_pedido_cancelar(uuid), ops.base_pedidos_meus(), ops.base_pedidos_fila(text), ops.base_pedido_decidir(uuid,boolean,text,jsonb),
 ops.base_cnpj_checar(text), ops.base_contatos_resumo(), ops.base_conta_contatos(text,uuid), ops.base_pedido_claim(),
 ops.base_pedido_marcar(uuid,jsonb), ops.base_pedido_resultado(uuid,boolean,text,jsonb), ops.base_pedidos_churn_abertos(),
 ops.base_pedido_churn_fase(uuid,boolean,text), ops.base_pedido_json(ops.base_pedidos), ops.base_pedido_permissoes(),
 ops.base_pedido_pode_abrir(), ops.base_pedido_pode_decidir(), ops.base_pedido_unidade(integer[]);
delete from ops.area_chaves where permission_key in ('edit.base_unidade','manage.base_pedidos');
delete from ops.role_permissions where permission_key in ('edit.base_unidade','manage.base_pedidos');
