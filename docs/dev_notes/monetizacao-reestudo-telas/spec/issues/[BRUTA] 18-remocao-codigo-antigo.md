# Remoção do código das abas que fundiram

## Contexto (1-2 frases)
§10 da spec: sai o código de Temporal, Funil comercial, Projetado × realizado e Capacidade, que viraram Funil e ciclo e Previsão. Follow Day, Pessoas e PDI e Distribuição **ficam** (Pedro, 28/09) e não são tocados.

## O que precisa acontecer
- Remover de `src/components/monetizacao/analysis.tsx`: `Temporal` e `Funnel`.
- Remover de `forecast.tsx` os KPIs e tabelas que não migraram para a Previsão; `Capacity` sai de `analysis.tsx` depois que o editor estiver no Sheet do plano.
- Remover `temporal()` de `model.ts` (o ciclo já está nas funções novas). `distancia()` fica: o Follow Day usa.
- Remover os casos de teste de `temporal` e os de `capacidade`/`forecastComparison` que deixarem de valer, em `tests/monetizacao.test.mjs`.

## Dependências
- `16-menu-areas-ts-casca` (as abas já saíram do menu).
- `14-previsao-plano-do-mes-sheet-e-modelo` (Capacity e ForecastModel já migraram).
