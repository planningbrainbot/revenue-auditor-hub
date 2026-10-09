-- Pré-venda da Monetização: as ligações da Api4Com nos cards do pipe 39, a avaliação da ligação mais longa de cada
-- card contra o script v2 (09/10/2026) e as quatro funções da tela Pré-venda. Pedido do Pedro em 09/10/2026 (PRD
-- https://claude.ai/artifact/VVsFAthHk5cSdd8yuLHSwg, decisões 3B e 4B).
-- Contrato (fonte da verdade das tabelas e das RPCs): monetizacao/outputs/2026-10-09-pre-venda-v2/contrato-pre-venda.md.
--
-- ORDEM DE PUBLICAÇÃO: a Edge Function `monetizacao-ligacoes` (com --no-verify-jwt) ANTES desta migration. O cron
-- abaixo passa a chamá-la a cada 5 minutos assim que esta migration roda.
-- KILL SWITCH: fica na função. Sem o secret MONET_LIGACOES_ATIVA=sim ela só captura (lê o Pipedrive e grava as
-- ligações aqui, sem IA); sem MONET_LIGACOES_NOTAS=sim não escreve no Pipedrive.

-- 1. Ligações ----------------------------------------------------------------------------------------------------
create table if not exists ops.monetizacao_ligacoes (
  activity_id bigint primary key,
  deal_id bigint not null,
  user_id bigint,
  pessoa text,
  inicio timestamptz,
  duracao_seg integer not null default 0 check (duracao_seg >= 0),
  atendida boolean not null default false,
  motivo text,
  mp3_url text,
  telefone text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table ops.monetizacao_ligacoes is
  'Uma linha por atividade de ligação da Api4Com num card do pipe 39 (formato "Ligação para (DD) … atendida às …" '
  'ou "… não foi atendida pelo seguinte motivo: …"). Atividade de ligação criada à mão não entra. '
  'Escrita só pela Edge Function monetizacao-ligacoes (service role), que relê hoje e os 2 dias anteriores a cada 5 min.';
comment on column ops.monetizacao_ligacoes.user_id is 'Dono da atividade no Pipedrive = quem discou.';
comment on column ops.monetizacao_ligacoes.pessoa is 'Nome do dono da atividade no Pipedrive (owner_name).';
comment on column ops.monetizacao_ligacoes.inicio is
  '"atendida às" (horário de Brasília no texto, gravado em UTC) ou, na não atendida, a data e hora da atividade.';
comment on column ops.monetizacao_ligacoes.duracao_seg is '"duração: HH:MM:SS" da Api4Com; 0 na não atendida.';
comment on column ops.monetizacao_ligacoes.motivo is 'Motivo da não atendida (Cancelada, Caixa postal, Ocupado...).';
comment on column ops.monetizacao_ligacoes.mp3_url is
  'Link público do áudio na Api4Com (listener.api4com.com), lido da nota da atividade.';

create index if not exists monetizacao_ligacoes_deal on ops.monetizacao_ligacoes (deal_id);
create index if not exists monetizacao_ligacoes_inicio on ops.monetizacao_ligacoes (inicio);

alter table ops.monetizacao_ligacoes enable row level security;
revoke all on ops.monetizacao_ligacoes from public, anon, authenticated;
grant all on ops.monetizacao_ligacoes to service_role;

-- 2. Avaliação: uma por card, da ligação atendida mais longa com 60 s ou mais (decisão 3B) -----------------------
create table if not exists ops.monetizacao_ligacao_avaliacoes (
  deal_id bigint primary key,
  activity_id bigint,
  user_id bigint,
  pessoa text,
  empresa text,
  inicio timestamptz,
  duracao_seg integer,
  mp3_url text,
  status text not null default 'pendente'
    check (status in ('pendente', 'transcrevendo', 'transcrita', 'avaliada', 'erro')),
  erro text,
  transcricao jsonb check (transcricao is null or jsonb_typeof(transcricao) = 'array'),
  avaliacao jsonb check (avaliacao is null or jsonb_typeof(avaliacao) = 'object'),
  nota numeric(5, 1) check (nota is null or nota between 0 and 100),
  regua_versao text,
  nota_qualificacao_id bigint,
  nota_avaliacao_id bigint,
  tentativas integer not null default 0,
  custo_usd numeric(10, 6),
  modelos text,
  notas_em timestamptz,
  atualizado_em timestamptz not null default now()
);

comment on table ops.monetizacao_ligacao_avaliacoes is
  'Avaliação automática da ligação de qualificação da pré-venda, uma por card do pipe 39: a ligação atendida mais '
  'longa, de 60 s ou mais, com mp3. Apareceu uma mais longa, a linha volta a pendente e as notas do card são '
  'atualizadas (não duplicadas). Escrita só pela Edge Function monetizacao-ligacoes (service role).';
comment on column ops.monetizacao_ligacao_avaliacoes.status is
  'pendente → transcrevendo → transcrita → avaliada; erro depois de 3 tentativas (ou áudio que não abre 6 h depois).';
comment on column ops.monetizacao_ligacao_avaliacoes.transcricao is
  '[{"falante":"pre_venda"|"cliente","texto":"…","inicio_seg":12}], transcrita pela OpenRouter (modelo com áudio).';
comment on column ops.monetizacao_ligacao_avaliacoes.avaliacao is
  'blocos (abertura, perguntas, fechamento), perguntas (momento, capital, porte, teses), antipadroes, qualificacao '
  '(resumo, frentes finance/cella, quem_decide, proximo_passo) e oportunidade. Trecho que não foi achado na '
  'transcrição foi rebaixado pelo código. Formato no contrato da tela.';
comment on column ops.monetizacao_ligacao_avaliacoes.nota is
  '0 a 100: 100 × (abertura×1 + (perguntas feitas ÷ 4)×3 + fechamento×2) ÷ 6, com sim = 1, parcial = 0,5, não = 0.';
comment on column ops.monetizacao_ligacao_avaliacoes.regua_versao is 'VERSAO_REGUA de rubrica-ligacao.ts.';
comment on column ops.monetizacao_ligacao_avaliacoes.nota_qualificacao_id is
  'Id da nota "Qualificação da ligação por IA" no card. Reaproveitada (PUT) quando a avaliação é refeita.';
comment on column ops.monetizacao_ligacao_avaliacoes.nota_avaliacao_id is
  'Id da nota "Avaliação da ligação por IA (script v2)" no card. Reaproveitada (PUT) quando a avaliação é refeita.';
comment on column ops.monetizacao_ligacao_avaliacoes.tentativas is
  'Falhas seguidas da etapa em curso (transcrição ou avaliação). Volta a 0 quando a etapa passa.';
comment on column ops.monetizacao_ligacao_avaliacoes.custo_usd is 'Custo na OpenRouter (usage.cost) da transcrição e da avaliação.';
comment on column ops.monetizacao_ligacao_avaliacoes.notas_em is
  'Quando as duas notas do card foram escritas ou atualizadas para esta avaliação. Nulo = notas pendentes.';

create index if not exists monetizacao_ligacao_avaliacoes_fila on ops.monetizacao_ligacao_avaliacoes (status, atualizado_em);
create index if not exists monetizacao_ligacao_avaliacoes_inicio on ops.monetizacao_ligacao_avaliacoes (inicio);

alter table ops.monetizacao_ligacao_avaliacoes enable row level security;
revoke all on ops.monetizacao_ligacao_avaliacoes from public, anon, authenticated;
grant all on ops.monetizacao_ligacao_avaliacoes to service_role;

-- 3. Cadência: cada atividade ganha feita/feita_em (gravados pela função monetizacao-cadencia) --------------------
comment on column ops.monetizacao_cadencia.atividades is
  'Atividades criadas no Pipedrive: [{id, chave, dia, canal, tipo, turno, due_date, due_time, feita, feita_em}], due '
  'em UTC. Gravada a cada atividade criada, para a rodada seguinte completar só o que falta. feita e feita_em '
  '(marked_as_done_time, UTC) são relidos do card a cada rodada, nas ativas e nas encerradas há menos de 2 dias. '
  'No encerramento, só as desta lista que não foram feitas são apagadas.';

-- 4. Apoio das RPCs (internas: sem execute para o app) -------------------------------------------------------------
-- Instante de um texto de data do Pipedrive: "AAAA-MM-DD HH:MM[:SS]" é UTC; ISO com fuso vale como está.
create or replace function ops.monetizacao_pre_venda_instante(_s text)
returns timestamptz
language sql stable set search_path = ops, public as $$
  select case
    when _s is null or btrim(_s) = '' then null
    when btrim(_s) ~ '\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s*([zZ]|[+-]\d{2}(:?\d{2})?)$' then btrim(_s)::timestamptz
    else btrim(_s)::timestamp at time zone 'UTC'
  end
$$;

-- Nome de cada usuário do Pipedrive: o cadastro dos closers, senão o dono da ligação, senão o dono do card.
create or replace function ops.monetizacao_pre_venda_pessoas()
returns table (user_id bigint, pessoa text)
language sql stable set search_path = ops, public as $$
  select distinct on (x.user_id) x.user_id, x.pessoa
    from (
      select c.pipedrive_user_id as user_id, c.nome as pessoa, 1 as prioridade
        from ops.monetizacao_closers c
      union all
      select l.user_id, l.pessoa, 2
        from ops.monetizacao_ligacoes l
       where l.user_id is not null and nullif(btrim(l.pessoa), '') is not null
      union all
      select (d.payload ->> 'owner_id')::bigint, d.payload ->> 'owner', 3
        from ops.monetizacao_deals d
       where d.payload ->> 'owner_id' ~ '^\d+$' and nullif(btrim(d.payload ->> 'owner'), '') is not null
    ) x
   order by x.user_id, x.prioridade
$$;

revoke all on function ops.monetizacao_pre_venda_instante(text), ops.monetizacao_pre_venda_pessoas()
  from public, anon, authenticated;
grant execute on function ops.monetizacao_pre_venda_instante(text), ops.monetizacao_pre_venda_pessoas()
  to service_role;

-- 5. RPCs da tela --------------------------------------------------------------------------------------------------
-- Acesso: o mesmo de ops.monetizacao_gravacoes_lista() para quem é da Monetização (ops.monetizacao_can
-- ('view.monetizacao')), SEM a trava por closer: todos os que veem a Monetização veem tudo (decisão 4B).
-- Dias no fuso America/Sao_Paulo.

-- 5.1 Ritmo: por dia e por pessoa, abordagens, atividades da cadência e ligações.
--   abordagens: cards com payload.started_at no dia, pelo dono do card (leitura provisória; o Pedro vai refatorar).
--   atividades: itens da cadência com vencimento no dia, pelo dono da cadência. Na cadência encerrada, o Brain apagou
--   as não feitas na saída da etapa: contam a feita e a que venceu antes da saída (vencida).
--   vencidas: vencimento passou (antes da saída, na encerrada) e feita não é true.
--   ligações: ops.monetizacao_ligacoes por quem discou e dia do início; minutos falados = só as atendidas.
create or replace function ops.monetizacao_pre_venda_ritmo(p_de date, p_ate date)
returns table (
  dia date,
  user_id bigint,
  pessoa text,
  abordagens integer,
  atividades_previstas integer,
  atividades_feitas integer,
  atividades_vencidas integer,
  ligacoes integer,
  ligacoes_atendidas integer,
  minutos_falados numeric
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
declare
  v_de timestamptz;
  v_ate timestamptz;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  if p_ate - p_de > 366 then
    raise exception 'Período maior que um ano' using errcode = '22023';
  end if;
  v_de := p_de::timestamp at time zone 'America/Sao_Paulo';
  v_ate := (p_ate + 1)::timestamp at time zone 'America/Sao_Paulo';
  return query
  with abord as (
    select (ops.monetizacao_pre_venda_instante(d.payload ->> 'started_at') at time zone 'America/Sao_Paulo')::date as dia,
           case when d.payload ->> 'owner_id' ~ '^\d+$' then (d.payload ->> 'owner_id')::bigint end as user_id,
           nullif(btrim(d.payload ->> 'owner'), '') as nome
      from ops.monetizacao_deals d
     where nullif(d.payload ->> 'started_at', '') is not null
  ),
  atv as (
    select c.dono as user_id,
           ops.monetizacao_pre_venda_instante(
             (a ->> 'due_date') || ' ' || coalesce(nullif(a ->> 'due_time', ''), '00:00')) as vence,
           coalesce((a ->> 'feita')::boolean, false) as feita,
           case when c.status = 'encerrada' then coalesce(c.encerrado_em, now()) else now() end as corte
      from ops.monetizacao_cadencia c
      cross join lateral jsonb_array_elements(c.atividades) a
     where c.status in ('ativa', 'encerrada')
       and nullif(a ->> 'due_date', '') is not null
  ),
  atv_validas as (
    select * from atv a where a.feita or a.corte >= now() or a.vence < a.corte
  ),
  lig as (
    select (l.inicio at time zone 'America/Sao_Paulo')::date as dia, l.user_id, l.atendida, l.duracao_seg
      from ops.monetizacao_ligacoes l
     where l.inicio >= v_de and l.inicio < v_ate and l.user_id is not null
  ),
  tudo as (
    select a.dia, a.user_id, a.nome, 1 as abordagens, 0 as previstas, 0 as feitas, 0 as vencidas,
           0 as ligacoes, 0 as atendidas, 0::numeric as segundos
      from abord a
     where a.dia between p_de and p_ate
    union all
    select (v.vence at time zone 'America/Sao_Paulo')::date, v.user_id, null, 0, 1,
           case when v.feita then 1 else 0 end,
           case when not v.feita and v.vence < v.corte then 1 else 0 end,
           0, 0, 0
      from atv_validas v
     where v.vence >= v_de and v.vence < v_ate
    union all
    select g.dia, g.user_id, null, 0, 0, 0, 0, 1,
           case when g.atendida then 1 else 0 end,
           case when g.atendida then g.duracao_seg else 0 end
      from lig g
  )
  select t.dia,
         t.user_id,
         coalesce(p.pessoa, max(t.nome), 'Sem responsável') as pessoa,
         sum(t.abordagens)::integer,
         sum(t.previstas)::integer,
         sum(t.feitas)::integer,
         sum(t.vencidas)::integer,
         sum(t.ligacoes)::integer,
         sum(t.atendidas)::integer,
         round(sum(t.segundos) / 60.0, 1)
    from tudo t
    left join ops.monetizacao_pre_venda_pessoas() p on p.user_id = t.user_id
   group by t.dia, t.user_id, p.pessoa
  having sum(t.abordagens) + sum(t.previstas) + sum(t.feitas) + sum(t.vencidas) + sum(t.ligacoes)
         + sum(t.atendidas) + sum(t.segundos) > 0
   order by t.dia, 3;
end
$$;

-- 5.2 Atrasados: cards com cadência ativa e ao menos uma atividade vencida e não feita.
--   dia_cadencia: o maior Dn da régua que já venceu; proxima: assunto da próxima atividade não feita
--   ("Caixa · D{n} · {canal} · {manhã|tarde}", o mesmo que a função monetizacao-cadencia grava no Pipedrive).
create or replace function ops.monetizacao_pre_venda_atrasados()
returns table (
  deal_id bigint,
  empresa text,
  user_id bigint,
  pessoa text,
  dia_cadencia integer,
  vencidas integer,
  proxima text,
  url text
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  return query
  with itens as (
    select c.deal_id, c.entrou_em, c.dono,
           nullif(a ->> 'dia', '')::integer as dia,
           'Caixa · D' || coalesce(a ->> 'dia', '?') || ' · ' || coalesce(a ->> 'canal', '?') || ' · '
             || case a ->> 'turno' when 'manha' then 'manhã' when 'tarde' then 'tarde' else coalesce(a ->> 'turno', '?') end
             as assunto,
           ops.monetizacao_pre_venda_instante(
             (a ->> 'due_date') || ' ' || coalesce(nullif(a ->> 'due_time', ''), '00:00')) as vence,
           coalesce((a ->> 'feita')::boolean, false) as feita
      from ops.monetizacao_cadencia c
      cross join lateral jsonb_array_elements(c.atividades) a
     where c.status = 'ativa'
  ),
  por_card as (
    select i.deal_id, i.dono,
           coalesce(max(i.dia) filter (where i.vence <= now()), 0) as dia_cadencia,
           (count(*) filter (where not i.feita and i.vence < now()))::integer as vencidas,
           (array_agg(i.assunto order by i.vence, i.dia) filter (where not i.feita))[1] as proxima
      from itens i
     group by i.deal_id, i.entrou_em, i.dono
  )
  select p.deal_id,
         coalesce(nullif(d.payload ->> 'org', ''), d.payload ->> 'title'),
         p.dono,
         coalesce(n.pessoa, d.payload ->> 'owner'),
         p.dia_cadencia,
         p.vencidas,
         p.proxima,
         'https://grupoplanning.pipedrive.com/deal/' || p.deal_id
    from por_card p
    left join ops.monetizacao_deals d on d.id = p.deal_id
    left join ops.monetizacao_pre_venda_pessoas() n on n.user_id = p.dono
   where p.vencidas > 0
   order by p.vencidas desc, p.deal_id;
end
$$;

-- 5.3 Avaliações do período (por início da ligação avaliada), mais recentes primeiro.
create or replace function ops.monetizacao_pre_venda_avaliacoes(p_de date, p_ate date)
returns table (
  deal_id bigint,
  empresa text,
  user_id bigint,
  pessoa text,
  inicio timestamptz,
  duracao_seg integer,
  status text,
  nota numeric,
  blocos jsonb,
  perguntas jsonb,
  antipadroes jsonb
)
language plpgsql stable security definer set search_path = ops, public as $$
#variable_conflict use_column
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de then
    raise exception 'Período inválido' using errcode = '22023';
  end if;
  return query
  select a.deal_id, a.empresa, a.user_id, coalesce(n.pessoa, a.pessoa), a.inicio, a.duracao_seg, a.status, a.nota,
         a.avaliacao -> 'blocos', a.avaliacao -> 'perguntas', a.avaliacao -> 'antipadroes'
    from ops.monetizacao_ligacao_avaliacoes a
    left join ops.monetizacao_pre_venda_pessoas() n on n.user_id = a.user_id
   where a.inicio >= (p_de::timestamp at time zone 'America/Sao_Paulo')
     and a.inicio < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
   order by a.inicio desc, a.deal_id;
end
$$;

-- 5.4 Ficha de um card: a linha inteira da avaliação + o link do card. null quando o card não tem avaliação.
create or replace function ops.monetizacao_pre_venda_avaliacao(p_deal bigint)
returns jsonb
language plpgsql stable security definer set search_path = ops, public as $$
declare
  v jsonb;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização' using errcode = '42501';
  end if;
  select to_jsonb(a) || jsonb_build_object('url', 'https://grupoplanning.pipedrive.com/deal/' || a.deal_id)
    into v
    from ops.monetizacao_ligacao_avaliacoes a
   where a.deal_id = p_deal;
  return v;
end
$$;

revoke all on function ops.monetizacao_pre_venda_ritmo(date, date), ops.monetizacao_pre_venda_atrasados(),
  ops.monetizacao_pre_venda_avaliacoes(date, date), ops.monetizacao_pre_venda_avaliacao(bigint) from public, anon;
grant execute on function ops.monetizacao_pre_venda_ritmo(date, date), ops.monetizacao_pre_venda_atrasados(),
  ops.monetizacao_pre_venda_avaliacoes(date, date), ops.monetizacao_pre_venda_avaliacao(bigint) to authenticated;

-- 6. Cron: a cada 5 minutos, com o mesmo segredo da carga do CRM, das reuniões e da cadência ----------------------
create or replace function ops.monetizacao_ligacoes_cron()
returns bigint
language sql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/monetizacao-ligacoes',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monetizacao-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'monetizacao_sync_secret')
    ),
    body := '{"action":"rodar"}'::jsonb,
    timeout_milliseconds := 150000
  );
$$;

revoke all on function ops.monetizacao_ligacoes_cron() from public, anon, authenticated;

select cron.unschedule('monetizacao-ligacoes-5min')
 where exists (select 1 from cron.job where jobname = 'monetizacao-ligacoes-5min');
select cron.schedule('monetizacao-ligacoes-5min', '*/5 * * * *', $cron$
 select ops.monetizacao_ligacoes_cron();
$cron$);
