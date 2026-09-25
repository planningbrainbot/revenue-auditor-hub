# Plano · Base de clientes, parte A (relacionamento) no DS v2 (módulo 3a)

Branch `feat/ds-v2-migracao-base-cs-20260924` (worktree `planning-brain-ds-v2-base-cs`), base `origin/main` `b5c44d7`.
Contratos: `docs/design/contratos/{painel-cs,nps,auditoria-interna,reforma-tributaria,disparos-whatsapp,base-contatos}.md`. Aprovação: Pedro, 24/09 ("pode seguir conforme suas propostas… é pra padronizar e melhorar TODAS as telas de TODOS os módulos"). Donos: Eliezek (CS, NPS, disparos), Pedro (base de contatos); revisam no PR.

## Regras para toda tarefa (subagente executor)
1. Leia `docs/design/README.md`, `ARQUETIPOS.md`, `DESIGN.md` (§5 gráficos, §10 regras V) e o contrato da tela. O contrato manda.
2. **Não toque:** `supabase/**`, `src/lib/areas.ts`, `src/components/app-sidebar.tsx`, `src/routes/_authenticated/route.tsx`, `src/components/planning/**`, `src/hooks/use-permissions.ts`, qualquer RPC, query SQL, RLS, permissão ou fórmula. As "correções de exibição" do contrato são permitidas: são defeito de tela (chave de mês, fuso, eixo, zero no lugar de ausência), não régua.
3. Mês legível em eixo: formate a partir da string "aaaa-mm", sem `new Date` em UTC.
4. Compose com `@/components/planning` e `@/components/ui/*`; gráfico só com `@/lib/planning/grafico` (um eixo Y por gráfico, ≤3 séries empilhadas, sem ciclar o neutro).
5. Estado de tela na URL (`validateSearch` da rota ou `useFiltroNaUrl`).
6. Portão antes do commit: `NODE_OPTIONS=--max-old-space-size=8192 npx vite build`; `npx tsc --noEmit -p .` sem erro novo (a main tem 7; o de `reforma-tributaria.tsx:79` pode sumir na B4); `npm run design:lint:changed` sem violação.
7. Um commit por tela, `base(<tela>): …`, trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push. Não use `git add -A` fora da pasta do repo; confira `git status` antes.
8. Relate arquivos, o que ficou fora e por quê, portão, hash.

## Tarefas (sequenciais neste worktree)
| # | Tela | Arquivos |
|---|---|---|
| B1 | CS | `routes/_authenticated/painel-cs.tsx`, `components/painel-cs/*` |
| B2 | NPS | `routes/_authenticated/nps.tsx`, `components/nps/nps-painel-tab.tsx` |
| B3 | Auditoria Interna | `routes/_authenticated/auditoria-interna.tsx` |
| B4 | Reforma Tributária | `routes/_authenticated/reforma-tributaria.tsx` |
| B5 | Disparos de WhatsApp | `routes/_authenticated/disparos-whatsapp.tsx`, `components/nps/nps-execucao-tab.tsx`, `components/whatsapp/custos-tab.tsx` |
| B6 | Base de Contatos | `routes/_authenticated/base-contatos.tsx`, `components/nps/{nps-cobertura-tab,nps-plano-acao-tab}.tsx` |
| B7 | Revisão final | diff `b5c44d7..HEAD` |

Revisão por tarefa: subagente somente leitura, contra o contrato.

