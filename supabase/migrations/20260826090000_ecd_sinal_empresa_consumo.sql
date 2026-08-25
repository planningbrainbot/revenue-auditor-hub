-- ============================================================================
-- 20260826090000_ecd_sinal_empresa_consumo.sql
--
-- Migration 1 de 5 da spec-tela-fila-cella.md v0.3 (§4.2). ORDEM OBRIGATORIA:
-- esta e o gargalo. Sem `ecd_gatilho_def` as FKs da #3 nao resolvem, e sem o
-- seed de `role_permissions` toda policy criada nas outras nasce inacessivel
-- ate para admin (DECISIONS.md:24).
--
-- ECD do Bodra, materializada. Federar em request de tela custa ~370 ms de RTT e
-- exigiria por uma credencial membro de rds_superuser sobre 44 GB de escrituracao
-- de 404 contribuintes reais dentro de um repo de produto (spec §12, R1). A base e
-- estatica desde jun/2026 (_lotes.criado_em 04-05/06/2026; ecd_0000 tem um unico
-- exercicio, 2024), entao materializar nao perde nada.
--
-- Volumes esperados na carga (medidos em 25/08 contra o Postgres do Bodra):
--   ecd_empresa 404 · empresa_consumo 1.236 · ecd_gatilho_def 12 · ecd_gatilho_conta 14.321
--
-- Escrita: EXCLUSIVAMENTE pelo job de carga (spec §4.7), com service_role.
-- Leitura: view.fila_cella / view.clientes.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ecd_empresa — 1 linha por (cnpj, ano). Existe inclusive para as 154 sem
-- categoria e as 71 sem nome de conta: e a unica tabela que consegue afirmar
-- "tem ECD e nao tem sinal" (o R4 em forma de tabela).
--
-- ORIGEM, coluna a coluna (spec §4.2):
--   cnpj, razao_social_ecd, uf, ano  <- ecd_0000 (434 arquivos / 404 CNPJs)
--   qtd_arquivos                     <- count(*) em ecd_0000 por CNPJ (18 CNPJs
--                                       multi-arquivo, periodos disjuntos: SOMA)
--   contas_plano                     <- count(*) em ecd_i050
--   contas_com_nome                  <- count(*) em ecd_c050
--   cobertura_nomes                  <- DERIVADA (coluna gerada)
--   receita_operacional              -> calculada pelo job: ecd_c051."COD_CTA_REF"
--                                       like '3.01.01.01%' (plano referencial RFB),
--                                       fallback INCL/EXCL sobre nome de conta em
--                                       credito de ecd_i355. Cobre 202 de 404.
--   curva_ecd                        -> DERIVADA no job: >=80MM 'A', >=30MM 'B',
--                                       >0 'C'. NULL quando receita e NULL ou zero
--                                       — NUNCA ''. Medido: A 39 · B 30 · C 133 · NULL 202.
--   cnae / segmento                  -> CORTADOS: nao existem na origem (spec §4.6 item 1).
--
-- `empresa_id` e NULLABLE de proposito: FK obrigatoria para `empresas`
-- descartaria 377 das 404 (empresas.cnpj exato = 27 de 404). A identidade e o CNPJ.
-- Tipo `integer` casa com o precedente do repo em
-- 20260616134736_bb0ebb70-8fe4-440f-91c7-b2f4b42d6694.sql:69.
-- ----------------------------------------------------------------------------
create table if not exists public.ecd_empresa (
  id                  bigint generated always as identity primary key,
  cnpj                char(14)  not null,
  ano                 smallint  not null,
  razao_social_ecd    text      not null,
  uf                  char(2),
  qtd_arquivos        smallint  not null default 1,
  contas_plano        integer   not null,
  contas_com_nome     integer   not null,
  cobertura_nomes     text generated always as (
                        case when contas_com_nome = 0                  then 'ausente'
                             when contas_com_nome < contas_plano * 0.5 then 'parcial'
                             else                                           'completa'
                        end) stored,
  receita_operacional numeric(18,2),
  receita_origem      text check (receita_origem in
                        ('plano referencial RFB 3.01.01.01','nome da conta')),
  curva_ecd           char(1) check (curva_ecd in ('A','B','C')),
  empresa_id          integer references public.empresas(id) on delete set null,
  origem              text        not null,   -- 'ecd_0000@2026-06-05'
  carregado_em        timestamptz not null default now(),
  constraint ecd_empresa_cnpj_ano_uk unique (cnpj, ano),
  -- CORRECAO CONTRA A SPEC v0.3 (justificada por teste, ver cabecalho da secao):
  -- a spec escreve `check (curva_ecd is null or receita_operacional > 0)`. Com
  -- receita NULL, `NULL > 0` e NULL, e `false or NULL` = NULL — e um CHECK que
  -- devolve NULL PASSA. Ou seja, curva_ecd='A' com receita NULL entrava. Provado
  -- em PG 18.3 local. O coalesce faz a constraint dizer o que ela afirma dizer.
  constraint ecd_empresa_curva_exige_receita
    check (curva_ecd is null or coalesce(receita_operacional, 0) > 0),
  constraint ecd_empresa_receita_exige_origem
    check ((receita_operacional is null) = (receita_origem is null))
);

