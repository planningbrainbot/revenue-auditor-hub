-- Tarefas: quadros com convite e "Minhas tarefas" entre quadros (22/10/2026, contrato
-- docs/design/contratos/tarefas.md, DECISIONS 22/10).
--
-- A regra de quem vê o quê mora AQUI, não na tela: ter a área `tarefas` abre o menu, e
-- dentro dela só o membro do quadro lê ou escreve qualquer coisa do quadro. Nem o super
-- admin vê quadro de que não é membro (decisão do dono no contrato).
--
-- O que tem mais de um passo (criar quadro com colunas e dono, convidar, remover, apagar
-- coluna com tarefa) é função `security definer`, porque o INSERT ... RETURNING de um
-- quadro novo não passaria pela policy de SELECT: o criador só vira membro depois.

-- ------------------------------------------------------------------ área

insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa) values
  ('tarefas', 'Tarefas', 'Quadros de tarefas do time e o que está com cada um.', 'nenhum', 66, true)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem, ativa = excluded.ativa;

-- Todos os papéis da matriz; sócio regional fica de fora na v1.
insert into ops.role_areas (role, area, allowed)
select distinct role, 'tarefas', true from ops.role_areas where role <> 'socio_regional'
on conflict (role, area) do update set allowed = excluded.allowed, updated_at = now();

-- Metade da matriz não tem papel: entra por concessão por pessoa (é o caso do primeiro
-- par). Recebe quem já tem alguma área concedida e não é sócio regional.
insert into ops.usuario_areas (user_id, area, allowed)
select distinct ua.user_id, 'tarefas', true
  from ops.usuario_areas ua
 where ua.allowed
   and not exists (select 1 from ops.user_roles r where r.user_id = ua.user_id and r.role::text = 'socio_regional')
on conflict do nothing;

-- ------------------------------------------------------------------ tabelas

