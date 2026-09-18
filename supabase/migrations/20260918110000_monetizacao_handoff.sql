begin;
set local lock_timeout='3s';
alter table ops.monetizacao_envios add column if not exists handoff jsonb;
alter table ops.monetizacao_envios add column if not exists handoff_lease uuid;
alter table ops.monetizacao_envios add column if not exists handoff_until timestamptz;

-- O status sent e a fila complementar são persistidos na mesma transação.
create or replace function ops.monetizacao_handoff_pending() returns trigger
language plpgsql set search_path=ops,public as $$
begin
 if new.status='sent' and old.status is distinct from 'sent' and new.handoff is null then
  new.handoff:=jsonb_build_object('status','pending');
 end if;
 return new;
end $$;
drop trigger if exists monetizacao_handoff_pending on ops.monetizacao_envios;
create trigger monetizacao_handoff_pending before update on ops.monetizacao_envios
for each row execute function ops.monetizacao_handoff_pending();

-- Chamado apenas depois da criação/vinculação confirmada, com identidade e escopo auditados.
create or replace function ops.monetizacao_handoff_claim(_nonce uuid) returns jsonb
language plpgsql security definer set search_path=ops,public,extensions as $$
declare e ops.monetizacao_envios; a ops.monetizacao_contas; d jsonb; lease uuid:=gen_random_uuid(); people jsonb; channels jsonb; docs jsonb; contacts_allowed boolean;
begin
 select * into e from ops.monetizacao_envios where id=_nonce for update;
 if e.id is null or e.status<>'sent' or e.deal_id is null then return null;end if;
 if e.handoff->>'status'='complete' or e.handoff_until>now() then return null;end if;
 select * into a from ops.monetizacao_contas where key=e.account_key;
 select detalhe into d from ops.monetizacao_detalhes where account_key=a.key;
 contacts_allowed:=ops.can_user(e.actor_id,'view.contatos');
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.nome_completo,'email',c.email,'phone',c.whatsapp,'role',c.cargo,'source','Pipefy · contato vinculado')),'[]') into people
 from ops.contatos c left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
 where c.empresa_id=any(a.empresa_ids) and s.status is distinct from 'ausente' and contacts_allowed;
 select coalesce(jsonb_agg(distinct x),'[]') into channels from (
  select x from jsonb_array_elements(coalesce(d->'contacts','[]')) x where contacts_allowed and cardinality(a.empresa_ids)=0
  union all select jsonb_build_object('type',v.kind,'value',v.value,'source','Omie · canal da empresa')
  from ops.base_conta_cnpjs c join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=c.cnpj
  cross join lateral(values('email',o.email),('telefone',o.telefone)) v(kind,value)
  where c.account_key=a.key and contacts_allowed and nullif(trim(v.value),'') is not null
  union all select jsonb_build_object('type',v.kind,'value',v.value,'source','Pipefy · empresa')
  from ops.empresas x cross join lateral(values('email',x.email_fiscal),('telefone',x.telefone)) v(kind,value)
  where x.id=any(a.empresa_ids) and contacts_allowed and nullif(trim(v.value),'') is not null
 ) q;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'title',coalesce(tipo,'Documento')||' · '||coalesce(data_assinatura::text,''),'url',link_documento,'source','Pipefy · contrato','at',data_assinatura)),'[]') into docs
 from ops.contratos_documentos where empresa_id=any(a.empresa_ids) and nullif(link_documento,'') is not null;
 update ops.monetizacao_envios set handoff_lease=lease,handoff_until=now()+interval '3 minutes',handoff=coalesce(handoff,'{}')||jsonb_build_object('status','working'),updated_at=now() where id=e.id;
 return jsonb_build_object('nonce',e.id,'lease',lease,'deal_id',e.deal_id,'org_id',e.org_id,'product',e.product,
  'account',a.perfil,'detail',coalesce(d,'{}')-'contacts','contacts',people,'channels',channels,'documents',docs,'contacts_allowed',contacts_allowed,
  'cnpjs',(select coalesce(jsonb_agg(cnpj),'[]') from ops.base_conta_cnpjs where account_key=a.key),
  'review',(select review from ops.monetizacao_itens where id=e.item_id),
  'contract_ids',(select coalesce(jsonb_agg(distinct pipedrive_deal_id::bigint),'[]') from ops.contratos where empresa_id=any(a.empresa_ids) and pipedrive_deal_id ~ '^\d+$'));
end $$;

create or replace function ops.monetizacao_handoff_finish(_nonce uuid,_lease uuid,_result jsonb) returns void
language plpgsql security definer set search_path=ops,public,extensions as $$
declare e ops.monetizacao_envios;
begin
 if _result->>'status' not in ('complete','partial') then raise exception 'Estado de preenchimento inválido';end if;
 update ops.monetizacao_envios set handoff=_result||jsonb_build_object('updated_at',now()),handoff_lease=null,handoff_until=null,updated_at=now()
 where id=_nonce and handoff_lease=_lease returning * into e;
 if e.id is null then raise exception 'Execução de preenchimento substituída';end if;
 insert into ops.monetizacao_audit(list_id,action,actor_id,detail)
 select list_id,'handoff_'||(_result->>'status'),e.actor_id,jsonb_build_object('nonce',e.id,'deal_id',e.deal_id,'result',_result)
 from ops.monetizacao_itens where id=e.item_id;
end $$;
revoke all on function ops.monetizacao_handoff_claim(uuid),ops.monetizacao_handoff_finish(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function ops.monetizacao_handoff_claim(uuid),ops.monetizacao_handoff_finish(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
