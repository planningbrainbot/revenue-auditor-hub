-- Rollback de 20260917100000_gestao_acessos_niveis.sql
-- Volta can_user, tem_area e as 6 políticas ao corpo anterior, e apaga as
-- tabelas e funções novas. APAGA as delegações feitas desde a aplicação: o log
-- vai junto. Exporte ops.acessos_log antes, se houver uso real.

drop policy if exists "Permission-based update" on ops.nps_envio_map;
create policy "Permission-based update" on ops.nps_envio_map for update to authenticated
  using (tem_produto('ops') and (select ops.can('view.disparos_whatsapp')))
  with check (tem_produto('ops') and (select ops.can('view.disparos_whatsapp')));
drop policy if exists "Permission-based update" on ops.nps_pesquisas;
create policy "Permission-based update" on ops.nps_pesquisas for update to authenticated
  using (tem_produto('ops') and (select ops.can('view.disparos_whatsapp')))
  with check (tem_produto('ops') and (select ops.can('view.disparos_whatsapp')));
drop policy if exists "Permission-based insert" on ops.nps_ligacoes;
create policy "Permission-based insert" on ops.nps_ligacoes for insert to authenticated
  with check (tem_produto('ops') and (select ops.can('view.disparos_whatsapp')));
drop policy if exists "nps_gravacoes upload" on storage.objects;
create policy "nps_gravacoes upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'nps-gravacoes' and tem_produto('ops') and ops.can('view.disparos_whatsapp'));
drop policy if exists gente_feedback_insert on ops.gente_feedback;
create policy gente_feedback_insert on ops.gente_feedback for insert to authenticated
  with check (ops.can('view.gente.feedback') and de_id = ops.minha_pessoa_id());
drop policy if exists gente_1a1_insert on ops.gente_um_a_um;
create policy gente_1a1_insert on ops.gente_um_a_um for insert to authenticated
  with check (ops.can('view.gente.um_a_um') and gestor_id = ops.minha_pessoa_id());

delete from ops.area_chaves where permission_key in ('edit.nps', 'edit.gente.conversas');

create or replace function ops.can_user(_user_id uuid, _key text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select case
    when _user_id is null then false
    when _key = 'data.scope.own_unit_only' then
      not coalesce(
        (select e.todas_unidades from ops.usuario_escopo e where e.user_id = _user_id),
        false
      )
    else exists (
      select 1
        from ops.user_roles ur
        join ops.role_areas  ra on ra.role = ur.role and ra.allowed
        join ops.area_chaves ac on ac.area = ra.area
        join ops.areas       a  on a.slug  = ra.area and a.ativa
       where ur.user_id = _user_id
         and ac.permission_key = _key
    )
  end
$function$;

create or replace function ops.tem_area(_area text)
returns boolean language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select exists (
    select 1
      from ops.user_roles ur
      join ops.role_areas ra on ra.role = ur.role and ra.allowed
      join ops.areas      a  on a.slug  = ra.area and a.ativa
     where ur.user_id = auth.uid()
       and ra.area = _area
  )
$function$;

drop function if exists ops.acesso_negar_pagina(uuid, text, boolean);
drop function if exists ops.acesso_definir_unidades(uuid, int[]);
drop function if exists ops.acesso_nomear(uuid, text, text);
drop function if exists ops.acesso_remover_da_area(uuid, text);
drop function if exists ops.acesso_definir_paginas(uuid, text, text[]);
drop function if exists ops.acesso_adicionar_na_area(uuid, text, int[], text[]);
drop function if exists ops._acesso_chaves_so_desta_area(uuid, text);
drop function if exists ops._acesso_validar_chaves(uuid, text, text[]);
drop function if exists ops._acesso_log(uuid, text, text, jsonb);
drop function if exists ops.acesso_do_usuario(uuid);

drop table if exists ops.area_perfil_chaves;
drop table if exists ops.area_perfis;
drop table if exists ops.usuario_chaves;
drop table if exists ops.usuario_areas;
drop table if exists ops.area_admins;
drop table if exists ops.acessos_log;

drop function if exists ops.pode_administrar(uuid, uuid, text);
drop function if exists ops.escopo_contido(uuid, uuid);
drop function if exists ops.nivel_na_area(uuid, text);
drop function if exists ops.eh_super_admin(uuid);
