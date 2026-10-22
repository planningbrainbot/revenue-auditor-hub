-- Tarefas: prazo e responsável passam a ser obrigatórios (22/10/2026, pedido do dono, DECISIONS 22/10).
--
-- Vale no banco, não só na tela: nenhuma tarefa nasce sem prazo ou sem responsável, e ninguém apaga
-- o prazo nem tira o responsável de uma tarefa existente. Única exceção: quando o responsável sai do
-- quadro, ops.tarefas_membro_saiu deixa a tarefa sem responsável (o contrato manda assim) e ela fica
-- aguardando alguém assumir. Na hora em que isso roda, a pessoa já não é membro, e é isso que a regra
-- confere. As 5 tarefas que existiam nesta data já tinham os dois campos.
-- Não é NOT NULL na coluna justamente por causa dessa exceção.
-- Rollback: supabase/rollback/20261022193000_tarefas_prazo_responsavel_obrigatorios_rollback.sql

create or replace function ops.tarefas_exigir_prazo_responsavel()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.prazo is null then raise exception 'Toda tarefa precisa de prazo de entrega.'; end if;
    if new.responsavel_id is null then raise exception 'Toda tarefa precisa de responsável.'; end if;
    return new;
  end if;
  if new.prazo is null and old.prazo is not null then
    raise exception 'O prazo de entrega não pode ficar vazio.';
  end if;
  if new.responsavel_id is null and old.responsavel_id is not null
     and exists (select 1 from ops.tarefas_membros m
                  where m.quadro_id = old.quadro_id and m.user_id = old.responsavel_id) then
    raise exception 'A tarefa precisa de responsável.';
  end if;
  return new;
end
$$;

drop trigger if exists tarefas_exigir_prazo_responsavel on ops.tarefas;
create trigger tarefas_exigir_prazo_responsavel
  before insert or update of prazo, responsavel_id on ops.tarefas
  for each row execute function ops.tarefas_exigir_prazo_responsavel();

revoke all on function ops.tarefas_exigir_prazo_responsavel() from public, anon, authenticated;
