begin;
set local lock_timeout='3s';
set local statement_timeout='45s';
-- Correlated aggregates preserve the canonical rules and only evaluate requested accounts.
create or replace view ops.base_conta_estado as
 with facts as (
 select a.*,coalesce(d.cnpjs,'{}') cnpjs,coalesce(o.unidades,'{}') omie_unidades,coalesce(o.registros,0) omie_registros,coalesce(o.fora_curitiba,false) omie_nova,
  coalesce(c.pipefy_ids,'{}') pipefy_ids,coalesce(c.pipedrive_ids,'{}') pipedrive_ids,coalesce(c.declarada,'{}') declarada,
  c.sincronizado,c.ausente,c.pendencias,coalesce(c.nao_lidas,0) nao_lidas,coalesce(c.empresas,0) cadastros,
  coalesce(p.n,0) contatos,coalesce(p.contatavel,false) or coalesce(o.contato,false) or (coalesce((a.perfil->>'contact')::boolean,false) and cardinality(a.empresa_ids)=0 and coalesce(o.registros,0)=0) com_contato,
  coalesce(e.registros,'[]') ecd_registros,
  md5(coalesce(array_to_string(d.cnpjs,','),'')||'|'||coalesce(array_to_string(o.unidades,','),'')||'|'||coalesce(array_to_string(c.pipedrive_ids,','),'')||'|'||coalesce((a.perfil->>'new_commercial'),'false')) fingerprint
 from ops.monetizacao_contas a
 left join lateral (
  select array_agg(distinct cnpj order by cnpj) cnpjs from ops.base_conta_cnpjs where account_key=a.key
 ) d on true
 left join lateral (
  select array_agg(distinct ops.base_unidade(o.unidade) order by ops.base_unidade(o.unidade)) unidades,
   count(distinct (o.unidade,o.codigo_omie)) registros,
   bool_or(ops.base_unidade(o.unidade)<>'curitiba') fora_curitiba,
   bool_or(o.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(o.telefone,''),'\D','','g'))>=8) contato,
   max(coalesce(o.synced_at,o.updated_at)) atualizado
  from unnest(d.cnpjs) doc(cnpj) join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=doc.cnpj
 ) o on true
 left join lateral (
  select array_agg(distinct e.pipefy_record_id) filter(where e.pipefy_record_id is not null) pipefy_ids,
   array_agg(distinct e.pipedrive_id) filter(where nullif(e.pipedrive_id,'') is not null) pipedrive_ids,
   array_agg(distinct coalesce(sr.campos->>'origem_da_base',case when sr.registro_id is null then e.origem_da_base end)) filter(where nullif(coalesce(sr.campos->>'origem_da_base',case when sr.registro_id is null then e.origem_da_base end),'') is not null) declarada,
   min(e.pipefy_sincronizado_em) sincronizado,bool_or(e.pipefy_situacao='ausente') ausente,
   count(*) filter(where e.pipefy_record_id is not null and (e.pipefy_sincronizado_em is null or e.pipefy_situacao='pendente')) nao_lidas,
   count(*) empresas,jsonb_agg(sr.vinculos->'pendencias') filter(where sr.status='pendente') pendencias
  from ops.empresas e left join ops.base_sync_registros sr on sr.fonte='pipefy_empresa' and sr.registro_id=e.pipefy_record_id
  where e.id=any(a.empresa_ids)
 ) c on true
 left join lateral (
  select count(distinct c.id) n,
   bool_or(c.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(c.whatsapp,''),'\D','','g'))>=8) contatavel
  from ops.contatos c left join ops.base_sync_registros sr on sr.fonte='pipefy_contato' and sr.contato_id=c.id
  where c.empresa_id=any(a.empresa_ids) and sr.status is distinct from 'ausente'
 ) p on true
 left join lateral (
  select jsonb_agg(distinct jsonb_build_object('cnpj',e.cnpj,'year',e.ano,'source',e.origem,'registered_at',e.carregado_em)) registros
  from unnest(d.cnpjs) doc(cnpj) join ops.base_ecd_evidencias e on e.cnpj=doc.cnpj and e.ano between 1900 and extract(year from current_date)
 ) e on true
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


-- Manifesto leve: limites por chave tornam os lotes independentes, sem OFFSET.
-- Autorização é a mesma da leitura existente; o escopo é reavaliado em cada RPC.
create or replace function ops.base_carteira_manifesto() returns jsonb
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare pages jsonb; total integer; all_units boolean; units integer[];
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) then raise exception 'Sem acesso à base de clientes';end if;
 all_units:=ops.monetizacao_scope('{}'); units:=array(select ops.minhas_unidades());
 with ordered as (
  select key,row_number() over(order by key) rn from ops.monetizacao_contas
  where all_units or unidade_ids && units
 ), chunks as (
  select (rn-1)/400 page,max(key) through,count(*) count from ordered group by 1
 ), boundaries as (
  select lag(through) over(order by page) after,through,count,page from chunks
 ) select coalesce(jsonb_agg(jsonb_build_object('after',after,'through',through,'count',count) order by page),'[]'),coalesce(sum(count),0) into pages,total from boundaries;
 return jsonb_build_object('pages',pages,'count',total,'catalog_at',(select catalog_at from ops.monetizacao_sync where id),'scope_signature',ops.base_access_signature());
end $$;
revoke all on function ops.base_carteira_manifesto() from public,anon;
grant execute on function ops.base_carteira_manifesto() to authenticated;

-- Perfil e metadados no mesmo snapshot/round-trip. Continua limitado a 400 contas.
create or replace function ops.base_carteira_pagina(_after text default null,_through text default null) returns jsonb
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare rows jsonb; keys text[]; all_units boolean; units integer[];
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) then raise exception 'Sem acesso à base de clientes';end if;
 if length(_after)>80 or length(_through)>80 then raise exception 'Limite de página inválido';end if;
 all_units:=ops.monetizacao_scope('{}'); units:=array(select ops.minhas_unidades());
 select coalesce(jsonb_agg(to_jsonb(a) order by a.key),'[]'),coalesce(array_agg(a.key order by a.key),'{}') into rows,keys from (
  select key,perfil,unidade_ids from ops.monetizacao_contas
  where (all_units or unidade_ids && units) and (_after is null or key>_after) and (_through is null or key<=_through)
  order by key limit 400
 ) a;
 return jsonb_build_object('rows',rows,'base',case when cardinality(keys)>0 then ops.base_unica_catalogo(keys) else '[]'::jsonb end,
  'next',case when cardinality(keys)=400 then keys[400] end,
  'catalog_at',(select catalog_at from ops.monetizacao_sync where id),'scope_signature',ops.base_access_signature());
end $$;
revoke all on function ops.base_carteira_pagina(text,text) from public,anon;
grant execute on function ops.base_carteira_pagina(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
