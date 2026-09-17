begin;
create table if not exists ops.base_omie_jobs (
 aplicativo text primary key, pagina integer not null default 1,
 proxima_execucao timestamptz not null default now(), lease uuid,
 atualizado_em timestamptz, erro text
);
alter table ops.base_omie_jobs enable row level security;
revoke all on ops.base_omie_jobs from public,anon,authenticated;
grant all on ops.base_omie_jobs to service_role;
insert into ops.base_omie_jobs(aplicativo)
select unidade from ops.omie_credentials where ativo and unidade in ('Curitiba','Planning CWB 01','Planning CWB 02')
on conflict do nothing;

create or replace function ops.base_omie_claim() returns jsonb
language plpgsql security definer set search_path=ops,public,extensions as $$
declare job ops.base_omie_jobs;
begin
 select * into job from ops.base_omie_jobs where proxima_execucao<=now()
 order by proxima_execucao,aplicativo for update skip locked limit 1;
 if not found then return null;end if;
 update ops.base_omie_jobs set lease=gen_random_uuid(),proxima_execucao=now()+interval '5 minutes'
 where aplicativo=job.aplicativo returning * into job;
 return to_jsonb(job);
end $$;
revoke all on function ops.base_omie_claim() from public,anon,authenticated;
grant execute on function ops.base_omie_claim() to service_role;
notify pgrst,'reload schema';
commit;
