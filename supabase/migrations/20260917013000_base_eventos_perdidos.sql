begin;
set local lock_timeout='3s';
create or replace function ops.base_sync_missing(_kind text,_lease uuid) returns jsonb
language sql stable security definer set search_path=ops,public,extensions as $$
 select coalesce(jsonb_agg(registro_id),'[]') from (
  select s.registro_id from ops.base_sync_jobs j join ops.base_sync_execucoes r on r.id=j.run
  join ops.base_sync_registros s on s.fonte=case when j.kind='companies' then 'pipefy_empresa' else 'pipefy_contato' end
  where j.kind=_kind and j.lease=_lease and j.lease_until>now()
   and s.status<>'ausente' and s.lido_em<r.inicio
  order by s.lido_em limit 10
 ) missing
$$;
revoke all on function ops.base_sync_missing(text,uuid) from public,anon,authenticated;
grant execute on function ops.base_sync_missing(text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
