begin;
set local lock_timeout='3s';
set local statement_timeout='60s';
-- Metadados necessários à classificação; contratos e chaves completos não são expostos.
create table if not exists ops.base_omie_contratos (
 aplicativo text not null, contrato_id text not null, cliente_id text not null,
 unidade text not null, cnpj text, vigencia_inicial date, situacao text,
 fonte_campo text not null default 'cabecalho.dVigInicial', consultado_em timestamptz not null default now(),
 primary key(aplicativo,contrato_id),
 check(cnpj is null or ops.base_cnpj(cnpj)=cnpj)
);
create index if not exists base_omie_contratos_cnpj on ops.base_omie_contratos(cnpj,vigencia_inicial);
alter table ops.base_omie_contratos enable row level security;
revoke all on ops.base_omie_contratos from public,anon,authenticated;
grant all on ops.base_omie_contratos to service_role;
create table if not exists ops.base_enriquecimento_cnpj (
 cnpj text not null check(ops.base_cnpj(cnpj)=cnpj), fonte text not null, registro_fonte text not null,
 fora_simples boolean, regime text, segmento text, consultado_em timestamptz not null,
 referencia_em timestamptz, primary key(cnpj,fonte,registro_fonte)
);
alter table ops.base_enriquecimento_cnpj enable row level security;
revoke all on ops.base_enriquecimento_cnpj from public,anon,authenticated;
grant all on ops.base_enriquecimento_cnpj to service_role;

create or replace function ops.base_regime_evidencia(_cnpjs text[],_perfil jsonb) returns jsonb
language sql stable security definer set search_path=ops,public,extensions as $$
 with votes as (
  select cnpj,count(distinct fora_simples) n,bool_and(fora_simples) fora,max(consultado_em) checked_at
  from ops.base_enriquecimento_cnpj where cnpj=any(_cnpjs) and fora_simples is not null group by cnpj
 ), facts as (
  select count(*)=cardinality(_cnpjs) and cardinality(_cnpjs)>0 covered,
   coalesce(bool_or(n>1),false) or count(distinct fora)>1
   or (coalesce(_perfil->>'regime','') ~* '(simples|mei)' and coalesce(bool_or(fora),false))
   or (lower(coalesce(_perfil->>'regime','')) in ('lucro real','lucro presumido','lucro arbitrado') and coalesce(bool_or(not fora),false)) conflict,
   bool_and(fora) outside,max(checked_at) checked_at from votes
 )
 select jsonb_build_object('non_simples',case when covered and not conflict then outside end,'conflict',conflict,'covered',covered,'checked_at',checked_at,
  'sources',(select coalesce(jsonb_agg(distinct fonte),'[]') from ops.base_enriquecimento_cnpj where cnpj=any(_cnpjs))) from facts
$$;
revoke all on function ops.base_regime_evidencia(text[],jsonb) from public,anon,authenticated;
grant execute on function ops.base_regime_evidencia(text[],jsonb) to service_role;

