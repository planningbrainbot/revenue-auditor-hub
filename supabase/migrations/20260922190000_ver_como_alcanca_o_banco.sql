-- "Ver como" passa a valer também no banco, e a simulação vira somente leitura.
--
-- O que quebrou. Em 22/09/2026 o dono ligou "ver como o sócio de Maceió", abriu
-- /broker e leu "Seu usuário ainda não está vinculado a uma unidade". A tela
-- não tem defeito: ela está dizendo a verdade sobre o `auth.uid()` real.
--
-- A simulação publicada em 18/09 (`20260918160000_ver_como_unidade.sql`) troca
-- áreas, chaves e a unidade do recorte NO FRONT, e de propósito não encostava
-- no banco. Isso funcionou enquanto todas as telas do sócio recortavam no
-- cliente, com `scopedToOwnUnit && unidade` em memória. O broker é a primeira
-- que recorta DENTRO da view: `v_broker_meu_saldo` tem
-- `u.id in (select minhas_unidades())`, e `ops.minhas_unidades()` lê
-- `usuario_unidades` pelo uid real do super admin, que não tem unidade nenhuma.
-- Zero linhas, e `carregarBrokerUnidade` traduz zero linhas em "sem vínculo".
--
-- Por que mexer na função de unidade e não nas views do broker. Todo o broker
-- passa por `minhas_unidades()`: as 7 views da unidade e os RPCs de
-- autoatendimento, que fazem `select ... minhas_unidades() into alvo`. Um
-- resolvedor próprio do broker consertaria esta tela e deixaria a próxima que
-- recortar no banco com o mesmo sintoma. A simulação chegar ao banco é o
-- conserto de verdade.
--
-- O que NÃO muda: a identidade. `auth.uid()` continua sendo o super admin, e o
-- log de acessos continua dizendo quem é. O que muda é a resposta a "de qual
-- unidade eu sou", que durante a simulação passa a ser a unidade vestida.
--
-- O preço disso, e a trava. `minhas_unidades()` é também o que decide em nome
-- de quem a reserva gasta saldo. Sem mais nada, o botão "Reservar" durante a
-- simulação passaria a queimar CashBrain de Maceió de verdade, assinado pelo
-- super admin, e o extrato da unidade ganharia uma linha que ninguém da unidade
-- pediu. Por isso a segunda metade desta migration: enquanto a simulação está
-- ligada, escrita no broker é recusada no gatilho. Ver é ver.

set search_path = ops, public;

-- ─────────────────────────────────────────────────────────────
-- 1. A unidade simulada, em uma função só
-- ─────────────────────────────────────────────────────────────
-- Mesmas três condições de `ver_como_atual()`: a linha é minha, não expirou, e
-- quem simula continua super admin. Repetidas aqui em vez de desembrulhar o
-- jsonb daquela função, porque isto roda dentro de policy e de view: precisa
-- ser um inteiro e um index scan, não um objeto para o Postgres abrir.
create or replace function ops.ver_como_unidade()
returns integer
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select v.unidade_id
    from ops.ver_como v
   where v.user_id = auth.uid()
     and v.expira_em > now()
     and ops.eh_super_admin(v.user_id)
$function$;

comment on function ops.ver_como_unidade() is
  'A unidade que o super admin está vestindo agora, ou null. Não troca identidade: auth.uid() segue o real.';

create or replace function ops.ver_como_ativa()
returns boolean
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select ops.ver_como_unidade() is not null
$function$;

-- ─────────────────────────────────────────────────────────────
-- 2. As funções de unidade passam a enxergar a simulação
-- ─────────────────────────────────────────────────────────────
-- Assinatura e contrato de retorno intactos: as 11 policies que chamam estas
-- funções não mudam de texto, mudam de resposta.
--
-- A simulação SUBSTITUI o vínculo real, não soma. "Ver como o sócio de Maceió"
-- que ainda mostrasse a unidade do próprio simulador não seria a visão do
-- sócio, seria um híbrido que não existe em ninguém. Na prática o super admin
-- não tem linha em `usuario_unidades`, mas a regra precisa valer para o dia em
-- que tiver.
create or replace function ops.minhas_unidades()
returns setof integer
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select ops.ver_como_unidade()
   where ops.ver_como_unidade() is not null
  union all
  select uu.unidade_id
    from ops.usuario_unidades uu
   where uu.user_id = auth.uid()
     and ops.ver_como_unidade() is null
