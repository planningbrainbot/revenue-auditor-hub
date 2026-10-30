-- Portal de Faturamento · E2: o recorrente começa em nov/2026 (29/10/2026).
--
-- receita.fat_competencias_atualizar gerava o mês corrente sempre. Em 29/10 isso criaria outubro, que a automação do
-- Omie já faturou, com as linhas de mudança vencidas como "Sem resposta: não fatura". Agora nenhum mês antes do de
-- receita.fat_recorrente_inicio() é gerado, nem pelo job nem chamando receita.fat_competencias_gerar à mão.
-- Rollback: supabase/rollback/20261029190000_portal_faturamento_recorrente_inicio_rollback.sql

begin;

create or replace function receita.fat_competencias_atualizar()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _hoje date := receita.fat_hoje();
  _primeiro date := date_trunc('month', receita.fat_recorrente_inicio())::date;
  _atual date := greatest(date_trunc('month', _hoje)::date, _primeiro);
  _r jsonb := '{}'::jsonb;
begin
  -- O mês corrente (ou o primeiro do portal, se ainda não chegou).
  _r := jsonb_build_object('atual', receita.fat_competencias_gerar(_atual));
  -- O mês seguinte abre no dia 16, para o dono ter tempo antes dos cortes do começo do mês.
  if extract(day from _hoje) >= 16 and (date_trunc('month', _hoje) + interval '1 month')::date > _atual then
    _r := _r || jsonb_build_object('seguinte',
      receita.fat_competencias_gerar((date_trunc('month', _hoje) + interval '1 month')::date));
  end if;
  return _r;
end $$;
comment on function receita.fat_competencias_atualizar() is
  'Gera o mês corrente e, a partir do dia 16, o seguinte; nunca antes do mês de receita.fat_recorrente_inicio() '
  '(nov/2026). pg_cron de hora em hora (minuto 45).';

do $guarda$
declare
  _def text := pg_get_functiondef('receita.fat_competencias_gerar(date)'::regprocedure);
begin
  if position('antes_do_inicio' in _def) > 0 then return; end if;
  _def := replace(_def,
    $a$  if _comp is null then raise exception 'Competência obrigatória.' using errcode = '22023'; end if;$a$,
    $b$  if _comp is null then raise exception 'Competência obrigatória.' using errcode = '22023'; end if;
  -- Antes do primeiro mês do portal (nov/2026) o recorrente é da automação do Omie.
  if _c < date_trunc('month', receita.fat_recorrente_inicio())::date then
    return jsonb_build_object('competencia', _c, 'antes_do_inicio', true, 'total', 0);
  end if;$b$);
  if position('antes_do_inicio' in _def) = 0 then raise exception 'guarda não entrou em receita.fat_competencias_gerar'; end if;
  execute _def;
end $guarda$;

do $conferencia$
begin
  if (receita.fat_competencias_gerar('2026-10-01') ->> 'antes_do_inicio') is distinct from 'true' then
    raise exception 'outubro ainda é gerado';
  end if;
  if exists (select 1 from receita.fat_competencias where competencia < '2026-11-01') then
    raise exception 'há competência antes de novembro';
  end if;
end $conferencia$;

commit;
