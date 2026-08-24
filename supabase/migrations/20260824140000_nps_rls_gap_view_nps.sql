-- Fecha o mesmo gap de RLS já documentado em
-- 20260722180000_fix_rls_gap_permissoes_sem_dado.sql (ver [[feedback-rls-deve-seguir-role-permissions]]),
-- mas pras tabelas do NPS que ficaram de fora daquela rodada:
--
-- 1. nps_pesquisas: a página NPS virou standalone (permissão própria
--    `view.nps`) depois que aquela migration original rodou, mas a policy
--    "Permission-based read" continuou só com view.painel_cs/view.rede_realizado
--    — quem tinha só view.nps via /admin/permissoes via tela vazia.
-- 2. nps_envio_map e nps_mensagens_texto_livre: tabelas novas (criadas via
--    Management API em 18-24/08/2026 pro fluxo de disparo direto-Supabase),
--    nasceram com RLS ligado e ZERO policies de SELECT — ninguém além de
--    service_role conseguia ler, nem admin/diretor. Bug igual ao de
--    omie_clientes (ver [[project_omie_clientes_rls_sem_policy]]).
--
-- Aplicado em produção via Management API em 24/08/2026. Este arquivo só
-- documenta a mudança (sem CLI do Supabase linkado localmente).

alter policy "Permission-based read" on public.nps_pesquisas
  using (can('view.painel_cs') or can('view.rede_realizado') or can('view.nps'));

create policy "role_based_read" on public.nps_envio_map
  for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'diretor'::app_role));
create policy "Custom roles can read nps_envio_map" on public.nps_envio_map
  for select to authenticated
  using (is_custom_role(auth.uid()));
create policy "Auditors can read nps_envio_map" on public.nps_envio_map
  for select to authenticated
  using (has_role(auth.uid(), 'auditor'::app_role));
create policy "Permission-based read" on public.nps_envio_map
  for select to authenticated
  using (can('view.nps') or can('view.painel_cs'));

create policy "role_based_read" on public.nps_mensagens_texto_livre
  for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'diretor'::app_role));
create policy "Custom roles can read nps_mensagens_texto_livre" on public.nps_mensagens_texto_livre
  for select to authenticated
  using (is_custom_role(auth.uid()));
create policy "Auditors can read nps_mensagens_texto_livre" on public.nps_mensagens_texto_livre
  for select to authenticated
  using (has_role(auth.uid(), 'auditor'::app_role));
create policy "Permission-based read" on public.nps_mensagens_texto_livre
  for select to authenticated
  using (can('view.nps') or can('view.painel_cs'));
