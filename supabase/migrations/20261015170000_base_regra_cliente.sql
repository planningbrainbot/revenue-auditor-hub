-- Regra de cliente na Base (Pedro, 15/10/2026, proposta "Base à Prova de Criança", versão 14: "Boa, finalmente. Pode
-- executar"). Uma regra simples decide quem é cliente, e o grau de confiança mostra a certeza dentro de quem é cliente.
--
-- Cliente = negócio ganho no Pipedrive (Inside Sales ou Sócios) OU registro na base de clientes do Pipefy OU tag Cliente
-- no Omie de uma unidade OU contrato ou recebimento no Omie, inclusive o faturamento das empresas do grupo (Financial
-- Brain). Não é cliente: distrato concluído na Central de Tratativas (ex-cliente) ou qualquer tag Fornecedor no Omie,
-- inclusive quem tem as duas tags ("duas tags não conta", opção A). Empresa do grupo e quem recebe pagamento da Planning
-- sem prova de cliente ficam fora, como antes.
-- Lote da Matriz (só a tag Cliente do Omie da Matriz, o lote de mar/2025): com faturamento do grupo, contrato ou ganho é
-- cliente; com CNPJ ativo e nada disso fica "a confirmar" (fila do sócio de Goiânia); com CNPJ baixado, inapto, suspenso
-- ou nulo na Receita não é cliente (opção A, 15/10).
-- Grau, só para cliente: 4 pagamento visto (recebimento em 90 dias, contrato ativo no Omie ou faturamento do grupo desde o
-- mês de 90 dias atrás) · 3 prova de cliente · 2 Base Antiga sem prova · 1 Base Nova sem prova.
--
-- O que esta migration faz:
--   a. ops.base_faturamento_grupo: CNPJs faturados pelas empresas do grupo (receita 1.1 do Financial Brain e títulos a
--      receber em aberto), gravados pela omie-pagamentos-sync a cada 6 horas.
--   b. ops.base_conta_prova: faturamento do grupo e contrato ganho (ops.contratos) viram prova; a prova devolve a data do
--      último recebimento, o contrato ativo e a última competência faturada pelo grupo.
--   c. ops.base_conta_situacao(): a regra e o grau, sobre a ficha. Gravada na ficha como `situacao`.
--   d. Fornecedor pela regra (qualquer tag Fornecedor) passa a ser restrito a admin, como o fornecedor pela prova.
--   e. Ofertas: só cliente pela regra entra (Consultoria, Finance, Cella e Recon).
-- Medido em 15/10 (consulta de conferência, scratchpad da sessão): 5.743 clientes (4 · 1.226 · 3 · 1.734 · 2 · 2.183 ·
-- 1 · 600), 609 a confirmar, 1.803 não clientes, 28 ex-clientes, 2.212 fornecedores e 33 do grupo, em 10.428 contas.

-- a. Faturamento das empresas do grupo --------------------------------------------------------------------------------
create table if not exists ops.base_faturamento_grupo (
  cnpj text primary key,
  nome text,
  empresas text[] not null default '{}',
  ultima_competencia date,
  titulos_abertos integer not null default 0,
  primeira_vez timestamptz not null default now(),
  visto_em timestamptz not null default now()
);
comment on table ops.base_faturamento_grupo is
  'CNPJs faturados pelas empresas do grupo (Financial Brain: receita 1.1 em lancamentos, casada por nome em omie_contraparte, e titulos_receber_live em aberto), gravados por omie-pagamentos-sync. empresas = apelidos de quem fatura.';
alter table ops.base_faturamento_grupo enable row level security;
revoke all on ops.base_faturamento_grupo from public, anon, authenticated;
grant select, insert, update, delete on ops.base_faturamento_grupo to service_role;

-- b. Prova de cliente com os sinais da regra ------------------------------------------------------------------------
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
     or exists (select 1 from ops.contratos k where k.ganho_em is not null
                  and (k.empresa_id = any(coalesce(_empresa_ids, '{}'::integer[]))
                       or (cardinality(cs) > 0 and length(ops.qb_so_digitos(k.cnpj)) >= 11 and ops.qb_so_digitos(k.cnpj) = any(cs)))) then
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

-- c. A regra de cliente e o grau -------------------------------------------------------------------------------------
-- Ordem: ex-cliente > grupo > fornecedor > cliente > a confirmar (lote da Matriz) > não é cliente. `cita` diz o que a tela
-- mostra em reunião: sim (cliente), confirmar (a confirmar), nao (o resto).
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
    return jsonb_build_object('estado', 'a_confirmar', 'grau', null, 'rotulo', 'A confirmar', 'cita', 'confirmar',
      'motivo', 'A confirmar: só a tag Cliente do lote de mar/2025 do Omie da Matriz, sem faturamento do grupo, contrato, Pipefy nem negócio ganho.');
  end if;
  return jsonb_build_object('estado', 'nao_cliente', 'grau', null, 'rotulo', 'Não é cliente', 'cita', 'nao',
    'motivo', 'Não é cliente: sem negócio ganho, base do Pipefy, tag Cliente, contrato nem recebimento' ||
      case when provas ? 'ecd' then ' (só a ECD na Planning)' else '' end || '.');
end $$;
revoke all on function ops.base_conta_situacao(jsonb, jsonb) from public, anon;
grant execute on function ops.base_conta_situacao(jsonb, jsonb) to authenticated, service_role;

-- A ficha leva a situação ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.base_unica_ficha(_keys text[] DEFAULT NULL::text[])
 RETURNS TABLE(key text, unidade_ids integer[], ficha jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
 -- Regra de cliente (15/10): a ficha leva a situação (cliente, a confirmar, não é cliente, ex-cliente, fornecedor, grupo)
 -- e o grau de confiança de quem é cliente, calculados sobre a própria ficha.
 select f.key, f.unidade_ids, f.ficha || jsonb_build_object('situacao', ops.base_conta_situacao(f.ficha, f.perfil))
 from (
   select a.key, a.unidade_ids, a.perfil, jsonb_build_object('key',a.key,'identity_conflict',a.identity_conflict,'cnpjs',a.cnpjs,'empresa_ids',a.empresa_ids,'pipefy_ids',a.pipefy_ids,'pipedrive_ids',a.pipedrive_ids,'omie_units',a.omie_unidades,'omie_records',a.omie_registros,'contact_count',a.contatos,'contact',a.com_contato,'ecd',a.ecd_registros,'declared_origin',a.declarada,'pending_fields',(select coalesce(jsonb_agg(distinct k.value),'[]') from jsonb_array_elements(coalesce(a.pendencias,'[]')) p(value) cross join lateral jsonb_object_keys(case when jsonb_typeof(p.value)='object' then p.value else '{}' end) k(value)),'origin',a.origem,'origin_reason',a.motivo,'origin_evidence',a.origin_evidence,'tax_evidence',a.tax_evidence,'responsible',a.responsavel,'validated_at',a.confirmado_em,'synced_at',a.sincronizado,'source_status',case when a.ausente then 'absent' when a.nao_lidas>0 then 'pending' when cardinality(a.pipefy_ids)>0 then 'ok' else 'not_linked' end,'needs_validation',a.origem='confirmar','needs_source_correction',a.origem in ('nova','antiga') and cardinality(a.pipefy_ids)>0 and a.declarada<>array[case when a.origem='nova' then 'Base Nova' else 'Base Antiga' end],
     'distrato',s.distrato,'consultoria',s.consultoria,'omie',om.omie,'prova',pv.prova) ficha
   from ops.base_conta_estado a
   left join ops.base_conta_sinais(_keys) s on s.key = a.key
   left join lateral ops.base_conta_omie_tags(a.cnpjs) om on true  -- tags do cadastro do Omie
   left join lateral (select ops.base_conta_prova(a.cnpjs, a.empresa_ids, a.ecd_registros, a.perfil, om.omie) prova) pv on true  -- prova de cliente (01/10)
   where _keys is null or a.key=any(_keys)
 ) f
$function$;

-- d. Fornecedor pela regra só para admin ----------------------------------------------------------------------------
-- Com a situação na ficha, ela decide; antes de a carteira se atualizar, vale a regra de 01/10.
create or replace function ops.base_prova_restrita(_base jsonb)
returns boolean
language sql immutable parallel safe set search_path = ops, public, extensions as $$
  select case
    when _base->'situacao'->>'estado' is not null then _base->'situacao'->>'estado' in ('fornecedor', 'grupo')
    else coalesce(_base->'prova'->>'nivel',
                  case when _base->'omie'->>'classe' in ('fornecedor', 'pessoa_interna') then 'fornecedor' end,
                  '') in ('fornecedor', 'grupo')
  end
$$;
grant execute on function ops.base_prova_restrita(jsonb) to authenticated, service_role;

-- O CNPJ restrito guarda a situação: o cadastro bruto do Omie esconde também quem tem as duas tags.
create or replace function ops.base_carteira_restritos()
returns trigger
language plpgsql security definer set search_path = ops, public, extensions as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    delete from ops.base_cnpj_restrito where account_key = old.key;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and ops.base_prova_restrita(new.base) then
    insert into ops.base_cnpj_restrito (cnpj, account_key, nivel)
    select distinct x, new.key, coalesce(new.base->'situacao'->>'estado', new.base->'prova'->>'nivel', 'fornecedor')
      from jsonb_array_elements_text(coalesce(new.base->'cnpjs', '[]')) x
    on conflict (cnpj, account_key) do update set nivel = excluded.nivel;
  end if;
  return null;
end $$;
revoke all on function ops.base_carteira_restritos() from public, anon, authenticated;

-- e. Ofertas só para cliente pela regra -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ops.monetizacao_offer_issue(a jsonb, p text, r jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare b record; adjusted jsonb; situacao text; s record; issue text; rr jsonb; acima boolean; abaixo boolean; pv jsonb; sit jsonb;
begin
 select * into b from ops.base_conta_estado where key=a->>'key';
 if b.key is null then return 'Conta ainda não conciliada na base única';end if;
 if b.identity_conflict then return 'CNPJ divergente entre fontes; revisar identidade antes de enviar';end if;
 situacao:=coalesce(nullif(r->>'situacao_receita',''),a->>'situacao_receita','ativa');
 if situacao<>'ativa' then return 'Empresa '||situacao||' na Receita Federal; fora das ofertas';end if;
 -- sinais: distrato concluído vale para todos os produtos, logo depois da situação cadastral
 -- (definitivo antes do que pede ação humana), na mesma ordem de oferta() no cliente.
 select * into s from ops.base_conta_sinais(array[a->>'key']);
 if s.distrato->>'estado'='concluido' then return ops.base_distrato_bloqueio(s.distrato);end if;
 -- Prova de cliente (01/10): empresa do grupo, fornecedor (recebe pagamento no Omie, ou só tag de fornecedor) e conta
 -- só do Omie sem prova saem de todas as ofertas, Recon inclusive. Mesma posição de fornecedorForaDeOferta() no cliente.
 pv:=ops.base_conta_prova(b.cnpjs, b.empresa_ids, b.ecd_registros, b.perfil, (select t.omie from ops.base_conta_omie_tags(b.cnpjs) t));
 if pv->>'nivel' in ('grupo','fornecedor','sem_prova') then return pv->>'motivo';end if;
 -- Só a tag Cliente no Omie da Matriz (06/10): a Matriz marca Cliente em quem ela paga e em prospect; sem contrato,
 -- recebimento, ECD ou ganho, sai como sem prova. A tag no Omie de uma unidade continua. Espelho de soTagDaMatriz().
 if pv->>'nivel'='so_tag' and exists(select 1 from ops.base_conta_omie_tags(b.cnpjs) t
   where jsonb_array_length(coalesce(t.omie->'cliente_em','[]'))>0
     and not exists(select 1 from jsonb_array_elements_text(t.omie->'cliente_em') u where u !~* 'matriz')) then
  return 'Só a tag Cliente no Omie da Matriz, sem contrato, recebimento, ECD nem ganho. A Matriz marca prospect e fornecedor como Cliente; fora das ofertas.';
 end if;
 -- Regra de cliente (15/10): só quem é cliente pela regra entra nas ofertas (Produtos e Listas moram na Monetização e
 -- leem a regra do domínio Clientes). A situação vem da ficha gravada na carteira; conta nova, ainda sem ela, segue só
 -- as regras acima. Espelho de foraDaRegraDeCliente() no cliente (src/lib/monetizacao/model.ts).
 select c.base->'situacao' into sit from ops.base_carteira c where c.key=a->>'key';
 if sit->>'estado' is not null and sit->>'estado'<>'cliente' then
  return coalesce(sit->>'motivo','Fora da regra de cliente.')||' Fora das ofertas.';
 end if;
 -- Só fornecedor no Omie (tags do cadastro, 29/09): fora de todas as ofertas, Recon inclusive, na mesma posição
 -- de fornecedorForaDeOferta() no cliente (src/lib/monetizacao/model.ts).
 if (select t.omie->>'classe' from ops.base_conta_omie_tags(b.cnpjs) t)='fornecedor' then
  return 'Só fornecedor no Omie, sem tag de cliente; fora das ofertas';
 end if;
 -- Recon (pipe 38 do Pipedrive, 29/09): o espelho de ofertaRecon (src/lib/monetizacao/recon.ts), na mesma
 -- ordem: identidade, situação e distrato concluído já passaram; o cadastro ausente no Pipefy não veta o Recon.
 if p='recon' then
  rr:=a->'recon';
  if rr is null or jsonb_typeof(rr)<>'object' then return 'Contrato e carteira BPO ainda não conferidos';end if;
  if rr->>'bpo_status'='bpo' then return coalesce(nullif(rr->>'reason',''),'Cliente com BPO contábil, fiscal, folha ou financeiro');end if;
  if coalesce((rr->>'revenue_conflict')::boolean,false) or coalesce((a->>'band_conflict')::boolean,false) then return 'Fontes divergem sobre o faturamento anual';end if;
  acima:=case when rr->>'revenue_exact' is not null then (rr->>'revenue_exact')::numeric>5000000 else coalesce((rr->>'revenue_min')::numeric>5000000,false) end;
  abaixo:=case when rr->>'revenue_exact' is not null then (rr->>'revenue_exact')::numeric<=5000000 else coalesce((rr->>'revenue_max')::numeric<=5000000,false) end;
  if abaixo then return 'Faturamento anual de até R$ 5 milhões';end if;
  if not acima then return 'Confirmar faturamento anual acima de R$ 5 milhões; a faixa atual não comprova o corte';end if;
  if coalesce(rr->>'bpo_status','')<>'fora_bpo' then return coalesce(nullif(rr->>'reason',''),'Confirmar que a empresa não tem BPO');end if;
  -- a tratativa em andamento segura a oferta, como comTratativa() no cliente
  return ops.base_distrato_bloqueio(s.distrato);
 end if;
 if b.ausente then return 'Cadastro ausente no Pipefy; revisar a origem antes de enviar';end if;
 if p='consultoria' and b.origem<>'antiga' then return b.motivo;end if;
 -- sinais: quem já é cliente (ou tem proposta aberta) da Consultoria não recebe Consultoria.
 if p='consultoria' then
  issue:=ops.base_consultoria_bloqueio(s.consultoria);
  if issue is not null then return issue;end if;
 end if;
 adjusted:=a||jsonb_build_object('non_simples_confirmed',b.tax_evidence->'non_simples',
  'regime_conflict',coalesce((a->>'regime_conflict')::boolean,false) or coalesce((b.tax_evidence->>'conflict')::boolean,false));
 if p='consultoria' then
  adjusted:=adjusted||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo,
   'non_simples_confirmed',coalesce(nullif(b.tax_evidence->'non_simples','null'::jsonb),a#>'{consultoria_origin,non_simples_confirmed}')));
 end if;
 issue:=ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
 -- Região do Finance (02/10): só age com ops.monetizacao_regras.finance_regiao ligada; desligada devolve null.
 if issue is null and p='finance' then issue:=ops.monetizacao_finance_regiao_issue(a->>'key');end if;
 -- sinais: a tratativa só segura o que o produto aceitaria (comTratativa no cliente); conta que já
 -- tem motivo fica com o motivo dela.
 return coalesce(issue,ops.base_distrato_bloqueio(s.distrato));
end $function$;
