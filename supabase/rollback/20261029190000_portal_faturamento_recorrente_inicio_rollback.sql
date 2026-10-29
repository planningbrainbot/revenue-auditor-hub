-- Rollback de 20261029190000_portal_faturamento_recorrente_inicio.sql: volta o atualizar e o gerar sem a guarda do
-- primeiro mês (a versão de 20261029180000).

begin;

create or replace function receita.fat_competencias_atualizar()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _hoje date := receita.fat_hoje();
  _r jsonb := jsonb_build_object('atual', receita.fat_competencias_gerar(_hoje));
begin
  if extract(day from _hoje) >= 16 then
    _r := _r || jsonb_build_object('seguinte', receita.fat_competencias_gerar((date_trunc('month', _hoje) + interval '1 month')::date));
  end if;
  return _r;
end $$;

do $tira$
declare
  _def text := pg_get_functiondef('receita.fat_competencias_gerar(date)'::regprocedure);
begin
  _def := replace(_def, $a$
  -- Antes do primeiro mês do portal (nov/2026) o recorrente é da automação do Omie.
  if _c < date_trunc('month', receita.fat_recorrente_inicio())::date then
    return jsonb_build_object('competencia', _c, 'antes_do_inicio', true, 'total', 0);
  end if;$a$, '');
  execute _def;
end $tira$;

commit;
