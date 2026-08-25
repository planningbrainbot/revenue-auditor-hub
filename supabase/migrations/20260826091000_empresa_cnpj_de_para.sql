-- ============================================================================
-- 20260826091000_empresa_cnpj_de_para.sql
--
-- Migration 2 de 5 da spec-tela-fila-cella.md v0.3 (§4.2). Depende da #1 (as
-- chaves em role_permissions). Comutavel com a #4.
--
-- Reconciliacao Growth.deals -> Ops -> CNPJ -> ECD.
-- Refazer fuzzy a cada build e garantia de divergencia: o mesmo nome casa
-- diferente quando a base do Omie muda. Esta tabela e a memoria — o que foi
-- decidido, por qual caminho, e por quem.
--
-- NAO escreve em empresas.cnpj de proposito (DECISIONS.md:65: risco de colidir
-- com empresas_cnpj_unique). E camada aditiva.
--
-- Numeros que justificam a tabela (medidos em 25/08, spec §5.2):
--   identidade Growth->Ops 57/57 (empresas.pipedrive_id = deal_id da 55; contratos
--   .pipedrive_deal_id da 56; a uniao fecha 57). CNPJ resolvido 43/57, mas o
--   numero honesto de aceite AUTOMATICO e 39/57 — 4 contas tem como unica fonte
--   um trigram do Omie abaixo de 0,60 sem corroboracao (spec §5.5).
-- ============================================================================

create table if not exists public.empresa_cnpj_de_para (
  id                bigint generated always as identity primary key,
  pipedrive_deal_id text        not null,   -- = empresas.pipedrive_id (55/57) e
                                            --   contratos.pipedrive_deal_id (56/57)
  empresa_id        integer     references public.empresas(id) on delete set null,
  org_id_pipedrive  text,                   -- casa com cs_onboarding_cards.org_id_pipedrive
  cnpj              char(14)    not null,   -- so digitos, com zeros a esquerda
  papel             text        not null default 'principal'
                    check (papel in ('principal','filial','coligada')),
  razao_social      text,
  fonte             text        not null,   -- 'ops.contratos.cnpj' | 'cs_onboarding(grupo)' | ...
  confianca         text        not null default 'media'
                    check (confianca in ('alta','media','baixa')),
  similaridade      numeric(4,3),           -- preenchido so quando a fonte e fuzzy
  dv_valido         boolean     not null,   -- digito verificador — DECISIONS.md:67
  revisado_por      uuid,                   -- auth.uid(); padrao de repasses_unidade
  revisado_em       timestamptz,
  observacao        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint empresa_cnpj_de_para_uk unique (pipedrive_deal_id, cnpj),
  -- o corte do §5.5 vira constraint em vez de comentario: abaixo de 0,45 so entra
  -- com revisao humana registrada.
  constraint empresa_cnpj_de_para_piso_fuzzy
    check (similaridade is null or similaridade >= 0.450 or revisado_por is not null),
  -- e a faixa 0,45-0,60 exige corroboracao humana ou confianca rebaixada.
  constraint empresa_cnpj_de_para_faixa_media
    check (similaridade is null or similaridade >= 0.600
           or revisado_por is not null or confianca = 'baixa')
);

create unique index if not exists empresa_cnpj_de_para_principal_unico
  on public.empresa_cnpj_de_para (pipedrive_deal_id) where papel = 'principal';
create index if not exists empresa_cnpj_de_para_cnpj on public.empresa_cnpj_de_para (cnpj);
create index if not exists empresa_cnpj_de_para_raiz on public.empresa_cnpj_de_para (left(cnpj,8));

comment on table public.empresa_cnpj_de_para is
  'Memoria da reconciliacao Growth.deals -> Ops -> CNPJ -> ECD. Uma linha por CNPJ (a ECD e declarada por entidade juridica; o gatilho pode estar na filial). Camada aditiva: nao escreve em empresas.cnpj.';
comment on column public.empresa_cnpj_de_para.dv_valido is
  'Digito verificador do CNPJ. NOT NULL porque a falha ja e recorrente: SantaMaria tem 27412261100075 (DV invalido) em empresas.cnpj E contratos.cnpj — transposicao de digitos prevista em DECISIONS.md:67.';
comment on column public.empresa_cnpj_de_para.similaridade is
  'Preenchido so quando a fonte e fuzzy. Precisao medida por faixa (spec §5.5): >=0,60 21 acertos / 0 erros · 0,45-0,60 4 acertos / 2 erros · <0,45 1 acerto / 4 erros.';
comment on column public.empresa_cnpj_de_para.revisado_por is
  'auth.uid() de quem confirmou. REGRA QUE NAO CABE EM DDL: linha com revisado_por preenchido nunca e sobrescrita por rotina — so completada. Mesmo principio do COALESCE(keeper, loser) de DECISIONS.md:51.';

-- ============================================================================
-- RLS, GRANTS e POLICIES — leitura + escrita.
-- ESCRITA desde a primeira migration, nao depois: tabela que nasce so com SELECT
-- faz todo upsert de server fn falhar calado, porque o cron grava com service_role
-- e "sempre funcionou" — armadilha documentada em
-- 20260807160500_forcar_atualizacao_admin_write_policies.sql:1-16.
-- ============================================================================
alter table public.empresa_cnpj_de_para enable row level security;
revoke all    on public.empresa_cnpj_de_para from authenticated;
grant  select, insert, update on public.empresa_cnpj_de_para to authenticated;
grant  all    on public.empresa_cnpj_de_para to service_role;

drop policy if exists "Permission-based read" on public.empresa_cnpj_de_para;
create policy "Permission-based read" on public.empresa_cnpj_de_para
  for select to authenticated using ((select public.can('view.fila_cella')));

drop policy if exists "de_para_insert" on public.empresa_cnpj_de_para;
create policy "de_para_insert" on public.empresa_cnpj_de_para
  for insert to authenticated with check ((select public.can('manage.de_para_cnpj')));

drop policy if exists "de_para_update" on public.empresa_cnpj_de_para;
create policy "de_para_update" on public.empresa_cnpj_de_para
  for update to authenticated
  using      ((select public.can('manage.de_para_cnpj')))
  with check ((select public.can('manage.de_para_cnpj')));
-- sem policy de DELETE, de proposito: linha revisada nao some.
