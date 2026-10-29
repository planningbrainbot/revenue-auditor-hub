-- Portal de Faturamento · E2: a linha do mês leva a vigência inicial (29/10/2026).
--
-- O motivo "novo" junta o contrato que começa agora e o antigo que não teve nota no mês anterior (em nov/2026, 40
-- linhas, várias com vigência desde 2024). A tela precisa da vigência inicial para dizer "Contrato novo" só ao que
-- começou no mês anterior ou neste, e "Sem nota em out" ao resto.
-- Rollback: supabase/rollback/20261029200000_portal_faturamento_recorrente_vigencia_rollback.sql

begin;

do $troca$
declare
  _def text := pg_get_functiondef('receita.fat_comp_json(receita.fat_comp_linha_t, boolean)'::regprocedure);
begin
  if position('''vigencia_inicial''' in _def) > 0 then return; end if;
  _def := replace(_def, $a$'responder_ate', _l.responder_ate, 'vigencia_final', _l.vigencia_final,$a$,
                        $b$'responder_ate', _l.responder_ate, 'vigencia_inicial', _l.vigencia_inicial, 'vigencia_final', _l.vigencia_final,$b$);
  if position('''vigencia_inicial''' in _def) = 0 then raise exception 'vigencia_inicial não entrou em fat_comp_json'; end if;
  execute _def;
end $troca$;

commit;
