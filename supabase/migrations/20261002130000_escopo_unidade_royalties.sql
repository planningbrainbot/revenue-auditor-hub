-- Sócio não lê royalties, taxas nem números de outra unidade. Pedido do Eliezek em 01/10/2026, depois que a revisão
-- da ficha da unidade achou a leitura aberta: o sócio regional de Belém, numa sessão simulada, lia pelo PostgREST:
--   ops.unidades               15 unidades: royalties %, CSC, mídia, CAC, observações financeiras
--   ops.v_royalties_mensais    11 unidades: royalties devidos, CSC e total devido à matriz, mês a mês
--   ops.v_payback_simulacao    15 unidades: royalties %, verba de mídia, royalty por cliente
--   ops.v_funil_mensal         11 unidades: MRR, faturado e recebido
--   ops.v_reconciliacao_mensal 11 unidades: MRR, faturado, recebido, a vencer, em atraso
--   ops.v_cac_cobranca_pipe     6 unidades: CAC cobrado por cliente
--   ops.broker_saldo           15 unidades: saldo do broker
--   ops.partners_dfc_*         o caixa e a DRE da Partners inteiros (1.344 lançamentos)
--
-- Por quê: ops.unidades tinha só policies PERMISSIVE, e "Permission-based read" abre a tabela a quem tem
-- view.clientes, chave que o perfil socio_regional recebe pela área Minha Unidade. As views são de postgres, sem
-- security_invoker, e não herdam RLS nenhuma (feedback_view_nao_herda_rls).
--
-- O que muda: a mesma trava das outras 15 tabelas (migration 63, feedback_rls_escopo_unidade_restrictive), que só
-- pega quem tem recorte de unidade (data.scope.own_unit_only, isto é, sem usuario_escopo.todas_unidades). Em 01/10
-- eram 28 contas: os sócios regionais, Paula Almeida (Gente de Maceió), Rayssa Silva (lista com as 15 unidades) e
-- Eduardo Torres (sem unidade). A matriz, com "todas as unidades", não muda. Service role e postgres não passam pelo
-- teste de sessão, por isso as edge functions e os syncs também não mudam.
--   a. ops.unidades: RESTRICTIVE de SELECT pelo id da unidade.
--   b. As seis views: a definição de hoje, inteira, dentro de um filtro pela unidade da linha.
--   c. partners_dfc_*: é o financeiro da matriz, sem unidade da rede na linha; quem tem recorte não lê.
-- Rollback: supabase/rollback/20261002130000_escopo_unidade_royalties_rollback.sql

-- a. ops.unidades -----------------------------------------------------------------------------------------------------
drop policy if exists escopo_unidade on ops.unidades;
create policy escopo_unidade on ops.unidades
  as restrictive for select to authenticated
  using (
    (not (select ops.can('data.scope.own_unit_only')))
    or id = any(coalesce((select array(select ops.minhas_unidades())), '{}'))
  );

