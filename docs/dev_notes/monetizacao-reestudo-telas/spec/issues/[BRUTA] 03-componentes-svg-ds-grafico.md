# Componentes SVG novos do DS — FaixaPontos, Halteres, MapaCalor, MatrizBarras

## Contexto (1-2 frases)
Spec §6.4. Quatro componentes SVG próprios usados por Funil e ciclo e por Previsão, seguindo o mesmo padrão do funil desenhado à mão pela Operação (`operacao.tsx:210-406`).

## O que precisa acontecer
- Criar `FaixaPontos` (pontos por categoria, faixa p25–p75 e régua), `Halteres`, `MapaCalor` (tabela com rampa sequencial e célula clicável) e `MatrizBarras` em `src/components/planning/`, com revisão de design (DESIGN §1.6).
- Cada componente recebe dado sintético próprio e entra na vitrine (`/vitrine#graficos`).
- Usar os tokens `--chart-seq-*` e o `COR_PRODUTO` da issue de tokens — nenhum hex cru.
- Componente puro: sem leitura de dado real nem drill-down ligado a `DealDetails` ainda (isso entra nas issues das telas).

## Dependências
- `02-tokens-cor-produto-grafico` (tokens e `COR_PRODUTO` precisam existir antes).
