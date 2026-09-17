begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
create or replace function ops.base_identity_conflict(_pending jsonb) returns boolean language sql immutable as $$
 select exists(select 1 from jsonb_array_elements(coalesce(_pending,'[]')) p
 where nullif(p#>>'{cnpj,pipefy}','') is not null
 and ops.base_cnpj(p#>>'{cnpj,pipefy}') is distinct from ops.base_cnpj(p#>>'{cnpj,anterior}'))
$$;
create or replace view ops.base_conta_estado as
 with docs as materialized (select account_key,array_agg(distinct cnpj order by cnpj) cnpjs from ops.base_conta_cnpjs group by 1),
 omie as materialized (
  select d.account_key,array_agg(distinct ops.base_unidade(o.unidade) order by ops.base_unidade(o.unidade)) unidades,
   count(distinct (o.unidade,o.codigo_omie)) registros,
   bool_or(ops.base_unidade(o.unidade)<>'curitiba') fora_curitiba,
   bool_or(o.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(o.telefone,''),'\D','','g'))>=8) contato,
   max(coalesce(o.synced_at,o.updated_at)) atualizado
  from ops.base_conta_cnpjs d join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=d.cnpj group by 1
 ),
 companies as materialized (
  select a.key,array_agg(distinct e.pipefy_record_id) filter(where e.pipefy_record_id is not null) pipefy_ids,
  array_agg(distinct e.pipedrive_id) filter(where nullif(e.pipedrive_id,'') is not null) pipedrive_ids,
  array_agg(distinct coalesce(sr.campos->>'origem_da_base',case when sr.registro_id is null then e.origem_da_base end)) filter(where nullif(coalesce(sr.campos->>'origem_da_base',case when sr.registro_id is null then e.origem_da_base end),'') is not null) declarada,
  array_agg(distinct e.unidade_id) filter(where e.unidade_id is not null) unidades_pipefy,
  min(e.pipefy_sincronizado_em) sincronizado, bool_or(e.pipefy_situacao='ausente') ausente,
  count(*) filter(where e.pipefy_record_id is not null and (e.pipefy_sincronizado_em is null or e.pipefy_situacao='pendente')) nao_lidas,
  count(*) empresas,jsonb_agg(sr.vinculos->'pendencias') filter(where sr.status='pendente') pendencias
  from ops.monetizacao_contas a join ops.empresas e on e.id=any(a.empresa_ids) left join ops.base_sync_registros sr on sr.fonte='pipefy_empresa' and sr.registro_id=e.pipefy_record_id group by a.key
 ),
 contacts as materialized (
  select a.key,count(distinct c.id) n,
  bool_or(c.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'))>=8) contatavel
  from ops.monetizacao_contas a join ops.contatos c on c.empresa_id=any(a.empresa_ids)
  left join ops.base_sync_registros sr on sr.fonte='pipefy_contato' and sr.contato_id=c.id
  where sr.status is distinct from 'ausente' group by a.key
 ),
 ecd as materialized (select d.account_key,jsonb_agg(distinct jsonb_build_object('cnpj',e.cnpj,'year',e.ano,'source',e.origem,'registered_at',e.carregado_em)) registros from ops.base_conta_cnpjs d join ops.base_ecd_evidencias e on e.cnpj=d.cnpj and e.ano between 1900 and extract(year from current_date) group by 1),
 facts as (
 select a.*,coalesce(d.cnpjs,'{}') cnpjs,coalesce(o.unidades,'{}') omie_unidades,coalesce(o.registros,0) omie_registros,coalesce(o.fora_curitiba,false) omie_nova,
  coalesce(c.pipefy_ids,'{}') pipefy_ids,coalesce(c.pipedrive_ids,'{}') pipedrive_ids,coalesce(c.declarada,'{}') declarada,
  c.sincronizado,c.ausente,c.pendencias,coalesce(c.nao_lidas,0) nao_lidas,coalesce(c.empresas,0) cadastros,
  coalesce(p.n,0) contatos,coalesce(p.contatavel,false) or coalesce(o.contato,false) or (coalesce((a.perfil->>'contact')::boolean,false) and cardinality(a.empresa_ids)=0 and coalesce(o.registros,0)=0) com_contato,
  coalesce(e.registros,'[]') ecd_registros,
  md5(coalesce(array_to_string(d.cnpjs,','),'')||'|'||coalesce(array_to_string(o.unidades,','),'')||'|'||coalesce(array_to_string(c.pipedrive_ids,','),'')||'|'||coalesce((a.perfil->>'new_commercial'),'false')) fingerprint
 from ops.monetizacao_contas a left join docs d on d.account_key=a.key left join omie o on o.account_key=a.key left join companies c on c.key=a.key left join contacts p on p.key=a.key left join ecd e on e.account_key=a.key
 )
 select f.*,v.origem validacao_origem,v.responsavel,v.confirmado_em,
 case when ops.base_identity_conflict(f.pendencias) then 'confirmar' when f.omie_nova or coalesce((f.perfil->>'new_commercial')::boolean,false) then 'nova'
 when v.account_key is not null and v.fingerprint=f.fingerprint and (cardinality(f.pipefy_ids)=0 or f.declarada=array[case when v.origem='antiga' then 'Base Antiga' else 'Base Nova' end]) then v.origem
 else 'confirmar' end origem,
 case when ops.base_identity_conflict(f.pendencias) then 'CNPJ diverge entre Pipefy e Brain; confirmar a identidade antes de classificar ou enviar.' when f.omie_nova then 'Cadastro no Omie fora de Curitiba; pagamento não altera a origem.'
 when coalesce((f.perfil->>'new_commercial')::boolean,false) then 'Fechamento comercial identificado no Pipedrive.'
 when v.account_key is not null and v.fingerprint<>f.fingerprint then 'Novos vínculos encontrados; revisar a validação anterior.'
 when v.account_key is not null and cardinality(f.pipefy_ids)>0 and f.declarada<>array[case when v.origem='antiga' then 'Base Antiga' else 'Base Nova' end] then 'Validação registrada; aguardando confirmação da correção no Pipefy.'
 when v.account_key is not null then 'Origem confirmada com responsável e evidência.'
 when cardinality(f.omie_unidades)>0 then 'Curitiba tem base antiga e nova: confirmar com a unidade.'
 when cardinality(f.pipedrive_ids)>0 then 'Vínculo Pipedrive sem fechamento comprovado: regra em definição.'
 else 'Sem vínculo Omie/Pipedrive: validar origem com a unidade responsável.' end motivo,ops.base_identity_conflict(f.pendencias) identity_conflict
 from facts f left join ops.base_origem_validacoes v on v.account_key=f.key;
revoke all on ops.base_conta_estado from public,anon,authenticated;
grant select on ops.base_conta_estado to service_role;



create or replace function ops.base_unica_catalogo(_keys text[] default null) returns jsonb language sql stable security definer set search_path=ops,public,extensions as $$
 select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem='nova' and cardinality(a.pipefy_ids)>0 and a.declarada<>array['Base Nova'])),'[]')
 from ops.base_conta_estado a
 where auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao') or ops.monetizacao_can('view.clientes')) and ops.monetizacao_scope(a.unidade_ids) and (_keys is null or a.key=any(_keys))
