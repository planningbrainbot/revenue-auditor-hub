# Medições do design system v2

## T7 · Codemod de cor e fonte (23/09/2026)

Commit base: `4fd5c29` (branch `feat/design-system-v2-20260923`). Script: `scripts/design/codemod-cores.mjs`.

Contagem por token de classe (cada `text-red-600`, `dark:bg-amber-950/40` etc. conta um). "Escopo" é o que o codemod pode tocar; "src inteiro" inclui os arquivos que ele pula de propósito.

| Categoria | Escopo antes | Escopo depois | src antes | src depois | Queda em src |
|---|---:|---:|---:|---:|---:|
| Cor crua de status (emerald/green/teal/lime, red/rose, amber/yellow/orange, sky/cyan/blue) | 1.299 | 0 | 1.372 | 73 | 95% |
| Neutros crus (slate/gray/zinc/neutral/stone) | 187 | 0 | 187 | 0 | 100% |
| Fonte < 12px (`text-[9px]`, `[10px]`, `[11px]`, `rem` < 0,75) | 194 | 0 | 205 | 11 | 95% |
| `dark:` removidos (par redundante depois do token) | — | 529 | — | 529 | — |
| Matizes sem token (violet/purple/indigo/fuchsia/pink): só contados | 110 | 110 | 124 | 124 | 0% |
| Hex literal em `.ts/.tsx`: só contado | 108 | 108 | 236 | 236 | 0% |

Cor crua (status + neutros) em `src`: 1.559 → 73, queda de 95%. Arquivos alterados: 100.

O que sobra em `src` é exclusão deliberada:

| Arquivo | Motivo | Status | Fonte < 12px | Sem token |
|---|---|---:|---:|---:|
| `src/routes/vitrine.tsx` | vitrine mostra o "antes" e é da tarefa de casca | 46 | 7 | 0 |
| `src/components/audit/kpi-card.tsx` | KPI da tarefa de casca em paralelo; migrar para `KpiCard` de `components/planning` | 18 | 1 | 14 |
| `src/components/audit/import-repasses-dialog.tsx` | importa `xlsx` (planilha) | 6 | 0 | 0 |
| `src/components/monetizacao/list-workspace.tsx` | gera HTML exportado (`<!doctype html>`) | 3 | 3 | 0 |

### Top 10 arquivos por troca

| Trocas | `dark:` removidos | Arquivo |
|---:|---:|---|
| 79 | 26 | `src/components/clientes/contratos-clientes.tsx` |
| 68 | 15 | `src/components/nps/nps-execucao-tab.tsx` |
| 68 | 22 | `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` |
| 59 | 0 | `src/components/financeiro-partners/fxc-view.tsx` |
| 57 | 28 | `src/components/page-content/funil-content.tsx` |
| 55 | 25 | `src/components/audit/conciliacao-3-vias-tab.tsx` |
| 47 | 18 | `src/routes/_authenticated/admin.usuarios.tsx` |
| 46 | 15 | `src/components/fila-cella/badges.tsx` |
| 45 | 18 | `src/components/financeiro-partners/pagamentos-view.tsx` |
| 42 | 21 | `src/components/audit/unmapped-tab.tsx` |

### Regras que o codemod aplica

- Matiz → papel: emerald/green/teal/lime → `success`; red/rose → `danger`; amber/yellow/orange → `warning`; sky/cyan/blue → `info`.
- `bg-` claro (50–200) → `bg-<papel>-soft`; forte (300–950) → `bg-<papel>`. `text-` → `text-<papel>`. Borda/ring/outline/divide clara (≤300) → `/40`; forte → sólida. Opacidade existente (`/15`, `/[0.07]`) é preservada.
- Em `dark:` o tom é espelhado (950 faz o papel do 50), porque o token já troca com o tema. Depois disso, `dark:X` some quando a mesma string já tem `X` do mesmo papel e mesma cadeia de variantes.
- Neutros: `text-` 700+ → `text-foreground`, resto → `text-muted-foreground`; `bg-` até 300 → `bg-muted`, 400–600 → `bg-muted-foreground`, 700+ → `bg-card`; bordas → `border-border`.
- Tinta sobre fundo sólido: `text-white` (ou texto do mesmo papel, como `bg-amber-400 text-amber-950`) sobre `bg-<papel>` sólido vira `text-background`, que é escuro no tema escuro e claro no claro. Neutro escuro com `text-white` (`bg-slate-700 text-white`) vira o par invertido `bg-foreground text-background`, senão o card escuro ficaria branco com texto branco no tema claro.
- Fica de fora: `components/ui`, `components/planning`, `lib/planning`, `vitrine.tsx`, casca (`app-sidebar`, `app-shell`, `_authenticated/route.tsx`), `routeTree.gen.ts`, `planning-logo.tsx`, `audit/kpi-card.tsx`, e todo arquivo que importa `jspdf`/`jspdf-autotable`/`xlsx`/`xlsx-js-style` ou tem HTML impresso em string (cor impressa não resolve CSS var).

