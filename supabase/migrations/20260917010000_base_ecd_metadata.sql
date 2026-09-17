begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
-- O cadastro fiscal legado exige dados de escrituração que o resumo histórico
-- não possui. Guardar a evidência sem inventar contagem de contas, receita ou ID.
create table if not exists ops.base_ecd_registros (
 cnpj text not null check(ops.base_cnpj(cnpj)=cnpj), ano smallint not null,
 origem text not null, account_key text not null references ops.monetizacao_contas(key),
 carregado_em timestamptz not null, primary key(cnpj,ano,origem)
);
alter table ops.base_ecd_registros enable row level security;
revoke all on ops.base_ecd_registros from public,anon,authenticated;
grant all on ops.base_ecd_registros to service_role;
create or replace view ops.base_ecd_evidencias as
 select cnpj::text,ano,origem,carregado_em from ops.ecd_empresa
 union select cnpj,ano,origem,carregado_em from ops.base_ecd_registros;
revoke all on ops.base_ecd_evidencias from public,anon,authenticated;
grant select on ops.base_ecd_evidencias to service_role;
create or replace function ops.base_refinar_ecd() returns integer language plpgsql security definer set search_path=ops,public,extensions as $$
declare n integer;
begin
 insert into ops.base_ecd_registros(cnpj,ano,origem,account_key,carregado_em)
 select distinct on(ops.base_cnpj(d.detalhe->'cnpjs'->>0),(d.detalhe#>>'{ecd_summary,exercise}')::smallint)
  ops.base_cnpj(d.detalhe->'cnpjs'->>0),(d.detalhe#>>'{ecd_summary,exercise}')::smallint,'metadado_monetizacao',d.account_key,d.updated_at
 from ops.monetizacao_detalhes d where d.detalhe#>>'{ecd_summary,available}'='true'
 and jsonb_array_length(coalesce(d.detalhe->'cnpjs','[]'))=1 and ops.base_cnpj(d.detalhe->'cnpjs'->>0) is not null
 and d.detalhe#>>'{ecd_summary,exercise}' ~ '^20[0-9]{2}$'
 and (d.detalhe#>>'{ecd_summary,exercise}')::integer<=extract(year from current_date)
 order by ops.base_cnpj(d.detalhe->'cnpjs'->>0),(d.detalhe#>>'{ecd_summary,exercise}')::smallint,d.updated_at desc
 on conflict(cnpj,ano,origem) do nothing;
 get diagnostics n=row_count;
 if n>0 then update ops.monetizacao_sync set catalog_at=now() where id;end if;
 return n;
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


notify pgrst,'reload schema';
commit;
