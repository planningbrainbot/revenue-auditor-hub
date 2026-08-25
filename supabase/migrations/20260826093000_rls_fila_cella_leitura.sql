-- ============================================================================
-- 20260826093000_rls_fila_cella_leitura.sql
--
-- Migration 4 de 5 da spec-tela-fila-cella.md v0.3 (§4.3). Depende so das chaves
-- da #1. RODA ISOLADA e vale como entrega independente: fecha o buraco de RLS de
-- `omie_clientes` mesmo que a Fila Cella atrase.
--
-- Modelos do repo: 20260824150000_rls_disparos_whatsapp_base_contatos.sql
-- (alter policy somando chave), 20260824140000_nps_rls_gap_view_nps.sql
-- (create policy em tabela que nasceu com RLS on e ZERO policy) e
-- 20260814170000_rls_perf_contas_receber.sql (o wrap em `(select ...)`).
--
-- ATENCAO — `alter policy ... using` SUBSTITUI a expressao inteira, NAO acrescenta.
-- Copiar o `using()` de `empresas` para `contratos` revogaria view.reconciliacao e
-- view.rede_ltv. Cada comando abaixo repete o `qual` PROPRIO daquela tabela e so
-- soma a chave nova. Vale a advertencia dobrada para `contatos` e
-- `contratos_documentos`: cada uma tem UMA UNICA policy, puramente can(), sem
-- role_based_read nem "Auditors can read". Expressao errada = admin some tambem.
--
-- ---------------------------------------------------------------------------
-- PRE-CHECAGEM — RODAR ANTES DE APLICAR. O bloco de `alter` so e valido se esta
-- query devolver 6 linhas com os `qual` transcritos aqui:
--
--   select tablename, policyname, qual from pg_policies
--   where schemaname='public' and policyname='Permission-based read'
--     and tablename in ('empresas','contratos','contatos','contratos_documentos',
--                       'cs_onboarding_cards','central_tratativas')
--   order by tablename;
--
-- Estado lido em pg_policies no Ops em 25/08 (spec §4.3):
--   empresas             can('view.clientes') or can('view.painel_cs') or can('view.base_contatos')
--   contratos            can('view.clientes') or can('view.painel_cs') or can('view.reconciliacao') or can('view.rede_ltv')
--   contatos             can('view.contatos') or can('view.base_contatos')          <- policy unica
--   contratos_documentos can('view.painel_cs')                                       <- policy unica
--   cs_onboarding_cards  can('view.painel_cs')
--   central_tratativas   can('view.clientes') or can('view.painel_cs')
--
-- Corroborado em arquivo (clone local do revenue-auditor-hub) para 5 das 6:
--   20260722180000_fix_rls_gap_permissoes_sem_dado.sql:20-33,64-66
--   20260824150000_rls_disparos_whatsapp_base_contatos.sql:11-15
-- `contratos_documentos` NAO tem migration correspondente no repo — a policy foi
-- criada fora do versionamento (o banco tem 52 versoes no ledger contra 110
-- arquivos em disco). Se a PRE-CHECAGEM nao devolver essa linha, o `alter policy`
-- dela falha com "policy does not exist" e vira `create policy`.
-- ---------------------------------------------------------------------------
-- ============================================================================

alter policy "Permission-based read" on public.empresas
  using ((select public.can('view.clientes')) or (select public.can('view.painel_cs'))
      or (select public.can('view.base_contatos')) or (select public.can('view.fila_cella')));

alter policy "Permission-based read" on public.contratos
  using ((select public.can('view.clientes'))      or (select public.can('view.painel_cs'))
      or (select public.can('view.reconciliacao')) or (select public.can('view.rede_ltv'))
      or (select public.can('view.fila_cella')));   -- NAO copiar o qual de empresas:
                                                    -- revogaria reconciliacao e rede_ltv

alter policy "Permission-based read" on public.contatos
  using ((select public.can('view.contatos')) or (select public.can('view.base_contatos'))
      or (select public.can('view.fila_cella')));

-- 374 linhas, 13 dos 57 casamentos (estrategia f2 da spec §5.2). E a UNICA policy
-- da tabela: sem esta linha, quem tem view.fila_cella e nao tem view.painel_cs le zero.
alter policy "Permission-based read" on public.contratos_documentos
  using ((select public.can('view.painel_cs')) or (select public.can('view.fila_cella')));

alter policy "Permission-based read" on public.cs_onboarding_cards
  using ((select public.can('view.painel_cs')) or (select public.can('view.fila_cella')));