### Para revisão humana

1. Tinta trocada para `text-background` sobre fundo sólido de status (12): `contratos-clientes.tsx:172,178,184,190`, `fila-cella/badges.tsx:50,51`, `fila-cella/conta-detalhe-sheet.tsx:488`, `fila-cella/log-toques-tab.tsx:106`, `notificacoes/notification-bell.tsx:48`, `_authenticated/reforma-tributaria.tsx:549`, `royalties.$unidadeId.$mes.tsx:1613,1630`. O ideal é virar `StatusBadge` (DESIGN §4).
2. Hover que mudava de tom (`bg-emerald-500 hover:bg-emerald-600`) agora é o mesmo token nos dois estados: o hover deixa de ser visível nesses botões/badges.
3. Matiz usado como categoria, não como status: os papéis de usuário em `admin.usuarios.tsx` (diretor → info, auditor → danger, sócio e sócio regional ambos success); laranja e âmbar passam a ser o mesmo `warning` em `audit/unmapped-tab.tsx` e `conciliacao-3-vias-tab.tsx`. Categoria deveria ir para `StatusBadge tom="neutro"` com a palavra, ou para `CORES_SERIE`.
4. Matizes sem token (124 em `src`): indigo 60, purple 45, violet 15, fuchsia 4. Maiores: `audit/unmapped-tab.tsx` (18 purple), `audit/client-detail-drawer.tsx` (10 indigo), `fila-cella/badges.tsx` (10), `royalties.$unidadeId.$mes.tsx` (12), `admin.usuarios.tsx` (8 violet).
5. Hex restantes no escopo (108), por arquivo: `financeiro-partners/fxc-view.tsx` 15, `_authenticated/simulador-caixa.tsx` 15, `audit/overview-tab.tsx` 11, `roas/trend-tab.tsx` 10, `audit/cac-tab.tsx` 9, `financeiro-partners/dre-realizada-view.tsx` 6, `nps/nps-painel-tab.tsx` 6, `monetizacao/dashboard.tsx` 5, `roas/by-unit-tab.tsx` 5, `roas/overview-tab.tsx` 5, `_authenticated/auditoria-interna.tsx` 4, `routes/auth.tsx` 4, `audit/de-para-mensal-tab.tsx` 3, `painel-cs/tratativas-tab.tsx` 3, e 1–2 em `audit/client-detail-drawer.tsx`, `audit/royalties-tab.tsx`, `audit/unit-detail-drawer.tsx`, `_authenticated/reforma-tributaria.tsx`.
6. `bg-white` fixo continua em telas como `fxc-view.tsx` (fora do escopo desta regra: não é cor de matiz).

### Reexecução

```sh
node scripts/design/codemod-cores.mjs --dry    # relata antes/depois sem gravar
node scripts/design/codemod-cores.mjs          # aplica em src/
node scripts/design/codemod-cores.mjs --json   # mesmo relatório em JSON (aplica, a menos que venha com --dry)
```

Idempotente: a segunda execução sobre o resultado relata 0 arquivos alterados. Uso previsto: depois de integrar com a `main`, rodar de novo em vez de resolver conflito de classe à mão.

## Lint — contagens

Gerada por `npm run design:lint -- --baseline`, que também regrava `docs/design/lint-baseline.json` (a catraca). Contagem no `src/` inteiro do commit indicado (a árvore commitada, não o que está sem commit), uma linha por gravação. Regras de ERRO: V1–V4, V16, V18–V21; o resto é aviso. IDs de `DESIGN.md` §10; `V3-matiz` é a parte de V3 sem token equivalente (indigo/purple/violet/fuchsia/pink). V2 conta só `.tsx`, fora de comentário, de seletor de atributo e da allowlist; por isso é menor que o "hex" do codemod, que conta `.ts` também. A vitrine fica fora de V2–V4 e V21 porque reproduz o "antes" de propósito.

| Data | Commit | V1 | V2 | V3 | V4 | V5 | V6 | V3-matiz | V13 | V15 | V16 | V17 | V18 | V19 | V20 | V21 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-09-23 | `a4bd23e` | 0 | 75 | 27 | 4 | 24 | 20 | 124 | 0 | 0 | 0 | 6 | 0 | 0 |
| 2026-09-23 | T11 (pai `86eb236`) | 0 | 0 | 0 | 0 | 3 | 20 | 78 | 0 | 0 | 0 | 6 | 0 | 0 |
| 2026-09-23 | `3360bfa` | 0 | 0 | 0 | 0 | 3 | 20 | 78 | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 |
| 2026-09-24 | `5905fb0` | 0 | 0 | 0 | 0 | 3 | 19 | 66 | 0 | 0 | 0 | 6 | 0 | 0 | 0 | 0 |
