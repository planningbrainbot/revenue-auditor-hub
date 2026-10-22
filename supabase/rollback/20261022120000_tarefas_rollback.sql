-- Desfaz 20261022120000_tarefas.sql. APAGA todos os quadros, tarefas e comentários.
drop function if exists ops.tarefas_apagar_coluna(uuid, uuid);
drop function if exists ops.tarefas_remover_membro(uuid, uuid);
drop function if exists ops.tarefas_mudar_papel(uuid, uuid, text);
drop function if exists ops.tarefas_convidar(uuid, uuid);
drop function if exists ops.tarefas_buscar_pessoas(uuid, text);
drop function if exists ops.tarefas_criar_quadro(text, text);
drop table if exists ops.tarefas_eventos, ops.tarefas_comentarios, ops.tarefas,
  ops.tarefas_departamentos, ops.tarefas_projetos, ops.tarefas_colunas, ops.tarefas_membros,
  ops.tarefas_quadros cascade;
drop function if exists ops.tarefas_membro_saiu();
drop function if exists ops.tarefas_registrar_evento();
drop function if exists ops.tarefas_antes_de_gravar();
drop function if exists ops.tarefas_eh_dono(uuid);
drop function if exists ops.tarefas_eh_membro(uuid);
drop function if exists ops.tarefas_pode_usar(uuid);
delete from ops.usuario_areas where area = 'tarefas';
delete from ops.role_areas where area = 'tarefas';
delete from ops.areas where slug = 'tarefas';
