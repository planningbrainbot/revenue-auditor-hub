# Menu de Monetização em areas.ts (casca)

## Contexto (1-2 frases)
Spec §5: o menu cai de 9 para 4 itens. Arquivo é da casca, dono Victor Eliezek.

## O que precisa acontecer
- Atualizar `src/lib/areas.ts`: grupo "Oportunidades" com Operação diária, Funil e ciclo (`?aba=funil`) e Previsão (`?aba=previsao`); grupo "Desenvolvimento comercial" com Abordagens.
- Remover as seis entradas antigas (Temporal, Projetado × realizado, Capacidade, Follow Day, Pessoas e PDI, Distribuição) do menu.
- Só sobe depois que os redirects já existirem, para nenhum item sumir do menu antes do destino existir.

## Dependências
- `15-redirects-aviso-n14-moldura`.
- Dono do arquivo e do merge: Victor Eliezek.
