# Remoção do código antigo do módulo

## Contexto (1-2 frases)
Spec §10: código das seis telas apagadas e das que mudaram de lugar, removido só depois que Funil e ciclo, Previsão e o menu novo já estão publicados.

## O que precisa acontecer
- Remover de `src/components/monetizacao/analysis.tsx`: `Temporal`, `FollowDay` e `SINAIS_FOLLOW`, `Funnel`, `People`, `Distribution` e `FotoDistribuicao`.
- Remover de `forecast.tsx` os KPIs e tabelas que não migraram para a Previsão; remover o exemplo de Fila em `vitrine.tsx` (`:1418+`) que cita o Follow Day.
- Remover `temporal()` de `model.ts` (o ciclo já está nas funções novas) e `distancia()` se ficar sem uso.
- Remover os casos de teste de `temporal` e os de `capacidade`/`forecastComparison` que deixarem de valer, em `tests/monetizacao.test.mjs`.

## Dependências
- `16-menu-areas-ts-casca` (as abas já saíram do menu).
- `14-previsao-plano-do-mes-sheet-e-modelo` (Capacity e ForecastModel já migraram).
