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

-- ############################################################################
-- CORRECAO DA REVISAO ADVERSARIAL (25/08)
--
-- A versao anterior deste arquivo eram seis `alter policy ... using (<lista
-- transcrita a mao>)`. `alter policy ... using` SUBSTITUI a expressao inteira:
-- se o `qual` VIVO de qualquer uma das seis tiver um termo que a transcricao nao
-- tem, o alter REVOGA esse acesso — calado, sem erro, sem log. E a transcricao
-- nao pode ser conferida: o conector do Supabase esta fora do ar (nao aparece em
-- `claude mcp list`), nao ha `.env` com credencial do Ops no clone, nao ha psql.
-- Cinco das seis estao corroboradas em migration do repo
-- (20260722180000:20-33,64-66 e 20260824150000:11-15); `contratos_documentos`
-- NAO tem migration nenhuma — a policy dela foi criada fora do versionamento.
--
-- O bloco abaixo faz a MESMA coisa sem essa aposta: le o `qual` vivo e soma o
-- termo novo com OR. E aditivo por construcao — nao existe caminho em que ele
-- remova um termo. Mesma tecnica que a 20260826080000 ja usa (ela tambem
-- reescreve `alter policy` a partir do texto deparseado de pg_policies), entao
-- nao e uma convencao nova neste PR.
--
-- Efeito colateral util: o `raise notice` grava no log do apply o ANTES e o
-- DEPOIS de cada policy — que e exatamente a pre-checagem transcrita acima,
-- so que medida em vez de suposta.
--
-- Quem preferir a forma explicita: os seis comandos originais estao no §APENDICE
-- no fim deste arquivo, comentados.
-- ############################################################################
do $fila_leitura$
declare
  t          text;
  n_pol      int;
  atual      text;
  n_somadas  int := 0;
  n_criadas  int := 0;
begin
  foreach t in array array['empresas','contratos','contatos','contratos_documentos',
                           'cs_onboarding_cards','central_tratativas'] loop

    select count(*), max(qual)
      into n_pol, atual
      from pg_policies
     where schemaname = 'public' and tablename = t and policyname = 'Permission-based read';

    if n_pol = 0 then
      -- A policy nao existe. CRIAR e estritamente aditivo: RLS e permissivo, uma
      -- policy nova so pode ampliar. E o caso previsto para contratos_documentos.
      execute format(
        'create policy "Permission-based read" on public.%I for select to authenticated '
        'using ((select public.can(''view.fila_cella'')))', t);
      n_criadas := n_criadas + 1;
      raise notice '[fila_cella] %: policy NAO existia -> criada so com view.fila_cella. CONFIRA se essa tabela deveria ter outras chaves.', t;
      continue;
    end if;

    if atual is null then
      raise exception
        'Abortado: a policy "Permission-based read" de public.% existe mas nao tem USING (provavelmente e policy de INSERT com esse nome). Resolver a mao antes de rodar.', t;
    end if;

    if position('view.fila_cella' in atual) > 0 then
      raise notice '[fila_cella] %: ja continha view.fila_cella. Nada a fazer.', t;
      continue;
    end if;

    execute format(
      'alter policy "Permission-based read" on public.%I using (%s or (select public.can(''view.fila_cella'')))',
      t, atual);
    n_somadas := n_somadas + 1;
    raise notice '[fila_cella] %: ANTES=[%]', t, atual;
    raise notice '[fila_cella] %: DEPOIS=[% or (select public.can(''view.fila_cella''))]', t, atual;
  end loop;

  raise notice '[fila_cella] % policies somadas, % criadas. Esperado: 6 somadas, 0 criadas (ou 5 e 1, se contratos_documentos nao existir).',
               n_somadas, n_criadas;
end
$fila_leitura$;

-- CONFERENCIA IMEDIATA: nenhuma das seis pode ter ficado sem o termo novo.
do $conf$
declare faltando text[];
begin
  select array_agg(t)
    into faltando
  from unnest(array['empresas','contratos','contatos','contratos_documentos',
                    'cs_onboarding_cards','central_tratativas']) t
  where not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename=t and policyname='Permission-based read'
      and qual like '%view.fila_cella%'
  );
  if faltando is not null then
    raise exception 'Abortado: view.fila_cella nao entrou em %.', faltando;
  end if;
  raise notice '[fila_cella] as 6 policies leem view.fila_cella.';
end
$conf$;

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

-- ---------------------------------------------------------------------------
-- §APENDICE — a forma explicita, como estava antes da revisao adversarial.
-- Deixada aqui porque ela documenta o `qual` LIDO em pg_policies no Ops em
-- 25/08 (spec §4.3). NAO rode estes comandos junto com o bloco de cima: cada um
-- SUBSTITUI a expressao inteira, e e exatamente essa substituicao que o bloco
-- dinamico existe para evitar.
--
-- alter policy "Permission-based read" on public.empresas
--   using ((select public.can('view.clientes')) or (select public.can('view.painel_cs'))
--       or (select public.can('view.base_contatos')) or (select public.can('view.fila_cella')));
--
-- alter policy "Permission-based read" on public.contratos
--   using ((select public.can('view.clientes'))      or (select public.can('view.painel_cs'))
--       or (select public.can('view.reconciliacao')) or (select public.can('view.rede_ltv'))
--       or (select public.can('view.fila_cella')));
--
-- alter policy "Permission-based read" on public.contatos
--   using ((select public.can('view.contatos')) or (select public.can('view.base_contatos'))
--       or (select public.can('view.fila_cella')));
--
-- alter policy "Permission-based read" on public.contratos_documentos
--   using ((select public.can('view.painel_cs')) or (select public.can('view.fila_cella')));
--
-- alter policy "Permission-based read" on public.cs_onboarding_cards
--   using ((select public.can('view.painel_cs')) or (select public.can('view.fila_cella')));
--
-- alter policy "Permission-based read" on public.central_tratativas
--   using ((select public.can('view.clientes')) or (select public.can('view.painel_cs'))
--       or (select public.can('view.fila_cella')));
-- ---------------------------------------------------------------------------
