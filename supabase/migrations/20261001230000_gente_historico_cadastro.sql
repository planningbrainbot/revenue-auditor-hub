-- Histórico do cadastro de gente (01/10/2026, pedido do RH de Maceió: "na
-- planilha não fica o histórico, eu altero e perco o anterior"). Até aqui o
-- Editar sobrescrevia cargo, setor e gestor sem guardar o que era.
--
-- Um trigger grava cada mudança dos campos que importam para a vida da pessoa
-- na unidade, com quem mudou e o valor de antes. Salário não está aqui: vai
-- para as movimentações, com chave própria (a decidir).
--
-- A tabela aponta para gente_pessoas, e `gente_excluir_cadastro` recusa
-- excluir quem tem qualquer linha apontando para si. O histórico é a exceção
-- (registro do próprio cadastro, não da vida da pessoa no People), senão o
-- cadastro duplicado por engano nunca mais poderia ser excluído.

begin;

create table if not exists ops.gente_pessoas_historico (
  id          bigint generated always as identity primary key,
  pessoa_id   bigint not null references ops.gente_pessoas(id) on delete cascade,
  campo       text not null,
  antes       text,
  depois      text,
  alterado_por uuid,
  alterado_em timestamptz not null default now()
);
create index if not exists gente_pessoas_historico_pessoa
  on ops.gente_pessoas_historico (pessoa_id, alterado_em desc);

alter table ops.gente_pessoas_historico enable row level security;
revoke insert, update, delete on ops.gente_pessoas_historico from authenticated, anon;
grant select on ops.gente_pessoas_historico to authenticated;

-- Leitura: quem lê o cadastro individual. Escrita: só o trigger.
drop policy if exists gente_hist_select on ops.gente_pessoas_historico;
create policy gente_hist_select on ops.gente_pessoas_historico
  for select to authenticated
  using (ops.can('manage.gente') or ops.can('view.gente.individual'));

drop policy if exists gente_hist_escopo_unidade on ops.gente_pessoas_historico;
create policy gente_hist_escopo_unidade on ops.gente_pessoas_historico
  as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));

create or replace function ops.gente_pessoas_registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  _quem uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into ops.gente_pessoas_historico (pessoa_id, campo, antes, depois, alterado_por)
    values (new.id, 'cadastro', null, coalesce(new.origem, 'manual'), _quem);
    return new;
  end if;

  insert into ops.gente_pessoas_historico (pessoa_id, campo, antes, depois, alterado_por)
  select new.id, c.campo, c.antes, c.depois, _quem
    from (values
      ('nome_completo',     old.nome_completo,          new.nome_completo),
      ('email',             old.email,                  new.email),
      ('cargo',             old.cargo,                  new.cargo),
      ('departamento',      old.departamento,           new.departamento),
      ('gestor_id',         old.gestor_id::text,        new.gestor_id::text),
      ('tipo_vinculo',      old.tipo_vinculo,           new.tipo_vinculo),
      ('data_admissao',     old.data_admissao::text,    new.data_admissao::text),
      ('unidade_id',        old.unidade_id::text,       new.unidade_id::text),
      ('status',            old.status,                 new.status),
      ('data_desligamento', old.data_desligamento::text, new.data_desligamento::text)
    ) as c(campo, antes, depois)
   where c.antes is distinct from c.depois;
  return new;
end $$;

drop trigger if exists gente_pessoas_historico on ops.gente_pessoas;
create trigger gente_pessoas_historico
  after insert or update on ops.gente_pessoas
  for each row execute function ops.gente_pessoas_registrar_historico();

-- Exclusão de duplicado: o histórico do próprio cadastro não conta como vida
-- da pessoa no People.
create or replace function ops.gente_excluir_cadastro(_pessoa bigint)
returns void
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  r       record;
  v_n     bigint;
  v_onde  text[] := '{}';
  v_linha ops.gente_pessoas%rowtype;
begin
  perform ops._gente_pode_gerir(_pessoa);
  select * into v_linha from ops.gente_pessoas where id = _pessoa;
  if v_linha.user_id is not null then
    raise exception 'Esta pessoa tem login no Brain. Use Desligar.' using errcode = '23503';
  end if;

  for r in
    select c.conrelid::regclass as tabela, a.attname as coluna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
     where c.contype = 'f' and c.confrelid = 'ops.gente_pessoas'::regclass
       and c.conrelid <> 'ops.gente_pessoas_historico'::regclass
  loop
    execute format('select count(*) from %s where %I = $1', r.tabela, r.coluna) into v_n using _pessoa;
    if v_n > 0 then
      v_onde := v_onde || (replace(r.tabela::text, 'ops.', '') || '.' || r.coluna);
    end if;
  end loop;

  if array_length(v_onde, 1) > 0 then
    raise exception 'Esta pessoa já tem histórico (%). Use Desligar.', array_to_string(v_onde, ', ')
      using errcode = '23503';
  end if;

  delete from ops.gente_pessoas where id = _pessoa;
  perform ops._acesso_log(null, 'gente_excluir_cadastro', 'people',
    jsonb_build_object('pessoa_id', _pessoa, 'nome', v_linha.nome_completo,
                       'email', v_linha.email, 'unidade_id', v_linha.unidade_id,
                       'origem', v_linha.origem));
end $$;

commit;
