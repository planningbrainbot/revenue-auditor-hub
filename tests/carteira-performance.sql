-- Run after the migration, inside a caller-owned transaction with ROLLBACK.
-- Only aggregates leave this test. No accounts, lists or deals are created.
create temp table performance_acceptance (check_name text,passed boolean,records integer,elapsed_ms numeric) on commit drop;
do $$
declare operator uuid; manifest jsonb; page jsonb; batch jsonb; keys text[]:='{}'; allowed_keys text[]; expected integer; actual integer; started timestamptz;
begin
 if has_function_privilege('anon','ops.base_carteira_manifesto()','execute') or has_function_privilege('anon','ops.base_carteira_pagina(text,text)','execute') then raise exception 'Acesso anônimo às RPCs';end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform ops.base_carteira_manifesto();raise exception 'Manifesto aceitou usuário anônimo';
 exception when raise_exception then if sqlerrm<>'Sem acesso à base de clientes' then raise;end if;end;
 begin
  perform ops.base_carteira_pagina();raise exception 'Página aceitou usuário anônimo';
 exception when raise_exception then if sqlerrm<>'Sem acesso à base de clientes' then raise;end if;end;
 insert into performance_acceptance values('anonymous_denied',true,0,0);

 for operator in
  select user_id from (select e.user_id,row_number() over(partition by e.todas_unidades order by e.user_id) rn from ops.usuario_escopo e join public.profiles p on p.user_id=e.user_id and p.ativo
  where ops.can_user(e.user_id,'view.clientes') and exists(select 1 from public.produto_acesso a where a.user_id=e.user_id and a.produto='ops')
  and (e.todas_unidades or exists(select 1 from ops.usuario_unidades u where u.user_id=e.user_id))
  ) candidates where rn=1
 loop
  perform set_config('request.jwt.claim.sub',operator::text,true);
  execute 'set local role authenticated';
  manifest:=ops.base_carteira_manifesto();
  select coalesce(array_agg(key),'{}') into allowed_keys from ops.monetizacao_contas;expected:=cardinality(allowed_keys);
  if (manifest->>'count')::integer<>expected then raise exception 'Manifesto ampliou ou reduziu escopo';end if;
  keys:='{}';started:=clock_timestamp();
  for page in select value from jsonb_array_elements(manifest->'pages') loop
   batch:=ops.base_carteira_pagina(page->>'after',page->>'through');
   if batch->>'catalog_at' is distinct from manifest->>'catalog_at' or batch->>'scope_signature' is distinct from manifest->>'scope_signature' then raise exception 'Revisão inconsistente';end if;
   if jsonb_array_length(batch->'rows')<>(page->>'count')::integer or jsonb_array_length(batch->'base')<>(page->>'count')::integer then raise exception 'Página incompleta';end if;
   if exists(select r->>'key' from jsonb_array_elements(batch->'rows') r except select unnest(allowed_keys)) then raise exception 'Página expôs conta fora do escopo';end if;
   if exists(select 1 from jsonb_array_elements(batch->'base') b where not exists(select 1 from jsonb_array_elements(batch->'rows') r where r->>'key'=b->>'key')) then raise exception 'Metadado expôs outra conta';end if;
   keys:=keys||array(select r->>'key' from jsonb_array_elements(batch->'rows') r);
  end loop;
  select count(distinct k) into actual from unnest(keys) k;
  if actual<>expected or cardinality(keys)<>actual then raise exception 'Conta duplicada ou omitida';end if;
  execute 'reset role';
  insert into performance_acceptance values(case when ops.monetizacao_scope('{}') then 'global_scope_and_pagination' else 'unit_scope_and_pagination' end,true,actual,extract(epoch from clock_timestamp()-started)*1000);
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
end $$;
select * from performance_acceptance;
