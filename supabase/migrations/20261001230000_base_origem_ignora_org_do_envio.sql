-- Origem da conta ignora a organização criada pelo próprio envio do Caixa (01/10/2026).
--
-- O envio da Monetização grava em ops.monetizacao_contas.org_ids a organização que criou no Pipedrive. Na rodada
-- seguinte, base_classificar_origem recebia _pipe = true ("registro no Pipedrive fora de Curitiba") e devolvia
-- "nova", que vence a validação de origem. Em 01/10, 24 contas validadas como base antiga em 18/09 ("importação
-- autorizada") estavam como base nova só por isso: 15 cards de outubro e 9 de cargas anteriores
-- (monetizacao/medicoes/2026-10-01-frentes-01-02). Organização gravada por um envio ativo da própria conta deixa de
-- contar como registro comercial; qualquer outra organização continua contando.
--
-- Ensaiado em produção (DO com RAISE, 01/10): as 24 passam de "nova" para "confirmar", não para "antiga". O Pipefy
-- delas declara "Base Nova" e a validação de 18/09 espera a correção no Pipefy. "Registro identificado no Pipedrive"
-- cai de 306 para 282 contas.
--
-- Única mudança contra a definição viva de 01/10: o segundo termo de _pipe. Colunas, ordem e permissões iguais.
create or replace view ops.base_conta_estado as
 WITH facts AS (
         SELECT a.key,
            a.perfil,
            a.empresa_ids,
            a.org_ids,
            a.unidade_ids,
            a.source_at,
            a.updated_at,
            COALESCE(d.cnpjs, '{}'::text[]) AS cnpjs,
            COALESCE(o.unidades, '{}'::text[]) AS omie_unidades,
            COALESCE(o.registros, 0::bigint) AS omie_registros,
            COALESCE(o.fora_curitiba, false) AS omie_nova,
            COALESCE(c.pipefy_ids, '{}'::text[]) AS pipefy_ids,
            COALESCE(c.pipedrive_ids, '{}'::text[]) AS pipedrive_ids,
            COALESCE(c.declarada, '{}'::text[]) AS declarada,
            c.sincronizado,
            c.ausente,
            c.pendencias,
            COALESCE(c.nao_lidas, 0::bigint) AS nao_lidas,
            COALESCE(c.empresas, 0::bigint) AS cadastros,
            COALESCE(p.n, 0::bigint) AS contatos,
            COALESCE(p.contatavel, false) OR COALESCE(o.contato, false) OR COALESCE((a.perfil ->> 'contact'::text)::boolean, false) AND cardinality(a.empresa_ids) = 0 AND COALESCE(o.registros, 0::bigint) = 0 AS com_contato,
            COALESCE(e.registros, '[]'::jsonb) AS ecd_registros,
            md5(((((((((COALESCE(array_to_string(d.cnpjs, ','::text), ''::text) || '|'::text) || COALESCE(array_to_string(o.unidades, ','::text), ''::text)) || '|'::text) || COALESCE(array_to_string(c.pipedrive_ids, ','::text), ''::text)) || '|'::text) || COALESCE(a.perfil ->> 'new_commercial'::text, 'false'::text)) || '|'::text) || COALESCE(( SELECT string_agg((((t.aplicativo || ':'::text) || t.contrato_id) || ':'::text) || COALESCE(t.vigencia_inicial::text, ''::text), ','::text ORDER BY t.aplicativo, t.contrato_id) AS string_agg
                   FROM ops.base_omie_contratos t
                  WHERE t.cnpj = ANY (d.cnpjs)), ''::text)) || '|2026-09-17'::text) AS fingerprint
           FROM ops.monetizacao_contas a
             LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT base_conta_cnpjs.cnpj ORDER BY base_conta_cnpjs.cnpj) AS cnpjs
                   FROM ops.base_conta_cnpjs
                  WHERE base_conta_cnpjs.account_key = a.key) d ON true
             LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT ops.base_unidade(o_1.unidade) ORDER BY (ops.base_unidade(o_1.unidade))) AS unidades,
                    count(DISTINCT ROW(o_1.unidade, o_1.codigo_omie)) AS registros,
                    bool_or(ops.base_unidade(o_1.unidade) <> 'curitiba'::text) AS fora_curitiba,
                    bool_or(o_1.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'::text OR length(regexp_replace(COALESCE(o_1.telefone, ''::text), '\D'::text, ''::text, 'g'::text)) >= 8) AS contato,
                    max(COALESCE(o_1.synced_at, o_1.updated_at)) AS atualizado
                   FROM unnest(d.cnpjs) doc(cnpj)
                     JOIN ops.omie_clientes o_1 ON ops.base_cnpj(o_1.cnpj_cpf) = doc.cnpj) o ON true
             LEFT JOIN LATERAL ( SELECT array_agg(DISTINCT e_1.pipefy_record_id) FILTER (WHERE e_1.pipefy_record_id IS NOT NULL) AS pipefy_ids,
                    array_agg(DISTINCT e_1.pipedrive_id) FILTER (WHERE NULLIF(e_1.pipedrive_id, ''::text) IS NOT NULL) AS pipedrive_ids,
                    array_agg(DISTINCT COALESCE(sr.campos ->> 'origem_da_base'::text,
                        CASE
                            WHEN sr.registro_id IS NULL THEN e_1.origem_da_base
                            ELSE NULL::text
                        END)) FILTER (WHERE NULLIF(COALESCE(sr.campos ->> 'origem_da_base'::text,
                        CASE
                            WHEN sr.registro_id IS NULL THEN e_1.origem_da_base
                            ELSE NULL::text
                        END), ''::text) IS NOT NULL) AS declarada,
                    min(e_1.pipefy_sincronizado_em) AS sincronizado,
                    bool_or(e_1.pipefy_situacao = 'ausente'::text) AS ausente,
                    count(*) FILTER (WHERE e_1.pipefy_record_id IS NOT NULL AND (e_1.pipefy_sincronizado_em IS NULL OR e_1.pipefy_situacao = 'pendente'::text)) AS nao_lidas,
                    count(*) AS empresas,
                    jsonb_agg(sr.vinculos -> 'pendencias'::text) FILTER (WHERE sr.status = 'pendente'::text) AS pendencias
                   FROM ops.empresas e_1
                     LEFT JOIN ops.base_sync_registros sr ON sr.fonte = 'pipefy_empresa'::text AND sr.registro_id = e_1.pipefy_record_id
                  WHERE e_1.id = ANY (a.empresa_ids)) c ON true
             LEFT JOIN LATERAL ( SELECT count(DISTINCT c_1.id) AS n,
                    bool_or(c_1.email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'::text OR length(regexp_replace(COALESCE(c_1.whatsapp, ''::text), '\D'::text, ''::text, 'g'::text)) >= 8) AS contatavel
                   FROM ops.contatos c_1
                     LEFT JOIN ops.base_sync_registros sr ON sr.fonte = 'pipefy_contato'::text AND sr.contato_id = c_1.id
                  WHERE (c_1.empresa_id = ANY (a.empresa_ids)) AND sr.status IS DISTINCT FROM 'ausente'::text) p ON true
             LEFT JOIN LATERAL ( SELECT jsonb_agg(DISTINCT jsonb_build_object('cnpj', e_1.cnpj, 'year', e_1.ano, 'source', e_1.origem, 'registered_at', e_1.carregado_em)) AS registros
                   FROM unnest(d.cnpjs) doc(cnpj)
                     JOIN ops.base_ecd_evidencias e_1 ON e_1.cnpj = doc.cnpj AND e_1.ano >= 1900 AND e_1.ano::numeric <= EXTRACT(year FROM CURRENT_DATE)) e ON true
        )
 SELECT f.key,
    f.perfil,
    f.empresa_ids,
    f.org_ids,
    f.unidade_ids,
    f.source_at,
    f.updated_at,
    f.cnpjs,
    f.omie_unidades,
    f.omie_registros,
    f.omie_nova,
    f.pipefy_ids,
    f.pipedrive_ids,
    f.declarada,
    f.sincronizado,
    f.ausente,
    f.pendencias,
    f.nao_lidas,
    f.cadastros,
    f.contatos,
    f.com_contato,
    f.ecd_registros,
    f.fingerprint,
    v.origem AS validacao_origem,
    v.responsavel,
    v.confirmado_em,
        CASE
            WHEN ops.base_identity_conflict(f.pendencias) THEN 'confirmar'::text
            WHEN (decision.value ->> 'status'::text) <> 'confirmar'::text THEN decision.value ->> 'status'::text
            WHEN v.account_key IS NOT NULL AND v.fingerprint = f.fingerprint AND (cardinality(f.pipefy_ids) = 0 OR f.declarada = ARRAY[
            CASE
                WHEN v.origem = 'antiga'::text THEN 'Base Antiga'::text
                ELSE 'Base Nova'::text
            END]) THEN v.origem
            ELSE 'confirmar'::text
        END AS origem,
        CASE
            WHEN ops.base_identity_conflict(f.pendencias) THEN 'CNPJ diverge entre Pipefy e Brain; confirmar a identidade antes de classificar ou enviar.'::text
            WHEN (decision.value ->> 'status'::text) <> 'confirmar'::text THEN decision.value ->> 'reason'::text
            WHEN v.account_key IS NOT NULL AND v.fingerprint <> f.fingerprint THEN 'Novos vínculos encontrados; revisar a validação anterior.'::text
            WHEN v.account_key IS NOT NULL AND cardinality(f.pipefy_ids) > 0 AND f.declarada <> ARRAY[
            CASE
                WHEN v.origem = 'antiga'::text THEN 'Base Antiga'::text
                ELSE 'Base Nova'::text
            END] THEN 'Validação registrada; aguardando confirmação da correção no Pipefy.'::text
            WHEN v.account_key IS NOT NULL THEN 'Origem confirmada com responsável e evidência.'::text
            ELSE decision.value ->> 'reason'::text
        END AS motivo,
    ops.base_identity_conflict(f.pendencias) AS identity_conflict,
    decision.value || jsonb_build_object('field', 'cabecalho.dVigInicial', 'contracts', COALESCE(contracts.evidence, '[]'::jsonb)) AS origin_evidence,
    ops.base_regime_evidencia(f.cnpjs, f.perfil) AS tax_evidence
   FROM facts f
     LEFT JOIN ops.base_origem_validacoes v ON v.account_key = f.key
     LEFT JOIN LATERAL ( SELECT array_agg(t.first_start ORDER BY doc.cnpj) AS dates,
            count(t.first_start) = cardinality(f.cnpjs) AND cardinality(f.cnpjs) > 0 AS covered,
            jsonb_agg(jsonb_build_object('cnpj', doc.cnpj, 'first_start', t.first_start, 'source', 'Omie · cabecalho.dVigInicial', 'checked_at', t.checked_at) ORDER BY doc.cnpj) FILTER (WHERE t.first_start IS NOT NULL) AS evidence
           FROM unnest(f.cnpjs) doc(cnpj)
             LEFT JOIN LATERAL ( SELECT min(t_1.vigencia_inicial) AS first_start,
                    max(t_1.consultado_em) AS checked_at
                   FROM ops.base_omie_contratos t_1
                  WHERE t_1.cnpj = doc.cnpj AND ops.base_unidade(t_1.unidade) = 'curitiba'::text) t ON true) contracts ON true
     CROSS JOIN LATERAL ( SELECT ops.base_classificar_origem(f.omie_unidades, cardinality(f.pipedrive_ids) > 0 OR (EXISTS ( SELECT 1
                   FROM unnest(f.org_ids) o(id)
                  WHERE NOT (EXISTS ( SELECT 1
                           FROM ops.monetizacao_envios ev
                          WHERE ev.account_key = f.key AND ev.org_id = o.id AND (ev.status = ANY (ARRAY['sending'::text, 'sent'::text, 'uncertain'::text])))))) OR COALESCE((f.perfil ->> 'new_commercial'::text)::boolean, false), ARRAY( SELECT unidades.nome_da_praca
                   FROM ops.unidades
                  WHERE unidades.id = ANY (f.unidade_ids)), contracts.dates, contracts.covered) AS value) decision;
