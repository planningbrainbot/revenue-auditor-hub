-- Rollback de 20261029220000_portal_faturamento_recorrente_corte_dias.sql: a ficha do dia volta a contar o encerrado
-- no Omie sem resposta. Os nomes corrigidos ficam (o Omie volta a mandá-los na próxima leitura só se o conector antigo
-- voltar).

begin;

do $troca$
declare
  _def text := pg_get_functiondef('ops.fat_corte(date, uuid)'::regprocedure);
begin
  execute replace(_def, $a$
                                 -- Mesma regra da lista: encerrado no Omie sem resposta não é trabalho da tesouraria.
                                 and not (c.motivos = array['encerrado_omie'] and c.resposta is null)$a$, '');
end $troca$;

commit;
