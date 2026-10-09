-- Cadência da pré-venda da Monetização (pipe 39 do Pipedrive). Pedido do Pedro em 09/10/2026.
-- Quando um card sai de "1 · Base elegível" (274) e entra em "2 · Abordagem iniciada" (276), a Edge Function
-- `monetizacao-cadencia` cria no card as atividades da régua (supabase/functions/monetizacao-cadencia/regua.ts) e
-- guarda aqui o que criou. Quando o card sai da 276, a cadência é encerrada e só as atividades dela que ainda não
-- foram feitas são apagadas.
--
-- ORDEM DE PUBLICAÇÃO: a Edge Function `monetizacao-cadencia` (com --no-verify-jwt) ANTES desta migration. O cron
-- abaixo passa a chamá-la a cada 5 minutos assim que esta migration roda.
-- KILL SWITCH: fica na função, não aqui. Sem o secret MONET_CADENCIA_ATIVA=sim ela só responde o que faria
-- (dry-run), sem escrever no Pipedrive nem nesta tabela; sem MONET_CADENCIA_INICIO, não cria cadência nenhuma.

create table if not exists ops.monetizacao_cadencia (
  deal_id bigint not null,
  entrou_em timestamptz not null,
  dono bigint,
  versao_regua text not null,
  atividades jsonb not null default '[]'::jsonb check (jsonb_typeof(atividades) = 'array'),
  status text not null default 'ativa' check (status in ('ativa', 'encerrada', 'ignorada')),
  criado_em timestamptz not null default now(),
  encerrado_em timestamptz,
  motivo_encerramento text,
  primary key (deal_id, entrou_em)
);

comment on table ops.monetizacao_cadencia is
  'Cadência da pré-venda do pipe 39: uma linha por entrada de um card na etapa 2 · Abordagem iniciada (276). '
  'A chave (deal_id, entrou_em) é a idempotência: a mesma entrada nunca ganha duas cadências. '
  'Escrita só pela Edge Function monetizacao-cadencia (service role).';
comment on column ops.monetizacao_cadencia.entrou_em is
  'stage_change_time do card na entrada na etapa 276 (UTC). Card que sai e volta ganha outra linha.';
comment on column ops.monetizacao_cadencia.dono is
  'user_id do Pipedrive do dono do card quando a cadência começou; as atividades vão para ele.';
comment on column ops.monetizacao_cadencia.versao_regua is
  'VERSAO_REGUA de regua.ts com que a cadência começou. Só a versão vigente é completada numa retomada.';
comment on column ops.monetizacao_cadencia.atividades is
  'Atividades criadas no Pipedrive: [{id, chave, dia, canal, tipo, turno, due_date, due_time}], due em UTC. '
  'Gravada a cada atividade criada, para a rodada seguinte completar só o que falta. '
  'No encerramento, só as desta lista que não foram feitas são apagadas.';
comment on column ops.monetizacao_cadencia.status is
  'ativa: cadência em curso. encerrada: o card saiu da 276 (motivo em motivo_encerramento). '
  'ignorada: o card entrou na 276 sem vir da 274 (voltou de outra etapa ou foi criado direto nela); '
  'fica gravada para não reconsultar o histórico do card a cada rodada.';
comment on column ops.monetizacao_cadencia.motivo_encerramento is
  'Por que acabou (saiu para a etapa N, perdido, ganho, apagado, saiu e voltou à etapa) ou por que foi ignorada.';

create index if not exists monetizacao_cadencia_ativas on ops.monetizacao_cadencia (deal_id)
  where status = 'ativa';

-- RLS ligada e sem policy: ninguém lê nem escreve pelo app; só o service role (a Edge Function), que ignora RLS.
alter table ops.monetizacao_cadencia enable row level security;

revoke all on ops.monetizacao_cadencia from public, anon, authenticated;
grant all on ops.monetizacao_cadencia to service_role;

-- O cron chama a Edge Function a cada 5 minutos, com o mesmo segredo da carga do CRM e das reuniões.
create or replace function ops.monetizacao_cadencia_cron()
returns bigint
language sql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/monetizacao-cadencia',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monetizacao-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'monetizacao_sync_secret')
    ),
    body := '{"action":"rodar"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;

revoke all on function ops.monetizacao_cadencia_cron() from public, anon, authenticated;

select cron.unschedule('monetizacao-cadencia-5min')
 where exists (select 1 from cron.job where jobname = 'monetizacao-cadencia-5min');
select cron.schedule('monetizacao-cadencia-5min', '*/5 * * * *', $cron$
 select ops.monetizacao_cadencia_cron();
$cron$);
