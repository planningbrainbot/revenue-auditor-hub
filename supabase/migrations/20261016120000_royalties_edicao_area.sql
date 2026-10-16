-- Editar a apuração de royalties sem ser super admin.
--
-- Até aqui toda escrita da apuração (gerar itens, editar, lançar outras
-- receitas, fechar, reabrir, excluir) exigia o papel `admin`: no servidor
-- (`assertAdmin`), na RLS (`has_role(..., 'admin')`) e dentro da RPC de contas
-- fixas. Pedido do usuário em 16/10/2026: liberar a edição para uma pessoa do
-- financeiro sem dar a ela o Ops inteiro.
--
-- A chave `edit.royalties.apuracao` NÃO entra na área `receita`: lá ela iria
-- para diretor, head, auditor e financeiro, que têm a área pelo papel (umas 16
-- pessoas). Mora numa área própria, `royalties_edicao`, como a
-- `people_remuneracao`: concedida pelo papel só a `admin`, e pessoa a pessoa
-- pelo resto. Emitir a fatura no Omie, mudar CNPJ do contrato e marcar churn
-- continuam só do admin.

begin;

-- 1. Chave em área própria --------------------------------------------------
insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa)
values ('royalties_edicao', 'Royalties: edição da apuração',
        'Lançar, editar, fechar e reabrir a apuração de royalties das unidades. Não inclui emitir a fatura no Omie.',
        'unidade', 32, true)
on conflict (slug) do nothing;

insert into ops.area_chaves (area, permission_key)
values ('royalties_edicao', 'edit.royalties.apuracao')
on conflict do nothing;

insert into ops.role_areas (role, area, allowed)
values ('admin', 'royalties_edicao', true)
on conflict do nothing;

-- 2. RLS: escrita por chave, ao lado das policies de admin --------------------
-- Separadas por comando de propósito: `for all` concederia SELECT também.
-- A trava de unidade (`escopo_unidade`, RESTRICTIVE) continua valendo.
do $$
declare
  t text;
begin
  foreach t in array array['royalties_apuracao', 'royalties_itens', 'royalties_outras_receitas_itens'] loop
    execute format('drop policy if exists editar_royalties_insert on ops.%I', t);
    execute format('drop policy if exists editar_royalties_update on ops.%I', t);
    execute format('drop policy if exists editar_royalties_delete on ops.%I', t);
    execute format(
      'create policy editar_royalties_insert on ops.%I for insert to authenticated
         with check (tem_produto(''ops'') and (select ops.can(''edit.royalties.apuracao'')))', t);
    execute format(
      'create policy editar_royalties_update on ops.%I for update to authenticated
         using (tem_produto(''ops'') and (select ops.can(''edit.royalties.apuracao'')))
         with check (tem_produto(''ops'') and (select ops.can(''edit.royalties.apuracao'')))', t);
    execute format(
      'create policy editar_royalties_delete on ops.%I for delete to authenticated
         using (tem_produto(''ops'') and (select ops.can(''edit.royalties.apuracao'')))', t);
  end loop;
end $$;

-- 3. RPC de contas fixas: aceita a chave além do super admin -------------------
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
$$;

revoke all on function ops.royalties_aplicar_contas_fixas(bigint) from public;
grant execute on function ops.royalties_aplicar_contas_fixas(bigint) to authenticated, service_role;

-- 4. Primeira concessão: Luiz Pinho (financeiro), pedido de 16/10/2026 --------
-- Pela delegação da área (nível admin), como ele já tem na `receita`: chave
-- pessoa a pessoa só pode ser de consulta (`usuario_chaves_usuario_so_consulta`).
-- Tira-se em /admin/usuarios, área "Royalties: edição da apuração".
insert into ops.area_admins (user_id, area, nivel)
select u.id, 'royalties_edicao', 'admin' from auth.users u where u.email = 'luiz.pinho@planning.com.br'
on conflict (user_id, area) do update set nivel = 'admin';

commit;
