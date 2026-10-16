-- Volta royalties_aplicar_contas_fixas à versão anterior e tira a coluna.
-- Valores editados à mão ficam como estão em servicos_fixos_valor.

CREATE OR REPLACE FUNCTION ops.royalties_aplicar_contas_fixas(p_apuracao_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public'
AS $function$
declare
  a      ops.royalties_apuracao%rowtype;
  c      ops.csc_ciclos%rowtype;
  v_csc   numeric;
  v_midia numeric;
  v_serv  numeric;
  v_outras numeric;
begin
  if auth.uid() is not null
     and not ops.eh_super_admin(auth.uid())
     and not ops.can('edit.royalties.apuracao') then
    raise exception 'Acesso negado: necessário permissão para editar a apuração de royalties.';
  end if;

  select * into a from ops.royalties_apuracao where id = p_apuracao_id;
  if not found then
    raise exception 'Apuração % não existe', p_apuracao_id;
  end if;
  if a.status in ('confirmado', 'faturado') then
    return jsonb_build_object('aplicado', false, 'motivo', 'apuração fechada');
  end if;
  if a.mes_referencia < date '2026-09-01' then
    return jsonb_build_object('aplicado', false, 'motivo', 'antes do boleto de contas fixas');
  end if;

  select cc.* into c
    from ops.csc_ciclos cc
    join ops.csc_unidades cu on cu.sigla = cc.sigla
   where cu.unidade_id = a.unidade_id
     and cc.competencia = a.mes_referencia
     and cc.status = 'faturada'
   order by cc.id desc
   limit 1;
  if not found then
    return jsonb_build_object('aplicado', false, 'motivo', 'boleto da competência ainda não faturado');
  end if;

  select coalesce(sum((i->>'valor')::numeric) filter (where i->>'servico' = 'csc'), 0),
         coalesce(sum((i->>'valor')::numeric) filter (where i->>'servico' = 'midia'), 0),
         coalesce(sum((i->>'valor')::numeric) filter (where i->>'servico' not in ('csc', 'midia')), 0)
    into v_csc, v_midia, v_serv
    from jsonb_array_elements(coalesce(c.itens, '[]'::jsonb)) i;

  -- A apuração nasce copiando "outras receitas" do mês anterior, que até 08/2026
  -- trazia Customer Success e Gente e Gestão. Se o boleto já cobra, sai daqui.
  delete from ops.royalties_outras_receitas_itens o
   where o.apuracao_id = p_apuracao_id
     and (   (ops.cac_nome_chave(o.nome) ~ '^customer success' and c.itens @> '[{"servico":"cs"}]')
          or (ops.cac_nome_chave(o.nome) ~ '^gente'            and c.itens @> '[{"servico":"gg"}]')
          or (ops.cac_nome_chave(o.nome) ~ 'compliance'        and c.itens @> '[{"servico":"comp"}]'));

  select coalesce(sum(o.valor), 0) into v_outras
    from ops.royalties_outras_receitas_itens o
   where o.apuracao_id = p_apuracao_id;

  update ops.royalties_apuracao
     set csc_valor_fixo        = v_csc,
         csc_trafego_pago      = v_midia,
         servicos_fixos_valor  = v_serv,
         contas_fixas_ciclo_id = c.id,
         outras_receitas       = v_outras,
         total_fatura          = v_csc + coalesce(royalties_valor, 0) + coalesce(cac_valor, 0)
                                 + v_outras + v_midia + v_serv,
         updated_at            = now()
   where id = p_apuracao_id;

  return jsonb_build_object(
    'aplicado', true, 'ciclo_id', c.id, 'nd', c.num_recibo,
    'csc', v_csc, 'midia', v_midia, 'servicos', v_serv);
end;
$function$

;

alter table ops.royalties_apuracao drop column if exists servicos_fixos_editado;
