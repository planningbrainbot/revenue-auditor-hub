-- Movimentação no formato do formulário do RH de Maceió (05/10/2026,
-- "Solicitação de Movimentação Planning - Modelo.xlsx"): tipo(s) da
-- movimentação, motivo(s), modelo de trabalho, justificativa, principais
-- responsabilidades e número da solicitação por unidade e ano (01/2026).
-- O PDF que vai ao DP passa a ser esse formulário, com os blocos de assinatura
-- do RH, do gestor imediato e da diretoria.

begin;

alter table ops.gente_movimentacoes
  add column if not exists numero integer,
  add column if not exists ano integer,
  add column if not exists tipos text[] not null default '{}',
  add column if not exists motivos text[] not null default '{}',
  add column if not exists modelo_trabalho text
    check (modelo_trabalho is null or modelo_trabalho in ('presencial', 'hibrido', 'remoto')),
  add column if not exists justificativa text,
  add column if not exists responsabilidades text;

-- "Algo muda" passa a aceitar movimentação só de tipo (jornada, modelo de
-- trabalho, transferência de unidade), que não mexe em campo do cadastro.
alter table ops.gente_movimentacoes drop constraint if exists gente_mov_algo_muda;
alter table ops.gente_movimentacoes add constraint gente_mov_algo_muda check (
  salario_depois is not null or cargo_depois is not null or departamento_depois is not null
  or gestor_depois_id is not null or vinculo_depois is not null or modelo_trabalho is not null
  or cardinality(tipos) > 0);

-- Número sequencial por unidade e ano, na criação.
create or replace function ops.gente_mov_numerar()
returns trigger
language plpgsql
security definer
set search_path = ops, public
as $$
declare v_unidade integer;
begin
  new.ano := extract(year from (now() at time zone 'America/Sao_Paulo'))::int;
  v_unidade := ops.gente_pessoa_unidade(new.pessoa_id);
  perform pg_advisory_xact_lock(hashtext('gente_mov_numero'), coalesce(v_unidade, 0));
  select coalesce(max(m.numero), 0) + 1 into new.numero
    from ops.gente_movimentacoes m
   where m.ano = new.ano
     and ops.gente_pessoa_unidade(m.pessoa_id) is not distinct from v_unidade;
  return new;
end $$;

drop trigger if exists gente_mov_numerar on ops.gente_movimentacoes;
create trigger gente_mov_numerar before insert on ops.gente_movimentacoes
  for each row execute function ops.gente_mov_numerar();

-- As que já existem ganham número na ordem em que foram criadas.
with n as (
  select id,
         extract(year from criado_em at time zone 'America/Sao_Paulo')::int as ano,
         row_number() over (
           partition by ops.gente_pessoa_unidade(pessoa_id),
                        extract(year from criado_em at time zone 'America/Sao_Paulo')
           order by criado_em, id) as numero
    from ops.gente_movimentacoes
   where numero is null)
update ops.gente_movimentacoes m set numero = n.numero, ano = n.ano from n where n.id = m.id;

commit;
