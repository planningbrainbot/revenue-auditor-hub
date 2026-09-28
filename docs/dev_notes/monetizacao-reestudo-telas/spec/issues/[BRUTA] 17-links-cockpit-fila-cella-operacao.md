# Links do Cockpit do CEO, /fila-cella e Operação diária

## Contexto (1-2 frases)
Spec §7 (Páginas tocadas): três lugares fora do módulo Monetização que hoje apontam para abas aposentadas.

## O que precisa acontecer
- Cockpit do CEO (`indicadores.ts:608-614` e `:897-921`): trocar os links de `?aba=temporal` e `?aba=capacidade` para `?aba=previsao` e `?aba=previsao&plano=1`.
- Rota aposentada `/fila-cella`: o botão passa a levar para Funil e ciclo, com `secao=parados`.
- Operação diária: acrescentar o link "Ver por produto e ciclo →" no funil dela, abrindo Funil e ciclo com o mesmo produto.

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis` (destino Funil e ciclo precisa existir).
- `11-previsao-pagina-kpis-atencao` (destino Previsão precisa existir).