create index if not exists ecd_empresa_empresa_id
  on public.ecd_empresa (empresa_id) where empresa_id is not null;
create index if not exists ecd_empresa_raiz
  on public.ecd_empresa (left(cnpj,8));   -- grupo economico, spec §5.4

comment on table public.ecd_empresa is
  'ECD do Bodra materializada, 1 linha por (cnpj, ano). Carga por script fora do repo (spec-tela-fila-cella.md §4.7). Leitura pela Fila Cella.';
comment on column public.ecd_empresa.cobertura_nomes is
  'Coluna gerada: ausente (contas_com_nome=0, 71 de 404) | parcial (<50%, mais 28) | completa. Gatilho e classificador sao ambos baseados em upper(CTA), entao cobertura ausente = sinal zero por construcao, nao por falta de fato economico.';
comment on column public.ecd_empresa.curva_ecd is
  'A >=80MM, B >=30MM, C >0. NULL quando a receita e NULL ou zero — nunca string vazia. casa_ecd.py:16-21 devolve string vazia; o job traduz para NULL.';

-- ----------------------------------------------------------------------------
-- empresa_consumo — FUSAO de crm-fabrica/0001_init_schema.sql:113-122
-- (conta_consumo) com o `ecd_sinal_empresa` da v0.2 desta spec. Eram a mesma
-- tabela com dois nomes: mesmo grao, mesmas 6 categorias, mesma fonte, mesmo
-- banco. O nome que vence e `empresa_consumo` (spec-unificacao-repos.md:133).
--
-- CONSEQUENCIA para a spec-unificacao-repos.md:
--   - 20260825HH0000_crm_fabrica_produto_e_consumo.sql NAO cria mais esta tabela;
--   - `bodra_consumo_stg` sai de escopo (o job le o Postgres do Bodra direto).
--
-- ORIGEM: analysis_account_classified (532.786 linhas), agregada por
-- (cnpj, categoria, metrica) com `categoria <> 'nao_classificado' and valor >= 1`.
-- O job NAO le analysis_company_category: aquele agregado e derivado (reconstruido
-- 1081/1081 em valor_total E em qtd_contas) e PERDE a metrica pelo caminho.
--
-- POR QUE `metrica` ENTRA NA CHAVE: 155 das 240 linhas de operacoes_financeiras
-- somam saldo E fluxo no mesmo valor_total, e o fluxo domina (R$ 46,4 bi contra
-- R$ 3,2 bi). Somar os dois e somar laranja com maca (spec-telas-crm-nucleo.md:304).
-- Desdobrar: 1.081 linhas viram 1.236, sobre os mesmos 250 CNPJs.
-- ----------------------------------------------------------------------------
create table if not exists public.empresa_consumo (
  id            bigint generated always as identity primary key,
  cnpj          char(14)  not null,
  ano           smallint  not null,
  categoria     text      not null check (categoria in
                  ('energia','seguros','divida_tributaria',
                   'operacoes_financeiras','imobilizado','folha_pagamento')),
  metrica       text      not null check (metrica in ('saldo','fluxo')),
  valor_total   numeric(18,2) not null,
  qtd_contas    integer   not null check (qtd_contas > 0),
  origem        text        not null,  -- 'analysis_account_classified@2026-06-05'
  carregado_em  timestamptz not null default now(),
  constraint empresa_consumo_uk unique (cnpj, ano, categoria, metrica),
  constraint empresa_consumo_ecd_fk foreign key (cnpj, ano)
    references public.ecd_empresa (cnpj, ano) on delete cascade
);

create index if not exists empresa_consumo_categoria
  on public.empresa_consumo (categoria, valor_total desc);

comment on table public.empresa_consumo is
  'Sinal de consumo por (cnpj, ano, categoria, metrica). Fusao de conta_consumo (crm-fabrica) com ecd_sinal_empresa. Alimenta a Fila Cella e o cross-sell do crm-fabrica.';
comment on column public.empresa_consumo.metrica is
  'saldo = fechamento (R$ num ponto) · fluxo = soma de debitos do ano (R$/ano). Entra na chave porque a origem mistura os dois em 155 de 240 linhas de operacoes_financeiras.';

