# Menu de Monetização em `areas.ts`

## Contexto (1-2 frases)
§5 da spec: o menu passa de 9 para 7 itens. Três abas fundem em Previsão; Follow Day, Pessoas e PDI e Distribuição ficam (Pedro, 28/09). O arquivo é da casca (dono: Eliezek).

## O que precisa acontecer
- Grupo "Oportunidades": Operação diária, Funil e ciclo (`?aba=funil`, no lugar de "Funil comercial"), Previsão (`?aba=previsao`) e Follow Day.
- Grupo "Desenvolvimento comercial": Abordagens, Pessoas e PDI e Distribuição.
- Remover as três entradas que fundiram (Temporal e previsão, Projetado × realizado, Capacidade e alocação).
- Só sobe depois que os redirects já existirem, para nenhum item sumir do menu antes do destino existir.

## Dependências
- `15-redirects-aviso-n14-moldura`.
- Dono do arquivo e do merge: Victor Eliezek.
