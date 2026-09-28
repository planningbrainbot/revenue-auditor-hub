-- Rollback de 20260928200000_base_sinais_distrato_consultoria.sql.
-- Devolve as três funções vivas ao corpo de 28/09/2026 (copiado da produção antes da migration),
-- desagenda as duas syncs e apaga o que a migration criou. As tabelas da Consultoria são cópia da
-- API e se refazem na próxima carga; as colunas novas da Central de Tratativas também saem.
-- Depois deste rollback, a edge function pipefy-tratativas-sync do repositório não roda (grava as
-- colunas novas): republique a versão anterior ou deixe sem agendamento.
begin;
select cron.unschedule('pipefy-tratativas-sync-15min') where exists (select 1 from cron.job where jobname='pipefy-tratativas-sync-15min');
select cron.unschedule('consultoria-sync-hora') where exists (select 1 from cron.job where jobname='consultoria-sync-hora');
delete from ops.integracoes_config where fonte='consultoria';
update ops.integracoes_config set observacao='Edge Function pipefy-tratativas-sync, pg_cron a cada 15min' where fonte='pipefy_tratativas';

CREATE OR REPLACE FUNCTION ops.base_unica_catalogo(_keys text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select coalesce(jsonb_agg(jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end])),'[]')
 from ops.base_conta_estado a
 where auth.uid() is not null and (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao') or ops.monetizacao_can('view.clientes')) and ops.monetizacao_scope(a.unidade_ids) and (_keys is null or a.key=any(_keys))
$function$
;

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
  select key,row_number() over(order by key) rn from ops.monetizacao_contas
  where all_units or unidade_ids && units
 ), chunks as (
  select (rn-1)/400 page,max(key) through,count(*) count from ordered group by 1
 ), boundaries as (
  select lag(through) over(order by page) after,through,count,page from chunks
 ) select coalesce(jsonb_agg(jsonb_build_object('after',after,'through',through,'count',count) order by page),'[]'),coalesce(sum(count),0) into pages,total from boundaries;
 return jsonb_build_object('pages',pages,'count',total,'catalog_at',(select catalog_at from ops.monetizacao_sync where id),'scope_signature',ops.base_access_signature());
end $function$
;

CREATE OR REPLACE FUNCTION ops.monetizacao_offer_issue(a jsonb, p text, r jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare b record; adjusted jsonb; situacao text;
begin
 select * into b from ops.base_conta_estado where key=a->>'key';
 if b.key is null then return 'Conta ainda não conciliada na base única';end if;
 if b.identity_conflict then return 'CNPJ divergente entre fontes; revisar identidade antes de enviar';end if;
 situacao:=coalesce(nullif(r->>'situacao_receita',''),a->>'situacao_receita','ativa');
 if situacao<>'ativa' then return 'Empresa '||situacao||' na Receita Federal; fora das ofertas';end if;
 if b.ausente then return 'Cadastro ausente no Pipefy; revisar a origem antes de enviar';end if;
 if p='consultoria' and b.origem<>'antiga' then return b.motivo;end if;
 adjusted:=a||jsonb_build_object('non_simples_confirmed',b.tax_evidence->'non_simples',
  'regime_conflict',coalesce((a->>'regime_conflict')::boolean,false) or coalesce((b.tax_evidence->>'conflict')::boolean,false));
 if p='consultoria' then
  adjusted:=adjusted||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo,
   'non_simples_confirmed',coalesce(nullif(b.tax_evidence->'non_simples','null'::jsonb),a#>'{consultoria_origin,non_simples_confirmed}')));
 end if;
 return ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
end $function$
;

drop function if exists ops.base_consultoria_bloqueio(jsonb);
drop function if exists ops.base_distrato_bloqueio(jsonb);
drop function if exists ops.base_conta_sinais(text[]);
drop function if exists ops.nome_comparavel(text);
drop table if exists ops.consultoria_propostas;
drop table if exists ops.consultoria_clientes;
drop index if exists ops.sync_log_fonte_executado_idx;
drop index if exists ops.central_tratativas_deal_idx;
drop index if exists ops.central_tratativas_cliente_ids_idx;
alter table ops.central_tratativas drop constraint if exists central_tratativas_distrato_estado_check;
alter table ops.central_tratativas drop column if exists sincronizado_em, drop column if exists pipefy_criado_em, drop column if exists distrato_estado, drop column if exists pipefy_cliente_ids, drop column if exists fase_id;
commit;
-- Fora do banco: supabase secrets unset SINAIS_CRON_SECRET CONSULTORIA_API_URL CONSULTORIA_API_KEY
-- e delete from vault.secrets where name='base_sinais_cron_secret';
