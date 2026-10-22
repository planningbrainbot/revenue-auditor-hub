select cron.unschedule('faturamento-sped-diario')
 where exists (select 1 from cron.job where jobname = 'faturamento-sped-diario');
drop function if exists ops.faturamento_sped_cron();
drop table if exists ops.faturamento_sped_mensal;
drop table if exists ops.faturamento_sped_cargas;
delete from supabase_migrations.schema_migrations where version = '20261022190000';
