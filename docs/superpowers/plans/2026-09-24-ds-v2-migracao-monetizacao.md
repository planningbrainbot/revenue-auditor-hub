# Plano · Monetização no DS v2 (módulo 1 da migração)

Branch `feat/ds-v2-migracao-monetizacao-20260923` (worktree `planning-brain-ds-v2-migracao`), base `origin/main` `b5c44d7`.
Contratos: `docs/design/contratos/monetizacao.md` (moldura) e `monetizacao-<aba>.md`. Aprovação: Pedro, 24/09 ("pode seguir conforme suas propostas"), registrada em `DECISIONS.md` [2026-09-24].
Ledger: `docs/design/migracao/ledger.md`.

## Regras para toda tarefa (subagente executor)
1. Leia `docs/design/README.md` (e, na ordem dele, `ARQUETIPOS.md` e `DESIGN.md`), o contrato da moldura e o contrato da tela da tarefa. O contrato manda; o plano só recorta.
2. **Não toque:** `src/lib/monetizacao/model.ts`, `src/lib/monetizacao/functions.ts`, `supabase/**`, `src/lib/areas.ts`, `src/components/app-sidebar.tsx`, `src/routes/_authenticated/route.tsx`, `src/components/planning/**` (salvo a tarefa dizer), nenhuma query, RPC, RLS, permissão ou cálculo. As regras Z aprovadas são aplicadas **na camada de apresentação**, com dado que o componente já recebe (ex.: contar `history_known=false` no recorte para decidir `estado="parcial"`).
3. Componha com `@/components/planning` (`PageHeader`, `Secao`, `KpiCard`/`KpiGrade`, `StatusBadge`, `EstadoVazio`, `EstadoErro`, `EstadoSemAcesso`, `Carregando`, `Procedencia`, `BarraFiltros`) e `@/components/ui/*` (`Table`, `Tooltip`, `Dialog`, `AlertDialog`, `Sheet`). Tokens só de `src/styles.css`. Gráfico só com `@/lib/planning/grafico`.
4. Estado de tela na URL via `validateSearch` da rota `/_authenticated/monetizacao` (chaves declaradas na T1) e `Route.useSearch/useNavigate` ou `useFiltroNaUrl`.
5. Portão da tarefa, antes do commit: `NODE_OPTIONS=--max-old-space-size=8192 npx vite build` ok; `npx tsc --noEmit -p .` com no máximo os 7 erros antigos (nenhum em arquivo tocado); `npm run design:lint:changed` sem violação.
6. Um commit por tarefa, mensagem `monetizacao(<aba>): …` em português, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push.
7. Relate: arquivos tocados, o que do contrato ficou fora e por quê, resultado do portão.

## Regras para a revisão de cada tarefa (subagente revisor)
Somente leitura (não edite nada; o orquestrador confere o `git status` depois). Compare o diff do commit com o contrato item por item: pergunta, universo, números e drill-down, zeros, estados, filtros na URL, ações e motivos de desabilitado, "o que não entra". Procure regressão em outra visão da mesma página. Devolva: aprovado, ou a lista de falhas com arquivo:linha.

## Tarefas (sequenciais)
| # | Tarefa | Arquivos principais | Contrato |
|---|---|---|---|
| T1 | Moldura: URL (`de`, `ate`, `responsavel`, `produto`, `dias`, `mes`, `sinal`, `blocos`, `totais`, `arquivados`, `situacao`), faixa de abas e logo fora, `PageHeader` por aba (pergunta, `descricao`, `procedencia`), barra de filtros por aba e rótulo do responsável pelo sentido, estados do DS, motivo nos botões desabilitados, Atualizar com retorno, `DealDetails` (cabeçalho do recorte, modo estoque, ordem, vazio), `Kpi` repassando `estado`/`procedencia`/`nota`, helpers Z1/Z2, `Panel`→`Secao`, `Notice`/`LoadingState`→estados | `routes/_authenticated/monetizacao.tsx`, `monetizacao/dashboard.tsx`, `monetizacao/common.tsx` | `monetizacao.md` |
| T2 | Operação diária | `dashboard.tsx` | `monetizacao-operacao.md` |
| T3 | Follow Day | `analysis.tsx` (FollowDay) | `monetizacao-follow-day.md` |
| T4 | Temporal e previsão | `analysis.tsx` (Temporal) | `monetizacao-temporal.md` |
| T5 | Projetado × realizado | `forecast.tsx`, `forecast-model.tsx` | `monetizacao-forecast.md` |
| T6 | Capacidade e alocação | `analysis.tsx` (Capacity) | `monetizacao-capacidade.md` |
| T7 | Funil comercial e Distribuição | `analysis.tsx` (Funnel, Distribution) | `monetizacao-funil.md`, `monetizacao-distribuicao.md` |
| T8 | Pessoas e PDI e Abordagens | `analysis.tsx` (People, Scripts, RecordList) | `monetizacao-pessoas.md`, `monetizacao-roteiros.md` |
| T9 | Revisão final do módulo | todo o diff `b5c44d7..HEAD` | todos |

Depois da T9 (orquestrador): capturas antes (`b5c44d7`) e depois, escuro e claro, com a sessão do Pedro, em `docs/design/capturas/monetizacao/`; comparativo; PR descrito pelo template para o Eliezek. Parar e mostrar ao Pedro antes de abrir o PR.

## Perguntas e universo por aba (N1, aprovados)
| aba | titulo (menu) | pergunta |
|---|---|---|
| operacao | Operação diária | O ritmo de hoje leva à meta do mês? |
| follow-day | Follow Day | Qual negócio aberto eu destravo hoje? |
| temporal | Temporal e previsão | Quando as oportunidades abertas devem virar contrato, e quanto valem? |
| forecast | Projetado × realizado | O mês está acima ou abaixo do que a planilha projetou? |
| capacidade | Capacidade e alocação | A base disponível cobre o que planejamos trabalhar em cada produto neste mês? |
| funil | Funil comercial | Quantas reuniões marcadas acontecem, e quantas validadas viram contrato? |
| pessoas | Pessoas e PDI | Como o hunter está nos cinco critérios, e qual é o próximo passo de desenvolvimento dele? |
| roteiros | Abordagens | O que eu digo para este produto e este segmento? |
| distribuicao | Distribuição | A carga está bem dividida entre os responsáveis, ou alguém está sem base? |
