-- Desfaz 20261027180000_uso_brain.sql. Apaga o uso registrado.
begin;

delete from ops.role_permissions where permission_key = 'view.admin.uso';
delete from ops.usuario_chaves where permission_key = 'view.admin.uso';
delete from ops.area_chaves where permission_key = 'view.admin.uso';

drop function if exists ops.uso_brain_painel(date, integer, uuid);
drop function if exists ops.registrar_uso(text);
drop function if exists ops.normalizar_rota_uso(text);
drop table if exists ops.uso_minutos;

commit;
