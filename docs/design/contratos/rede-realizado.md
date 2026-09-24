# Contrato · Realizado por unidade (`/rede-realizado`)

**Dono de produto:** sem dono nomeado (`PRODUCT.md` 5.14); casca e Rede são do Eliezek   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Régua e fontes não mudam.

## Propósito
- **Pergunta (N1):** "Como cada unidade evoluiu mês a mês?"
- **Público:** diretoria.
- **Ação:** comparar a curva das unidades numa métrica e abrir a tela dona da métrica.
- **Arquétipo:** Lista/Relatório (gráfico de comparação).
- **Universo (`descricao`):** "Unidades regionais · meses com título no Omie · recebido pelo mês de competência; MRR e contratos ativos são a foto de hoje".

## Métricas (abas em `?metrica=`)
| Aba (rótulo) | Definição | Fonte | Forma |
|---|---|---|---|
| Recebido (competência) | recebido pelo mês de competência | `v_reconciliacao_mensal` | linha por unidade |
| MRR hoje | MRR contratado de hoje | idem | **barra por unidade** (a série antiga repetia a foto em todos os meses e desenhava uma linha plana) |
| Contratos ativos hoje (era "Clientes Ativos") | contratos ativos hoje | idem | barra por unidade |
| ARPA por contrato | MRR ÷ contratos ativos | derivado | barra por unidade |
| Crescimento do recebido % | variação do recebido sobre o mês anterior | derivado | linha |
| CAC | CAC por unidade e mês | `roas_por_unidade` | linha |
| NPS | promotores − detratores ÷ respostas, por mês de criação | `nps_pesquisas` | linha |

## Correções de exibição
1. **CAC e NPS vazios:** o mês da view chega como `timestamptz` e o de `roas_por_unidade` é `date`; as chaves não casavam e as duas abas saíam vazias (83 linhas de CAC no banco em 24/09). A tela normaliza o mês para `aaaa-mm`.
2. Erro das três leituras era ignorado (gráfico vazio): passa a `EstadoErro` por fonte.
3. `fontSize={11}` (V4) e grade/tooltip/legenda locais → `eixoProps`, `gradeProps`, `tooltipProps`, `legendaProps`. Eixo com a unidade (R$, %).
4. Cores: `CORES_SERIE` sem ciclar o neutro. Com mais de 5 unidades, a linha mostra as 5 maiores e as outras ficam na legenda como "outras" desligadas por padrão (o leitor liga a que quiser).
5. Mês sem título mostrava R$ 0 (COALESCE da view): o ponto sem título fica sem valor, e `connectNulls` sai, para o buraco aparecer.

## Estados
Carregando `Carregando variante="grafico"` · erro `EstadoErro` · vazio `EstadoVazio` · sem acesso: portão da área.

## Filtros na URL
`metrica` · `unidades` (lista) · `de`, `ate` (padrão: últimos 12 meses; hoje a série pega competências antigas de 2021).

## O que NÃO entra
Tabela linha a linha (Funil de Receita); NPS pela régua do IDU.

## Para onde manda
Recebido → `/funil-receita`; NPS → `/nps`; CAC → `/unidades/funil-cac`.
