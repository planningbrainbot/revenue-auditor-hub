-- Desfaz 20261022200000_tarefas_anexos.sql. APAGA a lista de anexos. Os arquivos do bucket tarefas-anexos
-- ficam no Storage: apagar pela Storage API (o SQL não remove o arquivo físico) antes de remover o bucket.
drop table if exists ops.tarefas_anexos;
drop function if exists ops.tarefas_anexo_evento();
drop function if exists ops.tarefas_anexo_antes_de_gravar();
drop policy if exists tarefas_anexos_apagar on storage.objects;
drop policy if exists tarefas_anexos_subir on storage.objects;
drop policy if exists tarefas_anexos_ler on storage.objects;
drop function if exists ops.tarefas_quadro_do_caminho(text);
delete from ops.tarefas_eventos where campo = 'anexo';
