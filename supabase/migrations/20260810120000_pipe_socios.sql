-- Pipe de Sócios (Pipedrive pipeline 4, "Negociação - Sócios", stage 128 "Ganho")
-- passa a ser uma segunda fonte de vendas, somada ao pipeline 2 (Inside Sales).
-- Ver DATA-RULES.md seção 6 e memória project_pipe_socios_integracao.

-- 1. Rastreabilidade de origem em contratos/empresas — não muda nenhuma regra de
-- MRR/royalties existente, só permite filtrar/relatar por origem depois.
alter table contratos
  add column origem_pipeline text not null default 'inside_sales';

alter table empresas
  add column origem_pipeline text not null default 'inside_sales';

alter table contratos
  add constraint contratos_origem_pipeline_check
  check (origem_pipeline in ('inside_sales', 'socios'));

alter table empresas
  add constraint empresas_origem_pipeline_check
  check (origem_pipeline in ('inside_sales', 'socios'));

-- 2. Venda de sócio lançada no Omie sem deal correspondente no Pipedrive: marcada
-- manualmente na apuração de royalties (addItemManual / checkbox "Venda de sócio").
-- pipedrive_deal_id_socios é preenchido pelo script que cria o deal automaticamente
-- no pipe Sócios — evita criar o mesmo deal duas vezes em execuções seguintes.
alter table royalties_itens
  add column venda_socios boolean not null default false;

alter table royalties_itens
  add column pipedrive_deal_id_socios text;

alter table royalties_itens
  add column venda_socios_criado_em timestamptz;
