-- A apuração lê o boleto de contas fixas já emitido no Omie.
--
-- Desde a competência 09/2026 a `csc-faturamento-mensal` emite um boleto só por
-- unidade (SIGLA-FIX-MMAAAA) com CSC + mídia + CS + RH + Compliance, registrado em
-- `ops.csc_ciclos`. A apuração continuava com o CSC do cadastro, a mídia digitada
-- e sem CS/RH/Compliance (que saíram de "outras receitas" em 01/10/2026 para não
-- cobrar duas vezes). Resultado: o que já foi faturado não aparecia na apuração.
--
-- Decisão do usuário em 07/10/2026: o boleto faturado é a fonte da parte fixa.
--   csc_valor_fixo        = item `csc` do boleto
--   csc_trafego_pago      = item `midia` do boleto
--   servicos_fixos_valor  = demais itens (cs, gg = RH, comp = Compliance)
-- A ND de royalties não muda: continua cobrando só royalties + CAC + outras.
-- Patos de Minas: o CSC passou a ser fixo de R$ 5.000 a partir de 09/2026
-- (decisão do usuário), e é isso que o boleto traz.

begin;

alter table ops.royalties_apuracao
  add column if not exists servicos_fixos_valor numeric,
  add column if not exists contas_fixas_ciclo_id bigint references ops.csc_ciclos(id);

comment on column ops.royalties_apuracao.servicos_fixos_valor is
  'CS + RH + Compliance cobrados no boleto de contas fixas da competência (csc_ciclos.itens fora de csc e midia).';
comment on column ops.royalties_apuracao.contas_fixas_ciclo_id is
  'Boleto de contas fixas (ops.csc_ciclos) de onde vieram csc_valor_fixo, csc_trafego_pago e servicos_fixos_valor. Nulo = parte fixa do cadastro, como antes de 09/2026.';

-- Idempotente. Só mexe em apuração aberta e de 09/2026 em diante: mês fechado
-- não se reescreve, e antes disso não existia boleto unificado.
create or replace function ops.royalties_aplicar_contas_fixas(p_apuracao_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to ops, public
as $$
declare
  a      ops.royalties_apuracao%rowtype;
  c      ops.csc_ciclos%rowtype;
  v_csc   numeric;
  v_midia numeric;
  v_serv  numeric;
  v_outras numeric;
begin
  if auth.uid() is not null and not ops.eh_super_admin(auth.uid()) then
    raise exception 'Acesso negado: necessário perfil admin.';
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
$$;

revoke all on function ops.royalties_aplicar_contas_fixas(bigint) from public;
grant execute on function ops.royalties_aplicar_contas_fixas(bigint) to authenticated, service_role;

-- Aplica nas apurações abertas que já existem (09/2026: Campo Novo e Fortaleza).
select ops.royalties_aplicar_contas_fixas(id)
  from ops.royalties_apuracao
 where mes_referencia >= date '2026-09-01'
   and status not in ('confirmado', 'faturado');

commit;
