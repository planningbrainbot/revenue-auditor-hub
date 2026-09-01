-- Bug: "Registrar resposta colhida por telefone" (nps-execucao-tab) mostrava
-- toast de sucesso mas ao reabrir a empresa o formulário voltava em branco —
-- nada tinha sido salvo de verdade. Causa: nps_pesquisas e nps_envio_map só
-- tinham policy de SELECT ("Permission-based read"); RLS bloqueava o UPDATE
-- silenciosamente (sem policy = 0 linhas afetadas, sem erro no PostgREST),
-- então o toast de sucesso mentia. Mesmo gap do
-- [[feedback_rls_deve_seguir_role_permissions]] e
-- [[feedback_supabase_insert_returning_rls]], agora achado em UPDATE.
--
-- Gate: mesma permissão que a rota já checa em código
-- (assertCanDispararCampanha -> can('view.disparos_whatsapp')).

create policy "Permission-based update" on public.nps_pesquisas
  for update
  using (can('view.disparos_whatsapp'))
  with check (can('view.disparos_whatsapp'));

create policy "Permission-based update" on public.nps_envio_map
  for update
  using (can('view.disparos_whatsapp'))
  with check (can('view.disparos_whatsapp'));
