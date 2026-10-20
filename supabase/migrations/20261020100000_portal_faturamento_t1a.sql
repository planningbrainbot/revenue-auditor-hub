-- Portal de Faturamento · T1a, fundação aplicada: extensão da F1 (20/10/2026).
--
-- Plano: PM Work/execution/portal-faturamento-prd-20261013/e1/PLANO-E1.md (Travas, API, linha T1a).
-- Spec: PM Work/execution/portal-faturamento-prd-20261013/spec-portal-faturamento.md §3, §4, §7 e §13.3 (decisões
-- fechadas em 20/10: 1A, 2 tácito, 3A, 4 com Pipefy, 5 gradual).
-- Depende de: 20261015150000_portal_faturamento_f1.sql, aplicada antes desta.
-- Ensaio (begin … rollback, acesso testado como authenticated e service_role): supabase/gates/20261020_portal_faturamento_t1a.sql
-- Rollback: supabase/rollback/20261020100000_portal_faturamento_t1a_rollback.sql
-- Semente do catálogo de serviços do E0: 20261020101000_portal_faturamento_servicos_e0.sql (migration de dados).
--
-- O que faz:
--   1. organizacao.empresas_grupo ganha as travas por emissora (modo_omie, padrão simular; pipefy_sync, padrão
--      desligado) e conta_corrente_padrao; recebe fatura_por do levantamento do E0 (casado pelo CNPJ); ganha as 4
--      empresas que entraram no Brain Financeiro em 19/10 (ASCENDIA, CONCILIADOR, FINANCE, PNE), com o mesmo id de
--      public.empresas do Financial Brain; e AGRO, ROIT e PNC saem do portal (ativa = false: a Ana disse em 15/10 que
--      não faturam mais).
--   2. receita.fat_servicos ganha codigo (cCodigo), id_tributacao (cIdTrib) e tem_tributacao (derivada, a mesma regra
--      do E0), para a semente do catálogo e para o RF-P04 (serviço sem tributação não aparece no portal).
--   3. receita.fat_pedidos e receita.fat_pedido_parcelas (§7), com os 13 estados do plano, numeração FAT-AAAA-NNNNNN
--      por sequence, codigo_integracao = número do pedido (cCodIntOS no Omie) e a soma das parcelas conferida por
--      gatilho de restrição adiado (deferrable initially deferred).
--   4. Schema integracoes (domínio Integrações, princípio 3): integracoes.omie_envios e integracoes.pipefy_envios
--      (filas de saída), integracoes.omie_vinculo_cliente, e integracoes.omie_credencial(), que lê a chave do Omie da
--      emissora no Vault (segredo omie_<sigla>) e só o service_role executa.
--
-- Acesso: o navegador não lê nem grava nenhuma tabela nova. RLS ligada sem policy, e sem GRANT para anon nem
-- authenticated: a tela vai pelas RPCs ops.fat_* da T1b (security definer, search_path fixo, papel e escopo
-- conferidos na primeira linha). O conector (edge, service_role) usa as filas. O schema integracoes não tem USAGE para
-- anon nem authenticated.
--
-- Chaves: nenhuma aqui. Vão para o Vault do banco único por script (portal-faturamento-prd-20261013/e1/vault_omie.py),
-- que lê o .brain-ops.local.env na hora e manda cada par como parâmetro da Management API, fora do texto do SQL.

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. organizacao.empresas_grupo: travas por emissora, fatura_por do E0, 4 empresas novas, 3 fora do portal
-- ---------------------------------------------------------------------------------------------------------------
alter table organizacao.empresas_grupo
  add column modo_omie text not null default 'simular' check (modo_omie in ('simular', 'gravar')),
  add column pipefy_sync boolean not null default false,
  add column conta_corrente_padrao bigint check (conta_corrente_padrao > 0);

comment on column organizacao.empresas_grupo.modo_omie is
  'Trava do Omie por emissora. simular (padrão): o conector monta o payload, só lê (cliente existe? serviço existe?) '
  'e grava o envio como simulado. gravar: o conector cria cliente, OS e conta a receber de verdade. gravar só com o '
  '"pode ativar" do Pedro (plano E1, Travas). O navegador não altera: só a RPC de configuração da T1b, e gravar só admin.';
comment on column organizacao.empresas_grupo.pipefy_sync is
  'Trava do Pipefy por emissora (pipe 307098392 de Contas a Receber, decisão 4 de 20/10). false (padrão): a saída fica '
  'em integracoes.pipefy_envios como simulado, com a mutation montada. true: o conector cria o card e move a fase.';
