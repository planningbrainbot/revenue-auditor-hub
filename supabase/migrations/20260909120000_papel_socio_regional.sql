-- Renomeia o papel `socio_franqueado` para `socio_regional`.
--
-- "Franqueado" não faz parte do vocabulário da Planning: a rede é de unidades
-- regionais, e quem gerencia uma delas é sócio, não franqueado.
--
-- Seguro de aplicar: nenhuma policy de RLS e nenhuma função citam o papel pelo
-- nome (as policies vão por `public.can(permission_key)`), e o enum legado
-- `app_role` não é usado por coluna nenhuma — só pela função `has_role`.

-- 1) O papel novo precisa existir antes dos filhos migrarem: as FKs de
--    user_roles e role_permissions para roles.key são ON UPDATE NO ACTION.
insert into public.roles (key, label, description, is_system)
values (
  'socio_regional',
  'Sócio Regional',
  'Sócio Regional — gerencia uma unidade da rede e só enxerga os dados dessa unidade.',
  true
)
on conflict (key) do nothing;

-- 2) Permissões (22 linhas) e usuários (2) passam para o papel novo.
update public.role_permissions set role = 'socio_regional' where role = 'socio_franqueado';
update public.user_roles       set role = 'socio_regional' where role = 'socio_franqueado';

-- 3) O papel antigo sai só depois que nada mais aponta para ele.
delete from public.roles where key = 'socio_franqueado';

-- 4) Enum legado, mantido em sincronia por consistência.
alter type public.app_role rename value 'socio_franqueado' to 'socio_regional';
