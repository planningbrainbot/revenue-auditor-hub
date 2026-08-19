-- Tabela auxiliar pra ligar telefone -> card do Pipefy, usada pelo workflow
-- n8n de resposta do WhatsApp Flow (o webhook da Meta só devolve o número de
-- telefone de quem respondeu, não o card_id do Pipefy).
--
-- Aplicado em produção via Management API em 18/08/2026 (projeto n8n + NPS
-- via WhatsApp) — este arquivo só documenta a mudança.

create table if not exists public.nps_envio_map (
  id bigint generated always as identity primary key,
  telefone text not null,
  pipefy_card_id text not null,
  enviado_em timestamptz not null default now(),
  respondido boolean not null default false
);

create index if not exists idx_nps_envio_map_telefone
  on public.nps_envio_map(telefone)
  where not respondido;