comment on column organizacao.empresas_grupo.conta_corrente_padrao is
  'Código da conta corrente no Omie desta emissora (nCodCC) usada quando o serviço não define outra. Nulo até a '
  'controladoria informar.';
comment on column organizacao.empresas_grupo.ativa is
  'A empresa entra no Portal de Faturamento. false: sem Omie (PAI, PMN) ou sem faturamento (AGRO, ROIT e PNC, '
  'decisão da Ana em 15/10/2026). Não é o "ativa" do Financial Brain.';
comment on column organizacao.empresas_grupo.fatura_por is
  'os, contrato ou ambos. Preenchido em 20/10/2026 com a sugestão do E0 (levantamento.json, fatura_por_sugerido, '
  'Omie de 01/07 a 30/09/2026): contrato ativo e OS avulsa no período = ambos; só contrato = contrato; só OS = os. '
  'Nulo: sem movimento (PNC, ROIT), sem leitura (AGRO, chave 403), sem Omie (PAI, PMN) ou fora do E0 (ASCENDIA, '
  'CONCILIADOR, FINANCE, PNE). A controladoria confirma ou corrige.';
comment on column organizacao.empresas_grupo.omie_credencial_ref is
  'Nome do segredo no Vault do banco único (vault.secrets.name) com a credencial do Omie desta empresa, '
  '{"app_key","app_secret"}. Nunca a chave. Nulo = empresa sem Omie (PAI, PMN). Desde 20/10/2026 (T1a) o segredo '
  'existe para toda empresa ativa; quem lê é integracoes.omie_credencial(), só pelo service_role.';

insert into organizacao.empresas_grupo
  (id, apelido, razao_social, nome_fantasia, cnpj, grupo_apuracao, omie_credencial_ref, ativa)
values
  ('c2f915ce-960c-40a4-a659-2c8bb3580c75', 'ASCENDIA', 'ASCENDIA GROUP LTDA', 'ASCENDIA GROUP', '68061952000159', 'ASCENDIA', 'omie_ascendia', true),  -- Financeiro: ASCENDIA
  ('ead599c5-8491-46a9-889e-461e165db9b6', 'CONCILIADOR', 'CONCILIADOR CONTABIL LTDA', 'CONCILIADOR CONTABIL', '63279474000134', 'CONCILIADOR', 'omie_conciliador', true),  -- Financeiro: CONCILIADOR
  ('a601d0e7-f23f-4f1b-a65d-bff5c0b6b449', 'FINANCE', 'PLANNING CORPORATE FINANCE LTDA', 'PLANNING CORPORATE FINANCE', '68616679000181', 'FINANCE', 'omie_finance', true),  -- Financeiro: FINANCE
  ('3bac1e6e-bd25-4071-84ea-07ac26bef99f', 'PNE', 'PLANNING NEGOCIOS ESTRUTURADOS LTDA', 'PLANNING NEGOCIOS ESTRUTURADOS', '68387855000150', 'PNE', 'omie_pne', true);  -- Financeiro: PNE

-- AGRO, ROIT e PNC: "Agro, Roit e PNC não há mais faturamento" (Ana, 15/10/2026 16:42). Por id, não por apelido.
update organizacao.empresas_grupo set ativa = false
 where id in ('59028b02-f52f-4a64-a933-ad4b5028c985',   -- AGRO
              '45fcc16a-d2c1-44cc-9924-5c5f817c3f6b',   -- ROIT
              '4828f6a0-7f4e-42b6-8f3e-3fa45fe7d539');  -- PNC

-- fatura_por do E0, casado pelo CNPJ (sem_movimento e não medido ficam nulos).
update organizacao.empresas_grupo g set fatura_por = v.fatura_por
  from (values
    ('49726267000150', 'ambos'),     -- DOC
    ('44275738000137', 'ambos'),     -- BPO
    ('23632609000189', 'contrato'),  -- PGE
    ('30459798000103', 'ambos'),     -- PMC (MAROX no Financial Brain)
    ('55950467000194', 'ambos'),     -- MAROX (Marox Serviços)
    ('66532907000100', 'ambos'),     -- NEO
    ('24296850000147', 'ambos'),     -- PAC
    ('58565726000151', 'os'),        -- PARTNERS
    ('40949469000196', 'ambos'),     -- PAT
    ('23527887000176', 'ambos'),     -- PCC
    ('40417435000150', 'ambos'),     -- PIS
    ('59639455000102', 'ambos'),     -- PAC SP
    ('55909495000168', 'ambos')      -- PRJ
  ) as v (cnpj, fatura_por)
 where g.cnpj = v.cnpj;

