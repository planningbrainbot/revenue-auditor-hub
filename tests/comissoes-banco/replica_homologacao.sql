-- Réplica mínima do schema `ops` do banco único, SÓ PARA HOMOLOGAÇÃO.
--
-- Nunca rodar em produção: em produção esses objetos já existem e este
-- arquivo sobrescreveria `ops.can_user`. O workflow `homologacao-banco` aplica
-- este arquivo antes das migrations, e só no projeto bgkfbegutlajchwwovgm.
--
-- Mesmos nomes e tipos de produção, para as funções do broker serem idênticas
-- nos dois ambientes. A permissão é simplificada: `ops.replica_chaves` diz
-- quem tem qual chave, no lugar de papel e área.
-- Idempotente: pode rodar a cada deploy.

do $$ begin
  if current_database() <> 'postgres' or exists (select 1 from pg_namespace where nspname = 'financeiro') then
    raise exception 'ops_replica.sql parece estar rodando fora da homologação; abortado';
  end if;
end $$;

create schema if not exists ops;

create table if not exists ops.unidades (
  id integer primary key,
  nome_da_praca text not null,
  cnpj text,
  pipedrive_opcao_id integer,
  data_inauguracao date
);

create table if not exists ops.usuario_unidades (
  user_id uuid not null,
  unidade_id integer not null references ops.unidades (id),
  primary key (user_id, unidade_id)
);

create table if not exists ops.replica_chaves (
  user_id uuid not null,
  permission_key text not null,
  primary key (user_id, permission_key)
);

create or replace function ops.can_user(_user_id uuid, _key text)
returns boolean language sql stable security definer set search_path to 'ops'
as $$ select exists (select 1 from ops.replica_chaves where user_id = _user_id and permission_key = _key) $$;

revoke all on schema ops from public, anon, authenticated;
revoke all on all tables in schema ops from public, anon, authenticated;
revoke execute on all functions in schema ops from public, anon, authenticated;

alter table ops.unidades add column if not exists tipo text not null default 'regional';
-- Planning People (PRD Planning People v1, D-04): empresas da unidade, uma por linha em
-- `cnpj` e `razao_social`, e o escopo de quem vê a rede inteira.
alter table ops.unidades add column if not exists razao_social text;

create table if not exists ops.usuario_escopo (
  user_id uuid primary key,
  todas_unidades boolean not null default false,
  todas_empresas boolean not null default false,
  updated_at timestamptz not null default now()
);
revoke all on ops.usuario_escopo from public, anon, authenticated;

-- Unidades fictícias. A Oeste ainda não inaugurou (Implantação, R-01 da consultoria).
insert into ops.unidades (id, nome_da_praca, cnpj, data_inauguracao) values
  (1, 'Unidade Teste Norte', '00000000000101', '2025-01-01'),
  (2, 'Unidade Teste Sul', '00000000000202', '2025-06-01'),
  (3, 'Unidade Teste Leste', '00000000000303', '2026-01-01'),
  (4, 'Unidade Teste Oeste', '00000000000404', null),
  (5, 'Unidade Teste Centro', '00000000000505', '2024-03-01'),
  (6, 'Unidade Teste Litoral', '00000000000606', '2024-09-01'),
  (7, 'Unidade Teste Serra', '00000000000707', '2025-02-01'),
  (8, 'Unidade Teste Vale', '00000000000808', '2025-05-01'),
  (9, 'Unidade Teste Planalto', '00000000000909', '2026-04-01'),
  (10, 'Unidade Teste Interior', '00000000001010', '2024-11-01'),
  (11, 'Unidade Teste Capital', '00000000001111', '2026-05-01')
on conflict (id) do nothing;

-- A Unidade Teste Norte tem duas empresas fictícias, como as unidades reais com filial.
update ops.unidades set cnpj = E'00000000000101\n00000000000110',
       razao_social = E'Norte Teste Contabilidade Ltda\nNorte Teste Servicos Ltda'
 where id = 1 and coalesce(cnpj, '') not like E'%\n%';

-- Portas de leitura da consultoria (em produção: migration 20261008121000 do repo do Ops).
-- Mesmo formato de saída; aqui leem tabelas de réplica com dados fictícios.
create table if not exists ops.replica_consultoria_idu (
  unidade_id integer primary key references ops.unidades (id),
  curva text, idu numeric, faixa text, base_efetiva integer, pilar_fraco text, churn numeric,
  pilares jsonb not null default '[]'
);

