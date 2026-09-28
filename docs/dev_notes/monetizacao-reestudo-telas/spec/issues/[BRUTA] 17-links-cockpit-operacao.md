# Links do Cockpit do CEO e da Operação diária

## Contexto (1-2 frases)
Spec §7 (Páginas tocadas): o Cockpit do CEO aponta para duas abas que fundem em Previsão, e a Operação ganha o atalho para Funil e ciclo. A `/fila-cella` continua mandando para o Follow Day, que fica (Pedro, 28/09).

## O que precisa acontecer
- Cockpit do CEO (`indicadores.ts:608-614` e `:897-921`): trocar os links de `?aba=temporal` e `?aba=capacidade` para `?aba=previsao` e `?aba=previsao&plano=1`.
- Operação diária: acrescentar o link "Ver por produto e ciclo →" no funil dela, abrindo Funil e ciclo com o mesmo produto.

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis` (destino Funil e ciclo precisa existir).
- `11-previsao-pagina-kpis-atencao` (destino Previsão precisa existir).
