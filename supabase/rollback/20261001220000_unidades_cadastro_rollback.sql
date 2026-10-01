-- Rollback de 20261001220000_unidades_cadastro: tira a escrita pela tela e a chave. Unidades criadas pela tela ficam
-- (apagá-las deixaria contratos e empresas órfãos); pipedrive_opcao_id só cai se os syncs já tiverem voltado ao mapa fixo.
drop policy if exists unidades_select_cadastro on ops.unidades;
drop policy if exists unidades_update_cadastro on ops.unidades;
drop policy if exists unidades_insert_cadastro on ops.unidades;
delete from ops.area_chaves where permission_key = 'manage.unidades_rede';
delete from ops.usuario_chaves where permission_key = 'manage.unidades_rede';
alter table ops.unidades drop constraint if exists unidades_tipo_check;
drop index if exists ops.unidades_nome_da_praca_key;
-- Só depois de publicar a versão anterior de pipedrive-contratos-sync e monetizacao-crm:
-- drop index if exists ops.unidades_pipedrive_opcao_id_key;
-- alter table ops.unidades drop column if exists pipedrive_opcao_id;