$$;
create or replace function ops.base_validar_origem(_key text,_origem text,_responsavel text,_evidencia text) returns jsonb language plpgsql security definer set search_path=ops,public,extensions as $$
declare a record; e record; alvo text; pending integer:=0; previous jsonb;
begin
 if auth.uid() is null or not ops.monetizacao_can('manage.aquario') then raise exception 'Sem permissão para validar origem'; end if;
 select * into a from ops.base_conta_estado where key=_key;
 if a.key is null or not ops.monetizacao_scope(a.unidade_ids) then raise exception 'Conta fora do escopo';end if;
 if a.identity_conflict then raise exception 'Resolver a divergência de CNPJ antes de validar origem';end if;
 if _origem not in ('antiga','nova') or length(trim(_responsavel))<3 or length(trim(_evidencia))<10 then raise exception 'Informe origem, responsável e evidência da unidade';end if;
 if _origem='antiga' and (a.omie_nova or coalesce((a.perfil->>'new_commercial')::boolean,false)) then raise exception 'Há vínculo Omie fora de Curitiba ou fechamento comercial; a regra determina Base Nova';end if;
 alvo:=case when _origem='antiga' then 'Base Antiga' else 'Base Nova' end;
 insert into ops.base_origem_validacoes(account_key,origem,responsavel,evidencia,ator,fingerprint)
 values(_key,_origem,trim(_responsavel),trim(_evidencia),auth.uid(),a.fingerprint)
 on conflict(account_key) do update set origem=excluded.origem,responsavel=excluded.responsavel,evidencia=excluded.evidencia,ator=excluded.ator,fingerprint=excluded.fingerprint,confirmado_em=now();
 for e in select * from ops.empresas where id=any(a.empresa_ids) and pipefy_record_id is not null and coalesce((select campos->>'origem_da_base' from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id=empresas.pipefy_record_id),case when not exists(select 1 from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id=empresas.pipefy_record_id) then origem_da_base end) is distinct from alvo loop
  if exists(select 1 from ops.base_alteracoes where empresa_id=e.id and campo='origem_da_base' and (status in ('pending','sending') or (status='error' and tentativas<5))) then raise exception 'Já existe uma correção de origem em andamento';end if;
  select campos->'origem_da_base' into previous from ops.base_sync_registros where fonte='pipefy_empresa' and registro_id=e.pipefy_record_id;
  insert into ops.base_alteracoes(empresa_id,campo,valor_anterior,valor_proposto,ator_id,motivo,regra) values(e.id,'origem_da_base',coalesce(previous,to_jsonb(e.origem_da_base)),to_jsonb(alvo),auth.uid(),trim(_evidencia),'validacao-unidade-2026-09-16');pending:=pending+1;
 end loop;
 return jsonb_build_object('status',case when pending>0 then 'pending_source' else 'confirmed' end,'pending',pending);
end $$;
create or replace function ops.monetizacao_offer_issue(a jsonb,p text,r jsonb) returns text
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare b record; adjusted jsonb;
begin
 select * into b from ops.base_conta_estado where key=a->>'key';
 if b.key is null then return 'Conta ainda não conciliada na base única';end if;
 if b.identity_conflict then return 'CNPJ divergente entre fontes; revisar identidade antes de enviar';end if;
 if b.ausente then return 'Cadastro ausente no Pipefy; revisar a origem antes de enviar';end if;
 if p='consultoria' and b.origem<>'antiga' then return b.motivo;end if;
 adjusted:=a;
 if p='consultoria' then
  adjusted:=a||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo));
 end if;
 return ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
end $$;
update ops.monetizacao_sync set catalog_at=now() where id;
notify pgrst,'reload schema';
commit;
