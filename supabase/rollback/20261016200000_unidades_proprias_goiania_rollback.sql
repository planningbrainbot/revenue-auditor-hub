create or replace function ops.cac_unidade_chave(t text)
 returns text
 language sql
 immutable
as $function$
  select replace(ops.cac_nome_chave(t), ' do campo', '')
$function$;

update ops.contratos set unidade = '1124' where unidade = 'BPO Financeiro';
delete from ops.unidades where pipedrive_opcao_id = 1124 and nome_da_praca = 'BPO Financeiro';

update ops.unidades set paga_cac = false, cac_desde = null, midia_mensal = 60000 where id = 9;
-- unidade 10 já estava com mídia R$ 20 mil e sem CAC; só ganhou a observação.
