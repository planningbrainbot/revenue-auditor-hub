-- Previsão de fechamento pelo Jev (15/10/2026). A tela Forecast agrupa pela data esperada de fechamento do Pipedrive, e
-- nenhum dos cards da Reunião de proposta em diante tinha a data. Enquanto o card não tem data, o Jev lê as notas e
-- estima o horizonte (esta semana, este mês, mês que vem, sem previsão); a data do card, quando existe, manda.
-- Quem grava é a Edge Function monetizacao-proximo-passo, na mesma rodada de hora em hora.

create table if not exists ops.monetizacao_previsao_jev (
  deal_id bigint primary key,
  horizonte text not null check (horizonte in ('esta_semana', 'este_mes', 'proximo_mes', 'sem_previsao')),
  confianca numeric,
  base text not null,
  versao text not null,
  gerado_em timestamptz not null default now(),
  custo_usd numeric
);

alter table ops.monetizacao_previsao_jev enable row level security;
revoke all on ops.monetizacao_previsao_jev from public, anon, authenticated;
grant all on ops.monetizacao_previsao_jev to service_role;

create or replace function ops.monetizacao_previsao_fechamento()
returns table (
  deal_id bigint,
  horizonte text,
  confianca numeric,
  gerado_em timestamptz
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  return query
  select p.deal_id, p.horizonte, p.confianca, p.gerado_em
    from ops.monetizacao_previsao_jev p
   order by p.deal_id;
end
$$;
revoke all on function ops.monetizacao_previsao_fechamento() from public, anon;
grant execute on function ops.monetizacao_previsao_fechamento() to authenticated;