-- ----------------------------------------------------------------------------
-- ecd_gatilho_def — os gatilhos do playbook. NAO existem em analysis_*: vivem
-- so em lista-matheus/tools/{extrai_ecd,gatilhos404,casa_ecd,icp404}.py.
--
-- O dominio real e de 12 rotulos com numeracao DESCONTINUA: nao existe T3 nem T4
-- (grep no diretorio inteiro: zero ocorrencias). Dos 12, 11 rodam em lote — T10b
-- so existe na versao por empresa (extrai_ecd.py:66-68).
--
-- A coluna `frente` e o mapa gatilho->frente da aba Dicionario do xlsx, que a
-- spec §4.4 regra 3 registrava como "nao esta escrito em lugar nenhum". Aqui
-- esta, versionado e checavel. Confere com casa_ecd.py:85-89.
-- `dispara_forte` e a regra de forca de casa_ecd.py:88-91 (T8 ou T10 => Forte)
-- — provisoria ate a D1 fechar (spec §11).
-- ----------------------------------------------------------------------------
create table if not exists public.ecd_gatilho_def (
  gatilho       text primary key,
  nome          text not null,
  frente        text check (frente in ('Tese','Contencioso','Transação')),
  dispara_forte boolean not null default false,
  exige_tributo boolean not null default false,
  ordem         smallint not null,
  observacao    text
);

insert into public.ecd_gatilho_def
  (gatilho, nome, frente, dispara_forte, exige_tributo, ordem, observacao) values
 ('T1','Folha e encargos','Tese',false,false,1,null),
 ('T2','ICMS-ST','Tese',false,false,2,
   'Ver D6 (spec §11): icp404.py:9-10 declara a tese encerrada e perdida (Tema 1231/STJ)'),
 ('T5','Reserva de incentivo fiscal','Tese',false,false,3,null),
 ('T6','Importação','Tese',false,false,4,null),
 ('T7','Energia elétrica','Tese',false,false,5,null),
 ('T8','Parcelamento tributário','Transação',true,false,6,
   'Presença sozinha classifica a conta como Forte (casa_ecd.py:88)'),
 ('T9','Tributos a recolher','Transação',false,true,7,null),
 ('T10','Contingência tributária','Contencioso',true,true,8,
   'Nega DIFERID: provisão de IR diferido é diferimento contábil, não litígio — chamar isso de contingência na frente do cliente destrói a credibilidade (extrai_ecd.py:64-65)'),
 ('T10b','Contingência trabalhista/cível',null,false,false,9,
   'Existe só na extração por empresa (extrai_ecd.py:66-68). NÃO roda no lote das 404'),
 ('T11','Prejuízo acumulado','Transação',false,false,10,null),
 ('T11b','Endividamento financeiro',null,false,false,11,'Sem frente no playbook'),
 ('T12','Crédito tributário no ativo',null,false,true,12,
   'Aba Dicionário: "alerta, não é frente". Vira chip de bloqueio na coluna 3')
on conflict (gatilho) do nothing;

comment on table public.ecd_gatilho_def is
  'Dicionario dos 12 rotulos de gatilho (sem T3 e sem T4). Mapa gatilho->frente da aba Dicionario do xlsx, versionado. 12 linhas, zero dado de cliente.';

-- ----------------------------------------------------------------------------
-- ecd_gatilho_conta — a evidencia literal: uma linha por conta contabil que
-- casou com um gatilho. E o que o Matheus fala ao telefone.
--
-- Volume medido em 25/08 sobre a base inteira, uma query: 14.321 linhas
-- (11.486 com |valor| >= 1), 235 CNPJs distintos, 255 arquivos, 6,1 s.
-- Nao precisa de Edge Function, de streaming nem de fila.
--
-- ORIGEM (base404.sql): plano de contas de ecd_i050 (mais completo que o c050),
-- nome via LEFT JOIN em ecd_c050; saldo patrimonial de ecd_i155 no ultimo
-- ecd_i150, em CONVENCAO DEVEDORA (debito positivo, credito negativo — conta
-- redutora subtrai em vez de somar); fluxo de resultado de ecd_i355.
-- ----------------------------------------------------------------------------
create table if not exists public.ecd_gatilho_conta (
  id           bigint generated always as identity primary key,
  cnpj         char(14) not null,
  ano          smallint not null,
  gatilho      text     not null references public.ecd_gatilho_def(gatilho),
  cod_cta      text,
  nome_conta   text     not null,  -- a evidencia nominal, literal
  natureza     text,               -- COD_NAT: 01 ativo 02 passivo 03 PL 04 resultado
  tipo         text     not null check (tipo in ('saldo','fluxo')),
  valor        numeric(18,2) not null,  -- convencao devedora; redutora entra negativa
  origem       text        not null,
  carregado_em timestamptz not null default now(),
  constraint ecd_gatilho_conta_ecd_fk foreign key (cnpj, ano)
    references public.ecd_empresa (cnpj, ano) on delete cascade
);

