-- Portal de Faturamento · T6, notificações por e-mail (RF-P12), em fila e em simulação (20/10/2026).
--
-- Plano: PM Work/execution/portal-faturamento-prd-20261013/e1/PLANO-E1.md (Travas: e-mail desligado por variável;
-- linha T6). Spec: §5.3 RF-P12. API: e1/API.md ("Mudanças", notificações).
-- Depende de 20261020120000 (T1b), 20261020170000 (ajustes) e 20261020190000 (conector do Pipefy), aplicadas antes.
-- Ensaio (begin … rollback): supabase/gates/20261020_portal_faturamento_notificacoes.sql
-- Rollback: supabase/rollback/20261020200000_portal_faturamento_notificacoes_rollback.sql
--
-- O que faz:
--   1. integracoes.notificacoes: a fila de e-mails do portal. Cada linha é um destinatário (user_id) de uma transição
--      (receita.fat_eventos.id). O e-mail é resolvido na hora do envio, em public.profiles. Assunto e corpo são
--      montados pelo conector e gravados no resultado. Unique (evento, pedido, destinatário, transição): a mesma pessoa
--      não recebe duas vezes a mesma transição, nem quando é dona e solicitante ao mesmo tempo.
--   2. Quem alimenta: um gatilho AFTER INSERT em receita.fat_eventos (a linha que receita.fat_transicao grava em toda
--      mudança de situação). Nenhuma RPC muda de contrato e receita.fat_transicao não é tocada. Erro ao montar a
--      notificação vira aviso (raise warning) e nunca desfaz a transição do pedido.
--        OK pendente (→ aguardando_ok): dono e substituto; sem linha ativa de dono, os gestores da emissora.
--        devolvido: o autor (solicitante), com o motivo.
--        faturado (da fila, da OS, da conferência ou do erro; não a volta de em atraso ou recebido): dono e
--          solicitante, com número e link da nota.
--        em atraso: o dono.
--        erro no Omie: o autor e a tesouraria da emissora (chave edit.faturamento_tesouraria e a emissora no recorte).
--   3. integracoes.fat_notificacoes_proximos / fat_notificacoes_resultado e as passagens em ops (só service_role).
-- O envio é da edge faturamento-omie. Sem FATURAMENTO_EMAIL=sim na env dela, nada sai: a linha fica `simulado` com o
-- e-mail pronto. Pedido simulado no Omie (simulacao = true) nunca gera e-mail de verdade.

begin;

-- =================================================================================================================
-- 1. Fila
-- =================================================================================================================
create table integracoes.notificacoes (
  id uuid primary key default gen_random_uuid(),
  evento text not null check (evento in ('ok_pendente', 'devolvido', 'faturado', 'em_atraso', 'erro_omie')),
  pedido_id uuid not null references receita.fat_pedidos (id),
  emissora_id uuid not null references organizacao.empresas_grupo (id),
  transicao_id bigint not null references receita.fat_eventos (id),
  destinatario_id uuid not null,
  papel text not null check (papel in ('dono', 'substituto', 'gestor', 'autor', 'solicitante', 'tesouraria')),
  dados jsonb not null default '{}'::jsonb check (jsonb_typeof(dados) = 'object'),
  email text,
  assunto text,
  corpo text,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'simulado', 'enviado', 'erro')),
  tentativas integer not null default 0 check (tentativas >= 0),
  proxima_tentativa_em timestamptz not null default now(),
  resposta jsonb,
  erro_legivel text,
  enviado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notificacoes_unica unique (evento, pedido_id, destinatario_id, transicao_id),
  constraint notificacoes_erro_legivel check (status <> 'erro' or nullif(btrim(erro_legivel), '') is not null),
  constraint notificacoes_enviado check (status <> 'enviado' or (enviado_em is not null and email is not null))
);
comment on table integracoes.notificacoes is
  'Domínio Integrações. Dono: Portal de Faturamento (T6). Fila dos e-mails do portal (RF-P12): uma linha por '
  'destinatário de cada transição do pedido (receita.fat_eventos.id), alimentada pelo gatilho '
  'receita.fat_notificar_evento. O e-mail do destinatário é lido em public.profiles na hora do envio; assunto e corpo '
  'vêm do conector (edge faturamento-omie). Sem FATURAMENTO_EMAIL=sim na edge, status simulado com o e-mail pronto. '
  'O navegador não lê: RLS sem policy e nenhum GRANT para authenticated.';
comment on column integracoes.notificacoes.dados is
  'Foto do pedido no momento da transição para o texto do e-mail (número, emissora, cliente, valor, projeto, motivo, '
  'nota, simulacao). Sem CPF nem CNPJ.';
