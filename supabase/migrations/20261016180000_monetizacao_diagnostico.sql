-- Base nova da Monetização: pipe 40 do Pipedrive (Onboarding | Diagnóstico de Oportunidades). Pedido do Pedro em
-- 16/10/2026; PRD https://claude.ai/artifact/9SapRMdQ3ydy8srToQ7NSn.
--
-- A carga do pipe 40 é separada da do pipe 39 (ops.monetizacao_deals) de propósito: IDU, ranking das unidades e
-- Cockpits leem ops.monetizacao_deals sem filtro de pipe, e o diagnóstico não deve entrar nessas contas sem decisão.
--
-- ORDEM DE PUBLICAÇÃO: a Edge Function `monetizacao-diagnostico` (com --no-verify-jwt) ANTES desta migration. O cron
-- abaixo passa a chamá-la a cada 5 minutos assim que esta migration roda.
-- KILL SWITCH: fica na função. A carga só lê o Pipedrive e roda sempre. A entrada automática (MONET_DIAG_ENTRADA_ATIVA)
-- e as tarefas (MONET_DIAG_TAREFAS_ATIVA) só escrevem com "sim"; fora disso a rodada grava só a prévia.

create table if not exists ops.monetizacao_diagnostico_deals (
  id bigint primary key,
  org_id bigint,
  payload jsonb not null,
  unidade_ids integer[] not null default '{}',
  updated_at timestamptz not null default now()
);
comment on table ops.monetizacao_diagnostico_deals is
  'Retrato do pipe 40 (base nova): um card por linha, no formato de montarCard (monetizacao-diagnostico/logica.ts). '
  'Escrita só por ops.monetizacao_diagnostico_gravar (service role); a tela lê por ops.monetizacao_diagnostico_painel().';

create table if not exists ops.monetizacao_diagnostico_sync (
  id boolean primary key default true check (id),
  status text,
  measured_at timestamptz,
  tentado_em timestamptz,
  error text,
  count integer,
  stages jsonb not null default '[]'::jsonb,
  previa jsonb not null default '{}'::jsonb,
  resumo jsonb not null default '{}'::jsonb
);
insert into ops.monetizacao_diagnostico_sync (id) values (true) on conflict (id) do nothing;
comment on column ops.monetizacao_diagnostico_sync.previa is
  'O que a entrada e as tarefas fariam com a chave desligada: {gerada_em, entradas[], tarefas[]}. Vazia quando ligadas.';

create table if not exists ops.monetizacao_diagnostico_entradas (
  venda_id bigint primary key,
  org_id bigint,
  deal_id bigint,
  status text not null check (status in ('criado', 'conta_ja_no_pipe')),
  motivo text,
  ganho_em date,
  criado_em timestamptz not null default now()
);
comment on table ops.monetizacao_diagnostico_entradas is
  'Venda ganha no pipe 2 (Inside Sales) que virou card no pipe 40, ou que foi ligada ao card que a conta já tinha '
  '(um card por conta). A chave venda_id é a idempotência: a mesma venda nunca cria dois cards.';

create table if not exists ops.monetizacao_diagnostico_tarefas (
  deal_id bigint not null,
  etapa text not null,
  entrou_em text not null,
  chave text not null,
  user_id bigint,
  assunto text,
  due_date date,
  activity_id bigint,
  status text not null default 'aberta' check (status in ('aberta', 'feita', 'apagada')),
  versao text not null,
  criado_em timestamptz not null default now(),
  encerrado_em timestamptz,
  motivo text,
  primary key (deal_id, entrou_em, chave)
);
comment on table ops.monetizacao_diagnostico_tarefas is
  'Tarefas que a régua do pipe 40 criou (monetizacao-diagnostico/regua.ts): uma linha por tarefa, por entrada do card '
  'numa etapa. entrou_em é o stage_change_time do Pipedrive como texto (a idempotência compara o texto exato). '
  'aberta: no Pipedrive, a fazer. feita: marcada como feita. apagada: o card saiu da etapa e a tarefa não feita saiu.';
create index if not exists monetizacao_diagnostico_tarefas_abertas
  on ops.monetizacao_diagnostico_tarefas (deal_id) where status = 'aberta';

alter table ops.monetizacao_diagnostico_deals enable row level security;
alter table ops.monetizacao_diagnostico_sync enable row level security;
alter table ops.monetizacao_diagnostico_entradas enable row level security;
alter table ops.monetizacao_diagnostico_tarefas enable row level security;
revoke all on ops.monetizacao_diagnostico_deals, ops.monetizacao_diagnostico_sync,
  ops.monetizacao_diagnostico_entradas, ops.monetizacao_diagnostico_tarefas from public, anon, authenticated;
grant all on ops.monetizacao_diagnostico_deals, ops.monetizacao_diagnostico_sync,
  ops.monetizacao_diagnostico_entradas, ops.monetizacao_diagnostico_tarefas to service_role;

