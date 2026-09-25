# Plano · Cockpit: leitura de dez segundos e "Perguntar ao Brain" (24/09/2026)

Spec: `docs/superpowers/specs/2026-09-24-cockpit-leitura-e-conversa-design.md`. Execução sequencial em lotes; cada lote termina com teste verde e commit.

| Lote | Entrega | Teste que prova |
|---|---|---|
| 1 | Carga do servidor reutilizável: `carregar*Cockpit` passam a chamar funções `ler*` exportadas (mesma lógica); `conversa/carga.server.ts` monta a `FonteCockpit` no servidor por pessoa, com cache por `userId` | testes existentes seguem verdes; teste de cache por pessoa |
| 2 | Camada de métricas `conversa/metricas.ts` (pura): catálogo de consultas sobre a carga — indicador, série de faturamento, ponte, unidades (ranking/comparação, base nova/antiga), aquisição (funil, plano × realizado), onboarding por fase, cadeia, caixa, coortes, clientes por régua — com filtros validados e resultado com procedência | testes com valores calculados à mão; unidade fora do escopo recusada; ausência ≠ 0 |
| 3 | Especificação `conversa/spec.ts` (zod, v1), resolução de referências, conferência de números do texto | spec com número literal recusada; referência a resultado inexistente recusada; número inventado no texto removido |
| 4 | Jev da conversa: taxonomia `cockpit-ceo-conversa-v1`, decisão de encaminhamento com limiares, ledger | falha do Jev → encaminhamento sem dica; limiares aplicados |
| 5 | Banco: migration + rollback das 4 tabelas, RLS testada em transação desfeita, aplicada | dono lê; outro usuário não lê nem grava; sem área não grava |
| 6 | Servidor do chat `/api/cockpit-ceo/conversa`: sessão, área, orçamento, Jev, `streamText` com ferramentas, validação, persistência, cancelamento, tentativas | testes com modelo simulado (`ai/test`): pedido de SQL recusado, número inventado removido, ferramenta com falha, orçamento esgotado |
| 7 | Tela "Perguntar ao Brain": conversa, área visual, controles de filtro, histórico, visões salvas (salvar, renomear, reabrir, excluir) | teste de percurso com sessão real no app local |
| 8 | Visão executiva refeita (spec §3.1) + `KpiCard.tendencia` | conciliação cartão × gráfico × ponte; captura 1280×800 e 1440×900, claro e escuro |
| 9 | Avaliação Sonnet 5 × Opus 5.5 com ledger cumulativo | relatório com números |
| 10 | Verificação final: build, `tsc`, testes, `design:lint:changed`, capturas antes/depois, relatório, DECISIONS | — |
