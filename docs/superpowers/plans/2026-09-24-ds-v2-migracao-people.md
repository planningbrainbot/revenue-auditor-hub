# Plano · Planning People, Broker e Minha Unidade (módulo 5) no DS v2

Branch `feat/ds-v2-migracao-people-20260924` (worktree `planning-brain-ds-v2-people`), base `origin/main` `b5c44d7` + correção V4 do IDU (cherry-pick de `1bb0341`).
Contratos: `docs/design/contratos/{gente,broker,minha-unidade}.md`. Aprovação: Pedro, 24/09 ("pode seguir conforme suas propostas… é pra padronizar e melhorar TODAS as telas de TODOS os módulos"). Dono: Eliezek (revisa no PR).

## Regras para toda tarefa (subagente executor)
1. Leia `docs/design/README.md`, `ARQUETIPOS.md`, `DESIGN.md` (§4 status, §5 gráficos, §8 botões, §10 regras V) e o contrato. O contrato manda.
2. **Não toque:** `supabase/**`, `src/lib/areas.ts`, `src/components/app-sidebar.tsx`, `src/routes/_authenticated/route.tsx`, `src/components/planning/**`, `src/hooks/use-permissions.ts`, funções de servidor (`*.functions.ts`), nenhuma query, RPC, RLS, permissão, fórmula ou regra de negócio. Correção de exibição (rótulo, estado, zero no lugar de ausência, fuso de data na tela, confirmação, motivo de botão desabilitado, toast de erro) é permitida.
3. Compose com `@/components/planning` e `@/components/ui/*`; gráfico só com `@/lib/planning/grafico` (um eixo Y); `confirm()` nativo → `AlertDialog`; toda escrita com `toast` de sucesso e erro.
4. Estado de tela (aba, filtros, período) na URL (`validateSearch` ou `useFiltroNaUrl`), sem quebrar links antigos.
5. Portão: **só** `/private/tmp/claude-502/-Users-pluca-Desktop-AI-Projects/cd929927-c6e8-49b3-9ae4-50eb2a90f7fc/scratchpad/portao.sh "$PWD"` (trava global; a máquina tem 8 GB; não rode vite build/tsc por fora). Aceite: build 0, tsc sem erro novo (base: 7), lint sem violação.
6. Um commit por tela (ou grupo pequeno), trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push. `git add` só dos arquivos da tarefa.
7. Relate arquivos, o que ficou fora e por quê, portão, hashes.

## Tarefas (sequenciais neste worktree)
| # | Tela |
|---|---|
| P1 | People: moldura + Minha vez, Meu time, 1:1, Feedback |
| P2 | People: Sentimento, Elogios, Avaliação, PDI |
| P3 | People: Cadastro, Clima, Adoção |
| P4 | Broker (unidade e Matriz) |
| P5 | Minha Unidade (Painel, Meus Royalties, Auditorias) |
| P6 | Revisão final |

Revisão por tarefa: subagente somente leitura, contra o contrato.
