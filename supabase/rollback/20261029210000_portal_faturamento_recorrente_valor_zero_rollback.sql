-- Rollback de 20261029210000_portal_faturamento_recorrente_valor_zero.sql: o contrato de R$ 0 volta a ser elegível.

begin;

do $troca$
declare
  _def text := pg_get_functiondef('receita.fat_competencias_gerar(date)'::regprocedure);
begin
  execute replace(_def, $a$
            -- Contrato de R$ 0 que não faturou no mês anterior não fatura: não é linha do mês.
            and (coalesce(k.valor_mensal, 0) > 0 or coalesce(a.v, 0) > 0)) as elegivel$a$, ') as elegivel');
end $troca$;

commit;
