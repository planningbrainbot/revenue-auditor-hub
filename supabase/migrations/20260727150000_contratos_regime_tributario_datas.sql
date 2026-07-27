-- Novos campos em 'contratos', vindos do Pipedrive:
-- - regime_tributario: campo customizado do deal (pipeline 2, "Qual é o regime
--   tributário da sua empresa?"), populado por ~/sync_pipedrive_contratos.py
-- - entrada_contrato_assinado_em: data em que o deal-cópia entrou no stage 170
--   ("Contrato Assinado") do pipeline 28 (Central de Contratos), via /flow do
--   Pipedrive. Distinta de 'ganho_em' (won_time do deal original no pipeline 2).
alter table public.contratos
  add column if not exists regime_tributario text,
  add column if not exists entrada_contrato_assinado_em date;
