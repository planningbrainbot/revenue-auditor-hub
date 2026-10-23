-- Reversão de 20261023120000_comissoes_base.sql (Comissões do time comercial).
-- Apaga a área nova e devolve a chave view.comissoes à área `receita`, como estava antes.
-- ATENÇÃO: apaga as linhas, ajustes, bônus e eventos de comissão gravados desde a migration.

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as assinatura from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'ops' and p.proname like 'comissoes\_%' loop
    execute format('drop function %s', f.assinatura);
  end loop;
end $$;

drop schema if exists comissoes cascade;

delete from ops.usuario_areas where area in ('comissoes', 'comissoes_revisao', 'comissoes_fechamento');
delete from ops.area_admins where area in ('comissoes', 'comissoes_revisao', 'comissoes_fechamento');
delete from ops.area_chaves where area in ('comissoes', 'comissoes_revisao', 'comissoes_fechamento');
delete from ops.areas where slug in ('comissoes', 'comissoes_revisao', 'comissoes_fechamento');
insert into ops.area_chaves (area, permission_key) values ('receita', 'view.comissoes') on conflict do nothing;

do $$ begin
  if to_regclass('seguranca.schemas_fechados') is not null then
    delete from seguranca.schemas_fechados where nome = 'comissoes';
  end if;
end $$;
