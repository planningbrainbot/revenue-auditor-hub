begin;
set local lock_timeout = '3s';
set local statement_timeout = '25s';
-- Uma identidade comercial existente, múltiplas fontes; contatos e negócios ficam separados.
create or replace function ops.base_cnpj(_value text) returns text language plpgsql immutable as $$
declare n text:=regexp_replace(coalesce(_value,''),'\D','','g'); len integer; i integer; weight integer; total integer; digit integer;
begin
 if length(n)<>14 or n ~ '^([0-9])\1{13}$' then return null; end if;
 for len in 12..13 loop
  weight:=case when len=12 then 5 else 6 end;total:=0;
  for i in 1..len loop total:=total+substring(n,i,1)::integer*weight;weight:=case when weight=2 then 9 else weight-1 end;end loop;
  digit:=total%11;digit:=case when digit<2 then 0 else 11-digit end;
  if digit<>substring(n,len+1,1)::integer then return null;end if;
 end loop;
 return n;
end $$;
create or replace function ops.base_unidade(_value text) returns text language sql immutable as $$
 select case lower(trim(translate(coalesce(_value,''),'áàâãéêíóôõúç','aaaaeeiooouc')))
 when 'sudeste (rj)' then 'rio de janeiro' when 'goiania / matriz' then 'matriz' when 'goiania' then 'matriz' when 'partners' then 'matriz'
 else lower(trim(translate(coalesce(_value,''),'áàâãéêíóôõúç','aaaaeeiooouc'))) end
$$;
create table if not exists ops.base_origem_validacoes (
 account_key text primary key references ops.monetizacao_contas(key), origem text not null check(origem in ('antiga','nova')),
 responsavel text not null, evidencia text not null, ator uuid not null, confirmado_em timestamptz not null default now(),
 fingerprint text not null
);
alter table ops.base_origem_validacoes enable row level security;
revoke all on ops.base_origem_validacoes from public,anon,authenticated;
grant all on ops.base_origem_validacoes to service_role;

-- Vínculo calculado por CNPJ completo válido; nunca por nome/raiz.
create or replace view ops.base_conta_cnpjs as
 select distinct account_key,ops.base_cnpj(c.value) cnpj from ops.monetizacao_detalhes d cross join lateral jsonb_array_elements_text(coalesce(d.detalhe->'cnpjs','[]')) c(value) where ops.base_cnpj(c.value) is not null and not exists(select 1 from ops.monetizacao_contas a join ops.empresas e on e.id=any(a.empresa_ids) where a.key=d.account_key and e.pipefy_situacao='ok')
 union
 select distinct a.key,ops.base_cnpj(e.cnpj) from ops.monetizacao_contas a join ops.empresas e on e.id=any(a.empresa_ids) where ops.base_cnpj(e.cnpj) is not null;
revoke all on ops.base_conta_cnpjs from public,anon,authenticated;
grant select on ops.base_conta_cnpjs to service_role;
create index if not exists base_omie_cnpj on ops.omie_clientes(ops.base_cnpj(cnpj_cpf));
create index if not exists base_empresas_cnpj on ops.empresas(ops.base_cnpj(cnpj));

