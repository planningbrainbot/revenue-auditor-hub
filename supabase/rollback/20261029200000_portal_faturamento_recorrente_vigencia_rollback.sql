-- Rollback de 20261029200000_portal_faturamento_recorrente_vigencia.sql: a linha do mês volta sem a vigência inicial.

begin;

do $troca$
declare
  _def text := pg_get_functiondef('receita.fat_comp_json(receita.fat_comp_linha_t, boolean)'::regprocedure);
begin
  _def := replace(_def, $a$'vigencia_inicial', _l.vigencia_inicial, $a$, '');
  execute _def;
end $troca$;

commit;
