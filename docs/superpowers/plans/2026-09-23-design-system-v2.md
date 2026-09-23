# Plano · Design System v2 do Planning Brain

Spec: `docs/superpowers/specs/2026-09-23-design-system-v2-design.md` (autoridade). Branch `feat/design-system-v2-20260923`, worktree `PM Work/execution/planning-brain-ds-v2-20260923`. Sem push, merge ou deploy.

Regras para todo executor:
- Leia a spec inteira antes de começar. Não mude regra de negócio, query, RLS, permissão, nem texto de decisão comentado no código.
- Build: `NODE_OPTIONS=--max-old-space-size=8192 npx vite build` tem que passar ao fim da tarefa (baseline passou).
- Um commit por tarefa, mensagem `design(v2): <o que>` em português, terminando com `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Não use `git stash`. Não rode nada contra Supabase de produção.
- Comentários no estilo do repo: português, explicam o porquê, sem narrar o óbvio.

## Contrato de API (vale para todas as tarefas)

`src/components/planning/` (exportado por `index.ts`):

```ts
PageHeader({ area?: string /* slug de areas.ts; se ausente, deduz da rota via areaDoCaminho */,
  titulo: string /* nome curto da tela */, pergunta?: string /* se houver, vira o <h1> e titulo vira eyebrow */,
  descricao?: ReactNode /* universo medido: perímetro · período · unidade de contagem */,
  procedencia?: { fonte: string; atualizadoEm?: string | Date | null; regua?: string },
  acoes?: ReactNode, filtros?: ReactNode, children?: ReactNode })
Secao({ titulo: string /* pergunta */, descricao?: ReactNode, acoes?: ReactNode, children })
KpiCard({ rotulo: string, valor: ReactNode, unidade?: string,
  delta?: { valor: number; rotulo?: string; sentido?: "maior-melhor" | "menor-melhor" },
  meta?: { valor: ReactNode; rotulo?: string },
  estado?: "ok" | "parcial" | "nao-apurado" | "indisponivel" | "sem-acesso",
  procedencia?: { fonte: string; atualizadoEm?: string | Date | null },
  abrir?: { href?: string; onClick?: () => void; rotulo?: string } /* drill-down: card inteiro clicável */,
  area?: string })
