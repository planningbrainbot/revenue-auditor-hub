# Plano · Rede no DS v2 (módulo 2 da migração)

Branch `feat/ds-v2-migracao-rede-20260924` (worktree `planning-brain-ds-v2-rede`), base `origin/main` `b5c44d7`.
Contratos: `docs/design/contratos/{rede-overview,indicadores-trimestre,idu,rede-realizado,rede-ltv,rede-headcount}.md`. Aprovação: Pedro, 24/09 ("pode seguir conforme suas propostas… é pra padronizar e melhorar TODAS as telas de TODOS os módulos"). Dono do módulo: Eliezek (revisa no PR).

## Regras para toda tarefa (subagente executor)
1. Leia `docs/design/README.md`, `ARQUETIPOS.md`, `DESIGN.md` (§5 gráficos, §10 regras V) e o contrato da tela. O contrato manda.
2. **Não toque:** `supabase/**`, `src/lib/areas.ts`, `src/components/app-sidebar.tsx`, `src/routes/_authenticated/route.tsx`, `src/components/planning/**`, `src/hooks/use-permissions.ts`, qualquer RPC, query SQL, RLS, permissão ou fórmula. As "correções de exibição" do contrato são permitidas: são defeito de tela (chave de mês, fuso, eixo, zero no lugar de ausência), não régua.
3. Normalização de mês: use `src/lib/rede/mes.ts` (criado na R1): `chaveMes(v: string | Date | null) → "aaaa-mm" | null` e `rotuloMes("aaaa-mm") → "mmm/aa"` sem passar por `new Date` em UTC.
4. Compose com `@/components/planning` e `@/components/ui/*`; gráfico só com `@/lib/planning/grafico` (um eixo Y por gráfico, ≤3 séries empilhadas, sem ciclar o neutro).
5. Estado de tela na URL (`validateSearch` da rota ou `useFiltroNaUrl`).
6. Portão antes do commit: `NODE_OPTIONS=--max-old-space-size=8192 npx vite build`; `npx tsc --noEmit -p .` sem erro novo (a main tem 7, um deles em `rede-overview.tsx:1076`, que pode e deve sumir se a tarefa reescrever aquele trecho); `npm run design:lint:changed` sem violação.
7. Um commit por tela, `rede(<tela>): …`, trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push. Não use `git add -A` fora da pasta do repo; confira `git status` antes.
8. Relate arquivos, o que ficou fora e por quê, portão, hash.

## Tarefas (sequenciais neste worktree)
| # | Tela | Arquivos |
|---|---|---|
| R1 | Overview da Rede (+ cria `src/lib/rede/mes.ts`) | `routes/_authenticated/rede-overview.tsx` |
| R2 | Indicadores do Trimestre | `routes/_authenticated/indicadores-trimestre.tsx`, `components/indicadores-trimestre/*` |
| R3 | IDU | `routes/_authenticated/idu.tsx`, `components/idu/*` |
| R4 | Realizado por unidade | `routes/_authenticated/rede-realizado.tsx` |
| R5 | LTV Estimado | `routes/_authenticated/rede-ltv.tsx` |
| R6 | Headcount | `routes/_authenticated/rede-headcount.tsx` |
| R7 | Revisão final do módulo | diff `b5c44d7..HEAD` |

Revisão por tarefa: subagente somente leitura, contra o contrato.
