-- Split das páginas de NPS em 3 concerns separados: Disparos de WhatsApp
-- (estrutura genérica de disparo, não só NPS), Base de Contatos (completude
-- de contato) e NPS/Análise de Satisfação (resultado de pesquisa). Cada
-- página nova nasce com permissão própria (ver [[feedback_new_page_permissions]]);
-- esta migration deixa o RLS das tabelas por trás delas alinhado desde o
-- início (ver [[feedback_rls_deve_seguir_role_permissions]] — não repetir o
-- gap de nascer sem policy).
--
-- Aplicado em produção via Management API em 24/08/2026.

alter policy "Permission-based read" on public.empresas
  using (can('view.clientes') or can('view.painel_cs') or can('view.base_contatos'));

alter policy "Permission-based read" on public.contatos
  using (can('view.contatos') or can('view.base_contatos'));

alter policy "Permission-based read" on public.unidades
  using (can('view.clientes') or can('view.base_contatos') or can('view.disparos_whatsapp'));

alter policy "Permission-based read" on public.nps_envio_map
  using (can('view.disparos_whatsapp') or can('view.nps') or can('view.painel_cs'));

alter policy "Permission-based read" on public.nps_mensagens_texto_livre
  using (can('view.disparos_whatsapp') or can('view.nps') or can('view.painel_cs'));

alter policy "Permission-based read" on public.nps_pesquisas
  using (can('view.painel_cs') or can('view.rede_realizado') or can('view.nps') or can('view.disparos_whatsapp'));
