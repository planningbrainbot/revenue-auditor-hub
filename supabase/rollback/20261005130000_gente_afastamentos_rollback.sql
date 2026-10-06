-- Rollback de 20261005130000_gente_afastamentos. APAGA afastamentos e CIDs.
begin;
drop trigger if exists gente_pessoas_fecha_afastamento on ops.gente_pessoas;
drop function if exists ops.gente_fechar_afastamento();
drop function if exists ops.gente_afastar(bigint, date, text, date, text, text);
drop table if exists ops.gente_afastamento_cid;
drop table if exists ops.gente_afastamentos;
delete from ops.area_chaves where area = 'people_remuneracao' and permission_key = 'manage.gente.saude';
update ops.areas set nome = 'Planning People: remuneração',
  descricao = 'Salário e movimentações (salário, cargo, setor) das pessoas da unidade, com envio ao Departamento Pessoal.'
 where slug = 'people_remuneracao';
commit;
