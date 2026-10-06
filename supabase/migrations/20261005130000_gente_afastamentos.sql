-- Afastamento com data, motivo, CID e previsão de retorno (05/10/2026, pedido
-- do RH de Maceió: "alertar o retorno e manter o radar de SST"). Até aqui
-- Afastar só trocava o status, num clique e sem perguntar nada.
--
-- CID É DADO DE SAÚDE (dado sensível, LGPD art. 11). Mora numa tabela à parte,
-- `gente_afastamento_cid`, que só abre com `manage.gente.saude`. A chave vai na
-- mesma área restrita do salário (`people_remuneracao`: admin e gente_gestao),
-- não na área `people`, senão sócio regional e diretor leriam o diagnóstico.
-- Quem gere o cadastro vê que a pessoa está afastada, o motivo geral e a
-- previsão de retorno; o CID, só o RH.
--
-- O retorno fecha sozinho: quando o status sai de "afastado" (Reativar ou
-- Desligar), um trigger grava `retorno_em` no afastamento aberto.

begin;

update ops.areas
   set nome = 'Planning People: RH (salário e saúde)',
       descricao = 'Dados sensíveis das pessoas da unidade: salário, movimentações e CID de afastamento. Só o RH e o admin.'
 where slug = 'people_remuneracao';

insert into ops.area_chaves (area, permission_key)
values ('people_remuneracao', 'manage.gente.saude')
on conflict do nothing;

create table if not exists ops.gente_afastamentos (
  id               bigint generated always as identity primary key,
  pessoa_id        bigint not null references ops.gente_pessoas(id) on delete cascade,
  inicio           date not null,
  motivo           text not null,
  previsao_retorno date,
  retorno_em       date,
  observacao       text,
  criado_por       uuid default auth.uid(),
  criado_em        timestamptz not null default now(),
  constraint gente_afast_previsao check (previsao_retorno is null or previsao_retorno >= inicio)
);
create index if not exists gente_afast_pessoa on ops.gente_afastamentos (pessoa_id, inicio desc);
create unique index if not exists gente_afast_um_aberto on ops.gente_afastamentos (pessoa_id)
  where retorno_em is null;

create table if not exists ops.gente_afastamento_cid (
  afastamento_id bigint primary key references ops.gente_afastamentos(id) on delete cascade,
  cid            text not null
);

alter table ops.gente_afastamentos enable row level security;
alter table ops.gente_afastamento_cid enable row level security;

drop policy if exists gente_afast_select on ops.gente_afastamentos;
create policy gente_afast_select on ops.gente_afastamentos for select to authenticated
  using (ops.can('manage.gente') or ops.can('view.gente.individual'));
drop policy if exists gente_afast_write on ops.gente_afastamentos;
create policy gente_afast_write on ops.gente_afastamentos for insert to authenticated
  with check (ops.can('manage.gente'));
drop policy if exists gente_afast_update on ops.gente_afastamentos;
create policy gente_afast_update on ops.gente_afastamentos for update to authenticated
  using (ops.can('manage.gente')) with check (ops.can('manage.gente'));
drop policy if exists gente_afast_escopo on ops.gente_afastamentos;
create policy gente_afast_escopo on ops.gente_afastamentos as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_cid_rh on ops.gente_afastamento_cid;
create policy gente_cid_rh on ops.gente_afastamento_cid for all to authenticated
  using (ops.can('manage.gente.saude')) with check (ops.can('manage.gente.saude'));
drop policy if exists gente_cid_escopo on ops.gente_afastamento_cid;
create policy gente_cid_escopo on ops.gente_afastamento_cid as restrictive for all to authenticated
  using (exists (select 1 from ops.gente_afastamentos a where a.id = afastamento_id));

-- Afastar: grava o afastamento e troca o status numa transação só.
create or replace function ops.gente_afastar(
  _pessoa bigint, _inicio date, _motivo text,
  _previsao date default null, _cid text default null, _observacao text default null)
returns bigint
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  v_id bigint;
  v_status text;
begin
  perform ops._gente_pode_gerir(_pessoa);
  if _inicio is null then raise exception 'Informe a data do afastamento.' using errcode = '22023'; end if;
  if nullif(trim(coalesce(_motivo, '')), '') is null then
    raise exception 'Informe o motivo do afastamento.' using errcode = '22023';
  end if;
  if _previsao is not null and _previsao < _inicio then
    raise exception 'A previsão de retorno é anterior ao início.' using errcode = '22023';
  end if;
  if nullif(trim(coalesce(_cid, '')), '') is not null and not ops.can('manage.gente.saude') then
    raise exception 'Só o RH registra CID.' using errcode = '42501';
  end if;
  select status into v_status from ops.gente_pessoas where id = _pessoa;
  if v_status <> 'ativo' then
    raise exception 'Só dá para afastar quem está ativo.' using errcode = '22023';
  end if;

  insert into ops.gente_afastamentos (pessoa_id, inicio, motivo, previsao_retorno, observacao)
  values (_pessoa, _inicio, trim(_motivo), _previsao, nullif(trim(coalesce(_observacao, '')), ''))
  returning id into v_id;
  if nullif(trim(coalesce(_cid, '')), '') is not null then
    insert into ops.gente_afastamento_cid (afastamento_id, cid) values (v_id, upper(trim(_cid)));
  end if;

  perform ops.gente_definir_status(_pessoa, 'afastado');
  return v_id;
end $$;

revoke all on function ops.gente_afastar(bigint, date, text, date, text, text) from public, anon;
grant execute on function ops.gente_afastar(bigint, date, text, date, text, text) to authenticated;

-- Saiu de "afastado": fecha o afastamento aberto com a data de hoje (Brasília).
create or replace function ops.gente_fechar_afastamento()
returns trigger
language plpgsql
security definer
set search_path = ops, public
as $$
begin
  if old.status = 'afastado' and new.status <> 'afastado' then
    update ops.gente_afastamentos
       set retorno_em = (now() at time zone 'America/Sao_Paulo')::date
     where pessoa_id = new.id and retorno_em is null;
  end if;
  return new;
end $$;

drop trigger if exists gente_pessoas_fecha_afastamento on ops.gente_pessoas;
create trigger gente_pessoas_fecha_afastamento
  after update of status on ops.gente_pessoas
  for each row execute function ops.gente_fechar_afastamento();

commit;
