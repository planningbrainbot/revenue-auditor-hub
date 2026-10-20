-- Pipe 40: tarefa "pausada" (20/10/2026). A pausa de Belém (caso Arcanjo, 19/10) tirou do Pipedrive as tarefas abertas
-- dos cards e fixou uma nota "Pausado em …". A régua (monetizacao-diagnostico) passa a ler essa nota: enquanto ela
-- estiver fixada, o card não recebe tarefa e a linha da tarefa tirada fica "pausada"; quando a nota sai, a tarefa volta
-- ao Pipedrive e a linha volta a "aberta".
alter table ops.monetizacao_diagnostico_tarefas
  drop constraint if exists monetizacao_diagnostico_tarefas_status_check;
alter table ops.monetizacao_diagnostico_tarefas
  add constraint monetizacao_diagnostico_tarefas_status_check
  check (status in ('aberta', 'feita', 'apagada', 'pausada'));

comment on table ops.monetizacao_diagnostico_tarefas is
  'Tarefas que a régua do pipe 40 criou (monetizacao-diagnostico/regua.ts): uma linha por tarefa, por entrada do card '
  'numa etapa. entrou_em é o stage_change_time do Pipedrive como texto (a idempotência compara o texto exato). '
  'aberta: no Pipedrive, a fazer. feita: marcada como feita. apagada: o card saiu da etapa e a tarefa não feita saiu. '
  'pausada: o card tem nota fixada "Pausado em" e a atividade saiu do Pipedrive; volta quando a nota sair.';
