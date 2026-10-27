-- Base de clientes: contrato cancelado no Omie vira ex-cliente (Pedro, 27/10/2026).
--
-- Curitiba guarda o status de cada contrato nos três aplicativos do Omie (CWB 01, CWB 02 e Curitiba): 1.454 contratos,
-- 356 ativos (cCodSit 10) e 1.085 cancelados (99, "Cancelado" na tela). A regra de 15/10 tratava qualquer contrato,
-- até cancelado, como prova de cliente: 818 empresas de Curitiba só com contrato cancelado e sem pagamento nos últimos
-- 90 dias apareciam como "cliente · pode citar". Decisão do Pedro: viram ex-cliente, com a vigência final como saída.
--
-- a. ops.base_conta_prova: devolve `contrato_cancelado` (só cancelado, nenhum ativo em omie_contratos_servico nem em
--    base_omie_contratos) e `contrato_fim` (última vigência final dos cancelados). `contrato_ativo` não muda.
-- b. ops.base_conta_situacao: a regra nova, depois de grupo e fornecedor e antes dos critérios de cliente.
-- Parte das versões no ar em 27/10 (não das migrations de 15/10: o lote da Matriz mudou depois). Rollback em
-- schema_migrations.rollback. A ficha só muda quando a carteira é recalculada (`ops.base_carteira_refresh`).

