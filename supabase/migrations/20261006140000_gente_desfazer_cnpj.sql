-- 06/10/2026, pedidos do RH de Maceió:
--  1. Desfazer movimentação. A Paula lançou a 01/2026 na Bianca errada, já
--     aplicada e enviada ao DP, e só dava para corrigir no banco. Desfazer volta
--     o cadastro e o salário ao que eram antes e guarda o registro (status
--     "desfeita", com quem, quando e por quê). Rascunho continua sendo excluído.
--  2. Empresa empregadora (CNPJ) da pessoa: Maceió tem dois CNPJs. As opções
--     saem de `unidades.cnpj`, que guarda um CNPJ por linha (padrão de
--     Curitiba, 03/07/2026).
--  3. O histórico do cadastro passa a registrar nascimento e CNPJ.

begin;

-- 1. Desfazer ---------------------------------------------------------------
alter table ops.gente_movimentacoes drop constraint if exists gente_movimentacoes_status_check;
alter table ops.gente_movimentacoes add constraint gente_movimentacoes_status_check
  check (status in ('rascunho', 'enviada', 'cancelada', 'desfeita'));
alter table ops.gente_movimentacoes
  add column if not exists desfeita_em timestamptz,
  add column if not exists desfeita_por uuid,
  add column if not exists motivo_desfazer text;

create or replace function ops.gente_desfazer_movimentacao(_id bigint, _motivo text)
returns jsonb
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  m        ops.gente_movimentacoes%rowtype;
  p        ops.gente_pessoas%rowtype;
  v_mantidos text[] := '{}';
begin
  if not ops.can('manage.gente.remuneracao') then
    raise exception 'Sem permissão para movimentações.' using errcode = '42501';
  end if;
  select * into m from ops.gente_movimentacoes where id = _id for update;
  if not found then raise exception 'Movimentação não encontrada.' using errcode = '22023'; end if;
  if ops.can('data.scope.own_unit_only')
     and not coalesce(ops.gente_pessoa_unidade(m.pessoa_id) = any (ops.minhas_unidades_gente()), false) then
    raise exception 'Movimentação fora da sua unidade.' using errcode = '42501';
  end if;
  if m.status <> 'enviada' then
    raise exception 'Só dá para desfazer movimentação enviada. Rascunho se exclui.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(_motivo, '')), '') is null then
    raise exception 'Diga por que está desfazendo.' using errcode = '22023';
  end if;

  if m.aplicada_em is not null then
    select * into p from ops.gente_pessoas where id = m.pessoa_id;
    -- Só volta o campo que ainda está com o valor da movimentação: se alguém
    -- mudou de novo depois, a mudança posterior fica e a tela avisa.
    perform set_config('ops.historico_origem', 'desfaz movimentação #' || m.id, true);
    if m.cargo_depois is not null then
      if p.cargo is not distinct from m.cargo_depois then
        update ops.gente_pessoas set cargo = m.cargo_antes where id = m.pessoa_id;
      else v_mantidos := v_mantidos || 'cargo'; end if;
    end if;
    if m.departamento_depois is not null then
      if p.departamento is not distinct from m.departamento_depois then
        update ops.gente_pessoas set departamento = m.departamento_antes where id = m.pessoa_id;
      else v_mantidos := v_mantidos || 'setor'; end if;
    end if;
    if m.gestor_depois_id is not null then
      if p.gestor_id is not distinct from m.gestor_depois_id then
        update ops.gente_pessoas set gestor_id = m.gestor_antes_id where id = m.pessoa_id;
      else v_mantidos := v_mantidos || 'gestor'; end if;
    end if;
    if m.vinculo_depois is not null then
      if p.tipo_vinculo is not distinct from m.vinculo_depois then
        update ops.gente_pessoas set tipo_vinculo = m.vinculo_antes where id = m.pessoa_id;
      else v_mantidos := v_mantidos || 'vínculo'; end if;
    end if;
    perform set_config('ops.historico_origem', '', true);
  end if;
  -- O salário da movimentação sai, aplicada ou não (a futura nem chegou a valer).
  delete from ops.gente_remuneracao where movimentacao_id = m.id;

  update ops.gente_movimentacoes
     set status = 'desfeita', desfeita_em = now(), desfeita_por = auth.uid(),
         motivo_desfazer = trim(_motivo), atualizado_em = now()
   where id = m.id;

  perform ops._acesso_log(null, 'gente_desfazer_movimentacao', 'people',
    jsonb_build_object('movimentacao_id', m.id, 'numero', m.numero, 'ano', m.ano,
                       'pessoa_id', m.pessoa_id, 'motivo', trim(_motivo),
                       'campos_mantidos', v_mantidos));
  return jsonb_build_object('aplicada', m.aplicada_em is not null, 'campos_mantidos', v_mantidos);
end $$;

revoke all on function ops.gente_desfazer_movimentacao(bigint, text) from public, anon;
grant execute on function ops.gente_desfazer_movimentacao(bigint, text) to authenticated;

-- 2. Empresa empregadora --------------------------------------------------------
alter table ops.gente_pessoas add column if not exists cnpj_empregador text;
comment on column ops.gente_pessoas.cnpj_empregador is
  'CNPJ (só dígitos) da empresa que emprega a pessoa, entre os da unidade (unidades.cnpj, um por linha).';

-- 3. Histórico com nascimento e CNPJ ---------------------------------------------
create or replace function ops.gente_pessoas_registrar_historico()
returns trigger
language plpgsql
security definer
set search_path = ops, public
as $$
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
end $$;

commit;
