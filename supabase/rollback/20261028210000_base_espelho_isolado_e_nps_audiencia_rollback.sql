-- Rollback de 20261028210000: volta o lote atômico e a audiência do NPS de antes (copiados do banco em 28/10/2026).
CREATE OR REPLACE FUNCTION ops.base_ingest_lote(_registros jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare r jsonb; results jsonb:='[]';
begin
 if jsonb_array_length(_registros)>100 then raise exception 'Lote excede 100 registros'; end if;
 for r in select value from jsonb_array_elements(_registros) loop
  results:=results||jsonb_build_array(ops.base_ingest_pipefy(r->>'fonte',r->>'registro_id',(r->>'fonte_at')::timestamptz,(r->>'lido_em')::timestamptz,r->'campos',r->'vinculos'));
 end loop;
 return results;
end $function$;

create or replace view ops.nps_audiencia as
SELECT DISTINCT ON (c.whatsapp) c.id,
    c.nome_completo,
    c.whatsapp,
    c.email,
    c.empresa_id,
    e.titulo AS empresa_titulo,
    e.unidade,
    e.origem_da_base
   FROM contatos c
     LEFT JOIN empresas e ON e.id = c.empresa_id
     LEFT JOIN central_tratativas ct ON ct.status = 'lost'::text AND ct.pipedrive_deal_id::text = e.pipedrive_id
  WHERE c.whatsapp IS NOT NULL AND length(regexp_replace(c.whatsapp, '\D'::text, ''::text, 'g'::text)) >= 10 AND ct.pipedrive_deal_id IS NULL
  ORDER BY c.whatsapp, (c.email IS NOT NULL) DESC, c.id DESC;
