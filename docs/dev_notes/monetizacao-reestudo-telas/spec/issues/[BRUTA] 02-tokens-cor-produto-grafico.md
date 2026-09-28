# Tokens de gráfico e COR_PRODUTO

## Contexto (1-2 frases)
Base visual compartilhada pelos componentes novos do DS e pelas duas telas novas (spec §6, §6.4). Precisa existir antes dos componentes SVG e das telas funcionais.

## O que precisa acontecer
- Criar `--chart-seq-1..5` (rampa sequencial verde do mapa de calor) e `--chart-perdido` (cinza claro do segmento perdido) em `src/styles.css`, nos dois temas.
- Criar o mapa `COR_PRODUTO` (Cella `--chart-1`, Consultoria `--chart-2`, Finance `--chart-3`, Sem produto `--chart-6`) e `rotuloProduto` num lugar só, em `src/lib/planning/grafico.ts`, para uso pelas duas telas novas e pelo `DealDetails`.
- Rodar o script da skill `dataviz` e confirmar as checagens de contraste/daltonismo no tema claro (o achado do tema escuro já está registrado para o DS e não bloqueia esta spec).
- Nenhum hex cru em `.tsx` (regra V2).

## Dependências
- Nenhuma.
