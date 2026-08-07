-- O botão "Forçar atualização" das telas Auditoria Interna, Tratativas e
-- Painel CS chama um server fn (auditoria-interna.functions.ts,
-- tratativas.functions.ts, painel-cs.functions.ts) que grava via cliente
-- autenticado como o usuário (SUPABASE_PUBLISHABLE_KEY + JWT), não via
-- service_role — diferente do cron (pg_cron → Edge Function com
-- service_role, que ignora RLS e por isso sempre funcionou a cada 15min).
-- As tabelas de destino só tinham policies de SELECT, então todo upsert/
-- delete manual era bloqueado pelo RLS e nunca completava — confirmado no
-- sync_log: 0 execuções com trigger "manual" em nenhuma das três, sempre
-- "cron". Mesmo padrão de bug já corrigido antes em contratos
-- (20260708180000_contratos_admin_update_policy.sql) e empresas
-- (20260728120000_empresas_admin_update_policy.sql).
--
-- sync_log também só tinha SELECT: sem policy de INSERT, o log final da
-- sincronização manual falharia mesmo depois da tabela principal ser
-- corrigida (erro no toast, apesar do dado já ter sido gravado).

create policy "Admins can write auditorias_internas"
  on public.auditorias_internas
  for insert
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can update auditorias_internas"
  on public.auditorias_internas
  for update
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can delete auditorias_internas"
  on public.auditorias_internas
  for delete
  using (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can write central_tratativas"
  on public.central_tratativas
  for insert
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can update central_tratativas"
  on public.central_tratativas
  for update
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can delete central_tratativas"
  on public.central_tratativas
  for delete
  using (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can write cs_onboarding_cards"
  on public.cs_onboarding_cards
  for insert
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can update cs_onboarding_cards"
  on public.cs_onboarding_cards
  for update
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can delete cs_onboarding_cards"
  on public.cs_onboarding_cards
  for delete
  using (has_role(auth.uid(), 'admin'::app_role));

create policy "Admins can insert sync_log"
  on public.sync_log
  for insert
  with check (has_role(auth.uid(), 'admin'::app_role));