comment on table organizacao.empresas_grupo is
  'Domínio Rede e Organização. Empresas do Grupo Planning que emitem nota, cada uma com o seu Omie. '
  'Dono provisório: Controladoria (Ana Carvalhais), pelo Portal de Faturamento, até o domínio Rede e Organização '
  'assumir. Semeada em 15/10/2026 (F1) com as 18 empresas de public.empresas do Financial Brain (itpddzjfrgrbathcqbpo) '
  'e em 20/10/2026 (T1a) com as 4 que entraram lá em 19/10 (ASCENDIA, CONCILIADOR, FINANCE, PNE): 22. '
  'O id é o mesmo uuid de lá e de ops.usuario_empresas.empresa_id. ATENÇÃO: o apelido segue as siglas do Pipefy '
  'de Contas a Receber, não o do Financial Brain. MAROX aqui é a Marox Serviços (55.950.467); a Planning Marox '
  'Consultoria (apelido MAROX no Financial Brain) é PMC. O elo entre os sistemas é o id ou o CNPJ, nunca o apelido. '
  'Escrita: service role e as RPCs do portal; pelo navegador, a controladoria só altera fatura_por. modo_omie e '
  'pipefy_sync são as travas do plano E1 (padrão: simular e desligado).';

-- ---------------------------------------------------------------------------------------------------------------
-- 2. receita.fat_servicos: campos do catálogo do Omie que faltavam
-- ---------------------------------------------------------------------------------------------------------------
alter table receita.fat_servicos
  add column codigo text,
  add column id_tributacao text,
  add column tem_tributacao boolean generated always as (
    coalesce(id_tributacao, '') <> '' and coalesce(codigo_lc116, '') <> '' and coalesce(codigo_municipal, '') <> ''
  ) stored,
  add constraint fat_servicos_id_emissora_key unique (id, emissora_id);

comment on column receita.fat_servicos.codigo is 'Código do serviço no cadastro do Omie da emissora (cCodigo, ex.: SRV00001).';
comment on column receita.fat_servicos.id_tributacao is 'Tipo de tributação do serviço no Omie (cIdTrib).';
comment on column receita.fat_servicos.tem_tributacao is
  'Derivada: cIdTrib, LC 116 e código municipal preenchidos (a mesma regra do E0). Serviço sem tributação não '
  'aparece no portal (RF-P04).';
comment on column receita.fat_servicos.categoria_padrao is 'Categoria do serviço no Omie (cCodCateg, ex.: 1.01.85).';

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Numeração do pedido: FAT-AAAA-NNNNNN
-- ---------------------------------------------------------------------------------------------------------------
create sequence receita.fat_pedidos_numero_seq as bigint start with 1 minvalue 1 no cycle;
comment on sequence receita.fat_pedidos_numero_seq is
  'Contador dos pedidos do portal. Um só, sem reiniciar no ano: o ano no número é o da criação (America/Sao_Paulo). '
  'Número pulado (rascunho desfeito) não volta: é normal.';

create or replace function receita.fat_pedido_numero_formatar(_n bigint, _em timestamptz)
returns text language sql stable set search_path = '' as $$
  select 'FAT-' || extract(year from _em at time zone 'America/Sao_Paulo')::int::text || '-'
         || case when _n < 1000000 then lpad(_n::text, 6, '0') else _n::text end
$$;
comment on function receita.fat_pedido_numero_formatar(bigint, timestamptz) is
  'FAT-<ano da data em America/Sao_Paulo>-<n com 6 dígitos no mínimo>. Pura: não consome a sequence.';

create or replace function receita.fat_pedido_numero()
returns text language sql volatile set search_path = '' as $$
  select receita.fat_pedido_numero_formatar(nextval('receita.fat_pedidos_numero_seq'), now())
$$;
comment on function receita.fat_pedido_numero() is 'Próximo número de pedido (padrão de receita.fat_pedidos.numero).';

