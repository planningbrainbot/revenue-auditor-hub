# Ledger · migração das telas do Ops para o DS v2

Worktree `PM Work/execution/planning-brain-ds-v2-migracao`, branch `feat/ds-v2-migracao-monetizacao-20260923`, saída de `origin/main` `b5c44d7` (PR #14 do DS v2 já na main). Método: contrato → "contrato ok" → plano → um subagente por tarefa → revisão por tarefa → revisão final → portão → PR. Sem push, merge ou deploy sem o Pedro perguntar.

## Linha de base do portão (main `b5c44d7`, 23/09)
- `design:lint`: **reprovado já na main**. V4 = 2 contra baseline 0 (`idu/idu-metas-padrao.tsx:173`, `idu/idu-view.tsx:405`, `text-[10px]`, módulo 2, do Eliezek). V6 = 21 contra 20 (aviso).
- `tsc --noEmit`: 7 erros, nenhum na Monetização (`integracoes-status.functions.ts`, `admin.integracoes.tsx` ×4, `rede-overview.tsx:1076`, `reforma-tributaria.tsx:79`).
- `npm run dev`: sem `.env` local no worktree; precisa das variáveis do projeto para rodar com login.

## Módulos (estado em 24/09)
Depois do "é pra padronizar e melhorar TODAS as telas de TODOS os módulos" (Pedro, 24/09), os módulos correram em paralelo, um worktree por módulo, todos saídos de `b5c44d7`. Fila viva do orquestrador: `fila.md`.

| # | Módulo | Worktree / branch | Contratos | Código | Revisão final | Capturas | PR |
|---|---|---|---|---|---|---|---|
| 1 | Monetização + `/clientes` (3b) | `migracao` · `feat/ds-v2-migracao-monetizacao-20260923` | 10 + `clientes.md`, aprovados pelas propostas | T0–T8, C1–C3 | T9 aprovada no código (12 menores) | pendente | não aberto |
| 2 | Rede | `rede` · `feat/ds-v2-migracao-rede-20260924` | 6 | R1–R6 | R7 aprovada | pendente | não aberto |
| 3 | Base de clientes (relacionamento) | `base-cs` · `feat/ds-v2-migracao-base-cs-20260924` | 6 | B1–B6 | B7 aprovada | pendente | não aberto |
| 4 | Receita e Repasses | `receita` · `feat/ds-v2-migracao-receita-20260924` | 9 | RR1–RR7 | RR8 aprovada | pendente | não aberto |
| 5 | Planning People (+ Broker, Minha Unidade) | `people` · `feat/ds-v2-migracao-people-20260924` | 16 | P1–P5 | P6 aprovada | pendente | não aberto |
| 6 | Administração | `admin` · `feat/ds-v2-migracao-admin-20260924` | 13 | A1–A4 | A5 aprovada | pendente | não aberto |

Capturas: worktree `planning-brain-ds-v2-antes` (detached em `b5c44d7`) para o "antes"; `capturar-modulo.sh` para cada branch. Destino `docs/design/capturas/<modulo>/{antes,depois}`.

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
| T1 | Moldura comum | `612aa52`, `ddaf071` | aprovada com correções |
| T2 | Operação diária | `54d8eba`, `ce75833` | aprovada com correções |
| T3 | Follow Day | `bb83e69`, `8d68cad` | aprovada com correções |
| T4 | Temporal e previsão | `de18ba6` | aprovada |
| T5 | Projetado × realizado | `5c2e7f1`, `d483b29` | aprovada |
| T6 | Capacidade e alocação | `30ef448`, `ea1a65c` (T4/T6) | aprovada com correções |
| T7 | Funil + Distribuição | `9262ed0`, `94d015f` | aprovada |
| T8 | Pessoas + Abordagens | `96d801d`, `eecbc2c`, `94aea33` | aprovada |
| C1 | `/clientes`: moldura, Base, URL | `d6dba22`, `ceef80e`, `9968848` | reprovada → corrigida |
| C2 | `/clientes`: Produtos e listas, Recon | `d5be87f` … `ca3803a` | 1 bloqueante → corrigido |
| C3 | `/clientes`: Validar origem, Contratos, Entenda | `2e7481c`, `863f6dd`, `dc3cd17` | aprovada |
| T9 | Revisão final do módulo | — | aprovada no código; DECISIONS de `/clientes` escrito; menores em correção |
