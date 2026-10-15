-- Goiânia e o lote da Matriz (Pedro, 15/10/2026 à tarde, depois de ver 743 clientes em Goiânia: "é pra ter muito mais
-- cliente em goiania"). Respostas dele:
--   1. faturamento do grupo NÃO vence a tag Fornecedor (fica como está);
--   2. conta sem unidade faturada pela contabilidade da Matriz (PAC, PCC, BPO Contábil, Gestão, Agro, MAROX) é de Goiânia;
--   3. os CNPJs faturados pelo grupo em 2026 que não existem na Base entram como contas novas (CPF não entra: a Base é por
--      CNPJ, ops.base_cnpj);
--   4. o lote da Matriz com CNPJ ativo conta como cliente, no grau mais baixo (antes: "a confirmar").
-- A unidade continua vindo do Pipefy; o faturamento só preenche quando o Pipefy não diz nada.

-- A unidade pelo faturamento ------------------------------------------------------------------------------------------
create or replace function ops.base_unidade_faturamento(_cnpjs text[])
returns integer
language sql stable security definer set search_path = ops, public, extensions as $$
  select case when exists (
    select 1 from ops.base_faturamento_grupo g
     where g.cnpj = any(coalesce(_cnpjs, '{}'::text[]))
       and g.empresas && array['PAC', 'PCC', 'BPO Contábil', 'GESTÃO', 'AGRO', 'MAROX', 'MAROX SERVIÇOS'])
  then (select u.id from ops.unidades u where u.nome_da_praca = 'Goiânia' limit 1) end
$$;
revoke all on function ops.base_unidade_faturamento(text[]) from public, anon, authenticated;
grant execute on function ops.base_unidade_faturamento(text[]) to service_role;

CREATE OR REPLACE FUNCTION ops.base_refresh_cadastro(_empresa integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare a record; un integer[]; names text[]; label text; company_names text[]; n integer:=0; gy integer; inferida boolean;
begin
 for a in select * from ops.monetizacao_contas where cardinality(empresa_ids)>0 and (_empresa is null or _empresa=any(empresa_ids)) loop
  select array_agg(distinct e.unidade_id) filter(where e.unidade_id is not null),array_agg(distinct u.nome_da_praca) filter(where u.nome_da_praca is not null)
   into un,names from ops.empresas e left join ops.unidades u on u.id=e.unidade_id
   where e.id=any(a.empresa_ids) and e.pipefy_sincronizado_em is not null;
  -- Sem unidade no Pipefy: a conta faturada pela contabilidade da Matriz é de Goiânia (Pedro, 15/10).
  inferida:=false;
  if un is null then
   gy:=ops.base_unidade_faturamento(array(select jsonb_array_elements_text(coalesce(b.base->'cnpjs','[]'::jsonb)) from ops.base_carteira b where b.key=a.key));
   if gy is not null then un:=array[gy]; names:=array(select nome_da_praca from ops.unidades where id=gy); inferida:=true; end if;
  end if;
  if exists(select 1 from ops.empresas where id=any(a.empresa_ids) and pipefy_sincronizado_em is not null) then
   label:=coalesce(array_to_string(names,' / '),'Unidade a confirmar');
   select array_agg(distinct coalesce(nullif(razao_social,''),titulo)) into company_names from ops.empresas where id=any(a.empresa_ids) and pipefy_sincronizado_em is not null;
   update ops.monetizacao_contas set unidade_ids=coalesce(un,'{}'),perfil=perfil||jsonb_build_object('name',case when cardinality(company_names)=1 then company_names[1] else perfil->>'name' end,'unit_label',label,'units',coalesce((select jsonb_agg(mu.key) from ops.monetizacao_unidades mu where mu.unidade_id=any(un)),'[]')),updated_at=now() where key=a.key;
   update ops.monetizacao_detalhes set detalhe=jsonb_set(jsonb_set(detalhe,'{fields}',coalesce(detalhe->'fields','{}')),'{fields,unidade}',jsonb_build_object('value',label,'source',case when inferida then 'Faturamento da contabilidade da Matriz' else 'Pipefy · leitura confirmada' end,'at',now(),'conflict',coalesce(cardinality(un),0)<>1)),updated_at=now() where account_key=a.key;
   n:=n+1;
  end if;
 end loop;
 return n;
end $function$;

-- Contas novas pelo faturamento e unidade das contas que o Pipefy não alcança -------------------------------------------
create or replace function ops.base_intake_faturamento()
returns jsonb
language plpgsql security definer set search_path = ops, public, extensions as $$
declare
  novas integer := 0;
  unidades integer := 0;
  gy integer := (select u.id from ops.unidades u where u.nome_da_praca = 'Goiânia' limit 1);
  contabil text[] := array['PAC', 'PCC', 'BPO Contábil', 'GESTÃO', 'AGRO', 'MAROX', 'MAROX SERVIÇOS'];
begin
  -- Os CNPJs que a Base já tem, uma vez só (a carteira guarda os CNPJs de cada conta).
  with na_base as materialized (
    select distinct x cnpj from ops.base_carteira b cross join lateral jsonb_array_elements_text(coalesce(b.base->'cnpjs', '[]'::jsonb)) x
  ), alvo as (
    select distinct on (f.cnpj) f.cnpj, f.nome, f.matriz
      from (select ops.base_cnpj(g.cnpj) cnpj, g.nome, g.empresas && contabil matriz from ops.base_faturamento_grupo g) f
      left join na_base nb on nb.cnpj = f.cnpj
     where f.cnpj is not null and nb.cnpj is null
       and not exists (select 1 from ops.monetizacao_contas m where m.key = 'omie-cnpj-' || f.cnpj)
  ), inseridas as (
    insert into ops.monetizacao_contas(key, perfil, unidade_ids, source_at)
    select 'omie-cnpj-' || cnpj,
      jsonb_build_object('key', 'omie-cnpj-' || cnpj, 'name', coalesce(nullif(nome, ''), 'Cliente faturado pelo grupo'),
        'units', case when matriz then coalesce((select jsonb_agg(mu.key) from ops.monetizacao_unidades mu where mu.unidade_id = gy), '[]'::jsonb) else '[]'::jsonb end,
        'unit_label', case when matriz then 'Goiânia' end, 'orgs', '[]'::jsonb, 'contact', false, 'band', null, 'regime', null,
        'segment', null, 'old_base', false, 'matrix', matriz, 'new_commercial', false, 'pipedrive_contract', false,
        'consultoria_priority', false, 'finance_candidate', false,
        'finance', jsonb_build_object('status', 'fora_regra', 'reason', 'Sem contrato ganho no Pipedrive'), 'ecd', false,
        'source_ids', jsonb_build_array('faturamento:' || cnpj)),
      case when matriz and gy is not null then array[gy] else '{}'::integer[] end, now()
      from alvo
    on conflict (key) do nothing
    returning key
  ) select count(*) into novas from inseridas;
  insert into ops.monetizacao_detalhes(account_key, detalhe)
  select a.key, jsonb_build_object('cnpjs', jsonb_build_array(substring(a.key from 11)), 'contacts', '[]'::jsonb,
           'sources', jsonb_build_object('faturamento', true))
    from ops.monetizacao_contas a
   where a.key like 'omie-cnpj-%' and not exists (select 1 from ops.monetizacao_detalhes d where d.account_key = a.key)
  on conflict (account_key) do nothing;
  -- Sem unidade e sem empresa sincronizada com o Pipefy (base_refresh_cadastro não passa por elas).
  with alvo as (
    select a.key from ops.monetizacao_contas a
     where cardinality(a.unidade_ids) = 0
       and not exists (select 1 from ops.empresas e where e.id = any(a.empresa_ids) and e.pipefy_sincronizado_em is not null)
       and ops.base_unidade_faturamento(array(select jsonb_array_elements_text(coalesce(b.base->'cnpjs', '[]'::jsonb))
                                                from ops.base_carteira b where b.key = a.key)) is not null
  ), feitas as (
    update ops.monetizacao_contas a
       set unidade_ids = array[gy],
           perfil = a.perfil || jsonb_build_object('unit_label', 'Goiânia',
             'units', coalesce((select jsonb_agg(mu.key) from ops.monetizacao_unidades mu where mu.unidade_id = gy), '[]'::jsonb)),
           updated_at = now()
      from alvo where a.key = alvo.key and gy is not null
    returning 1
  ) select count(*) into unidades from feitas;
  if novas + unidades > 0 then update ops.monetizacao_sync set catalog_at = now() where id; end if;
  return jsonb_build_object('novas', novas, 'unidade_goiania', unidades);
end $$;
revoke all on function ops.base_intake_faturamento() from public, anon, authenticated;
grant execute on function ops.base_intake_faturamento() to service_role;

-- O lote da Matriz conta como cliente --------------------------------------------------------------------------------
create or replace function ops.base_conta_situacao(_ficha jsonb, _perfil jsonb)
returns jsonb
language plpgsql stable parallel safe set search_path = ops, public, extensions as $$
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
end $$;
revoke all on function ops.base_conta_situacao(jsonb, jsonb) from public, anon;
grant execute on function ops.base_conta_situacao(jsonb, jsonb) to authenticated, service_role;