-- b. Views ------------------------------------------------------------------------------------------------------------
create or replace view ops.v_royalties_mensais as
select t.*
  from (
WITH meses AS (
         SELECT DISTINCT date_trunc('month'::text, contas_receber.data_competencia::timestamp with time zone) AS mes
           FROM ops.contas_receber
        UNION
         SELECT date_trunc('month'::text, now()) AS date_trunc
        ), base AS (
         SELECT u.nome_da_praca AS unidade,
            u.royalties_percentual,
            u.csc_valor_fixo,
            mo.mes
           FROM ops.unidades u
             CROSS JOIN meses mo
          WHERE u.tipo = 'regional'::text
        ), fat AS (
         SELECT cr.unidade,
            date_trunc('month'::text, cr.data_competencia::timestamp with time zone) AS mes,
            sum(
                CASE
                    WHEN cr.status_pagamento <> 'CANCELADO'::text THEN cr.valor
                    ELSE 0::numeric
                END) AS faturado,
            sum(
                CASE
                    WHEN cr.status_pagamento = 'RECEBIDO'::text THEN cr.valor
                    ELSE 0::numeric
                END) AS recebido
           FROM ops.contas_receber cr
          GROUP BY cr.unidade, (date_trunc('month'::text, cr.data_competencia::timestamp with time zone))
        )
 SELECT b.unidade,
    b.mes,
    round(COALESCE(f.faturado, 0::numeric), 2) AS faturado,
    round(COALESCE(f.recebido, 0::numeric), 2) AS recebido,
    b.royalties_percentual,
    b.csc_valor_fixo,
    round(COALESCE(f.recebido, 0::numeric) * b.royalties_percentual / 100::numeric, 2) AS royalties_valor,
    COALESCE(b.csc_valor_fixo, 0::numeric) AS csc_valor,
    round(COALESCE(f.recebido, 0::numeric) * b.royalties_percentual / 100::numeric + COALESCE(b.csc_valor_fixo, 0::numeric), 2) AS total_due_matriz
   FROM base b
     LEFT JOIN fat f ON f.unidade = b.unidade AND f.mes = b.mes
  ORDER BY b.mes DESC, b.unidade
  ) t
 where (select auth.role()) is distinct from 'authenticated'
    or not (select ops.can('data.scope.own_unit_only'))
    or nullif(ops.norm_unidade(t.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}'));

create or replace view ops.v_payback_simulacao as
select t.*
  from (
SELECT u.nome_da_praca AS unidade,
    u.tipo,
    u.paga_cac,
    u.absorve_midia,
    u.midia_mensal AS verba_midia,
    u.royalties_percentual AS royalties_pct,
    COALESCE(avg(p.mrr_medio), 0::numeric) AS mrr_medio_historico,
    COALESCE(avg(p.deals), 0::numeric) AS deals_medio_mensal,
    COALESCE(avg(p.investimento_midia), 0::numeric) AS investimento_medio,
        CASE
            WHEN COALESCE(avg(p.deals), 0::numeric) > 0::numeric THEN COALESCE(avg(p.investimento_midia), 0::numeric) / avg(p.deals)
            ELSE 0::numeric
        END AS cpv_medio,
    COALESCE(avg(p.mrr_medio), 0::numeric) * u.royalties_percentual / 100::numeric AS royalty_por_cliente
   FROM ops.unidades u
     LEFT JOIN ops.roas_por_unidade p ON p.unidade = u.nome_da_praca AND p.mes >= date_trunc('month'::text, now() - '3 mons'::interval)
  GROUP BY u.id, u.nome_da_praca, u.tipo, u.paga_cac, u.absorve_midia, u.midia_mensal, u.royalties_percentual
  ) t
 where (select auth.role()) is distinct from 'authenticated'
    or not (select ops.can('data.scope.own_unit_only'))
    or nullif(ops.norm_unidade(t.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}'));

create or replace view ops.v_funil_mensal as
select t.*
  from (
WITH mrr_snap AS (
         SELECT contratos.unidade,
            count(*) AS contratos_ativos,
            sum(contratos.mrr / 12::numeric) AS mrr
           FROM ops.contratos
             JOIN ops.unidades ON unidades.nome_da_praca = contratos.unidade AND unidades.tipo = 'regional'::text
          WHERE contratos.status_contrato = 'Ativo'::text AND contratos.unidade IS NOT NULL
          GROUP BY contratos.unidade
        ), meses AS (
         SELECT DISTINCT date_trunc('month'::text, contas_receber.data_competencia::timestamp with time zone) AS mes
           FROM ops.contas_receber
        UNION
         SELECT date_trunc('month'::text, now()) AS date_trunc
        ), fat AS (
         SELECT contas_receber.unidade,
            date_trunc('month'::text, contas_receber.data_competencia::timestamp with time zone) AS mes,
            sum(
                CASE
                    WHEN contas_receber.status_pagamento <> 'CANCELADO'::text THEN contas_receber.valor
                    ELSE 0::numeric
                END) AS faturado,
            sum(
                CASE
                    WHEN contas_receber.status_pagamento = 'RECEBIDO'::text THEN contas_receber.valor
                    ELSE 0::numeric
                END) AS recebido,
            count(
                CASE
                    WHEN contas_receber.status_pagamento <> 'CANCELADO'::text THEN 1
                    ELSE NULL::integer
                END) AS num_faturas,
            count(
                CASE
                    WHEN contas_receber.status_pagamento = 'RECEBIDO'::text THEN 1
                    ELSE NULL::integer
                END) AS num_recebidos
           FROM ops.contas_receber
          GROUP BY contas_receber.unidade, (date_trunc('month'::text, contas_receber.data_competencia::timestamp with time zone))
        ), base AS (
         SELECT m_1.unidade,
            mo.mes
           FROM mrr_snap m_1
             CROSS JOIN meses mo
        )
 SELECT b.mes,
    b.unidade,
    m.contratos_ativos,
    round(m.mrr, 2) AS mrr_contratado,
    round(COALESCE(f.faturado, 0::numeric), 2) AS faturado,
    COALESCE(f.num_faturas, 0::bigint) AS faturas_emitidas,
    round(COALESCE(f.recebido, 0::numeric), 2) AS recebido,
    COALESCE(f.num_recebidos, 0::bigint) AS faturas_recebidas,
        CASE
            WHEN m.mrr > 0::numeric THEN round(COALESCE(f.faturado, 0::numeric) / m.mrr * 100::numeric, 1)
            ELSE NULL::numeric
        END AS conv_mrr_to_faturado_pct,
        CASE
            WHEN COALESCE(f.faturado, 0::numeric) > 0::numeric THEN round(COALESCE(f.recebido, 0::numeric) / f.faturado * 100::numeric, 1)
            ELSE NULL::numeric
        END AS conv_faturado_to_recebido_pct,
        CASE
            WHEN m.mrr > 0::numeric THEN round(COALESCE(f.recebido, 0::numeric) / m.mrr * 100::numeric, 1)
            ELSE NULL::numeric
        END AS conv_mrr_to_recebido_pct
   FROM base b
     JOIN mrr_snap m ON b.unidade = m.unidade
     LEFT JOIN fat f ON f.unidade = b.unidade AND f.mes = b.mes
  ORDER BY b.mes DESC, b.unidade
  ) t
 where (select auth.role()) is distinct from 'authenticated'
    or not (select ops.can('data.scope.own_unit_only'))
    or nullif(ops.norm_unidade(t.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}'));

create or replace view ops.v_reconciliacao_mensal as
select t.*
  from (
WITH mrr_unidade AS (
         SELECT contratos.unidade,
            count(*) AS num_contratos,
            sum(contratos.mrr / 12::numeric) AS mrr
           FROM ops.contratos
             JOIN ops.unidades ON unidades.nome_da_praca = contratos.unidade AND unidades.tipo = 'regional'::text
          WHERE contratos.status_contrato = 'Ativo'::text AND contratos.unidade IS NOT NULL
          GROUP BY contratos.unidade
        ), meses AS (
         SELECT DISTINCT date_trunc('month'::text, contas_receber.data_competencia::timestamp with time zone) AS mes
           FROM ops.contas_receber
        UNION
         SELECT date_trunc('month'::text, now()) AS date_trunc
        ), fat AS (
         SELECT contas_receber.unidade,
            date_trunc('month'::text, contas_receber.data_competencia::timestamp with time zone) AS mes,
            sum(
                CASE
                    WHEN contas_receber.status_pagamento <> 'CANCELADO'::text THEN contas_receber.valor
                    ELSE 0::numeric
                END) AS faturado,
            sum(
                CASE
                    WHEN contas_receber.status_pagamento = 'RECEBIDO'::text THEN contas_receber.valor
                    ELSE 0::numeric
                END) AS recebido,
            count(
                CASE
                    WHEN contas_receber.status_pagamento <> 'CANCELADO'::text THEN 1
                    ELSE NULL::integer
                END) AS num_faturas,
            count(
                CASE
                    WHEN contas_receber.status_pagamento = 'RECEBIDO'::text THEN 1
                    ELSE NULL::integer
                END) AS num_recebidos,
            sum(
                CASE
                    WHEN contas_receber.status_pagamento = ANY (ARRAY['A VENCER'::text, 'VENCE HOJE'::text]) THEN contas_receber.valor
                    ELSE 0::numeric
                END) AS a_vencer,
            sum(
                CASE
                    WHEN contas_receber.status_pagamento = 'ATRASADO'::text THEN contas_receber.valor
                    ELSE 0::numeric
                END) AS em_atraso
           FROM ops.contas_receber
          GROUP BY contas_receber.unidade, (date_trunc('month'::text, contas_receber.data_competencia::timestamp with time zone))
        ), base AS (
         SELECT m_1.unidade,
            mo.mes
           FROM mrr_unidade m_1
             CROSS JOIN meses mo
        )
 SELECT b.mes,
    b.unidade,
    m.num_contratos,
    round(m.mrr, 2) AS mrr_contratado,
    round(COALESCE(f.faturado, 0::numeric), 2) AS faturado,
    round(COALESCE(f.recebido, 0::numeric), 2) AS recebido,
    round(COALESCE(f.a_vencer, 0::numeric), 2) AS a_vencer,
    round(COALESCE(f.em_atraso, 0::numeric), 2) AS em_atraso,
    COALESCE(f.num_faturas, 0::bigint) AS num_faturas,
    COALESCE(f.num_recebidos, 0::bigint) AS num_recebidos,
        CASE
            WHEN m.mrr > 0::numeric THEN round(COALESCE(f.faturado, 0::numeric) / m.mrr * 100::numeric, 1)
            ELSE NULL::numeric
        END AS pct_faturado_vs_mrr,
        CASE
            WHEN COALESCE(f.faturado, 0::numeric) > 0::numeric THEN round(COALESCE(f.recebido, 0::numeric) / f.faturado * 100::numeric, 1)
            ELSE NULL::numeric
        END AS pct_recebido_vs_faturado
   FROM base b
     JOIN mrr_unidade m ON b.unidade = m.unidade
     LEFT JOIN fat f ON f.unidade = b.unidade AND f.mes = b.mes
  ORDER BY b.mes DESC, b.unidade
  ) t
 where (select auth.role()) is distinct from 'authenticated'
    or not (select ops.can('data.scope.own_unit_only'))
    or nullif(ops.norm_unidade(t.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}'));

create or replace view ops.v_cac_cobranca_pipe as
select t.*
  from (
SELECT pipefy_card_id,
    cliente,
    unidade,
    fase_id,
    fase_atual,
    data_assinatura,
    valor_1_honorario,
    data_cobranca_p1,
    valor_cobrado_p1,
    data_cobranca_p2,
    valor_cobrado_p2,
    COALESCE(valor_cobrado_p1, 0::numeric) + COALESCE(valor_cobrado_p2, 0::numeric) AS valor_cobrado_total,
        CASE
            WHEN valor_cobrado_p1 IS NOT NULL THEN 1
            ELSE 0
        END +
        CASE
            WHEN valor_cobrado_p2 IS NOT NULL THEN 1
            ELSE 0
        END AS parcelas_lancadas,
        CASE
            WHEN COALESCE(valor_1_honorario, 0::numeric) > 0::numeric THEN round((COALESCE(valor_cobrado_p1, 0::numeric) + COALESCE(valor_cobrado_p2, 0::numeric)) / valor_1_honorario * 100::numeric, 2)
            ELSE NULL::numeric
        END AS percentual_do_honorario,
    synced_at
   FROM ops.cac_cobranca_cards c
  ) t
 where (select auth.role()) is distinct from 'authenticated'
    or not (select ops.can('data.scope.own_unit_only'))
    or nullif(ops.norm_unidade(t.unidade), '') = any(coalesce((select ops.unidades_do_usuario()), '{}'));

create or replace view ops.broker_saldo as
select t.*
  from (
SELECT u.id AS unidade_id,
    u.nome_da_praca,
    COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'credito'::text), 0::numeric) AS credito_recebido,
    COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'aporte'::text), 0::numeric) AS credito_comprado,
    COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'estorno'::text), 0::numeric) AS estornado,
    COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = ANY (ARRAY['credito'::text, 'aporte'::text, 'estorno'::text])), 0::numeric) AS creditado,
    COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'reserva'::text), 0::numeric) - COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'liberacao'::text), 0::numeric) AS bloqueado,
    COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'debito'::text), 0::numeric) AS investido,
    COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = ANY (ARRAY['credito'::text, 'aporte'::text, 'estorno'::text])), 0::numeric) - COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'debito'::text), 0::numeric) - (COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'reserva'::text), 0::numeric) - COALESCE(sum(m.valor_cb) FILTER (WHERE m.tipo = 'liberacao'::text), 0::numeric)) AS disponivel
   FROM ops.unidades u
     LEFT JOIN ops.broker_movimentos m ON m.unidade_id = u.id AND m.origem IS NULL
  GROUP BY u.id, u.nome_da_praca
  ) t
 where (select auth.role()) is distinct from 'authenticated'
    or not (select ops.can('data.scope.own_unit_only'))
    or t.unidade_id = any(coalesce((select array(select ops.minhas_unidades())), '{}'));

-- c. Financeiro da Partners ------------------------------------------------------------------------------------------
drop policy if exists escopo_unidade on ops.partners_dfc_caixa_competencia;
create policy escopo_unidade on ops.partners_dfc_caixa_competencia
  as restrictive for select to authenticated
  using (not (select ops.can('data.scope.own_unit_only')));

drop policy if exists escopo_unidade on ops.partners_dfc_classificacao_departamento;
create policy escopo_unidade on ops.partners_dfc_classificacao_departamento
  as restrictive for select to authenticated
  using (not (select ops.can('data.scope.own_unit_only')));
