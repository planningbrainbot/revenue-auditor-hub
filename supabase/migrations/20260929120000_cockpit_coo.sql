-- Cockpit do COO · Expansão: a área, o espelho do ClickUp e o consumo de IA por cockpit.
--
-- Spec: docs/superpowers/specs/2026-09-29-cockpit-coo-expansao-design.md (aprovada pelo COO, Paulo
-- Carvalho, em 29/09/2026, com ajustes; "pode rodar tudo" do Pedro no mesmo dia).
-- Rollback: supabase/rollback/20260929120000_cockpit_coo_rollback.sql
--
-- Nada do que existe muda de comportamento, com UMA exceção deliberada: o teto de IA passa a ser
-- por cockpit (coluna `cockpit` em ops.cockpit_ia_consumo). A função sem argumento, que o Cockpit
-- do CEO chama, continua existindo e passa a somar só as linhas do CEO; como até hoje só o CEO
-- gravou, o número dela não muda.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. A área. Só o papel admin recebe aqui; o COO entra pela tela de acessos (por pessoa), como o
--    CEO entrou em 28/09. Sem o front publicado, a linha não muda nada para ninguém.
--    `ordem` 68: logo depois do Cockpit do CEO (67), antes de Minha Unidade (70).
-- ---------------------------------------------------------------------------------------------
insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa) values
  ('cockpit_coo', 'Cockpit do COO',
   'A pauta da semana da Expansão: números de todas as unidades, OKRs e compromissos no ClickUp.',
   'nenhum', 68, true)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem, ativa = excluded.ativa;

insert into ops.role_areas (role, area, allowed) values ('admin', 'cockpit_coo', true)
on conflict (role, area) do update set allowed = excluded.allowed, updated_at = now();

-- ---------------------------------------------------------------------------------------------
-- 2. Espelho do ClickUp (space "Operação | Expansão Nacional", 90176460033).
--    Quem grava é só a função de borda clickup-sync (service role) e as escritas do cockpit (servidor).
--    Quem lê é quem tem a área. O ClickUp continua sendo a fonte: o espelho existe para guardar o
--    histórico que a API não entrega (prazo e dono ao longo do tempo) e para não gastar a cota do
--    token (100 req/min, compartilhada com o Growth) a cada abertura de tela.
-- ---------------------------------------------------------------------------------------------
create table if not exists ops.clickup_tarefas (
  id text primary key,
  parent_id text,
  lista_id text,
  lista_nome text,
  pasta_id text,
  pasta_nome text,
  nome text not null,
  url text not null,
  status text not null,
  status_tipo text not null,
  concluida boolean not null default false,
  donos jsonb not null default '[]'::jsonb,
  prazo timestamptz,
  criada_em timestamptz,
  atualizada_em timestamptz,
  concluida_em timestamptz,
  tags text[] not null default '{}',
  tema text,
  unidade text,
  origem text,
  prioridade text,
  sincronizado_em timestamptz not null default now(),
  ausente_desde timestamptz
);
create index if not exists clickup_tarefas_pasta_idx on ops.clickup_tarefas (pasta_nome) where ausente_desde is null;
create index if not exists clickup_tarefas_origem_idx on ops.clickup_tarefas (origem) where origem is not null;

create table if not exists ops.clickup_eventos (
  id bigint generated always as identity primary key,
  tarefa_id text not null,
  tipo text not null check (tipo in ('criada', 'status', 'prazo', 'dono', 'concluida', 'reaberta', 'sumiu')),
  de jsonb,
  para jsonb,
  em timestamptz not null default now(),
  fonte text not null default 'sync' check (fonte in ('sync', 'cockpit'))
);
create index if not exists clickup_eventos_tarefa_idx on ops.clickup_eventos (tarefa_id, em);

-- Toda escrita que o cockpit faz no ClickUp. O token é de uma conta só, e no ClickUp a tarefa
-- aparece como criada pelo dono do token: o autor real fica aqui (e na descrição da tarefa).
create table if not exists ops.cockpit_coo_escritas (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  acao text not null check (acao in ('criar', 'status', 'prazo', 'dono', 'comentar', 'campo')),
  tarefa_id text,
  chave_alerta text,
  payload jsonb not null default '{}'::jsonb,
  resposta_status integer,
  erro text,
  em timestamptz not null default now()
);
create index if not exists cockpit_coo_escritas_chave_idx on ops.cockpit_coo_escritas (chave_alerta) where chave_alerta is not null;

-- Sugestões do Jev (triagem de tema e unidade, duplicidade, bloqueio). Nunca viram campo no
-- ClickUp sozinhas: a pessoa confirma, e só então o servidor grava.
create table if not exists ops.cockpit_coo_sugestoes (
  id bigint generated always as identity primary key,
  tarefa_id text not null,
  pergunta text not null check (pergunta in ('tema', 'unidade', 'bloqueio', 'duplicidade')),
  resposta text,
  confianca numeric(6, 5),
  -- Versão da taxonomia e do limiar calibrado: mudar a taxonomia invalida as sugestões antigas.
  versao text not null,
  -- Texto que foi classificado, resumido: se a tarefa mudar de nome, a sugestão é refeita.
  assinatura text not null,
  estado text not null default 'pendente' check (estado in ('pendente', 'confirmada', 'descartada', 'abaixo_do_limiar')),
  criada_em timestamptz not null default now(),
  decidida_em timestamptz,
  decidida_por uuid references auth.users (id) on delete set null,
  unique (tarefa_id, pergunta, versao, assinatura)
);

