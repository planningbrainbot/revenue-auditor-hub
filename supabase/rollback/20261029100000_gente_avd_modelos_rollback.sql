-- Desfaz 20261029100000_gente_avd_modelos. Apaga os ciclos de AVD (e as avaliações deles,
-- em cascata pelo ciclo), os moldes, as competências da AVD e a liberação do 360°. A AVE
-- volta a aceitar par e o comentário volta a ser opcional.
begin;
drop trigger if exists gente_avaliacoes_conferir_comentarios on ops.gente_avaliacoes;
drop function if exists ops.gente_avaliacao_conferir_comentarios();
drop trigger if exists gente_avaliacoes_conferir_grau on ops.gente_avaliacoes;
drop function if exists ops.gente_avaliacao_conferir_grau();
drop table if exists ops.gente_avd_liberacao_360;
drop function if exists ops.gente_avd_ciclo(integer, text, text);
delete from ops.gente_ciclos where modelo like 'avd\_%';
delete from ops.gente_competencias where categoria in ('avd_colab', 'avd_lider');
update ops.gente_ciclos set tem_par = true where modelo in ('ave45', 'ave90');
alter table ops.gente_ciclos drop column if exists comentario_obrigatorio;
-- gente_ave_ciclo: reaplicar a versão de 20261001150000 (sem comentario_obrigatorio).
commit;