alter policy "Permission-based read" on public.central_tratativas
  using ((select public.can('view.clientes')) or (select public.can('view.painel_cs'))
      or (select public.can('view.fila_cella')));

-- ---------------------------------------------------------------------------
-- omie_clientes — CREATE, nao ALTER. RLS on e ZERO policies: hoje so service_role
-- le as 10.189 linhas. Os GRANTs para authenticated ja existem; o que bloqueia e
-- exclusivamente a ausencia de policy. E dela que sai nome_fantasia — fonte unica
-- do CNPJ de 3 das 43 contas (spec §5.2, f3) e um dos caminhos do dialogo do §6.7.
-- Mesmo gap de 20260824140000_nps_rls_gap_view_nps.sql:11-13.
-- Os `drop ... if exists` existem so para reaplicacao idempotente.
-- ---------------------------------------------------------------------------
drop policy if exists "role_based_read" on public.omie_clientes;
create policy "role_based_read" on public.omie_clientes
  for select to authenticated
  using ((select public.has_role(auth.uid(),'admin'::app_role))
      or (select public.has_role(auth.uid(),'diretor'::app_role)));

drop policy if exists "Auditors can read omie_clientes" on public.omie_clientes;
create policy "Auditors can read omie_clientes" on public.omie_clientes
  for select to authenticated
  using ((select public.has_role(auth.uid(),'auditor'::app_role)));

drop policy if exists "Custom roles can read omie_clientes" on public.omie_clientes;
create policy "Custom roles can read omie_clientes" on public.omie_clientes
  for select to authenticated
  using ((select public.is_custom_role(auth.uid())));

drop policy if exists "Permission-based read" on public.omie_clientes;
create policy "Permission-based read" on public.omie_clientes
  for select to authenticated
  using ((select public.can('view.fila_cella')) or (select public.can('view.clientes'))
      or (select public.can('view.painel_cs')));

-- ---------------------------------------------------------------------------
-- omie_clientes_cadastro — NENHUM COMANDO, DE PROPOSITO.
-- RLS on, 1 policy chamada "Authenticated can read omie_clientes_cadastro",
-- qual = true (20260714200000_omie_clientes_cadastro.sql:17-21). A Fila Cella ja
-- le as 10.226 linhas sem mudanca nenhuma.
-- `alter policy "Permission-based read" on public.omie_clientes_cadastro` ERRA:
--   policy "Permission-based read" for table "omie_clientes_cadastro" does not exist
-- E criar uma policy can()-based aqui seria inocuo: RLS e permissivo, o `true` ja
-- ganha de qualquer predicado. Restringir a policy existente e decisao separada e
-- quebraria a conciliacao de royalties que le esta tabela hoje.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- POS-CHECAGEM
--
-- (a) nenhuma tabela da tela pode ficar com RLS on e zero policy de SELECT.
--     omie_clientes tem de sair de 0 para 4.
--   select c.relname, c.relrowsecurity,
--          count(p.policyname) filter (where p.cmd='SELECT') sel
--   from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
--   left join pg_policies p on p.schemaname='public' and p.tablename=c.relname
--   where c.relname in ('empresas','contatos','contratos','contratos_documentos',
--                       'omie_clientes','omie_clientes_cadastro','central_tratativas',
--                       'ecd_empresa','empresa_consumo','ecd_gatilho_def','ecd_gatilho_conta',
--                       'empresa_cnpj_de_para','fila_cella_contas','fila_cella_conta_operacao',
--                       'fila_cella_ciclos','fila_cella_toques')
--   group by 1,2 order by 1;
--
-- (b) as 5 chaves novas existem e admin tem todas -> 6 linhas, todas allowed=true
--   select permission_key, role, allowed from public.role_permissions
--   where permission_key like '%fila_cella%' or permission_key='manage.de_para_cnpj'
--   order by 1,2;
--
-- (c) view.fila_cella entrou nas 7 policies -> 7 linhas
--   select tablename from pg_policies
--   where schemaname='public' and policyname='Permission-based read'
--     and qual like '%fila_cella%'
--   order by 1;
--
-- NOTA de fato (spec §4.3): view.reconciliacao e view.rede_ltv NAO estao
-- concedidas a nenhum role hoje — a linha existe, `allowed` nunca e true.
-- Aparecem no qual de contratos e nao dao acesso a ninguem; ficam no `alter` so
-- para nao revogar nada, nao porque funcionem.
-- ---------------------------------------------------------------------------
