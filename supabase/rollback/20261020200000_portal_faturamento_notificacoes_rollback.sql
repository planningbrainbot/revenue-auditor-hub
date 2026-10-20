-- Rollback de 20261020200000_portal_faturamento_notificacoes.sql: tira o gatilho, as funções e a fila de notificações,
-- e devolve ao job da fila o comando de 20261020190000. Atenção: apagar a fila apaga o histórico das notificações.
begin;

drop trigger if exists fat_eventos_notificar on receita.fat_eventos;
drop function if exists receita.fat_notificar_evento();
drop function if exists ops.fat_conector_notificacoes_resultado(uuid, text, text, text, text, text, jsonb);
drop function if exists ops.fat_conector_notificacoes_proximos(integer);
drop function if exists integracoes.fat_notificacoes_resultado(uuid, text, text, text, text, text, jsonb);
drop function if exists integracoes.fat_notificacoes_proximos(integer);
drop table if exists integracoes.notificacoes;

select cron.unschedule('faturamento-omie-fila')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-fila');
select cron.schedule('faturamento-omie-fila', '*/2 * * * *', $cron$select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-omie',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-faturamento-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'faturamento_cron_secret')),
    body := '{"acao":"processar","origem":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
   where exists (
     select 1 from integracoes.omie_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'))
      or exists (
     select 1 from integracoes.pipefy_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'));$cron$);

do $conferencia$
begin
  if to_regclass('integracoes.notificacoes') is not null then raise exception 'rollback T6: a fila sobrou'; end if;
  if exists (select 1 from pg_trigger where tgname = 'fat_eventos_notificar') then
    raise exception 'rollback T6: o gatilho sobrou';
  end if;
  if exists (select 1 from cron.job where jobname = 'faturamento-omie-fila' and command like '%notificacoes%') then
    raise exception 'rollback T6: o job da fila ainda olha as notificações';
  end if;
end $conferencia$;

commit;
