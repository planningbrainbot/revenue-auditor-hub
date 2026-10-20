-- Registro dos períodos do contrato de estágio (TCE) e de terceiro (pedido do dono,
-- 20/10/2026, junto do ajuste do RH de Maceió de 19/10).
--
-- A data de início do contrato passa a ser a própria admissão ("Início do estágio",
-- "Início do contrato"); o cadastro só pede o fim da vigência. Para não perder o início
-- de cada renovação, todo fim gravado vira uma linha aqui:
--   primeiro fim: período da admissão até o fim;
--   fim prorrogado (renovação): do dia seguinte ao fim anterior até o novo fim;
--   fim corrigido para antes: corrige o último período (mesmo início, fim novo).
-- Só o gatilho grava. Lê quem enxerga a pessoa (a RLS do cadastro vale no EXISTS).

create table if not exists ops.gente_vigencia_periodos (
  id bigint generated always as identity primary key,
  pessoa_id bigint not null references ops.gente_pessoas (id) on delete cascade,
  inicio date,
  fim date not null,
  tipo text not null check (tipo in ('inicial', 'renovacao', 'correcao')),
  registrado_por uuid,
  registrado_em timestamptz not null default now()
);

create index if not exists gente_vigencia_periodos_pessoa
  on ops.gente_vigencia_periodos (pessoa_id, registrado_em desc);

alter table ops.gente_vigencia_periodos enable row level security;
revoke all on ops.gente_vigencia_periodos from public, anon, authenticated;
grant select on ops.gente_vigencia_periodos to authenticated;

drop policy if exists gente_vigencia_periodos_ler on ops.gente_vigencia_periodos;
create policy gente_vigencia_periodos_ler on ops.gente_vigencia_periodos
  for select to authenticated
  using (exists (select 1 from ops.gente_pessoas p where p.id = pessoa_id));

create or replace function ops.gente_registrar_periodo_vigencia()
returns trigger
language plpgsql security definer set search_path to 'ops', 'public', 'pg_temp'
as $$
declare
  _ultimo ops.gente_vigencia_periodos%rowtype;
  _antigo date := case when tg_op = 'UPDATE' then old.vigencia_fim end;
begin
  if new.vigencia_fim is null or new.vigencia_fim is not distinct from _antigo then
    return new;
  end if;
  select * into _ultimo from ops.gente_vigencia_periodos
   where pessoa_id = new.id order by registrado_em desc, id desc limit 1;

  if _antigo is null or _ultimo.id is null then
    insert into ops.gente_vigencia_periodos (pessoa_id, inicio, fim, tipo, registrado_por)
    values (new.id, coalesce(new.vigencia_inicio, new.data_admissao), new.vigencia_fim, 'inicial', auth.uid());
  elsif new.vigencia_fim > _antigo then
    insert into ops.gente_vigencia_periodos (pessoa_id, inicio, fim, tipo, registrado_por)
    values (new.id, _antigo + 1, new.vigencia_fim, 'renovacao', auth.uid());
  else
    insert into ops.gente_vigencia_periodos (pessoa_id, inicio, fim, tipo, registrado_por)
    values (new.id, _ultimo.inicio, new.vigencia_fim, 'correcao', auth.uid());
  end if;
  return new;
end $$;

revoke all on function ops.gente_registrar_periodo_vigencia() from public, anon, authenticated;

drop trigger if exists gente_pessoas_periodo_vigencia on ops.gente_pessoas;
create trigger gente_pessoas_periodo_vigencia
  after insert or update of vigencia_fim on ops.gente_pessoas
  for each row execute function ops.gente_registrar_periodo_vigencia();

-- Quem já tem fim gravado entra com o período inicial (em 20/10 ninguém tinha).
insert into ops.gente_vigencia_periodos (pessoa_id, inicio, fim, tipo)
select p.id, coalesce(p.vigencia_inicio, p.data_admissao), p.vigencia_fim, 'inicial'
  from ops.gente_pessoas p
 where p.vigencia_fim is not null
   and not exists (select 1 from ops.gente_vigencia_periodos v where v.pessoa_id = p.id);
