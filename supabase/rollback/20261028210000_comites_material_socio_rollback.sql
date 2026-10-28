-- Volta de 20261028210000_comites_material_socio.sql: só admin volta a ler.
begin;
drop policy if exists comites_ler on ops.comites;
create policy comites_ler on ops.comites for select to authenticated
  using (ops.can('view.admin.comites'));
drop policy if exists comites_arquivos_ler on storage.objects;
create policy comites_arquivos_ler on storage.objects for select to authenticated
  using (bucket_id = 'comites' and ops.can('view.admin.comites'));
delete from ops.area_chaves where permission_key = 'view.meus_comites';
delete from ops.role_permissions where permission_key = 'view.meus_comites';
commit;
