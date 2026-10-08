-- Split do Asaas: filtro de período e espelho na Minha Unidade (08/10/2026).
--
-- 1. Período. `v_split_cliente` e `v_split_resumo` somam a história inteira, sem data, então a
--    tela não tinha como recortar meses. Duas views novas, no grão de mês, fazem o recorte sem
--    mexer na lógica das duas de sempre:
--    * `v_split_cliente_mes`: as colunas de dinheiro de `v_split_cliente` (títulos, cobrado,
--      pago, creditado, a creditar, perdido) por unidade, CNPJ e MÊS DE VENCIMENTO do título.
--      É a mesma régua que a view já usava para cortar em `split_ativo_desde` (safra de
--      faturamento: recortar cobrado por vencimento e pago por pagamento faz pago > cobrado).
--    * `v_split_resumo_mes`: o caixa do Asaas por unidade e mês. Split creditado cai no mês do
--      CRÉDITO (`data_credito`, o que o extrato mostra). Split a creditar não tem data nenhuma
--      no Asaas (`creditDate` e `confirmedDate` nulos), mas todos têm título: cai no mês de
--      vencimento do título. Cancelado idem, com o título; sem título, fica sem mês (`mes` nulo)
--      e só aparece sem filtro.
--    A etapa da cadeia continua sendo a situação de HOJE: a tela recorta o dinheiro e as linhas
--    pelo período, nunca a etapa.
--
-- 2. Minha Unidade. Chave nova `view.meu_split`, só em `area_chaves` de `minha_unidade`, abre
--    uma segunda porta nas quatro views: só `ops.minhas_unidades()` (que responde pela unidade
--    vestida no "Ver como"). Mesmo desenho da `view.meu_funil_cac` (migration 20261005120000).
--    View não herda RLS (o dono é postgres): o gate vai no where.
--
-- `v_split_cliente` e `v_split_resumo`: corpo = `pg_get_viewdef` de produção em 08/10/2026 com
-- só o where trocado; colunas iguais, então `create or replace` serve.
--
-- Rollback: supabase/rollback/20261008180000_split_periodo_minha_unidade_rollback.sql

set search_path to ops, public;

insert into ops.area_chaves (area, permission_key) values
  ('minha_unidade', 'view.meu_split')
on conflict do nothing;

