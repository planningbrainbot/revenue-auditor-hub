-- Movimentações de salário, cargo, setor, gestor e vínculo no Planning People
-- (01/10/2026, pedido do RH de Maceió). Decisões do dono no mesmo dia:
--   - quem aprova é só o RH da unidade;
--   - o Departamento Pessoal recebe por e-mail, com PDF e Excel;
--   - o salário atual de todo mundo é carregado (planilha), não só o das
--     movimentações daqui para frente.
--
-- SALÁRIO É O DADO MAIS SENSÍVEL DO MÓDULO. Por isso a chave
-- `manage.gente.remuneracao` NÃO entra na área `people`: lá ela vazaria para
-- diretor, head e sócio regional, que têm a área inteira. Mora numa área
-- própria, `people_remuneracao`, concedida só a `admin` e `gente_gestao` (o
-- RH). Nem gestor nem colaborador leem salário, e o diretório não tem a coluna.
--
-- Fluxo: rascunho → enviada (o RH aprova ao enviar ao DP) → aplicada no dia da
-- vigência (pg_cron diário, ou na hora se a vigência já passou). Aplicar é
-- atualizar o cadastro e gravar o salário novo; o histórico do cadastro
-- registra a mudança com a origem "movimentação".

begin;

-- 1. Chave em área própria --------------------------------------------------
insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa)
values ('people_remuneracao', 'Planning People: remuneração',
        'Salário e movimentações (salário, cargo, setor) das pessoas da unidade, com envio ao Departamento Pessoal.',
        'unidade', 45, true)
on conflict (slug) do nothing;

insert into ops.area_chaves (area, permission_key)
values ('people_remuneracao', 'manage.gente.remuneracao')
on conflict do nothing;

insert into ops.role_areas (role, area, allowed)
select r, 'people_remuneracao', true
  from unnest(array['admin', 'gente_gestao']) r
on conflict do nothing;

-- 2. Configuração por unidade: para onde vai a movimentação -------------------
create table if not exists ops.gente_config_unidade (
  unidade_id  integer primary key references ops.unidades(id),
  email_dp    text,
  atualizado_por uuid default auth.uid(),
  atualizado_em  timestamptz not null default now()
);

-- 3. Salário com vigência (append-only na prática) ---------------------------
create table if not exists ops.gente_remuneracao (
  id          bigint generated always as identity primary key,
  pessoa_id   bigint not null references ops.gente_pessoas(id) on delete cascade,
  salario     numeric(12,2) not null check (salario > 0),
  vigencia    date not null,
  origem      text not null check (origem in ('carga', 'movimentacao')),
  movimentacao_id bigint,
  criado_por  uuid default auth.uid(),
  criado_em   timestamptz not null default now()
);
create index if not exists gente_remuneracao_pessoa on ops.gente_remuneracao (pessoa_id, vigencia desc);

-- 4. Movimentação ------------------------------------------------------------
create table if not exists ops.gente_movimentacoes (
  id              bigint generated always as identity primary key,
  pessoa_id       bigint not null references ops.gente_pessoas(id) on delete cascade,
  vigencia        date not null,
  motivo          text,
  observacao      text,
  salario_antes   numeric(12,2),
  salario_depois  numeric(12,2) check (salario_depois is null or salario_depois > 0),
  cargo_antes     text,
  cargo_depois    text,
  departamento_antes text,
  departamento_depois text,
  gestor_antes_id  bigint,
  gestor_depois_id bigint,
  vinculo_antes   text,
  vinculo_depois  text,
  status          text not null default 'rascunho'
                    check (status in ('rascunho', 'enviada', 'cancelada')),
  enviada_em      timestamptz,
  enviada_para    text,
  aplicada_em     timestamptz,
  criado_por      uuid default auth.uid(),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  constraint gente_mov_algo_muda check (
    salario_depois is not null or cargo_depois is not null or departamento_depois is not null
    or gestor_depois_id is not null or vinculo_depois is not null)
);
create index if not exists gente_mov_pessoa on ops.gente_movimentacoes (pessoa_id, vigencia desc);
create index if not exists gente_mov_pendente on ops.gente_movimentacoes (vigencia)
  where status = 'enviada' and aplicada_em is null;

