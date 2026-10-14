-- Contrato ganho volta a virar empresa e conta na Base (14/10/2026).
--
-- De 17/09 a 14/10/2026 o pipedrive-contratos-sync não criou nem ligou empresa nenhuma: o lote de
-- empresas reescrevia `titulo` de linha já confirmada no Pipefy, o guarda sync_empresa_to_pipefy
-- recusava o lote inteiro, e o erro era engolido. 71 contratos ganhos ficaram com empresa_id nulo e
-- fora da Base de clientes. A Edge Function foi corrigida no mesmo PR; aqui ficam os dois lados do
-- banco que impedem a falha de voltar por outro caminho:
--
-- 1. base_ingest_pipefy adota a empresa que o sync do Pipedrive criou, pelo deal em pipedrive_id,
--    quando o CNPJ não casa. Sem isso, o cadastro do Pipefy de um cliente sem CNPJ no deal colidia
--    na chave única de pipedrive_id e não entrava.
-- 2. monetizacao_intake_ops acende `pipedrive_contract` na conta que ganhou contrato depois de
--    nascer. Antes a marca só era gravada na criação da conta, e 94 contas com contrato ganho
--    ligado seguiam "Sem contrato ganho no Pipedrive" para Finance.
--
-- As duas funções partem da definição em produção em 14/10/2026 (pg_get_functiondef), que já
-- divergia das migrations de origem.

begin;

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

CREATE OR REPLACE FUNCTION ops.monetizacao_intake_ops()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare e record; matches text[]; k text; un integer; contract_id bigint; p jsonb; n integer:=0; linked integer:=0; flagged integer:=0;
begin
 for e in select emp.* from ops.empresas emp where not exists(select 1 from ops.monetizacao_contas a where emp.id=any(a.empresa_ids)) order by emp.id limit 500 loop
  select array_agg(distinct a.key) into matches from ops.monetizacao_contas a left join ops.monetizacao_detalhes d on d.account_key=a.key
   where (nullif(e.pipefy_record_id,'') is not null and (a.perfil->'source_ids') ? ('pf:'||e.pipefy_record_id))
   or (length(regexp_replace(coalesce(e.cnpj,''),'\D','','g'))=14 and regexp_replace(e.cnpj,'\D','','g')<>'00000000000000' and exists(select 1 from jsonb_array_elements_text(coalesce(d.detalhe->'cnpjs','[]')) c where regexp_replace(c,'\D','','g')=regexp_replace(e.cnpj,'\D','','g')));
  if cardinality(matches)>1 then
   insert into ops.monetizacao_ingest_pendencias(empresa_id,reason) values(e.id,'CNPJ/Pipefy aponta para mais de uma conta; revisão de identidade necessária') on conflict(empresa_id) do update set observed_at=now();
   continue;
  end if;
  select u.id into un from ops.unidades u where lower(translate(u.nome_da_praca,'áàâãéêíóôõúç','aaaaeeiooouc'))=lower(translate(case when e.unidade='Sudeste (RJ)' then 'Rio de Janeiro' when e.unidade in ('Goiânia / Matriz','Matriz') then 'Goiânia' else e.unidade end,'áàâãéêíóôõúç','aaaaeeiooouc')) and u.nome_da_praca not in ('Consultoria','Construção Civil') limit 1;
  if cardinality(matches)=1 then
   update ops.monetizacao_contas a set empresa_ids=array(select distinct unnest(a.empresa_ids||array[e.id])),unidade_ids=array(select distinct x from unnest(a.unidade_ids||array[un]) x where x is not null),perfil=jsonb_set(a.perfil,'{source_ids}',coalesce(a.perfil->'source_ids','[]')||jsonb_build_array('ops:'||e.id)),updated_at=now() where a.key=matches[1];
   linked:=linked+1;
  else
   k:='ops-'||e.id;
   select c.pipedrive_deal_id::bigint into contract_id from ops.contratos c where c.empresa_id=e.id and c.ganho_em is not null and c.pipedrive_deal_id ~ '^\d+$' order by c.ganho_em,c.id limit 1;
   p:=jsonb_build_object('key',k,'name',coalesce(nullif(e.razao_social,''),nullif(e.titulo,''),'Cadastro Ops '||e.id),'units','[]'::jsonb,'unit_label',e.unidade,'orgs','[]'::jsonb,'contact',false,'band',null,'regime',e.regime_tributario,'segment',e.segmento,'segment_source','ops.empresas','segment_at',now(),'segment_conflict',false,'band_conflict',false,'regime_conflict',false,'old_base',e.origem_da_base='Base Antiga','matrix',e.unidade in ('Matriz','Goiânia / Matriz','Goiânia'),'new_commercial',contract_id is not null,'pipedrive_contract',contract_id is not null,'pipedrive_contract_id',contract_id,'consultoria_priority',un is not null,'finance_candidate',false,'finance',jsonb_build_object('status','revisar','reason','Confirmar faturamento atual'),'ecd',false,'source_ids',jsonb_build_array('ops:'||e.id));
   insert into ops.monetizacao_contas(key,perfil,empresa_ids,unidade_ids,source_at) values(k,p,array[e.id],case when un is null then '{}'::integer[] else array[un] end,now()) on conflict(key) do nothing;
   insert into ops.monetizacao_detalhes(account_key,detalhe) values(k,jsonb_build_object('cnpjs',case when nullif(e.cnpj,'') is null then '[]'::jsonb else jsonb_build_array(e.cnpj) end,'contacts','[]'::jsonb,'sources',jsonb_build_object('ops',1),'fields',jsonb_build_object('segmento',jsonb_build_object('value',e.segmento,'source','ops.empresas','at',now()),'regime',jsonb_build_object('value',e.regime_tributario,'source','ops.empresas','at',now()),'faixa',jsonb_build_object('value',null,'source',null,'at',null),'unidade',jsonb_build_object('value',e.unidade,'source','ops.empresas','at',now())))) on conflict(account_key) do nothing;
   n:=n+1;
  end if;
  delete from ops.monetizacao_ingest_pendencias where empresa_id=e.id;
 end loop;
 -- Conta que nasceu sem contrato (cadastro do Pipefy, ou empresa ligada a uma conta que já existia) e
 -- ganhou contrato depois. Só acende o fato "tem contrato ganho no Pipedrive"; a origem comercial
 -- (new_commercial) não muda, porque ela tira a conta do Aquário retroativo de Consultoria.
 update ops.monetizacao_contas a set perfil=a.perfil||jsonb_build_object('pipedrive_contract',true,'pipedrive_contract_id',x.did),updated_at=now()
 from (select c.key,(select ct.pipedrive_deal_id::bigint from ops.contratos ct where ct.empresa_id=any(c.empresa_ids) and ct.ganho_em is not null and ct.pipedrive_deal_id ~ '^\d+$' order by ct.ganho_em,ct.id limit 1) did
  from ops.monetizacao_contas c where cardinality(c.empresa_ids)>0 and not coalesce((c.perfil->>'pipedrive_contract')::boolean,false)) x
 where a.key=x.key and x.did is not null;
 get diagnostics flagged=row_count;
 update ops.monetizacao_sync set catalog_at=now() where id;
 return jsonb_build_object('new',n,'linked',linked,'contract_flagged',flagged,'pending',(select count(*) from ops.monetizacao_ingest_pendencias));
end $function$;

commit;