-- Unidade do card pelo rótulo "Unidade de Negócio" da venda, com as mesmas trocas da carga da Base (Matriz = Goiânia).
create or replace function ops.monetizacao_diagnostico_unidade(_rotulo text)
returns integer[]
language sql
stable
set search_path to 'ops', 'public'
as $$
  select coalesce(array_agg(u.id order by u.id), '{}')
    from ops.unidades u
   where _rotulo is not null
     and lower(translate(u.nome_da_praca, 'áàâãéêíóôõúç', 'aaaaeeiooouc')) = lower(translate(
           case when _rotulo in ('Matriz', 'Goiânia / Matriz') then 'Goiânia'
                when _rotulo like 'BPO Financeiro%' then 'BPO Financeiro'
                when _rotulo = 'Sudeste (RJ)' then 'Rio de Janeiro'
                else _rotulo end,
           'áàâãéêíóôõúç', 'aaaaeeiooouc'));
$$;

-- Grava o retrato da rodada. Recusa apagar o pipe inteiro de uma vez (leitura estranha da API não zera a tela).
create or replace function ops.monetizacao_diagnostico_gravar(_retrato jsonb)
returns integer
language plpgsql
security definer
set search_path to 'ops', 'public'
as $$
declare
  v_cards jsonb := coalesce(_retrato->'cards', '[]'::jsonb);
  v_novos integer := jsonb_array_length(coalesce(_retrato->'cards', '[]'::jsonb));
  v_antes integer := (select count(*) from ops.monetizacao_diagnostico_deals);
begin
  if v_novos = 0 and v_antes > 5 then
    raise exception 'Retrato do pipe 40 veio vazio com % cards gravados; carga anterior preservada', v_antes;
  end if;
  insert into ops.monetizacao_diagnostico_deals (id, org_id, payload, unidade_ids, updated_at)
  select (c->>'id')::bigint, nullif(c->>'org_id', '')::bigint, c, ops.monetizacao_diagnostico_unidade(c->>'unidade'), now()
    from jsonb_array_elements(v_cards) c
  on conflict (id) do update
    set org_id = excluded.org_id, payload = excluded.payload, unidade_ids = excluded.unidade_ids, updated_at = now();
  delete from ops.monetizacao_diagnostico_deals d
   where not exists (select 1 from jsonb_array_elements(v_cards) c where (c->>'id')::bigint = d.id);
  update ops.monetizacao_diagnostico_sync
     set status = 'ok', measured_at = now(), tentado_em = now(), error = null, count = v_novos,
         stages = coalesce(_retrato->'stages', '[]'::jsonb),
         previa = coalesce(_retrato->'previa', '{}'::jsonb),
         resumo = coalesce(_retrato->'resumo', '{}'::jsonb)
   where id;
  return v_novos;
end;
$$;
revoke all on function ops.monetizacao_diagnostico_gravar(jsonb) from public, anon, authenticated;
grant execute on function ops.monetizacao_diagnostico_gravar(jsonb) to service_role;

-- Leitura das três telas (seção Base nova): mesma porta e mesmo recorte de unidade de ops.monetizacao_deals_leitura().
-- A prévia (nomes de contas que ainda não estão no pipe) só sai para quem vê todas as unidades.
create or replace function ops.monetizacao_diagnostico_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'ops', 'public'
as $$
declare
  v_pode boolean := ops.monetizacao_can('view.monetizacao');
  v_todas boolean := coalesce((select e.todas_unidades from ops.usuario_escopo e where e.user_id = auth.uid()), false);
  v_minhas integer[] := array(select ops.minhas_unidades());
begin
  if not v_pode then return null; end if;
  return jsonb_build_object(
    'sync', (select to_jsonb(s) - 'id' - case when v_todas then '' else 'previa' end
               from ops.monetizacao_diagnostico_sync s where s.id),
    'cards', coalesce((select jsonb_agg(d.payload || jsonb_build_object('unidade_ids', to_jsonb(d.unidade_ids)) order by d.id)
                         from ops.monetizacao_diagnostico_deals d
                        where v_todas or d.unidade_ids && v_minhas), '[]'::jsonb),
    'tarefas', coalesce((select jsonb_agg(to_jsonb(t) order by t.due_date, t.deal_id)
                           from ops.monetizacao_diagnostico_tarefas t
                          where (t.status = 'aberta' or t.criado_em > now() - interval '120 days')
                            and (v_todas or exists (select 1 from ops.monetizacao_diagnostico_deals d
                                                     where d.id = t.deal_id and d.unidade_ids && v_minhas))),
                        '[]'::jsonb)
  );
end;
$$;
revoke all on function ops.monetizacao_diagnostico_painel() from public, anon;
grant execute on function ops.monetizacao_diagnostico_painel() to authenticated;

-- O cron chama a Edge Function a cada 5 minutos, dois minutos depois dos outros da Monetização (o banco único satura
-- no horário comercial), com o mesmo segredo da carga do CRM.
create or replace function ops.monetizacao_diagnostico_cron()
returns bigint
language sql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/monetizacao-diagnostico',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monetizacao-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'monetizacao_sync_secret')
    ),
    body := '{"action":"rodar"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function ops.monetizacao_diagnostico_cron() from public, anon, authenticated;

select cron.unschedule('monetizacao-diagnostico-5min')
 where exists (select 1 from cron.job where jobname = 'monetizacao-diagnostico-5min');
select cron.schedule('monetizacao-diagnostico-5min', '2-59/5 * * * *', $cron$
 select ops.monetizacao_diagnostico_cron();
$cron$);
