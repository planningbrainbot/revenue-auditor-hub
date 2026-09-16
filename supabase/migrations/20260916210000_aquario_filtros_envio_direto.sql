begin;
-- Autorização explícita: o operador pode enviar uma seleção sem validação do sócio.
-- Mantém escopo, produto elegível, reserva por conta/produto e trilha do ator.
CREATE OR REPLACE FUNCTION ops.monetizacao_claim(_item uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare i ops.monetizacao_itens; l ops.monetizacao_listas; a ops.monetizacao_contas; e ops.monetizacao_envios; issue text;
begin
 if not ops.monetizacao_can('send.monetizacao') then raise exception 'Sem permissão para enviar ao Pipedrive'; end if;
 select * into i from ops.monetizacao_itens where id=_item for update;
 select * into l from ops.monetizacao_listas where id=i.list_id for update;
 if l.id is null or not ops.monetizacao_list_scope(l.id) then raise exception 'Lista fora do escopo'; end if;
 select * into a from ops.monetizacao_contas where key=i.account_key for update;
 if not ops.monetizacao_scope(a.unidade_ids) then raise exception 'Conta fora do escopo'; end if;
 if i.status in ('sent','sending','uncertain') then return jsonb_build_object('claimed',false,'status',i.status,'deal_id',i.deal_id); end if;
 if l.status not in ('draft','validated') or i.status not in ('draft','validated','blocked') then raise exception 'Esta oportunidade não está disponível para envio'; end if;
 issue:=ops.monetizacao_offer_issue(a.perfil,i.product,i.review);
 if issue is not null then raise exception 'O cadastro mudou: %',issue; end if;
 if exists(select 1 from ops.monetizacao_envios where account_key=i.account_key and product=i.product and status in ('sending','sent','uncertain')) then return jsonb_build_object('claimed',false,'status','blocked','reason','Já existe um envio desta empresa/produto. Confira o CRM.'); end if;
 insert into ops.monetizacao_envios(item_id,account_key,product,status,actor_id) values(i.id,i.account_key,i.product,'sending',auth.uid()) returning * into e;
 update ops.monetizacao_itens set status='sending',reason=null where id=i.id;
 insert into ops.monetizacao_audit(list_id,action,actor_id,detail) values(l.id,'send_claim',auth.uid(),jsonb_build_object('item_id',i.id,'nonce',e.id,'revision',l.revision,'mode',case when l.validated_at is null then 'direct' else 'partner_validated' end));
 return jsonb_build_object('claimed',true,'nonce',e.id,'item',to_jsonb(i),'account',a.perfil,'org_ids',a.org_ids,'owner_id',l.owner_id);
end $function$;

create or replace function ops.monetizacao_base_origins()
returns table(account_key text, origin jsonb)
language sql stable security definer set search_path=ops,public,extensions as $$
 with scoped as (
  select c.* from ops.monetizacao_contas c
  where (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao'))
    and ops.monetizacao_scope(c.unidade_ids)
 ), facts as (
  select c.key,
   coalesce(bool_or(trim(e.origem_da_base)='Base Antiga'),false) as antiga,
   coalesce(bool_or(trim(e.origem_da_base)='Base Nova'),false) as nova,
   coalesce((c.perfil->>'new_commercial')::boolean,false) or coalesce(c.perfil#>>'{consultoria_origin,status}'='comercial',false) as comercial,
   coalesce(c.perfil#>>'{consultoria_origin,status}'='retroativa',false) as retroativa
  from scoped c left join ops.empresas e on e.id=any(c.empresa_ids)
  group by c.key,c.perfil
 ), classified as (
  select *,case when antiga and (nova or comercial) then 'divergente'
    when antiga then 'antiga' when nova or comercial then 'nova'
    when retroativa then 'antiga' else 'confirmar' end as classification
  from facts
 )
 select key,jsonb_build_object(
  'status',classification,'commercial',comercial,
  'source',case when antiga or nova then 'Ops · empresas.origem_da_base, confrontado com os fechamentos comerciais'
    when comercial then 'CRM · fechamento comercial identificado na conta conciliada'
    when retroativa then 'Origem retroativa conferida no Ops/Pipefy'
    else 'Sem origem explícita ou fechamento comercial comprovado' end,
  'reason',case classification
   when 'divergente' then 'Há Base Antiga no cadastro e também Base Nova ou fechamento comercial. Conferir a origem; excluída da Consultoria retroativa.'
   when 'antiga' then 'Base Antiga registrada na carteira da unidade, sem fechamento comercial identificado no cruzamento.'
   when 'nova' then case when nova then 'Base Nova registrada no cadastro da unidade.' else 'Fechamento comercial identificado; tratada como Base Nova.' end
   else 'Origem não comprovada. Ausência de contrato, contato ou CNPJ não comprova Base Antiga.' end)
 from classified
$$;
revoke all on function ops.monetizacao_base_origins() from public,anon;
grant execute on function ops.monetizacao_base_origins() to authenticated;
notify pgrst,'reload schema';
commit;
