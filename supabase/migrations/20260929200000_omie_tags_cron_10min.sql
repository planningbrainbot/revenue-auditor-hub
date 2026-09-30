-- omie-tags-sync passa a ler uma unidade por execução (a Matriz sozinha tem 12 páginas; várias unidades numa
-- execução passaram do limite de 150 s na primeira carga de 29/09). Cron a cada 10 minutos no lugar do de hora em hora.
select cron.unschedule('omie-tags-sync-hora') where exists (select 1 from cron.job where jobname = 'omie-tags-sync-hora');
select cron.unschedule('omie-tags-sync-10min') where exists (select 1 from cron.job where jobname = 'omie-tags-sync-10min');
select cron.schedule('omie-tags-sync-10min', '3-59/10 * * * *', $cron$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/omie-tags-sync',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-planning-sinais-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'base_sinais_cron_secret')),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 150000);
$cron$);
