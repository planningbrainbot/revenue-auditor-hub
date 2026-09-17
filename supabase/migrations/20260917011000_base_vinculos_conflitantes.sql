begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
create or replace function ops.base_ingest_pipefy(
 _fonte text,_registro_id text,_fonte_at timestamptz,_lido_em timestamptz,_campos jsonb,_vinculos jsonb default '{}'
) returns jsonb language plpgsql security definer set search_path=ops,public,extensions as $$
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
end $$;
revoke all on function ops.base_ingest_pipefy(text,text,timestamptz,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function ops.base_ingest_pipefy(text,text,timestamptz,timestamptz,jsonb,jsonb) to service_role;

-- Leitura de alterações restrita ao mesmo escopo da empresa. Escrita remota é
-- feita pelo worker após confirmar valor anterior e reler o Pipefy.
notify pgrst,'reload schema';
commit;
