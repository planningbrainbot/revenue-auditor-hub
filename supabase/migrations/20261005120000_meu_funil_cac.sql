-- Minha Unidade · Funil de CAC: o sócio regional vê o funil de CAC da própria unidade.
--
-- Até aqui `ops.v_cac_funil` só abria para `view.unidades_rede` (chave da área Receita, que o
-- sócio não tem). A chave nova mora SÓ em `minha_unidade` e abre uma segunda porta na view,
-- mais estreita que a da matriz:
--   * só `ops.minhas_unidades()`, sem a exceção de `view.broker_admin`;
--   * só unidade com `paga_cac`. Unidade que não paga CAC não vê linha nenhuma, nem card órfão
--     aberto em nome dela no pipe de cobrança (pedido de 05/10/2026: "se a unidade não tem CAC
--     não deve aparecer nada para ela"). A lateral esconde o item pelo mesmo critério.
-- `v_cac_funil_resumo` lê `v_cac_funil`, então herda as duas portas sem mudar.
--
-- View não herda RLS (o dono é postgres): o gate vai no where. O corpo abaixo é o
-- `pg_get_viewdef` de produção em 05/10/2026 com só o where trocado; as colunas não mudam, então
-- `create or replace` serve e o resumo não precisa ser recriado.
--
-- Chave nova dentro de área existente precisa de linha em `ops.area_chaves`, senão `can()`
-- devolve false até para quem tem a área (lição da migration 76).
--
-- Rollback: supabase/rollback/20261005120000_meu_funil_cac_rollback.sql

set search_path to ops, public;

insert into ops.area_chaves (area, permission_key) values
  ('minha_unidade', 'view.meu_funil_cac')
on conflict do nothing;

create or replace view ops.v_cac_funil as
 WITH un AS (
         SELECT u.id AS unidade_id,
            u.nome_da_praca AS unidade,
            u.paga_cac,
            u.cac_desde,
            u.cac_honorario_minimo_mensal AS piso,
            ops.cac_unidade_chave(u.nome_da_praca) AS chave
           FROM ops.unidades u
          WHERE u.paga_cac OR (EXISTS ( SELECT 1
                   FROM ops.cac_cobranca_cards c
                  WHERE ops.cac_unidade_chave(c.unidade) = ops.cac_unidade_chave(u.nome_da_praca)))
        ), vendas AS (
         SELECT c.id AS contrato_id,
            c.titulo AS cliente,
            c.ganho_em,
            c.mrr_mensal,
            c.valor_total,
            c.status_contrato,
            c.pipedrive_deal_id,
            ops.cac_unidade_chave(c.unidade) AS chave_un,
            ops.cac_nome_chave(c.titulo) AS chave_cli
           FROM ops.contratos c
          WHERE c.origem_pipeline = 'inside_sales'::text AND c.ganho_em >= '2026-02-01'::date AND NOT (EXISTS ( SELECT 1
                   FROM ops.cac_funil_ignorados ig
                  WHERE ig.contrato_id = c.id))
        ), base AS (
         SELECT un.unidade_id,
            un.unidade,
            un.paga_cac,
            un.cac_desde,
            un.piso,
            v.contrato_id,
            v.cliente,
            v.ganho_em,
            v.mrr_mensal,
            v.valor_total,
            v.status_contrato,
            d.fase_atual AS fase_contrato,
            d.data_assinatura,
            k.pipefy_card_id AS cac_card_id,
            k.fase_atual AS fase_cac,
            k.unidade AS unidade_card,
                CASE
                    WHEN ops.cac_unidade_chave(k.unidade) = v.chave_un THEN k.valor_1_honorario
                    ELSE NULL::numeric
                END::numeric(12,2) AS honorario,
                CASE
                    WHEN ops.cac_unidade_chave(k.unidade) = v.chave_un THEN COALESCE(k.valor_cobrado_p1, 0::numeric) + COALESCE(k.valor_cobrado_p2, 0::numeric)
                    ELSE 0::numeric
                END::numeric(12,2) AS cobrado,
            k.data_cobranca_p1,
            k.data_cobranca_p2,
            un.cac_desde IS NOT NULL AND v.ganho_em >= un.cac_desde AND (un.piso IS NULL OR COALESCE(k.valor_1_honorario, v.mrr_mensal, 0::numeric) >= un.piso) AS elegivel
           FROM vendas v
             JOIN un ON un.chave = v.chave_un
             LEFT JOIN LATERAL ( SELECT cd.fase_atual,
                    cd.data_assinatura
                   FROM ops.contratos_documentos cd
                  WHERE cd.pipedrive_deal_id = v.pipedrive_deal_id
                  ORDER BY (
                        CASE cd.fase_atual
                            WHEN 'Churn no Contrato'::text THEN 6
                            WHEN 'Retroativo'::text THEN 5
                            WHEN 'Enviar para Onboarding'::text THEN 4
                            WHEN 'Contrato Assinado'::text THEN 3
                            WHEN 'Contrato Enviado'::text THEN 2
                            WHEN 'Alterações no contrato'::text THEN 1
                            ELSE 0
                        END) DESC, cd.created_at DESC
                 LIMIT 1) d ON true
             LEFT JOIN LATERAL ( SELECT cc.pipefy_card_id,
                    cc.titulo,
                    cc.cliente,
                    cc.unidade,
                    cc.data_assinatura,
                    cc.fase_id,
                    cc.fase_atual,
                    cc.criado_em,
                    cc.synced_at,
                    cc.valor_1_honorario,
                    cc.data_cobranca_p1,
                    cc.valor_cobrado_p1,
                    cc.data_cobranca_p2,
                    cc.valor_cobrado_p2
                   FROM ops.cac_cobranca_cards cc
                  WHERE ops.cac_nome_chave(COALESCE(cc.cliente, cc.titulo)) = v.chave_cli
                  ORDER BY (ops.cac_unidade_chave(cc.unidade) = v.chave_un) DESC, cc.criado_em DESC
                 LIMIT 1) k ON true
        UNION ALL
         SELECT un.unidade_id,
            un.unidade,
            un.paga_cac,
            un.cac_desde,
            un.piso,
            NULL::bigint AS int8,
            cc.titulo,
            NULL::date AS date,
            NULL::numeric AS "numeric",
            NULL::numeric AS "numeric",
            NULL::text AS text,
            NULL::text AS text,
            cc.data_assinatura,
            cc.pipefy_card_id,
            cc.fase_atual,
            cc.unidade,
            cc.valor_1_honorario,
            (COALESCE(cc.valor_cobrado_p1, 0::numeric) + COALESCE(cc.valor_cobrado_p2, 0::numeric))::numeric(12,2) AS "numeric",
            cc.data_cobranca_p1,
            cc.data_cobranca_p2,
            un.paga_cac
           FROM ops.cac_cobranca_cards cc
             JOIN un ON un.chave = ops.cac_unidade_chave(cc.unidade)
          WHERE NOT (EXISTS ( SELECT 1
                   FROM vendas v
                  WHERE v.chave_un = ops.cac_unidade_chave(cc.unidade) AND v.chave_cli = ops.cac_nome_chave(COALESCE(cc.cliente, cc.titulo))))
        )
 SELECT unidade_id,
    unidade,
    paga_cac,
    cac_desde,
    piso,
    contrato_id,
    cliente,
    ganho_em,
    mrr_mensal,
    valor_total,
    status_contrato,
    fase_contrato,
    data_assinatura,
    cac_card_id,
    fase_cac,
    unidade_card,
    honorario,
    cobrado,
    data_cobranca_p1,
    data_cobranca_p2,
    elegivel,
    (fase_contrato = ANY (ARRAY['Contrato Assinado'::text, 'Enviar para Onboarding'::text, 'Retroativo'::text, 'Churn no Contrato'::text])) OR data_assinatura IS NOT NULL AS assinado,
    fase_cac = 'Churn antes do 1º Fee'::text OR fase_contrato = 'Churn no Contrato'::text AS churn,
        CASE
            WHEN fase_cac = 'Churn antes do 1º Fee'::text AND fase_contrato = 'Churn no Contrato'::text THEN 'cobranca e contrato'::text
            WHEN fase_cac = 'Churn antes do 1º Fee'::text THEN 'pipe de cobranca'::text
            WHEN fase_contrato = 'Churn no Contrato'::text THEN 'Central de Contratos'::text
            ELSE NULL::text
        END AS churn_origem,
        CASE
            WHEN contrato_id IS NULL THEN 'card_sem_venda'::text
            WHEN cac_card_id IS NOT NULL AND ops.cac_unidade_chave(unidade_card) <> ops.cac_unidade_chave(unidade) THEN 'card_em_outra_unidade'::text
            WHEN cac_card_id IS NULL AND (fase_cac = 'Churn antes do 1º Fee'::text OR fase_contrato = 'Churn no Contrato'::text) THEN 'churn_sem_cobranca'::text
            WHEN NOT elegivel AND cac_card_id IS NULL THEN 'fora_da_regua'::text
            WHEN cac_card_id IS NULL AND (fase_contrato = ANY (ARRAY['Contrato Assinado'::text, 'Enviar para Onboarding'::text, 'Retroativo'::text, 'Churn no Contrato'::text])) THEN 'assinado_sem_card'::text
            WHEN cac_card_id IS NULL AND fase_contrato IS NOT NULL THEN 'contrato_em_andamento'::text
            WHEN cac_card_id IS NULL THEN 'sem_contrato'::text
            WHEN COALESCE(honorario, 0::numeric) = 0::numeric THEN 'card_sem_honorario'::text
            WHEN cobrado = 0::numeric THEN 'card_sem_cobranca'::text
            WHEN cobrado < (honorario - 0.5) THEN 'cobranca_parcial'::text
            ELSE 'cobranca_concluida'::text
        END AS etapa,
    GREATEST(COALESCE(honorario, 0::numeric) - cobrado, 0::numeric)::numeric(12,2) AS a_cobrar
   FROM base b
  WHERE ops.can('view.unidades_rede'::text) AND (ops.can('view.broker_admin'::text) OR (unidade_id IN ( SELECT ops.minhas_unidades() AS minhas_unidades)))
     -- Porta do sócio (Minha Unidade · Funil de CAC): só a própria unidade, e só se ela paga CAC.
     OR ops.can('view.meu_funil_cac'::text) AND paga_cac AND (unidade_id IN ( SELECT ops.minhas_unidades() AS minhas_unidades));