create table if not exists ops.replica_consultoria_sinais (
  unidade_id integer not null references ops.unidades (id),
  sinal text not null,
  valor numeric, valor_secundario numeric, amostra integer, situacao text not null,
  primary key (unidade_id, sinal)
);

create or replace function ops.consultoria_idu(p_inicio date, p_fim date)
returns table (unidade_id integer, curva text, idu numeric, faixa text, base_efetiva integer,
               pilar_fraco text, churn numeric, pilares jsonb)
language sql stable security definer set search_path to 'ops' as $$
  select r.unidade_id, r.curva, r.idu, r.faixa, r.base_efetiva, r.pilar_fraco, r.churn, r.pilares
    from ops.replica_consultoria_idu r
$$;

create or replace function ops.consultoria_sinais(p_inicio date, p_fim date)
returns table (unidade_id integer, sinal text, valor numeric, valor_secundario numeric,
               amostra integer, situacao text)
language sql stable security definer set search_path to 'ops' as $$
  select r.unidade_id, r.sinal, r.valor, r.valor_secundario, r.amostra, r.situacao
    from ops.replica_consultoria_sinais r
$$;

revoke all on ops.replica_consultoria_idu, ops.replica_consultoria_sinais from public, anon, authenticated;
revoke execute on function ops.consultoria_idu(date, date), ops.consultoria_sinais(date, date)
  from public, anon, authenticated;

-- Retrato fictício que exercita a lista, com os limites das réguas:
--   Norte: IDU 100 e repasse há 45 dias (gatilho, R-04)  Sul: retenção e inadimplência amarelas
--   Leste: sem alerta                                     Oeste: Implantação com nota no IDU (R-01, R-02)
--   Centro: repasse há 7 dias (não pinta)                 Litoral: repasse há 8 dias (amarelo)
--   Serra: repasse há 31 dias (gatilho)                   Vale: churn de 30% no trimestre (gatilho)
--   Planalto: IDU com 40 pontos medidos (sem base, R-03)  Interior: inadimplência de 6% (vermelho)
--   Capital: sem venda em 90 dias (amarelo)
insert into ops.replica_consultoria_idu values
  (1, 'Madura', 100, 'Superação', 55, 'Crescimento', 0,
   '[{"pilar":"Crescimento","peso":30,"medido":20,"pontos":24,"atingimento":120},{"pilar":"Retenção","peso":35,"medido":35,"pontos":42,"atingimento":120}]'),
  (2, 'Madura', 81.5, 'Na meta', 65, 'Retenção', 3,
   '[{"pilar":"Crescimento","peso":30,"medido":30,"pontos":30,"atingimento":100},{"pilar":"Retenção","peso":35,"medido":35,"pontos":23,"atingimento":65.7}]'),
  (3, 'Ramp-up', 90, 'Superação', 55, 'Retenção', 0, '[]'),
  (4, 'Ramp-up', 32.7, 'Crítico', 55, 'Crescimento', 0, '[]'),
  (5, 'Madura', 88, 'Na meta', 60, 'Crescimento', 1, '[]'),
  (6, 'Madura', 79, 'Na meta', 60, 'Retenção', 2, '[]'),
  (7, 'Madura', 100, 'Superação', 65, 'Crescimento', 0, '[]'),
  (8, 'Madura', 70, 'Abaixo', 60, 'Retenção', 30, '[]'),
  (9, 'Ramp-up', 100, 'Superação', 40, 'Crescimento', 0, '[]'),
  (10, 'Madura', 76, 'Na meta', 55, 'Retenção', 4, '[]'),
  (11, 'Ramp-up', 45, 'Crítico', 55, 'Crescimento', 0, '[]')
on conflict (unidade_id) do nothing;

