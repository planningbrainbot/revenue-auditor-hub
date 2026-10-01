-- Rollback de 20261002100000_gente_movimentacoes. APAGA salários e
-- movimentações gravados. O histórico do cadastro fica (só perde a coluna origem).
begin;
select cron.unschedule('gente-movimentacoes-aplicar')
 where exists (select 1 from cron.job where jobname = 'gente-movimentacoes-aplicar');
drop function if exists ops.gente_aplicar_movimentacoes(bigint);
drop table if exists ops.gente_movimentacoes;
drop table if exists ops.gente_remuneracao;
drop table if exists ops.gente_config_unidade;
delete from ops.role_areas where area = 'people_remuneracao';
delete from ops.area_chaves where area = 'people_remuneracao';
delete from ops.areas where slug = 'people_remuneracao';
alter table ops.gente_pessoas_historico drop column if exists origem;
commit;
