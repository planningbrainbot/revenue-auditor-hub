# Contrato · LTV Estimado (`/rede-ltv`)

**Dono de produto:** sem dono nomeado (`PRODUCT.md` 5.14); Rede é do Eliezek   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Fórmulas não mudam; os rótulos passam a dizer qual fórmula é qual.

## Propósito
- **Pergunta (N1):** "Quanto vale um contrato em cada unidade, e isso cobre o CAC?"
- **Público:** diretoria.
- **Ação:** achar a unidade com LTV baixo e abrir o Realizado e o Funil de CAC dela.
- **Arquétipo:** Lista/Relatório.
- **Universo (`descricao`):** "Contratos ativos hoje, franquias · ARPA por contrato × tempo de vida · CAC da rede por mês".

## Números
| Rótulo | Definição | Unidade | Fonte |
|---|---|---|---|
| LTV por contrato ativo | ARPA × LT médio dos ativos | R$ | `contratos` (ativos, franquia) |
| ARPA por contrato | Σ MRR ÷ contratos ativos | R$ | idem |
| Idade média dos contratos ativos (era "LT Médio") | média de meses entre o ganho e hoje, só dos ativos | meses | idem |
| LTV por unidade (barras) | mesma fórmula por unidade | R$ | idem |
| Série mensal: LTV estimado × CAC | ARPA da foto × LT da série (meses desde 07/2024 ÷ 2, fórmula existente) × CAC da rede | R$ | `v_reconciliacao_mensal` + `roas_mensal` |
| Resumo mensal | Contratos ativos (era "Ativos BPO") · ARPA · LT da série · LTV | contrato, R$, meses | idem |

N11: "LT" tinha dois sentidos na mesma tela (idade real dos ativos × meses desde 07/2024 ÷ 2). Os rótulos passam a "Idade média dos contratos ativos" e "LT da série (desde 07/2024)". A `procedencia` da série diz que a data inicial é fixa no código.

## Correções de exibição
1. **Série mensal quebrada:** `new Date(mes + "-01")` com o mês em `timestamptz` dava data inválida, LT = 1 e LTV = ARPA; o CAC não casava com `roas_mensal.mes` (date). A tela normaliza o mês para `aaaa-mm`.
2. **Dois eixos Y** em "LTV vs CAC" e "ARPA vs LT" (V8, DECISIONS 22/09): viram gráficos de um eixo cada (LTV e CAC em R$ no mesmo eixo; ARPA em R$ e LT em meses em gráficos separados).
3. KPIs em `Card` local → `KpiCard`; carregando não mostra "—" como valor.
4. Mês sem contrato plotava ARPA e LTV 0: fica sem ponto. "0" legítimo não vira "—" na tabela.
5. Erros ignorados → `EstadoErro`; grade de KPIs quebra em 2 colunas no celular.

## Estados · Filtros
Carregando/erro/vazio do DS. Filtro `unidade` na URL (hoje não há filtro nenhum).

## O que NÃO entra
LTV do Overview (ARPA ÷ churn) e "Receita bookada" do Indicadores (MRR × 60): réguas diferentes, citadas na `descricao` para ninguém comparar os três.

## Achado para o dono
A série mensal usa ARPA de hoje e um LT fixo desde 07/2024 ÷ 2: não é um LTV histórico. Vale decidir se a série fica.
