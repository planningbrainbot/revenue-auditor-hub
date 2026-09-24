# Ledger · migração das telas do Ops para o DS v2

Worktree `PM Work/execution/planning-brain-ds-v2-migracao`, branch `feat/ds-v2-migracao-monetizacao-20260923`, saída de `origin/main` `b5c44d7` (PR #14 do DS v2 já na main). Método: contrato → "contrato ok" → plano → um subagente por tarefa → revisão por tarefa → revisão final → portão → PR. Sem push, merge ou deploy sem o Pedro perguntar.

## Linha de base do portão (main `b5c44d7`, 23/09)
- `design:lint`: **reprovado já na main**. V4 = 2 contra baseline 0 (`idu/idu-metas-padrao.tsx:173`, `idu/idu-view.tsx:405`, `text-[10px]`, módulo 2, do Eliezek). V6 = 21 contra 20 (aviso).
- `tsc --noEmit`: 7 erros, nenhum na Monetização (`integracoes-status.functions.ts`, `admin.integracoes.tsx` ×4, `rede-overview.tsx:1076`, `reforma-tributaria.tsx:79`).
- `npm run dev`: sem `.env` local no worktree; precisa das variáveis do projeto para rodar com login.

## Módulos
| # | Módulo | Contratos | Contrato ok | Código | Portão | Capturas | PR |
|---|---|---|---|---|---|---|---|
| 1 | Monetização (Fila Cella aposentada) | 11 escritos em 23/09 | **ok 24/09** (propostas aprovadas em bloco) | plano `docs/superpowers/plans/2026-09-24-ds-v2-migracao-monetizacao.md`; T0 aposentar Fila Cella `fdd77a1`; V4 IDU `1bb0341` | — | — | — |
| 2 | Rede | — | — | — | — | — | — |
| 3 | Base de clientes | — | — | — | — | — | — |
| 4 | Receita e Repasses | — | — | — | — | — | — |
| 5 | Planning People | — | — | — | — | — | — |
| 6 | Administração | — | — | — | — | — | — |

## Módulo 1 · decisões pedidas ao Pedro em 23/09
Perguntas (N1) das 10 telas · Z0 padrão do responsável · Z1 carga parada · Z2 negócio sem histórico · Z3 receita parcial · Z4 disponíveis sem base · Z5 capacidade sem plano · K1 KR1 mês × semana · F1 tirar a faixa de abas · F5 Follow Day (ordem e ação) · F6 Fila Cella (ação na linha e ordem do Sheet) · nome único do evento `started` · conflitos 5.2, 5.7, 5.8 (proposta: não fundir) · captura da Fila Cella com dado sintético · V4 do IDU na catraca.

## Medições feitas (só leitura)
- 23/09 20h: `ops.v_fila_cella` 0 linhas; `fila_cella_toques` 0; `fila_cella_ciclos` 0 (projeto `npknehhyyzelmrbbxvtu`).
- 23/09 20h: `ops.monetizacao_deals` 178, 0 sem histórico; última carga 23/09 20h20; 1 plano; 4 registros (todos `roteiro`).

## Pendências fora do módulo
- Growth segregado (outro app, `brain-web`, casca própria): casca única é decisão do Eliezek + Mika. Anotado pelo Pedro em 24/09.
- `KpiCard` compacto para drawers: era para a ficha da Fila Cella, que saiu. Entra no primeiro módulo que tiver drawer com KPI.
- Build exige `NODE_OPTIONS=--max-old-space-size=8192` (o heap padrão estoura já na main).

## Tarefas do módulo 1
| # | Tarefa | Commit | Revisão |
|---|---|---|---|
| T0 | Fila Cella aposentada | `fdd77a1` | orquestrador |
