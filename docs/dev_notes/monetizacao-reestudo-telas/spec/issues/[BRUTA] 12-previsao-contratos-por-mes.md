# Previsão — contratos por mês contra o projetado

## Contexto (1-2 frases)
Comportamento 8 do §8, Seção 1 do contrato: colunas de contratos ganhos por mês contra a linha do projetado e a faixa de cenários do modelo novo.

## O que precisa acontecer
- Ler eventos `signed` do mês por produto (colunas empilhadas, ≤ 3 séries), a linha do projetado (cenário base) e a `ReferenceArea` da faixa pessimista–otimista, no formato de forecast do §12 (`months[]`, `cenarios[]`, `projetado[cenario][mes][produto][marco]`).
- Desenhar a `ReferenceLine` tracejada da Meta do plano só nos meses com plano; o mês corrente diz "até dd/mm".
- Coluna abre os ganhos do mês no `DealDetails`; ponto do projetado mostra a premissa no tooltip.

## Dependências
- `11-previsao-pagina-kpis-atencao`.
- `02-tokens-cor-produto-grafico`.
- Depende do chat de Forecast (branch `feat/monetizacao-forecast-v12-20260928`): sem cenários publicados em `ops.monetizacao_forecasts`, o gráfico mostra só o projetado v10 sem faixa, com a legenda "cenários não importados".
