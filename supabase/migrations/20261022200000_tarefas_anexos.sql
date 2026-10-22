-- Tarefas v2: anexos na ficha da tarefa (22/10/2026, contrato docs/design/contratos/tarefas.md, DECISIONS 22/10).
--
-- O arquivo mora no bucket privado `tarefas-anexos`, no caminho <quadro>/<tarefa>/<id>-<nome>. A primeira
-- pasta é o quadro, e é ela que a policy do Storage confere: só o membro do quadro sobe, baixa ou apaga,
-- como em todo o resto da área. A linha em ops.tarefas_anexos é o que a ficha lista (nome, tamanho, quem
-- mandou) e vira histórico da tarefa ("anexou", "removeu anexo").
-- Apaga o anexo quem mandou ou o dono do quadro (mesma régua de apagar tarefa).
-- Limite: 25 MB por arquivo, qualquer tipo.
-- Rollback: supabase/rollback/20261022200000_tarefas_anexos_rollback.sql

-- ------------------------------------------------------------------ bucket

insert into storage.buckets (id, name, public, file_size_limit)
values ('tarefas-anexos', 'tarefas-anexos', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Quadro dono do caminho, ou nulo se o caminho não começa por um uuid (aí nenhuma policy passa).
create or replace function ops.tarefas_quadro_do_caminho(_caminho text)
returns uuid
language sql immutable set search_path = '' as $$
  select case when split_part(_caminho, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(_caminho, '/', 1)::uuid end
$$;
grant execute on function ops.tarefas_quadro_do_caminho(text) to authenticated;

drop policy if exists tarefas_anexos_ler on storage.objects;
create policy tarefas_anexos_ler on storage.objects for select to authenticated
  using (bucket_id = 'tarefas-anexos' and ops.tarefas_eh_membro(ops.tarefas_quadro_do_caminho(name)));

drop policy if exists tarefas_anexos_subir on storage.objects;
create policy tarefas_anexos_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'tarefas-anexos' and ops.tarefas_eh_membro(ops.tarefas_quadro_do_caminho(name)));

drop policy if exists tarefas_anexos_apagar on storage.objects;
create policy tarefas_anexos_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'tarefas-anexos' and (
    (owner_id = (select auth.uid())::text and ops.tarefas_eh_membro(ops.tarefas_quadro_do_caminho(name)))
    or ops.tarefas_eh_dono(ops.tarefas_quadro_do_caminho(name))));

-- ------------------------------------------------------------------ tabela

create table if not exists ops.tarefas_anexos (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references ops.tarefas (id) on delete cascade,
  quadro_id uuid not null references ops.tarefas_quadros (id) on delete cascade,
  caminho text not null unique,
  nome text not null check (length(btrim(nome)) between 1 and 255),
  tamanho bigint not null check (tamanho between 0 and 26214400),
  tipo text,
  enviado_por uuid not null references auth.users (id),
  criado_em timestamptz not null default now(),
  constraint tarefas_anexos_caminho_do_quadro check (caminho like quadro_id::text || '/' || tarefa_id::text || '/%')
);
create index if not exists tarefas_anexos_tarefa_idx on ops.tarefas_anexos (tarefa_id, criado_em);
comment on table ops.tarefas_anexos is
  'Arquivos anexados a uma tarefa. O arquivo fica no bucket privado tarefas-anexos (caminho <quadro>/<tarefa>/...); '
  'a linha é o que a ficha lista. Só membro do quadro lê; apaga quem mandou ou o dono.';

-- A tarefa tem que ser do quadro informado (o caminho e a policy do Storage dependem disso).
create or replace function ops.tarefas_anexo_antes_de_gravar()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from ops.tarefas t where t.id = new.tarefa_id and t.quadro_id = new.quadro_id) then
    raise exception 'A tarefa não é deste quadro.';
  end if;
  return new;
end
$$;
drop trigger if exists tarefas_anexo_antes_de_gravar on ops.tarefas_anexos;
create trigger tarefas_anexo_antes_de_gravar
  before insert on ops.tarefas_anexos
  for each row execute function ops.tarefas_anexo_antes_de_gravar();

-- Histórico: anexar e remover aparecem na linha do tempo da ficha.
create or replace function ops.tarefas_anexo_evento()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into ops.tarefas_eventos (tarefa_id, autor_id, campo, para)
    values (new.tarefa_id, coalesce(auth.uid(), new.enviado_por), 'anexo', new.nome);
    return new;
  end if;
  -- Tarefa apagada leva os anexos em cascata: não há onde registrar.
  if exists (select 1 from ops.tarefas t where t.id = old.tarefa_id) then
    insert into ops.tarefas_eventos (tarefa_id, autor_id, campo, de)
    values (old.tarefa_id, auth.uid(), 'anexo', old.nome);
  end if;
  return old;
end
$$;
drop trigger if exists tarefas_anexo_evento on ops.tarefas_anexos;
create trigger tarefas_anexo_evento
  after insert or delete on ops.tarefas_anexos
  for each row execute function ops.tarefas_anexo_evento();

alter table ops.tarefas_anexos enable row level security;
revoke all on ops.tarefas_anexos from public, anon, authenticated;
grant all on ops.tarefas_anexos to service_role;
grant select, insert, delete on ops.tarefas_anexos to authenticated;

create policy tarefas_anexos_ler on ops.tarefas_anexos for select to authenticated
  using (ops.tarefas_eh_membro(quadro_id));
create policy tarefas_anexos_criar on ops.tarefas_anexos for insert to authenticated
  with check (ops.tarefas_eh_membro(quadro_id) and enviado_por = (select auth.uid()));
create policy tarefas_anexos_apagar on ops.tarefas_anexos for delete to authenticated
  using ((enviado_por = (select auth.uid()) and ops.tarefas_eh_membro(quadro_id)) or ops.tarefas_eh_dono(quadro_id));

revoke all on function ops.tarefas_anexo_antes_de_gravar(), ops.tarefas_anexo_evento()
  from public, anon, authenticated;
