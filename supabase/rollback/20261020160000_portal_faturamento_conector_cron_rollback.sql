-- Rollback de 20261020160000_portal_faturamento_conector_cron.sql: tira os dois jobs do conector do Omie.
-- O segredo faturamento_cron_secret fica no Vault (apagar é decisão à parte: a edge também o usa).
begin;

select cron.unschedule('faturamento-omie-fila')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-fila');
select cron.unschedule('faturamento-omie-status')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-status');

do $conferencia$
begin
  if exists (select 1 from cron.job where jobname like 'faturamento-omie%') then
    raise exception 'rollback T2: job do conector ainda agendado';
  end if;
end $conferencia$;

commit;