-- Regra pura, também exercitada sem tocar em contas reais.
create or replace function ops.base_classificar_origem(_omie text[],_pipe boolean,_units text[],_datas date[],_cobertura boolean) returns jsonb
language plpgsql immutable as $$
declare units text[]; status text:='confirmar'; motivo text;
begin
 select coalesce(array_agg(distinct ops.base_unidade(v)),'{}') into units from unnest(case when cardinality(_units)>0 then _units else _omie end) v;
 if 'curitiba'=any(units) then
  if cardinality(units)>1 then motivo:='Curitiba e outra unidade vinculadas; confirmar a carteira responsável antes de aplicar o corte.';
  elsif not _cobertura or cardinality(_datas)=0 then motivo:='Curitiba: falta vigência inicial do contrato Omie para todos os CNPJs da conta.';
  elsif exists(select 1 from unnest(_datas) d where d>='2025-04-01' and d<'2025-05-01') then motivo:='Curitiba: vigência inicial em abril de 2025; corte do mês aguardando definição.';
  elsif (select bool_and(d<'2025-04-01') from unnest(_datas) d) then status:='antiga';motivo:='Curitiba: primeira vigência contratual no Omie anterior a abril de 2025.';
  elsif (select bool_and(d>='2025-05-01') from unnest(_datas) d) then status:='nova';motivo:='Curitiba: primeira vigência contratual no Omie posterior a abril de 2025.';
  else motivo:='Curitiba: CNPJs da mesma conta têm vigências anteriores e posteriores ao corte; revisar agrupamento.';
  end if;
 elsif cardinality(_omie)>0 then status:='nova';motivo:='Cadastro no Omie fora de Curitiba; pagamento não altera a origem.';
 elsif _pipe and cardinality(units)>0 then status:='nova';motivo:='Registro identificado no Pipedrive fora de Curitiba; não exige negócio ganho.';
 elsif _pipe then motivo:='Registro no Pipedrive sem unidade responsável confirmada; conferir a exceção de Curitiba.';
 else motivo:='Sem vínculo Omie/Pipedrive: validar origem com a unidade responsável.';
 end if;
 return jsonb_build_object('status',status,'reason',motivo,'version','2026-09-17','dates',coalesce(to_jsonb(_datas),'[]'),'coverage',_cobertura);
end $$;

create or replace view ops.base_conta_estado as
 with facts as (
 select a.*,coalesce(d.cnpjs,'{}') cnpjs,coalesce(o.unidades,'{}') omie_unidades,coalesce(o.registros,0) omie_registros,coalesce(o.fora_curitiba,false) omie_nova,
  coalesce(c.pipefy_ids,'{}') pipefy_ids,coalesce(c.pipedrive_ids,'{}') pipedrive_ids,coalesce(c.declarada,'{}') declarada,
  c.sincronizado,c.ausente,c.pendencias,coalesce(c.nao_lidas,0) nao_lidas,coalesce(c.empresas,0) cadastros,
  coalesce(p.n,0) contatos,coalesce(p.contatavel,false) or coalesce(o.contato,false) or (coalesce((a.perfil->>'contact')::boolean,false) and cardinality(a.empresa_ids)=0 and coalesce(o.registros,0)=0) com_contato,
  coalesce(e.registros,'[]') ecd_registros,
  md5(coalesce(array_to_string(d.cnpjs,','),'')||'|'||coalesce(array_to_string(o.unidades,','),'')||'|'||coalesce(array_to_string(c.pipedrive_ids,','),'')||'|'||coalesce((a.perfil->>'new_commercial'),'false')||'|'||coalesce((select string_agg(t.aplicativo||':'||t.contrato_id||':'||coalesce(t.vigencia_inicial::text,''),',' order by t.aplicativo,t.contrato_id) from ops.base_omie_contratos t where t.cnpj=any(d.cnpjs)),'')||'|2026-09-17') fingerprint
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
 case when ops.base_identity_conflict(f.pendencias) then 'confirmar'
 when decision.value->>'status'<>'confirmar' then decision.value->>'status'
 when v.account_key is not null and v.fingerprint=f.fingerprint and (cardinality(f.pipefy_ids)=0 or f.declarada=array[case when v.origem='antiga' then 'Base Antiga' else 'Base Nova' end]) then v.origem
 else 'confirmar' end origem,
 case when ops.base_identity_conflict(f.pendencias) then 'CNPJ diverge entre Pipefy e Brain; confirmar a identidade antes de classificar ou enviar.'
 when decision.value->>'status'<>'confirmar' then decision.value->>'reason'
 when v.account_key is not null and v.fingerprint<>f.fingerprint then 'Novos vínculos encontrados; revisar a validação anterior.'
 when v.account_key is not null and cardinality(f.pipefy_ids)>0 and f.declarada<>array[case when v.origem='antiga' then 'Base Antiga' else 'Base Nova' end] then 'Validação registrada; aguardando confirmação da correção no Pipefy.'
 when v.account_key is not null then 'Origem confirmada com responsável e evidência.'
 else decision.value->>'reason' end motivo,ops.base_identity_conflict(f.pendencias) identity_conflict,
 decision.value||jsonb_build_object('field','cabecalho.dVigInicial','contracts',coalesce(contracts.evidence,'[]')) origin_evidence,
 ops.base_regime_evidencia(f.cnpjs,f.perfil) tax_evidence
 from facts f left join ops.base_origem_validacoes v on v.account_key=f.key
 left join lateral (
  select array_agg(first_start order by doc.cnpj) dates,count(first_start)=cardinality(f.cnpjs) and cardinality(f.cnpjs)>0 covered,
   jsonb_agg(jsonb_build_object('cnpj',doc.cnpj,'first_start',first_start,'source','Omie · cabecalho.dVigInicial','checked_at',checked_at) order by doc.cnpj) filter(where first_start is not null) evidence
  from unnest(f.cnpjs) doc(cnpj) left join lateral (
   select min(vigencia_inicial) first_start,max(consultado_em) checked_at from ops.base_omie_contratos t
   where t.cnpj=doc.cnpj and ops.base_unidade(t.unidade)='curitiba'
  ) t on true
 ) contracts on true
 cross join lateral (select ops.base_classificar_origem(f.omie_unidades,
  cardinality(f.pipedrive_ids)>0 or cardinality(f.org_ids)>0 or coalesce((f.perfil->>'new_commercial')::boolean,false),
  array(select nome_da_praca from ops.unidades where id=any(f.unidade_ids)),contracts.dates,contracts.covered) value) decision;

create or replace function ops.base_unica_catalogo(_keys text[] default null) returns jsonb language sql stable security definer set search_path=ops,public,extensions as $$
 select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end])),'[]')
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
 if a.origin_evidence->>'status' in ('nova','antiga') and _origem<>a.origin_evidence->>'status' then raise exception 'A evidência Omie/Pipedrive determina a origem; revisar a fonte antes de alterar';end if;
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

