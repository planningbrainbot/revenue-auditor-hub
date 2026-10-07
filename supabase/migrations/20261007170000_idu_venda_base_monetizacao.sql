-- IDU: "Venda para a base" ganha fonte, o pipe de monetização (pipeline 39 do Pipedrive).
--
-- Decisão de 07/10/2026. Venda para a base é monetização: serviço novo para cliente que já
-- é da carteira. O pipe 39 já é sincronizado em ops.monetizacao_deals pela Edge Function
-- monetizacao-crm, mas o deal não traz valor (os 367 deals têm a receita vazia, e dos 6
-- ganhos cinco têm value = 0). Por isso a medida passa de R$/mês para QUANTIDADE de deals
-- ganhos no trimestre (`won_on`), por unidade (`unidade_ids`). A chave continua `base`.
--
-- Meta de rede, tier ou unidade para esse indicador precisa ser lançada em número de
-- vendas. Sem meta, o indicador continua fora do denominador.

CREATE OR REPLACE FUNCTION ops.idu_indicadores_catalogo()
 RETURNS TABLE(indicador text, rotulo text, pilar text, peso_madura integer, peso_ramp integer, direcao text, unidade_medida text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
  values
    ('novos',      'Hunter sócios',           'Crescimento', 20, 40, 'maior', 'R$/mês'),
    ('base',       'Venda para a base',       'Crescimento', 10, 10, 'maior', 'vendas'),
    ('churn',      'Churn de MRR',            'Retenção',    35, 15, 'menor', '%'),
    ('satisfacao', 'Satisfação do cliente',   'Qualidade',   15, 15, 'maior', 'NPS'),
    ('exposicao',  'Exposição de carteira',   'Qualidade',   10, 10, 'menor', '%'),
    ('enps',       'e-NPS',                   'Gestão',      10, 10, 'maior', 'NPS');
$function$;

CREATE OR REPLACE FUNCTION ops.idu_apuracao(p_inicio date, p_fim date)
 RETURNS TABLE(unidade_id integer, unidade text, curva text, trimestres integer, indicador text, rotulo text, pilar text, peso integer, direcao text, unidade_medida text, meta numeric, realizado numeric, atingimento numeric, ajuste text, pontos numeric, meta_origem text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
with u as (
  select id, nome, inicio,
         ((extract(year from p_fim) - extract(year from inicio)) * 4
          + floor((extract(month from p_fim) - 1) / 3)
          - floor((extract(month from inicio) - 1) / 3))::int as trimestres
  from (
    select id, nome_da_praca as nome, coalesce(data_inauguracao, created_at::date) as inicio
    from ops.unidades
    where tipo = 'regional' and nome_da_praca is not null
  ) un
  where inicio < p_fim
),
carteira as (
  select u.id, coalesce(sum(v.mrr_total), 0) as mrr_base
  from u left join ops.v_mrr_por_unidade v on ops.idu_slug(v.unidade) = ops.idu_slug(u.nome)
  group by u.id
),
-- Hunter sócios: venda do pipe de Sócios. Sem unidade no deal, cai na unidade do sócio
-- dono do deal (mesma regra de ops.v_hunter_socio e ops.ranking_unidades).
dono as (
  select s.email, ud.nome_da_praca as unidade
  from ops.socios s join ops.unidades ud on ud.id = s.unidade_id
  where s.email is not null
),
vendas as (
  select u.id, coalesce(sum(v.mrr_mensal), 0) as hunter
  from u left join (
    select coalesce(c.unidade, d.unidade) as unidade, c.mrr_mensal
    from ops.contratos c
    left join dono d on c.unidade is null and lower(d.email) = lower(c.pipedrive_owner_email)
    where c.origem_pipeline = 'socios'
      and c.ganho_em >= p_inicio and c.ganho_em < p_fim
  ) v on ops.idu_slug(v.unidade) = ops.idu_slug(u.nome)
  group by u.id
),
-- Venda para a base: monetização, deals ganhos no pipe 39 do Pipedrive (ops.monetizacao_deals,
-- gravado pela Edge Function monetizacao-crm). Conta vendas, porque o deal não traz valor.
monet as (
  select u.id, count(d.id) as n
  from u left join ops.monetizacao_deals d
    on u.id = any(d.unidade_ids)
   and d.payload->>'status' = 'won'
   and (d.payload->>'won_on')::date >= p_inicio and (d.payload->>'won_on')::date < p_fim
  group by u.id
),
churn as (
  select u.id, coalesce(sum(t.mrr), 0) as mrr_perdido, count(t.id) as n
  from u left join ops.central_tratativas t
    on ops.idu_slug(t.unidade) = ops.idu_slug(u.nome)
   and t.data_churn >= p_inicio and t.data_churn < p_fim
  group by u.id
),
sat as (
  select u.id, count(p.id) as respostas,
         count(p.id) filter (where (substring(p.nps_recomendacao from '^[0-9]+'))::int >= 9) as prom,
         count(p.id) filter (where (substring(p.nps_recomendacao from '^[0-9]+'))::int <= 6) as det
  from u left join ops.nps_pesquisas p
    on ops.idu_slug(p.unidade) = ops.idu_slug(u.nome)
   and p.nps_recomendacao ~ '^[0-9]'
   and coalesce(p.data_envio, p.created_at::date) >= p_inicio
   and coalesce(p.data_envio, p.created_at::date) < p_fim
  group by u.id
),
expo as (
  select u.id,
         coalesce(sum(coalesce(a.oportunidades_valor, 0) + coalesce(a.contingencias_valor, 0)), 0) as valor,
         count(a.pipefy_card_id) as n
  from u left join ops.auditorias_internas a
    on ops.idu_slug(a.unidade) = ops.idu_slug(u.nome)
   and a.data_conclusao >= p_inicio and a.data_conclusao < p_fim
  group by u.id
),
realizados as (
  select u.id, u.nome, u.trimestres, (u.trimestres >= 5) as madura,
         cat.indicador, cat.rotulo, cat.pilar, cat.direcao, cat.unidade_medida,
         case when u.trimestres >= 5 then cat.peso_madura else cat.peso_ramp end as peso,
         case cat.indicador
           when 'novos' then vendas.hunter
           when 'base'  then monet.n
           when 'churn' then case when carteira.mrr_base > 0 then churn.mrr_perdido / carteira.mrr_base * 100 end
           when 'satisfacao' then case when sat.respostas >= 5 then (sat.prom - sat.det)::numeric / sat.respostas * 100 end
           when 'exposicao'  then case when carteira.mrr_base > 0 and expo.n > 0 then expo.valor / (carteira.mrr_base * 3) * 100 end
           else null
         end as realizado
  from u
  cross join ops.idu_indicadores_catalogo() cat
  join carteira on carteira.id = u.id
  join vendas   on vendas.id = u.id
  join monet    on monet.id = u.id
  join churn    on churn.id = u.id
  join sat      on sat.id = u.id
  join expo     on expo.id = u.id
),
-- cascata: unidade > tier > rede > 5% fixo de churn
com_meta as (
  select r.*,
         coalesce(m.meta, pt.meta, pr.meta,
                  case when r.indicador = 'churn' then 5.0 end) as meta,
         case when m.meta  is not null then 'unidade'
              when pt.meta is not null then 'tier'
              when pr.meta is not null then 'rede'
              when r.indicador = 'churn' then 'fixa'
         end as meta_origem
  from realizados r
  left join ops.idu_metas m
    on m.unidade_id = r.id and m.indicador = r.indicador and m.periodo_inicio = p_inicio
  left join ops.idu_metas_padrao pt
    on pt.periodo_inicio = p_inicio and pt.indicador = r.indicador
   and pt.escopo = case when r.madura then 'Madura' else 'Ramp-up' end
  left join ops.idu_metas_padrao pr
    on pr.periodo_inicio = p_inicio and pr.indicador = r.indicador and pr.escopo = 'rede'
),
bruto as (
  select cm.*,
         case when cm.meta is null or cm.realizado is null then null
              when cm.direcao = 'menor' then
                case when cm.realizado <= 0 then 120 when cm.meta <= 0 then 0
                     else cm.meta / cm.realizado * 100 end
              else case when cm.meta <= 0 then case when cm.realizado > 0 then 120 else 0 end
                        else cm.realizado / cm.meta * 100 end
         end as at_bruto
  from com_meta cm
)
select b.id, b.nome, case when b.madura then 'Madura' else 'Ramp-up' end,
       b.trimestres, b.indicador, b.rotulo, b.pilar, b.peso, b.direcao, b.unidade_medida,
       round(b.meta, 2), round(b.realizado, 2), round(b.at_bruto, 1),
       case when b.at_bruto is null then 'sem dado'
            when b.at_bruto < 50 then 'piso'
            when b.at_bruto > 120 then 'teto' else '' end,
       case when b.at_bruto is null then null when b.at_bruto < 50 then 0
            else round(b.peso * least(b.at_bruto, 120) / 100, 2) end,
       b.meta_origem
from bruto b
where ops.idu_pode_ver()
order by b.nome, b.pilar, b.indicador;
$function$;
