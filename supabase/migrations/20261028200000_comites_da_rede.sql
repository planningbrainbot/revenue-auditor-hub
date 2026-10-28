-- Comitês da rede (/comites). PRD: wiki/prds/2026-10-ops-comites-da-rede.md,
-- aprovado em 28/10/2026 ("crie uma página no ops que traga as notas e o ppt e
-- qual comitê foi"), com as propostas da seção 11: só admin vê, gravação como
-- link, item no menu Administração.
--
-- Cada comitê tem um código curto (vai no endereço do QR da pesquisa) e guarda
-- o link e/ou o arquivo da apresentação e o link da gravação. Cada resposta da
-- pesquisa de satisfação passa a dizer de qual comitê veio (comite_codigo);
-- antes só a data separava.
--
-- A pesquisa continua anônima e pública: a chave publishable só insere, e só
-- para comitê com a pesquisa aberta. Ler as respostas exige view.admin.comites.
-- Rollback: supabase/rollback/20261028200000_comites_da_rede_rollback.sql

begin;

-- ------------------------------------------------------------------ comitês

create table if not exists ops.comites (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique check (codigo ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  tipo                 text not null check (tipo in ('operacoes', 'growth', 'outro')),
  titulo               text not null check (length(btrim(titulo)) between 3 and 120),
  data                 date,
  apresentacao_url     text check (apresentacao_url ~* '^https://'),
  apresentacao_arquivo text,
  apresentacao_nome    text,
  gravacao_url         text check (gravacao_url ~* '^https://'),
  pesquisa_aberta      boolean not null default false,
  criado_por           uuid references auth.users (id) default auth.uid(),
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now()
);
comment on table ops.comites is
  'Comitês da rede (/comites): apresentação, gravação e a chave da pesquisa de satisfação. '
  'O código vai no endereço do QR (?c=<codigo>).';

alter table ops.comites enable row level security;
revoke all on ops.comites from anon;
grant select, insert, update on ops.comites to authenticated;

drop policy if exists comites_ler on ops.comites;
create policy comites_ler on ops.comites for select to authenticated
  using (ops.can('view.admin.comites'));
drop policy if exists comites_criar on ops.comites;
create policy comites_criar on ops.comites for insert to authenticated
  with check (ops.can('view.admin.comites'));
drop policy if exists comites_editar on ops.comites;
create policy comites_editar on ops.comites for update to authenticated
  using (ops.can('view.admin.comites')) with check (ops.can('view.admin.comites'));

create or replace function ops.comites_antes_de_gravar()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists comites_antes_de_gravar on ops.comites;
create trigger comites_antes_de_gravar before update on ops.comites
  for each row execute function ops.comites_antes_de_gravar();

insert into ops.comites (codigo, tipo, titulo, data, apresentacao_url, pesquisa_aberta, criado_por)
values
  ('operacoes-2026-09', 'operacoes', 'Comitê de Operações · setembro 2026', '2026-09-10',
   'https://comite-deck-planning17.vercel.app', false, null),
  ('growth-2026-10', 'growth', 'Comitê de Outubro 2026', null,
   'https://claude.ai/artifact/AHmJddNdqRuLbofCfUhyK6', true, null)
on conflict (codigo) do nothing;

-- ------------------------------------------------------------------ respostas

alter table ops.pesquisa_satisfacao_comite_socios
  add column if not exists comite_codigo text references ops.comites (codigo) on update cascade;

-- As 8 respostas que existem são do Comitê de Operações de 10/09/2026.
update ops.pesquisa_satisfacao_comite_socios
   set comite_codigo = 'operacoes-2026-09'
 where comite_codigo is null
   and created_at < '2026-09-12';

create index if not exists pesquisa_comite_codigo_idx
  on ops.pesquisa_satisfacao_comite_socios (comite_codigo);

-- A chave pública não lê ops.comites; a policy de insert pergunta por aqui.
create or replace function ops.comite_pesquisa_aberta(p_codigo text)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select c.pesquisa_aberta from ops.comites c where c.codigo = p_codigo), false)
$$;
revoke all on function ops.comite_pesquisa_aberta(text) from public;
grant execute on function ops.comite_pesquisa_aberta(text) to anon, authenticated;

alter table ops.pesquisa_satisfacao_comite_socios enable row level security;
-- Quem respondia pela chave pública sem dizer o comitê não grava mais.
drop policy if exists insert_publico_pesquisa_comite_socios on ops.pesquisa_satisfacao_comite_socios;
create policy insert_publico_pesquisa_comite_socios on ops.pesquisa_satisfacao_comite_socios
  for insert to anon, authenticated
  with check (ops.comite_pesquisa_aberta(comite_codigo));

-- Antes, authenticated tinha select/update/delete sem policy (nada passava).
-- Agora lê quem tem a chave; ninguém edita nem apaga resposta pela API.
revoke update, delete on ops.pesquisa_satisfacao_comite_socios from authenticated;
drop policy if exists respostas_comite_ler on ops.pesquisa_satisfacao_comite_socios;
create policy respostas_comite_ler on ops.pesquisa_satisfacao_comite_socios
  for select to authenticated
  using (ops.can('view.admin.comites'));

grant usage on sequence ops.pesquisa_satisfacao_comite_socios_id_seq1 to anon, authenticated;

-- ------------------------------------------------------------------ arquivos

insert into storage.buckets (id, name, public, file_size_limit)
values ('comites', 'comites', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists comites_arquivos_ler on storage.objects;
create policy comites_arquivos_ler on storage.objects for select to authenticated
  using (bucket_id = 'comites' and ops.can('view.admin.comites'));
drop policy if exists comites_arquivos_subir on storage.objects;
create policy comites_arquivos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'comites' and ops.can('view.admin.comites'));
drop policy if exists comites_arquivos_apagar on storage.objects;
create policy comites_arquivos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'comites' and ops.can('view.admin.comites'));

-- ------------------------------------------------------------------ chave

insert into ops.area_chaves (area, permission_key)
values ('admin', 'view.admin.comites')
on conflict do nothing;

insert into ops.role_permissions (role, permission_key, allowed)
select role, 'view.admin.comites', allowed
  from ops.role_permissions
 where permission_key = 'view.admin.users'
on conflict do nothing;

commit;
