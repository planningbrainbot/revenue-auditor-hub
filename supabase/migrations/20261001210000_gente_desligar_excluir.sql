-- Desligar, afastar e reativar no cadastro do Planning People, e excluir
-- cadastro duplicado (01/10/2026, pedido do RH de Maceió).
--
-- Decisão do dono: excluir apaga histórico, então só existe para cadastro que
-- não tem NENHUM (o caso do Adílio, cadastrado duas vezes com e-mail digitado
-- errado). Quem saiu de verdade é desligado: o histórico fica e a pessoa sai
-- das listas de ativos.
--
-- Desligar corta o login junto, porque até aqui status no cadastro não tirava
-- acesso nenhum (auditoria de 24/09). O RH só corta conta que é da unidade
-- dele: sem papel admin, com ao menos uma unidade e todas dentro do recorte de
-- quem desliga (`escopo_contido`). Conta maior que isso fica para a Matriz, e
-- a função devolve o motivo para a tela dizer.
--
-- As duas funções são SECURITY DEFINER e checam a autoridade com as mesmas
-- funções das policies: `manage.gente` e a unidade em `minhas_unidades_gente()`.

begin;

alter table ops.gente_pessoas add column if not exists motivo_desligamento text;

create or replace function ops._gente_pode_gerir(_pessoa bigint)
returns integer
language plpgsql
stable
security definer
set search_path = ops, public
as $$
declare v_unidade integer;
begin
  if not ops.can('manage.gente') then
    raise exception 'Sem permissão para gerir o cadastro de gente.' using errcode = '42501';
  end if;
  select unidade_id into v_unidade from ops.gente_pessoas where id = _pessoa;
  if not found then
    raise exception 'Pessoa não encontrada.' using errcode = '22023';
  end if;
  if ops.can('data.scope.own_unit_only')
     and not coalesce(v_unidade = any (ops.minhas_unidades_gente()), false) then
    raise exception 'Pessoa fora da sua unidade.' using errcode = '42501';
  end if;
  return v_unidade;
end $$;

create or replace function ops.gente_definir_status(
  _pessoa bigint, _status text, _data date default null, _motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  _ator     uuid := auth.uid();
  v_user    uuid;
  v_antes   text;
  v_lider   integer;
  v_corta   boolean := false;
  v_reativa boolean := false;
  v_manteve text;
begin
  perform ops._gente_pode_gerir(_pessoa);
  if _status not in ('ativo', 'afastado', 'desligado') then
    raise exception 'Status inválido.' using errcode = '22023';
  end if;
  if _status = 'desligado' and _data is null then
    raise exception 'Informe a data do desligamento.' using errcode = '22023';
  end if;

  select user_id, status into v_user, v_antes from ops.gente_pessoas where id = _pessoa;
  if v_user = _ator and _status = 'desligado' then
    raise exception 'Você não pode desligar o seu próprio cadastro.' using errcode = '42501';
  end if;

  update ops.gente_pessoas
     set status = _status,
         data_desligamento = case when _status = 'desligado' then _data end,
         motivo_desligamento = case when _status = 'desligado' then nullif(trim(coalesce(_motivo, '')), '') end
   where id = _pessoa;

  select count(*) into v_lider from ops.gente_pessoas where gestor_id = _pessoa and status = 'ativo';

  -- O login acompanha o cadastro, mas só quando a conta é da unidade.
  if v_user is not null and (_status = 'desligado' or v_antes = 'desligado') then
    if exists (select 1 from ops.user_roles where user_id = v_user and role::text = 'admin') then
      v_manteve := 'conta de administrador';
    elsif not exists (select 1 from ops.usuario_unidades where user_id = v_user)
          and not coalesce((select todas_unidades from ops.usuario_escopo where user_id = v_user), false) then
      v_manteve := 'conta sem unidade definida';
    elsif not ops.escopo_contido(v_user, _ator) then
      v_manteve := 'conta com acesso fora da sua unidade';
    elsif _status = 'desligado' then
      update public.profiles set ativo = false where user_id = v_user;
      delete from auth.sessions where user_id = v_user;
      delete from ops.ver_como where user_id = v_user;
      perform ops._acesso_log(v_user, 'desativar', 'people',
        jsonb_build_object('origem', 'gente_desligar', 'pessoa_id', _pessoa, 'motivo', _motivo));
      v_corta := true;
    else
      update public.profiles set ativo = true where user_id = v_user;
      perform ops._acesso_log(v_user, 'reativar', 'people',
        jsonb_build_object('origem', 'gente_reativar', 'pessoa_id', _pessoa));
      v_reativa := true;
    end if;
  end if;

  return jsonb_build_object(
    'user_id', v_user,
    'acesso_cortado', v_corta,
    'acesso_reativado', v_reativa,
    'acesso_mantido_por', v_manteve,
    'liderados_ativos', v_lider);
end $$;

-- Exclusão só de cadastro sem histórico. "Histórico" é qualquer linha, em
-- qualquer tabela, que aponte para a pessoa: a lista sai do catálogo, então
-- tabela nova do Gente entra sozinha.
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

revoke all on function ops._gente_pode_gerir(bigint) from public, anon;
revoke all on function ops.gente_definir_status(bigint, text, date, text) from public, anon;
revoke all on function ops.gente_excluir_cadastro(bigint) from public, anon;
grant execute on function ops._gente_pode_gerir(bigint) to authenticated;
grant execute on function ops.gente_definir_status(bigint, text, date, text) to authenticated;
grant execute on function ops.gente_excluir_cadastro(bigint) to authenticated;

commit;