-- Incorpora Omie ao catálogo que já guarda listas e oportunidades. Não cria registros no Pipefy/CRM.
create or replace function ops.base_intake_omie() returns jsonb language plpgsql security definer set search_path=ops,public,extensions as $$
declare count_new integer; count_updated integer;
begin
 with grouped as (
  select ops.base_cnpj(o.cnpj_cpf) cnpj,min(o.razao_social) nome,array_agg(distinct u.id) filter(where u.id is not null) ids,
   string_agg(distinct u.nome_da_praca,' / ' order by u.nome_da_praca) unit_label,max(o.updated_at) source_at,
   bool_or(nullif(trim(o.email),'') is not null or nullif(trim(o.telefone),'') is not null) contato,
   jsonb_agg(jsonb_build_object('unidade',o.unidade,'codigo',o.codigo_omie)) refs
  from ops.omie_clientes o left join ops.unidades u on ops.base_unidade(u.nome_da_praca)=ops.base_unidade(o.unidade)
  where ops.base_cnpj(o.cnpj_cpf) is not null and not exists(select 1 from ops.base_conta_cnpjs c where c.cnpj=ops.base_cnpj(o.cnpj_cpf))
  group by 1
 ), inserted as (
  insert into ops.monetizacao_contas(key,perfil,unidade_ids,source_at)
  select 'omie-cnpj-'||cnpj,jsonb_build_object('key','omie-cnpj-'||cnpj,'name',coalesce(nome,'Cadastro Omie'),'units','[]'::jsonb,'unit_label',unit_label,'orgs','[]'::jsonb,'contact',contato,'band',null,'regime',null,'segment',null,'old_base',false,'matrix',coalesce(ids&&array(select id from ops.unidades where nome_da_praca='Matriz'),false),'new_commercial',false,'pipedrive_contract',false,'consultoria_priority',false,'finance_candidate',false,'finance',jsonb_build_object('status','fora_regra','reason','Sem contrato ganho no Pipedrive'),'ecd',false,'source_ids',jsonb_build_array('omie-cnpj:'||cnpj)),case when cardinality(ids)=1 then ids else '{}'::integer[] end,coalesce(source_at,now()) from grouped
  on conflict(key) do nothing returning key
 ) select count(*) into count_new from inserted;
 insert into ops.monetizacao_detalhes(account_key,detalhe)
 select a.key,jsonb_build_object('cnpjs',jsonb_build_array(substring(a.key from 11)),'contacts','[]'::jsonb,'sources',jsonb_build_object('omie',true)) from ops.monetizacao_contas a where a.key like 'omie-cnpj-%' and not exists(select 1 from ops.monetizacao_detalhes d where d.account_key=a.key)
 on conflict(account_key) do nothing;
 -- Os cadastros exclusivos do Omie também acompanham alterações posteriores.
 -- Quando vinculados ao Pipefy, a autoridade de nome/unidade passa a ser o Pipefy.
 with grouped as (
  select a.key,min(o.razao_social) nome,array_agg(distinct u.id) filter(where u.id is not null) ids,
   string_agg(distinct u.nome_da_praca,' / ' order by u.nome_da_praca) label,
   bool_or(o.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(regexp_replace(coalesce(o.telefone,''),'\D','','g'))>=8) contato
  from ops.monetizacao_contas a join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=substring(a.key from 11)
  left join ops.unidades u on ops.base_unidade(u.nome_da_praca)=ops.base_unidade(o.unidade)
  where a.key like 'omie-cnpj-%' and cardinality(a.empresa_ids)=0 group by a.key
 ), values_now as (
  select key,case when cardinality(ids)=1 then ids else '{}'::integer[] end ids,
  jsonb_build_object('name',coalesce(nome,'Cadastro Omie'),'unit_label',label,'contact',coalesce(contato,false),'units',coalesce((select jsonb_agg(mu.key) from ops.monetizacao_unidades mu where cardinality(g.ids)=1 and mu.unidade_id=any(g.ids)),'[]')) patch from grouped g
 )
 update ops.monetizacao_contas a set unidade_ids=g.ids,perfil=a.perfil||g.patch,updated_at=now()
 from values_now g where a.key=g.key and (a.unidade_ids is distinct from g.ids or a.perfil is distinct from a.perfil||g.patch);
 get diagnostics count_updated=row_count;
 if count_new+count_updated>0 then update ops.monetizacao_sync set catalog_at=now() where id;end if;
 return jsonb_build_object('new',count_new,'updated',count_updated);
end $$;
revoke all on function ops.base_intake_omie() from public,anon,authenticated;
grant execute on function ops.base_intake_omie() to service_role;

