begin;
-- Pedro autorizou explicitamente em 15/09: quem acessa o Aquário pode preparar e enviar.
-- O escopo da pessoa e a validação por conta/produto continuam obrigatórios.
delete from ops.area_chaves where permission_key in ('manage.aquario','send.monetizacao');
insert into ops.area_chaves(area,permission_key) values ('clientes','manage.aquario'),('clientes','send.monetizacao');
insert into ops.roles(key,label,description,is_system) values ('hunter_monetizacao','Monetização','Clientes e operação de monetização da base',false) on conflict(key) do nothing;
insert into ops.role_areas(role,area,allowed) values ('hunter_monetizacao','clientes',true),('hunter_monetizacao','monetizacao',true) on conflict(role,area) do update set allowed=excluded.allowed;
notify pgrst,'reload schema';
commit;
