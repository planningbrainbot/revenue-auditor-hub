-- Cockpit do COO: agendamento da sincronização do ClickUp (a cada 10 minutos).
--
-- Aplicar DEPOIS de publicar a função de borda clickup-sync. Sem token, a função responde
-- "sem token" em milissegundos e não grava nada; com o token colado em Administração › Chaves de
-- Integração, a rodada seguinte já espelha o space e liga o monitor (ops.integracoes_config).
-- O segredo do cabeçalho é o mesmo das outras sincronizações (Vault: base_sinais_cron_secret; na
-- função: SINAIS_CRON_SECRET). Rollback: select cron.unschedule('clickup-sync-10min');

select cron.schedule('clickup-sync-10min', '*/10 * * * *', $cron$
 select net.http_post(url:='https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/clickup-sync',headers:=jsonb_build_object('Content-Type','application/json','x-planning-sinais-cron',(select decrypted_secret from vault.decrypted_secrets where name='base_sinais_cron_secret')),body:='{"trigger":"cron"}'::jsonb,timeout_milliseconds:=120000);
$cron$);
