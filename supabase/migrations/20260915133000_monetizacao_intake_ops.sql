-- Incremento da carteira a partir do cadastro unificado. Sem merge por nome.
begin;
create index if not exists monetizacao_contas_empresa on ops.monetizacao_contas using gin(empresa_ids);
create table if not exists ops.monetizacao_ingest_pendencias (
  empresa_id integer primary key references ops.empresas(id), reason text not null,
  observed_at timestamptz not null default now()
);
alter table ops.monetizacao_ingest_pendencias enable row level security;
revoke all on ops.monetizacao_ingest_pendencias from anon,authenticated;
grant all on ops.monetizacao_ingest_pendencias to service_role;

create or replace function ops.monetizacao_intake_ops() returns jsonb
language plpgsql security definer set search_path=ops,public,extensions as $$
declare e record; matches text[]; k text; un integer; contract_id bigint; p jsonb; n integer:=0; linked integer:=0;
begin
 for e in select emp.* from ops.empresas emp where not exists(select 1 from ops.monetizacao_contas a where emp.id=any(a.empresa_ids)) order by emp.id limit 500 loop
  select array_agg(distinct a.key) into matches from ops.monetizacao_contas a left join ops.monetizacao_detalhes d on d.account_key=a.key
   where (nullif(e.pipefy_record_id,'') is not null and (a.perfil->'source_ids') ? ('pf:'||e.pipefy_record_id))
   or (length(regexp_replace(coalesce(e.cnpj,''),'\D','','g'))=14 and regexp_replace(e.cnpj,'\D','','g')<>'00000000000000' and exists(select 1 from jsonb_array_elements_text(coalesce(d.detalhe->'cnpjs','[]')) c where regexp_replace(c,'\D','','g')=regexp_replace(e.cnpj,'\D','','g')));
  if cardinality(matches)>1 then
   insert into ops.monetizacao_ingest_pendencias(empresa_id,reason) values(e.id,'CNPJ/Pipefy aponta para mais de uma conta; revisão de identidade necessária') on conflict(empresa_id) do update set observed_at=now();
   continue;
  end if;
  select u.id into un from ops.unidades u where lower(translate(u.nome_da_praca,'áàâãéêíóôõúç','aaaaeeiooouc'))=lower(translate(case when e.unidade='Sudeste (RJ)' then 'Rio de Janeiro' when e.unidade='Goiânia / Matriz' then 'Matriz' else e.unidade end,'áàâãéêíóôõúç','aaaaeeiooouc')) and u.nome_da_praca not in ('Consultoria','Construção Civil') limit 1;
  if cardinality(matches)=1 then
   update ops.monetizacao_contas a set empresa_ids=array(select distinct unnest(a.empresa_ids||array[e.id])),unidade_ids=array(select distinct x from unnest(a.unidade_ids||array[un]) x where x is not null),perfil=jsonb_set(a.perfil,'{source_ids}',coalesce(a.perfil->'source_ids','[]')||jsonb_build_array('ops:'||e.id)),updated_at=now() where a.key=matches[1];
   linked:=linked+1;
  else
   k:='ops-'||e.id;
   select c.pipedrive_deal_id::bigint into contract_id from ops.contratos c where c.empresa_id=e.id and c.ganho_em is not null and c.pipedrive_deal_id ~ '^\d+$' order by c.ganho_em,c.id limit 1;
   p:=jsonb_build_object('key',k,'name',coalesce(nullif(e.razao_social,''),nullif(e.titulo,''),'Cadastro Ops '||e.id),'units','[]'::jsonb,'unit_label',e.unidade,'orgs','[]'::jsonb,'contact',false,'band',null,'regime',e.regime_tributario,'segment',e.segmento,'segment_source','ops.empresas','segment_at',now(),'segment_conflict',false,'band_conflict',false,'regime_conflict',false,'old_base',e.origem_da_base='Base Antiga','matrix',e.unidade in ('Matriz','Goiânia / Matriz'),'new_commercial',contract_id is not null,'pipedrive_contract',contract_id is not null,'pipedrive_contract_id',contract_id,'consultoria_priority',un is not null,'finance_candidate',false,'finance',jsonb_build_object('status','revisar','reason','Confirmar faturamento atual'),'ecd',false,'source_ids',jsonb_build_array('ops:'||e.id));
   insert into ops.monetizacao_contas(key,perfil,empresa_ids,unidade_ids,source_at) values(k,p,array[e.id],case when un is null then '{}'::integer[] else array[un] end,now()) on conflict(key) do nothing;
   insert into ops.monetizacao_detalhes(account_key,detalhe) values(k,jsonb_build_object('cnpjs',case when nullif(e.cnpj,'') is null then '[]'::jsonb else jsonb_build_array(e.cnpj) end,'contacts','[]'::jsonb,'sources',jsonb_build_object('ops',1),'fields',jsonb_build_object('segmento',jsonb_build_object('value',e.segmento,'source','ops.empresas','at',now()),'regime',jsonb_build_object('value',e.regime_tributario,'source','ops.empresas','at',now()),'faixa',jsonb_build_object('value',null,'source',null,'at',null),'unidade',jsonb_build_object('value',e.unidade,'source','ops.empresas','at',now())))) on conflict(account_key) do nothing;
   n:=n+1;
  end if;
  delete from ops.monetizacao_ingest_pendencias where empresa_id=e.id;
 end loop;
 update ops.monetizacao_sync set catalog_at=now() where id;
 return jsonb_build_object('new',n,'linked',linked,'pending',(select count(*) from ops.monetizacao_ingest_pendencias));
end $$;
revoke all on function ops.monetizacao_intake_ops() from public,anon,authenticated;
grant execute on function ops.monetizacao_intake_ops() to service_role;
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

notify pgrst,'reload schema';
commit;
