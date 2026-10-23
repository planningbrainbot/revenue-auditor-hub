-- Desfaz 20261022161000: as três leituras voltam a pedir só view.monetizacao, a chave sai e a Karol volta a ter só o
-- Growth. A porta do Ops, a área e o escopo dela só saem se foram dados por esta migration (ela não tinha nenhum em
-- 22/10/2026).

begin;

CREATE OR REPLACE FUNCTION ops.consultoria_porta_leitura()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare
  _escopo record;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização (view.monetizacao).' using errcode = '42501';
  end if;
  select todas_unidades, todas_empresas into _escopo from ops.usuario_escopo where user_id = auth.uid();
  if not coalesce(_escopo.todas_unidades, false) then
    raise exception 'Seu acesso não inclui a visão de todas as unidades.' using errcode = '42501';
  end if;
  -- Devolve o motivo de a porta do Financeiro estar fechada, ou null quando está aberta.
  return case
    when not coalesce(public.tem_produto('financeiro'), false) then 'Sua conta não tem acesso ao Brain Financeiro.'
    when not coalesce(_escopo.todas_empresas, false)
      then 'Os valores financeiros exigem ver todas as empresas no Financeiro; seu escopo é por empresa.'
  end;
end;
$function$
;

CREATE OR REPLACE FUNCTION ops.handoff_consultoria_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare
  _escopo record;
  _todas_unidades boolean;
  _financeiro boolean;
  _porta text;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização (view.monetizacao).' using errcode = '42501';
  end if;
  select todas_unidades, todas_empresas into _escopo from ops.usuario_escopo where user_id = auth.uid();
  _todas_unidades := coalesce(_escopo.todas_unidades, false);
  _financeiro := coalesce(public.tem_produto('financeiro'), false);
  _porta := case
    when not _financeiro then 'Sua conta não tem acesso ao Brain Financeiro.'
    when not coalesce(_escopo.todas_empresas, false) then 'Os valores da PAT exigem ver todas as empresas no Financeiro; seu escopo é por empresa.'
  end;

  return jsonb_build_object(
    'lido_em', now(),
    'todas_unidades', _todas_unidades,
    'porta_financeiro', jsonb_build_object('aberta', _porta is null, 'motivo', _porta),
    'regras', coalesce((
      select jsonb_agg(jsonb_build_object('chave', chave, 'valor', valor, 'vigente_desde', vigente_desde,
               'situacao', situacao, 'origem', origem) order by chave, vigente_desde)
      from ops.handoff_consultoria_regras), '[]'::jsonb),
    'frescor', jsonb_build_object(
      'onboarding', (select max(executado_em) from ops.sync_log where fonte = 'handoff_consultoria' and status in ('sucesso', 'parcial')),
      'consultoria', (select max(executado_em) from ops.sync_log where fonte = 'consultoria' and status = 'sucesso'),
      'pat', (select max(sincronizado_em) from ops.handoff_consultoria_pat),
      'financeiro_carregado_em', (select detalhes->>'financeiro_carregado_em' from ops.sync_log
                                   where fonte = 'handoff_consultoria' and detalhes ? 'financeiro_carregado_em'
                                   order by executado_em desc limit 1)
    ),
    'clientes', coalesce((
      select jsonb_agg(c order by c->>'card')
      from (
        select jsonb_build_object(
          'card', o.pipefy_card_id,
          'titulo', o.titulo,
          'unidade', o.unidade,
          'unidade_id', o.unidade_id,
          'fase', o.fase_atual,
          'criado_em', o.criado_em,
          'venda_em', o.venda_em,
          'kickoff_em', o.kickoff_em,
          'encaminhado', o.encaminhado,
          'cnpj', o.cnpj,
          'cnpj_fonte', o.cnpj_fonte,
          'faixa', o.faixa,
          'faixa_ordem', o.faixa_ordem,
          'faixa_fonte', o.faixa_fonte,
          'consultoria', cons.j,
          'propostas', coalesce(prop.n, 0),
          'pat', case when _porta is null then pat.j end
        ) as c
        from ops.handoff_consultoria_onboarding o
        -- Chegou: o CNPJ, ou na falta dele a raiz (mesma pessoa jurídica), na plataforma.
        left join lateral (
          -- Projetos e créditos chegam no payload da API desde 05/10 (a consultoria-sync guarda o objeto inteiro).
          select jsonb_build_object('cadastrado_em', cc.cadastrado_em, 'via', x.via, 'ativo', cc.ativo,
                   'inativo_desde', cc.inativo_desde, 'valor_a_recuperar', cc.valor_a_recuperar,
                   'valor_a_recuperar_em', cc.valor_a_recuperar_em,
                   'valor_identificado', cc.payload->'valor_identificado',
                   'credito_aprovado', cc.payload->'credito_aprovado',
                   'credito_recuperado', cc.payload->'credito_recuperado',
                   'credito_saldo', cc.payload->'credito_saldo',
                   'credito_ultima_recuperacao_em', cc.payload->'credito_ultima_recuperacao_em',
                   'projetos', coalesce(cc.payload->'projetos', '[]'::jsonb)) as j
          from (
            select cc.id, 'cnpj' as via, 0 as ord from ops.consultoria_clientes cc
             where o.cnpj is not null and cc.cnpj = o.cnpj and cc.ausente_desde is null
            union all
            select cc.id, 'raiz', 1 from ops.consultoria_clientes cc
             where length(o.cnpj) = 14 and cc.cnpj_raiz = left(o.cnpj, 8) and cc.ausente_desde is null
          ) x join ops.consultoria_clientes cc on cc.id = x.id
          order by x.ord, cc.cadastrado_em
          limit 1
        ) cons on true
        left join lateral (
          select count(*) as n from ops.consultoria_propostas p
           where p.ausente_desde is null and o.cnpj is not null
             and (regexp_replace(p.cnpj, '\D', '', 'g') = o.cnpj
                  or (length(o.cnpj) = 14 and left(regexp_replace(p.cnpj, '\D', '', 'g'), 8) = left(o.cnpj, 8)))
        ) prop on true
        -- PAT: o CNPJ exato; sem ele, a raiz.
        left join lateral (
          select jsonb_agg(jsonb_build_object('mes', mes, 'faturado', faturado, 'creditos', creditos,
                   'recebido', recebido, 'cliente_omie', cliente_omie) order by mes) as j
          from (
            select p.mes, sum(p.faturado) faturado, sum(p.creditos) creditos, sum(p.recebido) recebido,
                   string_agg(distinct p.cliente_omie, ' · ') cliente_omie
            from ops.handoff_consultoria_pat p
            where o.cnpj is not null and (
              p.cnpj = o.cnpj
              or (length(o.cnpj) = 14 and left(p.cnpj, 8) = left(o.cnpj, 8)
                  and not exists (select 1 from ops.handoff_consultoria_pat e where e.cnpj = o.cnpj)))
            group by p.mes
          ) m
        ) pat on true
        where o.ausente_desde is null
          and (_todas_unidades or ops.monetizacao_scope(array[o.unidade_id]))
      ) linhas
    ), '[]'::jsonb)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION ops.cruzamento_consultoria_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
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
          union all
          -- CNPJ achado pelo Brain (onboarding ou nome), migration 20261016190000.
          select m.cnpj, m.fonte, 7 from ops.consultoria_negocio_cnpj m where m.pipedrive_deal_id = k.deal
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
$function$
;

revoke execute on function ops.consultoria_porta_leitura() from public, anon;
grant execute on function ops.consultoria_porta_leitura() to authenticated;
revoke execute on function ops.handoff_consultoria_painel() from public, anon;
grant execute on function ops.handoff_consultoria_painel() to authenticated;
revoke execute on function ops.cruzamento_consultoria_painel() from public, anon;
grant execute on function ops.cruzamento_consultoria_painel() to authenticated;

delete from ops.usuario_chaves where permission_key = 'view.consultoria';
delete from ops.role_permissions where permission_key = 'view.consultoria';
delete from ops.area_chaves where permission_key = 'view.consultoria';

delete from public.produto_acesso
 where produto = 'ops' and user_id = (select user_id from ops.profiles where lower(email) = 'karollainny.maria@planning.com.br');
delete from ops.usuario_areas
 where area = 'monetizacao' and user_id = (select user_id from ops.profiles where lower(email) = 'karollainny.maria@planning.com.br');
delete from ops.usuario_escopo
 where user_id = (select user_id from ops.profiles where lower(email) = 'karollainny.maria@planning.com.br');

commit;
