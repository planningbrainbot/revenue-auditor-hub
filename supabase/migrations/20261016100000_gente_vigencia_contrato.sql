-- Vigência do contrato de estágio (TCE) e de terceiro (pedido do RH de Maceió,
-- 13/10/2026): a plataforma avisa antes do fim para a unidade renovar ou encerrar,
-- e o cadastro passa a exigir as datas para esses vínculos (a exigência é no app,
-- não aqui: as 17 pessoas que já estavam cadastradas ficam como "sem vigência").
--
-- 1. Duas colunas em ops.gente_pessoas, com histórico como os outros campos.
-- 2. ops.gente_vigencia_avisos: o que já foi avisado, para o e-mail diário não repetir.
-- 3. ops.gente_vigencias_a_avisar(): quem entra no e-mail de hoje e para quem vai.
--    Só a service_role executa (Edge Function `gente-vigencia-alertas`, agendada no n8n).
--
-- Avisos: 30 dias antes, 15 dias antes e no dia (ou depois, se o contrato venceu sem
-- renovação e o aviso do dia ainda não saiu). Renovar é mudar o fim: os avisos
-- recomeçam para a data nova.
-- Estágio: a Lei 11.788/2008, art. 11, limita a 2 anos na mesma empresa (salvo
-- estagiário com deficiência). O aviso diz quando o fim passa desse limite.

alter table ops.gente_pessoas
  add column if not exists vigencia_inicio date,
  add column if not exists vigencia_fim date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gente_pessoas_vigencia_ordem') then
    alter table ops.gente_pessoas add constraint gente_pessoas_vigencia_ordem
      check (vigencia_inicio is null or vigencia_fim is null or vigencia_fim >= vigencia_inicio);
  end if;
end $$;

-- Histórico: mesma função de antes, com as duas datas novas.
create or replace function ops.gente_pessoas_registrar_historico()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'ops', 'public'
as $function$
declare
  _quem   uuid := auth.uid();
  _origem text := nullif(current_setting('ops.historico_origem', true), '');
begin
  if tg_op = 'INSERT' then
    insert into ops.gente_pessoas_historico (pessoa_id, campo, antes, depois, alterado_por, origem)
    values (new.id, 'cadastro', null, coalesce(new.origem, 'manual'), _quem, _origem);
    return new;
  end if;

  insert into ops.gente_pessoas_historico (pessoa_id, campo, antes, depois, alterado_por, origem)
  select new.id, c.campo, c.antes, c.depois, _quem, _origem
    from (values
      ('nome_completo',     old.nome_completo,           new.nome_completo),
      ('email',             old.email,                   new.email),
      ('cargo',             old.cargo,                   new.cargo),
      ('departamento',      old.departamento,            new.departamento),
      ('gestor_id',         old.gestor_id::text,         new.gestor_id::text),
      ('tipo_vinculo',      old.tipo_vinculo,            new.tipo_vinculo),
      ('data_admissao',     old.data_admissao::text,     new.data_admissao::text),
      ('data_nascimento',   old.data_nascimento::text,   new.data_nascimento::text),
      ('cnpj_empregador',   old.cnpj_empregador,         new.cnpj_empregador),
      ('unidade_id',        old.unidade_id::text,        new.unidade_id::text),
      ('status',            old.status,                  new.status),
      ('data_desligamento', old.data_desligamento::text, new.data_desligamento::text),
      ('vigencia_inicio',   old.vigencia_inicio::text,   new.vigencia_inicio::text),
      ('vigencia_fim',      old.vigencia_fim::text,      new.vigencia_fim::text)
    ) as c(campo, antes, depois)
   where c.antes is distinct from c.depois;
  return new;
end $function$;

revoke execute on function ops.gente_pessoas_registrar_historico() from public, anon;

-- 2. Avisos já enviados ----------------------------------------------------------------

create table if not exists ops.gente_vigencia_avisos (
  id bigint generated always as identity primary key,
  pessoa_id bigint not null references ops.gente_pessoas (id) on delete cascade,
  vigencia_fim date not null,
  marco text not null check (marco in ('30', '15', '0')),
  destinatarios text[] not null,
  enviado_em timestamptz not null default now(),
  unique (pessoa_id, vigencia_fim, marco)
);

