-- Desfaz 20261026210000_consultoria_maquina_perfil.sql: volta o RPC de 22/10, apaga a tabela da faixa declarada e as
-- 7 linhas manuais de CNPJ. Antes, volte a handoff-consultoria-sync para a versão sem o passo 2b (v24, de 06/10):
-- sem isso, a rodada seguinte não acha a tabela e fica parcial.
begin;

CREATE OR REPLACE FUNCTION ops.consultoria_funil_painel()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare
  _porta text;
begin
  _porta := ops.consultoria_porta_leitura();
  return (
  with
  neg as (
    select distinct on (c.pipedrive_deal_id) c.pipedrive_deal_id deal, c.titulo, c.ganho_em, c.origem_pipeline,
           c.unidade, c.closer, coalesce(c.mrr_mensal, c.mrr) mrr,
           nullif(regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g'), '') c_cnpj, c.empresa_id
      from ops.contratos c
     where c.ganho_em >= '2026-01-01' and c.pipedrive_deal_id is not null and c.origem_pipeline in ('inside_sales', 'socios')
     order by c.pipedrive_deal_id, c.ganho_em
  ),
  neg_cnpj as (
    select n.*,
      case
        when length(n.c_cnpj) = 14 then n.c_cnpj
        when d.cnpj is not null then d.cnpj
        when length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14 then regexp_replace(e.cnpj, '\D', '', 'g')
        when length(regexp_replace(coalesce(h.cnpj, ''), '\D', '', 'g')) = 14 then regexp_replace(h.cnpj, '\D', '', 'g')
        else r.cnpj end cnpj,
      case
        when length(n.c_cnpj) = 14 then 'contrato'
        when d.cnpj is not null then 'documento'
        when length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14 then 'empresa'
        when length(regexp_replace(coalesce(h.cnpj, ''), '\D', '', 'g')) = 14 then 'pipedrive'
        else r.fonte end cnpj_fonte,
      h.organizacao
    from neg n
    left join ops.empresas e on e.id = n.empresa_id
    left join ops.handoff_consultoria_negocios h on h.pipedrive_deal_id = n.deal
    left join ops.consultoria_negocio_cnpj r on r.pipedrive_deal_id = n.deal
    -- O CNPJ dos documentos do contrato (o próprio ou o da empresa do documento), como no RPC da busca.
    left join lateral (
      select x.cnpj from (
        select regexp_replace(coalesce(cd.cnpj, ''), '\D', '', 'g') cnpj, 1 o from ops.contratos_documentos cd
         where cd.pipedrive_deal_id = n.deal
        union all
        select regexp_replace(coalesce(e2.cnpj, ''), '\D', '', 'g'), 2 from ops.contratos_documentos cd
          join ops.empresas e2 on e2.id = cd.empresa_id where cd.pipedrive_deal_id = n.deal
      ) x where length(x.cnpj) = 14 order by x.o limit 1
    ) d on true
  ),
  vendas as (
    -- Uma empresa por CNPJ: o primeiro ganho dá a origem, a unidade e a data; os demais negócios somam.
    select coalesce(cnpj, 'deal:' || deal) chave, cnpj,
           (array_agg(titulo order by ganho_em, deal))[1] nome,
           (array_agg(origem_pipeline order by ganho_em, deal))[1] origem,
           (array_agg(unidade order by ganho_em, deal))[1] unidade,
           (array_agg(closer order by ganho_em, deal))[1] closer,
           min(ganho_em) ganho_em, sum(mrr) mrr, count(*) negocios,
           (array_agg(deal order by ganho_em, deal))[1] deal,
           (array_agg(cnpj_fonte order by ganho_em, deal))[1] cnpj_fonte,
           array[cnpj] cnpjs
      from neg_cnpj group by coalesce(cnpj, 'deal:' || deal), cnpj
  ),
  goiania as (
    select 'base:' || b.key chave, (b.base->'cnpjs'->>0) cnpj, b.perfil->>'name' nome, 'goiania' origem, 'Goiânia' unidade,
           null::text closer, null::date ganho_em, null::numeric mrr, 0::bigint negocios, null::text deal,
           'base' cnpj_fonte, array(select jsonb_array_elements_text(b.base->'cnpjs')) cnpjs
      from ops.base_carteira b
     where 9 = any(b.unidade_ids) and b.base->'situacao'->>'estado' = 'cliente'
       and not (b.base->'cnpjs' ?| coalesce((select array_agg(cnpj) from vendas where cnpj is not null), '{}'))
  ),
  universo as (select * from vendas union all select * from goiania),
  cli as (
    select id, cnpj, left(cnpj, 8) raiz, nome, dados from ops.consultoria_plataforma
     where tabela = 'clientes' and ausente_desde is null
  ),
  u_cnpj as (select u.chave, x cnpj from universo u, unnest(u.cnpjs) x where length(x) = 14),
  liga_exata as (
    select distinct on (uc.chave) uc.chave, c.id from u_cnpj uc join cli c on c.cnpj = uc.cnpj order by uc.chave, c.cnpj
  ),
  liga_raiz as (
    select distinct on (uc.chave) uc.chave, c.id from u_cnpj uc join cli c on c.raiz = left(uc.cnpj, 8)
     order by uc.chave, substr(c.cnpj, 9, 4) <> '0001', c.cnpj
  ),
  liga as (
    -- O cliente da plataforma de cada empresa: CNPJ exato; sem ele, a raiz (a matriz primeiro).
    select u.chave, coalesce(e.id, r.id) cliente_id
      from universo u left join liga_exata e on e.chave = u.chave left join liga_raiz r on r.chave = u.chave
  ),
  canal as (select id, dados->>'nome' nome from ops.consultoria_plataforma where tabela = 'canais_venda' and ausente_desde is null),
  pj as (
    select p.id, p.cliente_id, p.dados, (p.dados->>'baixado')::boolean baixado,
           nullif(p.dados->>'data_entrega', '') entrega, p.dados->>'etapa_atual' etapa, p.dados->>'data_entrada' entrada,
           k.nome canal
      from ops.consultoria_plataforma p left join canal k on k.id = p.dados->>'canal_venda_id'
     where p.tabela = 'projetos_gestao' and p.ausente_desde is null and p.cliente_id is not null
  ),
  pz as (select projeto_id, dados from ops.consultoria_plataforma where tabela = 'v_painel_prazo_card' and ausente_desde is null),
  tese as (
    select x.projeto_id, x.dados->>'convertido_status' st, coalesce((x.dados->>'oportunidade')::numeric, 0) v
      from ops.consultoria_plataforma x where x.tabela = 'oportunidades' and x.ausente_desde is null and x.projeto_id is not null
  ),
  por_cli_pj as (
    select pj.cliente_id,
      count(*) projetos, count(*) filter (where not coalesce(pj.baixado, false)) abertos,
      bool_or(pj.entrega is not null or pj.etapa = 'pos_entrega') auditado,
      min(pj.entrega) entregue_em, min(pj.entrada) entrada,
      array_remove(array_agg(distinct pj.canal), null) canais
    from pj group by 1
  ),
  aberto as (
    select distinct on (pj.cliente_id) pj.cliente_id, pj.etapa, pj.dados->>'produto' produto,
           (pz.dados->>'dias_na_etapa')::int dias_na_etapa, (pz.dados->>'meta_dias')::int meta_dias,
           (pz.dados->>'dias_alem_da_meta')::int dias_alem
      from pj left join pz on pz.projeto_id = pj.id
     where not coalesce(pj.baixado, false)
     order by pj.cliente_id, pj.entrada desc nulls last
  ),
  por_cli_tese as (
    select pj.cliente_id,
      sum(t.v) filter (where coalesce(t.st, '') not in ('Declinado', 'Baixada')) identificado,
      sum(t.v) filter (where t.st in ('Sim', 'Em operação')) aceito,
      sum(t.v) filter (where t.st = 'Em Negociação') negociacao
    from pj join tese t on t.projeto_id = pj.id group by 1
  ),
  por_cli_est as (
    select e.cliente_id,
      sum(coalesce((e.dados->>'valor_total_aprovado')::numeric, 0)) aprovado,
      sum(coalesce((s.dados->>'saldo_atual')::numeric, 0) * coalesce((e.dados->>'aliquota_exito')::numeric, 0))
        filter (where e.dados->>'status' = 'ativo') garantido,
      sum(coalesce((s.dados->>'total_utilizado')::numeric, 0)) utilizado,
      -- 22/10/2026: o aceito se lê pelo estoque (weekly de 21/10, Karol). Ativo ou encerrado, quanto já foi compensado e
      -- o honorário que isso daria pela alíquota de êxito de cada crédito.
      bool_or(e.dados->>'status' = 'ativo') ativo,
      sum(coalesce((s.dados->>'total_utilizado')::numeric, 0) * coalesce((e.dados->>'aliquota_exito')::numeric, 0)) exito_estimado
    from ops.consultoria_plataforma e
    left join ops.consultoria_plataforma s on s.tabela = 'estoque_saldos' and s.id = e.id and s.ausente_desde is null
    where e.tabela = 'estoque_credito' and e.ausente_desde is null group by 1
  ),
  por_cli_prop as (
    select cliente_id, count(*) filter (where dados->>'status' = 'aceita') aceitas
      from ops.consultoria_plataforma where tabela = 'propostas' and ausente_desde is null and cliente_id is not null group by 1
  ),
  por_cli_rec as (
    select c.id cliente_id,
      sum(coalesce((r.dados->>'valor_conta')::numeric, 0)) faturado,
      sum(coalesce((r.dados->>'valor_conta')::numeric, 0))
        filter (where coalesce(r.dados->>'data_emissao', r.dados->>'data_vencimento') >= '2026-01-01') faturado_2026,
      sum(coalesce((r.dados->>'valor_recebido')::numeric, 0)) recebido,
      sum(coalesce((r.dados->>'valor_recebido')::numeric, 0)) filter (where r.dados->>'data_credito' >= '2026-01-01') recebido_2026,
      sum(coalesce((r.dados->>'valor_a_receber')::numeric, 0)) a_receber,
      sum(coalesce((r.dados->>'valor_a_receber')::numeric, 0))
        filter (where r.dados->>'data_vencimento' < to_char(current_date, 'YYYY-MM-DD')) em_atraso
    from cli c join ops.consultoria_plataforma r on r.tabela = 'recebimentos' and r.ausente_desde is null and r.cnpj = c.cnpj
    where coalesce((r.dados->>'cancelado')::boolean, false) = false
    group by 1
  ),
  fup as (
    select pj.cliente_id, max(f.dados->>'created_at') ultimo_fup
      from pj join ops.consultoria_plataforma f on f.tabela = 'projeto_fups' and f.ausente_desde is null and f.projeto_id = pj.id
     group by 1
  ),
  notas as (
    -- 22/10/2026: o que a Consultoria escreveu, para a lista da gaveta (pedido da Karol na weekly de 21/10): follow-up,
    -- notas por área (onde o jurídico lista as ações já consultadas), observação e motivo da baixa do projeto.
    -- As três mais recentes por cliente, com até 240 caracteres cada.
    select z.cliente_id, jsonb_agg(jsonb_build_object('fonte', z.fonte, 'rotulo', z.rotulo, 'texto', z.texto, 'em', z.em,
             'autor', z.autor) order by z.em desc nulls last) notas
      from (
        select n.*, row_number() over (partition by n.cliente_id order by n.em desc nulls last) rn from (
          select pj.cliente_id, 'fup' fonte, null::text rotulo, left(btrim(f.dados->>'texto'), 240) texto,
                 f.dados->>'created_at' em, f.dados->>'autor_nome' autor
            from pj join ops.consultoria_plataforma f on f.tabela = 'projeto_fups' and f.ausente_desde is null
                                                    and f.dados->>'projeto_id' = pj.id::text
           where coalesce(btrim(f.dados->>'texto'), '') <> ''
          union all
          select pj.cliente_id, 'area', a.dados->>'area', left(btrim(a.dados->>'notas'), 240), a.dados->>'registrado_em', null
            from pj join ops.consultoria_plataforma a on a.tabela = 'projeto_area_registro' and a.ausente_desde is null
                                                    and a.dados->>'projeto_id' = pj.id::text
           where coalesce(btrim(a.dados->>'notas'), '') <> ''
          union all
          select pj.cliente_id, 'projeto', pj.dados->>'produto', left(btrim(pj.dados->>'observacoes'), 240),
                 pj.dados->>'updated_at', null
            from pj where coalesce(btrim(pj.dados->>'observacoes'), '') <> ''
          union all
          select pj.cliente_id, 'baixa', pj.dados->>'produto', left(btrim(pj.dados->>'motivo_baixa'), 240),
                 pj.dados->>'data_baixa', null
            from pj where coalesce(pj.baixado, false) and coalesce(btrim(pj.dados->>'motivo_baixa'), '') <> ''
        ) n
      ) z
     where z.rn <= 3
     group by z.cliente_id
  ),
  reg as (
    select distinct on (cliente_id) cliente_id, resultado, nota, proximo_contato_em, autor_nome, registrado_em
      from ops.consultoria_fila_registros order by cliente_id, registrado_em desc
  ),
  regn as (select cliente_id, count(*) n from ops.consultoria_fila_registros group by 1),
  perfil as (
    -- Regime e teto de faturamento da Base, pelo CNPJ (para explicar quem não chegou: Simples, porte).
    -- Lido direto da carteira (a view base_conta_cnpjs custa segundos), só para os CNPJs do universo.
    select distinct on (x.cnpj) x.cnpj, b.perfil->>'regime' regime, (b.perfil->>'faturamento_teto')::numeric teto
      from ops.base_carteira b, jsonb_array_elements_text(b.base->'cnpjs') x(cnpj)
     where b.base->'cnpjs' ?| coalesce((select array_agg(distinct cnpj) from u_cnpj), '{}')
       and x.cnpj in (select cnpj from u_cnpj)
     order by x.cnpj, b.atualizado_em desc
  ),
  linhas as (
    select u.chave, u.cnpj, u.nome, u.origem, u.unidade, u.closer, u.ganho_em, u.mrr, u.negocios, u.deal, u.cnpj_fonte,
           l.cliente_id
      from universo u join liga l on l.chave = u.chave
    union all
    -- Os demais clientes da plataforma: só a fila usa.
    select 'cliente:' || c.id, c.cnpj, c.nome, 'outra', null, null, null, null, 0, null, 'plataforma', c.id
      from cli c where not exists (select 1 from liga l where l.cliente_id = c.id)
  )
  select jsonb_build_object(
    'lido_em', now(),
    'porta_financeiro', jsonb_build_object('aberta', _porta is null, 'motivo', _porta),
    'frescor', jsonb_build_object(
      'plataforma', (select max(executado_em) from ops.sync_log where fonte = 'consultoria_plataforma' and status in ('sucesso', 'parcial')),
      'cnpj_resolvido', (select max(resolvido_em) from ops.consultoria_negocio_cnpj)),
    'empresas', coalesce(jsonb_agg(jsonb_build_object(
      'chave', x.chave, 'cnpj', x.cnpj, 'nome', coalesce(c.nome, x.nome), 'origem', x.origem, 'unidade', x.unidade,
      'closer', x.closer, 'ganho_em', x.ganho_em, 'mrr', x.mrr, 'negocios', x.negocios, 'deal', x.deal,
      'cnpj_fonte', x.cnpj_fonte,
      'regime', coalesce(c.dados->>'regime', pf.regime), 'faturamento_teto', pf.teto,
      'cliente_id', x.cliente_id, 'cadastrado_em', c.dados->>'created_at',
      'canais', coalesce(to_jsonb(p.canais), '[]'::jsonb), 'projetos', coalesce(p.projetos, 0), 'abertos', coalesce(p.abertos, 0),
      'auditado', coalesce(p.auditado, false), 'entregue_em', p.entregue_em,
      'etapa', a.etapa, 'produto', a.produto, 'dias_na_etapa', a.dias_na_etapa, 'meta_dias', a.meta_dias, 'dias_alem', a.dias_alem,
      'identificado', coalesce(t.identificado, 0), 'aceito', coalesce(t.aceito, 0), 'negociacao', coalesce(t.negociacao, 0),
      'aprovado', coalesce(es.aprovado, 0), 'garantido', coalesce(es.garantido, 0), 'tem_estoque', es.cliente_id is not null,
      'estoque_ativo', coalesce(es.ativo, false), 'estoque_utilizado', coalesce(es.utilizado, 0),
      'exito_estimado', coalesce(es.exito_estimado, 0), 'notas', coalesce(nt.notas, '[]'::jsonb),
      'propostas_aceitas', coalesce(pr.aceitas, 0),
      'faturado', case when _porta is null then coalesce(rc.faturado, 0) end,
      'faturado_2026', case when _porta is null then coalesce(rc.faturado_2026, 0) end,
      'recebido', case when _porta is null then coalesce(rc.recebido, 0) end,
      'recebido_2026', case when _porta is null then coalesce(rc.recebido_2026, 0) end,
      'a_receber', case when _porta is null then coalesce(rc.a_receber, 0) end,
      'em_atraso', case when _porta is null then coalesce(rc.em_atraso, 0) end,
      'tem_fatura', rc.cliente_id is not null and coalesce(rc.faturado, 0) > 0,
      'ultimo_fup', fu.ultimo_fup,
      'registro', case when rg.cliente_id is null then null else jsonb_build_object(
        'resultado', rg.resultado, 'nota', rg.nota, 'proximo', rg.proximo_contato_em, 'autor', rg.autor_nome,
        'em', rg.registrado_em, 'total', rn.n) end
    ) order by x.origem, x.ganho_em desc nulls last, x.chave), '[]'::jsonb)
  )
  from linhas x
  left join cli c on c.id = x.cliente_id
  left join por_cli_pj p on p.cliente_id = x.cliente_id
  left join aberto a on a.cliente_id = x.cliente_id
  left join por_cli_tese t on t.cliente_id = x.cliente_id
  left join por_cli_est es on es.cliente_id = x.cliente_id
  left join por_cli_prop pr on pr.cliente_id = x.cliente_id
  left join por_cli_rec rc on rc.cliente_id = x.cliente_id
  left join fup fu on fu.cliente_id = x.cliente_id
  left join notas nt on nt.cliente_id = x.cliente_id
  left join reg rg on rg.cliente_id = x.cliente_id
  left join regn rn on rn.cliente_id = x.cliente_id
  left join perfil pf on pf.cnpj = x.cnpj
  -- Os clientes de outras origens só entram com dinheiro na mesa (a fila); o funil é dos vendidos e de Goiânia.
  where x.origem <> 'outra' or coalesce(t.identificado, 0) > 0 or coalesce(t.aceito, 0) > 0 or es.cliente_id is not null
     or coalesce(rc.a_receber, 0) > 0
  );
end;
$function$
;

revoke execute on function ops.consultoria_funil_painel() from public, anon;
grant execute on function ops.consultoria_funil_painel() to authenticated;

drop table if exists ops.consultoria_negocio_declarado;
delete from ops.consultoria_negocio_cnpj
 where fonte = 'manual' and pipedrive_deal_id in ('93828', '88041', '77253', '91928', '74918', '84331', '92779');

commit;
