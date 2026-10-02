-- Tela Gravações da Monetização e "Caixa · Produtos ofertados" gravado pela Edge Function (frente 05, 02/10/2026).
-- Spec: docs/superpowers/specs/2026-10-02-monetizacao-gravacoes-tela.md.
--
-- Quem vê o quê: o closer vê só as reuniões dos próprios cards; admin da Monetização (nível 3) e super admin veem
-- todas. A regra mora aqui, no servidor: a tela lê só pelas duas RPCs abaixo, e a RLS da tabela segue a mesma regra.
-- A transcrição (growth.gravacoes_falas) só sai depois da checagem, e só pela RPC da ficha.
-- Nada no schema growth muda: as funções só leem as tabelas do bot de reuniões, como a Edge Function já faz.

-- 1. Closer = login do Brain com o mesmo e-mail do usuário do Pipedrive dono do card ------------------------------
-- Não existia ponte entre usuário do Brain e usuário do Pipedrive. O e-mail é o mesmo nos dois (conferido em 02/10
-- para os dois closers que recebem card). A Edge Function completa a tabela quando lê o dono do card.
create table if not exists ops.monetizacao_closers (
  pipedrive_user_id bigint primary key,
  nome text not null,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  atualizado_em timestamptz not null default now()
);
alter table ops.monetizacao_closers enable row level security;
revoke all on ops.monetizacao_closers from anon, authenticated;
grant all on ops.monetizacao_closers to service_role;

-- Os closers que recebem card (Pedro, 29/09; src/lib/monetizacao/types.ts, CLOSERS).
insert into ops.monetizacao_closers (pipedrive_user_id, nome, email) values
  (28381245, 'Matheus Carvalho', 'matheus.carvalho@planning.com.br'),
  (24813890, 'Willian Linhares', 'willian.linhares@planning.com.br')
on conflict (pipedrive_user_id) do nothing;

-- 2. O que a reunião somou ao campo "Caixa · Produtos ofertados" do pipe 39, e quando -------------------------------
-- Vazio com data = a reunião foi conferida e não havia nada a somar. Nulo = ainda não conferida (ou chave desligada).
alter table ops.monetizacao_reunioes
  add column if not exists ofertados_gravados text[],
  add column if not exists ofertados_gravados_em timestamptz;

-- 3. Quem é admin e quem é closer ----------------------------------------------------------------------------------
-- As três são SECURITY DEFINER e não leem ops.monetizacao_reunioes nem ops.user_roles pela RLS: podem entrar na policy
-- sem a recursão de has_role (DECISIONS 07/09). Com "ver como" ativo ninguém é admin nem closer, como na Base.
create or replace function ops.monetizacao_gravacoes_admin()
returns boolean
language sql stable security definer set search_path = ops, public, extensions as $$
  select case
    when auth.uid() is null then false
    when ops.ver_como_ativa() then false
    else ops.nivel_na_area(auth.uid(), 'monetizacao') >= 3
  end
$$;

create or replace function ops.monetizacao_gravacoes_closers()
returns bigint[]
language sql stable security definer set search_path = ops, public, extensions as $$
  select coalesce(array_agg(c.pipedrive_user_id order by c.pipedrive_user_id), '{}'::bigint[])
    from ops.monetizacao_closers c
    join auth.users u on lower(u.email) = c.email
   where u.id = auth.uid()
     and not ops.ver_como_ativa()
     and ops.pessoa_ativa(u.id)
$$;

create or replace function ops.monetizacao_gravacoes_pode_ver(_closer bigint)
returns boolean
language sql stable security definer set search_path = ops, public, extensions as $$
  select ops.monetizacao_can('view.monetizacao')
     and (ops.monetizacao_gravacoes_admin()
          or (_closer is not null and _closer = any (ops.monetizacao_gravacoes_closers())))
$$;

revoke all on function ops.monetizacao_gravacoes_admin(), ops.monetizacao_gravacoes_closers(),
  ops.monetizacao_gravacoes_pode_ver(bigint) from public, anon;
grant execute on function ops.monetizacao_gravacoes_admin(), ops.monetizacao_gravacoes_closers(),
  ops.monetizacao_gravacoes_pode_ver(bigint) to authenticated, service_role;

-- 4. RLS da tabela: a mesma regra (antes: qualquer um com view.monetizacao lia todas as linhas, com os trechos) -------
drop policy if exists monetizacao_reunioes_read on ops.monetizacao_reunioes;
create policy monetizacao_reunioes_read on ops.monetizacao_reunioes
  for select to authenticated
  using (ops.monetizacao_gravacoes_pode_ver(closer_pipedrive_id));

