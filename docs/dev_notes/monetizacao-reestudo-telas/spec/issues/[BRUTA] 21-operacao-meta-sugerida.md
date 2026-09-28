# Operação diária usa a meta sugerida, com selo

## Contexto (1-2 frases)
Decisão P3 do Pedro (28/09, opção C): o modelo sugere a meta e alguém confirma. Sem plano salvo no mês, a Operação deixa de ficar sem meta e passa a usar a sugestão do cenário base, marcada como "sugerida".

## O que precisa acontecer
- Em `metasOperacao` (ou onde a Operação lê o plano), cair em `planoSugerido(forecast, mes)` quando não houver plano salvo no mês.
- Os quadros de meta mostram o selo "sugerida" e, no tooltip, a versão do modelo de onde veio. Plano salvo continua sem selo.
- Sem plano e sem forecast para o mês: comportamento de hoje (sem meta, `nao-apurado`).
- Combinar com o chat da Operação antes de abrir: a tela é dele (`fix/monetizacao-standby-reuniao-20260928`).

## Dependências
- `14-previsao-plano-do-mes-sheet-e-modelo` (onde nasce `planoSugerido`).
