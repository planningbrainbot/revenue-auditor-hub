# Funil e ciclo — envelhecimento dos abertos por etapa

## Contexto (1-2 frases)
Comportamento 4 do §8, Seção 3 do contrato (`FaixaPontos`). Substitui o Follow Day: a régua é dias na etapa atual, não dias sem movimento (N11 do contrato).

## O que precisa acontecer
- Implementar `permanencias(coorte)` a partir de `moves` em `model.ts`: dias na etapa atual por negócio aberto, mais miolo p25–p75 e mediana de quem já passou pela etapa.
- Desenhar `FaixaPontos` por etapa (8 linhas), ponto colorido por produto, régua tracejada em 7 dias ("régua: 7 dias na etapa").
- Ponto abre o negócio (link para o Pipedrive); "N há 7+ d" abre os parados da etapa; a ação da seção abre todos os parados.
- É o destino do link antigo `?aba=follow-day` → `?aba=funil&secao=parados`: o parâmetro `secao=parados` precisa rolar até esta seção.

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis`.
- `03-componentes-svg-ds-grafico` (`FaixaPontos`).