-- ---------------------------------------------------------------------------------------------------------------
-- 4. receita.fat_pedidos
-- ---------------------------------------------------------------------------------------------------------------
create table receita.fat_pedidos (
  id uuid primary key default gen_random_uuid(),
  -- cCodIntOS do Omie aceita até 20 caracteres; FAT-2026-000001 tem 15.
  numero text not null unique default receita.fat_pedido_numero()
    check (numero ~ '^FAT-[0-9]{4}-[0-9]{6,}$' and char_length(numero) <= 20),
  codigo_integracao text generated always as (numero) stored,
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  tomador_tipo text check (tomador_tipo in ('pj', 'pf')),
  tomador_documento text,
  tomador_nome text,
  cliente_id uuid,
  emails_envio text[] not null default '{}',
  projeto text,
  servico_id uuid,
  descricao_nf text,
  valor receita.dinheiro check (valor > 0),
  forma text check (forma in ('avulso', 'parcelado')),
  parcelas integer check (parcelas >= 1),
  primeiro_vencimento date,
  competencia receita.competencia,
  documento text check (documento in ('nf', 'recibo', 'nd')),
  meio text check (meio in ('boleto', 'pix')),
  departamento text,
  observacoes text,
  contrato_id uuid,
  dono_id uuid references auth.users (id),
  solicitante_id uuid not null references auth.users (id),
  status text not null default 'rascunho' check (status in (
    'rascunho', 'aguardando_ok', 'devolvido', 'na_fila_omie', 'simulado', 'erro_omie', 'os_criada',
    'em_conferencia', 'faturado', 'recebido', 'em_atraso', 'cancelamento_pedido', 'cancelado')),
  motivo_status text,
  omie_os_codigo bigint,
  omie_nf_numero text,
  omie_nf_link text,
  confirmou_emissora boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fat_pedidos_codigo_integracao_key unique (codigo_integracao),
  -- O serviço tem de ser do catálogo da MESMA emissora.
  constraint fat_pedidos_servico_da_emissora foreign key (servico_id, emissora_id)
    references receita.fat_servicos (id, emissora_id),
  constraint fat_pedidos_documento_tomador check (
    tomador_documento is null
    or (tomador_tipo = 'pj' and tomador_documento ~ '^[0-9]{14}$')
    or (tomador_tipo = 'pf' and tomador_documento ~ '^[0-9]{11}$')),
  constraint fat_pedidos_avulso_uma_parcela check (forma is distinct from 'avulso' or parcelas = 1),
  constraint fat_pedidos_motivo check (
    status not in ('devolvido', 'cancelamento_pedido', 'cancelado') or nullif(btrim(motivo_status), '') is not null),
  -- Rascunho (e devolvido, que volta a ser editado, e cancelado, que pode ter sido rascunho) pode estar incompleto.
  -- Daí em diante, tudo que o Omie precisa está preenchido.
  constraint fat_pedidos_completo check (
    status in ('rascunho', 'devolvido', 'cancelado')
    or (tomador_tipo is not null and tomador_documento is not null and nullif(btrim(tomador_nome), '') is not null
        and servico_id is not null and nullif(btrim(descricao_nf), '') is not null and valor is not null
        and forma is not null and parcelas is not null and primeiro_vencimento is not null
        and competencia is not null and documento is not null and meio is not null and dono_id is not null))
);

comment on table receita.fat_pedidos is
  'Domínio Receita e Repasses. Dono: Portal de Faturamento (Controladoria, Ana Carvalhais). Pedido pontual de '
  'faturamento (§5 e §7): nasce no portal, recebe o OK do dono quando quem pede não é o dono (3A), vira OS no Omie da '
  'emissora pela fila integracoes.omie_envios e é acompanhado até o recebimento. numero (FAT-AAAA-NNNNNN) é também '
  'o código de integração no Omie (cCodIntOS). Não se apaga: cancelar é status. Toda transição vira evento em '
  'receita.fat_eventos (entidade pedido). Quem grava: as RPCs ops.fat_* (T1b) e o conector (service role). O '
  'navegador não lê nem grava direto.';
comment on column receita.fat_pedidos.numero is 'FAT-<ano>-<n>, da sequence receita.fat_pedidos_numero_seq.';
comment on column receita.fat_pedidos.codigo_integracao is 'Igual ao número: cCodIntOS da OS no Omie (idempotência).';
comment on column receita.fat_pedidos.tomador_documento is 'CNPJ (pj, 14 dígitos) ou CPF (pf, 11 dígitos), só dígitos.';
comment on column receita.fat_pedidos.tomador_nome is 'Nome do tomador no momento do pedido (foto, não referência).';
comment on column receita.fat_pedidos.cliente_id is
  'id no mestre de Clientes quando houver. Sem FK: o mestre ainda não foi decidido (§3.3); backfill depois, pelo documento.';
