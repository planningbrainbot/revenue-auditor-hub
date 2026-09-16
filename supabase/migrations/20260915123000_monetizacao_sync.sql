begin;
alter table ops.monetizacao_sync add column if not exists run_id uuid;
create or replace function ops.monetizacao_start_sync() returns uuid
language plpgsql security definer set search_path=ops,public,extensions as $$
declare s ops.monetizacao_sync; run uuid:=gen_random_uuid();
begin
 select * into s from ops.monetizacao_sync where id for update;
 if s.status='running' and s.started_at>now()-interval '5 minutes' then return null; end if;
 update ops.monetizacao_sync set status='running',started_at=now(),run_id=run,error=null where id;
 return run;
end $$;
create or replace function ops.monetizacao_replace_snapshot(_run uuid,_snapshot jsonb) returns void
language plpgsql security definer set search_path=ops,public,extensions as $$
declare c jsonb; units integer[];
begin
 perform 1 from ops.monetizacao_sync where id and run_id=_run for update;
 if not found then raise exception 'Sincronização substituída por outra execução'; end if;
 if jsonb_typeof(_snapshot->'cards')<>'array' or jsonb_array_length(_snapshot->'cards') <> (_snapshot->>'verified_count')::integer then raise exception 'Contagem do CRM não foi conciliada'; end if;
 for c in select * from jsonb_array_elements(_snapshot->'cards') loop
  select array_agg(distinct u) into units from ops.monetizacao_contas a cross join unnest(a.unidade_ids) u where (c->>'org_id')::bigint=any(a.org_ids);
  insert into ops.monetizacao_deals(id,org_id,payload,unidade_ids) values((c->>'id')::bigint,(c->>'org_id')::bigint,c,coalesce(units,'{}')) on conflict(id) do update set org_id=excluded.org_id,payload=excluded.payload,unidade_ids=excluded.unidade_ids,updated_at=now();
 end loop;
 delete from ops.monetizacao_deals d where not exists(select 1 from jsonb_array_elements(_snapshot->'cards') entry where (entry->>'id')::bigint=d.id);
 -- Reserva enviada só é liberada para nova tentativa em mês posterior quando o negócio foi perdido.
 update ops.monetizacao_envios e set status='released',updated_at=now() from ops.monetizacao_deals d where d.id=e.deal_id and e.status='sent' and d.payload->>'status'='lost' and to_char(e.created_at at time zone 'America/Sao_Paulo','YYYY-MM')<to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM');
 update ops.monetizacao_sync set status='ok',measured_at=(_snapshot->>'measured_at')::timestamptz,stages=_snapshot->'stages',count=jsonb_array_length(_snapshot->'cards'),error=null where id;
end $$;
create or replace function ops.monetizacao_record_org(_nonce uuid,_org bigint) returns void
language plpgsql security definer set search_path=ops,public,extensions as $$
declare akey text;
begin
 select account_key into akey from ops.monetizacao_envios where id=_nonce and status='sending' for update;
 if akey is null then raise exception 'Reserva inválida'; end if;
 update ops.monetizacao_envios set org_id=_org,updated_at=now() where id=_nonce;
 update ops.monetizacao_contas set org_ids=array(select distinct unnest(org_ids||array[_org])),perfil=jsonb_set(perfil,'{orgs}',to_jsonb(array(select distinct unnest(org_ids||array[_org])))),updated_at=now() where key=akey;
end $$;

-- Atualiza campos provenientes do Ops sem trocar a identidade conciliada da conta.
create or replace function ops.monetizacao_refresh_ops() returns integer
language plpgsql security definer set search_path=ops,public,extensions as $$
declare a ops.monetizacao_contas; segment text; regimes text[]; segments text[]; has_contact boolean; n integer:=0;
begin
 for a in select * from ops.monetizacao_contas where cardinality(empresa_ids)>0 loop
  select array_agg(distinct e.segmento) filter(where nullif(trim(e.segmento),'') is not null and lower(e.segmento) not in ('não informado','nao informado','outros')),array_agg(distinct e.regime_tributario) filter(where nullif(trim(e.regime_tributario),'') is not null and lower(e.regime_tributario) not in ('não informado','nao informado','não tem cnpj','nao tem cnpj')) into segments,regimes from ops.empresas e where e.id=any(a.empresa_ids);
  select exists(select 1 from ops.contatos c where c.empresa_id=any(a.empresa_ids) and (nullif(trim(c.email),'') is not null or nullif(trim(c.whatsapp),'') is not null)) into has_contact;
  if cardinality(segments)=1 then a.perfil:=a.perfil||jsonb_build_object('segment',segments[1],'segment_source','ops.empresas','segment_at',now(),'segment_conflict',false);
  elsif cardinality(segments)>1 then a.perfil:=a.perfil||jsonb_build_object('segment_conflict',true); end if;
  if cardinality(regimes)=1 then
   if nullif(a.perfil->>'regime','') is null or a.perfil->>'regime'=regimes[1] then a.perfil:=a.perfil||jsonb_build_object('regime',regimes[1]);
   else a.perfil:=a.perfil||jsonb_build_object('regime_conflict',true); end if;
  elsif cardinality(regimes)>1 then a.perfil:=a.perfil||jsonb_build_object('regime_conflict',true); end if;
  a.perfil:=a.perfil||jsonb_build_object('contact',has_contact or coalesce((a.perfil->>'contact')::boolean,false));
  update ops.monetizacao_contas set perfil=a.perfil,updated_at=now() where key=a.key;
  update ops.monetizacao_detalhes d set detalhe=jsonb_set(d.detalhe,'{contacts}',coalesce((select jsonb_agg(distinct x) from (select x from jsonb_array_elements(coalesce(d.detalhe->'contacts','[]')) x where x->>'source' not in ('ops.contatos.live') union all select jsonb_build_object('type','email','value',email,'source','ops.contatos.live','at',updated_at) from ops.contatos where empresa_id=any(a.empresa_ids) and nullif(trim(email),'') is not null union all select jsonb_build_object('type','whatsapp','value',whatsapp,'source','ops.contatos.live','at',updated_at) from ops.contatos where empresa_id=any(a.empresa_ids) and nullif(trim(whatsapp),'') is not null) t),'[]')),updated_at=now() where account_key=a.key;
  update ops.monetizacao_detalhes d set detalhe=jsonb_set(jsonb_set(d.detalhe,'{fields}',coalesce(d.detalhe->'fields','{}')),'{fields,segmento}',jsonb_build_object('value',a.perfil->>'segment','source',coalesce(a.perfil->>'segment_source','base reconciliada'),'at',coalesce(a.perfil->>'segment_at',a.source_at::text))) where account_key=a.key;
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function ops.monetizacao_start_sync(),ops.monetizacao_replace_snapshot(uuid,jsonb),ops.monetizacao_record_org(uuid,bigint),ops.monetizacao_refresh_ops() from public,anon,authenticated;
grant execute on function ops.monetizacao_start_sync(),ops.monetizacao_replace_snapshot(uuid,jsonb),ops.monetizacao_record_org(uuid,bigint),ops.monetizacao_refresh_ops() to service_role;
notify pgrst,'reload schema';
commit;