insert into ops.replica_consultoria_sinais values
  (1, 'repasse', 45, 25000, 2, 'ok'), (1, 'vendas', 6, null, 6, 'ok'),
  (1, 'retencao', 98, 54, 55, 'ok'), (1, 'inadimplencia', 1, 900, 40, 'ok'), (1, 'nps', null, null, 0, 'sem_dado'),
  (2, 'repasse', 12, 3000, 1, 'ok'), (2, 'vendas', 9, null, 9, 'ok'),
  (2, 'retencao', 89, 50, 56, 'ok'), (2, 'inadimplencia', 2.5, 1500, 30, 'ok'), (2, 'nps', 40, 6, 6, 'amostra_insuficiente'),
  (3, 'repasse', 3, 1200, 1, 'ok'), (3, 'vendas', 4, null, 4, 'ok'),
  (3, 'retencao', null, null, 0, 'sem_dado'), (3, 'inadimplencia', null, 0, 0, 'sem_dado'), (3, 'nps', null, null, 0, 'sem_dado'),
  (4, 'repasse', 0, 0, 0, 'ok'), (4, 'vendas', 0, null, 0, 'ok'),
  (4, 'retencao', null, null, 0, 'sem_dado'), (4, 'inadimplencia', null, 0, 0, 'sem_dado'), (4, 'nps', null, null, 0, 'sem_dado'),
  (5, 'repasse', 7, 4000, 1, 'ok'), (5, 'vendas', 5, null, 5, 'ok'),
  (6, 'repasse', 8, 2500, 1, 'ok'), (6, 'vendas', 3, null, 3, 'ok'),
  (7, 'repasse', 31, 18000, 2, 'ok'), (7, 'vendas', 12, null, 12, 'ok'),
  (8, 'repasse', 0, 0, 0, 'ok'), (8, 'vendas', 2, null, 2, 'ok'),
  (9, 'repasse', 0, 0, 0, 'ok'), (9, 'vendas', 6, null, 6, 'ok'),
  (10, 'repasse', 0, 0, 0, 'ok'), (10, 'vendas', 4, null, 4, 'ok'),
  (10, 'inadimplencia', 6, 7000, 35, 'ok'),
  (11, 'repasse', 0, 0, 0, 'ok'), (11, 'vendas', 0, null, 0, 'ok')
on conflict (unidade_id, sinal) do nothing;

-- Réplica mínima do schema `growth` (fontes do CPRR), SÓ PARA HOMOLOGAÇÃO.
create schema if not exists growth;

create table if not exists growth.deals (
  deal_id bigint primary key,
  pipeline text,
  add_time timestamptz,
  faturamento_anual text
);

-- Colunas do win rate (indicadores do broker), mesmos nomes e tipos de produção.
alter table growth.deals add column if not exists stage text;
alter table growth.deals add column if not exists status text;
alter table growth.deals add column if not exists unidade_negocio text;
alter table growth.deals add column if not exists won_time timestamptz;
alter table growth.deals add column if not exists lost_time timestamptz;
alter table growth.deals add column if not exists close_time timestamptz;

-- Mesma definição de produção.
create or replace function growth.deal_arquivado(p_stage text)
returns boolean language sql immutable parallel safe as $$
  select lower(btrim(coalesce(p_stage,''))) = 'arquivado'
$$;

create table if not exists growth.midia_paga (
  data date not null,
  campanha text,
  investimento numeric
);

create table if not exists growth.reunioes_score (
  data date,
  tipo text,
  deal_id bigint
);

-- Mesma definição de produção (regra do Growth de 01/09/2026).
create or replace function growth.campanha_fora_do_funil(p_campanha text)
returns boolean language sql immutable parallel safe as $$
  select lower(translate(coalesce(p_campanha,''),
                'çãáéíóúâêôàõüÇÃÁÉÍÓÚÂÊÔÀÕÜ','caaeiouaeoaouCAAEIOUAEOAOU'))
         ~ '(recon|migracao escritorios)'
$$;

revoke all on schema growth from public, anon, authenticated;
revoke all on all tables in schema growth from public, anon, authenticated;

-- Documentação (PRD 2026-10-documentacao-migracao-sistema-novo): em produção a chave
-- view.documentacao está na área broker_matriz. Aqui, toda conta de teste da matriz
-- (com view.broker_admin) também a recebe; conta de sócio fica sem, para testar a recusa.
insert into ops.replica_chaves (user_id, permission_key)
select user_id, 'view.documentacao' from ops.replica_chaves where permission_key = 'view.broker_admin'
on conflict do nothing;

-- Minha Unidade (PRD 2026-10-minha-unidade-v1, D-04): tabelas lidas pelo schema `unidade`,
-- com os tipos de produção e só as colunas usadas. CPF dos sócios fica de fora.
alter table ops.unidades add column if not exists razao_social text;

