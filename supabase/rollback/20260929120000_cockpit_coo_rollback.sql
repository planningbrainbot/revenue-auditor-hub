-- Rollback do Cockpit do COO (20260929120000 e 20260929120100).
-- Apaga o espelho do ClickUp (o ClickUp continua sendo a fonte; nada se perde lá) e devolve o teto
-- de IA ao formato de 25/09. A coluna `cockpit` sai por último: se houver linha do COO, o CEO
-- passaria a somá-la, então as linhas do COO são apagadas antes.

begin;
select cron.unschedule('clickup-sync-10min') where exists (select 1 from cron.job where jobname = 'clickup-sync-10min');

drop table if exists ops.cockpit_coo_sugestoes;
drop table if exists ops.cockpit_coo_escritas;
drop table if exists ops.clickup_eventos;
drop table if exists ops.clickup_tarefas;

delete from ops.integracoes_config where fonte = 'clickup';

drop function if exists ops.cockpit_ia_orcamento(text) cascade;
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

drop policy if exists cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo;
delete from ops.cockpit_ia_consumo where cockpit = 'coo';
create policy cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo
  for insert to authenticated
  with check (user_id = auth.uid() and ops.tem_area('cockpit_ceo'));
alter table ops.cockpit_ia_consumo drop column if exists cockpit;

delete from ops.role_areas where area = 'cockpit_coo';
delete from ops.areas where slug = 'cockpit_coo';
commit;