comment on column receita.fat_pedidos.contrato_id is 'Contrato do portal (E2). Sem FK até receita.fat_contratos existir.';
comment on column receita.fat_pedidos.status is
  'rascunho → aguardando_ok (dono ≠ autor) → na_fila_omie → simulado (modo_omie = simular) | os_criada | erro_omie '
  '→ em_conferencia → faturado → recebido | em_atraso. devolvido volta ao autor; cancelamento_pedido (dono pede) → '
  'cancelado (tesouraria efetiva).';
comment on column receita.fat_pedidos.motivo_status is 'Obrigatório em devolvido, cancelamento_pedido e cancelado.';
comment on column receita.fat_pedidos.omie_os_codigo is 'nCodOS da OS criada no Omie da emissora.';
comment on column receita.fat_pedidos.confirmou_emissora is
  'Quem pediu confirmou a emissora quando o tomador tem contrato vigente em outra (aviso RF-P03).';

create index fat_pedidos_emissora_status_idx on receita.fat_pedidos (emissora_id, status);
create index fat_pedidos_dono_idx on receita.fat_pedidos (dono_id);
create index fat_pedidos_solicitante_idx on receita.fat_pedidos (solicitante_id);
create index fat_pedidos_tomador_idx on receita.fat_pedidos (tomador_documento);
create index fat_pedidos_servico_idx on receita.fat_pedidos (servico_id, emissora_id);

create trigger fat_pedidos_updated_at before update on receita.fat_pedidos
  for each row execute function receita.tocar_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- 5. receita.fat_pedido_parcelas e a conferência da soma
-- ---------------------------------------------------------------------------------------------------------------
create table receita.fat_pedido_parcelas (
  pedido_id uuid not null references receita.fat_pedidos (id) on delete cascade,
  n integer not null check (n >= 1),
  vencimento date not null,
  valor receita.dinheiro not null check (valor > 0),
  omie_titulo_codigo bigint,
  situacao text not null default 'a_vencer' check (situacao in ('a_vencer', 'pago', 'em_atraso', 'cancelado')),
  pago_em date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (pedido_id, n)
);

comment on table receita.fat_pedido_parcelas is
  'Domínio Receita e Repasses. Dono: Portal de Faturamento (Controladoria, Ana Carvalhais). Parcelas do pedido '
  'pontual, geradas quando o pedido vai para a fila do Omie (T1b). Quando o pedido tem parcelas, elas são 1..parcelas '
  'e somam o valor do pedido: conferido por gatilho de restrição adiado (fat_pedido_parcelas_soma e '
  'fat_pedidos_parcelas_soma), no fim da transação. Situação e pagamento vêm do Omie pelo conector. O navegador não '
  'lê nem grava direto.';
comment on column receita.fat_pedido_parcelas.omie_titulo_codigo is 'Código do título (conta a receber) no Omie.';

create trigger fat_pedido_parcelas_updated_at before update on receita.fat_pedido_parcelas
  for each row execute function receita.tocar_updated_at();

create or replace function receita.fat_parcelas_conferir()
returns trigger language plpgsql set search_path = '' as $$
declare
  _ids uuid[];
  _id uuid;
  _numero text;
  _valor numeric;
  _parcelas int;
  _qtd int;
  _maior int;
  _soma numeric;
begin
  if tg_table_name = 'fat_pedidos' then
    _ids := array[new.id];
  elsif tg_op = 'INSERT' then
    _ids := array[new.pedido_id];
  elsif tg_op = 'DELETE' then
    _ids := array[old.pedido_id];
  else
    _ids := array[old.pedido_id, new.pedido_id];
  end if;

  foreach _id in array _ids loop
    select p.numero, p.valor, p.parcelas into _numero, _valor, _parcelas
      from receita.fat_pedidos p where p.id = _id;
    if not found then
      continue;  -- o pedido saiu na mesma transação
    end if;
    select count(*), max(x.n), sum(x.valor) into _qtd, _maior, _soma
      from receita.fat_pedido_parcelas x where x.pedido_id = _id;
    if _qtd = 0 then
      continue;  -- rascunho: as parcelas nascem quando o pedido vai para a fila
    end if;
    if _soma is distinct from _valor or _qtd is distinct from _parcelas or _maior <> _qtd then
      raise exception 'Parcelas do pedido % não fecham: % parcela(s) (maior n = %) somando R$ %, mas o pedido é de R$ % em % parcela(s).',
        _numero, _qtd, _maior, _soma, _valor, _parcelas
        using errcode = 'check_violation', constraint = 'fat_pedido_parcelas_soma';
    end if;
  end loop;
  return null;
