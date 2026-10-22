-- Desfaz 20261022120000_base_vendas_so_clientes.sql, com o estado de 22/10/2026 antes dela.
begin;

delete from ops.usuario_chaves where permission_key = 'view.clientes_painel';
delete from ops.role_permissions where permission_key = 'view.clientes_painel';
delete from ops.area_chaves where permission_key = 'view.clientes_painel';

-- Os 13 que já usavam a Base tinham view.base_contatos, concedida pelo mesmo admin.
insert into ops.usuario_chaves (user_id, permission_key, allowed, concedido_por)
select p.user_id, 'view.base_contatos', true, '2db5f584-06ee-4b0d-8034-24558201f8f9'::uuid
  from ops.profiles p
 where lower(p.email) = any (array[
   'amanda.gusmao@planning.com.br', 'anna.alencar@planning.com.br', 'brenda.patury@planning.com.br',
   'bruno.subires@planning.com.br', 'daniele.andrade@planning.com.br', 'gabriella.oliveira@planning.com.br',
   'gabryelly.morais@planning.com.br', 'igor.jardim@planning.com.br', 'isabella.mehedin@planning.com.br',
   'mario.costa@planning.com.br', 'rayssa.silva@planning.com.br', 'sarah.ferreira@planning.com.br',
   'thais.gerlach@planning.com.br'])
on conflict do nothing;

-- Igor Kravchenko e Rayssa não viam todas as unidades.
update ops.usuario_escopo e set todas_unidades = false, updated_at = now()
  from ops.profiles p
 where p.user_id = e.user_id and lower(p.email) in ('igor.jardim@planning.com.br', 'rayssa.silva@planning.com.br');

-- Amanda Lourenço e Lucas Cintra não tinham o Brain: sem porta, área, chaves nem escopo.
delete from ops.usuario_chaves uc using ops.profiles p
 where p.user_id = uc.user_id and lower(p.email) in ('amanda.lourenco@planning.com.br', 'lucas.cintra@planning.com.br');
delete from ops.usuario_areas ua using ops.profiles p
 where p.user_id = ua.user_id and ua.area = 'clientes'
   and lower(p.email) in ('amanda.lourenco@planning.com.br', 'lucas.cintra@planning.com.br');
delete from ops.usuario_escopo e using ops.profiles p
 where p.user_id = e.user_id and lower(p.email) in ('amanda.lourenco@planning.com.br', 'lucas.cintra@planning.com.br');
delete from public.produto_acesso a using ops.profiles p
 where p.user_id = a.user_id and a.produto = 'ops'
   and lower(p.email) in ('amanda.lourenco@planning.com.br', 'lucas.cintra@planning.com.br');

commit;
