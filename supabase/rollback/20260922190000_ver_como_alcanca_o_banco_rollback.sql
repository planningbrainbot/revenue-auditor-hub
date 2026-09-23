-- Desfaz o alcance da simulação no banco (22/09/2026).
--
-- Volta as três funções de unidade ao texto de
-- `20260915100000_permissoes_por_area.sql`, que lê só `usuario_unidades`, e
-- tira os gatilhos de somente leitura do broker.
--
-- O que se perde: o super admin em simulação volta a ver "sem vínculo" no
-- /broker. O que NÃO se perde: a simulação em si, que é da migration de 18/09 e
-- continua trocando menu, chaves e recorte no front.
--
-- Rodar este arquivo INTEIRO. Desfazer só os gatilhos deixaria a simulação
-- valendo no banco com a escrita liberada, que é o pior dos dois mundos.

set search_path = ops, public;

do $$
declare t text;
begin
  foreach t in array array['broker_movimentos', 'broker_oportunidades',
                           'broker_faturas', 'broker_precificacoes']
  loop
    if to_regclass('ops.' || t) is not null then
      execute format('drop trigger if exists ver_como_somente_leitura on ops.%I', t);
    end if;
  end loop;
end $$;

create or replace function ops.minhas_unidades()
returns setof integer
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select uu.unidade_id from ops.usuario_unidades uu where uu.user_id = auth.uid()
$function$;

create or replace function ops.current_user_unidade()
returns text
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select u.nome_da_praca
    from ops.usuario_unidades uu
    join ops.unidades u on u.id = uu.unidade_id
   where uu.user_id = auth.uid()
   order by u.id
   limit 1
$function$;

create or replace function ops.unidades_do_usuario()
returns text[]
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  with minhas as (
    select ops.norm_unidade(u.nome_da_praca) as u
      from ops.usuario_unidades uu
      join ops.unidades u on u.id = uu.unidade_id
     where uu.user_id = auth.uid()
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

drop function if exists ops.ver_como_bloqueia_escrita();
drop function if exists ops.ver_como_ativa();
drop function if exists ops.ver_como_unidade();

notify pgrst, 'reload schema';
