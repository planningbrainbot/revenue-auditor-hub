# Funil e ciclo — motivos de perda por produto

## Contexto (1-2 frases)
Comportamento 5 do §8, Seção 4 do contrato (`MatrizBarras`) e a classificação `grupoMotivo` do §6.5.

## O que precisa acontecer
- Implementar `grupoMotivo(texto)` em `src/lib/monetizacao/model.ts` com a tabela de regras do §6.5 (a primeira regra que casar vence), com teste cobrindo os grupos e a contagem de 28/09.
- Cruzar `grupoMotivo` × produto e desenhar a `MatrizBarras` (linhas = grupo, colunas = produto, escala comum), com "Remanejado ou duplicado" separado no fim e fora da taxa de perda (§4.4).
- Célula abre os perdidos daquele grupo/produto; tooltip mostra a etapa de saída; lista mostra o texto original do motivo.

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis`.
- `03-componentes-svg-ds-grafico` (`MatrizBarras`).
