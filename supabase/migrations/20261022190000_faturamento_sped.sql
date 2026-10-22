-- Faturamento apurado do cliente, mês a mês, a partir do SPED (API de faturamento do Silas, smartflow-office). Edge
-- Function faturamento-sped; decisões de 22/10/2026 em DECISIONS.md. Dado sensível: só o service role lê e grava.
-- Nenhuma tela lê estas tabelas. A leitura para o Brain Operacional e a Base vem depois, por função com checagem de papel.

create table if not exists ops.faturamento_sped_mensal (
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  raiz text not null check (raiz ~ '^[0-9]{8}$'),
  competencia date not null check (extract(day from competencia) = 1),
  -- ok: há SPED na competência; aguardando_entrega: mês mais recente ainda sem SPED. Mês sem arquivo não tem linha.
  status text not null,
  vendas numeric(18, 2),
  devolucoes numeric(18, 2),
  servicos numeric(18, 2),
  faturamento numeric(18, 2),
  fontes text[],
  entregue_em date,
  baixado_em date,
  retificado boolean,
  carga_id bigint not null,
  atualizado_em timestamptz not null default now(),
  primary key (cnpj, competencia)
);
create index if not exists faturamento_sped_mensal_raiz on ops.faturamento_sped_mensal (raiz, competencia);

create table if not exists ops.faturamento_sped_cargas (
  id bigserial primary key,
  iniciada_em timestamptz not null default now(),
  terminada_em timestamptz,
  status text not null default 'rodando' check (status in ('rodando', 'ok', 'erro', 'interrompida')),
  proxima_pagina int not null default 1,
  paginas int not null default 0,
  empresas int not null default 0,
  meses int not null default 0,
  manual boolean not null default false,
  erro text
);

comment on table ops.faturamento_sped_mensal is
  'Domínio Clientes. Faturamento apurado no SPED por CNPJ e competência, da API de faturamento do Silas: faturamento = vendas - devolucoes + servicos. Só meses ok e aguardando_entrega; mês sem arquivo não tem linha. Dado sensível: leitura só por função com checagem de papel.';
comment on table ops.faturamento_sped_cargas is
  'Domínio Clientes. Uma carga por dia de São Paulo da API de faturamento do SPED, retomada pela página em que parou.';

alter table ops.faturamento_sped_mensal enable row level security;
alter table ops.faturamento_sped_cargas enable row level security;
revoke all on table ops.faturamento_sped_mensal, ops.faturamento_sped_cargas from public, anon, authenticated;
revoke all on sequence ops.faturamento_sped_cargas_id_seq from public, anon, authenticated;

-- O cron chama a Edge Function com o mesmo segredo das funções da Monetização (Vault monetizacao_sync_secret).
create or replace function ops.faturamento_sped_cron()
returns bigint
language sql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-sped',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monetizacao-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'monetizacao_sync_secret')
    ),
    body := '{"action":"rodar"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function ops.faturamento_sped_cron() from public, anon, authenticated;

-- Das 3h às 5h50 de Brasília (6h a 8h50 UTC), a cada 10 minutos. Nasce DESLIGADO: liga com
-- cron.alter_job(jobid, active := true) e FATURAMENTO_SPED_ATIVO=sim, só com o "pode ativar" do Pedro.
select cron.unschedule('faturamento-sped-diario')
 where exists (select 1 from cron.job where jobname = 'faturamento-sped-diario');
select cron.schedule('faturamento-sped-diario', '*/10 6-8 * * *', $cron$
 select ops.faturamento_sped_cron();
$cron$);
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'faturamento-sped-diario';
