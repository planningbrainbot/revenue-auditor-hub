-- Identidade e contas sintéticas; todos os registros são revertidos.
begin;
select set_config('test.driva.user',gen_random_uuid()::text,true);
select set_config('test.driva.inside','driva-test-'||gen_random_uuid()::text,true);
select set_config('test.driva.outside','driva-test-'||gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.driva.user')::uuid);
insert into public.profiles(user_id,nome,email,ativo) values(current_setting('test.driva.user')::uuid,'Teste Driva','driva-rollback@example.invalid',true);
insert into public.produto_acesso(user_id,produto) values(current_setting('test.driva.user')::uuid,'ops');
insert into ops.user_roles(user_id,role) values(current_setting('test.driva.user')::uuid,'cs');
insert into ops.usuario_escopo(user_id,todas_unidades,todas_empresas) values(current_setting('test.driva.user')::uuid,false,false);
insert into ops.usuario_unidades(user_id,unidade_id) values(current_setting('test.driva.user')::uuid,3);
insert into ops.monetizacao_contas(key,perfil,unidade_ids,source_at) values
 (current_setting('test.driva.inside'),'{}',array[3],now()),
 (current_setting('test.driva.outside'),'{}',array[4],now());
insert into ops.monetizacao_detalhes(account_key,detalhe) values
 (current_setting('test.driva.inside'),'{"driva":{"records":[{"status":"enriched","non_simples":true}]}}'),
 (current_setting('test.driva.outside'),'{"driva":{"records":[{"status":"enriched","non_simples":true}]}}');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.driva.user'),'role','authenticated')::text,true);
do $$ declare denied boolean:=false; d jsonb; begin
 d:=ops.monetizacao_detail(current_setting('test.driva.inside'));
 if d->'driva'->'records'->0->>'non_simples'<>'true' then raise exception 'FAIL Driva não retornou evidência da carteira permitida'; end if;
 begin perform ops.monetizacao_detail(current_setting('test.driva.outside')); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL Driva exposta fora do escopo'; end if;
 if has_function_privilege('anon','ops.monetizacao_detail(text)','EXECUTE') then raise exception 'FAIL acesso anônimo'; end if;
end $$;
reset role;
select 'PASS: evidência Driva respeita escopo da carteira e bloqueio anônimo' as result;
rollback;
