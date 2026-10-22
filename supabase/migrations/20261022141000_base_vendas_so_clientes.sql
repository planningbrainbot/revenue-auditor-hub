-- O time de vendas vê só a tela Clientes da Base (Pedro, 22/10/2026: "todos do time de vendas tenham acesso à base
-- de clientes, mas somente à tela de clientes. Não ao resto").
--
-- Confiança, Painel e Contratos e churn passam a pedir a chave `view.clientes_painel`. Ela entra nas áreas `clientes`
-- e `minha_unidade` (quem tem a área pelo papel continua vendo tudo) e é dada pessoa a pessoa a quem já tinha
-- `view.clientes`, menos o time de vendas. Ninguém de fora do time de vendas deixa de ver o que via.
--
-- Time de vendas = os 17 do Inside Sales no Pipedrive (resposta do Pedro em 22/10). Ana Nasareth e Fleuri Ferreira
-- ainda não têm conta no Brain: entram quando forem convidados, com a área Base de clientes e as chaves abaixo.
-- Por pessoa, e não por papel: papel que não é de sistema lê contratos, empresas e tratativas pela RLS
-- (`ops.is_custom_role`), e isso daria o MRR ao vendedor.
--
-- Para cada vendedor com conta:
--   * a porta do Brain (`produto_acesso` ops), a área `clientes` e as chaves view.clientes, view.contatos e
--     view.aquario (as que os 13 que já usavam a Base têm; o aquário traz os negócios para a ficha);
--   * sai `view.base_contatos`, que abre a tela /base-contatos, fora da Clientes;
--   * todas as unidades (`usuario_escopo.todas_unidades`), resposta do Pedro em 22/10.
-- Desfazer: supabase/rollback/20261022141000_base_vendas_so_clientes_rollback.sql.

begin;

create temporary table vendas on commit drop as
select p.user_id
  from ops.profiles p
 where lower(p.email) = any (array[
   'amanda.gusmao@planning.com.br',
   'amanda.lourenco@planning.com.br',
   'ana.nasareth@planning.com.br',
   'anna.alencar@planning.com.br',
   'brenda.patury@planning.com.br',
   'bruno.subires@planning.com.br',
   'daniele.andrade@planning.com.br',
   'fleuri.ferreira@planning.com.br',
   'gabriella.oliveira@planning.com.br',
   'gabryelly.morais@planning.com.br',
   'igor.jardim@planning.com.br',
   'isabella.mehedin@planning.com.br',
   'lucas.cintra@planning.com.br',
   'mario.costa@planning.com.br',
   'rayssa.silva@planning.com.br',
   'sarah.ferreira@planning.com.br',
   'thais.gerlach@planning.com.br'
 ]);

create temporary table quem_concede on commit drop as
select user_id from ops.profiles where lower(email) = 'pedro.luca@planning.com.br';

-- 1. A chave nova, nas duas áreas que abrem a Base inteira.
insert into ops.area_chaves (area, permission_key)
values ('clientes', 'view.clientes_painel'), ('minha_unidade', 'view.clientes_painel')
on conflict do nothing;

-- Legado: role_permissions ainda é lido por telas antigas de permissão.
insert into ops.role_permissions (role, permission_key, allowed)
select role, 'view.clientes_painel', allowed
  from ops.role_permissions
 where permission_key = 'view.clientes'
on conflict do nothing;

-- 2. Quem tinha view.clientes pessoa a pessoa ganha a chave nova, menos o time de vendas.
insert into ops.usuario_chaves (user_id, permission_key, allowed, concedido_por)
select uc.user_id, 'view.clientes_painel', uc.allowed, uc.concedido_por
  from ops.usuario_chaves uc
 where uc.permission_key = 'view.clientes'
   and uc.user_id not in (select user_id from vendas)
on conflict do nothing;

-- 3. O time de vendas: porta, área, chaves da tela Clientes e todas as unidades.
insert into public.produto_acesso (user_id, produto, concedido_por)
select v.user_id, 'ops', (select user_id from quem_concede) from vendas v
on conflict do nothing;

insert into ops.usuario_areas (user_id, area, allowed, concedido_por)
select v.user_id, 'clientes', true, (select user_id from quem_concede) from vendas v
on conflict (user_id, area) do update set allowed = true;

insert into ops.usuario_chaves (user_id, permission_key, allowed, concedido_por)
select v.user_id, k.chave, true, (select user_id from quem_concede)
  from vendas v
 cross join (values ('view.clientes'), ('view.contatos'), ('view.aquario')) as k(chave)
on conflict (user_id, permission_key) do update set allowed = true;

delete from ops.usuario_chaves
 where permission_key in ('view.base_contatos', 'view.clientes_painel')
   and user_id in (select user_id from vendas);

insert into ops.usuario_escopo (user_id, todas_unidades, todas_empresas)
select v.user_id, true, false from vendas v
on conflict (user_id) do update set todas_unidades = true, updated_at = now();

commit;
