-- Rollback de 20261001200000_base_prova_fornecedor_admin: devolve as definições de produção de 01/10 e apaga o que a migration criou.
CREATE OR REPLACE FUNCTION ops.base_unica_ficha(_keys text[] DEFAULT NULL::text[])
 RETURNS TABLE(key text, unidade_ids integer[], ficha jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select a.key, a.unidade_ids, jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end],
   'distrato',s.distrato,'consultoria',s.consultoria,'omie',om.omie)
 from ops.base_conta_estado a
 left join ops.base_conta_sinais(_keys) s on s.key = a.key
 left join lateral ops.base_conta_omie_tags(a.cnpjs) om on true  -- tags do cadastro do Omie
 where _keys is null or a.key=any(_keys)
$function$;

CREATE OR REPLACE FUNCTION ops.base_carteira_manifesto()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare pages jsonb; total integer; all_units boolean; units integer[];
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) then raise exception 'Sem acesso à base de clientes';end if;
 all_units:=ops.monetizacao_scope('{}'); units:=array(select ops.minhas_unidades());
 with ordered as (
  select key,row_number() over(order by key) rn from ops.base_carteira
  where all_units or unidade_ids && units
 ), chunks as (
  select (rn-1)/1000 page,max(key) through,count(*) count from ordered group by 1
 ), boundaries as (
  select lag(through) over(order by page) after,through,count,page from chunks
 ) select coalesce(jsonb_agg(jsonb_build_object('after',after,'through',through,'count',count) order by page),'[]'),coalesce(sum(count),0) into pages,total from boundaries;
 return jsonb_build_object('pages',pages,'count',total,'catalog_at',(select catalog_at from ops.monetizacao_sync where id),
  'carteira_at',(select carteira_at from ops.monetizacao_sync where id),'scope_signature',ops.base_access_signature(),
  -- sinais: última carga concluída de cada fonte, para a procedência da tela (N3)
  'sinais',jsonb_build_object(
   'tratativas',(select max(executado_em) from ops.sync_log where fonte='pipefy_tratativas' and status='sucesso'),
   'consultoria',(select max(executado_em) from ops.sync_log where fonte='consultoria' and status='sucesso')));
end $function$;

CREATE OR REPLACE FUNCTION ops.base_carteira_pagina(_after text DEFAULT NULL::text, _through text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare rows jsonb; fichas jsonb; n integer; last_key text; all_units boolean; units integer[];
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')) then raise exception 'Sem acesso à base de clientes';end if;
 if length(_after)>80 or length(_through)>80 then raise exception 'Limite de página inválido';end if;
 all_units:=ops.monetizacao_scope('{}'); units:=array(select ops.minhas_unidades());
 select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'perfil',a.perfil,'unidade_ids',a.unidade_ids) order by a.key),'[]'),
        coalesce(jsonb_agg(a.base) filter (where a.base is not null),'[]'), count(*), max(a.key)
   into rows, fichas, n, last_key from (
  select c.key,c.perfil,c.unidade_ids,c.base from ops.base_carteira c
  where (all_units or c.unidade_ids && units) and (_after is null or c.key>_after) and (_through is null or c.key<=_through)
  order by c.key limit 1000
 ) a;
 return jsonb_build_object('rows',rows,'base',fichas,'next',case when n=1000 then last_key end,
  'catalog_at',(select catalog_at from ops.monetizacao_sync where id),
  'carteira_at',(select carteira_at from ops.monetizacao_sync where id),'scope_signature',ops.base_access_signature());
end $function$;

