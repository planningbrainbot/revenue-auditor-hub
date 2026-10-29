-- Rollback de 20261029180000_portal_faturamento_recorrente.sql: tira o recorrente (competências, repasses, notas,
-- calendário, API das telas e jobs) e devolve o espelho de contratos e o aplicar de antes (só os campos do CA-04).
-- O conector antigo continua funcionando: os campos novos que ele não manda deixam de existir.

begin;

select cron.unschedule(j) from unnest(array['faturamento-omie-notas', 'faturamento-omie-notas-dia',
                                            'faturamento-competencias']) j
 where exists (select 1 from cron.job where jobname = j);

drop function if exists ops.fat_contratos_mes(date, uuid);
drop function if exists ops.fat_contrato_detalhe(uuid);
drop function if exists ops.fat_contratos_confirmar(uuid[]);
drop function if exists ops.fat_contrato_responder(uuid, text, jsonb);
drop function if exists ops.fat_contrato_pessoas(uuid);
drop function if exists ops.fat_contrato_repassar(uuid, uuid);
drop function if exists ops.fat_corte(date, uuid);
drop function if exists ops.fat_corte_feito(uuid, boolean);
drop function if exists receita.fat_comp_json(receita.fat_comp_linha_t, boolean);
drop function if exists receita.fat_comp_procedencia(uuid[]);
drop function if exists receita.fat_comp_ve(receita.fat_escopo_t, uuid, uuid);
drop function if exists receita.fat_comp_pode_responder(receita.fat_escopo_t, uuid, uuid);
drop function if exists receita.fat_comp_linhas(date);
drop type if exists receita.fat_comp_linha_t;
drop function if exists receita.fat_competencias_atualizar();
drop function if exists receita.fat_competencias_gerar(date);
drop table if exists receita.fat_competencias;
drop table if exists receita.fat_contrato_donos;
drop function if exists receita.fat_recorrente_inicio();
drop function if exists receita.fat_dia_util_antes(date);
drop function if exists receita.fat_dia_util_ate(date);
drop table if exists receita.fat_feriados;

drop function if exists integracoes.fat_notas_enfileirar();
drop function if exists ops.fat_conector_notas_aplicar(uuid, date, date, jsonb);
drop function if exists integracoes.fat_notas_aplicar(uuid, date, date, jsonb);
drop table if exists integracoes.omie_notas_contrato;
delete from integracoes.omie_envios where operacao = 'sincronizar_notas';
alter table integracoes.omie_envios drop constraint omie_envios_operacao_check;
alter table integracoes.omie_envios add constraint omie_envios_operacao_check check (operacao in (
  'garantir_cliente', 'incluir_os', 'alterar_os', 'incluir_conta_receber', 'consultar_status', 'faturar_os',
  'sincronizar_servicos', 'sincronizar_contratos'));

-- O espelho volta a guardar só os vigentes de hoje (o conector antigo filtra; até ele voltar, o aviso já filtra).
delete from integracoes.omie_contratos_vigentes
 where situacao <> '10' or (vigencia_final is not null and vigencia_final < (now() at time zone 'America/Sao_Paulo')::date);
alter table integracoes.omie_contratos_vigentes
  drop column dia_faturamento, drop column tipo_faturamento, drop column dia_vencimento, drop column codigo_projeto,
  drop column projeto, drop column categoria, drop column cliente_nome, drop column itens;