end $$;
comment on function receita.fat_parcelas_conferir() is
  'Gatilho de restrição adiado: as parcelas de um pedido, se houver, são 1..parcelas e somam o valor do pedido.';

create constraint trigger fat_pedido_parcelas_soma
  after insert or update or delete on receita.fat_pedido_parcelas
  deferrable initially deferred
  for each row execute function receita.fat_parcelas_conferir();

create constraint trigger fat_pedidos_parcelas_soma
  after update of valor, parcelas on receita.fat_pedidos
  deferrable initially deferred
  for each row execute function receita.fat_parcelas_conferir();

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Schema integracoes (domínio Integrações)
-- ---------------------------------------------------------------------------------------------------------------
create schema if not exists integracoes;
comment on schema integracoes is
  'Domínio Integrações: a porta por onde dado de fora entra e sai (princípio 3 do mapa de 09/10). Filas de saída '
  'para o Omie e o Pipefy, vínculo de cadastro e leitura de credencial. Criado em 20/10/2026 pelo Portal de '
  'Faturamento (T1a). Só o conector (service_role) e as RPCs security definer usam; anon e authenticated não têm USAGE.';

revoke all on schema integracoes from public;
grant usage on schema integracoes to service_role;

create or replace function integracoes.tocar_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- 6.1 Fila de saída para o Omie
create table integracoes.omie_envios (
  id uuid primary key default gen_random_uuid(),
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  origem text not null check (origem in ('fat_pedido', 'fat_contrato', 'fat_competencia')),
  origem_id uuid not null,
  operacao text not null check (operacao in (
    'garantir_cliente', 'incluir_os', 'incluir_conta_receber', 'consultar_status', 'faturar_os')),
  codigo_integracao text not null check (btrim(codigo_integracao) <> ''),
  -- O payload é o "param" da chamada, nunca a chamada inteira: chave do Omie não entra (nem na resposta).
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object' and not (payload ?| array['app_key', 'app_secret'])),
  status text not null default 'pendente' check (status in ('pendente', 'processando', 'ok', 'simulado', 'erro')),
  tentativas integer not null default 0 check (tentativas >= 0),
  proxima_tentativa_em timestamptz not null default now(),
  resposta jsonb check (resposta is null or jsonb_typeof(resposta) <> 'object' or not (resposta ?| array['app_key', 'app_secret'])),
  erro_legivel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint omie_envios_idempotencia unique (operacao, codigo_integracao),
  constraint omie_envios_erro_legivel check (status <> 'erro' or nullif(btrim(erro_legivel), '') is not null)
);

comment on table integracoes.omie_envios is
  'Domínio Integrações. Dono: Integrações (o conector do Omie do Ops, edge faturamento-omie da T2); quem enfileira é '
  'o Portal de Faturamento. Fila de saída para o Omie das emissoras (§7, §8): o portal nunca chama o Omie direto. '
  'Unique (operacao, codigo_integracao) garante a idempotência: incluir_os e faturar_os usam o número do pedido '
  '(cCodIntOS); consultar_status reaproveita a linha (volta a pendente) em vez de criar outra. status simulado = '
  'emissora em modo_omie simular (payload montado, só leituras). Sem chave no payload nem na resposta (check). O '
  'navegador não lê: a ficha do pedido mostra o envio pela RPC da T1b.';
comment on column integracoes.omie_envios.origem_id is 'id da linha de origem (pedido, contrato ou competência). Sem FK: polimórfica.';
comment on column integracoes.omie_envios.codigo_integracao is
  'Chave de idempotência da operação no Omie (cCodIntOS para OS; código de integração do cliente para garantir_cliente).';
comment on column integracoes.omie_envios.payload is 'O "param" da chamada ao Omie, sem app_key nem app_secret.';
comment on column integracoes.omie_envios.erro_legivel is 'Erro do Omie traduzido para quem opera. Obrigatório em status erro.';

create index omie_envios_fila_idx on integracoes.omie_envios (proxima_tentativa_em) where status = 'pendente';
create index omie_envios_origem_idx on integracoes.omie_envios (origem, origem_id);
create index omie_envios_emissora_idx on integracoes.omie_envios (emissora_id, status);

