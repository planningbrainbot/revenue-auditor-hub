-- Reuniões da Monetização (pipe 39): fila do bot e avaliação pelo playbook do Caixa.
-- Spec: docs/superpowers/specs/2026-10-01-monetizacao-reunioes-bot-e-avaliacao.md. Pedido do Pedro em 01/10/2026.
-- Uma linha por reunião enfileirada no Brain Meet (`pedido-monet-<deal>-<início UTC>`). A Edge Function
-- `monetizacao-reunioes` grava com service role; a tela lê pela mesma permissão de `ops.monetizacao_deals`.

create table if not exists ops.monetizacao_reunioes (
  event_id text primary key check (event_id like 'pedido-monet-%'),
  deal_id bigint not null,
  tipo text not null check (tipo in ('levantamento', 'proposta')),
  inicio timestamptz not null,
  fim timestamptz,
  link text,
  closer_pipedrive_id bigint,
  atividade_id bigint,
  status text not null default 'na_fila'
    check (status in ('na_fila', 'cancelada', 'gravando', 'avaliada', 'sem_gravacao', 'erro')),
  gravacao_id uuid,
  avaliacao jsonb,
  nota numeric(3, 1),
  ofertado jsonb,
  nota_pipedrive_id bigint,
  erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists monetizacao_reunioes_deal on ops.monetizacao_reunioes (deal_id);
create index if not exists monetizacao_reunioes_pendentes on ops.monetizacao_reunioes (inicio)
  where status in ('na_fila', 'gravando');

alter table ops.monetizacao_reunioes enable row level security;

-- Leitura: quem vê a Operação da Monetização. Escrita: só service role (a Edge Function).
drop policy if exists monetizacao_reunioes_read on ops.monetizacao_reunioes;
create policy monetizacao_reunioes_read on ops.monetizacao_reunioes
  for select to authenticated
  using (ops.monetizacao_can('view.monetizacao'));

revoke all on ops.monetizacao_reunioes from anon, authenticated;
grant select on ops.monetizacao_reunioes to authenticated;
grant all on ops.monetizacao_reunioes to service_role;

-- O cron chama a Edge Function a cada 5 minutos, com o mesmo segredo da carga do CRM.
create or replace function ops.monetizacao_reunioes_cron()
returns bigint
language sql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/monetizacao-reunioes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monetizacao-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'monetizacao_sync_secret')
    ),
    body := '{"action":"rodar"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;

revoke all on function ops.monetizacao_reunioes_cron() from public, anon, authenticated;
