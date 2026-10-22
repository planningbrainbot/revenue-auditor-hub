-- Desfaz 20261022190000_tarefas_notificacoes.sql. APAGA as notificações por pessoa (as coletivas ficam).
select cron.unschedule('tarefas-prazo-hoje') where exists (select 1 from cron.job where jobname = 'tarefas-prazo-hoje');
drop trigger if exists tarefas_notificar_comentario on ops.tarefas_comentarios;
drop trigger if exists tarefas_notificar_atribuicao on ops.tarefas;
drop function if exists ops.tarefas_notificar_prazo_hoje();
drop function if exists ops.tarefas_notificar_comentario();
drop function if exists ops.tarefas_notificar_atribuicao();
drop function if exists ops.tarefas_nome(uuid);
drop function if exists ops.tarefas_notificar(uuid, uuid, text, text, text, uuid, uuid, text);

delete from ops.notificacoes where destinatario_id is not null;

drop policy if exists notificacoes_marcar on ops.notificacoes;
drop policy if exists notificacoes_ler on ops.notificacoes;
grant insert, delete, update on ops.notificacoes to authenticated;
create policy "Admins manage notificacoes" on ops.notificacoes for all to authenticated
  using (public.tem_produto('ops') and (select ops.has_role(auth.uid(), 'admin'::ops.app_role)))
  with check (public.tem_produto('ops') and (select ops.has_role(auth.uid(), 'admin'::ops.app_role)));
create policy "Diretores can read notificacoes" on ops.notificacoes for select to authenticated
  using (public.tem_produto('ops') and (select ops.has_role(auth.uid(), 'diretor'::ops.app_role)));

drop index if exists ops.idx_notificacoes_destinatario;
drop index if exists ops.uq_notificacoes_chave;
alter table ops.notificacoes
  drop column if exists chave,
  drop column if exists link,
  drop column if exists ator_id,
  drop column if exists destinatario_id;