alter table ops.gente_vigencia_avisos enable row level security;
revoke all on ops.gente_vigencia_avisos from public, anon, authenticated;

-- 3. Quem entra no e-mail de hoje ------------------------------------------------------

-- Uma linha por pessoa com aviso pendente. `destinatarios` é o RH da unidade: conta
-- ativa, presa à unidade (`data.scope.own_unit_only`), com `manage.gente` e uma chave
-- de RH (remuneração ou saúde). Unidade sem RH no Brain volta com a lista vazia; a
-- Edge Function conta e informa, e o quadro da tela continua valendo.
create or replace function ops.gente_vigencias_a_avisar()
returns table (
  pessoa_id bigint, nome text, unidade_id integer, unidade text, tipo_vinculo text,
  vigencia_inicio date, vigencia_fim date, dias integer, marco text,
  passa_dois_anos boolean, destinatarios text[]
)
language sql stable security definer set search_path to 'ops', 'public', 'pg_temp'
as $$
  with hoje as (select (now() at time zone 'America/Sao_Paulo')::date as d),
  candidatos as (
    select p.*, (p.vigencia_fim - h.d) as faltam,
           case when p.vigencia_fim - h.d <= 0 then '0'
                when p.vigencia_fim - h.d <= 15 then '15'
                when p.vigencia_fim - h.d <= 30 then '30' end as marco
      from ops.gente_pessoas p, hoje h
     where p.tipo_vinculo in ('estagio', 'terceiro')
       and p.status in ('ativo', 'afastado')
       and p.vigencia_fim is not null
       and p.vigencia_fim - h.d <= 30
  )
  select c.id, c.nome_completo, c.unidade_id, u.nome_da_praca, c.tipo_vinculo,
         c.vigencia_inicio, c.vigencia_fim, c.faltam, c.marco,
         c.tipo_vinculo = 'estagio'
           and coalesce(c.data_admissao, c.vigencia_inicio) is not null
           and c.vigencia_fim > (coalesce(c.data_admissao, c.vigencia_inicio) + interval '2 years')::date,
         coalesce((
           select array_agg(distinct lower(pr.email) order by lower(pr.email))
             from ops.usuario_unidades uu
             join public.profiles pr on pr.user_id = uu.user_id and pr.ativo and pr.email is not null
            where uu.unidade_id = c.unidade_id
              and ops.can_user(uu.user_id, 'manage.gente')
              and ops.can_user(uu.user_id, 'data.scope.own_unit_only')
              and (ops.can_user(uu.user_id, 'manage.gente.remuneracao')
                   or ops.can_user(uu.user_id, 'manage.gente.saude'))
         ), '{}')
    from candidatos c
    left join ops.unidades u on u.id = c.unidade_id
   where not exists (
     select 1 from ops.gente_vigencia_avisos a
      where a.pessoa_id = c.id and a.vigencia_fim = c.vigencia_fim and a.marco = c.marco)
   order by c.unidade_id, c.vigencia_fim, c.nome_completo
$$;

revoke all on function ops.gente_vigencias_a_avisar() from public, anon, authenticated;
grant execute on function ops.gente_vigencias_a_avisar() to service_role;

-- Registra o que saiu. Repetir não duplica (unique).
create or replace function ops.gente_vigencia_registrar_avisos(_avisos jsonb)
returns integer
language sql volatile security definer set search_path to 'ops', 'public', 'pg_temp'
as $$
  with novos as (
    insert into ops.gente_vigencia_avisos (pessoa_id, vigencia_fim, marco, destinatarios)
    select (a ->> 'pessoa_id')::bigint, (a ->> 'vigencia_fim')::date, a ->> 'marco',
           array(select jsonb_array_elements_text(a -> 'destinatarios'))
      from jsonb_array_elements(_avisos) a
    on conflict (pessoa_id, vigencia_fim, marco) do nothing
    returning 1
  )
  select count(*)::integer from novos
$$;

revoke all on function ops.gente_vigencia_registrar_avisos(jsonb) from public, anon, authenticated;
grant execute on function ops.gente_vigencia_registrar_avisos(jsonb) to service_role;
