create or replace function ops.base_pedido_permissoes()
 returns jsonb language sql stable security definer set search_path to 'ops', 'public'
as $$
 select jsonb_build_object('abrir', ops.base_pedido_pode_abrir(), 'decidir', ops.base_pedido_pode_decidir(),
   'ver_como', ops.ver_como_ativa())
$$;
