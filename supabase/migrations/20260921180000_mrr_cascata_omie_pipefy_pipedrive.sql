-- Cascata de MRR: Omie → Pipefy → Pipedrive (21/09/2026)
--
-- Contexto. A aba Contratos de /clientes mostrava a maioria dos clientes sem
-- MRR e sem data de assinatura. A investigação achou três causas distintas:
--
--   1. O MRR da tela saía só de `contratos` (Pipedrive), casado por
--      `empresas.pipedrive_id`. Cliente que entrou pelo pipe de Onboarding e
--      nunca teve deal (base antiga das unidades) não casa com nada e aparece
--      zerado. São a maioria da lista.
--   2. O pipe "[PTRS-CLI-03] Contratos [Juridico]" (307285170) foi
--      reestruturado: a fase "Vigente", de onde `pipefy-contratos-sync` lia
--      `valor` e `data_de_assinatura`, virou "Enviar para Onboarding", e os
--      dados reais passaram a morar em campos que o sync não conhecia
--      ("Honorário Médio mensal do contrato", "Valor total do contrato",
--      "Data da Venda", "Data de assinatura do contrato"). O sync seguia
--      verde, lendo campo vazio.
--   3. O backfill de `contratos.entrada_contrato_assinado_em` só existia no
--      script local `~/sync_pipedrive_contratos.py`, desativado em 31/08/2026
--      quando as automações foram para a nuvem. Último preenchimento:
--      29/07/2026. Nenhum ganho de agosto ou setembro tem data.
--
-- Decisão do usuário (21/09/2026), na ordem: **tem no Omie usa do Omie, não
-- tem puxa do Pipefy, não tem puxa do Pipedrive.** O Omie ganha porque é o
-- contrato de serviço que de fato fatura o cliente todo mês; o Pipefy é o
-- contrato jurídico assinado; o Pipedrive é a intenção comercial da venda.
-- Quanto mais perto do dinheiro, mais forte a fonte.
--
-- Isto NÃO altera `contratos.mrr` nem `contratos.mrr_mensal`. Essas colunas
-- alimentam royalties, IDU, indicadores de trimestre e broker, e trocar o
-- número delas no meio do trimestre mudaria apuração já conversada com as
-- unidades. A cascata vive na view nova `v_cliente_mrr`, que a tela consome.
-- Migrar os outros consumidores é decisão separada.
--
-- `set search_path` em vez de prefixo fixo: no banco único as tabelas do Ops
-- vivem em `ops`, no projeto antigo em `public`.
set search_path to ops, public;

-- ─────────────────────────────────────────────────────────────
-- 1. Contratos de serviço do Omie
-- ─────────────────────────────────────────────────────────────
-- Já existe `base_omie_contratos`, mas ela é da classificação de origem da
-- base (Curitiba, corte de abril/2025): guarda só a vigência inicial, roda
-- apenas para os aplicativos de Curitiba e é fechada a service_role por
-- desenho ("contratos e chaves completos não são expostos"). Abrir aquela
-- tabela para a tela misturaria dois propósitos, então o valor mensal ganha
-- tabela própria, alimentada para todas as unidades.
--
-- Um cliente pode ter mais de um contrato ativo no Omie (escopos separados,
-- filiais). O grão é o contrato; a soma por CNPJ acontece na view.
create table if not exists omie_contratos_servico (
  unidade          text not null,
  contrato_id      text not null,
  cliente_id       text,
  cnpj             text,
  numero           text,
  -- cCodSit do cabeçalho. '10' é contrato ativo; '99' encerrado e '90'
  -- cancelado não entram no MRR. Guardado cru para a regra poder mudar sem
  -- precisar reprocessar a API.
  situacao         text,
  -- cabecalho.nValTotMes: o valor que o contrato fatura por mês. É o MRR do
  -- cliente na régua do ERP.
  valor_mensal     numeric,
  vigencia_inicial date,
  vigencia_final   date,
  categoria        text,
  sincronizado_em  timestamptz not null default now(),
  primary key (unidade, contrato_id)
);

comment on table omie_contratos_servico is
  'Contratos de servico do Omie (servicos/contrato ListarContratos), uma linha por contrato por unidade. Fonte primaria de MRR na cascata Omie > Pipefy > Pipedrive. Sync: Edge Function omie-contratos-servico-sync.';
comment on column omie_contratos_servico.valor_mensal is
  'cabecalho.nValTotMes — valor faturado por mes. So entra no MRR quando situacao = 10.';
comment on column omie_contratos_servico.situacao is
  'cCodSit do cabecalho: 10 ativo, 90 cancelado, 99 encerrado.';

create index if not exists omie_contratos_servico_cnpj_idx
  on omie_contratos_servico (cnpj)
  where situacao = '10';

alter table omie_contratos_servico enable row level security;
grant select on omie_contratos_servico to authenticated;
grant all    on omie_contratos_servico to service_role;

drop policy if exists "omie_contratos_servico_select" on omie_contratos_servico;
create policy "omie_contratos_servico_select" on omie_contratos_servico
  for select to authenticated using ((select can('view.clientes')));

