-- Testes transacionais: nenhum usuário, lista ou envio sobrevive ao ROLLBACK.
begin;
select set_config('test.monet.admin',(select u.user_id::text from ops.user_roles u join public.profiles p on p.user_id=u.user_id join ops.usuario_escopo e on e.user_id=u.user_id where u.role='admin' and p.ativo and e.todas_unidades limit 1),true);
select set_config('test.monet.scope_user',gen_random_uuid()::text,true);
insert into auth.users(id) values(current_setting('test.monet.scope_user')::uuid);
insert into public.profiles(user_id,nome,email,ativo) values(current_setting('test.monet.scope_user')::uuid,'Teste transacional Aquário','rollback-aquario@example.invalid',true);
insert into public.produto_acesso(user_id,produto) values(current_setting('test.monet.scope_user')::uuid,'ops');
insert into ops.user_roles(user_id,role) values(current_setting('test.monet.scope_user')::uuid,'cs');
insert into ops.usuario_escopo(user_id,todas_unidades,todas_empresas) values(current_setting('test.monet.scope_user')::uuid,false,false);
insert into ops.usuario_unidades(user_id,unidade_id) values(current_setting('test.monet.scope_user')::uuid,3);

select set_config('test.monet.ready','rollback-direct-'||gen_random_uuid()::text,true);
insert into ops.monetizacao_contas(key,perfil,unidade_ids,source_at)
values(current_setting('test.monet.ready'), jsonb_build_object('key',current_setting('test.monet.ready'),'name','Conta sintética — rollback','band','R$ 10 milhões até R$ 25 milhões','regime','Lucro Presumido','pipedrive_contract',true,'new_commercial',true),array[3],now());

set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.monet.scope_user'),'role','authenticated')::text,true);
do $$ begin
 if not ops.monetizacao_can('view.aquario') then raise exception 'FAIL: acesso por área'; end if;
 if not ops.monetizacao_can('manage.aquario') then raise exception 'FAIL: área Clientes deve permitir preparar listas'; end if;
 if not ops.monetizacao_can('send.monetizacao') then raise exception 'FAIL: área Clientes deve permitir enviar seleção direta'; end if;
 if exists(select 1 from ops.monetizacao_contas where not (3=any(unidade_ids))) then raise exception 'FAIL: conta fora da unidade'; end if;
 if exists(select 1 from ops.monetizacao_base_origins() o join ops.monetizacao_contas a on a.key=o.account_key where not (3=any(a.unidade_ids))) then raise exception 'FAIL: origem fora do escopo'; end if;
 if (select count(*) from ops.monetizacao_contas)=0 then raise exception 'FAIL: escopo escondeu carteira autorizada'; end if;
 if exists(select 1 from ops.monetizacao_planos) then raise exception 'FAIL: plano geral exposto a escopo de unidade'; end if;
end $$;

do $$
declare a ops.monetizacao_contas; lid uuid; doc jsonb; denied boolean:=false;
begin
 select * into a from ops.monetizacao_contas limit 1;
 doc:=jsonb_build_object('nome','Lista de unidade — rollback','unidade_id',3,'owner_id',28381245,'mode','draft','items',jsonb_build_array(jsonb_build_object('account_key',a.key,'product','consultoria','review','{}'::jsonb)));
 lid:=ops.monetizacao_save_list(doc);
 begin perform ops.monetizacao_claim((select id from ops.monetizacao_itens where list_id=lid limit 1)); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: perfil de Consultoria não comprovado foi aceito'; end if;
 denied:=false;
 begin perform ops.monetizacao_save_list(doc||jsonb_build_object('unidade_id',null)); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: usuário de unidade criou lista global'; end if;
 denied:=false;
 begin perform ops.monetizacao_save_list(doc||jsonb_build_object('unidade_id',1)); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: usuário de unidade criou lista fora de seu escopo'; end if;
end $$;

select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.monet.admin'),'role','authenticated')::text,true);
do $$
declare a ops.monetizacao_contas; lid uuid; l2 uuid; doc jsonb; claim jsonb; denied boolean:=false;
begin
 if not ops.monetizacao_can('send.monetizacao') then raise exception 'FAIL: admin não acessa envio'; end if;
 select * into a from ops.monetizacao_contas where key=current_setting('test.monet.ready');
 if a.key is null then raise exception 'FAIL: sem amostra elegível para validar contrato'; end if;
 doc:=jsonb_build_object('nome','Teste técnico — rollback','unidade_id',null,'owner_id',28381245,'partner','','origin_confirmed',false,'mode','draft','items',jsonb_build_array(jsonb_build_object('account_key',a.key,'product','finance','review','{}'::jsonb)));
 lid:=ops.monetizacao_save_list(doc);
 begin perform ops.monetizacao_save_list(doc||jsonb_build_object('id',lid,'revision',99)); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: revisão obsoleta foi aceita'; end if;
 denied:=false;
 begin perform ops.monetizacao_save_list(doc||jsonb_build_object('id',lid)); exception when others then denied:=true; end;
 if not denied then raise exception 'FAIL: revisão omitida foi aceita'; end if;
 -- Uma lista em rascunho com perfil apto deve enviar, sem aprovação do sócio.
 if (select validated_at is not null from ops.monetizacao_listas where id=lid) then raise exception 'FAIL: validação fictícia criada'; end if;
 claim:=ops.monetizacao_claim((select id from ops.monetizacao_itens where list_id=lid limit 1));
 if not (claim->>'claimed')::boolean then raise exception 'FAIL: primeira reserva não criada'; end if;
 if (ops.monetizacao_claim((select id from ops.monetizacao_itens where list_id=lid limit 1))->>'claimed')::boolean then raise exception 'FAIL: repetição criou segunda reserva'; end if;
 l2:=ops.monetizacao_save_list(doc);
 if (ops.monetizacao_claim((select id from ops.monetizacao_itens where list_id=l2 limit 1))->>'claimed')::boolean then raise exception 'FAIL: segunda lista duplicou empresa/produto'; end if;
 if (select count(*) from ops.monetizacao_envios where account_key=a.key and product='finance' and status='sending')<>1 then raise exception 'FAIL: índice de exclusão falhou'; end if;
 -- Um usuário autenticado não pode fabricar o resultado de um envio remoto.
 if has_function_privilege('authenticated','ops.monetizacao_finish(uuid,text,bigint,bigint,text)','execute') then raise exception 'FAIL: confirmação de envio exposta ao cliente'; end if;
end $$;

select set_config('request.jwt.claims','{}',true);
do $$ begin
 if ops.monetizacao_can('view.aquario') then raise exception 'FAIL: acesso sem identidade'; end if;
 if exists(select 1 from ops.monetizacao_contas) then raise exception 'FAIL: contas expostas sem identidade'; end if;
 if exists(select 1 from ops.monetizacao_base_origins()) then raise exception 'FAIL: origens expostas sem identidade'; end if;
 if exists(select 1 from ops.monetizacao_detalhes) then raise exception 'FAIL: detalhes expostos sem identidade'; end if;
 if exists(select 1 from ops.monetizacao_itens) then raise exception 'FAIL: listas expostas sem identidade'; end if;
end $$;
reset role;
select 'PASS: area, unit scope, anonymous denial, optimistic revision, direct send, profile rules and duplicate reservation' as result;
rollback;
