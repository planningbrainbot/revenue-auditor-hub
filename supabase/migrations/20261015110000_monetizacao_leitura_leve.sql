-- Banco do Brain saturado no horário comercial (15/10/2026). Três cortes de custo da Monetização, sem mudar o que
-- cada pessoa vê:
-- 1. monetizacao_intake_ops só renova o carimbo da carteira (catalog_at) quando criou, ligou ou marcou alguma conta.
--    Antes renovava a cada rodada da carga (5 min), e cada aba aberta rebaixava a Base inteira (base_carteira_pagina).
-- 2. monetizacao_deals_leitura(): os cards com a permissão conferida uma vez por consulta, e não por linha (a policy
--    chamava monetizacao_can duas vezes e monetizacao_scope em cada um dos ~300 cards). Mesma regra da policy.
-- 3. monetizacao_itens_leitura(): o mesmo para os itens das listas, com a trava de fornecedor da policy restritiva.

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
 -- O carimbo da carteira só muda quando algo mudou (15/10/2026): antes ele mudava a cada rodada da carga (5 min) e
 -- toda aba aberta da Monetização e dos Cockpits rebaixava a Base inteira, o que saturava o banco no horário comercial.
 if n + coalesce(linked, 0) + coalesce(flagged, 0) > 0 then
  update ops.monetizacao_sync set catalog_at=now() where id;
 end if;
 return jsonb_build_object('new',n,'linked',linked,'contract_flagged',flagged,'pending',(select count(*) from ops.monetizacao_ingest_pendencias));
end $function$;

create or replace function ops.monetizacao_deals_leitura()
returns table (id bigint, payload jsonb, unidade_ids integer[])
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
declare
  v_pode boolean := ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao');
  v_todas boolean := coalesce((select e.todas_unidades from ops.usuario_escopo e where e.user_id = auth.uid()), false);
  v_minhas integer[] := array(select ops.minhas_unidades());
begin
  if not v_pode then return; end if;
  return query
  select d.id, d.payload, d.unidade_ids
    from ops.monetizacao_deals d
   where v_todas or coalesce(d.unidade_ids && v_minhas, false)
   order by d.id;
end
$$;
revoke all on function ops.monetizacao_deals_leitura() from public, anon;
grant execute on function ops.monetizacao_deals_leitura() to authenticated;

create or replace function ops.monetizacao_itens_leitura()
returns setof ops.monetizacao_itens
language plpgsql stable security definer set search_path = ops, public as $$
declare
  v_pode boolean := ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao');
  v_fornecedor boolean := coalesce(ops.base_ve_fornecedor(), false);
begin
  if not v_pode then return; end if;
  return query
  select i.*
    from ops.monetizacao_itens i
   where ops.monetizacao_list_scope(i.list_id)
     and (v_fornecedor or ops.base_conta_liberada(i.account_key))
   order by i.id;
end
$$;
revoke all on function ops.monetizacao_itens_leitura() from public, anon;
grant execute on function ops.monetizacao_itens_leitura() to authenticated;