create index notificacoes_fila_idx on integracoes.notificacoes (proxima_tentativa_em) where status = 'pendente';
create index notificacoes_pedido_idx on integracoes.notificacoes (pedido_id);
create trigger notificacoes_updated_at before update on integracoes.notificacoes
  for each row execute function integracoes.tocar_updated_at();

alter table integracoes.notificacoes enable row level security;
revoke all on integracoes.notificacoes from public, anon, authenticated, service_role;
grant select, insert, update on integracoes.notificacoes to service_role;

-- =================================================================================================================
-- 2. Quem recebe o quê: gatilho em receita.fat_eventos
-- =================================================================================================================
create or replace function receita.fat_notificar_evento()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  _p receita.fat_pedidos;
  _apelido text;
  _evento text;
  _dados jsonb;
  _dono_ativo receita.fat_donos;
  _dest jsonb := '[]'::jsonb;
begin
  if new.entidade <> 'pedido' or new.para is null or new.de is not distinct from new.para then return new; end if;
  _evento := case new.para
    when 'aguardando_ok' then 'ok_pendente'
    when 'devolvido' then 'devolvido'
    when 'faturado' then case when new.de in ('em_atraso', 'recebido') then null else 'faturado' end
    when 'em_atraso' then 'em_atraso'
    when 'erro_omie' then 'erro_omie'
  end;
  if _evento is null then return new; end if;

  begin
    select * into _p from receita.fat_pedidos where id = new.entidade_id;
    if not found then return new; end if;
    select g.apelido into _apelido from organizacao.empresas_grupo g where g.id = _p.emissora_id;
    _dados := jsonb_build_object(
      'numero', _p.numero, 'emissora', _apelido, 'tomador_nome', _p.tomador_nome, 'tomador_tipo', _p.tomador_tipo,
      'valor', _p.valor, 'projeto', _p.projeto, 'primeiro_vencimento', _p.primeiro_vencimento,
      'parcelas', _p.parcelas, 'documento', _p.documento,
      'motivo', coalesce(nullif(btrim(new.diff ->> 'motivo'), ''), _p.motivo_status),
      'nf_numero', _p.omie_nf_numero, 'nf_link', _p.omie_nf_link, 'simulacao', _p.simulacao,
      'de', new.de, 'para', new.para, 'evento_origem', new.evento);

    -- Lista (destinatário, papel) na ordem de prioridade: o unique deixa a primeira quando a pessoa se repete.

    if _evento = 'ok_pendente' then
      select * into _dono_ativo from receita.fat_donos d
       where d.emissora_id = _p.emissora_id and d.user_id = _p.dono_id and d.papel = 'dono' and d.ativo
       limit 1;
      if found then
        _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.dono_id, 'p', 'dono'));
        if _dono_ativo.substituto_id is not null then
          _dest := _dest || jsonb_build_object('o', 2, 'u', _dono_ativo.substituto_id, 'p', 'substituto');
        end if;
      else
        _dest := coalesce((select jsonb_agg(jsonb_build_object('o', 3, 'u', d.user_id, 'p', 'gestor'))
                             from receita.fat_donos d
                            where d.emissora_id = _p.emissora_id and d.papel = 'gestor' and d.ativo), '[]'::jsonb);
      end if;
    elsif _evento = 'devolvido' then
      _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.solicitante_id, 'p', 'autor'));
    elsif _evento = 'faturado' then
      _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.dono_id, 'p', 'dono'),
                                 jsonb_build_object('o', 2, 'u', _p.solicitante_id, 'p', 'solicitante'));
    elsif _evento = 'em_atraso' then
      _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.dono_id, 'p', 'dono'));
    elsif _evento = 'erro_omie' then
      _dest := jsonb_build_array(jsonb_build_object('o', 1, 'u', _p.solicitante_id, 'p', 'autor'))
        || coalesce((
        select jsonb_agg(jsonb_build_object('o', 2, 'u', u.user_id, 'p', 'tesouraria'))
          from public.profiles u
         where u.ativo
           and ops.can_user(u.user_id, 'view.faturamento')
           and ops.can_user(u.user_id, 'edit.faturamento_tesouraria')
           and (coalesce((select e.todas_empresas from ops.usuario_escopo e where e.user_id = u.user_id), false)
                or exists (select 1 from ops.usuario_empresas ue
                            where ue.user_id = u.user_id and ue.empresa_id = _p.emissora_id))), '[]'::jsonb);
    end if;

    insert into integracoes.notificacoes (evento, pedido_id, emissora_id, transicao_id, destinatario_id, papel, dados)
    select _evento, _p.id, _p.emissora_id, new.id, d.u, d.p, _dados
      from jsonb_to_recordset(_dest) as d(o int, u uuid, p text)
      join public.profiles pr on pr.user_id = d.u
     where d.u is not null
     order by d.o
    on conflict on constraint notificacoes_unica do nothing;
  exception when others then
    -- A notificação nunca desfaz a transição do pedido.
    raise warning 'fat_notificar_evento (pedido %, evento %): %', new.entidade_id, _evento, sqlerrm;
  end;
  return new;
