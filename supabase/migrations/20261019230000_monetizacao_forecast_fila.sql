-- Forecast da Monetização abre pela fila do dia (19/10/2026, pedido do Pedro; protótipo
-- https://claude.ai/artifact/C2zwdHXMixW8ZdWJd5VfEH). A tela agrupa os cards da reta final pelo próximo passo do Jev
-- e mostra, em cada linha, a última nota escrita pelo dono do card e se a empresa já está na Consultoria.
--
-- 1. ops.monetizacao_ultima_nota: a última nota do dono de cada card da reta final (Reunião de proposta em diante,
--    Stand by incluído). Gravada pela função monetizacao-proximo-passo, que já lê as notas para o Jev; o dossiê e as
--    notas automáticas (usuário de integração) ficam fora, como no Jev.
-- 2. ops.monetizacao_forecast_fila(): passo, urgência e confiança do Jev, a última nota e o bloqueio da Consultoria
--    (ops.base_consultoria_bloqueio sobre ops.base_conta_sinais, a mesma régua das ofertas), com o recorte de unidade
--    de ops.monetizacao_deals_leitura().

create table if not exists ops.monetizacao_ultima_nota (
  deal_id bigint primary key,
  nota text not null,
  nota_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table ops.monetizacao_ultima_nota enable row level security;
revoke all on ops.monetizacao_ultima_nota from public, anon, authenticated;
grant all on ops.monetizacao_ultima_nota to service_role;

create or replace function ops.monetizacao_forecast_fila()
returns table (
  deal_id bigint,
  passo text,
  confianca numeric,
  urgencia smallint,
  gerado_em timestamptz,
  nota text,
  nota_em timestamptz,
  consultoria text
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
declare
  v_todas boolean := coalesce((select e.todas_unidades from ops.usuario_escopo e where e.user_id = auth.uid()), false);
  v_minhas integer[] := array(select ops.minhas_unidades());
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  return query
  with reta as (
    select d.id, d.org_id
      from ops.monetizacao_deals d
     where d.payload->>'status' = 'open'
       and (v_todas or coalesce(d.unidade_ids && v_minhas, false))
       and (exists (select 1 from ops.monetizacao_proximo_passo p where p.deal_id = d.id)
            or exists (select 1 from ops.monetizacao_ultima_nota n where n.deal_id = d.id))
  )
  select r.id, p.passo, p.confianca, p.urgencia, p.gerado_em, n.nota, n.nota_em,
         ops.base_consultoria_bloqueio(s.consultoria)
    from reta r
    left join ops.monetizacao_proximo_passo p on p.deal_id = r.id
    left join ops.monetizacao_ultima_nota n on n.deal_id = r.id
    left join lateral (
      select c.key from ops.monetizacao_contas c where r.org_id = any(c.org_ids) order by c.key limit 1
    ) k on true
    left join lateral ops.base_conta_sinais(array[k.key]) s on true
   order by r.id;
end
$$;
revoke all on function ops.monetizacao_forecast_fila() from public, anon;
grant execute on function ops.monetizacao_forecast_fila() to authenticated;