alter table ops.clickup_tarefas enable row level security;
alter table ops.clickup_eventos enable row level security;
alter table ops.cockpit_coo_escritas enable row level security;
alter table ops.cockpit_coo_sugestoes enable row level security;

-- ops.tem_area é SECURITY DEFINER; não embrulhar em select (DECISIONS: has_role e o wrap na RLS).
create policy clickup_tarefas_ler on ops.clickup_tarefas
  for select to authenticated using (ops.tem_area('cockpit_coo'));
create policy clickup_eventos_ler on ops.clickup_eventos
  for select to authenticated using (ops.tem_area('cockpit_coo'));
create policy cockpit_coo_escritas_ler on ops.cockpit_coo_escritas
  for select to authenticated using (ops.tem_area('cockpit_coo'));
create policy cockpit_coo_sugestoes_ler on ops.cockpit_coo_sugestoes
  for select to authenticated using (ops.tem_area('cockpit_coo'));

-- Leitura para quem tem a área; escrita só pelo servidor (service role).
revoke all on ops.clickup_tarefas, ops.clickup_eventos, ops.cockpit_coo_escritas,
  ops.cockpit_coo_sugestoes from anon, authenticated;
grant select on ops.clickup_tarefas, ops.clickup_eventos, ops.cockpit_coo_escritas,
  ops.cockpit_coo_sugestoes to authenticated;
grant all on ops.clickup_tarefas, ops.clickup_eventos, ops.cockpit_coo_escritas,
  ops.cockpit_coo_sugestoes to service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. Monitor da integração. Nasce INATIVO: sem o token, a função responde "sem token" e não
--    grava sync_log, e o monitor não acusa atraso. A primeira rodada com token liga o monitor.
-- ---------------------------------------------------------------------------------------------
insert into ops.integracoes_config (fonte, nome_exibicao, tipo, intervalo_esperado_minutos, ativo, observacao)
values ('clickup', 'ClickUp da Expansão Nacional → espelho de tarefas e foto de OKR', 'cron', 10, false,
        'Edge Function clickup-sync, pg_cron a cada 10 min (job clickup-sync-10min). Token em ops.integracoes_segredos (CLICKUP_API_KEY), editável em Administração › Chaves de Integração. Liga sozinho na primeira rodada com token.')
on conflict (fonte) do update set nome_exibicao = excluded.nome_exibicao, tipo = excluded.tipo,
  intervalo_esperado_minutos = excluded.intervalo_esperado_minutos, observacao = excluded.observacao;

-- ---------------------------------------------------------------------------------------------
-- 4. Consumo de IA por cockpit. As linhas existentes são todas do CEO (default 'ceo').
-- ---------------------------------------------------------------------------------------------
alter table ops.cockpit_ia_consumo
  add column if not exists cockpit text not null default 'ceo' check (cockpit in ('ceo', 'coo'));

drop policy if exists cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo;
create policy cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and ((cockpit = 'ceo' and ops.tem_area('cockpit_ceo')) or (cockpit = 'coo' and ops.tem_area('cockpit_coo')))
  );

create or replace function ops.cockpit_ia_orcamento(_cockpit text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'ops', 'public'
as $function$
declare
  _mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  _dia timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if _cockpit not in ('ceo', 'coo') then
    raise exception 'Cockpit desconhecido.' using errcode = '22023';
  end if;
  if auth.uid() is null or not ops.tem_area(case _cockpit when 'ceo' then 'cockpit_ceo' else 'cockpit_coo' end) then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'mes_usd', coalesce((select sum(custo_usd) from ops.cockpit_ia_consumo
        where cockpit = _cockpit and em >= _mes and estado <> 'reservada'), 0),
    'mes_desconhecidas', (select count(*) from ops.cockpit_ia_consumo r
        where r.cockpit = _cockpit and r.em >= _mes and r.estado = 'reservada'
        and not exists (select 1 from ops.cockpit_ia_consumo d where d.reserva_id = r.id and d.estado <> 'reservada')
        and r.em < now() - interval '10 minutes')
      + (select count(*) from ops.cockpit_ia_consumo where cockpit = _cockpit and em >= _mes and custo_desconhecido),
    'dia_usuario_usd', coalesce((select sum(custo_usd) from ops.cockpit_ia_consumo
        where cockpit = _cockpit and em >= _dia and user_id = auth.uid() and estado <> 'reservada'), 0),
    'dia_usuario_chamadas', (select count(*) from ops.cockpit_ia_consumo
        where cockpit = _cockpit and em >= _dia and user_id = auth.uid() and estado = 'reservada')
  );
end
$function$;
revoke all on function ops.cockpit_ia_orcamento(text) from public;
grant execute on function ops.cockpit_ia_orcamento(text) to authenticated, service_role;

-- A função que o Cockpit do CEO chama continua com a mesma assinatura e o mesmo resultado.
create or replace function ops.cockpit_ia_orcamento()
returns jsonb
language sql
stable security definer
set search_path to 'ops', 'public'
as $function$ select ops.cockpit_ia_orcamento('ceo') $function$;
revoke all on function ops.cockpit_ia_orcamento() from public;
grant execute on function ops.cockpit_ia_orcamento() to authenticated, service_role;

commit;

-- ---------------------------------------------------------------------------------------------
-- 5. Agendamento: aplicado SEPARADO, depois de publicar a função clickup-sync
--    (supabase/migrations/20260929120100_cockpit_coo_cron.sql). Mesmo padrão de consultoria-sync.
-- ---------------------------------------------------------------------------------------------
