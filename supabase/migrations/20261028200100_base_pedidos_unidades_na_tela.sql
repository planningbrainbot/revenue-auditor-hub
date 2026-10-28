-- Atualização da base pela unidade: as permissões levam as unidades regionais (para "é cliente de outra unidade")
-- e as unidades de quem pede (para escolher a unidade do cliente declarado).
create or replace function ops.base_pedido_permissoes()
 returns jsonb language sql stable security definer set search_path to 'ops', 'public'
as $$
 select jsonb_build_object('abrir', ops.base_pedido_pode_abrir(), 'decidir', ops.base_pedido_pode_decidir(),
   'ver_como', ops.ver_como_ativa(),
   'unidades', (select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'nome',u.nome_da_praca,
       'minha', ops.monetizacao_scope(array[u.id])) order by u.nome_da_praca),'[]')
     from ops.unidades u where u.tipo='regional' and auth.uid() is not null))
$$;
