-- Rollback de 20261001150000_gente_ave_modelos. Apaga moldes e cópias da AVE
-- com avaliações e respostas (cascade dos ciclos). Só usar antes de ter AVE
-- respondida que importe.

begin;
delete from ops.gente_ciclos where modelo in ('ave45', 'ave90');
delete from ops.gente_competencias where categoria like 'ave45:%' or categoria like 'ave90:%';
drop function if exists ops.gente_ave_ciclo(integer, text);
drop policy if exists gente_ciclos_sem_molde on ops.gente_ciclos;
drop index if exists ops.gente_ciclos_modelo_molde;
drop index if exists ops.gente_ciclos_modelo_unidade;
alter table ops.gente_ciclos drop column if exists e_modelo;
alter table ops.gente_ciclos drop column if exists modelo;
alter table ops.gente_ciclos drop column if exists instrucoes;
alter table ops.gente_ciclo_competencias drop column if exists pergunta;
alter table ops.gente_ciclo_competencias drop column if exists titulo;
alter table ops.gente_ciclo_competencias drop column if exists opcoes;
alter table ops.gente_ciclo_topicos drop column if exists tipos;
commit;
