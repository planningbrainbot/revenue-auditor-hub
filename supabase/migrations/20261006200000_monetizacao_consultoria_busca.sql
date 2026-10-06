-- Consultoria › Buscar empresa (`/monetizacao?aba=handoff-consultoria&visao=empresa`): a ficha de uma empresa na
-- Consultoria precisa do crédito aprovado, do saldo, da última recuperação, da cidade, do CNAE e da situação de cada
-- cliente da plataforma. O RPC da tela Consultoria (20261006180000) passa a devolver esses campos; o resto não muda.
-- Pedido do Pedro em 06/10/2026: "uma ferramenta de pesquisa na tela da consultoria pra poder pesquisar CNPJ ou nome
-- e ver o estado da empresa ali na consultoria".

create or replace function ops.cruzamento_consultoria_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _escopo record;
  _financeiro boolean;
  _porta text;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização (view.monetizacao).' using errcode = '42501';
  end if;
  select todas_unidades, todas_empresas into _escopo from ops.usuario_escopo where user_id = auth.uid();
  if not coalesce(_escopo.todas_unidades, false) then
    raise exception 'Seu acesso não inclui a visão de todas as unidades.' using errcode = '42501';
  end if;
  _financeiro := coalesce(public.tem_produto('financeiro'), false);
  _porta := case
    when not _financeiro then 'Sua conta não tem acesso ao Brain Financeiro.'
    when not coalesce(_escopo.todas_empresas, false) then 'Os valores da PAT exigem ver todas as empresas no Financeiro; seu escopo é por empresa.'
  end;

  return jsonb_build_object(
    'lido_em', now(),
    'porta_financeiro', jsonb_build_object('aberta', _porta is null, 'motivo', _porta),
    'frescor', jsonb_build_object(
      'consultoria', (select max(executado_em) from ops.sync_log where fonte = 'consultoria' and status = 'sucesso'),
      'negocios', (select max(executado_em) from ops.sync_log where fonte = 'handoff_consultoria' and status in ('sucesso', 'parcial')),
      'financeiro_carregado_em', (select detalhes->>'financeiro_carregado_em' from ops.sync_log
                                   where fonte = 'handoff_consultoria' and detalhes ? 'financeiro_carregado_em'
                                   order by executado_em desc limit 1)
    ),
    -- Um cliente por CNPJ cadastrado na plataforma, com os projetos que a API manda.
    'clientes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'cnpj', c.cnpj, 'cnpj_raiz', c.cnpj_raiz, 'razao_social', c.razao_social,
               'nome_fantasia', c.nome_fantasia, 'grupo_economico', c.grupo_economico,
               'regime_tributario', c.regime_tributario, 'porte', c.porte, 'parceiro', c.parceiro,
               'cadastrado_em', c.cadastrado_em,
               'uf', c.uf, 'municipio', c.municipio, 'cnae_descricao', c.cnae_descricao, 'ativo', c.ativo,
               'situacao_receita', c.situacao_receita,
               'valor_identificado', c.payload->'valor_identificado',
               'credito_aprovado', c.payload->'credito_aprovado',
               'credito_recuperado', c.payload->'credito_recuperado',
               'credito_saldo', c.payload->'credito_saldo',
               'credito_ultima_recuperacao_em', c.payload->'credito_ultima_recuperacao_em',
               'projetos', coalesce(c.payload->'projetos', '[]'::jsonb)) order by c.razao_social)
      from ops.consultoria_clientes c where c.ausente_desde is null), '[]'::jsonb),
    'propostas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'empresa', p.empresa, 'cnpj', nullif(regexp_replace(coalesce(p.cnpj, ''), '\D', '', 'g'), ''),
               'produto', p.produto, 'status', p.status, 'percentual_exito', p.percentual_exito,
               'valor_total', p.valor_total, 'data_envio', p.data_envio, 'canal_venda', p.canal_venda,
               'parceiro', p.parceiro) order by p.data_envio desc nulls last)
      from ops.consultoria_propostas p where p.ausente_desde is null), '[]'::jsonb),
    -- Um negócio ganho em 2026 por linha, com o CNPJ na ordem de confiança e o card de onboarding, se houver.
    'negocios', coalesce((
      select jsonb_agg(jsonb_build_object(
               'deal', k.deal, 'titulo', k.titulo, 'ganho_em', k.ganho_em, 'origem_pipeline', k.origem_pipeline,
               'unidade', k.unidade, 'closer', k.closer, 'regime_tributario', k.regime_tributario,
               'cnpj', r.cnpj, 'cnpj_fonte', r.fonte, 'organizacao', n.organizacao,
               'onboarding', exists (select 1 from ops.handoff_consultoria_onboarding o
                                      where o.ausente_desde is null and o.pipedrive_deal_id = k.deal))
             order by k.ganho_em, k.deal)
      from (
        select distinct on (c.pipedrive_deal_id) c.pipedrive_deal_id as deal, c.titulo, c.ganho_em, c.origem_pipeline,
               c.unidade, c.closer, c.regime_tributario, c.cnpj, c.empresa_id
        from ops.contratos c
        where c.ganho_em >= '2026-01-01' and c.pipedrive_deal_id is not null
        order by c.pipedrive_deal_id, c.ganho_em, c.id
      ) k
      left join ops.handoff_consultoria_negocios n on n.pipedrive_deal_id = k.deal
      left join lateral (
        select x.cnpj, x.fonte from (
          select regexp_replace(coalesce(k.cnpj, ''), '\D', '', 'g') as cnpj, 'contrato' as fonte, 1 as ord
          union all
          select regexp_replace(coalesce(d.cnpj, ''), '\D', '', 'g'), 'documento', 2
            from ops.contratos_documentos d where d.pipedrive_deal_id = k.deal
          union all
          select regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g'), 'empresa', 3
            from ops.empresas e where e.id = k.empresa_id
          union all
          select regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g'), 'empresa', 4
            from ops.contratos_documentos d join ops.empresas e on e.id = d.empresa_id where d.pipedrive_deal_id = k.deal
          union all
          select o.cnpj, 'onboarding', 5
            from ops.handoff_consultoria_onboarding o where o.ausente_desde is null and o.pipedrive_deal_id = k.deal
          union all
          select n.cnpj, n.cnpj_fonte, 6 where n.cnpj is not null
        ) x
        where length(x.cnpj) in (11, 14)
        order by x.ord
        limit 1
      ) r on true), '[]'::jsonb),
    'pat', case when _porta is null then coalesce((
      select jsonb_agg(jsonb_build_object('cnpj', p.cnpj, 'mes', p.mes, 'faturado', p.faturado, 'recebido', p.recebido)
                       order by p.cnpj, p.mes)
      from ops.handoff_consultoria_pat p), '[]'::jsonb) end
  );
end;
$$;

revoke all on function ops.cruzamento_consultoria_painel() from public, anon;
grant execute on function ops.cruzamento_consultoria_painel() to authenticated;
