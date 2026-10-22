-- Tarefas v2: notificação no sino (22/10/2026, contrato docs/design/contratos/tarefas.md, DECISIONS 22/10).
--
-- Até aqui ops.notificacoes era um mural coletivo do admin (aviso de CAC): sem destinatário, e
-- quando um admin marcava como lida sumia para todos. Agora a linha pode ter dono:
--   destinatario_id nulo  → aviso coletivo, como antes (admin lê e marca; diretor lê).
--   destinatario_id cheio → só aquela pessoa lê e marca. Nem o super admin vê a dos outros
--                           (mesma regra do quadro: tarefa é privada de quem está nele).
--
-- Quem gera, sempre para quem não fez a ação:
--   tarefa_atribuida  tarefa criada com você de responsável, ou passada para você;
--   tarefa_comentario comentário numa tarefa em que você é responsável ou que você criou;
--   tarefa_prazo_hoje às 08:00 de São Paulo, tarefas abertas suas que vencem no dia (pg_cron).
-- A notificação nunca desfaz a gravação da tarefa: erro vira warning.
-- Rollback: supabase/rollback/20261022190000_tarefas_notificacoes_rollback.sql

-- ------------------------------------------------------------------ colunas

alter table ops.notificacoes
  add column if not exists destinatario_id uuid references auth.users (id) on delete cascade,
  add column if not exists ator_id uuid references auth.users (id) on delete set null,
  add column if not exists link text,
  add column if not exists chave text;

comment on column ops.notificacoes.destinatario_id is
  'Dono da notificação. Nulo = aviso coletivo do admin (CAC). Cheio = só essa pessoa lê e marca como lida.';
comment on column ops.notificacoes.link is 'Caminho interno que o clique no sino abre (ex.: /tarefas/quadros/<id>?tarefa=<id>).';
comment on column ops.notificacoes.chave is 'Trava de repetição: a mesma chave não entra duas vezes (ex.: prazo de hoje da mesma tarefa).';

create unique index if not exists uq_notificacoes_chave on ops.notificacoes (chave) where chave is not null;
create index if not exists idx_notificacoes_destinatario
  on ops.notificacoes (destinatario_id, created_at desc) where destinatario_id is not null;

-- ------------------------------------------------------------------ RLS

drop policy if exists "Admins manage notificacoes" on ops.notificacoes;
drop policy if exists "Diretores can read notificacoes" on ops.notificacoes;

create policy notificacoes_ler on ops.notificacoes for select to authenticated
  using (public.tem_produto('ops') and (
    destinatario_id = (select auth.uid())
    or (destinatario_id is null and ((select ops.has_role(auth.uid(), 'admin'::ops.app_role))
                                     or (select ops.has_role(auth.uid(), 'diretor'::ops.app_role))))));

create policy notificacoes_marcar on ops.notificacoes for update to authenticated
  using (public.tem_produto('ops') and (
    destinatario_id = (select auth.uid())
    or (destinatario_id is null and (select ops.has_role(auth.uid(), 'admin'::ops.app_role)))))
  with check (public.tem_produto('ops') and (
    destinatario_id = (select auth.uid())
    or (destinatario_id is null and (select ops.has_role(auth.uid(), 'admin'::ops.app_role)))));

-- Ninguém cria nem apaga pelo navegador: quem escreve são os gatilhos (security definer).
revoke insert, delete, update on ops.notificacoes from authenticated;
grant update (lida, lida_em, lida_por) on ops.notificacoes to authenticated;

-- ------------------------------------------------------------------ gravar uma

create or replace function ops.tarefas_notificar(
  _dest uuid, _ator uuid, _tipo text, _titulo text, _mensagem text, _tarefa uuid, _quadro uuid, _chave text default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if _dest is null or _dest is not distinct from _ator then return; end if;
  -- Só quem ainda está no quadro (o autor pode ter saído).
  if not exists (select 1 from ops.tarefas_membros m where m.quadro_id = _quadro and m.user_id = _dest) then return; end if;
  insert into ops.notificacoes (tipo, titulo, mensagem, destinatario_id, ator_id, link, chave)
  values (_tipo, _titulo, left(_mensagem, 300), _dest, _ator,
          '/tarefas/quadros/' || _quadro || '?tarefa=' || _tarefa, _chave)
  on conflict (chave) where chave is not null do nothing;
end
$$;

create or replace function ops.tarefas_nome(_user uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(p.nome), ''), split_part(p.email, '@', 1), 'Alguém')
    from ops.profiles p where p.user_id = _user
