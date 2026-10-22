-- Envio dos negócios da Cella para o Pipedrive da Diehl & Cella (funil 9 "Projeto Planning"). Edge Function
-- monetizacao-cella-envio; decisões de 22/10/2026 em DECISIONS.md. Só o service role lê e grava: nada aqui vai para tela.

-- Um card da Planning por linha: a que negócio deles ele está ligado e o que foi enviado por último.
create table if not exists ops.monetizacao_cella_envios (
  deal_id bigint primary key,
  pipe smallint not null,
  -- criado: o envio criou o negócio deles; existente: o negócio já existia no funil 9 e foi ligado à mão (22/10).
  vinculo text check (vinculo in ('criado', 'existente')),
  -- parado_deles: o negócio deles está ganho, perdido ou excluído, e o envio não mexe mais nele.
  estado text not null default 'ativo' check (estado in ('ativo', 'encerrado', 'parado_deles', 'pendente')),
  cella_deal_id bigint,
  cella_org_id bigint,
  cella_person_id bigint,
  cella_activity_id bigint,
  status_deles text,
  hash text,
  ultimo_evento text,
  simulado_hash text,
  simulado jsonb,
  enviado_em timestamptz,
  erro text,
  atualizado_em timestamptz not null default now()
);

-- Cada envio (ou prévia) com o que saiu e o que voltou: é a prova do que a Planning compartilhou com o parceiro.
create table if not exists ops.monetizacao_cella_envios_log (
  id bigserial primary key,
  deal_id bigint not null,
  evento text not null,
  acao text not null,
  simulado boolean not null,
  envio jsonb,
  resposta jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists monetizacao_cella_envios_log_deal on ops.monetizacao_cella_envios_log (deal_id, criado_em desc);

create table if not exists ops.monetizacao_cella_sync (
  id boolean primary key default true check (id),
  status text,
  resumo jsonb,
  erro text,
  rodado_em timestamptz
);

alter table ops.monetizacao_cella_envios enable row level security;
alter table ops.monetizacao_cella_envios_log enable row level security;
alter table ops.monetizacao_cella_sync enable row level security;
revoke all on table ops.monetizacao_cella_envios, ops.monetizacao_cella_envios_log, ops.monetizacao_cella_sync
  from public, anon, authenticated;
revoke all on sequence ops.monetizacao_cella_envios_log_id_seq from public, anon, authenticated;

-- O cron chama a Edge Function a cada 5 minutos, quatro minutos depois da carga do CRM (o espelho já está fresco),
-- com o mesmo segredo das outras funções da Monetização. Desligada (MONET_CELLA_ENVIO_ATIVO ≠ sim), só registra prévia.
create or replace function ops.monetizacao_cella_envio_cron()
returns bigint
language sql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/monetizacao-cella-envio',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monetizacao-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'monetizacao_sync_secret')
    ),
    body := '{"action":"rodar"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function ops.monetizacao_cella_envio_cron() from public, anon, authenticated;

select cron.unschedule('monetizacao-cella-envio-5min')
 where exists (select 1 from cron.job where jobname = 'monetizacao-cella-envio-5min');
select cron.schedule('monetizacao-cella-envio-5min', '4-59/5 * * * *', $cron$
 select ops.monetizacao_cella_envio_cron();
$cron$);
