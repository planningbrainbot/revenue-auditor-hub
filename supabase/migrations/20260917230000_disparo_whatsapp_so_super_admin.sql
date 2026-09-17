-- A tela de disparo de WhatsApp fica bloqueada (pedido do dono em
-- 17/09/2026). Disparo custa dinheiro por conversa e fala com o cliente em
-- nome da rede; com o admin de área ganhando a área Clientes inteira, ele
-- herdaria o disparo junto.
--
-- Área própria, pelo mesmo motivo do broker_matriz: a página continua no menu
-- de Clientes, mas quem concede é `disparos_whatsapp`, que só o perfil Super
-- admin recebe. A chave nova `send.whatsapp` guarda a página e as duas ações
-- que enviam mensagem (disparo em massa e reenvio individual).
--
-- `view.disparos_whatsapp` NÃO muda: a RLS de nps_ligacoes e dos custos lê
-- por ela, e o time de CS continua registrando ligação de NPS.

insert into ops.areas (slug, nome, descricao, escopo, ordem) values
  ('disparos_whatsapp', 'Disparos de WhatsApp',
   'Disparo em massa e reenvio de mensagens pelo WhatsApp. Custa por conversa.',
   'nenhum', 25)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem;

insert into ops.area_chaves (area, permission_key) values
  ('disparos_whatsapp', 'send.whatsapp')
on conflict do nothing;

insert into ops.role_areas (role, area, allowed) values
  ('admin', 'disparos_whatsapp', true)
on conflict (role, area) do update set allowed = true, updated_at = now();
