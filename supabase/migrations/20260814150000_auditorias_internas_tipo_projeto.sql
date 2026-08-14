-- Página /auditoria-interna passa a segmentar por "Tipo de Projeto" (campo
-- tipo_de_projeto do pipe Pipefy 307181077, checklist com 1 opção marcada):
--   "Auditoria"               -> auditoria dos projetos das unidades
--   "Contas Perdidas"         -> apoio comercial p/ recuperar contas perdidas
--   "Solicitações Comerciais" -> apoio comercial p/ fechar grandes contas
--   "Reforma Tributária"      -> produto novo de execução de reforma tributária
-- Também traz avaliacao_sucesso (fase "Projeto Concluído") para medir se o
-- projeto atingiu o objetivo, mais relevante nos tipos comerciais.
ALTER TABLE public.auditorias_internas
  ADD COLUMN IF NOT EXISTS tipo_projeto text,
  ADD COLUMN IF NOT EXISTS avaliacao_sucesso text;