-- Metadados já presentes no Brain; não importa nem acessa escrituração fiscal bruta.
create or replace function ops.base_refinar_ecd() returns integer language plpgsql security definer set search_path=ops,public,extensions as $$
declare n integer;
begin
 insert into ops.ecd_empresa(cnpj,ano,origem,carregado_em)
 select distinct ops.base_cnpj(d.detalhe->'cnpjs'->>0),(d.detalhe#>>'{ecd_summary,exercise}')::smallint,'metadado_monetizacao',d.updated_at
 from ops.monetizacao_detalhes d where d.detalhe#>>'{ecd_summary,available}'='true'
 and jsonb_array_length(coalesce(d.detalhe->'cnpjs','[]'))=1 and ops.base_cnpj(d.detalhe->'cnpjs'->>0) is not null
 and d.detalhe#>>'{ecd_summary,exercise}' ~ '^20[0-9]{2}$'
 and (d.detalhe#>>'{ecd_summary,exercise}')::integer<=extract(year from current_date)
 and not exists(select 1 from ops.ecd_empresa e where e.cnpj=ops.base_cnpj(d.detalhe->'cnpjs'->>0) and e.ano=(d.detalhe#>>'{ecd_summary,exercise}')::smallint)
 on conflict do nothing;
 get diagnostics n=row_count;return n;
end $$;
revoke all on function ops.base_refinar_ecd() from public,anon,authenticated;
grant execute on function ops.base_refinar_ecd() to service_role;


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
 ecd as materialized (select d.account_key,jsonb_agg(distinct jsonb_build_object('cnpj',e.cnpj,'year',e.ano,'source',e.origem,'registered_at',e.carregado_em)) registros from ops.base_conta_cnpjs d join ops.ecd_empresa e on e.cnpj=d.cnpj and e.ano between 1900 and extract(year from current_date) group by 1),
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
 case when f.omie_nova or coalesce((f.perfil->>'new_commercial')::boolean,false) then 'nova'
 when v.account_key is not null and v.fingerprint=f.fingerprint and (cardinality(f.pipefy_ids)=0 or f.declarada=array[case when v.origem='antiga' then 'Base Antiga' else 'Base Nova' end]) then v.origem
 else 'confirmar' end origem,
 case when f.omie_nova then 'Cadastro no Omie fora de Curitiba; pagamento não altera a origem.'
 when coalesce((f.perfil->>'new_commercial')::boolean,false) then 'Fechamento comercial identificado no Pipedrive.'
 when v.account_key is not null and v.fingerprint<>f.fingerprint then 'Novos vínculos encontrados; revisar a validação anterior.'
 when v.account_key is not null and cardinality(f.pipefy_ids)>0 and f.declarada<>array[case when v.origem='antiga' then 'Base Antiga' else 'Base Nova' end] then 'Validação registrada; aguardando confirmação da correção no Pipefy.'
 when v.account_key is not null then 'Origem confirmada com responsável e evidência.'
 when cardinality(f.omie_unidades)>0 then 'Curitiba tem base antiga e nova: confirmar com a unidade.'
 when cardinality(f.pipedrive_ids)>0 then 'Vínculo Pipedrive sem fechamento comprovado: regra em definição.'
 else 'Sem vínculo Omie/Pipedrive: validar origem com a unidade responsável.' end motivo
 from facts f left join ops.base_origem_validacoes v on v.account_key=f.key;
revoke all on ops.base_conta_estado from public,anon,authenticated;
grant select on ops.base_conta_estado to service_role;

create or replace function ops.base_unica_catalogo(_keys text[] default null) returns jsonb language sql stable security definer set search_path=ops,public,extensions as $$
 select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem='nova' and cardinality(a.pipefy_ids)>0 and a.declarada<>array['Base Nova'])),'[]')
 from ops.base_conta_estado a
 where auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao') or ops.can('view.clientes')) and ops.monetizacao_scope(a.unidade_ids) and (_keys is null or a.key=any(_keys))
$$;
revoke all on function ops.base_unica_catalogo(text[]) from public,anon;
grant execute on function ops.base_unica_catalogo(text[]) to authenticated;

create or replace function ops.base_validar_origem(_key text,_origem text,_responsavel text,_evidencia text) returns jsonb language plpgsql security definer set search_path=ops,public,extensions as $$
declare a record; e record; alvo text; pending integer:=0; previous jsonb;
begin
 if auth.uid() is null or not ops.monetizacao_can('manage.aquario') then raise exception 'Sem permissão para validar origem'; end if;
 select * into a from ops.base_conta_estado where key=_key;
 if a.key is null or not ops.monetizacao_scope(a.unidade_ids) then raise exception 'Conta fora do escopo';end if;
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
revoke all on function ops.base_validar_origem(text,text,text,text) from public,anon;
grant execute on function ops.base_validar_origem(text,text,text,text) to authenticated;

create or replace function ops.base_sync_status() returns jsonb language sql stable security definer set search_path=ops,public,extensions as $$
 select case when auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.can('view.clientes')) then
 jsonb_build_object('sources',(select jsonb_agg(to_jsonb(s)) from (select distinct on(fonte) fonte,inicio,fim,status,recebidos,gravados,erro from ops.base_sync_execucoes order by fonte,inicio desc) s),'pending_changes',(select count(distinct b.id) from ops.base_alteracoes b join ops.monetizacao_contas a on b.empresa_id=any(a.empresa_ids) where b.status in ('pending','sending','error','conflict') and ops.monetizacao_scope(a.unidade_ids))) else null end
