-- Desfaz 20261016120000_consultoria_plataforma_espelho.sql: volta a cópia da API para de hora em hora e tira o espelho
-- da plataforma. A ficha da busca volta a mostrar só o que a API manda.
begin;
select cron.unschedule('consultoria-plataforma-sync-15min') where exists (select 1 from cron.job where jobname = 'consultoria-plataforma-sync-15min');
select cron.unschedule('consultoria-sync-15min') where exists (select 1 from cron.job where jobname = 'consultoria-sync-15min');
select cron.schedule('consultoria-sync-hora', '20 * * * *', $cron$
 select net.http_post(url:='https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/consultoria-sync',headers:=jsonb_build_object('Content-Type','application/json','x-planning-sinais-cron',(select decrypted_secret from vault.decrypted_secrets where name='base_sinais_cron_secret')),body:='{"trigger":"cron"}'::jsonb,timeout_milliseconds:=120000);
$cron$);
update ops.integracoes_config set intervalo_esperado_minutos = 60,
  observacao = 'Edge Function consultoria-sync, pg_cron de hora em hora (job consultoria-sync-hora). API api-comercial do Pedro Siqueira, header x-api-key.'
 where fonte = 'consultoria';
delete from ops.integracoes_config where fonte = 'consultoria_plataforma';
drop function if exists ops.consultoria_empresa_ficha(text[], text[], text[]);
drop function if exists ops.consultoria_plataforma_indice();
drop function if exists ops.consultoria_plataforma_dados(text, text[]);
drop function if exists ops.consultoria_porta_leitura();
drop function if exists ops.consultoria_plataforma_gravar(text, jsonb);
drop function if exists ops.consultoria_nome_norm(text);
drop table if exists ops.consultoria_plataforma;
commit;
