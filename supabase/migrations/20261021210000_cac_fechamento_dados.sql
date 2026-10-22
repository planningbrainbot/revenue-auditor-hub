-- Fechamento do mês do CAC (PRD wiki/prds/2026-10-minha-unidade-fechamento-de-cac.md, seção 7).
--
-- A aba "Fechamento do mês" precisa da apuração de royalties, dos itens de CAC,
-- do CAC das notas e dos estornos do extrato. Essas tabelas só liberam leitura
-- para a matriz; o sócio regional lê por esta função, que devolve só a unidade
-- dele e só apuração confirmada (decisão de 21/10/2026: o sócio vê depois que a
-- matriz confirma). Só leitura.
--
-- Escopo igual ao da v_cac_funil:
--   matriz: view.unidades_rede e (view.broker_admin ou unidade em minhas_unidades)
--   sócio:  view.meu_funil_cac, unidade que paga CAC e em minhas_unidades
create or replace function ops.cac_fechamento_dados(p_unidade_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, pg_temp
as $$
declare
  v_matriz boolean;
  v_socio boolean;
  v_aps integer[];
begin
  v_matriz := ops.can('view.unidades_rede')
    and (ops.can('view.broker_admin') or p_unidade_id in (select ops.minhas_unidades()));
  v_socio := ops.can('view.meu_funil_cac')
    and p_unidade_id in (select ops.minhas_unidades())
    and exists (select 1 from ops.unidades u where u.id = p_unidade_id and u.paga_cac);
  if not (v_matriz or v_socio) then
    raise exception 'sem acesso ao CAC desta unidade' using errcode = '42501';
  end if;

  select coalesce(array_agg(a.id), '{}') into v_aps
    from ops.royalties_apuracao a
   where a.unidade_id = p_unidade_id
     and (v_matriz or a.status = 'confirmado');

  return jsonb_build_object(
    'apuracoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', a.id, 'unidade_id', a.unidade_id, 'mes_referencia', a.mes_referencia,
               'status', a.status, 'cac_valor', a.cac_valor, 'confirmado_em', a.confirmado_em)
             order by a.mes_referencia desc)
        from ops.royalties_apuracao a where a.id = any(v_aps)), '[]'::jsonb),
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'apuracao_id', i.apuracao_id, 'contrato_id', i.contrato_id,
               'razao_social', i.razao_social, 'cnpj', i.cnpj, 'data_ganho', i.data_ganho,
               'cac_parcela', i.cac_parcela, 'royalties_item', i.royalties_item,
               'valor_confirmado', i.valor_confirmado, 'excluido_em', i.excluido_em,
               'motivo_exclusao', i.motivo_exclusao))
        from ops.royalties_itens i where i.apuracao_id = any(v_aps) and i.is_cac), '[]'::jsonb),
    'faturas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'apuracao_id', f.apuracao_id, 'valor_cac', f.valor_cac,
               'status', f.status, 'num_os', f.num_os))
        from ops.royalties_faturas f where f.apuracao_id = any(v_aps)), '[]'::jsonb),
    'estornos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'cliente', m.cliente, 'valor_cb', m.valor_cb,
               'mes_ref', m.mes_ref, 'observacao', m.observacao))
        from ops.broker_movimentos m
       where m.unidade_id = p_unidade_id and m.tipo = 'estorno' and m.origem like 'cac%'), '[]'::jsonb)
  );
end;
$$;

revoke all on function ops.cac_fechamento_dados(integer) from public, anon;
grant execute on function ops.cac_fechamento_dados(integer) to authenticated;
