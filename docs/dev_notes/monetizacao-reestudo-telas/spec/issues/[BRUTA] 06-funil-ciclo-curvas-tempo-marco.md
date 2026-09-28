# Funil e ciclo — curvas de tempo até cada marco

## Contexto (1-2 frases)
Comportamento 3 do §8, Seção 2 do contrato: em quanto tempo o negócio chega a cada marco, com os abertos como observação parcial.

## O que precisa acontecer
- Implementar `curvaMarco(coorte, marco)` em `model.ts` para os três marcos (reunião realizada, validação, ganho): incidência acumulada com a perda como risco concorrente, e a linha parando quando restam menos de 5 negócios em observação.
- Desenhar três pequenos múltiplos com `Line type="stepAfter"` por produto, eixo comum de 0 a 60%.
- Cruz vertical com tooltip de todas as séries naquele dia; clique abre quem alcançou o marco.

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis`.
- `01-carga-v6-desempate-e-timestamps` (ciclo depende de `won_at`/`lost_at` corretos).
- `02-tokens-cor-produto-grafico`.
