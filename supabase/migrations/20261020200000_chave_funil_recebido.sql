-- Chave própria para a página Venda ao Recebido (/unidades/funil-recebido).
--
-- A página nasceu em 20/10/2026 com a chave do Split do Asaas
-- (`view.royalties_split`), e não dava para liberá-la a alguém sem liberar o
-- Split junto. Pedido do usuário no mesmo dia: chave própria, que apareça em
-- Permissões para conceder pessoa a pessoa.
--
-- Mesma área e mesmo público de hoje: entra na área `receita` (admin, diretor,
-- head, auditor e financeiro pelo papel) e quem recebeu o Split pessoa a pessoa
-- recebe esta também. Ninguém que via a página deixa de ver.

begin;

insert into ops.area_chaves (area, permission_key)
values ('receita', 'view.funil_recebido')
on conflict do nothing;

-- Legado: role_permissions ainda é lido por telas antigas de permissão.
insert into ops.role_permissions (role, permission_key, allowed)
select role, 'view.funil_recebido', allowed
  from ops.role_permissions
 where permission_key = 'view.royalties_split'
on conflict do nothing;

insert into ops.usuario_chaves (user_id, permission_key, allowed, concedido_por)
select user_id, 'view.funil_recebido', allowed, concedido_por
  from ops.usuario_chaves
 where permission_key = 'view.royalties_split'
on conflict do nothing;

commit;