-- 5. RLS: só quem tem a chave, só na unidade ---------------------------------
alter table ops.gente_config_unidade enable row level security;
alter table ops.gente_remuneracao enable row level security;
alter table ops.gente_movimentacoes enable row level security;

drop policy if exists gente_cfg_rem on ops.gente_config_unidade;
create policy gente_cfg_rem on ops.gente_config_unidade for all to authenticated
  using (ops.can('manage.gente.remuneracao')) with check (ops.can('manage.gente.remuneracao'));
drop policy if exists gente_cfg_escopo on ops.gente_config_unidade;
create policy gente_cfg_escopo on ops.gente_config_unidade as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or unidade_id = any (ops.minhas_unidades_gente()));

drop policy if exists gente_rem_rem on ops.gente_remuneracao;
create policy gente_rem_rem on ops.gente_remuneracao for all to authenticated
  using (ops.can('manage.gente.remuneracao')) with check (ops.can('manage.gente.remuneracao'));
drop policy if exists gente_rem_escopo on ops.gente_remuneracao;
create policy gente_rem_escopo on ops.gente_remuneracao as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_mov_rem on ops.gente_movimentacoes;
create policy gente_mov_rem on ops.gente_movimentacoes for all to authenticated
  using (ops.can('manage.gente.remuneracao')) with check (ops.can('manage.gente.remuneracao'));
drop policy if exists gente_mov_escopo on ops.gente_movimentacoes;
create policy gente_mov_escopo on ops.gente_movimentacoes as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));

-- 6. Histórico do cadastro com a origem da mudança ---------------------------
alter table ops.gente_pessoas_historico add column if not exists origem text;

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

-- 7. Aplicar ------------------------------------------------------------------
-- Sem `_id`: todas as enviadas com vigência vencida (o pg_cron chama assim).
-- Com `_id`: só aquela, e só se quem chama pode gerir remuneração na unidade.
create or replace function ops.gente_aplicar_movimentacoes(_id bigint default null)
returns integer
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  m   ops.gente_movimentacoes%rowtype;
  n   integer := 0;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if _id is not null then
    if not ops.can('manage.gente.remuneracao') then
      raise exception 'Sem permissão para movimentações.' using errcode = '42501';
    end if;
    if ops.can('data.scope.own_unit_only') and not coalesce(
         ops.gente_pessoa_unidade((select pessoa_id from ops.gente_movimentacoes where id = _id))
           = any (ops.minhas_unidades_gente()), false) then
      raise exception 'Movimentação fora da sua unidade.' using errcode = '42501';
    end if;
  end if;

  for m in
    select * from ops.gente_movimentacoes
     where status = 'enviada' and aplicada_em is null and vigencia <= hoje
       and (_id is null or id = _id)
     order by vigencia, id
     for update skip locked
  loop
    perform set_config('ops.historico_origem', 'movimentação #' || m.id, true);
    update ops.gente_pessoas
       set cargo        = coalesce(m.cargo_depois, cargo),
           departamento = coalesce(m.departamento_depois, departamento),
           gestor_id    = coalesce(m.gestor_depois_id, gestor_id),
           tipo_vinculo = coalesce(m.vinculo_depois, tipo_vinculo)
     where id = m.pessoa_id;
    if m.salario_depois is not null then
      insert into ops.gente_remuneracao (pessoa_id, salario, vigencia, origem, movimentacao_id, criado_por)
      values (m.pessoa_id, m.salario_depois, m.vigencia, 'movimentacao', m.id, m.criado_por);
    end if;
    update ops.gente_movimentacoes set aplicada_em = now(), atualizado_em = now() where id = m.id;
    perform set_config('ops.historico_origem', '', true);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function ops.gente_aplicar_movimentacoes(bigint) from public, anon;
grant execute on function ops.gente_aplicar_movimentacoes(bigint) to authenticated;

-- Todo dia às 00:10 de Brasília (03:10 UTC): o que entrou em vigência hoje.
select cron.unschedule('gente-movimentacoes-aplicar')
 where exists (select 1 from cron.job where jobname = 'gente-movimentacoes-aplicar');
select cron.schedule('gente-movimentacoes-aplicar', '10 3 * * *',
  $$select ops.gente_aplicar_movimentacoes()$$);

commit;
