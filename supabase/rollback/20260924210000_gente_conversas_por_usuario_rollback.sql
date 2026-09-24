-- Volta à regra de 17/09: por usuário, só chave de consulta.
-- Antes de rodar, revogar as concessões que a exceção permitiu, senão a
-- constraint não volta.

update ops.usuario_chaves set allowed = false, atualizado_em = now()
 where permission_key = 'edit.gente.conversas' and allowed;

alter table ops.usuario_chaves drop constraint if exists usuario_chaves_usuario_so_consulta;
alter table ops.usuario_chaves add constraint usuario_chaves_usuario_so_consulta
  check (not allowed or permission_key like 'view.%');

create or replace function ops._acesso_validar_chaves(_ator uuid, _area text, _chaves text[])
returns void
language plpgsql
stable security definer
set search_path to 'ops', 'public'
as $function$
declare
  _k text;
begin
  foreach _k in array coalesce(_chaves, '{}') loop
    if not exists (select 1 from ops.area_chaves where area = _area and permission_key = _k) then
      raise exception 'A página % não pertence à área %.', _k, _area using errcode = '22023';
    end if;
    if _k not like 'view.%' then
      raise exception 'Usuário só consulta: % não pode ser liberada.', _k using errcode = '42501';
    end if;
    if not ops.can_user(_ator, _k) then
      raise exception 'Você não pode liberar % porque não tem essa página.', _k using errcode = '42501';
    end if;
  end loop;
end
$function$;
