# Funil e ciclo — página, filtros e KPIs

## Contexto (1-2 frases)
Comportamento 1 do §8 e a base da tela `/monetizacao?aba=funil`, que substitui Funil comercial no mesmo endereço (contrato `monetizacao-funil-ciclo.md`).

## O que precisa acontecer
- Montar a página com `PageHeader`, `BarraFiltros` (`de`, `ate`, `produto` na URL; padrão últimos 90 dias; presets 30/90/180 dias e mês) e `KpiGrade` com os 4 `KpiCard` (Criados na coorte · Chegaram à reunião realizada · Reunião realizada → ganho · Da criação ao ganho).
- Implementar a régua de coorte do §4.4 (negócios criados no período do filtro; os marcos contam até hoje) e o estado `parcial` do KPI de ciclo com menos de 5 ganhos.
- Cada `KpiCard` abre a lista do conjunto no `DealDetails`.
- Incluir a `descricao` do universo medido e o `details` "Como contamos" com as regras do §4.4.
- Cobrir os estados Carregando, Vazio, Vazio por filtro, Fonte indisponível e Sem acesso do contrato.

## Dependências
- `01-carga-v6-desempate-e-timestamps` (dado de ciclo correto).
- `02-tokens-cor-produto-grafico`.
- `00-protótipo-funil-e-ciclo` (layout aprovado).