KpiGrade({ children, colunas?: 2 | 3 | 4 | 6 })
StatusBadge({ tom: "sucesso" | "atencao" | "perigo" | "info" | "neutro", children, icone?: LucideIcon | false })
EstadoVazio({ titulo: string, descricao?: ReactNode, total?: number /* "Nenhuma conta com esses filtros. N no total." */, acao?: ReactNode })
EstadoErro({ titulo?: string, detalhe?: ReactNode, tentarNovamente?: () => void })
EstadoSemAcesso({ oQueFalta: string })
Carregando({ variante: "kpis" | "tabela" | "grafico" | "pagina", linhas?: number })
Procedencia({ fonte: string, atualizadoEm?: string | Date | null, regua?: string })
Degrau({ sentido: "sobe" | "desce" | "estavel", className? }) // seta em degrau do manual
AnelArea({ area: string, icone: LucideIcon, tamanho?: "sm" | "md" })
GradeCirculos({ className? }) // textura de fundo SVG, 6–8% de opacidade
BarraFiltros({ children, aoLimpar?: () => void })
```

`src/lib/planning/`:
- `cores-area.ts`: `corDaArea(slug) → "var(--area-<slug>)"` e lista de slugs.
- `grafico.ts`: `CORES_SERIE` (array de `var(--chart-n)`), `eixoProps`, `gradeProps`, `tooltipProps`, `legendaProps` para Recharts, todos com `var(--…)`.
- `filtro-url.ts`: hook `useFiltroNaUrl(chave, padrao)` sobre o search do TanStack Router (N7).

Tokens CSS novos (além dos do shadcn): `--primary-text`, `--success`, `--success-soft`, `--warning`, `--warning-soft`, `--danger`, `--danger-soft`, `--info`, `--info-soft`, `--surface-elevated`, `--area-rede`, `--area-clientes`, `--area-receita`, `--area-people`, `--area-monetizacao`, `--area-broker`, `--area-minha_unidade`, `--area-estrategia`, `--area-admin`, `--chart-1..6`, `--font-sans`, `--ease-planning`, e utilitários Tailwind correspondentes via `@theme inline` (`text-success`, `bg-success-soft`, `text-primary-text`, etc.).

## Tarefas

### T1 · Vitrine e captura (ANTES)
Arquivos: `src/routes/vitrine.tsx` (rota pública fora de `_authenticated`, `ssr: false`, `beforeLoad` que lança `notFound()` quando `!import.meta.env.DEV`), `scripts/design/capturar.mjs`.
A vitrine usa SÓ componentes que já existem hoje (`components/ui/*`, `AppShell`, primitivos de `sidebar`), com dado sintético: botões (todas as variantes), inputs, select, tabs, badges, tabela com 8 linhas, cards, um gráfico Recharts de barras e um de linha no estilo das telas atuais (copie o estilo de `rede-ltv.tsx`, inclusive o `hsl(var(--…))`, para a foto mostrar o defeito), estados de carregamento como estão hoje, e uma réplica estática da lateral usando `AREAS` de `lib/areas.ts` (todos os itens visíveis, sem permissão). Seções com âncora (`#casca`, `#controles`, `#dados`, `#graficos`, `#estados`) para capturar separado.
`capturar.mjs`: sobe `vite dev` numa porta livre, espera responder, usa Chrome headless (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --screenshot`, janela 1440×900 e página inteira, temas escuro e claro via `?tema=claro` que a vitrine aplica) e grava em `docs/design/capturas/<rotulo>/`. Rodar com rótulo `antes` e commitar as imagens.
Aceite: `/vitrine` abre em dev; imagens `antes` existem; build de produção não inclui a vitrine acessível.

### T2 · Fundação
Arquivos: `src/styles.css`, `src/routes/__root.tsx`.
Tokens v2 exatamente como a tabela da spec §2.4 (escuro padrão e `:root` claro). Fonte: `@font-face` "Bw Glenn Sans" apontando para `/fonts/BwGlennSans-*.woff2` (arquivos ausentes: o navegador cai para a próxima), Fira Sans via Google Fonts 400/500/600/700/900 substituindo Poppins; `font-feature-settings` de algarismos tabulares num utilitário `.num` e no `body` para `td`/KPIs. `lang="pt-BR"`. Montar `<Toaster />` (de `components/ui/sonner`) no root, com posição e tema coerentes. 404 e página de erro em português com o novo visual (usar `EstadoErro` depois que existir — nesta tarefa, texto em PT e classes de token). `@media (prefers-reduced-motion)`. Comentário de cabeçalho no CSS dizendo por que cada grupo de token existe (o comentário atual sobre `#2EE5A8` está errado; corrigir).
Aceite: build passa; `grep -c "hsl(" src/styles.css` = 0; contraste da tabela confere.

### T3 · Gráficos
Arquivos: os 16 arquivos com `hsl(var(--`, `src/lib/planning/grafico.ts`, `src/components/ui/chart.tsx` se aplicável.
Trocar todo `hsl(var(--x))` por `var(--x)`; quando for cor de série, usar `CORES_SERIE`/`var(--chart-n)`. Criar `grafico.ts`. Rodar o validador da skill `dataviz` (leia `~/.claude/skills` ou o SKILL da skill dataviz antes) na paleta clara e escura e registrar o resultado em comentário.
Aceite: `grep -rn "hsl(var(--" src` = 0; build passa.

### T4 · Primitivos
Arquivos: `src/components/ui/{button,card,badge,table,tabs,input,select,textarea,dialog,sheet,tooltip,skeleton,sidebar,dropdown-menu,popover,checkbox,switch}.tsx`.
Aplicar spec §2.5: raios, foco `ring` 2px sólido com offset, bordas de controle em `input`, hover de 120ms. Button: variantes `default` (verde, texto `#04110b`, hover clareia + leve elevação), `secondary`, `outline`, `ghost`, `destructive`, `link` (usa `primary-text`); tamanho mínimo 32px de altura. Table: cabeçalho 12px maiúsculo `muted-foreground`, linhas com hover `muted/40`, números à direita com `tabular-nums`, cabeçalho grudável opcional. Tabs: sublinhado de 2px na cor primária em vez de pílula. Badge: variantes `sucesso/atencao/perigo/info/neutro` com fundo `*-soft`. Sidebar: item ativo com filete de 3px à esquerda na `--area-atual` (variável que a casca define) e fundo sutil; rótulo de grupo 12px.
Não mudar a API pública (props/variantes existentes continuam válidas); só acrescentar.
Aceite: build passa; telas continuam compilando sem ajuste.

### T5 · Componentes Planning
Arquivos: `src/components/planning/*`, `src/lib/planning/cores-area.ts`, `src/lib/planning/filtro-url.ts`.
Implementar o contrato de API acima. `KpiCard`: rótulo 12px maiúsculo, valor 30px/700 `tabular-nums`, delta com `Degrau` e cor pelo sentido, meta ao lado do realizado (N13), linha de procedência discreta (N3), estado ≠ valor (N4: "não apurado" mostra "—" + motivo, nunca 0), card inteiro clicável com filete no hover quando `abrir` existe (N2). `PageHeader`: eyebrow com `AnelArea` pequeno + nome da área + filete, `<h1>` 24px/700 (pergunta, se houver), descrição 14px muted, procedência à direita, filtros abaixo numa `BarraFiltros`. `GradeCirculos` em SVG inline (círculos de contorno como os patterns do manual). `Degrau` em SVG (reta → degrau → diagonal com ponta). Acrescentar tudo na vitrine (seção `#planning`) e os cinco arquétipos em `/vitrine#arquetipos` com dado sintético realista da Planning (unidades, contas, royalties, fila de ligação), cada um seguindo `docs/design/ARQUETIPOS.md` se já existir, senão a spec §2.7.
Aceite: build passa; vitrine mostra todos; nenhum hex nem cor crua dentro de `components/planning`.

### T6 · Casca
Arquivos: `src/components/app-sidebar.tsx`, `src/components/app-shell.tsx`, `src/routes/_authenticated/route.tsx`, `src/components/planning-logo.tsx` (só se precisar).
Preservar TODA a lógica de permissão, área, grifo e comentários. Mudar a apresentação: seletor de área com `AnelArea` por área e o nome; itens com filete de área no ativo; define `--area-atual` no container a partir da área da rota. Cabeçalho do topo: trilha "Área › Página" (a partir de `areas.ts`, sem dado novo), à direita o que já existe (e-mail/papel, sino, tema, sair) com o novo visual. `AppShell` passa a renderizar `PageHeader` (título → `titulo`, subtitle → `descricao`, headerExtra → `acoes`), mantendo `ValidationBanner` e `DataFreshnessBar`. Espelhar a casca na vitrine.
Aceite: build passa; props de `AppShell` inalteradas; nenhuma regra de permissão alterada (diff de lógica = 0, conferir).

### T7 · Codemod de cor e fonte
Arquivos: `scripts/design/codemod-cores.mjs` + a execução dele em `src/`.
Idempotente e reexecutável. Mapeamentos (text/bg/border/ring/fill/stroke, com e sem `dark:`): `emerald|green-*` → `success`, `red|rose-*` → `danger`, `amber|yellow|orange-*` → `warning`, `sky|cyan|blue-*` → `info`, `slate|gray|zinc|neutral-*` → `muted-foreground`/`muted`/`border` conforme o prefixo; tons claros (50–200) em `bg-` viram `*-soft`; remove o par `dark:` redundante quando os dois lados viram o mesmo token. `text-[9px]|[10px]|[11px]` → `text-xs`. Não tocar `components/ui`, `components/planning`, arquivos de e-mail/PDF (`jspdf`, templates de e-mail: detectar e pular, cor impressa não usa CSS var). Escreve relatório com contagem antes/depois em `docs/design/medicoes.md`.
Aceite: build passa; queda ≥80% em cor crua e fonte <12px; diff revisado por amostragem.

### T8 · Cabeçalhos
Arquivos: rotas em `src/routes/_authenticated/*` que desenham o próprio título (não usam `AppShell`).
Trocar o bloco de título ad-hoc por `PageHeader` com `titulo` e `descricao` equivalentes ao texto atual; não inventar pergunta onde a tela não tem (a pergunta é do dono do módulo — deixar `// TODO(design): pergunta da tela — ver docs/design/NAVEGACAO.md N1` só se o arquivo não tiver ainda). Troca "Carregando…" solto por `<Carregando variante=… />` onde for bloco de página. Não mexer em lógica.
Aceite: build passa; `grep` de h1 ad-hoc nas rotas cai para ≤3 justificados.

### T9 · Portão e documentação no repo
Arquivos: `scripts/design/lint.mjs`, `package.json` (script `design:lint`), `AGENTS.md`, `.github/pull_request_template.md`, `DECISIONS.md` (nova entrada no formato do topo do arquivo).
Lint: falha em `hsl(var(` em qualquer lugar; hex em `.tsx` fora de allowlist (e-mail/PDF/logo); cor crua de status fora de `components/ui|planning`; `text-[<12px]`; `confirm(` nativo (aviso); rota nova sem `PageHeader`/`AppShell` (aviso). Modo `--baseline` grava contagens em `docs/design/medicoes.md`. `AGENTS.md`: bloco "Antes de mexer em tela" apontando a ordem de leitura de `docs/design/README.md` e a definição de pronto.
Aceite: `npm run design:lint` roda e relata; build passa.

### T10 · Captura DEPOIS e medições
Rodar `capturar.mjs` com rótulo `depois`, gerar `docs/design/capturas/comparativo.md` com antes/depois lado a lado, atualizar `docs/design/medicoes.md`.