create table if not exists ops.tarefas_quadros (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 1 and 120),
  descricao text check (length(descricao) <= 2000),
  criado_por uuid not null references auth.users (id),
  arquivado_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists ops.tarefas_membros (
  quadro_id uuid not null references ops.tarefas_quadros (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  papel text not null default 'membro' check (papel in ('dono', 'membro')),
  adicionado_por uuid references auth.users (id),
  adicionado_em timestamptz not null default now(),
  primary key (quadro_id, user_id)
);
create index if not exists tarefas_membros_user_idx on ops.tarefas_membros (user_id);

create table if not exists ops.tarefas_colunas (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null references ops.tarefas_quadros (id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  ordem integer not null default 0,
  concluida boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists tarefas_colunas_quadro_idx on ops.tarefas_colunas (quadro_id, ordem);

create table if not exists ops.tarefas_projetos (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null references ops.tarefas_quadros (id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  arquivado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists tarefas_projetos_quadro_idx on ops.tarefas_projetos (quadro_id);

create table if not exists ops.tarefas_departamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (length(btrim(nome)) between 1 and 80),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists ops.tarefas (
  id uuid primary key default gen_random_uuid(),
  quadro_id uuid not null references ops.tarefas_quadros (id) on delete cascade,
  coluna_id uuid not null references ops.tarefas_colunas (id),
  ordem double precision not null default 0,
  titulo text not null check (length(btrim(titulo)) between 1 and 200),
  descricao text check (length(descricao) <= 10000),
  responsavel_id uuid references auth.users (id),
  prazo date,
  prioridade text not null default 'media' check (prioridade in ('alta', 'media', 'baixa')),
  projeto_id uuid references ops.tarefas_projetos (id) on delete set null,
  departamento_id uuid references ops.tarefas_departamentos (id) on delete set null,
  criado_por uuid not null references auth.users (id),
  concluida_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists tarefas_quadro_idx on ops.tarefas (quadro_id, coluna_id, ordem);
create index if not exists tarefas_responsavel_idx on ops.tarefas (responsavel_id);

create table if not exists ops.tarefas_comentarios (
  id uuid primary key default gen_random_uuid(),
  tarefa_id uuid not null references ops.tarefas (id) on delete cascade,
  autor_id uuid not null references auth.users (id),
  texto text not null check (length(btrim(texto)) between 1 and 5000),
  editado_em timestamptz,
  apagado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists tarefas_comentarios_tarefa_idx on ops.tarefas_comentarios (tarefa_id, criado_em);

create table if not exists ops.tarefas_eventos (
  id bigint generated always as identity primary key,
  tarefa_id uuid not null references ops.tarefas (id) on delete cascade,
  autor_id uuid references auth.users (id),
  campo text not null,
  de text,
  para text,
  criado_em timestamptz not null default now()
);
create index if not exists tarefas_eventos_tarefa_idx on ops.tarefas_eventos (tarefa_id, criado_em);

-- ------------------------------------------------------------------ quem pode

-- A mesma régua de `ops.tem_area`, para OUTRA pessoa: quem pode ser convidado.
create or replace function ops.tarefas_pode_usar(_user uuid)
returns boolean
language sql stable security definer set search_path = ops, public
as $$
  select exists (select 1 from public.profiles p where p.user_id = _user and p.ativo)
     and exists (select 1 from public.produto_acesso pa where pa.user_id = _user and pa.produto = 'ops')
     and (
       exists (
         select 1 from ops.user_roles ur
           join ops.role_areas ra on ra.role = ur.role and ra.allowed
           join ops.areas a on a.slug = ra.area and a.ativa
          where ur.user_id = _user and ra.area = 'tarefas'
            and (ur.role::text = 'admin' or not exists (
                  select 1 from ops.usuario_areas b
                   where b.user_id = _user and b.area = 'tarefas' and not b.allowed)))
       or exists (
         select 1 from ops.usuario_areas ua join ops.areas a on a.slug = ua.area and a.ativa
          where ua.user_id = _user and ua.area = 'tarefas' and ua.allowed)
     )
$$;

create or replace function ops.tarefas_eh_membro(_quadro uuid)
returns boolean
language sql stable security definer set search_path = ops, public
as $$
  select ops.tem_area('tarefas')
     and exists (select 1 from ops.tarefas_membros m where m.quadro_id = _quadro and m.user_id = auth.uid())
$$;

create or replace function ops.tarefas_eh_dono(_quadro uuid)
returns boolean
language sql stable security definer set search_path = ops, public
as $$
  select ops.tem_area('tarefas')
     and exists (select 1 from ops.tarefas_membros m
                  where m.quadro_id = _quadro and m.user_id = auth.uid() and m.papel = 'dono')
$$;

-- ------------------------------------------------------------------ gatilhos

create or replace function ops.tarefas_antes_de_gravar()
returns trigger
language plpgsql security definer set search_path = ops, public
as $$
declare
  v_concluida boolean;
begin
  if tg_op = 'UPDATE' and new.quadro_id <> old.quadro_id then
    raise exception 'A tarefa não muda de quadro.';
  end if;
  if tg_op = 'UPDATE' and new.criado_por <> old.criado_por then
    raise exception 'O autor da tarefa não muda.';
  end if;

  select c.concluida into v_concluida
    from ops.tarefas_colunas c where c.id = new.coluna_id and c.quadro_id = new.quadro_id;
  if not found then
    raise exception 'A coluna não é deste quadro.';
  end if;

  if new.responsavel_id is not null and not exists (
       select 1 from ops.tarefas_membros m where m.quadro_id = new.quadro_id and m.user_id = new.responsavel_id) then
    raise exception 'O responsável precisa ser membro do quadro.';
  end if;

  if new.projeto_id is not null and not exists (
       select 1 from ops.tarefas_projetos p where p.id = new.projeto_id and p.quadro_id = new.quadro_id) then
    raise exception 'O projeto não é deste quadro.';
  end if;

  if v_concluida then
    new.concluida_em := coalesce(new.concluida_em, now());
  elsif not v_concluida then
    new.concluida_em := null;
  end if;

  new.atualizado_em := now();
  return new;
end
$$;

drop trigger if exists tarefas_antes_de_gravar on ops.tarefas;
create trigger tarefas_antes_de_gravar
  before insert or update on ops.tarefas
  for each row execute function ops.tarefas_antes_de_gravar();

-- O histórico guarda o texto legível (nome da coluna, da pessoa), não o id: a coluna pode
-- ser renomeada e a pessoa sair do quadro, e o histórico tem que continuar contando o que foi.
create or replace function ops.tarefas_registrar_evento()
returns trigger
language plpgsql security definer set search_path = ops, public
as $$
declare
  ator uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into ops.tarefas_eventos (tarefa_id, autor_id, campo, para)
    values (new.id, coalesce(ator, new.criado_por), 'criada', new.titulo);
    return new;
  end if;

  if new.coluna_id is distinct from old.coluna_id then
    insert into ops.tarefas_eventos (tarefa_id, autor_id, campo, de, para)
    values (new.id, ator, 'status',
            (select nome from ops.tarefas_colunas where id = old.coluna_id),
            (select nome from ops.tarefas_colunas where id = new.coluna_id));
  end if;
  if new.responsavel_id is distinct from old.responsavel_id then
    insert into ops.tarefas_eventos (tarefa_id, autor_id, campo, de, para)
    values (new.id, ator, 'responsavel',
            (select coalesce(nome, email) from ops.profiles where user_id = old.responsavel_id),
            (select coalesce(nome, email) from ops.profiles where user_id = new.responsavel_id));
  end if;
  if new.prazo is distinct from old.prazo then
    insert into ops.tarefas_eventos (tarefa_id, autor_id, campo, de, para)
    values (new.id, ator, 'prazo', to_char(old.prazo, 'DD/MM/YYYY'), to_char(new.prazo, 'DD/MM/YYYY'));
  end if;
  if new.prioridade is distinct from old.prioridade then
    insert into ops.tarefas_eventos (tarefa_id, autor_id, campo, de, para)
    values (new.id, ator, 'prioridade', old.prioridade, new.prioridade);
  end if;
  return new;
end
$$;

drop trigger if exists tarefas_registrar_evento on ops.tarefas;
create trigger tarefas_registrar_evento
  after insert or update on ops.tarefas
  for each row execute function ops.tarefas_registrar_evento();

-- Quem sai do quadro deixa as tarefas sem responsável (contrato: Remover membro).
create or replace function ops.tarefas_membro_saiu()
returns trigger
language plpgsql security definer set search_path = ops, public
as $$
begin
  update ops.tarefas set responsavel_id = null
   where quadro_id = old.quadro_id and responsavel_id = old.user_id;
  return old;
end
$$;

drop trigger if exists tarefas_membro_saiu on ops.tarefas_membros;
create trigger tarefas_membro_saiu
  after delete on ops.tarefas_membros
  for each row execute function ops.tarefas_membro_saiu();

-- ------------------------------------------------------------------ RLS

alter table ops.tarefas_quadros enable row level security;
alter table ops.tarefas_membros enable row level security;
alter table ops.tarefas_colunas enable row level security;
alter table ops.tarefas_projetos enable row level security;
alter table ops.tarefas_departamentos enable row level security;
alter table ops.tarefas enable row level security;
alter table ops.tarefas_comentarios enable row level security;
alter table ops.tarefas_eventos enable row level security;

revoke all on ops.tarefas_quadros, ops.tarefas_membros, ops.tarefas_colunas, ops.tarefas_projetos,
  ops.tarefas_departamentos, ops.tarefas, ops.tarefas_comentarios, ops.tarefas_eventos
  from public, anon, authenticated;
grant all on ops.tarefas_quadros, ops.tarefas_membros, ops.tarefas_colunas, ops.tarefas_projetos,
  ops.tarefas_departamentos, ops.tarefas, ops.tarefas_comentarios, ops.tarefas_eventos
  to service_role;

-- Quadro e membros: leitura direta, escrita só pelas funções (exceto renomear e arquivar).
grant select, update (nome, descricao, arquivado_em) on ops.tarefas_quadros to authenticated;
create policy tarefas_quadros_ler on ops.tarefas_quadros for select to authenticated
  using (ops.tarefas_eh_membro(id));
create policy tarefas_quadros_editar on ops.tarefas_quadros for update to authenticated
  using (ops.tarefas_eh_dono(id)) with check (ops.tarefas_eh_dono(id));

grant select on ops.tarefas_membros to authenticated;
create policy tarefas_membros_ler on ops.tarefas_membros for select to authenticated
  using (ops.tarefas_eh_membro(quadro_id));

grant select, insert, update (nome, ordem, concluida) on ops.tarefas_colunas to authenticated;
create policy tarefas_colunas_ler on ops.tarefas_colunas for select to authenticated
  using (ops.tarefas_eh_membro(quadro_id));
create policy tarefas_colunas_criar on ops.tarefas_colunas for insert to authenticated
  with check (ops.tarefas_eh_dono(quadro_id));
create policy tarefas_colunas_editar on ops.tarefas_colunas for update to authenticated
  using (ops.tarefas_eh_dono(quadro_id)) with check (ops.tarefas_eh_dono(quadro_id));

grant select, insert, update (nome, arquivado_em) on ops.tarefas_projetos to authenticated;
create policy tarefas_projetos_ler on ops.tarefas_projetos for select to authenticated
  using (ops.tarefas_eh_membro(quadro_id));
create policy tarefas_projetos_criar on ops.tarefas_projetos for insert to authenticated
  with check (ops.tarefas_eh_dono(quadro_id));
create policy tarefas_projetos_editar on ops.tarefas_projetos for update to authenticated
  using (ops.tarefas_eh_dono(quadro_id)) with check (ops.tarefas_eh_dono(quadro_id));

grant select, insert, update (nome, ativo) on ops.tarefas_departamentos to authenticated;
create policy tarefas_departamentos_ler on ops.tarefas_departamentos for select to authenticated
  using (ops.tem_area('tarefas'));
create policy tarefas_departamentos_criar on ops.tarefas_departamentos for insert to authenticated
  with check (ops.tem_area('admin'));
create policy tarefas_departamentos_editar on ops.tarefas_departamentos for update to authenticated
  using (ops.tem_area('admin')) with check (ops.tem_area('admin'));

grant select, insert, delete,
  update (coluna_id, ordem, titulo, descricao, responsavel_id, prazo, prioridade, projeto_id, departamento_id)
  on ops.tarefas to authenticated;
create policy tarefas_ler on ops.tarefas for select to authenticated
  using (ops.tarefas_eh_membro(quadro_id));
create policy tarefas_criar on ops.tarefas for insert to authenticated
  with check (ops.tarefas_eh_membro(quadro_id) and criado_por = auth.uid());
create policy tarefas_editar on ops.tarefas for update to authenticated
  using (ops.tarefas_eh_membro(quadro_id)) with check (ops.tarefas_eh_membro(quadro_id));
create policy tarefas_apagar on ops.tarefas for delete to authenticated
  using (ops.tarefas_eh_membro(quadro_id) and (criado_por = auth.uid() or ops.tarefas_eh_dono(quadro_id)));

grant select, insert, update (texto, editado_em, apagado_em) on ops.tarefas_comentarios to authenticated;
create policy tarefas_comentarios_ler on ops.tarefas_comentarios for select to authenticated
  using (exists (select 1 from ops.tarefas t where t.id = tarefa_id and ops.tarefas_eh_membro(t.quadro_id)));
create policy tarefas_comentarios_criar on ops.tarefas_comentarios for insert to authenticated
  with check (autor_id = auth.uid()
              and exists (select 1 from ops.tarefas t where t.id = tarefa_id and ops.tarefas_eh_membro(t.quadro_id)));
create policy tarefas_comentarios_editar on ops.tarefas_comentarios for update to authenticated
  using (autor_id = auth.uid()) with check (autor_id = auth.uid());

grant select on ops.tarefas_eventos to authenticated;
create policy tarefas_eventos_ler on ops.tarefas_eventos for select to authenticated
  using (exists (select 1 from ops.tarefas t where t.id = tarefa_id and ops.tarefas_eh_membro(t.quadro_id)));

-- ------------------------------------------------------------------ funções de escrita

create or replace function ops.tarefas_criar_quadro(_nome text, _descricao text default null)
returns uuid
language plpgsql security definer set search_path = ops, public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null or not ops.tem_area('tarefas') then
    raise exception 'Você não tem a área Tarefas.';
  end if;
  insert into ops.tarefas_quadros (nome, descricao, criado_por)
  values (btrim(_nome), nullif(btrim(coalesce(_descricao, '')), ''), auth.uid())
  returning id into v_id;
  insert into ops.tarefas_membros (quadro_id, user_id, papel, adicionado_por)
  values (v_id, auth.uid(), 'dono', auth.uid());
  insert into ops.tarefas_colunas (quadro_id, nome, ordem, concluida) values
    (v_id, 'A fazer', 0, false), (v_id, 'Fazendo', 1, false), (v_id, 'Feito', 2, true);
  return v_id;
end
$$;

create or replace function ops.tarefas_buscar_pessoas(_quadro uuid, _texto text)
returns table (user_id uuid, nome text, email text)
language plpgsql stable security definer set search_path = ops, public
as $$
begin
  if not ops.tarefas_eh_dono(_quadro) then
    raise exception 'Só o dono do quadro convida.';
  end if;
  if length(btrim(coalesce(_texto, ''))) < 2 then
    return;
  end if;
  return query
    select p.user_id, coalesce(op.nome, p.nome), p.email
      from public.profiles p
      left join ops.profiles op on op.user_id = p.user_id
     where p.ativo
       and (coalesce(op.nome, p.nome) ilike '%' || btrim(_texto) || '%' or p.email ilike '%' || btrim(_texto) || '%')
       and not exists (select 1 from ops.tarefas_membros m where m.quadro_id = _quadro and m.user_id = p.user_id)
       and ops.tarefas_pode_usar(p.user_id)
     order by 2
     limit 10;
end
$$;

create or replace function ops.tarefas_convidar(_quadro uuid, _user uuid)
returns void
language plpgsql security definer set search_path = ops, public
as $$
begin
  if not ops.tarefas_eh_dono(_quadro) then
    raise exception 'Só o dono do quadro convida.';
  end if;
  if not ops.tarefas_pode_usar(_user) then
    raise exception 'Essa pessoa não tem a área Tarefas. Peça à administração para liberar.';
  end if;
  insert into ops.tarefas_membros (quadro_id, user_id, papel, adicionado_por)
  values (_quadro, _user, 'membro', auth.uid())
  on conflict do nothing;
end
$$;

create or replace function ops.tarefas_mudar_papel(_quadro uuid, _user uuid, _papel text)
returns void
language plpgsql security definer set search_path = ops, public
as $$
begin
  if not ops.tarefas_eh_dono(_quadro) then
    raise exception 'Só o dono do quadro muda papéis.';
  end if;
  if _papel not in ('dono', 'membro') then
    raise exception 'Papel inválido.';
  end if;
  if _papel = 'membro' and (select count(*) from ops.tarefas_membros
                             where quadro_id = _quadro and papel = 'dono' and user_id <> _user) = 0 then
    raise exception 'O quadro precisa de pelo menos um dono.';
  end if;
  update ops.tarefas_membros set papel = _papel where quadro_id = _quadro and user_id = _user;
end
$$;

-- O dono remove qualquer um; o membro pode sair sozinho.
create or replace function ops.tarefas_remover_membro(_quadro uuid, _user uuid)
returns void
language plpgsql security definer set search_path = ops, public
as $$
begin
  if not (ops.tarefas_eh_dono(_quadro) or (_user = auth.uid() and ops.tarefas_eh_membro(_quadro))) then
    raise exception 'Só o dono do quadro remove pessoas.';
  end if;
  if (select count(*) from ops.tarefas_membros
       where quadro_id = _quadro and papel = 'dono' and user_id <> _user) = 0 then
    raise exception 'O quadro precisa de pelo menos um dono. Passe o quadro para outra pessoa antes.';
  end if;
  delete from ops.tarefas_membros where quadro_id = _quadro and user_id = _user;
end
$$;

create or replace function ops.tarefas_apagar_coluna(_coluna uuid, _destino uuid default null)
returns void
language plpgsql security definer set search_path = ops, public
as $$
declare
  v_quadro uuid;
begin
  select quadro_id into v_quadro from ops.tarefas_colunas where id = _coluna;
  if v_quadro is null or not ops.tarefas_eh_dono(v_quadro) then
    raise exception 'Só o dono do quadro mexe nas colunas.';
  end if;
  if (select count(*) from ops.tarefas_colunas where quadro_id = v_quadro) <= 1 then
    raise exception 'O quadro precisa de pelo menos uma coluna.';
  end if;
  if exists (select 1 from ops.tarefas where coluna_id = _coluna) then
    if _destino is null or _destino = _coluna
       or not exists (select 1 from ops.tarefas_colunas where id = _destino and quadro_id = v_quadro) then
      raise exception 'A coluna tem tarefas: escolha para qual coluna elas vão.';
    end if;
    update ops.tarefas set coluna_id = _destino where coluna_id = _coluna;
  end if;
  delete from ops.tarefas_colunas where id = _coluna;
end
$$;

revoke all on function ops.tarefas_pode_usar(uuid), ops.tarefas_eh_membro(uuid), ops.tarefas_eh_dono(uuid),
  ops.tarefas_criar_quadro(text, text), ops.tarefas_buscar_pessoas(uuid, text), ops.tarefas_convidar(uuid, uuid),
  ops.tarefas_mudar_papel(uuid, uuid, text), ops.tarefas_remover_membro(uuid, uuid),
  ops.tarefas_apagar_coluna(uuid, uuid)
  from public, anon;
revoke all on function ops.tarefas_pode_usar(uuid) from authenticated;
grant execute on function ops.tarefas_eh_membro(uuid), ops.tarefas_eh_dono(uuid),
  ops.tarefas_criar_quadro(text, text), ops.tarefas_buscar_pessoas(uuid, text), ops.tarefas_convidar(uuid, uuid),
  ops.tarefas_mudar_papel(uuid, uuid, text), ops.tarefas_remover_membro(uuid, uuid),
  ops.tarefas_apagar_coluna(uuid, uuid)
  to authenticated;
revoke all on function ops.tarefas_antes_de_gravar(), ops.tarefas_registrar_evento(), ops.tarefas_membro_saiu()
  from public, anon, authenticated;