create trigger omie_envios_updated_at before update on integracoes.omie_envios
  for each row execute function integracoes.tocar_updated_at();

-- 6.2 Fila de saída para o Pipefy
create table integracoes.pipefy_envios (
  id uuid primary key default gen_random_uuid(),
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  origem text not null check (origem in ('fat_pedido', 'fat_contrato', 'fat_competencia')),
  origem_id uuid not null,
  operacao text not null check (operacao in ('criar_card', 'mover_fase', 'atualizar_campo')),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  card_id text check (card_id ~ '^[0-9]+$'),
  status text not null default 'pendente' check (status in ('pendente', 'processando', 'ok', 'simulado', 'erro')),
  tentativas integer not null default 0 check (tentativas >= 0),
  proxima_tentativa_em timestamptz not null default now(),
  resposta jsonb,
  erro_legivel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pipefy_envios_erro_legivel check (status <> 'erro' or nullif(btrim(erro_legivel), '') is not null)
);

comment on table integracoes.pipefy_envios is
  'Domínio Integrações. Dono: Integrações (conector do Pipefy da T3); quem enfileira é o Portal de Faturamento. Fila '
  'de saída para o pipe 307098392 de Contas a Receber (decisão 4 de 20/10: o pedido nasce no portal, o portal cria o '
  'card e move a fase a cada status). Com organizacao.empresas_grupo.pipefy_sync = false a saída fica aqui como '
  'simulado, com a mutation montada em payload. O navegador não lê.';
comment on column integracoes.pipefy_envios.payload is 'A mutation GraphQL montada (query e variables), sem token.';
comment on column integracoes.pipefy_envios.card_id is 'id do card no Pipefy (criado por criar_card; usado por mover_fase e atualizar_campo).';

create index pipefy_envios_fila_idx on integracoes.pipefy_envios (proxima_tentativa_em) where status = 'pendente';
create index pipefy_envios_origem_idx on integracoes.pipefy_envios (origem, origem_id);
create index pipefy_envios_emissora_idx on integracoes.pipefy_envios (emissora_id, status);

create trigger pipefy_envios_updated_at before update on integracoes.pipefy_envios
  for each row execute function integracoes.tocar_updated_at();

-- 6.3 Vínculo do tomador com o cadastro de clientes do Omie de cada emissora
create table integracoes.omie_vinculo_cliente (
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  documento text not null check (documento ~ '^([0-9]{11}|[0-9]{14})$'),
  codigo_cliente_omie bigint not null check (codigo_cliente_omie > 0),
  codigo_cliente_integracao text,
  sincronizado_em timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (emissora_id, documento)
);

comment on table integracoes.omie_vinculo_cliente is
  'Domínio Integrações. Dono: Integrações (conector do Omie). Qual cliente do Omie de cada emissora é o tomador de '
  'documento X (§7): o conector consulta ou cria (garantir_cliente) e guarda aqui, para não procurar de novo nem '
  'duplicar cadastro. O navegador não lê.';
comment on column integracoes.omie_vinculo_cliente.documento is 'CNPJ (14) ou CPF (11), só dígitos.';
comment on column integracoes.omie_vinculo_cliente.codigo_cliente_omie is 'nCodCli no Omie da emissora.';
comment on column integracoes.omie_vinculo_cliente.codigo_cliente_integracao is 'codigo_cliente_integracao no Omie, quando houver.';

create trigger omie_vinculo_cliente_updated_at before update on integracoes.omie_vinculo_cliente
  for each row execute function integracoes.tocar_updated_at();

