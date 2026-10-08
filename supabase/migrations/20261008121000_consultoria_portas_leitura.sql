-- Portas de leitura do Ops para a Consultoria de Campo (sistema novo).
--
-- PRD "Consultoria de Campo, versão 1" (wiki/prds/2026-10-consultoria-de-campo-v1.md),
-- seção 7 e D-04. O módulo mora no schema `consultoria` e lê o Ops só por estas duas
-- funções, chamadas de dentro das funções do schema `consultoria` (SECURITY DEFINER).
-- Ninguém recebe EXECUTE: nem a API do Ops, nem o usuário do backend.
--
-- A homologação do sistema novo tem réplicas com o mesmo formato de saída e dados
-- fictícios (supabase/homologacao/ops_replica.sql do repo planning-broker).
-- Mudou o formato aqui, muda lá.

-- IDU do trimestre por unidade, com o atingimento por pilar e o churn (gatilho do Pacto).
-- p_fim EXCLUSIVO, como em ops.idu_apuracao.
create or replace function ops.consultoria_idu(p_inicio date, p_fim date)
returns table (unidade_id integer, curva text, idu numeric, faixa text, base_efetiva integer,
               pilar_fraco text, churn numeric, pilares jsonb)
language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  with a as (select * from ops.idu_apuracao_base(p_inicio, p_fim)),
  r as (select * from ops.idu_ranking(p_inicio, p_fim)),
  p as (
    select a.unidade_id, a.pilar,
           sum(a.peso) as peso,
           sum(a.peso) filter (where a.pontos is not null) as medido,
           sum(a.pontos) as pontos
      from a group by a.unidade_id, a.pilar
  )
  select r.unidade_id, r.curva, r.idu, r.faixa, r.base_efetiva, r.pilar_fraco,
         (select a.realizado from a where a.unidade_id = r.unidade_id and a.indicador = 'churn'),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'pilar', p.pilar, 'peso', p.peso, 'medido', coalesce(p.medido, 0),
                     'pontos', p.pontos,
                     'atingimento', case when p.medido > 0 then round(100 * p.pontos / p.medido, 1) end)
                   order by p.pilar)
                     from p where p.unidade_id = r.unidade_id), '[]'::jsonb)
    from r
$$;

-- Sinais da janela móvel por unidade regional. p_fim INCLUSIVO, como em
-- ops.ranking_unidades, e é o "hoje" do repasse.
--   repasse: valor = maior atraso em dias entre os títulos abertos; secundário = total vencido.
--            Mesma régua da tela Receita e Repasses ("o que ainda devem"): conta Partners,
--            categorias de repasse ou ND sem categoria, CNPJ da unidade (Curitiba tem 4).
--   vendas:  vendas ganhas nos pipelines 2 (inside_sales) e 4 (socios); venda do pipe de
--            Sócios sem unidade cai na unidade do sócio dono do deal, como no IDU.
--   retencao, inadimplencia, nps: as linhas de ops.ranking_unidades, como estão.
create or replace function ops.consultoria_sinais(p_inicio date, p_fim date)
returns table (unidade_id integer, sinal text, valor numeric, valor_secundario numeric,
               amostra integer, situacao text)
language sql stable security definer
set search_path to 'ops', 'public', 'extensions'
as $$
  with u as (
    select un.id, un.nome_da_praca as nome from ops.unidades un where un.tipo = 'regional'
  ),
  cnpjs as (
    select un.id, regexp_replace(c, '\D', '', 'g') as cnpj
      from ops.unidades un, regexp_split_to_table(coalesce(un.cnpj, ''), E'\n') c
     where un.tipo = 'regional' and regexp_replace(c, '\D', '', 'g') <> ''
  ),
  abertos as (
    select k.id, cr.data_vencimento::date as venc, cr.valor
      from ops.contas_receber cr
      join cnpjs k on k.cnpj = regexp_replace(coalesce(cr.cpf_cnpj, ''), '\D', '', 'g')
     where cr.unidade = 'Partners'
       and cr.status_pagamento not in ('RECEBIDO', 'CANCELADO')
       and (cr.codigo_categoria is null
            or cr.codigo_categoria in ('1.01.92', '1.01.94', '1.01.95', '1.01.96', '1.01.99', '1.03.96'))
       and cr.data_vencimento is not null
  ),
  repasse as (
    select u.id,
           coalesce(max(p_fim - a.venc) filter (where a.venc < p_fim), 0)::numeric as dias,
           coalesce(sum(a.valor) filter (where a.venc < p_fim), 0)::numeric as vencido,
           count(a.venc)::int as n
      from u left join abertos a on a.id = u.id
     group by u.id
  ),
  dono as (
    select s.email, ud.nome_da_praca as unidade
      from ops.socios s join ops.unidades ud on ud.id = s.unidade_id
     where s.email is not null
  ),
  vendas as (
    select u.id, count(v.unidade)::int as n
      from u left join (
        select coalesce(c.unidade, d.unidade) as unidade
          from ops.contratos c
          left join dono d on c.unidade is null and c.origem_pipeline = 'socios'
                          and lower(d.email) = lower(c.pipedrive_owner_email)
         where c.origem_pipeline in ('inside_sales', 'socios')
           and c.ganho_em >= p_inicio and c.ganho_em <= p_fim
      ) v on ops.idu_slug(v.unidade) = ops.idu_slug(u.nome)
     group by u.id
  )
  select r.id, 'repasse', r.dias, r.vencido, r.n, 'ok' from repasse r
  union all
  select v.id, 'vendas', v.n::numeric, null, v.n, 'ok' from vendas v
  union all
  select ru.unidade_id, ru.ranking, ru.valor, ru.valor_secundario, ru.amostra, ru.situacao
    from ops.ranking_unidades(p_inicio, p_fim) ru
   where ru.ranking in ('retencao', 'inadimplencia', 'nps')
$$;

revoke execute on function ops.consultoria_idu(date, date), ops.consultoria_sinais(date, date)
  from public, anon, authenticated;