$function$;

create or replace function ops.current_user_unidade()
returns text
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select u.nome_da_praca
    from ops.unidades u
   where u.id = coalesce(
           ops.ver_como_unidade(),
           (select uu.unidade_id
              from ops.usuario_unidades uu
              join ops.unidades x on x.id = uu.unidade_id
             where uu.user_id = auth.uid()
             order by x.id
             limit 1))
$function$;

-- Aqui a mudança é de fonte, não de regra: a lista de apelidos continua igual,
-- mas nasce de `minhas_unidades()` em vez de reler `usuario_unidades`. Com três
-- funções lendo a mesma coisa, era questão de tempo até uma delas ficar para
-- trás numa mudança como esta.
create or replace function ops.unidades_do_usuario()
returns text[]
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  with minhas as (
    select ops.norm_unidade(u.nome_da_praca) as u
      from ops.unidades u
     where u.id in (select ops.minhas_unidades())
  ),
  pares (a, b) as (
    values ('rio de janeiro',   'sudeste (rj)'),
           ('rio de janeiro',   'rj'),
           ('matriz',           'goiania / matriz'),
           ('matriz',           'goiania')
  )
  select case when not exists (select 1 from minhas) then null
         else array(
           select distinct v from (
                      select u from minhas
             union all select p.b from pares p join minhas m on p.a = m.u
             union all select p.a from pares p join minhas m on p.b = m.u
           ) t(v) where v is not null
         )
         end
$function$;

-- ─────────────────────────────────────────────────────────────
-- 3. A simulação é somente leitura no broker
-- ─────────────────────────────────────────────────────────────
-- No gatilho, e não dentro de cada RPC, por dois motivos. O primeiro é
-- cobertura: reservar, liberar, precificar e pedir fatura são quatro funções
-- hoje e nada garante que sejam quatro amanhã; a tabela é o funil por onde todas
-- passam. O segundo é que o gatilho pega também a escrita que não vem de RPC
-- nenhum, feita direto na tabela pelo PostgREST.
--
-- Nível de statement: dispara uma vez por comando, inclusive no comando que não
-- afetaria linha alguma. Recusar cedo é melhor do que recusar depois de o
-- Postgres já ter decidido o que ia mexer.
--
-- O sync não é atingido: `broker-sync-fila` entra com service_role, `auth.uid()`
-- é nulo e `ver_como_ativa()` devolve falso.
create or replace function ops.ver_como_bloqueia_escrita()
returns trigger
language plpgsql
set search_path to 'ops', 'public', 'extensions'
as $function$
begin
  if ops.ver_como_ativa() then
    raise exception
      'Você está vendo como a unidade %. A simulação é somente leitura: saia da visão para gravar.',
      coalesce((select u.nome_da_praca from ops.unidades u
                 where u.id = ops.ver_como_unidade()), '?')
      using errcode = '42501';
  end if;
  return null;
end
$function$;

comment on function ops.ver_como_bloqueia_escrita() is
  'Recusa escrita enquanto ops.ver_como estiver ativa para o autor. Ver é ver.';

do $$
declare t text;
begin
  -- As quatro tabelas que a tela da unidade escreve. As de parâmetro da matriz
  -- (broker_config, broker_custo_cm, broker_multiplicador) ficam de fora: o menu
  -- da simulação é o do sócio e não alcança a tela que as edita.
  foreach t in array array['broker_movimentos', 'broker_oportunidades',
                           'broker_faturas', 'broker_precificacoes']
  loop
    if to_regclass('ops.' || t) is null then
      raise notice 'ops.% não existe, gatilho não criado', t;
      continue;
    end if;
    execute format('drop trigger if exists ver_como_somente_leitura on ops.%I', t);
    execute format(
      'create trigger ver_como_somente_leitura
         before insert or update or delete on ops.%I
         for each statement execute function ops.ver_como_bloqueia_escrita()', t);
  end loop;
end $$;

revoke execute on function ops.ver_como_unidade(), ops.ver_como_ativa() from public, anon;
grant execute on function ops.ver_como_unidade(), ops.ver_como_ativa() to authenticated;

-- O PostgREST guarda o catálogo em memória.
notify pgrst, 'reload schema';
