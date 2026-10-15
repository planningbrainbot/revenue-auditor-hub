-- Desempenho da prova de cliente (15/10/2026, depois de 20261015170000): o contrato ganho pelo CNPJ varria
-- ops.contratos inteiro com ops.qb_so_digitos() para cada conta, a cada lote de 500 da atualização da carteira (15 s).
-- Com o banco único saturado à tarde, os lotes passaram de ~2 s para 30 s e começaram a estourar o tempo. Agora o
-- contrato é procurado por dois caminhos com índice (empresa e CNPJ em dígitos). O resultado não muda.
create index if not exists idx_contratos_ganho_cnpj_digitos on ops.contratos (ops.qb_so_digitos(cnpj)) where ganho_em is not null;
create index if not exists idx_contratos_ganho_empresa on ops.contratos (empresa_id) where ganho_em is not null;

create or replace function ops.base_conta_prova(_cnpjs text[], _empresa_ids integer[], _ecd jsonb, _perfil jsonb, _omie jsonb)
returns jsonb
language plpgsql stable security definer set search_path = ops, public, extensions as $$
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
    'recebido_em', recebido, 'contrato_ativo', contrato_ativo, 'faturado_grupo_em', fat_em, 'faturado_por', to_jsonb(fat_por));
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
end $$;
revoke all on function ops.base_conta_prova(text[], integer[], jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function ops.base_conta_prova(text[], integer[], jsonb, jsonb, jsonb) to service_role;