CREATE OR REPLACE FUNCTION ops.base_unica_catalogo(_keys text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select coalesce(jsonb_agg(f.ficha),'[]')
 from ops.base_unica_ficha(_keys) f
 where auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao') or ops.monetizacao_can('view.clientes')) and ops.monetizacao_scope(f.unidade_ids)
$function$;

CREATE OR REPLACE FUNCTION ops.monetizacao_detail(_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare detail jsonb; a ops.monetizacao_contas; channels jsonb:='[]'; documents jsonb;
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.clientes')) then raise exception 'Sem permissão para consultar clientes';end if;
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
end $function$;

CREATE OR REPLACE FUNCTION ops.base_contatos_exportar(_keys text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare out jsonb;
begin
 if auth.uid() is null or not (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.clientes')) then raise exception 'Sem permissão para consultar clientes';end if;
 if not ops.monetizacao_can('view.contatos') then raise exception 'Sem permissão para ver contatos';end if;
 if cardinality(_keys)>500 then raise exception 'Máximo de 500 contas por lote';end if;
 -- EXECUTE planeja com o array de verdade; o plano genérico do plpgsql levava 8 s por lote de 500.
 execute $q$ with contas as (
  select a.key,a.empresa_ids from ops.monetizacao_contas a
  where a.key=any($1) and ops.monetizacao_scope(a.unidade_ids)
 ), canais as (
  -- Conta sem empresa no Ops: o que ficou gravado no detalhe (Pipedrive e stakeholder do Pipefy).
  select c.key,null::text nome,null::text cargo,x->>'type' tipo,x->>'value' valor
  from contas c join ops.monetizacao_detalhes d on d.account_key=c.key
  cross join lateral jsonb_array_elements(coalesce(d.detalhe->'contacts','[]')) x
  where cardinality(c.empresa_ids)=0 and coalesce(x->>'source','') not like 'ops.contatos%'
  union all
  select c.key,nullif(trim(p.nome_completo),''),nullif(trim(p.cargo),''),v.tipo,v.valor
  from contas c join ops.contatos p on p.empresa_id=any(c.empresa_ids)
  left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=p.id
  cross join lateral (values ('email',p.email),('whatsapp',p.whatsapp)) v(tipo,valor)
  where s.status is distinct from 'ausente' and nullif(trim(v.valor),'') is not null
  union all
  select c.key,null,null,v.tipo,v.valor
  from contas c join ops.base_conta_cnpjs d on d.account_key=c.key
  join ops.omie_clientes o on ops.base_cnpj(o.cnpj_cpf)=d.cnpj
  cross join lateral (values ('email',o.email),('telefone',o.telefone)) v(tipo,valor)
  where nullif(trim(v.valor),'') is not null
 ), emails as (
  -- O Omie guarda vários e-mails no mesmo campo, separados por vírgula ou ponto e vírgula.
  select distinct key,lower(e) email from canais
  cross join lateral regexp_split_to_table(trim(valor),'[,;[:space:]]+') e
  where tipo='email' and e like '%@%'
 ), telefones as (
  -- O mesmo número chega formatado de jeitos diferentes; vale um por sequência de dígitos, sem o 55.
  select distinct on (key,digitos) key,trim(valor) telefone from (
   select key,valor,regexp_replace(regexp_replace(valor,'\D','','g'),'^55(?=\d{10,11}$)','') digitos
   from canais where tipo<>'email'
  ) t where digitos<>'' order by key,digitos,valor
 )
 select coalesce(jsonb_object_agg(c.key,jsonb_build_object(
   'nomes',(select string_agg(distinct nome||coalesce(' ('||cargo||')',''),'; ') from canais n where n.key=c.key and nome is not null),
   'emails',(select string_agg(email,'; ' order by email) from emails e where e.key=c.key),
   'telefones',(select string_agg(telefone,'; ' order by telefone) from telefones t where t.key=c.key))),'{}')
 from (select distinct key from canais) c $q$ into out using _keys;
 return out;
end $function$;

CREATE OR REPLACE FUNCTION ops.base_contatos()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select c.id,c.nome_completo name,c.email,c.whatsapp phone,c.cargo role,array_agg(distinct a.key) accounts
 from ops.contatos c join ops.monetizacao_contas a on c.empresa_id=any(a.empresa_ids)
 left join ops.base_sync_registros s on s.fonte='pipefy_contato' and s.contato_id=c.id
 where auth.uid() is not null and ops.monetizacao_can('view.contatos') and (ops.monetizacao_can('view.clientes') or ops.monetizacao_can('view.aquario')) and ops.monetizacao_scope(a.unidade_ids) and s.status is distinct from 'ausente'
 group by c.id,c.nome_completo,c.email,c.whatsapp,c.cargo
 ) x
$function$;

CREATE OR REPLACE FUNCTION ops.monetizacao_base_origins()
 RETURNS TABLE(account_key text, origin jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION ops.base_validar_origem(_key text, _origem text, _responsavel text, _evidencia text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION ops.monetizacao_offer_issue(a jsonb, p text, r jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare b record; adjusted jsonb; situacao text; s record; issue text; rr jsonb; acima boolean; abaixo boolean;
begin
 select * into b from ops.base_conta_estado where key=a->>'key';
 if b.key is null then return 'Conta ainda não conciliada na base única';end if;
 if b.identity_conflict then return 'CNPJ divergente entre fontes; revisar identidade antes de enviar';end if;
 situacao:=coalesce(nullif(r->>'situacao_receita',''),a->>'situacao_receita','ativa');
 if situacao<>'ativa' then return 'Empresa '||situacao||' na Receita Federal; fora das ofertas';end if;
 -- sinais: distrato concluído vale para todos os produtos, logo depois da situação cadastral
 -- (definitivo antes do que pede ação humana), na mesma ordem de oferta() no cliente.
 select * into s from ops.base_conta_sinais(array[a->>'key']);
 if s.distrato->>'estado'='concluido' then return ops.base_distrato_bloqueio(s.distrato);end if;
 -- Só fornecedor no Omie (tags do cadastro, 29/09): fora de todas as ofertas, Recon inclusive, na mesma posição
 -- de fornecedorForaDeOferta() no cliente (src/lib/monetizacao/model.ts).
 if (select t.omie->>'classe' from ops.base_conta_omie_tags(b.cnpjs) t)='fornecedor' then
  return 'Só fornecedor no Omie, sem tag de cliente; fora das ofertas';
 end if;
 -- Recon (pipe 38 do Pipedrive, 29/09): o espelho de ofertaRecon (src/lib/monetizacao/recon.ts), na mesma
 -- ordem: identidade, situação e distrato concluído já passaram; o cadastro ausente no Pipefy não veta o Recon.
 if p='recon' then
  rr:=a->'recon';
  if rr is null or jsonb_typeof(rr)<>'object' then return 'Contrato e carteira BPO ainda não conferidos';end if;
  if rr->>'bpo_status'='bpo' then return coalesce(nullif(rr->>'reason',''),'Cliente com BPO contábil, fiscal, folha ou financeiro');end if;
  if coalesce((rr->>'revenue_conflict')::boolean,false) or coalesce((a->>'band_conflict')::boolean,false) then return 'Fontes divergem sobre o faturamento anual';end if;
  acima:=case when rr->>'revenue_exact' is not null then (rr->>'revenue_exact')::numeric>5000000 else coalesce((rr->>'revenue_min')::numeric>5000000,false) end;
  abaixo:=case when rr->>'revenue_exact' is not null then (rr->>'revenue_exact')::numeric<=5000000 else coalesce((rr->>'revenue_max')::numeric<=5000000,false) end;
  if abaixo then return 'Faturamento anual de até R$ 5 milhões';end if;
  if not acima then return 'Confirmar faturamento anual acima de R$ 5 milhões; a faixa atual não comprova o corte';end if;
  if coalesce(rr->>'bpo_status','')<>'fora_bpo' then return coalesce(nullif(rr->>'reason',''),'Confirmar que a empresa não tem BPO');end if;
  -- a tratativa em andamento segura a oferta, como comTratativa() no cliente
  return ops.base_distrato_bloqueio(s.distrato);
 end if;
 if b.ausente then return 'Cadastro ausente no Pipefy; revisar a origem antes de enviar';end if;
 if p='consultoria' and b.origem<>'antiga' then return b.motivo;end if;
 -- sinais: quem já é cliente (ou tem proposta aberta) da Consultoria não recebe Consultoria.
 if p='consultoria' then
  issue:=ops.base_consultoria_bloqueio(s.consultoria);
  if issue is not null then return issue;end if;
 end if;
 adjusted:=a||jsonb_build_object('non_simples_confirmed',b.tax_evidence->'non_simples',
  'regime_conflict',coalesce((a->>'regime_conflict')::boolean,false) or coalesce((b.tax_evidence->>'conflict')::boolean,false));
 if p='consultoria' then
  adjusted:=adjusted||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo,
   'non_simples_confirmed',coalesce(nullif(b.tax_evidence->'non_simples','null'::jsonb),a#>'{consultoria_origin,non_simples_confirmed}')));
 end if;
 issue:=ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
 -- sinais: a tratativa só segura o que o produto aceitaria (comTratativa no cliente); conta que já
 -- tem motivo fica com o motivo dela.
 return coalesce(issue,ops.base_distrato_bloqueio(s.distrato));
end $function$;

select cron.unschedule('omie-pagamentos-sync-10min') where exists (select 1 from cron.job where jobname = 'omie-pagamentos-sync-10min');
drop policy if exists base_fornecedor_so_admin on ops.monetizacao_contas;
drop policy if exists base_fornecedor_so_admin on ops.monetizacao_detalhes;
drop policy if exists base_fornecedor_so_admin on ops.monetizacao_itens;
drop policy if exists base_fornecedor_so_admin on ops.monetizacao_envios;
drop policy if exists base_fornecedor_so_admin on ops.omie_clientes;
drop policy if exists base_fornecedor_so_admin on ops.omie_clientes_cadastro;
drop trigger if exists base_carteira_restritos on ops.base_carteira;
drop function if exists ops.base_carteira_restritos();
drop function if exists ops.base_cnpj_fornecedor(text);
drop function if exists ops.base_conta_liberada(text);
drop function if exists ops.base_prova_restrita(jsonb);
drop function if exists ops.base_ve_fornecedor();
drop function if exists ops.base_conta_prova(text[], integer[], jsonb, jsonb, jsonb);
drop index if exists ops.base_omie_tags_raiz;
drop table if exists ops.base_cnpj_restrito;
drop table if exists ops.base_grupo_cnpjs;
drop table if exists ops.base_pagamentos_grupo;
drop table if exists ops.base_omie_pagamentos_leituras;
drop table if exists ops.base_omie_pagamentos;
-- A carteira volta sem `prova` na próxima volta do cron base-carteira-refresh (~6 min).
