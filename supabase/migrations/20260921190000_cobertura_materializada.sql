-- A cobertura por unidade deixa de ser view e vira tabela com refresh agendado.
-- Motivo, medido: como view custava 1.323 ms de execucao por carregamento da tela, porque depende
-- de ops.base_conta_cnpjs (DISTINCT + UNION com NOT EXISTS correlacionado: 2.539 ms isolada).
-- Como tabela, a leitura e 0,08 ms. O dado fica no maximo 10 minutos atras do banco, que e a mesma
-- ordem de defasagem do resto da carteira.
-- NAO e materialized view de proposito: matview ignora RLS e e exatamente o padrao apontado na
-- auditoria de seguranca de 21/09 (relatorio derivado que passa por cima da regra da tabela).
begin;
drop view if exists ops.monetizacao_unidade_cobertura;
create table if not exists ops.monetizacao_unidade_cobertura(
  key text primary key, nome text, unidade_id integer,
  contas integer not null default 0, cnpjs integer not null default 0,
  cnpjs_pipefy integer not null default 0, cnpjs_omie integer not null default 0,
  omie_integrado boolean not null default false, atualizado_em timestamptz not null default now());
alter table ops.monetizacao_unidade_cobertura enable row level security;
grant select on ops.monetizacao_unidade_cobertura to authenticated;
drop policy if exists cobertura_leitura on ops.monetizacao_unidade_cobertura;
create policy cobertura_leitura on ops.monetizacao_unidade_cobertura for select to authenticated using (true);

create or replace function ops.monetizacao_cobertura_refresh() returns integer
language plpgsql security definer set search_path to 'ops','public','extensions' as $fn$
declare n integer;
begin
  with vinculo as (
    -- Reproduz o vinculo conta<->unidade do cliente (use-monetizacao.ts): por unidade_id quando
    -- existe, senao por rotulo/chave no perfil. Conferido unidade a unidade contra a tela.
    select u.key, u.nome, u.unidade_id, a.key account_key
    from ops.monetizacao_unidades u
    join ops.monetizacao_contas a on
      case when u.unidade_id is not null then u.unidade_id = any(a.unidade_ids)
           else a.perfil->>'unit_label' = u.nome
             or u.key = any(coalesce(array(select jsonb_array_elements_text(a.perfil->'units')),'{}'::text[]))
      end),
  conciliado as (
    select v.key, count(distinct v.account_key)::int contas, count(distinct c.cnpj)::int cnpjs
    from vinculo v left join ops.base_conta_cnpjs c on c.account_key = v.account_key group by 1),
  no_pipefy as (
    -- Unidade sem unidade_id (Sao Bernardo) casa por nome, como o cliente ja faz; senao a linha de
    -- procedencia diria "Pipefy 0" para uma carteira inteiramente vinda do Pipefy.
    select u.key, count(distinct regexp_replace(e.cnpj,'\D','','g'))::int n
    from ops.monetizacao_unidades u
    join ops.empresas e on case when u.unidade_id is not null then e.unidade_id = u.unidade_id
                                else ops.base_unidade(e.unidade) = ops.base_unidade(u.nome) end
    where coalesce(e.cnpj,'') <> '' group by 1),
  no_omie as (
    select u.key, count(distinct ops.base_cnpj(o.cnpj_cpf))::int n
    from ops.monetizacao_unidades u join ops.unidades un on un.id = u.unidade_id
    join ops.omie_clientes o on ops.base_unidade(o.unidade) = ops.base_unidade(un.nome_da_praca) group by 1),
  novo as (
    select u.key, u.nome, u.unidade_id, coalesce(c.contas,0) contas, coalesce(c.cnpjs,0) cnpjs,
      coalesce(p.n,0) cnpjs_pipefy, coalesce(o.n,0) cnpjs_omie, coalesce(o.n,0) > 0 omie_integrado
    from ops.monetizacao_unidades u
    left join conciliado c on c.key=u.key left join no_pipefy p on p.key=u.key left join no_omie o on o.key=u.key)
  insert into ops.monetizacao_unidade_cobertura as t
    (key,nome,unidade_id,contas,cnpjs,cnpjs_pipefy,cnpjs_omie,omie_integrado,atualizado_em)
  select key,nome,unidade_id,contas,cnpjs,cnpjs_pipefy,cnpjs_omie,omie_integrado,now() from novo
  on conflict (key) do update set nome=excluded.nome, unidade_id=excluded.unidade_id,
    contas=excluded.contas, cnpjs=excluded.cnpjs, cnpjs_pipefy=excluded.cnpjs_pipefy,
    cnpjs_omie=excluded.cnpjs_omie, omie_integrado=excluded.omie_integrado, atualizado_em=now();
  get diagnostics n = row_count;
  delete from ops.monetizacao_unidade_cobertura c
   where not exists (select 1 from ops.monetizacao_unidades u where u.key=c.key);
  return n;
end $fn$;
revoke execute on function ops.monetizacao_cobertura_refresh() from public;
grant execute on function ops.monetizacao_cobertura_refresh() to service_role;
select ops.monetizacao_cobertura_refresh();
-- cron: select cron.schedule('monetizacao-cobertura-10min','*/10 * * * *',
--         $$select ops.monetizacao_cobertura_refresh()$$);  -- jobid 4, aplicado em 21/09
commit;
