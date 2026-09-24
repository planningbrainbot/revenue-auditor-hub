-- Exceção à regra "usuário só consulta" (17/09/2026) para UMA chave:
-- `edit.gente.conversas`, que deixa a pessoa registrar 1:1 e feedback.
--
-- Decisão do usuário em 24/09/2026, ao ligar o cadastro do Planning People ao
-- login: sem ela o colaborador entra no módulo e não registra a própria
-- conversa. A chave não abre dado de ninguém: as policies de escrita já
-- recortam em `gestor_id = minha_pessoa_id()` (1:1) e
-- `de_id = minha_pessoa_id()` (feedback). Qualquer outra chave de operação
-- continua proibida por usuário.
--
-- Rollback: supabase/rollback/20260924210000_gente_conversas_por_usuario_rollback.sql

alter table ops.usuario_chaves drop constraint if exists usuario_chaves_usuario_so_consulta;
alter table ops.usuario_chaves add constraint usuario_chaves_usuario_so_consulta
  check (not allowed or permission_key like 'view.%' or permission_key = 'edit.gente.conversas');

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
    if _k not like 'view.%' and _k <> 'edit.gente.conversas' then
      raise exception 'Usuário só consulta: % não pode ser liberada.', _k using errcode = '42501';
    end if;
    if not ops.can_user(_ator, _k) then
      raise exception 'Você não pode liberar % porque não tem essa página.', _k using errcode = '42501';
    end if;
  end loop;
end
$function$;
