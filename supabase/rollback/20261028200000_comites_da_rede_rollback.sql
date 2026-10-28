-- Volta de 20261028200000_comites_da_rede.sql. Não apaga respostas: só tira o
-- vínculo com o comitê e devolve a policy de insert aberta.
begin;
drop policy if exists respostas_comite_ler on ops.pesquisa_satisfacao_comite_socios;
drop policy if exists insert_publico_pesquisa_comite_socios on ops.pesquisa_satisfacao_comite_socios;
create policy insert_publico_pesquisa_comite_socios on ops.pesquisa_satisfacao_comite_socios
  for insert to anon with check (true);
alter table ops.pesquisa_satisfacao_comite_socios drop column if exists comite_codigo;
drop function if exists ops.comite_pesquisa_aberta(text);
drop policy if exists comites_arquivos_ler on storage.objects;
drop policy if exists comites_arquivos_subir on storage.objects;
drop policy if exists comites_arquivos_apagar on storage.objects;
drop table if exists ops.comites;
drop function if exists ops.comites_antes_de_gravar();
delete from ops.area_chaves where permission_key = 'view.admin.comites';
delete from ops.role_permissions where permission_key = 'view.admin.comites';
commit;