CREATE OR REPLACE FUNCTION ops.base_conta_prova(_cnpjs text[], _empresa_ids integer[], _ecd jsonb, _perfil jsonb, _omie jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare
  cs text[] := coalesce(_cnpjs, '{}'::text[]);
  grupo text;
  provas text[] := '{}';
  rotulos text[] := '{}';
  pago text[];
  pago_grupo text[];
  irmas text[];
  raizes text[] := array(select distinct left(x, 8) from unnest(coalesce(_cnpjs, '{}'::text[])) x);
  classe text := _omie->>'classe';
  onde text;
  saida jsonb;
  n_receber integer := 0;
  recebido date;
  contrato_ativo boolean := false;
  ctr_ativo boolean := false;
  ctr_cancelado boolean := false;
  ctr_fim date;
  fat_em date;
  fat_por text[] := '{}';
  fat boolean := false;
begin
  select g.nome into grupo from ops.base_grupo_cnpjs g
   where g.raiz = any(array(select left(x, 8) from unnest(cs) x)) order by g.raiz limit 1;
  if grupo is not null then
    return jsonb_build_object('nivel', 'grupo', 'provas', '[]'::jsonb, 'pago_em', '[]'::jsonb,
      'motivo', 'Empresa do grupo Planning (' || grupo || '). Fora das ofertas.');
  end if;
  if cardinality(cs) > 0 and (exists (select 1 from ops.omie_contratos_servico s where s.cnpj_digitos = any(cs))
      or exists (select 1 from ops.base_omie_contratos s where s.cnpj = any(cs))) then
    provas := array_append(provas, 'contrato'); rotulos := array_append(rotulos, 'contrato de serviço no Omie');
  end if;
  if cardinality(cs) > 0 then
    -- Regra de cliente (15/10): o recebimento mais recente decide o grau "pagamento visto".
    select count(*), max(coalesce(r.data_pagamento, r.data_vencimento))
             filter (where coalesce(r.data_pagamento, r.data_vencimento) <= current_date)
      into n_receber, recebido
      from ops.contas_receber r where ops.qb_so_digitos(r.cpf_cnpj) = any(cs);
    contrato_ativo := exists (select 1 from ops.omie_contratos_servico s where s.cnpj_digitos = any(cs) and s.situacao = '10');
    -- Status do contrato no Omie (27/10): ativo em qualquer aplicativo (10) ou só cancelado (99, "Cancelado" na tela do
    -- Omie), com a última vigência final dos cancelados. O código 90 não entra em nenhum dos dois.
    ctr_ativo := contrato_ativo or exists (select 1 from ops.base_omie_contratos s where s.cnpj = any(cs) and s.situacao = '10');
    ctr_cancelado := not ctr_ativo and (exists (select 1 from ops.omie_contratos_servico s where s.cnpj_digitos = any(cs) and s.situacao = '99')
      or exists (select 1 from ops.base_omie_contratos s where s.cnpj = any(cs) and s.situacao = '99'));
    if ctr_cancelado then
      select max(s.vigencia_final) into ctr_fim from ops.omie_contratos_servico s where s.cnpj_digitos = any(cs) and s.situacao = '99';
    end if;
    select max(g.ultima_competencia), coalesce(array_agg(distinct e order by e) filter (where e is not null), '{}'), count(g.cnpj) > 0
      into fat_em, fat_por, fat
      from ops.base_faturamento_grupo g left join lateral unnest(g.empresas) e on true where g.cnpj = any(cs);
  end if;
  if n_receber > 0 then
    provas := array_append(provas, 'receber'); rotulos := array_append(rotulos, 'conta a receber');
  end if;
  -- Faturamento das empresas do grupo (Financial Brain, 15/10): é o recebimento no Omie da Matriz (PAC, MAROX, DOC...).
  if fat then
    provas := array_append(provas, 'faturado_grupo');
    rotulos := array_append(rotulos, 'faturamento das empresas do grupo' ||
      case when cardinality(fat_por) > 0 then ' (' || array_to_string(fat_por, ', ') || ')' else '' end);
  end if;
  if jsonb_typeof(_ecd) = 'array' and jsonb_array_length(_ecd) > 0 then
    provas := array_append(provas, 'ecd'); rotulos := array_append(rotulos, 'ECD na Planning');
  end if;
  -- Ganho nos pipes de Inside Sales ou de Sócios: o contrato do Pipedrive pela empresa do Pipefy ou pelo CNPJ (15/10).
  if coalesce((_perfil->>'pipedrive_contract')::boolean, false)
     or exists (select 1 from ops.contratos k
                 where k.ganho_em is not null and k.empresa_id = any(coalesce(_empresa_ids, '{}'::integer[])))
     or (cardinality(cs) > 0 and exists (select 1 from ops.contratos k
                 where k.ganho_em is not null and ops.qb_so_digitos(k.cnpj) = any(cs))) then
    provas := array_append(provas, 'ganho_pipedrive'); rotulos := array_append(rotulos, 'negócio ganho no Pipedrive');
  end if;
  select coalesce(array_agg(distinct p.unidade order by p.unidade), '{}') into pago
    from ops.base_omie_tags t join ops.base_omie_pagamentos p on p.unidade = t.unidade and p.codigo_omie = t.codigo_omie
   where t.cnpj = any(cs);
  select coalesce(array_agg(distinct e order by e), '{}') into pago_grupo
    from ops.base_pagamentos_grupo g cross join lateral unnest(g.empresas) e where g.cnpj = any(cs);
  saida := jsonb_build_object('provas', to_jsonb(provas), 'pago_em', to_jsonb(pago), 'pago_pelo_grupo', to_jsonb(pago_grupo),
    'recebido_em', recebido, 'contrato_ativo', contrato_ativo, 'contrato_cancelado', ctr_cancelado, 'contrato_fim', ctr_fim, 'faturado_grupo_em', fat_em, 'faturado_por', to_jsonb(fat_por));
  if cardinality(provas) > 0 then
    return saida || jsonb_build_object('nivel', 'comprovado',
      'motivo', 'Prova de cliente: ' || array_to_string(rotulos, ', ') || '.');
  end if;
  if cardinality(pago) > 0 or cardinality(pago_grupo) > 0 then
    return saida || jsonb_build_object('nivel', 'fornecedor',
      'motivo', 'Fornecedor: recebe pagamento ' ||
        array_to_string(array_remove(array[
          case when cardinality(pago) > 0 then 'no Omie (' || array_to_string(pago, ', ') || ')' end,
          case when cardinality(pago_grupo) > 0 then 'das empresas do grupo (' || array_to_string(pago_grupo, ', ') || ')' end
        ], null), ' e ') || ' e não tem prova de cliente. Fora das ofertas.');
  end if;
  if classe = 'fornecedor' then
    select string_agg(x, ', ') into onde from jsonb_array_elements_text(coalesce(_omie->'fornecedor_em', '[]')) x;
    return saida || jsonb_build_object('nivel', 'fornecedor',
      'motivo', 'Só fornecedor no Omie' || coalesce(' (' || onde || ')', '') || ', sem tag de cliente. Fora das ofertas.');
  end if;
  if classe = 'pessoa_interna' then
    return saida || jsonb_build_object('nivel', 'fornecedor',
      'motivo', 'Funcionário, sócio ou prestador no Omie, sem tag de cliente. Fora das ofertas.');
  end if;
  if cardinality(coalesce(_empresa_ids, '{}'::integer[])) = 0 and cardinality(raizes) > 0 then
    select coalesce(array_agg(distinct t.unidade order by t.unidade), '{}') into irmas
      from ops.base_omie_tags t
     where left(t.cnpj, 8) = any(raizes) and length(t.cnpj) = 14 and not (t.cnpj = any(cs))
       and ((t.fornecedor and not t.cliente)
            or exists (select 1 from ops.base_omie_pagamentos p where p.unidade = t.unidade and p.codigo_omie = t.codigo_omie));
    if exists (select 1 from ops.base_pagamentos_grupo g where left(g.cnpj, 8) = any(raizes) and not (g.cnpj = any(cs))) then
      irmas := array_append(irmas, 'empresas do grupo');
    end if;
    if cardinality(irmas) > 0 then
      return saida || jsonb_build_object('nivel', 'fornecedor', 'filial_fornecedora_em', to_jsonb(irmas),
        'motivo', 'Fornecedor: outra filial da mesma empresa (raiz do CNPJ) é fornecedora no Omie (' ||
          array_to_string(irmas, ', ') || ') e esta não tem prova de cliente. Fora das ofertas.');
    end if;
  end if;
  if cardinality(coalesce(_empresa_ids, '{}'::integer[])) > 0 then
    return saida || jsonb_build_object('nivel', 'cadastrado',
      'motivo', 'Cadastrada pela unidade no Pipefy; sem contrato, recebimento, ECD ou negócio ganho no Brain.');
  end if;
  if classe in ('cliente', 'cliente_e_fornecedor') then
    select string_agg(x, ', ') into onde from jsonb_array_elements_text(coalesce(_omie->'cliente_em', '[]')) x;
    return saida || jsonb_build_object('nivel', 'so_tag',
      'motivo', 'Marcada Cliente no Omie' || coalesce(' (' || onde || ')', '') || ', sem outra prova de cliente.');
  end if;
  return saida || jsonb_build_object('nivel', 'sem_prova',
    'motivo', 'Sem prova de cliente: ' || case when _omie is not null then 'só no cadastro do Omie, ' else '' end ||
      'sem contrato, recebimento, ECD, negócio ganho nem card no Pipefy. Fora das ofertas.');
end $function$
;

CREATE OR REPLACE FUNCTION ops.base_conta_situacao(_ficha jsonb, _perfil jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE PARALLEL SAFE
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare
  pv jsonb := coalesce(_ficha->'prova', '{}'::jsonb);
  nivel text := pv->>'nivel';
  provas jsonb := coalesce(pv->'provas', '[]'::jsonb);
  classe text := _ficha->'omie'->>'classe';
  so_matriz boolean := _ficha->'omie'->>'classe' = 'cliente'
    and coalesce(_ficha->'omie'->'cliente_em', '[]'::jsonb) = '["Planning Partners (Matriz)"]'::jsonb;
  criterios text[] := '{}';
  receita text := lower(coalesce(_perfil->>'situacao_receita', ''));
  recente boolean;
  grau integer;
begin
  if _ficha->'distrato'->>'estado' = 'concluido' then
    return jsonb_build_object('estado', 'ex_cliente', 'grau', null, 'rotulo', 'Ex-cliente', 'cita', 'nao',
      'motivo', 'Ex-cliente: distrato concluído na Central de Tratativas.');
  end if;
  if nivel = 'grupo' then
    return jsonb_build_object('estado', 'grupo', 'grau', null, 'rotulo', 'Empresa do grupo', 'cita', 'nao',
      'motivo', coalesce(pv->>'motivo', 'Empresa do grupo Planning.'));
  end if;
  if nivel = 'fornecedor' or classe in ('fornecedor', 'cliente_e_fornecedor') then
    return jsonb_build_object('estado', 'fornecedor', 'grau', null, 'rotulo', 'Fornecedor', 'cita', 'nao',
      'motivo', case
        when classe = 'cliente_e_fornecedor' then 'Fornecedor: tem as tags Cliente e Fornecedor no Omie, e qualquer tag Fornecedor tira da Base.'
        when classe = 'fornecedor' then 'Fornecedor: tag Fornecedor no Omie.'
        else coalesce(pv->>'motivo', 'Fornecedor.') end);
  end if;
  -- Contrato cancelado no Omie (Pedro, 27/10): quem só tem contrato cancelado e não pagou nos últimos 90 dias é
  -- ex-cliente, com a vigência final como data de saída. Vem depois de grupo e fornecedor, como o distrato vem antes.
  if coalesce((pv->>'contrato_cancelado')::boolean, false)
     and not coalesce((pv->>'recebido_em')::date >= current_date - 90, false)
     and not coalesce((pv->>'faturado_grupo_em')::date >= date_trunc('month', current_date - 90)::date, false) then
    return jsonb_build_object('estado', 'ex_cliente', 'grau', null, 'rotulo', 'Ex-cliente', 'cita', 'nao',
      'saida_em', pv->>'contrato_fim',
      'motivo', 'Ex-cliente: contrato cancelado no Omie' ||
        coalesce(' (fim em ' || to_char((pv->>'contrato_fim')::date, 'MM/YYYY') || ')', '') ||
        ' e sem pagamento nos últimos 90 dias.');
  end if;
  if provas ? 'ganho_pipedrive' then criterios := array_append(criterios, 'negócio ganho no Pipedrive'); end if;
  if provas ?| array['contrato', 'receber', 'faturado_grupo'] then
    criterios := array_append(criterios, 'contrato ou recebimento no Omie');
  end if;
  if jsonb_array_length(coalesce(_ficha->'empresa_ids', '[]'::jsonb)) > 0
     or jsonb_array_length(coalesce(_ficha->'pipefy_ids', '[]'::jsonb)) > 0 then
    criterios := array_append(criterios, 'base de clientes do Pipefy');
  end if;
  if classe = 'cliente' and not so_matriz then criterios := array_append(criterios, 'tag Cliente no Omie da unidade'); end if;
  if cardinality(criterios) > 0 then
    recente := coalesce((pv->>'contrato_ativo')::boolean, false)
      or coalesce((pv->>'recebido_em')::date >= current_date - 90, false)
      or coalesce((pv->>'faturado_grupo_em')::date >= date_trunc('month', current_date - 90)::date, false);
    grau := case when recente then 4 when nivel = 'comprovado' then 3 when _ficha->>'origin' = 'antiga' then 2 else 1 end;
    return jsonb_build_object('estado', 'cliente', 'grau', grau, 'cita', 'sim', 'criterios', to_jsonb(criterios),
      'rotulo', case grau when 4 then 'Pagamento visto' when 3 then 'Prova de cliente' when 2 then 'Base Antiga sem prova'
                          else 'Base Nova sem prova' end,
      'motivo', 'Cliente pela regra: ' || array_to_string(criterios, ', ') || '.');
  end if;
  if so_matriz then
    if receita in ('baixada', 'inapta', 'suspensa', 'nula') then
      return jsonb_build_object('estado', 'nao_cliente', 'grau', null, 'rotulo', 'Não é cliente', 'cita', 'nao',
        'motivo', 'Não é cliente: só a tag Cliente do Omie da Matriz, com CNPJ ' || receita || ' na Receita.');
    end if;
    -- Lote da Matriz com CNPJ ativo (Pedro, 15/10 à tarde): conta como cliente, no grau mais baixo. Continua fora das
    -- ofertas (soTagDaMatriz, 06/10) até o sócio de Goiânia confirmar.
    return jsonb_build_object('estado', 'cliente', 'grau', case when _ficha->>'origin' = 'antiga' then 2 else 1 end,
      'cita', 'sim', 'criterios', to_jsonb(array['tag Cliente no Omie da Matriz']),
      'rotulo', case when _ficha->>'origin' = 'antiga' then 'Base Antiga sem prova' else 'Base Nova sem prova' end,
      'motivo', 'Cliente pela regra: tag Cliente no Omie da Matriz (lote de mar/2025), sem faturamento do grupo em 2026. O sócio de Goiânia confirma.');
  end if;
  return jsonb_build_object('estado', 'nao_cliente', 'grau', null, 'rotulo', 'Não é cliente', 'cita', 'nao',
    'motivo', 'Não é cliente: sem negócio ganho, base do Pipefy, tag Cliente, contrato nem recebimento' ||
      case when provas ? 'ecd' then ' (só a ECD na Planning)' else '' end || '.');
end $function$
;
