-- Rollback de 20261001210000_gente_desligar_excluir. Cadastro excluído não volta
-- (o log em acessos_log guarda nome, e-mail e unidade); status gravados ficam.
begin;
drop function if exists ops.gente_excluir_cadastro(bigint);
drop function if exists ops.gente_definir_status(bigint, text, date, text);
drop function if exists ops._gente_pode_gerir(bigint);
alter table ops.gente_pessoas drop column if exists motivo_desligamento;
commit;