-- o indice existe porque a tela pede sempre (cnpj, ano) e corta ruido de centavos
create index if not exists ecd_gatilho_conta_cnpj_ano
  on public.ecd_gatilho_conta (cnpj, ano) where abs(valor) >= 1;

comment on table public.ecd_gatilho_conta is
  'Evidencia nominal literal por conta contabil que casou com um gatilho T*. 14.321 linhas para as 404 empresas. Convencao devedora: conta redutora entra negativa.';

-- ============================================================================
-- RLS, GRANTS e POLICIES — tabelas de ECD: leitura pura.
--
-- Nota de seguranca medida (spec §4.3): no Ops, `authenticated` ja tem
-- DELETE/INSERT/SELECT/UPDATE/TRUNCATE/REFERENCES/TRIGGER por default privileges
-- em toda tabela de `public`. O que filtra e exclusivamente RLS. O bloco abaixo e
-- mais apertado que o default do repo DE PROPOSITO: revoga e reconcede so o verbo
-- que cada tabela precisa.
--
-- O wrap `(select public.can(...))` NAO e cosmetico:
-- 20260814170000_rls_perf_contas_receber.sql mediu 1,2 s -> 65 ms (18x) por causa
-- dele — faz o planner avaliar can() uma vez por query em vez de uma vez por linha.
-- ============================================================================
do $$
declare t text;
begin
  foreach t in array array['ecd_empresa','empresa_consumo',
                           'ecd_gatilho_def','ecd_gatilho_conta'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

drop policy if exists "Permission-based read" on public.ecd_empresa;
create policy "Permission-based read" on public.ecd_empresa
  for select to authenticated
  using ((select public.can('view.fila_cella')) or (select public.can('view.clientes')));
drop policy if exists "role_based_read" on public.ecd_empresa;
create policy "role_based_read" on public.ecd_empresa
  for select to authenticated
  using ((select public.has_role(auth.uid(),'admin'::app_role))
      or (select public.has_role(auth.uid(),'diretor'::app_role)));

drop policy if exists "Permission-based read" on public.empresa_consumo;
create policy "Permission-based read" on public.empresa_consumo
  for select to authenticated
  using ((select public.can('view.fila_cella')) or (select public.can('view.clientes')));
drop policy if exists "role_based_read" on public.empresa_consumo;
create policy "role_based_read" on public.empresa_consumo
  for select to authenticated
  using ((select public.has_role(auth.uid(),'admin'::app_role))
      or (select public.has_role(auth.uid(),'diretor'::app_role)));

-- 12 linhas de dicionario, sem dado de cliente
drop policy if exists "Permission-based read" on public.ecd_gatilho_def;
create policy "Permission-based read" on public.ecd_gatilho_def
  for select to authenticated using (true);

drop policy if exists "Permission-based read" on public.ecd_gatilho_conta;
create policy "Permission-based read" on public.ecd_gatilho_conta
  for select to authenticated
  using ((select public.can('view.fila_cella')) or (select public.can('view.clientes')));
drop policy if exists "role_based_read" on public.ecd_gatilho_conta;
create policy "role_based_read" on public.ecd_gatilho_conta
  for select to authenticated
  using ((select public.has_role(auth.uid(),'admin'::app_role))
      or (select public.has_role(auth.uid(),'diretor'::app_role)));

-- ============================================================================
-- AS CINCO CHAVES NOVAS.
--
-- Sem o seed de admin=true, can() devolve false INCLUSIVE para admin e a feature
-- nasce inacessivel — bug que ja aconteceu (DECISIONS.md:24). Regra geral do repo
-- em DECISIONS.md:88: toda nova view.* e concedida a admin no mesmo passo.
--
-- Verificado em 25/08: role_permissions tem PK (role, permission_key) e FK
-- role -> roles(key) (20260703190000_dynamic_roles.sql:52-54); 144 linhas, 40
-- permission_key distintas, 8 roles validos. NENHUMA das cinco existe hoje.
--
-- As cinco tambem precisam entrar em KNOWN_PERMISSIONS
-- (src/lib/permissions.functions.ts) — senao nao aparecem em /admin/permissoes.
-- O catalogo NAO concede nada; quem concede e este seed.
-- ============================================================================
insert into public.role_permissions (role, permission_key, allowed) values
  ('admin',   'view.fila_cella',            true),
  ('admin',   'manage.fila_cella',          true),
  ('admin',   'manage.fila_cella_sync',     true),
  ('admin',   'manage.fila_cella_override', true),
  ('admin',   'manage.de_para_cnpj',        true),
  ('diretor', 'view.fila_cella',            true)
on conflict (role, permission_key) do update set allowed = excluded.allowed;