end $$;
comment on function receita.fat_notificar_evento() is
  'Gatilho de receita.fat_eventos: toda transição de pedido que pede e-mail (RF-P12) vira linhas em '
  'integracoes.notificacoes, uma por destinatário. Falha vira warning e não desfaz a transição.';
revoke all on function receita.fat_notificar_evento() from public, anon, authenticated;

create trigger fat_eventos_notificar after insert on receita.fat_eventos
  for each row when (new.entidade = 'pedido' and new.para is not null and new.de is distinct from new.para)
  execute function receita.fat_notificar_evento();

-- =================================================================================================================
-- 3. O conector reserva e responde
-- =================================================================================================================
create or replace function integracoes.fat_notificacoes_proximos(p_limite integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _ids uuid[];
begin
  perform integracoes.fat_exigir_conector();
  if p_limite is null or p_limite < 1 or p_limite > 100 then
    raise exception 'p_limite vai de 1 a 100.' using errcode = '22023';
  end if;
  update integracoes.notificacoes set status = 'pendente', proxima_tentativa_em = now()
   where status = 'processando' and updated_at < now() - interval '15 minutes';
  with cand as (
    select n.id from integracoes.notificacoes n
     where n.status = 'pendente' and n.proxima_tentativa_em <= now()
     order by n.proxima_tentativa_em, n.created_at
     limit p_limite
     for update skip locked
  ), upd as (
    update integracoes.notificacoes n set status = 'processando', tentativas = n.tentativas + 1
      from cand where n.id = cand.id
    returning n.id
  )
  select array_agg(upd.id) into _ids from upd;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', n.id, 'evento', n.evento, 'papel', n.papel, 'pedido_id', n.pedido_id,
             'emissora', jsonb_build_object('id', g.id, 'apelido', g.apelido), 'tentativas', n.tentativas,
             'destinatario', jsonb_build_object('id', n.destinatario_id, 'nome', u.nome, 'email', lower(u.email),
                                                'ativo', coalesce(u.ativo, false)),
             'dados', n.dados)
           order by n.proxima_tentativa_em, n.created_at)
      from integracoes.notificacoes n
      join organizacao.empresas_grupo g on g.id = n.emissora_id
      left join public.profiles u on u.user_id = n.destinatario_id
     where n.id = any (_ids)), '[]'::jsonb);
end $$;
comment on function integracoes.fat_notificacoes_proximos(integer) is
  'Reserva até p_limite notificações pendentes (for update skip locked) com o e-mail atual do destinatário. Devolve à '
  'fila o que está em processamento há mais de 15 minutos. Só o service_role.';

