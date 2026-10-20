-- Portal de Faturamento · T2, agenda do conector do Omie (20/10/2026).
--
-- Plano: PM Work/execution/portal-faturamento-prd-20261013/e1/PLANO-E1.md (linha T2). API: e1/API.md §2.2 e §2.5.
-- Edge: supabase/functions/faturamento-omie (publicada com --no-verify-jwt; todas as emissoras em modo_omie = simular).
-- Ensaio (begin … rollback): supabase/gates/20261020_portal_faturamento_conector_cron.sql
-- Rollback: supabase/rollback/20261020160000_portal_faturamento_conector_cron_rollback.sql
--
-- Dois jobs no pg_cron, os dois chamando a edge com o cabeçalho x-faturamento-cron e o segredo
-- faturamento_cron_secret do Vault (o mesmo valor está no segredo FATURAMENTO_CRON_SECRET da edge; nenhum dos dois
-- aparece neste arquivo):
--   1. faturamento-omie-fila, a cada 2 minutos: processa a fila integracoes.omie_envios (no máximo 12 envios e
--      80 segundos por rodada, para duas rodadas nunca falarem com a mesma chave do Omie ao mesmo tempo). Só chama a
--      edge quando há envio vencido na fila, ou preso em processamento há mais de 15 minutos (o banco devolve esse à
--      fila na reserva): fila vazia não gasta chamada.
--   2. faturamento-omie-status, às 8h, 12h e 16h de São Paulo (11h, 15h e 19h UTC; sem horário de verão desde 2019),
--      de segunda a sexta: a edge chama integracoes.fat_status_enfileirar (RF-P09, leitura de 4 em 4 horas em dia
--      útil, 8h–18h) e processa a fila. Só chama quando existe pedido com OS real ainda aberto.
-- Feriado ainda conta como dia útil aqui (o calendário de feriados é da E3); a leitura num feriado só lê o Omie.

begin;

do $pre$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'faturamento_cron_secret') then
    raise exception 'T2: segredo faturamento_cron_secret ausente no Vault (crie antes de agendar)';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') or not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise exception 'T2: pg_net e pg_cron são necessários';
  end if;
end $pre$;

select cron.unschedule('faturamento-omie-fila')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-fila');
select cron.schedule('faturamento-omie-fila', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-omie',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-faturamento-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'faturamento_cron_secret')),
    body := '{"acao":"processar","origem":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
   where exists (
     select 1 from integracoes.omie_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'));
$cron$);

select cron.unschedule('faturamento-omie-status')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-status');
select cron.schedule('faturamento-omie-status', '0 11,15,19 * * 1-5', $cron$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-omie',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-faturamento-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'faturamento_cron_secret')),
    body := '{"acao":"enfileirar_status","origem":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
   where exists (
     select 1 from receita.fat_pedidos p
      where p.omie_os_codigo is not null
        and p.status in ('os_criada', 'em_conferencia', 'faturado', 'em_atraso', 'cancelamento_pedido'));
$cron$);

do $conferencia$
declare n int;
begin
  select count(*) into n from cron.job
   where jobname in ('faturamento-omie-fila', 'faturamento-omie-status') and active;
  if n <> 2 then raise exception 'T2: % jobs do conector ativos (esperava 2)', n; end if;
  select count(*) into n from cron.job
   where jobname like 'faturamento-omie%' and command like '%faturamento_cron_secret%'
     and command like '%/functions/v1/faturamento-omie%' and command not like '%Bearer%';
  if n <> 2 then raise exception 'T2: jobs sem o segredo do Vault ou com outra autenticação (% de 2)', n; end if;
end $conferencia$;

commit;
