# Funil e ciclo — envelhecimento dos abertos por etapa

## Contexto (1-2 frases)
Comportamento 4 do §8, Seção 3 do contrato (`FaixaPontos`). Mostra os abertos parados pelo tempo na etapa atual, não por dias sem movimento (N11 do contrato). O Follow Day fica no menu como está (em stand by, decisão do Pedro em 28/09).

## O que precisa acontecer
- Implementar `permanencias(coorte)` a partir de `moves` em `model.ts`: dias na etapa atual por negócio aberto, mais miolo p25–p75 e mediana de quem já passou pela etapa.
- Desenhar `FaixaPontos` por etapa (8 linhas), ponto colorido por produto, régua tracejada em 7 dias ("régua: 7 dias na etapa").
- Ponto abre o negócio (link para o Pipedrive); "N há 7+ d" abre os parados da etapa; a ação da seção abre todos os parados.
- O parâmetro `secao=parados` rola até esta seção (atalho para quem quer abrir direto nos parados).

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis`.
- `03-componentes-svg-ds-grafico` (`FaixaPontos`).