create or replace function integracoes.fat_notificacoes_resultado(
  p_id uuid, p_status text, p_email text default null, p_assunto text default null, p_corpo text default null,
  p_erro_legivel text default null, p_resposta jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _n integracoes.notificacoes;
  _erro text := nullif(btrim(p_erro_legivel), '');
begin
  perform integracoes.fat_exigir_conector();
  select * into _n from integracoes.notificacoes where id = p_id for update;
  if not found then raise exception 'Notificação não encontrada.' using errcode = 'P0002'; end if;
  if _n.status <> 'processando' then
    raise exception 'A notificação % está %, não processando.', _n.id, _n.status using errcode = '55000';
  end if;
  if p_status not in ('simulado', 'enviado', 'erro', 'pendente') then
    raise exception 'p_status: simulado, enviado, erro ou pendente.' using errcode = '22023';
  end if;
  if p_status = 'erro' and _erro is null then
    raise exception 'Erro sem p_erro_legivel.' using errcode = '22023';
  end if;
  if p_status = 'enviado' and nullif(btrim(p_email), '') is null then
    raise exception 'Enviado sem p_email.' using errcode = '22023';
  end if;
  if p_resposta is not null and jsonb_typeof(p_resposta) = 'object' and p_resposta ?| array['api_key', 'authorization'] then
    raise exception 'p_resposta não guarda chave.' using errcode = '22023';
  end if;
  update integracoes.notificacoes
     set status = p_status,
         email = coalesce(nullif(btrim(p_email), ''), email),
         assunto = coalesce(p_assunto, assunto),
         corpo = coalesce(p_corpo, corpo),
         erro_legivel = _erro,
         resposta = p_resposta,
         enviado_em = case when p_status = 'enviado' then now() else enviado_em end,
         proxima_tentativa_em = case when p_status = 'pendente' then now() + case
             when tentativas <= 1 then interval '1 minute' when tentativas = 2 then interval '5 minutes'
             when tentativas = 3 then interval '15 minutes' else interval '60 minutes' end
           else proxima_tentativa_em end
   where id = _n.id returning * into _n;
  return jsonb_build_object('notificacao', jsonb_build_object('id', _n.id, 'status', _n.status));
end $$;
comment on function integracoes.fat_notificacoes_resultado(uuid, text, text, text, text, text, jsonb) is
  'Resultado do envio de uma notificação reservada: simulado (FATURAMENTO_EMAIL desligado ou pedido simulado), '
  'enviado, erro (com p_erro_legivel) ou pendente (volta com espera 1, 5, 15 e 60 min). Só o service_role.';

create or replace function ops.fat_conector_notificacoes_proximos(p_limite integer default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_notificacoes_proximos(p_limite);
end $$;
create or replace function ops.fat_conector_notificacoes_resultado(
  p_id uuid, p_status text, p_email text default null, p_assunto text default null, p_corpo text default null,
  p_erro_legivel text default null, p_resposta jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform integracoes.fat_exigir_conector();
  return integracoes.fat_notificacoes_resultado(p_id, p_status, p_email, p_assunto, p_corpo, p_erro_legivel, p_resposta);
end $$;
comment on function ops.fat_conector_notificacoes_proximos(integer) is
  'Passagem do conector (service_role) para integracoes.fat_notificacoes_proximos.';
comment on function ops.fat_conector_notificacoes_resultado(uuid, text, text, text, text, text, jsonb) is
  'Passagem do conector (service_role) para integracoes.fat_notificacoes_resultado.';

revoke all on function integracoes.fat_notificacoes_proximos(integer),
                       integracoes.fat_notificacoes_resultado(uuid, text, text, text, text, text, jsonb),
                       ops.fat_conector_notificacoes_proximos(integer),
                       ops.fat_conector_notificacoes_resultado(uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function integracoes.fat_notificacoes_proximos(integer),
                          integracoes.fat_notificacoes_resultado(uuid, text, text, text, text, text, jsonb),
                          ops.fat_conector_notificacoes_proximos(integer),
                          ops.fat_conector_notificacoes_resultado(uuid, text, text, text, text, text, jsonb)
  to service_role;

-- =================================================================================================================
-- 4. O cron da fila acorda a edge também para as notificações
-- =================================================================================================================
select cron.unschedule('faturamento-omie-fila')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-fila');
select cron.schedule('faturamento-omie-fila', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/faturamento-omie',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-faturamento-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'faturamento_cron_secret')),
    body := '{"acao":"processar","origem":"cron"}'::jsonb,
    timeout_milliseconds := 120000)
   where exists (
     select 1 from integracoes.omie_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'))
      or exists (
     select 1 from integracoes.pipefy_envios e
      where (e.status = 'pendente' and coalesce(e.proxima_tentativa_em, now()) <= now())
         or (e.status = 'processando' and e.updated_at < now() - interval '15 minutes'))
      or exists (
     select 1 from integracoes.notificacoes n
      where (n.status = 'pendente' and n.proxima_tentativa_em <= now())
         or (n.status = 'processando' and n.updated_at < now() - interval '15 minutes'));
$cron$);

do $conferencia$
declare n int;
begin
  select count(*) into n from pg_trigger where tgrelid = 'receita.fat_eventos'::regclass and tgname = 'fat_eventos_notificar';
  if n <> 1 then raise exception 'T6: gatilho de notificação ausente'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where (s.nspname, p.proname) in (('ops', 'fat_conector_notificacoes_proximos'), ('ops', 'fat_conector_notificacoes_resultado'),
                                    ('integracoes', 'fat_notificacoes_proximos'), ('integracoes', 'fat_notificacoes_resultado'))
     and p.prosecdef and has_function_privilege('service_role', p.oid, 'execute')
     and not has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute');
  if n <> 4 then raise exception 'T6: % das 4 funções da fila com o acesso certo', n; end if;
  if has_table_privilege('authenticated', 'integracoes.notificacoes', 'select') then
    raise exception 'T6: authenticated lê a fila de notificações';
  end if;
  select count(*) into n from cron.job
   where jobname = 'faturamento-omie-fila' and active and command like '%integracoes.notificacoes%';
  if n <> 1 then raise exception 'T6: o job da fila não olha as notificações'; end if;
end $conferencia$;

commit;