-- Em produção: papel admin ativo. Aqui: a chave fictícia `papel.admin` na réplica.
create or replace function ops.eh_super_admin(_user uuid)
returns boolean language sql stable security definer set search_path to 'ops'
as $$ select exists (select 1 from ops.replica_chaves where user_id = _user and permission_key = 'papel.admin') $$;
revoke execute on function ops.eh_super_admin(uuid) from public, anon, authenticated;

create table if not exists ops.socios (
  id integer primary key,
  unidade_id integer references ops.unidades (id),
  nome_completo text not null,
  cargo text,
  email text,
  telefone text
);

create table if not exists ops.csc_unidades (
  sigla text primary key,
  nome text not null,
  unidade_id integer references ops.unidades (id),
  ativo boolean not null default true,
  valor_csc numeric not null,
  regra_vencimento text not null default 'quinto_dia_util'
);

create table if not exists ops.servicos_fixos_unidade (
  id bigint generated always as identity primary key,
  sigla text not null references ops.csc_unidades (sigla),
  servico text not null,
  valor numeric not null,
  competencia_inicio date not null,
  competencia_fim date
);

create table if not exists ops.csc_ciclos (
  id bigint generated always as identity primary key,
  competencia date not null,
  sigla text not null,
  cod_int_os text not null,
  vence_em date not null,
  valor numeric not null,
  cod_titulo bigint,
  status text not null,
  erro text,
  itens jsonb
);

create table if not exists ops.contas_receber (
  id bigint generated always as identity primary key,
  codigo_omie bigint,
  unidade text,
  status_pagamento text,
  data_pagamento date,
  data_vencimento date,
  valor numeric
);

revoke all on ops.socios, ops.csc_unidades, ops.servicos_fixos_unidade, ops.csc_ciclos, ops.contas_receber
  from public, anon, authenticated;

update ops.unidades set razao_social = 'UNIDADE TESTE ' || upper(split_part(nome_da_praca, ' ', 3)) || ' LTDA'
 where razao_social is null;

-- Contas fixas fictícias para o roteiro de homologação:
--   Norte: CSC e CS com degraus, boleto pago e boleto a emitir
--   Sul: CSC que mudou de valor (5.000 no primeiro boleto, 15.000 hoje), boleto atrasado e um avulso sem título
--   Leste: no faturamento, sem boleto ainda
insert into ops.socios values
  (1, 1, 'Sócia Teste Norte', 'Sócia', 'socia.norte@teste.invalid', '(00) 0000-0001'),
  (2, 2, 'Sócio Teste Sul', 'Sócio', 'socio.sul@teste.invalid', '(00) 0000-0002'),
  (3, 2, 'Sócia Teste Sul Dois', 'Sócia', 'socia.sul@teste.invalid', null)
on conflict (id) do nothing;

insert into ops.csc_unidades (sigla, nome, unidade_id, valor_csc, regra_vencimento) values
  ('TNO', 'Teste Norte', 1, 10000, 'quinto_dia_util'),
  ('TSU', 'Teste Sul', 2, 15000, 'dia_15'),
  ('TLE', 'Teste Leste', 3, 8000, 'quinto_dia_util')
on conflict (sigla) do nothing;

insert into ops.servicos_fixos_unidade (sigla, servico, valor, competencia_inicio, competencia_fim)
select * from (values
  ('TNO', 'cs', 2000::numeric, '2026-09-01'::date, '2026-10-01'::date),
  ('TNO', 'cs', 3000, '2026-11-01', null),
  ('TNO', 'midia', 10000, '2026-09-01', null),
  ('TSU', 'gg', 1500, '2026-09-01', null)
) v where not exists (select 1 from ops.servicos_fixos_unidade);

insert into ops.csc_ciclos (competencia, sigla, cod_int_os, vence_em, valor, cod_titulo, status, itens)
select * from (values
  ('2026-09-01'::date, 'TNO', 'TNO-FIX-092026', '2026-10-07'::date, 22000::numeric, 900001::bigint, 'faturada',
   '[{"servico":"csc","valor":10000},{"servico":"midia","valor":10000},{"servico":"cs","valor":2000}]'::jsonb),
  ('2026-10-01', 'TNO', 'TNO-FIX-102026', '2026-11-09', 22000, null, 'planejado',
   '[{"servico":"csc","valor":10000},{"servico":"midia","valor":10000},{"servico":"cs","valor":2000}]'),
  ('2026-08-01', 'TSU', 'TSU-CSC-082026', '2026-09-15', 5000, null, 'faturada', null),
  ('2026-09-01', 'TSU', 'TSU-FIX-092026', '2026-10-06', 6500, 900002, 'faturada',
   '[{"servico":"csc","valor":5000},{"servico":"gg","valor":1500}]')
) v where not exists (select 1 from ops.csc_ciclos);