-- 5. Lista: sem transcrição e sem trecho; só o que a lista mostra ------------------------------------------------------
create or replace function ops.monetizacao_gravacoes_lista()
returns jsonb
language plpgsql stable security definer set search_path = ops, public, extensions as $$
declare
  v_admin boolean;
  v_closers bigint[];
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  v_admin := ops.monetizacao_gravacoes_admin();
  v_closers := ops.monetizacao_gravacoes_closers();
  return jsonb_build_object(
    'admin', v_admin,
    'closers', to_jsonb(v_closers),
    'reunioes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', r.event_id,
               'deal_id', r.deal_id,
               'tipo', r.tipo,
               'inicio', r.inicio,
               'fim', r.fim,
               'status', r.status,
               'closer_pipedrive_id', r.closer_pipedrive_id,
               'nota', r.nota,
               'ofertado', (select jsonb_object_agg(e.key, coalesce(e.value ->> 'apresentado', '') = 'sim')
                              from jsonb_each(case when jsonb_typeof(r.ofertado) = 'object' then r.ofertado
                                                   else '{}'::jsonb end) e),
               'ofertados_gravados', to_jsonb(r.ofertados_gravados),
               'ofertados_gravados_em', r.ofertados_gravados_em,
               'erro', r.erro,
               'nota_pipedrive_id', r.nota_pipedrive_id,
               'updated_at', r.updated_at,
               'bot', q.joiner_status,
               'transcricao', t.status
             ) order by r.inicio desc)
        from ops.monetizacao_reunioes r
        left join growth.reunioes_agendadas q on q.event_id = r.event_id
        left join lateral (
          select g.id from growth.gravacoes g
           where g.event_id = r.event_id
           order by g.subida_em desc nulls last
           limit 1
        ) g on true
        left join growth.gravacoes_transcricao t on t.gravacao_id = coalesce(r.gravacao_id, g.id)
       where r.status <> 'cancelada'
         and (v_admin or (r.closer_pipedrive_id is not null and r.closer_pipedrive_id = any (v_closers)))
    ), '[]'::jsonb)
  );
end
$$;

-- 6. Ficha: a checagem vem antes de qualquer leitura da transcrição ---------------------------------------------------
-- A mesma mensagem para "não existe" e "é de outro closer": a RPC não confirma a existência de reunião alheia.
create or replace function ops.monetizacao_gravacao(_event_id text)
returns jsonb
language plpgsql stable security definer set search_path = ops, public, extensions as $$
declare
  r ops.monetizacao_reunioes;
  v_grav uuid;
  v_bot text;
  v_bot_erro text;
  v_trans text;
  v_trans_erro text;
  v_duracao integer;
  v_falas jsonb := '[]'::jsonb;
  v_nomes jsonb := '{}'::jsonb;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  select * into r from ops.monetizacao_reunioes m where m.event_id = _event_id and m.status <> 'cancelada';
  if not found or not ops.monetizacao_gravacoes_pode_ver(r.closer_pipedrive_id) then
    raise exception 'Esta reunião não está no seu acesso' using errcode = '42501';
  end if;
  v_grav := coalesce(r.gravacao_id, (select g.id from growth.gravacoes g where g.event_id = r.event_id
                                       order by g.subida_em desc nulls last limit 1));
  select q.joiner_status, q.joiner_erro into v_bot, v_bot_erro
    from growth.reunioes_agendadas q where q.event_id = r.event_id;
  if v_grav is not null then
    select g.duracao_s into v_duracao from growth.gravacoes g where g.id = v_grav;
    select t.status, t.erro into v_trans, v_trans_erro
      from growth.gravacoes_transcricao t where t.gravacao_id = v_grav;
    if v_trans = 'pronta' then
      select coalesce(jsonb_agg(jsonb_build_object('ordem', f.ordem, 'inicio_s', f.inicio_s, 'falante', f.falante,
                                                   'texto', f.texto) order by f.ordem), '[]'::jsonb)
        into v_falas
        from growth.gravacoes_falas f where f.gravacao_id = v_grav;
      select coalesce(jsonb_object_agg(n.rotulo, n.nome) filter (where n.nome is not null), '{}'::jsonb)
        into v_nomes
        from growth.gravacoes_falantes n where n.gravacao_id = v_grav;
    end if;
  end if;
  return jsonb_build_object(
    'event_id', r.event_id,
    'deal_id', r.deal_id,
    'tipo', r.tipo,
    'inicio', r.inicio,
    'fim', r.fim,
    'status', r.status,
    'closer_pipedrive_id', r.closer_pipedrive_id,
    'nota', r.nota,
    'avaliacao', r.avaliacao,
    'ofertado', r.ofertado,
    'ofertados_gravados', to_jsonb(r.ofertados_gravados),
    'ofertados_gravados_em', r.ofertados_gravados_em,
    'erro', r.erro,
    'nota_pipedrive_id', r.nota_pipedrive_id,
    'bot', v_bot,
    'bot_erro', v_bot_erro,
    'transcricao', v_trans,
    'transcricao_erro', v_trans_erro,
    'duracao_s', v_duracao,
    'falas', v_falas,
    'nomes', v_nomes
  );
end
$$;

revoke all on function ops.monetizacao_gravacoes_lista(), ops.monetizacao_gravacao(text) from public, anon;
grant execute on function ops.monetizacao_gravacoes_lista(), ops.monetizacao_gravacao(text) to authenticated;
