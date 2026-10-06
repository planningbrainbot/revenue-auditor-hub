-- Rollback de 20261005140000_gente_movimentacao_formulario. Perde tipos,
-- motivos, modelo de trabalho, justificativa, responsabilidades e numeração.
begin;
drop trigger if exists gente_mov_numerar on ops.gente_movimentacoes;
drop function if exists ops.gente_mov_numerar();
alter table ops.gente_movimentacoes drop constraint if exists gente_mov_algo_muda;
alter table ops.gente_movimentacoes add constraint gente_mov_algo_muda check (
  salario_depois is not null or cargo_depois is not null or departamento_depois is not null
  or gestor_depois_id is not null or vinculo_depois is not null);
alter table ops.gente_movimentacoes
  drop column if exists responsabilidades, drop column if exists justificativa,
  drop column if exists modelo_trabalho, drop column if exists motivos,
  drop column if exists tipos, drop column if exists ano, drop column if exists numero;
commit;
