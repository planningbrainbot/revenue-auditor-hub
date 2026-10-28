-- Fatia 0 do PRD wiki/prds/2026-10-minha-unidade-atualizacao-da-base.md (R-20, R-21, R-23).
-- Antes de o sócio poder propor mudança na base, ele deixa de ler o que não é da unidade dele.
--
-- 1. ops.contatos não tinha escopo de unidade: o sócio (view.contatos) lia os 2.859 contatos
--    da rede. Ganha a RESTRICTIVE escopo_unidade, pela unidade da empresa vinculada, com o
--    mesmo corpo das outras tabelas (migration 63). Contato sem empresa fica fora para quem
--    tem escopo de unidade.
-- 2. cpf sai do alcance de authenticated (grant por coluna). As funções que leem cpf
--    (base_contatos_exportar, base_ingest_pipefy, monetizacao_handoff_claim,
--    monetizacao_detail) são SECURITY DEFINER e não mudam; o service role também não.
--    O diálogo de contatos do Ops deixa de pedir cpf no mesmo deploy.
-- 3. authenticated não escreve em contatos (não havia policy de escrita, só o grant).
-- 4. v_clientes_diretorio não tem uso no Ops e abria a rede inteira: sai de authenticated.
-- 5. v_nps_regional não tinha gate nenhum: ganha a chave de NPS e o escopo de unidade no
--    WHERE (view não herda RLS).


create policy escopo_unidade on ops.contatos
  as restrictive for all to authenticated
  using (
    (not (select ops.can('data.scope.own_unit_only')))
    or exists (
      select 1 from ops.empresas e
      where e.id = contatos.empresa_id
        and nullif(ops.norm_unidade(e.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}'))
    )
  );

revoke insert, update, delete on ops.contatos from authenticated, anon;
revoke select on ops.contatos from authenticated, anon;
grant select (id, pipefy_record_id, nome_completo, email, whatsapp, cargo,
              empresa_pipefy_record_id, empresa_id, created_at, updated_at, synced_at)
  on ops.contatos to authenticated;

revoke all on ops.v_clientes_diretorio from authenticated, anon;

create or replace view ops.v_nps_regional as
 select n.id,
    n.pipefy_card_id,
    n.pipedrive_deal_id,
    n.empresa,
    n.unidade,
    n.segmento,
    n.email_pesquisa,
    n.nome_contato,
    n.telefone_pesquisa,
    n.nps_recomendacao,
    n.avaliacao_fiscal,
    n.fase,
    n.created_at,
    n.updated_at
   from ops.nps_pesquisas n
     join ops.unidades u on lower(trim(both from n.unidade)) = lower(trim(both from u.nome_da_praca))
  where u.tipo = 'regional'
    and ((select ops.can('view.nps')) or (select ops.can('view.painel_cs')))
    and ((not (select ops.can('data.scope.own_unit_only')))
         or nullif(ops.norm_unidade(n.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}')));

revoke insert, update, delete on ops.v_nps_regional from authenticated, anon;

