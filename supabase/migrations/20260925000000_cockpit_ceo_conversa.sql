-- Cockpit do CEO · "Perguntar ao Brain": histórico privado, visões salvas e consumo de IA.
--
-- Autorizado pelo Pedro em 24/09/2026 ("pode aplicar"): três tabelas privadas por pessoa e o
-- registro de consumo, sem tocar em nada que já existe. Rollback:
-- supabase/rollback/20260925000000_cockpit_ceo_conversa_rollback.sql
--
-- Privacidade:
-- - conversas, mensagens e visões: só o dono lê e escreve, e só com a área `cockpit_ceo`
--   (ops.tem_area é SECURITY DEFINER; não embrulhar em select, ver DECISIONS sobre has_role);
-- - a visão guarda a DEFINIÇÃO (consultas e filtros), nunca os números: ao reabrir, as consultas
--   rodam de novo com a permissão vigente;
-- - o texto da mensagem é o que a pessoa escreveu e a conclusão que ela leu; nenhum registro bruto
--   de cliente entra aqui.
-- Consumo de IA: uma linha por chamada (Jev ou modelo), sem texto de pergunta. Cada pessoa vê só as
-- dela; o total do mês para o teto global sai de ops.cockpit_ia_orcamento(), que devolve agregado.

create table if not exists ops.cockpit_conversas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  titulo text not null check (char_length(titulo) between 1 and 120),
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists cockpit_conversas_user_idx
  on ops.cockpit_conversas (user_id, atualizada_em desc);

create table if not exists ops.cockpit_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references ops.cockpit_conversas (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  papel text not null check (papel in ('usuario', 'assistente')),
  texto text not null check (char_length(texto) <= 4000),
  -- Definição da visão (spec v1): consultas, argumentos e filtros. Sem números.
  visao jsonb,
  -- Estado da resposta, modelo, classificação do Jev, frases descartadas, latência, sugestões.
  metadados jsonb not null default '{}'::jsonb,
  criada_em timestamptz not null default now()
);
create index if not exists cockpit_mensagens_conversa_idx
  on ops.cockpit_mensagens (conversa_id, criada_em);

create table if not exists ops.cockpit_visoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nome text not null check (char_length(nome) between 1 and 120),
  definicao jsonb not null,
  conversa_id uuid references ops.cockpit_conversas (id) on delete set null,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists cockpit_visoes_user_idx on ops.cockpit_visoes (user_id, atualizada_em desc);

create table if not exists ops.cockpit_ia_consumo (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  em timestamptz not null default now(),
  tipo text not null check (tipo in ('jev', 'modelo')),
  modelo text not null,
  -- 'reservada' é gravada ANTES da chamada; o desfecho é outra linha com o mesmo reserva_id.
  estado text not null check (estado in ('reservada', 'ok', 'falha', 'cancelada')),
  reserva_id uuid,
  custo_usd numeric(12, 6),
  custo_desconhecido boolean not null default false,
  tokens_entrada integer,
  tokens_saida integer,
  latencia_ms integer,
  codigo text
);
create index if not exists cockpit_ia_consumo_em_idx on ops.cockpit_ia_consumo (em);

alter table ops.cockpit_conversas enable row level security;
alter table ops.cockpit_mensagens enable row level security;
alter table ops.cockpit_visoes enable row level security;
alter table ops.cockpit_ia_consumo enable row level security;

create policy cockpit_conversas_dono on ops.cockpit_conversas
  for all to authenticated
  using (user_id = auth.uid() and ops.tem_area('cockpit_ceo'))
  with check (user_id = auth.uid() and ops.tem_area('cockpit_ceo'));

create policy cockpit_mensagens_dono on ops.cockpit_mensagens
  for all to authenticated
  using (user_id = auth.uid() and ops.tem_area('cockpit_ceo'))
  with check (
    user_id = auth.uid() and ops.tem_area('cockpit_ceo')
    and exists (select 1 from ops.cockpit_conversas c where c.id = conversa_id and c.user_id = auth.uid())
  );

create policy cockpit_visoes_dono on ops.cockpit_visoes
  for all to authenticated
  using (user_id = auth.uid() and ops.tem_area('cockpit_ceo'))
  with check (
    user_id = auth.uid() and ops.tem_area('cockpit_ceo')
    and (conversa_id is null or exists (
      select 1 from ops.cockpit_conversas c where c.id = conversa_id and c.user_id = auth.uid()))
  );

-- Consumo: a pessoa lê e grava só as próprias linhas; não altera nem apaga (o teto não se zera).
create policy cockpit_ia_consumo_ler on ops.cockpit_ia_consumo
  for select to authenticated using (user_id = auth.uid());
create policy cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo
  for insert to authenticated
  with check (user_id = auth.uid() and ops.tem_area('cockpit_ceo'));

grant select, insert, update, delete on ops.cockpit_conversas to authenticated;
grant select, insert, update, delete on ops.cockpit_mensagens to authenticated;
grant select, insert, update, delete on ops.cockpit_visoes to authenticated;
grant select, insert on ops.cockpit_ia_consumo to authenticated;
-- O privilégio padrão do schema dá tudo a authenticated; aqui o consumo fica só leitura e inserção.
revoke update, delete, truncate on ops.cockpit_ia_consumo from authenticated;
grant all on ops.cockpit_conversas, ops.cockpit_mensagens, ops.cockpit_visoes,
  ops.cockpit_ia_consumo to service_role;
revoke all on ops.cockpit_conversas, ops.cockpit_mensagens, ops.cockpit_visoes,
  ops.cockpit_ia_consumo from anon;

-- Orçamento: agregado do mês (todas as pessoas) e do dia (só quem pergunta). Nenhuma linha de
-- outra pessoa sai daqui, só somas. Só quem tem a área pergunta.
create or replace function ops.cockpit_ia_orcamento()
returns jsonb
language plpgsql
stable security definer
set search_path to 'ops', 'public'
as $function$
declare
  _mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  _dia timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if auth.uid() is null or not ops.tem_area('cockpit_ceo') then
    raise exception 'Acesso negado.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'mes_usd', coalesce((select sum(custo_usd) from ops.cockpit_ia_consumo where em >= _mes and estado <> 'reservada'), 0),
    'mes_desconhecidas', (select count(*) from ops.cockpit_ia_consumo r where r.em >= _mes and r.estado = 'reservada'
        and not exists (select 1 from ops.cockpit_ia_consumo d where d.reserva_id = r.id and d.estado <> 'reservada')
        and r.em < now() - interval '10 minutes')
      + (select count(*) from ops.cockpit_ia_consumo where em >= _mes and custo_desconhecido),
    'dia_usuario_usd', coalesce((select sum(custo_usd) from ops.cockpit_ia_consumo
        where em >= _dia and user_id = auth.uid() and estado <> 'reservada'), 0),
    'dia_usuario_chamadas', (select count(*) from ops.cockpit_ia_consumo
        where em >= _dia and user_id = auth.uid() and estado = 'reservada')
  );
end
$function$;
revoke all on function ops.cockpit_ia_orcamento() from public;
grant execute on function ops.cockpit_ia_orcamento() to authenticated, service_role;