create or replace function ops.monetizacao_offer_issue_pre_base_unica(a jsonb,p text,r jsonb) returns text
language plpgsql immutable set search_path=ops,public,extensions as $$
declare regime text:=lower(coalesce(nullif(r->>'regime',''),a->>'regime',''));
 band text:=coalesce(nullif(r->>'band',''),a->>'band','');
 low boolean:=band in ('Até R$ 500 mil','R$ 500 mil até R$ 1 milhão','R$ 1 milhão até R$ 2 milhões','R$ 2 milhões até R$ 4,8 milhões','R$ 4,8 milhões até R$ 10 milhões','R$ 10 milhões até R$ 25 milhões');
 high boolean:=band in ('R$ 25 milhões até R$ 50 milhões','R$ 50 milhões até R$ 78 milhões','Entre R$ 78 milhões e R$ 300 milhões','Acima de R$ 300 milhões','[ANTIGO] Acima de R$ 78 milhões');
begin
 if p='consultoria' then
  if coalesce((a->>'new_commercial')::boolean,false) or a->'consultoria_origin'->>'status'='comercial' then
   return 'Fechamento pelo comercial identificado; não pertence à base retroativa de Consultoria';
  end if;
  if not coalesce((a->>'old_base')::boolean,false) or coalesce(a->'consultoria_origin'->>'status','')<>'retroativa' then
   return 'Origem Base Antiga das unidades não comprovada';
  end if;
  if regime ~ '(simples|mei)' or (nullif(r->>'regime','') is null and a->'consultoria_origin'->>'non_simples_confirmed'='false') then
   return 'Simples Nacional ou MEI';
  end if;
  if coalesce((a->>'regime_conflict')::boolean,false) and nullif(r->>'regime','') is null then
   return 'Resolver divergência de regime tributário';
  end if;
  if regime not in ('lucro real','lucro presumido','lucro arbitrado') and coalesce(a->'consultoria_origin'->>'non_simples_confirmed','')<>'true' then
   return 'Base retroativa confirmada; comprovar regime fora do Simples';
  end if;
  return null;
 end if;
 if p='finance' and not coalesce((a->>'pipedrive_contract')::boolean,false) then return 'Sem contrato ganho no Pipedrive'; end if;
 if regime ~ '(simples|mei)' or (nullif(r->>'regime','') is null and a->>'non_simples_confirmed'='false') then return 'Simples Nacional ou MEI'; end if;
 if regime not in ('lucro real','lucro presumido','lucro arbitrado') and coalesce(a->>'non_simples_confirmed','')<>'true' then return 'Confirmar regime fora do Simples'; end if;
 if (coalesce((a->>'regime_conflict')::boolean,false) and nullif(r->>'regime','') is null)
 or (coalesce((a->>'band_conflict')::boolean,false) and nullif(r->>'band','') is null) then return 'Resolver divergência de regime ou faturamento'; end if;
 if p='finance' and not low then return 'Finance exige faixa inteiramente abaixo de R$ 25 milhões'; end if;
 if p='cella' and not high then return 'Cella exige faixa a partir de R$ 25 milhões'; end if;
 return null;
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
 adjusted:=a||jsonb_build_object('non_simples_confirmed',b.tax_evidence->'non_simples',
  'regime_conflict',coalesce((a->>'regime_conflict')::boolean,false) or coalesce((b.tax_evidence->>'conflict')::boolean,false));
 if p='consultoria' then
  adjusted:=adjusted||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo,
   'non_simples_confirmed',coalesce(nullif(b.tax_evidence->'non_simples','null'::jsonb),a#>'{consultoria_origin,non_simples_confirmed}')));
 end if;
 return ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
end $$;

-- Automação autorizada: propõe apenas origens objetivas, mantendo compare-and-set do worker.
create or replace function ops.base_enfileirar_origens() returns integer
language plpgsql security definer set search_path=ops,public,extensions as $$
declare total integer;
begin
 with candidates as materialized (
  select e.id empresa_id,case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end alvo,
   case when sr.registro_id is not null then sr.campos->'origem_da_base' else to_jsonb(e.origem_da_base) end previous,
   a.motivo
  from ops.base_conta_estado a join ops.empresas e on e.id=any(a.empresa_ids)
  left join ops.base_sync_registros sr on sr.fonte='pipefy_empresa' and sr.registro_id=e.pipefy_record_id
  where not a.identity_conflict and a.origin_evidence->>'status' in ('nova','antiga')
   and e.pipefy_record_id is not null and not coalesce(a.ausente,false)
 ), unique_targets as (
  select empresa_id,min(alvo) alvo,min(previous::text)::jsonb previous,min(motivo) motivo
  from candidates group by empresa_id having count(distinct alvo)=1
 )
 insert into ops.base_alteracoes(empresa_id,campo,valor_anterior,valor_proposto,ator_id,motivo,regra)
 select c.empresa_id,'origem_da_base',c.previous,to_jsonb(c.alvo),null,c.motivo,'origem-omie-pipedrive-2026-09-17'
 from unique_targets c where c.previous is distinct from to_jsonb(c.alvo)
 and not exists(select 1 from ops.base_alteracoes b where b.empresa_id=c.empresa_id and b.campo='origem_da_base' and (b.status in ('pending','sending','conflict') or b.status='error'))
 on conflict do nothing;
 get diagnostics total=row_count;
 return total;
end $$;
revoke all on function ops.base_enfileirar_origens() from public,anon,authenticated;
grant execute on function ops.base_enfileirar_origens() to service_role;
update ops.monetizacao_sync set catalog_at=now() where id;
notify pgrst,'reload schema';
commit;
