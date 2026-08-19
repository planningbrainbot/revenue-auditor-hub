-- Adiciona campos do WhatsApp Flow de NPS (pesquisa_nps_planning) a nps_pesquisas.
-- Aplicado em produção via Management API em 18/08/2026 (projeto n8n + NPS via
-- WhatsApp) — este arquivo só documenta a mudança, mantendo o histórico de
-- schema versionado no repo.

alter table public.nps_pesquisas
  add column if not exists servicos_contratados text[],
  add column if not exists avaliacao_contabil text,
  add column if not exists avaliacao_folha_pagamento text,
  add column if not exists synced_at timestamptz,
  add column if not exists data_envio date;

create unique index if not exists idx_nps_pesquisas_pipefy_card_id
  on public.nps_pesquisas(pipefy_card_id)
  where pipefy_card_id is not null;