create or replace view ops.v_split_cliente as
 WITH unid AS (
         SELECT unidades.nome_da_praca,
            unidades.split_ativo_desde,
            unidades.royalties_percentual
           FROM ops.unidades
          WHERE (unidades.split_ativo_desde IS NOT NULL)
        ), tit AS (
         SELECT cr.unidade,
            NULLIF(regexp_replace(cr.cpf_cnpj, '[^0-9]'::text, ''::text, 'g'::text), ''::text) AS cnpj,
            min(cr.cliente) AS cliente_omie,
            count(*) AS titulos,
            count(*) FILTER (WHERE (cr.status_pagamento = 'RECEBIDO'::text)) AS titulos_pagos,
            sum(cr.valor) AS valor_titulos,
            sum(cr.valor) FILTER (WHERE (cr.status_pagamento = 'RECEBIDO'::text)) AS valor_pago,
            max(cr.data_pagamento) AS ultimo_pagamento,
            COALESCE(sum(s.valor) FILTER (WHERE (s.status = 'DONE'::text)), (0)::numeric) AS royalty_creditado,
            COALESCE(sum(s.valor) FILTER (WHERE (s.status = ANY (ARRAY['PENDING'::text, 'AWAITING_CREDIT'::text]))), (0)::numeric) AS royalty_a_creditar,
            COALESCE(sum(
                CASE
                    WHEN ((cr.status_pagamento = 'RECEBIDO'::text) AND (s.id IS NULL)) THEN round(((cr.valor * u.royalties_percentual) / (100)::numeric), 2)
                    ELSE (0)::numeric
                END), (0)::numeric) AS royalty_perdido
           FROM ((ops.contas_receber cr
             JOIN unid u ON ((u.nome_da_praca = cr.unidade)))
             LEFT JOIN ops.asaas_splits s ON ((s.codigo_omie = cr.codigo_omie)))
          WHERE (cr.data_vencimento >= u.split_ativo_desde)
          GROUP BY cr.unidade, NULLIF(regexp_replace(cr.cpf_cnpj, '[^0-9]'::text, ''::text, 'g'::text), ''::text)
        ), cad AS (
         SELECT oc.unidade,
            NULLIF(regexp_replace(oc.cnpj_cpf, '[^0-9]'::text, ''::text, 'g'::text), ''::text) AS cnpj
           FROM (ops.omie_clientes oc
             JOIN unid u ON ((u.nome_da_praca = oc.unidade)))
          WHERE (oc.cnpj_cpf IS NOT NULL)
          GROUP BY oc.unidade, NULLIF(regexp_replace(oc.cnpj_cpf, '[^0-9]'::text, ''::text, 'g'::text), ''::text)
        ), ven_bruto AS (
         SELECT ct.unidade,
            NULLIF(regexp_replace(COALESCE(NULLIF(btrim(ct.cnpj), ''::text), v_1.omie_cnpj), '[^0-9]'::text, ''::text, 'g'::text), ''::text) AS cnpj,
            ct.id AS contrato_id,
            ct.titulo AS cliente_venda,
            ct.ganho_em,
            ct.mrr_mensal,
            ct.pipedrive_deal_id,
                CASE
                    WHEN (COALESCE(btrim(ct.cnpj), ''::text) <> ''::text) THEN 'cnpj'::text
                    ELSE v_1.metodo
                END AS metodo_vinculo
           FROM ((ops.contratos ct
             JOIN unid u ON ((u.nome_da_praca = ct.unidade)))
             LEFT JOIN ops.contrato_omie_vinculo v_1 ON ((v_1.contrato_id = ct.id)))
          WHERE (ct.status_contrato = 'Ativo'::text)
        ), ven_expandido AS (
         SELECT ven_bruto.unidade,
            ven_bruto.cnpj,
            ven_bruto.contrato_id,
            ven_bruto.cliente_venda,
            ven_bruto.ganho_em,
            ven_bruto.mrr_mensal,
            ven_bruto.pipedrive_deal_id,
            ven_bruto.metodo_vinculo
           FROM ven_bruto
        UNION ALL
         SELECT vb.unidade,
            NULLIF(regexp_replace(g.cpf_cnpj, '[^0-9]'::text, ''::text, 'g'::text), ''::text) AS cnpj,
            vb.contrato_id,
            vb.cliente_venda,
            vb.ganho_em,
            vb.mrr_mensal,
            vb.pipedrive_deal_id,
            'grupo'::text AS metodo_vinculo
           FROM (ven_bruto vb
             JOIN ops.contrato_omie_grupos g ON ((g.contrato_id = vb.contrato_id)))
          WHERE (NULLIF(regexp_replace(g.cpf_cnpj, '[^0-9]'::text, ''::text, 'g'::text), ''::text) IS NOT NULL)
        ), ven AS (
         SELECT ve.unidade,
            ve.cnpj,
            min(ve.contrato_id) AS contrato_id,
            count(*) AS contratos,
            string_agg(DISTINCT ve.pipedrive_deal_id, ', '::text) AS pipedrive_deal_id,
            min(ve.ganho_em) AS ganho_em,
            ( SELECT sum(x.mrr) AS sum
                   FROM ( SELECT DISTINCT vb2.contrato_id,
                            vb2.mrr_mensal AS mrr
                           FROM ven_expandido vb2
                          WHERE ((vb2.unidade = ve.unidade) AND (vb2.cnpj = ve.cnpj))) x) AS mrr_mensal,
            min(ve.cliente_venda) AS cliente_venda,
            min(ve.metodo_vinculo) AS metodo_vinculo
           FROM ven_expandido ve
          WHERE (ve.cnpj IS NOT NULL)
          GROUP BY ve.unidade, ve.cnpj
        UNION ALL
         SELECT ven_expandido.unidade,
            ven_expandido.cnpj,
            ven_expandido.contrato_id,
            1,
            ven_expandido.pipedrive_deal_id,
            ven_expandido.ganho_em,
            ven_expandido.mrr_mensal,
            ven_expandido.cliente_venda,
            ven_expandido.metodo_vinculo
           FROM ven_expandido
          WHERE (ven_expandido.cnpj IS NULL)
        )
 SELECT COALESCE(t.unidade, v.unidade) AS unidade,
    COALESCE(t.cnpj, v.cnpj) AS cnpj,
    COALESCE(v.cliente_venda, t.cliente_omie) AS cliente,
    v.contrato_id,
    v.pipedrive_deal_id,
    v.ganho_em,
        CASE
            WHEN (v.ganho_em IS NOT NULL) THEN (CURRENT_DATE - v.ganho_em)
            ELSE NULL::integer
        END AS dias_desde_ganho,
    v.mrr_mensal,
    v.metodo_vinculo,
    COALESCE(t.titulos, (0)::bigint) AS titulos,
    COALESCE(t.titulos_pagos, (0)::bigint) AS titulos_pagos,
    t.valor_titulos,
    t.valor_pago,
    t.ultimo_pagamento,
    COALESCE(t.royalty_creditado, (0)::numeric) AS royalty_creditado,
    COALESCE(t.royalty_a_creditar, (0)::numeric) AS royalty_a_creditar,
    COALESCE(t.royalty_perdido, (0)::numeric) AS royalty_perdido,
        CASE
            WHEN (v.contrato_id IS NULL) THEN '0. fatura sem venda registrada'::text
            WHEN (v.cnpj IS NULL) THEN '1. vendido, sem CNPJ para validar'::text
            WHEN (NOT (EXISTS ( SELECT 1
               FROM cad
              WHERE ((cad.unidade = COALESCE(t.unidade, v.unidade)) AND (cad.cnpj = v.cnpj))))) THEN '2. vendido, sem cadastro no Omie'::text
            WHEN (COALESCE(t.titulos, (0)::bigint) = 0) THEN '3. cadastrado no Omie, sem cobranca'::text
            WHEN (COALESCE(t.royalty_perdido, (0)::numeric) > (0)::numeric) THEN '5. PAGO SEM ROYALTY'::text
            WHEN (COALESCE(t.royalty_creditado, (0)::numeric) > (0)::numeric) THEN '7. royalty creditado'::text
            WHEN (COALESCE(t.royalty_a_creditar, (0)::numeric) > (0)::numeric) THEN '6. split armado, a creditar'::text
            ELSE '4. cobrado, sem split armado'::text
        END AS etapa
   FROM (tit t
     FULL JOIN ven v ON (((v.unidade = t.unidade) AND (v.cnpj = t.cnpj) AND (t.cnpj IS NOT NULL))))
  WHERE ops.can('view.royalties_split'::text)
     -- Porta do sócio (Minha Unidade · Split do Asaas): só a própria unidade.
     OR ops.can('view.meu_split'::text) AND COALESCE(t.unidade, v.unidade) IN (SELECT u2.nome_da_praca FROM ops.unidades u2 WHERE u2.id IN (SELECT ops.minhas_unidades() AS minhas_unidades));

