-- Rollback da proposta 20260923230000: devolve o EXECUTE como estava em 23/09.
grant execute on all functions in schema financeiro to anon, authenticated;
alter default privileges in schema financeiro grant execute on functions to anon, authenticated;