-- 6.4 Credencial do Omie da emissora, do Vault. Só o service_role (o conector) executa: além do GRANT, o corpo
-- confere o papel da sessão (SET ROLE do PostgREST / da edge), que um usuário logado não consegue vestir. As mensagens
-- de erro nunca levam o segredo.
create or replace function integracoes.omie_credencial(p_emissora uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  _ref text;
  _ativa boolean;
  _apelido text;
  _segredo text;
  _j jsonb;
begin
  if coalesce(current_setting('role', true), 'none') <> 'service_role' then
    raise exception 'integracoes.omie_credencial: só o conector (service_role) lê credencial do Omie'
      using errcode = '42501';
  end if;

  select g.omie_credencial_ref, g.ativa, g.apelido into _ref, _ativa, _apelido
    from organizacao.empresas_grupo g where g.id = p_emissora;
  if not found then
    raise exception 'Emissora % não existe em organizacao.empresas_grupo', p_emissora using errcode = 'P0002';
  end if;
  if not _ativa then
    raise exception 'Emissora % está fora do Portal de Faturamento (ativa = false)', _apelido using errcode = '55000';
  end if;
  if _ref is null then
    raise exception 'Emissora % não tem Omie (omie_credencial_ref nulo)', _apelido using errcode = '55000';
  end if;

  select s.decrypted_secret into _segredo from vault.decrypted_secrets s where s.name = _ref;
  if _segredo is null then
    raise exception 'Segredo % da emissora % não está no Vault', _ref, _apelido using errcode = 'P0002';
  end if;

  begin
    _j := _segredo::jsonb;
  exception when others then
    raise exception 'Segredo % da emissora % não é JSON válido', _ref, _apelido using errcode = '22P02';
  end;
  if jsonb_typeof(_j) <> 'object'
     or coalesce(btrim(_j ->> 'app_key'), '') = '' or coalesce(btrim(_j ->> 'app_secret'), '') = '' then
    raise exception 'Segredo % da emissora % sem app_key ou app_secret', _ref, _apelido using errcode = '22023';
  end if;

  return jsonb_build_object('app_key', _j ->> 'app_key', 'app_secret', _j ->> 'app_secret');
end $$;
comment on function integracoes.omie_credencial(uuid) is
  'Credencial do Omie da emissora ({app_key, app_secret}), do segredo do Vault indicado em '
  'organizacao.empresas_grupo.omie_credencial_ref. Só o service_role executa (GRANT e conferência no corpo). '
  'Emissora inativa, sem Omie ou sem segredo levanta exceção, sem expor valor.';

-- ---------------------------------------------------------------------------------------------------------------
-- 7. RLS e privilégios: nada para anon nem authenticated
-- ---------------------------------------------------------------------------------------------------------------
alter table receita.fat_pedidos enable row level security;
alter table receita.fat_pedido_parcelas enable row level security;
alter table integracoes.omie_envios enable row level security;
alter table integracoes.pipefy_envios enable row level security;
alter table integracoes.omie_vinculo_cliente enable row level security;

revoke all on receita.fat_pedidos, receita.fat_pedido_parcelas,
              integracoes.omie_envios, integracoes.pipefy_envios, integracoes.omie_vinculo_cliente
  from public, anon, authenticated, service_role;

-- Pedido e parcela não se apagam (cancelar é status); as filas são histórico.
grant select, insert, update on receita.fat_pedidos, receita.fat_pedido_parcelas to service_role;
grant select, insert, update on integracoes.omie_envios, integracoes.pipefy_envios, integracoes.omie_vinculo_cliente
  to service_role;

revoke all on sequence receita.fat_pedidos_numero_seq from public, anon, authenticated, service_role;
grant usage on sequence receita.fat_pedidos_numero_seq to service_role;

revoke all on function
  receita.fat_pedido_numero(), receita.fat_pedido_numero_formatar(bigint, timestamptz)
  from public, anon, authenticated;
grant execute on function
  receita.fat_pedido_numero(), receita.fat_pedido_numero_formatar(bigint, timestamptz)
  to service_role;

-- Funções de gatilho: o Postgres não confere EXECUTE quando o gatilho dispara, e ninguém precisa chamá-las.
revoke all on function receita.fat_parcelas_conferir(), integracoes.tocar_updated_at()
  from public, anon, authenticated;

revoke all on function integracoes.omie_credencial(uuid) from public, anon, authenticated;
grant execute on function integracoes.omie_credencial(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- 8. Conferência antes do commit
-- ---------------------------------------------------------------------------------------------------------------
do $conferencia$
declare n int;
begin
  select count(*) into n from organizacao.empresas_grupo;
  if n <> 22 then raise exception 'T1a: % empresas do grupo (esperava 22)', n; end if;
  select count(*) into n from organizacao.empresas_grupo where ativa;
  if n <> 17 then raise exception 'T1a: % empresas ativas no portal (esperava 17)', n; end if;
  select count(*) into n from organizacao.empresas_grupo where fatura_por is not null;
  if n <> 13 then raise exception 'T1a: fatura_por preenchido em % empresas (esperava 13, as do E0 com movimento)', n; end if;
  select count(*) into n from organizacao.empresas_grupo where modo_omie <> 'simular' or pipefy_sync;
  if n <> 0 then raise exception 'T1a: % empresas fora das travas (esperava todas em simular, sem Pipefy)', n; end if;
end $conferencia$;

commit;
