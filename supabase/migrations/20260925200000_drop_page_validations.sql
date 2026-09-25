-- Remove ops.page_validations. A validacao de paginas saiu do app em c89498e
-- (faixa "Dados em validacao" e /admin/validacao) e nada mais le a tabela:
-- nenhuma view, funcao ou codigo depende dela. Rollback com as 16 linhas em
-- supabase/rollback/20260925200000_drop_page_validations_rollback.sql.

drop table if exists ops.page_validations;