create or replace view ops.v_split_resumo as
 SELECT u.nome_da_praca AS unidade,
    COALESCE(sum(s.valor) FILTER (WHERE (s.status = 'DONE'::text)), (0)::numeric) AS creditado,
    COALESCE(sum(s.valor) FILTER (WHERE (s.status = ANY (ARRAY['PENDING'::text, 'AWAITING_CREDIT'::text]))), (0)::numeric) AS a_creditar,
    COALESCE(sum(s.valor) FILTER (WHERE (s.status = 'CANCELLED'::text)), (0)::numeric) AS cancelado,
    count(*) FILTER (WHERE (s.status = 'DONE'::text)) AS splits_creditados,
    COALESCE(sum(s.valor) FILTER (WHERE ((s.status = 'DONE'::text) AND (NOT (EXISTS ( SELECT 1
           FROM ops.contas_receber cr
          WHERE (cr.codigo_omie = s.codigo_omie)))))), (0)::numeric) AS creditado_sem_titulo,
    count(*) FILTER (WHERE ((s.status = 'DONE'::text) AND (NOT (EXISTS ( SELECT 1
           FROM ops.contas_receber cr
          WHERE (cr.codigo_omie = s.codigo_omie)))))) AS splits_sem_titulo
   FROM (ops.asaas_splits s
     JOIN ops.unidades u ON ((u.asaas_account_id = s.origin_account_id)))
  WHERE ops.can('view.royalties_split'::text)
     -- Porta do sócio (Minha Unidade · Split do Asaas): só a própria unidade.
     OR ops.can('view.meu_split'::text) AND u.id IN (SELECT ops.minhas_unidades() AS minhas_unidades)
  GROUP BY u.nome_da_praca;

