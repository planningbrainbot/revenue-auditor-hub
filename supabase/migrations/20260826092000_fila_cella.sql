-- ============================================================================
-- 20260826092000_fila_cella.sql
--
-- Migration 3 de 5 da spec-tela-fila-cella.md v0.3 (§4.2). DEPENDE DA #1:
-- `ecd_gatilho_def` e alvo de FK em fila_cella_contas.gatilho_principal e em
-- fila_cella_toques.gatilho_ref.
--
-- Quatro tabelas. A fronteira entre a primeira e a segunda e o ponto inteiro da
-- tela: `fila_cella_contas` e reconstruida inteira pelo job de sync;
-- `fila_cella_conta_operacao` NUNCA e reconstruida — e o que a planilha destroi
-- a cada rebuild.
--
-- Tres coisas que o DDL faz e o Excel nao conseguia:
--   1. check (toque_num between 1 and 4) + unique (ciclo_id, toque_num) = a trava
--      real. No xlsx a mensagem de erro esta gravada e NUNCA e exibida:
--      xl/worksheets/sheet4.xml traz showErrorMessage="0" no dataValidation de
--      D2:D500 (default do openpyxl que build_planilha.py:205-206 nunca sobrescreve).
--      O Excel aceita um 5 calado.
--   2. foreign key (ciclo_id, frente) = uma frente por ciclo (playbook §4.6).
--      Nao e validacao de tela; e impossivel gravar diferente.
--   3. indice parcial de ciclo aberto = a regra dos dois relogios tem onde morder.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- CAMADA APURADA — reconstruida inteira pelo job de sync. Nunca editada a mao.
--
-- `pipedrive_deal_id` e nullable + unique parcial (era `not null unique` na v0.2,
-- o que torna procedencia='ecd_icp_404' impossivel de gravar: linha vinda da ECD
-- nao tem deal). O CHECK de identidade exige uma das duas.
--
-- Tres colunas da v0.2 NAO estao aqui: `tem_ecd`, `receita_operacional` e
-- `curva_ecd`. Elas sao escritas por um job DIFERENTE, com cadencia DIFERENTE —
-- o de ECD roda quando o Bodra entrega exercicio novo, o de fila roda diario
-- sobre o Growth. Duas rotinas gravando a mesma coluna e a definicao de drift.
-- Saem por join com ecd_empresa na v_fila_cella (#5), e a tela ganha de graca os
-- cinco estados que o boolean nao conseguia representar (spec §6.7).
-- ----------------------------------------------------------------------------
create table if not exists public.fila_cella_contas (
  id                    bigint generated always as identity primary key,
  pipedrive_deal_id     text,
  org_id_pipedrive      text,
  person_id_pipedrive   text,
  procedencia           text not null default 'growth_deals_won'
                        check (procedencia in ('growth_deals_won','ecd_icp_404')),
  lista                 text not null default 'fila'
                        check (lista in ('fila','novos_do_mes')),
  titulo                text not null,   -- deals.title: titulo de NEGOCIO, nao razao social
  razao_social          text,
  cnpj_principal        char(14),        -- denormalizado de empresa_cnpj_de_para (principal)
  segmento              text,
  segmento_prioritario  boolean not null default false,
  faixa_declarada       text,            -- AUTO-DECLARADA em formulario (Growth.deals)
  curva_declarada       char(1) check (curva_declarada in ('A','B','C')),
  regime_tributario     text,            -- contratos.regime_tributario (54/57)
  opcao_simples_receita text,            -- CSV 967. 'Outros'/NULL = SEM INFORMACAO
  elegivel              text not null default 'A confirmar'
                        check (elegivel in ('Sim','Não','A confirmar')),
  uf                    text,
  unidade               text,
  dono_conta            text,
  mrr                   numeric(14,2),
  cliente_desde         date,
  forca_calculada       text check (forca_calculada in ('Forte','Moderado','Fraco')),
  forca_regra           text,            -- versao da regra que produziu o valor. Ver D1.
  frente_sugerida       text check (frente_sugerida in ('Tese','Contencioso','Transação')),
  gatilho_principal     text references public.ecd_gatilho_def(gatilho),
  avisos                text[] not null default '{}',  -- as 9 regras de flags()
  sincronizado_em       timestamptz not null default now(),
  constraint fila_cella_contas_identidade
    check (pipedrive_deal_id is not null or cnpj_principal is not null),
  constraint fila_cella_contas_ecd_exige_cnpj
    check (procedencia <> 'ecd_icp_404' or cnpj_principal is not null),
  -- spec §4.4 regra 4: 'Outros' e NULL em opcao_simples_receita NUNCA produzem
  -- elegivel='Sim'. Literal da aba Dicionario: "'Outros' na maioria das linhas
  -- significa sem informacao, nao 'nao optante'".
  constraint fila_cella_contas_simples_sem_info
    check (elegivel <> 'Sim'
           or (opcao_simples_receita is not null and opcao_simples_receita <> 'Outros'))
);

create unique index if not exists fila_cella_contas_deal_uk
  on public.fila_cella_contas (pipedrive_deal_id) where pipedrive_deal_id is not null;
create unique index if not exists fila_cella_contas_cnpj_ecd_uk
  on public.fila_cella_contas (cnpj_principal) where procedencia = 'ecd_icp_404';
create index if not exists fila_cella_contas_cnpj on public.fila_cella_contas (cnpj_principal);

comment on table public.fila_cella_contas is
  'CAMADA APURADA da Fila Cella — reconstruida inteira pelo job de sync sobre Growth.deals. Nunca editada a mao. O que o operador escreve vive em fila_cella_conta_operacao.';
comment on column public.fila_cella_contas.procedencia is
  'growth_deals_won (os 57 de hoje) | ecd_icp_404 (a base ECD, se a D2 decidir por ela). Existe para que a D2 nao exija migration de quebra.';
comment on column public.fila_cella_contas.faixa_declarada is
  'AUTO-DECLARADA em formulario do Growth. Nao e faturamento homologado — por isso curva_declarada e a curva_ecd sao colunas separadas e a v_fila_cella expoe curva_diverge.';

-- ----------------------------------------------------------------------------
-- CAMADA OPERADA — nunca reconstruida. E o que a planilha destroi a cada rebuild.
--
-- spec §4.4 regra 2: o playbook §3.4 exige registrar a RESPOSTA do responsavel,
-- 24h antes do contato, com a pergunta literal "existe algo em aberto que eu
-- precise saber antes de falar com esse cliente?". `relacionamento` com tres
-- valores nao registra resposta nenhuma — dai as tres colunas de relacionamento_*.
-- `relacionamento_em` e a data a partir da qual o botao de toque em Curva A
-- libera, 24 h depois.
-- ----------------------------------------------------------------------------
create table if not exists public.fila_cella_conta_operacao (
  conta_id                bigint primary key
                          references public.fila_cella_contas(id) on delete cascade,
  relacionamento          text not null default 'Não verificado'
                          check (relacionamento in ('Não verificado','Saudável','Alerta aberto')),
  relacionamento_resposta text,
  relacionamento_por      uuid,
  relacionamento_em       timestamptz,
  papel_decisao           text check (papel_decisao in ('Decide','Influencia','Encaminha')),
  urgencia                boolean not null default false,
  estagio                 text not null default '1 Base elegível',  -- os 10 de build_planilha.py:27-28
  forca_override          text check (forca_override in ('Forte','Moderado','Fraco')),
  forca_motivo            text,
  frente_escolhida        text check (frente_escolhida in ('Tese','Contencioso','Transação')),
  proximo_passo           text,
  proximo_passo_em        date,
  motivo_perda            text,
  conflito_interno        boolean not null default false,  -- fronteira com Auditoria Tributaria
  atualizado_por          uuid,
  atualizado_em           timestamptz not null default now(),
  constraint fila_cella_operacao_override_exige_motivo
    check (forca_override is null or nullif(btrim(forca_motivo),'') is not null),
  constraint fila_cella_operacao_relacionamento_exige_autor
    check (relacionamento = 'Não verificado' or relacionamento_em is not null)
);

comment on table public.fila_cella_conta_operacao is
  'CAMADA OPERADA — nunca reconstruida pelo job de sync. relacionamento = Alerta aberto e VETO absoluto (score NULL na view), nao penalidade: R2 da spec.';

-- ----------------------------------------------------------------------------
-- CICLOS — spec §4.4 regra 1: "Nao" explicito encerra por SEIS MESES, nao por
-- 60 dias. Playbook §4.6, literal: "'Nao' explicito encerra por 6 meses.
-- Registrar o motivo. Reabrir apenas com fato novo relevante, como fiscalizacao
-- ou mudanca de decisor." Sao dois relogios distintos, e `bloqueado_ate` carrega
-- os dois (encerrado_em + 60d, OU + 180d se recusa_explicita).
--
-- A regra em si vai em trigger (le bloqueado_ate), porque nao cabe em CHECK.
-- Reabertura antes da data exige fato_novo preenchido E manage.fila_cella_override.
-- ----------------------------------------------------------------------------
create table if not exists public.fila_cella_ciclos (
  id               bigint generated always as identity primary key,
  conta_id         bigint   not null references public.fila_cella_contas(id) on delete cascade,
  numero           smallint not null check (numero >= 1),
  frente           text     not null check (frente in ('Tese','Contencioso','Transação')),
  motivo_entrada   text     not null,   -- playbook §4.6: motivo NOVO a cada ciclo
  status           text     not null default 'aberto' check (status in ('aberto','encerrado')),
  aberto_em        date     not null default current_date,
  encerrado_em     date,
  motivo_saida     text,
  recusa_explicita boolean  not null default false,
  bloqueado_ate    date,                -- encerrado_em + 60d, OU + 180d se recusa_explicita
  fato_novo        text,                -- obrigatorio para reabrir antes de bloqueado_ate
  aberto_por       uuid,
  constraint fila_cella_ciclos_numero_uk unique (conta_id, numero),
  constraint fila_cella_ciclos_frente_uk unique (id, frente),  -- alvo da FK composta
  constraint fila_cella_ciclos_encerrado_coerente
    check ((status = 'encerrado') = (encerrado_em is not null)),
  constraint fila_cella_ciclos_encerrado_exige_motivo
    check (status = 'aberto' or nullif(btrim(motivo_saida),'') is not null),
  constraint fila_cella_ciclos_bloqueio_coerente
    check (status = 'aberto' or bloqueado_ate is not null)
);

-- um ciclo aberto por conta. Sem isto, a trava dos 4 e contornavel abrindo ciclo novo.
create unique index if not exists fila_cella_ciclo_aberto_unico
  on public.fila_cella_ciclos (conta_id) where status = 'aberto';

comment on column public.fila_cella_ciclos.bloqueado_ate is
  'encerrado_em + 60 dias, OU + 180 dias quando recusa_explicita. Os dois relogios do playbook §4.6. O trigger de reabertura le ESTA coluna, nunca encerrado_em + 60.';

-- ----------------------------------------------------------------------------
-- TOQUES — APPEND-ONLY. Sem policy de UPDATE, sem policy de DELETE e sem GRANT
-- de UPDATE/DELETE: a append-only e verdade em duas camadas, nao em uma.
-- Correcao e linha nova apontando corrige_toque_id.
--
-- `literal` e REGISTRO DE COMPLIANCE: o playbook §2.5 lista sete formulacoes
-- proibidas e §4.7 exige que esse texto va inteiro ao Cella no handoff. Nao se
-- reescreve evidencia. A 7a formulacao proibida e semantica — nenhum matcher de
-- string a pega —, dai a coluna atesto_sem_citar_cliente.
--
-- NOTA sobre `check (data <= current_date)`: current_date e STABLE, nao IMMUTABLE.
-- PostgreSQL ACEITA a expressao em CHECK (testado em PG 18.3 local) e a assume
-- imutavel; o risco documentado e de pg_dump/restore falhar. Aqui NAO ha risco:
-- `data <= current_date` so fica MAIS verdadeira com o tempo, entao toda linha
-- valida hoje continua valida em qualquer restore futuro.
-- ----------------------------------------------------------------------------
create table if not exists public.fila_cella_toques (
  id                bigint generated always as identity primary key,
  ciclo_id          bigint   not null references public.fila_cella_ciclos(id),
  toque_num         smallint not null check (toque_num between 1 and 4),
  frente            text     not null,
  data              date     not null default current_date,
  canal             text     not null check (canal in ('WhatsApp','Ligação','E-mail','Reunião')),
  gatilho_ref       text     not null references public.ecd_gatilho_def(gatilho),
  literal           text     not null,   -- "o que foi dito". REGISTRO DE COMPLIANCE.
  atesto_sem_citar_cliente boolean not null default false,
  resposta          text,
  resultado         text     not null check (resultado in
                      ('Sem resposta','Respondeu','Reunião agendada','Não explícito')),
  proximo_passo     text,
  proximo_passo_em  date,
  motivo            text,
  corrige_toque_id  bigint references public.fila_cella_toques(id),
  override_por      uuid,                -- 5o toque so com manage.fila_cella_override
  override_motivo   text,
  created_by        uuid     not null,
  created_at        timestamptz not null default now(),
  constraint fila_cella_toques_num_uk unique (ciclo_id, toque_num),
  constraint fila_cella_toques_frente_fk
    foreign key (ciclo_id, frente) references public.fila_cella_ciclos (id, frente),
  constraint fila_cella_toques_data_nao_futura check (data <= current_date),
  constraint fila_cella_toques_proximo_passo
    check (resultado = 'Não explícito'
           or (nullif(btrim(proximo_passo),'') is not null and proximo_passo_em is not null)),
  constraint fila_cella_toques_recusa_exige_motivo
    check (resultado <> 'Não explícito' or nullif(btrim(motivo),'') is not null),
  constraint fila_cella_toques_override_exige_motivo
    check ((override_por is null) = (override_motivo is null))
);

create index if not exists fila_cella_toques_ciclo
  on public.fila_cella_toques (ciclo_id, data desc);

comment on table public.fila_cella_toques is
  'APPEND-ONLY. Sem UPDATE e sem DELETE, em policy e em GRANT. Correcao e linha nova apontando corrige_toque_id. O campo literal e evidencia de compliance (playbook §2.5 e §4.7).';

-- ============================================================================
-- RLS, GRANTS e POLICIES
-- ============================================================================

-- fila_cella_contas: leitura pura para authenticated (escrita e do job de sync,
-- com service_role).
alter table public.fila_cella_contas enable row level security;
revoke all on public.fila_cella_contas from authenticated;
grant  select on public.fila_cella_contas to authenticated;
grant  all    on public.fila_cella_contas to service_role;

drop policy if exists "Permission-based read" on public.fila_cella_contas;
create policy "Permission-based read" on public.fila_cella_contas
  for select to authenticated using ((select public.can('view.fila_cella')));

-- camada operada: leitura + escrita
alter table public.fila_cella_conta_operacao enable row level security;
revoke all on public.fila_cella_conta_operacao from authenticated;
grant  select, insert, update on public.fila_cella_conta_operacao to authenticated;
grant  all on public.fila_cella_conta_operacao to service_role;

drop policy if exists "Permission-based read" on public.fila_cella_conta_operacao;
create policy "Permission-based read" on public.fila_cella_conta_operacao
  for select to authenticated using ((select public.can('view.fila_cella')));
drop policy if exists "fila_cella_operacao_insert" on public.fila_cella_conta_operacao;
create policy "fila_cella_operacao_insert" on public.fila_cella_conta_operacao
  for insert to authenticated with check ((select public.can('manage.fila_cella')));
drop policy if exists "fila_cella_operacao_update" on public.fila_cella_conta_operacao;
create policy "fila_cella_operacao_update" on public.fila_cella_conta_operacao
  for update to authenticated
  using      ((select public.can('manage.fila_cella')))
  with check ((select public.can('manage.fila_cella')));

alter table public.fila_cella_ciclos enable row level security;
revoke all on public.fila_cella_ciclos from authenticated;
grant  select, insert, update on public.fila_cella_ciclos to authenticated;
grant  all on public.fila_cella_ciclos to service_role;

drop policy if exists "Permission-based read" on public.fila_cella_ciclos;
create policy "Permission-based read" on public.fila_cella_ciclos
  for select to authenticated using ((select public.can('view.fila_cella')));
drop policy if exists "fila_cella_ciclos_insert" on public.fila_cella_ciclos;
create policy "fila_cella_ciclos_insert" on public.fila_cella_ciclos
  for insert to authenticated with check ((select public.can('manage.fila_cella')));
drop policy if exists "fila_cella_ciclos_update" on public.fila_cella_ciclos;
create policy "fila_cella_ciclos_update" on public.fila_cella_ciclos
  for update to authenticated
  using      ((select public.can('manage.fila_cella')))
  with check ((select public.can('manage.fila_cella')));

-- toques: APPEND-ONLY
alter table public.fila_cella_toques enable row level security;
revoke all on public.fila_cella_toques from authenticated;
grant  select, insert on public.fila_cella_toques to authenticated;  -- sem update, sem delete
grant  all on public.fila_cella_toques to service_role;

drop policy if exists "Permission-based read" on public.fila_cella_toques;
create policy "Permission-based read" on public.fila_cella_toques
  for select to authenticated using ((select public.can('view.fila_cella')));
drop policy if exists "fila_cella_toques_insert" on public.fila_cella_toques;
create policy "fila_cella_toques_insert" on public.fila_cella_toques
  for insert to authenticated with check ((select public.can('manage.fila_cella')));
-- SEM policy de UPDATE e SEM policy de DELETE. Evidencia nao se reescreve.
