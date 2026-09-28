# Funil e ciclo — funil por produto com saídas em cada marco

## Contexto (1-2 frases)
Comportamento 2 do §8, Seção 1 do contrato: até onde cada produto chega e onde os negócios saem.

## O que precisa acontecer
- Implementar `funilMarcos(coorte)` em `model.ts`: por marco, quem chegou, avançou, ficou aberto ou foi perdido, e quem "pulou o registro" (chegou a um marco posterior sem passar pelo marco atual).
- Desenhar os pequenos múltiplos (Geral + um painel por produto quando há filtro) com barra horizontal empilhada em três partes — avançou, ainda aberto, perdido — usando recharts `BarChart layout="vertical"` + `stackId`.
- Segmento abre a lista do segmento; o número que chegou abre quem chegou; tooltip mostra quem pulou o registro.
- Escala de cada painel: os criados do produto.

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis`.
- `02-tokens-cor-produto-grafico` (`COR_PRODUTO`, `--chart-perdido`).
