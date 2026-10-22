-- Desfaz 20261022193000_tarefas_prazo_responsavel_obrigatorios.sql: prazo e responsável voltam a ser opcionais.
drop trigger if exists tarefas_exigir_prazo_responsavel on ops.tarefas;
drop function if exists ops.tarefas_exigir_prazo_responsavel();
