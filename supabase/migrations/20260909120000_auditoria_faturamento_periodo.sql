-- Faturamento do período analisado (campo do card no pipe 307181077).
-- Denominador da exposição da carteira: achado / faturamento auditado.
alter table public.auditorias_internas
  add column if not exists faturamento_periodo numeric;

comment on column public.auditorias_internas.faturamento_periodo is
  'Faturamento do período analisado, campo "faturamento_do_periodo_analisado" do Pipefy. Preenchido só em parte dos cards.';
