-- View "DRE Realizada" da Planning Partners (aba "DRE Realizada" em /financeiro-partners).
--
-- Fonte: partners_dfc_caixa_competencia, tabela populada por
-- tools/sync_partners_financeiro.py (repo AI Projects) a partir da planilha
-- mensal "EXP. AJUSTE FINANCEIRO_COMPLETA_YYYY.MM.xlsx" (De-Para oficial da
-- contadora). Não é uma tabela deste repo — criada/mantida via migrations
-- 19 e 20 em AI Projects/migrations/.
--
-- Por que não usa partners_financeiro (que já sincroniza ao vivo via Omie API,
-- mesma fonte da aba FCx): foi tentado um join ao vivo
-- (partners_financeiro + categorias_omie + partners_dfc_categoria) e os totais
-- não bateram com a planilha da contadora (divergência de 30-60%, provável
-- causa: valor_documento é bruto, a contadora usa valor líquido/regime de
-- competência). Essa view lê do snapshot da planilha em vez disso — bate à
-- centavo, mas só fica atualizada se alguém rodar o sync do mês.
-- Ver DATA-RULES.md (decisão 12/08/2026) e memória project_partners_financeiro_dre.

CREATE OR REPLACE VIEW public.partners_dre_realizada_mensal AS
SELECT
  estrutura_4 AS bloco,
  estrutura_dre AS linha,
  date_trunc('month', data_apuracao)::date AS mes,
  SUM(valor_reais) AS valor,
  COUNT(*) AS qtd_lancamentos,
  MAX(arquivo_referencia) AS arquivo_referencia
FROM public.partners_dfc_caixa_competencia
WHERE apelido = 'PARTNERS' AND estrutura_dre IS NOT NULL
GROUP BY 1, 2, 3;
