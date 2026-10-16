-- Desfaz 20261016100000_gente_vigencia_contrato. Apaga as datas de vigência gravadas
-- e o registro de avisos. O gatilho de histórico volta à versão sem as duas datas.
begin;
drop function if exists ops.gente_vigencia_registrar_avisos(jsonb);
drop function if exists ops.gente_vigencias_a_avisar();
drop table if exists ops.gente_vigencia_avisos;

create or replace function ops.gente_pessoas_registrar_historico()
 returns trigger language plpgsql security definer set search_path to 'ops', 'public'
as $function$
declare
  _quem   uuid := auth.uid();
  _origem text := nullif(current_setting('ops.historico_origem', true), '');
begin
  if tg_op = 'INSERT' then
    insert into ops.gente_pessoas_historico (pessoa_id, campo, antes, depois, alterado_por, origem)
    values (new.id, 'cadastro', null, coalesce(new.origem, 'manual'), _quem, _origem);
    return new;
  end if;
  insert into ops.gente_pessoas_historico (pessoa_id, campo, antes, depois, alterado_por, origem)
  select new.id, c.campo, c.antes, c.depois, _quem, _origem
    from (values
      ('nome_completo',     old.nome_completo,           new.nome_completo),
      ('email',             old.email,                   new.email),
      ('cargo',             old.cargo,                   new.cargo),
      ('departamento',      old.departamento,            new.departamento),
      ('gestor_id',         old.gestor_id::text,         new.gestor_id::text),
      ('tipo_vinculo',      old.tipo_vinculo,            new.tipo_vinculo),
      ('data_admissao',     old.data_admissao::text,     new.data_admissao::text),
      ('data_nascimento',   old.data_nascimento::text,   new.data_nascimento::text),
      ('cnpj_empregador',   old.cnpj_empregador,         new.cnpj_empregador),
      ('unidade_id',        old.unidade_id::text,        new.unidade_id::text),
      ('status',            old.status,                  new.status),
      ('data_desligamento', old.data_desligamento::text, new.data_desligamento::text)
    ) as c(campo, antes, depois)
   where c.antes is distinct from c.depois;
  return new;
end $function$;
revoke execute on function ops.gente_pessoas_registrar_historico() from public, anon;

alter table ops.gente_pessoas drop constraint if exists gente_pessoas_vigencia_ordem;
alter table ops.gente_pessoas drop column if exists vigencia_fim, drop column if exists vigencia_inicio;
commit;