-- ─────────────────────────────────────────────────────────────
-- 2. Campos do pipe que o sync passou a ler
-- ─────────────────────────────────────────────────────────────
-- `contratos_documentos.valor` continua sendo o campo "Valor" da fase antiga,
-- preenchido em 234 cards e com o bug de escala corrigido nesta mesma leva.
-- Os três abaixo são os campos que a operação de fato usa hoje.
alter table contratos_documentos
  add column if not exists mrr_mensal           numeric,
  add column if not exists valor_total_contrato numeric,
  add column if not exists data_venda           date;

comment on column contratos_documentos.mrr_mensal is
  'Campo "Honorario Medio mensal do contrato" (honor_rio_mensal) da fase Nova Solicitacao. Segunda fonte da cascata de MRR.';
comment on column contratos_documentos.valor_total_contrato is
  'Campo "Valor total do contrato" (valor_total_do_contrato) da fase Nova Solicitacao.';
comment on column contratos_documentos.data_venda is
  'Campo "Data da Venda". NAO e data de assinatura — decisao do usuario em 21/09/2026 de nao usar como aproximacao dela.';

-- ─────────────────────────────────────────────────────────────
-- 3. A cascata, por cliente
-- ─────────────────────────────────────────────────────────────
-- Grão: uma linha por empresa. A tela lista empresas, não contratos, e é por
-- isso que o MRR precisa ser resolvido por cliente e não por deal — senão
-- cliente sem deal continua sem número, que é o problema original.
create or replace view v_cliente_mrr as
with omie as (
  select
    regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') as cnpj,
    sum(valor_mensal)                                 as valor,
    count(*)                                          as contratos
  from omie_contratos_servico
  where situacao = '10'
    and coalesce(valor_mensal, 0) > 0
    and regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') <> ''
  group by 1
),
pipefy as (
  -- Distrato e card em churn não são MRR corrente. Um cliente pode ter vários
  -- documentos (contrato novo + aditivos); o mais recente manda.
  select distinct on (empresa_id)
    empresa_id,
    mrr_mensal      as valor,
    data_assinatura
  from contratos_documentos
  where empresa_id is not null
    and coalesce(mrr_mensal, 0) > 0
    and coalesce(tipo, '') <> 'Distrato'
    and coalesce(fase_atual, '') <> 'Churn no Contrato'
  order by empresa_id, coalesce(data_assinatura, data_venda) desc nulls last, id desc
),
pipefy_por_deal as (
  -- Rede de segurança enquanto `empresa_id` não estiver resolvido em todos os
  -- cards: o Deal ID está preenchido em 100% deles.
  select distinct on (pipedrive_deal_id)
    pipedrive_deal_id,
    mrr_mensal      as valor,
    data_assinatura
  from contratos_documentos
  where pipedrive_deal_id is not null
    and coalesce(mrr_mensal, 0) > 0
    and coalesce(tipo, '') <> 'Distrato'
    and coalesce(fase_atual, '') <> 'Churn no Contrato'
  order by pipedrive_deal_id, coalesce(data_assinatura, data_venda) desc nulls last, id desc
),
pipedrive as (
  select
    pipedrive_deal_id,
    sum(mrr_mensal)                       as valor,
    max(entrada_contrato_assinado_em)     as data_assinatura
  from contratos
  where status_contrato = 'Ativo'
    and pipedrive_deal_id is not null
  group by 1
)
select
  e.id                                    as empresa_id,
  e.unidade,
  e.pipedrive_id,
  coalesce(o.valor, pe.valor, pd.valor, pv.valor)          as mrr_mensal,
  case
    when o.valor  is not null then 'omie'
    when pe.valor is not null then 'pipefy'
    when pd.valor is not null then 'pipefy'
    when pv.valor is not null then 'pipedrive'
  end                                                      as mrr_fonte,
  -- Data de assinatura não tem equivalente no Omie (o contrato de serviço só
  -- guarda vigência), então a cascata dela começa no Pipefy.
  coalesce(pe.data_assinatura, pd.data_assinatura, pv.data_assinatura) as data_assinatura,
  case
    when pe.data_assinatura is not null or pd.data_assinatura is not null then 'pipefy'
    when pv.data_assinatura is not null then 'pipedrive'
  end                                                      as data_assinatura_fonte,
  o.valor                                                  as mrr_omie,
  coalesce(pe.valor, pd.valor)                             as mrr_pipefy,
  pv.valor                                                 as mrr_pipedrive,
  o.contratos                                              as omie_contratos_ativos
from empresas e
left join omie o
  on o.cnpj = regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')
 and regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g') <> ''
left join pipefy pe
  on pe.empresa_id = e.id
left join pipefy_por_deal pd
  on pd.pipedrive_deal_id = e.pipedrive_id
left join pipedrive pv
  on pv.pipedrive_deal_id = e.pipedrive_id;

comment on view v_cliente_mrr is
  'MRR mensal e data de assinatura por cliente, na ordem Omie > Pipefy > Pipedrive (decisao do usuario, 21/09/2026). mrr_fonte diz qual sistema respondeu. Consumida pela aba Contratos de /clientes.';

-- Sem isto a view roda com os direitos do dono e devolve cliente de qualquer
-- unidade, furando o escopo de `empresas` — e o "Ver como a unidade" passaria
-- a mostrar carteira alheia. Mesmo padrão das outras views do Ops.
alter view v_cliente_mrr set (security_invoker = true);

grant select on v_cliente_mrr to authenticated;
grant select on v_cliente_mrr to service_role;

notify pgrst, 'reload schema';