$$;

-- ------------------------------------------------------------------ atribuída a você

create or replace function ops.tarefas_notificar_atribuicao()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  _ator uuid := coalesce(auth.uid(), new.criado_por);
  _quadro text;
begin
  if new.responsavel_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.responsavel_id is not distinct from old.responsavel_id then return new; end if;
  begin
    select q.nome into _quadro from ops.tarefas_quadros q where q.id = new.quadro_id;
    perform ops.tarefas_notificar(
      new.responsavel_id, _ator, 'tarefa_atribuida',
      case when tg_op = 'INSERT' then 'Tarefa nova para você' else 'Tarefa passada para você' end,
      coalesce(ops.tarefas_nome(_ator), 'Alguém') || ' · ' || _quadro || ': ' || new.titulo
        || coalesce(' · prazo ' || to_char(new.prazo, 'DD/MM'), ''),
      new.id, new.quadro_id);
  exception when others then
    raise warning 'tarefas_notificar_atribuicao (tarefa %): %', new.id, sqlerrm;
  end;
  return new;
end
$$;

drop trigger if exists tarefas_notificar_atribuicao on ops.tarefas;
create trigger tarefas_notificar_atribuicao
  after insert or update of responsavel_id on ops.tarefas
  for each row execute function ops.tarefas_notificar_atribuicao();

-- ------------------------------------------------------------------ comentário na sua tarefa

create or replace function ops.tarefas_notificar_comentario()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  _t ops.tarefas;
  _dest uuid;
  _msg text;
begin
  begin
    select * into _t from ops.tarefas where id = new.tarefa_id;
    if not found then return new; end if;
    _msg := coalesce(ops.tarefas_nome(new.autor_id), 'Alguém') || ' em "' || _t.titulo || '": '
      || case when length(new.texto) > 140 then left(new.texto, 140) || '…' else new.texto end;
    for _dest in select distinct u from unnest(array[_t.responsavel_id, _t.criado_por]) as u where u is not null loop
      perform ops.tarefas_notificar(_dest, new.autor_id, 'tarefa_comentario', 'Comentário em tarefa sua',
                                    _msg, _t.id, _t.quadro_id);
    end loop;
  exception when others then
    raise warning 'tarefas_notificar_comentario (comentário %): %', new.id, sqlerrm;
  end;
  return new;
end
$$;

drop trigger if exists tarefas_notificar_comentario on ops.tarefas_comentarios;
create trigger tarefas_notificar_comentario
  after insert on ops.tarefas_comentarios
  for each row execute function ops.tarefas_notificar_comentario();

-- ------------------------------------------------------------------ vence hoje

create or replace function ops.tarefas_notificar_prazo_hoje()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  _hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  _r record;
  _n integer := 0;
begin
  for _r in
    select t.id, t.quadro_id, t.titulo, t.responsavel_id, q.nome as quadro
      from ops.tarefas t
      join ops.tarefas_colunas c on c.id = t.coluna_id and not c.concluida
      join ops.tarefas_quadros q on q.id = t.quadro_id and q.arquivado_em is null
     where t.prazo = _hoje and t.responsavel_id is not null
  loop
    perform ops.tarefas_notificar(_r.responsavel_id, null, 'tarefa_prazo_hoje', 'Vence hoje',
                                  _r.titulo || ' · ' || _r.quadro, _r.id, _r.quadro_id,
                                  'tarefa_prazo_hoje:' || _r.id || ':' || _hoje);
    _n := _n + 1;
  end loop;
  return _n;
end
$$;

revoke all on function ops.tarefas_notificar(uuid, uuid, text, text, text, uuid, uuid, text),
  ops.tarefas_nome(uuid), ops.tarefas_notificar_atribuicao(), ops.tarefas_notificar_comentario(),
  ops.tarefas_notificar_prazo_hoje()
  from public, anon, authenticated;

-- 11:00 UTC = 08:00 em São Paulo (sem horário de verão desde 2019).
select cron.unschedule('tarefas-prazo-hoje') where exists (select 1 from cron.job where jobname = 'tarefas-prazo-hoje');
select cron.schedule('tarefas-prazo-hoje', '0 11 * * *', $cron$ select ops.tarefas_notificar_prazo_hoje(); $cron$);
