-- Rollback de 20261001230000_gente_historico_cadastro. Apaga o histórico
-- gravado até aqui. A versão anterior de gente_excluir_cadastro está em
-- 20261001210000 e volta a valer reaplicando aquele trecho.
begin;
drop trigger if exists gente_pessoas_historico on ops.gente_pessoas;
drop function if exists ops.gente_pessoas_registrar_historico();
drop table if exists ops.gente_pessoas_historico;
commit;
