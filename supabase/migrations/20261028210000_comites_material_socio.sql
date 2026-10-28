-- Comitês na Minha Unidade (/meus-comites): o sócio vê a apresentação e a
-- gravação de cada comitê. Pedido do dono em 28/10/2026 ("quero que apareça
-- também na minha unidade para cada sócio o ppt e a gravação da reunião"),
-- que decide a P-01 do PRD wiki/prds/2026-10-ops-comites-da-rede.md.
--
-- Só o material: as respostas da pesquisa seguem exigindo view.admin.comites.
-- Depende de 20261028200000_comites_da_rede.sql.
-- Rollback: supabase/rollback/20261028210000_comites_material_socio_rollback.sql

begin;

drop policy if exists comites_ler on ops.comites;
create policy comites_ler on ops.comites for select to authenticated
  using (ops.can('view.admin.comites') or ops.can('view.meus_comites'));

drop policy if exists comites_arquivos_ler on storage.objects;
create policy comites_arquivos_ler on storage.objects for select to authenticated
  using (bucket_id = 'comites' and (ops.can('view.admin.comites') or ops.can('view.meus_comites')));

insert into ops.area_chaves (area, permission_key)
values ('minha_unidade', 'view.meus_comites'), ('admin', 'view.meus_comites')
on conflict do nothing;

insert into ops.role_permissions (role, permission_key, allowed)
values ('socio_regional', 'view.meus_comites', true), ('admin', 'view.meus_comites', true)
on conflict do nothing;

commit;
