-- Rollback de 20261020230000_portal_faturamento_contratos_vigentes.sql: tira o job diário, a fila de contratos, as
-- funções e a tabela, e volta receita.fat_contratos_vigentes ao corpo de 20261020170000 (só ops.omie_contratos_servico).
-- Atenção: apaga os contratos lidos e os envios sincronizar_contratos (a operação sai do check).
begin;

select cron.unschedule('faturamento-omie-contratos')
 where exists (select 1 from cron.job where jobname = 'faturamento-omie-contratos');

CREATE OR REPLACE FUNCTION receita.fat_contratos_vigentes(_doc text)
 RETURNS TABLE(emissora_id uuid, apelido text, unidade text, numero text, valor_mensal numeric, vigencia_inicial date, vigencia_final date, sincronizado_em timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with mapa as (
    select distinct c.unidade, g.id as emissora_id, g.apelido
      from ops.omie_credentials c
      left join ops.unidades u on u.id = c.unidade_id
      join organizacao.empresas_grupo g
        on g.cnpj = any (array(select receita.fat_documento_normalizar(x)
                                 from regexp_split_to_table(coalesce(u.cnpj, ''), E'[\\n,;]+') x))
        or (c.unidade = 'Planning Partners (Matriz)' and g.id = '769854a7-0b0b-48e2-ace8-9b0636e19a56')
  ), k as (
    -- Documento só com dígitos: pelo índice de cnpj_digitos. Alfanumérico (cnpj_digitos tira as letras): pelo
    -- documento normalizado, numa varredura que só roda quando o documento tem letra.
    select x.* from ops.omie_contratos_servico x where _doc ~ '^[0-9]+$' and x.cnpj_digitos = _doc
    union all
    select x.* from ops.omie_contratos_servico x
     where _doc ~ '[A-Z]' and receita.fat_documento_normalizar(x.cnpj) = _doc
  )
  select m.emissora_id, m.apelido, k.unidade, k.numero, k.valor_mensal, k.vigencia_inicial, k.vigencia_final,
         k.sincronizado_em
    from k join mapa m on m.unidade = k.unidade
   where _doc is not null and k.situacao = '10'
     and (k.vigencia_final is null or k.vigencia_final >= receita.fat_hoje())
$function$;

delete from integracoes.omie_envios where operacao = 'sincronizar_contratos';
alter table integracoes.omie_envios drop constraint omie_envios_operacao_check;
alter table integracoes.omie_envios add constraint omie_envios_operacao_check check (operacao in (
  'garantir_cliente', 'incluir_os', 'alterar_os', 'incluir_conta_receber', 'consultar_status', 'faturar_os',
  'sincronizar_servicos'));

drop function if exists integracoes.fat_contratos_enfileirar();
drop function if exists ops.fat_conector_contratos_aplicar(uuid, jsonb);
drop function if exists integracoes.fat_contratos_aplicar(uuid, jsonb);
drop table if exists integracoes.omie_contratos_vigentes;

do $conferencia$
begin
  if to_regclass('integracoes.omie_contratos_vigentes') is not null then raise exception 'rollback CA-04: tabela sobrou'; end if;
  if exists (select 1 from cron.job where jobname = 'faturamento-omie-contratos') then
    raise exception 'rollback CA-04: job sobrou';
  end if;
end $conferencia$;

commit;
