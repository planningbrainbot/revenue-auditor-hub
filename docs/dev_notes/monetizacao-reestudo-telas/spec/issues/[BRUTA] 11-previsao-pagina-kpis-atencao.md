# Previsão — página, KPIs com meta e "O que pede atenção"

## Contexto (1-2 frases)
Comportamento 7 do §8, base da tela `/monetizacao?aba=previsao`, que substitui Temporal, Projetado × realizado e Capacidade.

## O que precisa acontecer
- Montar `PageHeader`, filtro de mês na URL (padrão mês corrente) e `KpiGrade` com os 4 `KpiCard` com `meta` (Contratos ganhos · Oportunidades validadas · Reuniões realizadas · Validadas em aberto, com estado "Sem data: N").
- Implementar a caixa "O que pede atenção" com até 3 itens, nas regras de prioridade do §6.2: (a) validadas abertas sem data prevista ou valor; (b) plano do próximo mês não salvo a partir do dia 20, ou alocação zerada no mês corrente; (c) projetado com mais de 30 dias ou sem o mês corrente. Cada item com botão de destino.
- Régua N13: meta, projetado e realizado nunca somam, nunca dividem a mesma barra, nunca usam o mesmo rótulo.
- Cobrir os estados do contrato: sem forecast importado, forecast sem cenários (v10), sem plano do mês, validadas sem data, mês futuro.

## Dependências
- `02-tokens-cor-produto-grafico`.
- `00-protótipo-previsao` (layout aprovado).
- Depende do chat de Forecast (branch `feat/monetizacao-forecast-v12-20260928`) ter publicado `ops.monetizacao_forecasts` com cenários. Sem isso a tela sobe lendo a v10, no estado "cenários não importados" (§11, passo 4).