$$;
revoke all on function ops.base_sync_status() from public,anon;
grant execute on function ops.base_sync_status() to authenticated;


create policy base_clientes_contas_read on ops.monetizacao_contas for select to authenticated using (ops.can('view.clientes') and ops.monetizacao_scope(unidade_ids));
create policy base_clientes_unidades_read on ops.monetizacao_unidades for select to authenticated using (ops.can('view.clientes') and ops.monetizacao_scope(array[unidade_id]));
create policy base_clientes_sync_read on ops.monetizacao_sync for select to authenticated using (ops.can('view.clientes'));
create or replace function ops.base_contatos() returns jsonb language sql stable security definer set search_path=ops,public,extensions as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select c.id,c.nome_completo name,c.email,c.whatsapp phone,c.cargo role,array_agg(distinct a.key) accounts
 from ops.contatos c join ops.monetizacao_contas a on c.empresa_id=any(a.empresa_ids)
 left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
 where auth.uid() is not null and ops.monetizacao_can('view.contatos') and (ops.can('view.clientes') or ops.monetizacao_can('view.aquario')) and ops.monetizacao_scope(a.unidade_ids) and s.status is distinct from 'ausente'
 group by c.id,c.nome_completo,c.email,c.whatsapp,c.cargo
 ) x
$$;
revoke all on function ops.base_contatos() from public,anon;
grant execute on function ops.base_contatos() to authenticated;

-- A ficha e o filtro usam os mesmos contatos atuais, incluindo canais da empresa
-- no Omie. Canais empresariais não são contados como pessoas/stakeholders.
create or replace function ops.monetizacao_detail(_key text) returns jsonb
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare detail jsonb; a ops.monetizacao_contas; channels jsonb:='[]'; documents jsonb;
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.aquario') or ops.can('view.clientes')) then raise exception 'Sem permissão para consultar clientes';end if;
 select * into a from ops.monetizacao_contas where key=_key;
 if a.key is null or not ops.monetizacao_scope(a.unidade_ids) then raise exception 'Conta fora do seu escopo';end if;
 select detalhe into detail from ops.monetizacao_detalhes where account_key=_key;
 select coalesce(jsonb_agg(cnpj),'[]') into documents from ops.base_conta_cnpjs where account_key=_key;
 if ops.monetizacao_can('view.contatos') then
  select coalesce(jsonb_agg(distinct x),'[]') into channels from (
   select x from jsonb_array_elements(coalesce(detail->'contacts','[]')) x
    where cardinality(a.empresa_ids)=0 and coalesce(x->>'source','') not like 'ops.contatos%'
   union all
   select jsonb_build_object('type',v.tipo,'value',v.valor,'source','Pipefy · contato vinculado','at',c.updated_at)
   from ops.contatos c left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
   cross join lateral (values ('email',c.email),('whatsapp',c.whatsapp)) v(tipo,valor)
   where c.empresa_id=any(a.empresa_ids) and s.status is distinct from 'ausente' and nullif(trim(v.valor),'') is not null
   union all
   select jsonb_build_object('type',v.tipo,'value',v.valor,'source','Omie · canal da empresa','at',coalesce(o.synced_at,o.updated_at))
   from ops.base_conta_cnpjs d join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=d.cnpj
   cross join lateral (values ('email',o.email),('telefone',o.telefone)) v(tipo,valor)
   where d.account_key=_key and nullif(trim(v.valor),'') is not null
  ) q;
 end if;
 return jsonb_build_object('cnpjs',documents,'fields',detail->'fields','driva',detail->'driva','ecd_summary',detail->'ecd_summary','sources',detail->'sources','contacts',channels,'contacts_restricted',not ops.monetizacao_can('view.contatos'));