insert into ops.contas_receber (codigo_omie, unidade, status_pagamento, data_pagamento, data_vencimento, valor)
select * from (values
  (900001::bigint, 'Partners', 'RECEBIDO', '2026-10-07'::date, '2026-10-07'::date, 22000::numeric),
  (900002, 'Partners', 'ATRASADO', null, '2026-10-06', 6500)
) v where not exists (select 1 from ops.contas_receber);

-- Contas de teste do Minha Unidade: todo sócio de teste do broker (view.broker sem
-- view.broker_admin) recebe a chave do módulo; toda conta de matriz vira super admin na
-- réplica, para ver as contas fixas da rede.
insert into ops.replica_chaves (user_id, permission_key)
select s.user_id, 'view.minha_unidade' from ops.replica_chaves s
 where s.permission_key = 'view.broker'
   and not exists (select 1 from ops.replica_chaves m where m.user_id = s.user_id and m.permission_key = 'view.broker_admin')
on conflict do nothing;

insert into ops.replica_chaves (user_id, permission_key)
select user_id, 'papel.admin' from ops.replica_chaves where permission_key = 'view.broker_admin'
on conflict do nothing;

-- Um boleto cancelado e reemitido no roteiro (Sul, 07/2026): o cancelado fica fora do total.
insert into ops.csc_ciclos (competencia, sigla, cod_int_os, vence_em, valor, cod_titulo, status, itens)
select '2026-07-01', 'TSU', 'TSU-CSC-072026', '2026-08-15', 5000, 900003, 'faturada', null
 where not exists (select 1 from ops.csc_ciclos where cod_int_os = 'TSU-CSC-072026');
insert into ops.contas_receber (codigo_omie, unidade, status_pagamento, data_vencimento, valor)
select 900003, 'Partners', 'CANCELADO', '2026-08-15', 5000
 where not exists (select 1 from ops.contas_receber where codigo_omie = 900003);

-- Comissões (PRD wiki/prds/2026-10-comissoes-v1.md, D-04): contratos, apuração de royalties e itens
-- de CAC, e as regras de CAC da unidade. Mesmos nomes e tipos de produção; clientes, closers e SDRs
-- fictícios. A regra de CAC por unidade é a de produção (não é dado sensível).
alter table ops.unidades add column if not exists paga_cac boolean not null default false;
alter table ops.unidades add column if not exists cac_desde date;
alter table ops.unidades add column if not exists cac_honorario_minimo_mensal numeric;

create table if not exists ops.contratos (
  id integer primary key,
  titulo text,
  cnpj text,
  unidade text,
  mrr_mensal numeric,
  ganho_em date,
  status_contrato text,
  origem_pipeline text,
  closer text,
  sdr text,
  entrada_contrato_assinado_em date
);
alter table ops.contratos add column if not exists produto text;

create table if not exists ops.royalties_apuracao (
  id integer primary key,
  unidade_id integer not null,
  mes_referencia date not null,
  status text not null default 'rascunho',
  cac_valor numeric
);

create table if not exists ops.royalties_itens (
  id integer primary key,
  apuracao_id integer not null references ops.royalties_apuracao (id),
  contrato_id integer,
  razao_social text,
  is_cac boolean not null default false,
  cac_parcela smallint,
  royalties_item numeric,
  excluido_em timestamptz,
  motivo_exclusao text
);

revoke all on ops.contratos, ops.royalties_apuracao, ops.royalties_itens from public, anon, authenticated;

update ops.unidades u set paga_cac = true, cac_desde = v.desde
  from (values ('Campo Novo', date '2026-02-01'), ('Fortaleza', '2026-02-01'), ('Maceió', '2026-02-01'),
               ('Recife', '2026-02-01'), ('São Bernardo', '2026-02-01'), ('São Luis', '2026-02-01'),
               ('Sorocaba', '2026-02-01'), ('Patos de Minas', '2026-08-01'), ('Goiânia', '2026-09-01')) v(nome, desde)
 where u.nome_da_praca = v.nome and not u.paga_cac;
