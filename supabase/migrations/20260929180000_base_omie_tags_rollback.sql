-- Rollback de 20260929180000_base_omie_tags: devolve a ficha de 29/09 sem `omie` e remove tabela, funções e cron.
select cron.unschedule('omie-tags-sync-hora') where exists (select 1 from cron.job where jobname = 'omie-tags-sync-hora');

CREATE OR REPLACE FUNCTION ops.base_unica_ficha(_keys text[] DEFAULT NULL::text[])
 RETURNS TABLE(key text, unidade_ids integer[], ficha jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 select a.key, a.unidade_ids, jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end],
   'distrato',s.distrato,'consultoria',s.consultoria)
 from ops.base_conta_estado a
 left join ops.base_conta_sinais(_keys) s on s.key = a.key
 where _keys is null or a.key=any(_keys)
$function$;

drop function if exists ops.base_conta_omie_tags(text[]);
drop trigger if exists base_omie_tags_flags on ops.base_omie_tags;
drop function if exists ops.base_omie_tags_flags();
drop function if exists ops.omie_tag_normal(text);
drop table if exists ops.base_omie_tags;
