-- Próximo passo sugerido pelo Jev para os cards parados da reta final do pipe 39 (14/10/2026, pedido do Pedro depois da
-- call com o Paulo; PRD https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4). Quem grava é a Edge Function
-- monetizacao-proximo-passo; quem lê é a tela Pré-venda › Hoje, pela RPC abaixo. Nada vai para o Pipedrive.

create table if not exists ops.monetizacao_proximo_passo (
  deal_id bigint primary key,
  passo text not null,
  confianca numeric,
  urgencia smallint not null check (urgencia between 0 and 2),
  base text not null,
  versao text not null,
  gerado_em timestamptz not null default now(),
  custo_usd numeric,
  erro text
);

alter table ops.monetizacao_proximo_passo enable row level security;
revoke all on ops.monetizacao_proximo_passo from public, anon, authenticated;
grant all on ops.monetizacao_proximo_passo to service_role;

create or replace function ops.monetizacao_pre_venda_proximo_passo()
returns table (
  deal_id bigint,
  passo text,
  confianca numeric,
  urgencia smallint,
  gerado_em timestamptz
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  return query
  select p.deal_id, p.passo, p.confianca, p.urgencia, p.gerado_em
    from ops.monetizacao_proximo_passo p
   order by p.urgencia desc, p.deal_id;
end
$$;
revoke all on function ops.monetizacao_pre_venda_proximo_passo() from public, anon;
grant execute on function ops.monetizacao_pre_venda_proximo_passo() to authenticated;

-- O cron chama a Edge Function de hora em hora nos dias úteis, das 7h15 às 19h15 de São Paulo, com o mesmo segredo
-- da carga do CRM. Card que não mudou não é reavaliado antes de 20 horas.
create or replace function ops.monetizacao_proximo_passo_cron()
returns bigint
language sql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/monetizacao-proximo-passo',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monetizacao-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'monetizacao_sync_secret')
    ),
    body := '{"action":"rodar"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;

revoke all on function ops.monetizacao_proximo_passo_cron() from public, anon, authenticated;

select cron.unschedule('monetizacao-proximo-passo-hora')
 where exists (select 1 from cron.job where jobname = 'monetizacao-proximo-passo-hora');
select cron.schedule('monetizacao-proximo-passo-hora', '15 10-22 * * 1-5', $cron$
 select ops.monetizacao_proximo_passo_cron();
$cron$);