create or replace view ops.v_split_cliente_mes as
 WITH unid AS (
         SELECT unidades.id,
            unidades.nome_da_praca,
            unidades.split_ativo_desde,
            unidades.royalties_percentual
           FROM ops.unidades
          WHERE (unidades.split_ativo_desde IS NOT NULL)
        )
 SELECT cr.unidade,
    NULLIF(regexp_replace(cr.cpf_cnpj, '[^0-9]'::text, ''::text, 'g'::text), ''::text) AS cnpj,
    to_char(cr.data_vencimento, 'YYYY-MM'::text) AS mes,
    count(*) AS titulos,
    count(*) FILTER (WHERE (cr.status_pagamento = 'RECEBIDO'::text)) AS titulos_pagos,
    sum(cr.valor) AS valor_titulos,
    sum(cr.valor) FILTER (WHERE (cr.status_pagamento = 'RECEBIDO'::text)) AS valor_pago,
    COALESCE(sum(s.valor) FILTER (WHERE (s.status = 'DONE'::text)), (0)::numeric) AS royalty_creditado,
    COALESCE(sum(s.valor) FILTER (WHERE (s.status = ANY (ARRAY['PENDING'::text, 'AWAITING_CREDIT'::text]))), (0)::numeric) AS royalty_a_creditar,
    COALESCE(sum(
        CASE
            WHEN ((cr.status_pagamento = 'RECEBIDO'::text) AND (s.id IS NULL)) THEN round(((cr.valor * u.royalties_percentual) / (100)::numeric), 2)
            ELSE (0)::numeric
        END), (0)::numeric) AS royalty_perdido
   FROM ((ops.contas_receber cr
     JOIN unid u ON ((u.nome_da_praca = cr.unidade)))
     LEFT JOIN ops.asaas_splits s ON ((s.codigo_omie = cr.codigo_omie)))
  WHERE (cr.data_vencimento >= u.split_ativo_desde)
    AND (ops.can('view.royalties_split'::text)
     OR ops.can('view.meu_split'::text) AND u.id IN (SELECT ops.minhas_unidades() AS minhas_unidades))
  GROUP BY cr.unidade, NULLIF(regexp_replace(cr.cpf_cnpj, '[^0-9]'::text, ''::text, 'g'::text), ''::text), to_char(cr.data_vencimento, 'YYYY-MM'::text);

create or replace view ops.v_split_resumo_mes as
 WITH s AS (
         SELECT u.id AS unidade_id,
            u.nome_da_praca AS unidade,
            sp.status,
            sp.valor,
            cr.codigo_omie IS NOT NULL AS tem_titulo,
            to_char(
                CASE
                    WHEN (sp.status = 'DONE'::text) THEN sp.data_credito
                    ELSE cr.data_vencimento
                END, 'YYYY-MM'::text) AS mes
           FROM ((ops.asaas_splits sp
             JOIN ops.unidades u ON ((u.asaas_account_id = sp.origin_account_id)))
             LEFT JOIN LATERAL ( SELECT c.codigo_omie,
                    c.data_vencimento
                   FROM ops.contas_receber c
                  WHERE (c.codigo_omie = sp.codigo_omie)
                 LIMIT 1) cr ON (true))
        )
 SELECT s.unidade,
    s.mes,
    COALESCE(sum(s.valor) FILTER (WHERE (s.status = 'DONE'::text)), (0)::numeric) AS creditado,
    COALESCE(sum(s.valor) FILTER (WHERE (s.status = ANY (ARRAY['PENDING'::text, 'AWAITING_CREDIT'::text]))), (0)::numeric) AS a_creditar,
    COALESCE(sum(s.valor) FILTER (WHERE (s.status = 'CANCELLED'::text)), (0)::numeric) AS cancelado,
    count(*) FILTER (WHERE (s.status = 'DONE'::text)) AS splits_creditados,
    COALESCE(sum(s.valor) FILTER (WHERE ((s.status = 'DONE'::text) AND (NOT s.tem_titulo))), (0)::numeric) AS creditado_sem_titulo,
    count(*) FILTER (WHERE ((s.status = 'DONE'::text) AND (NOT s.tem_titulo))) AS splits_sem_titulo
   FROM s
  WHERE ops.can('view.royalties_split'::text)
     OR ops.can('view.meu_split'::text) AND s.unidade_id IN (SELECT ops.minhas_unidades() AS minhas_unidades)
  GROUP BY s.unidade, s.mes;

grant select on ops.v_split_cliente_mes, ops.v_split_resumo_mes to authenticated;
