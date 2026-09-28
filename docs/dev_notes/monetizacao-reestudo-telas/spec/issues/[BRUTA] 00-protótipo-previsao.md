# Protótipo · Previsão

## Contexto (1-2 frases)
Cobre a tela nova `/monetizacao?aba=previsao` (spec §7, contrato `docs/design/contratos/monetizacao-previsao.md`), arquétipo Visão geral. Primeiro passo visual, antes de qualquer trabalho funcional.

## O que precisa acontecer
- Montar o layout com `PageHeader`, filtro de mês, 4 `KpiCard` com `meta`, caixa "O que pede atenção", 2 `Secao` (contratos por mês, halteres), `Sheet` "Plano do mês" e `Dialog` "Ver o modelo" — tudo com dado de exemplo.
- Sem ler `ops.monetizacao_forecasts` real nem a RPC `monetizacao_save_plan`; mockar cenários e a faixa pessimista–otimista.
- Validar visualmente a régua N13: meta, projetado e realizado nunca aparecem somados nem no mesmo rótulo.
- Capturar claro e escuro comparando com o arquétipo Visão geral da vitrine (até 6 KPIs, até 3 pendências, 1-2 seções).

## Dependências
- Só pode ser aberta depois do **"contrato ok" do Pedro** para `docs/design/contratos/monetizacao-previsao.md` (PROCESSO §4). Sem dependência técnica.