update ops.unidades set cac_honorario_minimo_mensal = 10000
 where nome_da_praca = 'Patos de Minas' and cac_honorario_minimo_mensal is null;

-- Roteiro de homologação das comissões: Maceió com 1ª parcela, 2ª parcela e CAC integral na apuração
-- de 10/2026; um item sem parcela; Curitiba sem CAC; Recife sem adiantamento; um contrato da regra
-- antiga com CAC na apuração.
insert into ops.contratos (id, titulo, unidade, mrr_mensal, ganho_em, status_contrato, origem_pipeline, closer, sdr,
                           entrada_contrato_assinado_em)
select * from (values
  (990001, 'Cliente Teste Alfa', 'Maceió', 6400::numeric, date '2026-10-03', 'Ativo', 'inside_sales', 'Closer Teste A', 'SDR Teste B', date '2026-10-06'),
  (990002, 'Cliente Teste Beta', 'Maceió', 4812.50, '2026-10-01', 'Ativo', 'inside_sales', 'Closer Teste A', 'SDR Teste C', '2026-10-02'),
  (990003, 'Cliente Teste Gama', 'Maceió', 11250, '2026-10-08', 'Ativo', 'inside_sales', 'Closer Teste D', 'SDR Teste B', '2026-10-09'),
  (990004, 'Cliente Teste Delta', 'Maceió', 3647, '2026-10-14', 'Ativo', 'inside_sales', 'Closer Teste D', 'SDR Teste C', '2026-10-15'),
  (990005, 'Cliente Teste Épsilon', 'Curitiba', 2400, '2026-10-10', 'Ativo', 'inside_sales', 'Closer Teste A', 'SDR Teste B', null),
  (990006, 'Cliente Teste Zeta', 'Recife', 1013.12, '2026-10-20', 'Ativo', 'inside_sales', 'Closer Teste D', 'SDR Teste C', '2026-10-21'),
  (990007, 'Cliente Teste Eta', 'Maceió', 4300, '2026-09-20', 'Ativo', 'inside_sales', 'Closer Teste A', 'SDR Teste B', '2026-09-22'),
  (990008, 'Cliente Teste Teta', 'Matriz', 9000, '2026-10-12', 'Ativo', 'inside_sales', 'Closer Teste D', 'SDR Teste B', null),
  (990009, 'Cliente Teste Iota', 'Maceió', 5000, '2026-10-16', 'Ativo', 'socios', null, null, '2026-10-17')
) v where not exists (select 1 from ops.contratos where id = 990001);

insert into ops.royalties_apuracao (id, unidade_id, mes_referencia, status, cac_valor)
select * from (values (990101, 8, date '2026-10-01', 'confirmado', 15580.75::numeric)) v
 where not exists (select 1 from ops.royalties_apuracao where id = 990101);

insert into ops.royalties_itens (id, apuracao_id, contrato_id, razao_social, is_cac, cac_parcela, royalties_item)
select * from (values
  (990201, 990101, 990001, 'Cliente Teste Alfa', true, 1::smallint, 3200::numeric),
  (990202, 990101, 990002, 'Cliente Teste Beta', true, 2::smallint, 2406.25),
  (990203, 990101, 990003, 'Cliente Teste Gama', true, 3::smallint, 11250),
  (990204, 990101, 990004, 'Cliente Teste Delta', true, null::smallint, 1823.50),
  (990205, 990101, 990007, 'Cliente Teste Eta', true, 2::smallint, 2150)
) v where not exists (select 1 from ops.royalties_itens where id = 990201);

-- Contas de teste das comissões: toda conta de matriz (view.broker_admin) é líder e financeiro, e todo
-- sócio de teste vira alguém do time (view.comissoes), para o roteiro de homologação.
insert into ops.replica_chaves (user_id, permission_key)
select m.user_id, k.chave from ops.replica_chaves m
 cross join (values ('view.comissoes'), ('manage.comissoes_revisao'), ('manage.comissoes_fechamento')) k(chave)
 where m.permission_key = 'view.broker_admin'
on conflict do nothing;
insert into ops.replica_chaves (user_id, permission_key)
select s.user_id, 'view.comissoes' from ops.replica_chaves s where s.permission_key = 'view.broker'
on conflict do nothing;