create or replace function integracoes.fat_contratos_aplicar(p_emissora uuid, p_contratos jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _item jsonb;
  _doc text;
  _cod bigint;
  _validos jsonb := '[]'::jsonb;
  _ignorados int := 0;
  _antes int;
  _removidos int;
  _gravados int;
begin
  perform integracoes.fat_exigir_conector();
  if not exists (select 1 from organizacao.empresas_grupo g where g.id = p_emissora) then
    raise exception 'Emissora desconhecida.' using errcode = 'P0002';
  end if;
  if p_contratos is null or jsonb_typeof(p_contratos) <> 'array' then
    raise exception 'p_contratos precisa ser uma lista (vazia quando a emissora não tem contrato vigente).'
      using errcode = '22023';
  end if;
  for _item in select * from jsonb_array_elements(p_contratos) loop
    _cod := nullif(_item ->> 'codigo_contrato', '')::bigint;
    _doc := receita.fat_documento_normalizar(_item ->> 'documento');
    if _cod is null or _cod <= 0 or _doc is null or not receita.fat_documento_valido(_doc)
       or nullif(btrim(_item ->> 'situacao'), '') is null then
      _ignorados := _ignorados + 1;
      continue;
    end if;
    _validos := _validos || jsonb_build_object(
      'c', _cod, 'n', nullif(btrim(_item ->> 'numero'), ''), 'd', _doc,
      'cli', nullif(_item ->> 'codigo_cliente_omie', '')::bigint, 's', btrim(_item ->> 'situacao'),
      'vi', nullif(_item ->> 'vigencia_inicial', '')::date, 'vf', nullif(_item ->> 'vigencia_final', '')::date,
      'v', nullif(_item ->> 'valor_mensal', '')::numeric(14,2));
  end loop;

  select count(*) into _antes from integracoes.omie_contratos_vigentes where emissora_id = p_emissora;
  delete from integracoes.omie_contratos_vigentes x
   where x.emissora_id = p_emissora
     and not exists (select 1 from jsonb_array_elements(_validos) v where (v ->> 'c')::bigint = x.codigo_contrato);
  get diagnostics _removidos = row_count;
  insert into integracoes.omie_contratos_vigentes as x
    (emissora_id, codigo_contrato, numero, documento, codigo_cliente_omie, situacao, vigencia_inicial, vigencia_final,
     valor_mensal, sincronizado_em)
  select distinct on ((v ->> 'c')::bigint)
         p_emissora, (v ->> 'c')::bigint, v ->> 'n', v ->> 'd', (v ->> 'cli')::bigint, v ->> 's', (v ->> 'vi')::date,
         (v ->> 'vf')::date, (v ->> 'v')::numeric(14,2), now()
    from jsonb_array_elements(_validos) v
  on conflict (emissora_id, codigo_contrato) do update
     set numero = excluded.numero, documento = excluded.documento, codigo_cliente_omie = excluded.codigo_cliente_omie,
         situacao = excluded.situacao, vigencia_inicial = excluded.vigencia_inicial,
         vigencia_final = excluded.vigencia_final, valor_mensal = excluded.valor_mensal, sincronizado_em = now();
  get diagnostics _gravados = row_count;
  return jsonb_build_object('antes', _antes, 'gravados', _gravados, 'removidos', _removidos, 'ignorados', _ignorados,
                            'total', (select count(*) from integracoes.omie_contratos_vigentes where emissora_id = p_emissora));
end $$;

comment on function integracoes.fat_contratos_aplicar(uuid, jsonb) is
  'Substitui os contratos vigentes da emissora pelo que o conector leu do Omie (lista vazia = nenhum vigente). Item: '
  'codigo_contrato, numero, documento, codigo_cliente_omie, situacao, vigencia_inicial, vigencia_final, valor_mensal. '
  'Documento inválido é ignorado e contado. Só o service_role.';

comment on table integracoes.omie_contratos_vigentes is
  'Domínio Integrações. Dono: Portal de Faturamento (CA-04). Contratos de serviço ativos (cCodSit 10) e de vigência em '
  'dia de cada emissora do grupo, lidos do Omie dela pela edge faturamento-omie (operação sincronizar_contratos, todo '
  'dia às 6h). O documento do cliente vem do cadastro do Omie (nCodCli → cnpj_cpf), normalizado como '
  'receita.fat_documento_normalizar. Alimenta o aviso de contrato em outra empresa (RF-P03) por '
  'receita.fat_contratos_vigentes. O navegador não lê.';

commit;