end $$;
revoke all on function ops.monetizacao_detail(text) from public,anon;
grant execute on function ops.monetizacao_detail(text) to authenticated;


create or replace function ops.base_refresh_cadastro(_empresa integer default null) returns integer language plpgsql security definer set search_path=ops,public,extensions as $$
declare a record; un integer[]; names text[]; label text; company_names text[]; n integer:=0;
begin
 for a in select * from ops.monetizacao_contas where cardinality(empresa_ids)>0 and (_empresa is null or _empresa=any(empresa_ids)) loop
  select array_agg(distinct e.unidade_id) filter(where e.unidade_id is not null),array_agg(distinct u.nome_da_praca) filter(where u.nome_da_praca is not null)
   into un,names from ops.empresas e left join ops.unidades u on u.id=e.unidade_id
   where e.id=any(a.empresa_ids) and e.pipefy_sincronizado_em is not null;
  if exists(select 1 from ops.empresas where id=any(a.empresa_ids) and pipefy_sincronizado_em is not null) then
   label:=coalesce(array_to_string(names,' / '),'Unidade a confirmar');
   select array_agg(distinct coalesce(nullif(razao_social,''),titulo)) into company_names from ops.empresas where id=any(a.empresa_ids) and pipefy_sincronizado_em is not null;
   update ops.monetizacao_contas set unidade_ids=coalesce(un,'{}'),perfil=perfil||jsonb_build_object('name',case when cardinality(company_names)=1 then company_names[1] else perfil->>'name' end,'unit_label',label,'units',coalesce((select jsonb_agg(mu.key) from ops.monetizacao_unidades mu where mu.unidade_id=any(un)),'[]')),updated_at=now() where key=a.key;
   update ops.monetizacao_detalhes set detalhe=jsonb_set(jsonb_set(detalhe,'{fields}',coalesce(detalhe->'fields','{}')),'{fields,unidade}',jsonb_build_object('value',label,'source','Pipefy · leitura confirmada','at',now(),'conflict',coalesce(cardinality(un),0)<>1)),updated_at=now() where account_key=a.key;
   n:=n+1;
  end if;
 end loop;
 return n;
end $$;
revoke all on function ops.base_refresh_cadastro(integer) from public,anon,authenticated;
grant execute on function ops.base_refresh_cadastro(integer) to service_role;

-- Revalidação comercial no momento de salvar/enviar: mesma origem da tela única.
alter function ops.monetizacao_offer_issue(jsonb,text,jsonb) rename to monetizacao_offer_issue_pre_base_unica;
revoke all on function ops.monetizacao_offer_issue_pre_base_unica(jsonb,text,jsonb) from public,anon,authenticated;
create or replace function ops.monetizacao_offer_issue(a jsonb,p text,r jsonb) returns text
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare b record; adjusted jsonb;
begin
 select * into b from ops.base_conta_estado where key=a->>'key';
 if b.key is null then return 'Conta ainda não conciliada na base única';end if;
 if b.ausente then return 'Cadastro ausente no Pipefy; revisar a origem antes de enviar';end if;
 if p='consultoria' and b.origem<>'antiga' then return b.motivo;end if;
 adjusted:=a;
 if p='consultoria' then
  adjusted:=a||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo));
 end if;
 return ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
end $$;
revoke all on function ops.monetizacao_offer_issue(jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function ops.monetizacao_offer_issue(jsonb,text,jsonb) to service_role;


-- Troca de escopo invalida o catálogo em cache, mesmo sem mudança de dados.
create or replace function ops.base_access_signature() returns text language sql stable security definer set search_path=ops,public,extensions as $$
 select case when auth.uid() is null then null else md5(auth.uid()::text||coalesce((select to_jsonb(e)::text from ops.usuario_escopo e where user_id=auth.uid()),'')||coalesce((select string_agg(unidade_id::text,',' order by unidade_id) from ops.usuario_unidades where user_id=auth.uid()),'')) end
$$;
revoke all on function ops.base_access_signature() from public,anon;
grant execute on function ops.base_access_signature() to authenticated;

notify pgrst,'reload schema';
commit;
