-- Leitura da aba Cella da Monetização (`/monetizacao?aba=cella`, contrato docs/design/contratos/monetizacao-cella.md,
-- "contrato ok" do Pedro em 22/10/2026). Junta os cards da Planning ligados ao funil 9 da Diehl & Cella, o que o envio
-- sabe de cada um e os negócios do funil deles (contrato e teses). A conta (crédito, honorário de 20% do contrato, parte
-- da Planning) fica no cliente, em src/lib/monetizacao/cella.ts.
create or replace function ops.monetizacao_cella_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  v_todas boolean := coalesce((select e.todas_unidades from ops.usuario_escopo e where e.user_id = auth.uid()), false);
  v_minhas integer[] := array(select ops.minhas_unidades());
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização (view.monetizacao).' using errcode = '42501';
  end if;
  return (
    with cards as (
      select d.id, d.payload p, 39 pipe from ops.monetizacao_deals d
       where d.id in (select deal_id from ops.monetizacao_cella_envios)
         and (v_todas or d.unidade_ids && v_minhas)
      union all
      select d.id, d.payload p, 40 pipe from ops.monetizacao_diagnostico_deals d
       where d.id in (select deal_id from ops.monetizacao_cella_envios)
         and (v_todas or d.unidade_ids && v_minhas)
    )
    select jsonb_build_object(
      'sync', (select jsonb_build_object('rodado_em', s.rodado_em, 'status', s.status)
                 from ops.monetizacao_cella_sync s where s.id),
      'cards', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'pipe', c.pipe,
                 'nome', coalesce(nullif(c.p->>'org', ''), c.p->>'title'), 'titulo', c.p->>'title',
                 'url', c.p->>'url', 'status', c.p->>'status',
                 'etapa', coalesce(c.p->>'stage', c.p->>'stage_id'),
                 'dono', c.p->>'owner',
                 'unidade', coalesce(c.p#>>'{revenue,unit_name}', c.p->>'unidade'))) from cards c), '[]'::jsonb),
      'envios', coalesce((select jsonb_agg(jsonb_build_object(
                 'deal_id', e.deal_id, 'estado', e.estado, 'vinculo', e.vinculo, 'status_deles', e.status_deles,
                 'cella_deal_id', e.cella_deal_id, 'assinatura', e.assinatura, 'enviado_em', e.enviado_em))
                 from ops.monetizacao_cella_envios e where e.deal_id in (select id from cards)), '[]'::jsonb),
      'negocios', coalesce((select jsonb_agg(jsonb_build_object(
                 'cella_deal_id', n.cella_deal_id, 'deal_id', n.deal_id, 'principal', n.principal,
                 'titulo', n.titulo, 'status', n.status, 'stage_id', n.stage_id, 'valor', n.valor,
                 'data_contrato', n.data_contrato, 'tipo_contrato', n.tipo_contrato,
                 'atualizado_deles_em', n.atualizado_deles_em))
                 from ops.monetizacao_cella_negocios n
                where n.ausente_desde is null and n.deal_id in (select id from cards)), '[]'::jsonb)
    )
  );
end;
$$;
revoke all on function ops.monetizacao_cella_painel() from public, anon;
grant execute on function ops.monetizacao_cella_painel() to authenticated;
