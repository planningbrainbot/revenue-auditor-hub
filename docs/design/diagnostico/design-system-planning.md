# Auditoria — Planning Design System

**Alvo:** `/Users/pluca/Desktop/AI Projects/PM Work/planning-design-system`
**Data da auditoria:** 2026-09-23 · leitura apenas, nenhum arquivo do projeto foi alterado.
**Escopo extra lido:** `monetizacao/marca/heranca-planning/` (PROCEDENCIA.md + SVGs), `PM Work/_sistema/brand/` (só listagem: é Recon/Conciliador, não Planning), `planning-mkt-template/` (sem material de marca Planning), apps `PM Work/execution/planning-brain-*` (para medir a adoção). Não foram lidos `Auditoria Tributária Planning /Modelo de trabalho/` nem `Pedro Luca Personal Project/`.

---

## 0. Procedência e datas

| Item | Valor |
|---|---|
| Criação dos arquivos | **2026-07-21**, entre 10:49 (assets) e 11:25 (curadoria 21st). Tudo em ~36 minutos, numa sessão só |
| Última modificação | 2026-07-21 11:25 (`docs/curadoria-21st.html`). Nada foi tocado depois |
| Git | não tem repositório próprio. Está no repo `PM Work`, entrou em **um único commit**: `e1aea87` de 2026-08-21 18:35, Pedro Luca (`pedroluca-prog`), "Migra recon/ e esteira/ do Google Drive para o repo". Não há histórico de evolução |
| Autor | Pedro Luca (commit). A fonte da marca é a pasta `IDV \| Planning`, owner **mikael.ribeiro@planning.com.br** (citado em `brand-dna.md`); o deck de posicionamento é "ENREDO, out/2020" |
| Versão | `1.0.0` em `package.json` e `design-tokens.json` |

---

## 1. Inventário

### 1.1 Arquivos
```
README.md, package.json
foundations/  brand-dna.md · design-tokens.json (fonte da verdade) · dataviz-guide.md · patterns.md · 21st-curation.md
css/          planning-tokens.css (vars shadcn HSL, :root + .dark) · planning-fonts.css (@font-face)
tailwind/     tailwind.theme.cjs (theme.extend, Tailwind v3)
components/   ui/ (19 arquivos + index.ts + lib/utils.ts) · charts/chart.tsx · patterns/states.tsx
docs/         planning-design-system.html (doc viva, toggle claro/escuro) · curadoria-21st.html
examples/     index.css · tailwind.config.cjs
fonts/        só README.md — NENHUM .woff2
assets/       logo/ (5 PNG) · patterns/ (2 PNG) · grafismos/ (1 PNG) · swatches/ (3 .ase)
```

### 1.2 Cores — marca (de `.ase` + `brand-dna.md`)
| Papel | Hex | RGB | Pantone | CMYK |
|---|---|---|---|---|
| Verde — PRIMÁRIA | `#0AE18C` | 10,225,140 | 352 C | 60/0/55/0 |
| Laranja | `#FA6914` | 250,105,20 | 1585 C | 0/70/90/0 |
| Ciano | `#14C8FA` | 20,200,250 | 311 C | 65/0/0/0 |
| Roxo | `#962DFF` | 150,45,255 | 265 C | 65/70/0/0 |
| Lima | `#C3E61E` | 195,230,30 | 381 C | 25/0/85/0 |
| Preto | `#000000` | — | Neutral Black C | — |
| Cinza escuro | `#646464` | — | Cool Gray 10 C | K70 |
| Cinza claro | `#CDCDCD` | — | Cool Gray 2 C | K30 |
| Branco | `#FFFFFF` | — | — | — |
| Gradiente-assinatura | `linear-gradient(90deg, #14C8FA, #0AE18C)` | ciano → verde | | |
| Vermelho de erro (**inferido, não é marca**) | `#EA0B25` | | | |

Nota: o HSL `156 91% 46%` usado nos tokens arredonda para `#0BE08B`, não `#0AE18C` (diferença de 1 no último dígito).

### 1.3 Cores — rampa neutra (cool gray derivada, não oficial)
0 `#FFFFFF` · 25 `#FBFBFC` · 50 `#F6F7F9` · 100 `#EEF0F3` · 200 `#E2E5EA` · 300 `#CDD3DB` · 400 `#A7AEBB` · 500 `#7B8492` · 600 `#5B6472` · 700 `#414A57` · 800 `#2A313C` · 900 `#171C24` · 950 `#0E1217` · 1000 `#000000`

### 1.4 Tokens de tema (shadcn)
| Token | Claro | Escuro |
|---|---|---|
| background | `#F6F7F9` | `#0A0D12` |
| foreground | `#0E1217` | `#F2F4F7` |
| card / popover | `#FFFFFF` / `#FFFFFF` | `#12161D` / `#171C25` |
| primary / -fg | `#0AE18C` / `#06120C` | `#0AE18C` / `#06120C` |
| secondary / -fg | `#EEF0F3` / `#2A313C` | `#1B212B` / `#E6E9EE` |
| muted / -fg | `#EEF0F3` / `#5B6472` | `#1B212B` / `#98A2B2` |
| accent / -fg | `#E9FAF2` / `#03613D` | `#14231C` / `#7CF2C6` |
| destructive / -fg | `#EA0B25` / `#FFFFFF` | idem |
| border / input | `#E2E5EA` / `#E2E5EA` | `#272E39` / `#2A313D` |
| ring | `#0AE18C` | `#0AE18C` |

Status (fill · fg · texto claro · texto escuro · subtle claro · subtle escuro):
- positive `#0AE18C` · `#0A0A0A` · `#03784A` · `#0AE18C` · `#F0FAF6` · `#093423`
- warning `#FA6914` · `#0A0A0A` · `#BB4601` · `#FA6914` · `#FAF3EF` · `#351908`
- info `#14C8FA` · `#0A0A0A` · `#007393` · `#14C8FA` · `#EFF8FA` · `#082B35`
- negative `#EA0B25` · `#FFFFFF` · `#D70921` · `#F63C52` · `#FAF0F1` · `#340A0F`

Data-viz categórica (ordem fixa verde→laranja→roxo→ciano→vermelho):
- claro `#009E5F #FA6914 #962DFF #0095BE #EA0B25`
- escuro `#0FA46E #E85E14 #9B3BFF #1B93BD #F04154`
- sequencial verde 100→700 `#9AFAD4 #0AEC93 #09CF80 #08B26E #079A60 #06804F #056740`
- sequencial ciano (json) `#BDEFFE #6DDDFC #05C3F8 #05A8D6 #0492B9 #03799A #03617B` — **diverge** do `SEQUENTIAL.cyan` em `chart.tsx` (`#B9EEFE #37D2FD #12BFF3 #0FA0CC #0C82A6 #096580 #06485C`). Duas fontes da verdade.
- divergente: `#FA6914` ↔ neutro (`#EEF0F3` claro / `#242B34` escuro) ↔ `#0095BE`

### 1.5 Tipografia
- **Oficial:** Bw Glenn Sans (foundry Branding with Type), família única, pesos oficiais **Hairline 200 · Regular 400 · Bold 700 · Black 900**. Recurso de estilo: misturar pesos na mesma frase ("Building your company's future. **Today.**").
- **Arquivos de fonte: nenhum no disco.** `fonts/` só tem README; `planning-fonts.css` aponta para `BwGlennSans-{Hairline,Regular,Bold,Black}.woff2` que não existem → todo app cai no fallback.
- Fallback declarado: **Inter** 400/500/600/700 (Google Fonts). Mono: IBM Plex Mono (utilitário, não é marca).
- Stack: `"Bw Glenn Sans", Inter, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.
- Escala (size / line-height / tracking): xs 12/16 · sm 14/20 · base 16/24 · lg 18/26.4 −0.006em · xl 20/25.6 −0.01em · 2xl 24/30.4 −0.014em · 3xl 30/35.2 −0.018em · 4xl 36/40 −0.02em · 5xl 48/50.4 −0.022em · 6xl 60/62.4 −0.024em · 7xl 72/73.6 −0.026em. Existe no JSON mas **não é exportada** para o tailwind.theme (usa a escala padrão do Tailwind).
- Letter-spacing: tighter −0.024em · tight −0.014em · normal 0 · wide 0.04em · widest 0.12em.
- Deck ENREDO usa Fazeta Black Display — explicitamente fora do DS.

### 1.6 Demais tokens
- **Espaçamento:** grid 4px, 0→32 (= escala Tailwind padrão; nada próprio).
- **Raio:** `--radius` 0.625rem (10px); sm 6 · md 8 · lg 10 · xl 14 · 2xl 20 · full. No Tailwind: lg=radius, md=−2, sm=−4, xl=+4.
- **Sombra:** xs/sm/md/lg/xl/focus, versões claro (tinta `rgba(14,18,23,…)`) e escuro (preto 0.40–0.70); focus = `0 0 0 3px rgba(10,225,140,.35/.45)`.
- **Motion:** instant 0 · fast 120ms · base 200ms · slow 320ms · slower 480ms; easings standard `cubic-bezier(0.2,0,0,1)`, emphasized `(0.16,1,0.3,1)`, decelerate, accelerate. Keyframes accordion + fade-in.
- **z-index:** dropdown 1000 · sticky 1100 · overlay 1200 · modal 1300 · popover 1400 · toast 1500 · tooltip 1600 (só no JSON; não chega ao Tailwind).
- **Breakpoints:** 640/768/1024/1280/1536 (padrão Tailwind).

### 1.7 Componentes documentados (22)
`ui/`: Button (default/secondary/outline/ghost/destructive/link; sm/default/lg/icon; `loading`), Badge (default/secondary/outline + positive/warning/info/negative em soft e solid), Card, Input, Textarea, Label, Select, Tabs, Table (células `.num` tabulares à direita), Dialog, Tooltip, DropdownMenu, Switch, Separator, Skeleton, Sonner (toast), **StatTile** (KPI com delta ícone+cor+sinal, `intent="inverse"`, slot de sparkline), **PlanningMark** (sunburst SVG reconstruído), **Sidebar** (Sidebar/Header/Nav/Item, rail verde no ativo, `collapsed`).
`charts/chart.tsx`: `usePlanningPalette`, `ChartContainer`, `ChartLegend`, `ChartTooltip` (Recharts), `SEQUENTIAL`. Nenhum gráfico pronto.
`patterns/states.tsx`: `EmptyState`, `ErrorState`.
`lib/utils.ts`: `cn`, `formatNumber`, `formatCurrency` (BRL), `formatDelta`.

### 1.8 Distribuição
- `package.json` `@planning/design-system` 1.0.0, **`private: true`, UNLICENSED**, sem build, sem `main`, `exports` apontando para `.ts`/`.json`/`.css` crus. Nunca publicado (nem npm privado, nem registry shadcn, nem workspace).
- Preset Tailwind: **sim, mas v3** (`theme.extend` em CJS, `darkMode: ["class"]`, `tailwindcss-animate`).
- CSS vars: **sim, no formato de canal HSL do shadcn v3** (`--primary: 156 91% 46%`, consumido como `hsl(var(--primary))`).
- Compatível com shadcn: nomes sim (v3 / estilo "default"); faltam os tokens `--sidebar-*` e o formato `@theme inline` do shadcn atual (Tailwind v4, valores completos em hex/oklch).
- Adoção = copiar pastas (README "Adoção em 4 passos").

---

## 2. Identidade Planning (o que respeitar)

### Logo
- **Assinatura:** símbolo sunburst (explosão radial de traços afilados, núcleo circular vazado) em **gradiente ciano `#14C8FA` → verde `#0AE18C`** + wordmark **"Planning"** — P maiúsculo, resto em caixa baixa, **"i" sem pingo** (o `brand-dna.md` diz "caixa baixa"; o arquivo oficial tem P maiúsculo, conferido em `heranca-planning/PROCEDENCIA.md` §9 e no render).
- Lockup principal: símbolo à esquerda, wordmark à direita, alinhados pela altura-x. Área de proteção por unidades circulares. Não distorcer, não recolorir o símbolo fora do gradiente, não pôr lockup colorido em fundo de baixo contraste; mono sobre foto/cor.
- **Arquivos no DS** (`assets/logo/`, todos PNG 6580×2878 exceto o ícone):
  | Arquivo | Conteúdo real | Fundo |
  |---|---|---|
  | `planning-logo-color-light.png` | lockup, wordmark preta | **branco opaco embutido** |
  | `planning-logo-color-dark.png` | lockup, wordmark branca | **preto opaco embutido** |
  | `planning-logo-mono-black.png` | lockup todo preto | transparente |
  | `planning-logo-mono-white.png` | lockup todo branco | transparente |
  | `planning-mark-icon.png` (1645×720) | **o lockup inteiro, não o ícone** — o nome mente | transparente |
- **Não existe símbolo isolado oficial, nem vetor, dentro do DS.** O `PlanningMark` (brand-mark.tsx) é uma **reconstrução simplificada** (24 raios iguais, pontas redondas; o oficial tem ~32 cunhas de espessura variável, pontas retas, raios que terminam na borda). E tem bug: gradiente em `objectBoundingBox` sobre `<line>` → raios horizontais/verticais não pintam.
- **Vetores que existem fora do DS:**
  - `monetizacao/marca/heranca-planning/` (2026-09-09): `planning-simbolo-oficial(-gradiente).svg`, `planning-wordmark.svg`, `planning-lockup(-gradiente).svg` **traçados por potrace do PNG oficial**; `planning-simbolo(-gradiente).svg` reconstruídos (uso ≤64px). Documentado em `PROCEDENCIA.md`, que afirma "vetor original não existe neste disco".
  - **Mas existe:** `PM Work/execution/*/public/brand/planning-logo-dark.svg` e `planning-logo-white.svg` são **export do Adobe Illustrator 23** (lockup, viewBox 1163.3×239.6), entrou em `revenue-auditor-hub` em 2026-06-22 (commit de Victor Eliezek) e foi copiado para todos os `planning-brain-*`. Atenção: o gradiente desse SVG é **`#5FB77F` → `#4EBED8`** (verde/azul dessaturados, provavelmente conversão CMYK), não `#0AE18C`/`#14C8FA`. É o arquivo mais próximo de um original, mas com cor diferente da paleta RGB oficial. Precisa decisão humana sobre qual é o canônico.
- Patterns/grafismos: anéis e círculos concêntricos (`assets/patterns/pattern-1.png`, `pattern-3.png`, `assets/grafismos/grafismo-demo-1.png`, só PNG).

### Paleta oficial
Verde `#0AE18C` (primária, PANTONE 352 C) · Laranja `#FA6914` (1585 C) · Ciano `#14C8FA` (311 C) · Roxo `#962DFF` (265 C) · Lima `#C3E61E` (381 C) · Preto `#000000` · Cinza `#646464` (Cool Gray 10 C) · Cinza `#CDCDCD` (Cool Gray 2 C) · Branco. Gradiente ciano→verde. Vermelho não existe na marca.

### Tipografia oficial
Bw Glenn Sans, pesos 200/400/700/900. Licença e arquivos ausentes do disco. Fallback do DS: Inter. (A Caixa de Oportunidade escolheu Hanken Grotesk como substituto; os apps Brain usam **Poppins**, que não aparece em nenhum documento de marca.)

---

## 3. Avaliação crítica

### 3.1 Contraste (WCAG 2.1, calculado a partir dos valores HSL reais dos tokens)

**Cores de marca puras:**
| Cor | sobre branco | branco sobre ela | sobre preto |
|---|---|---|---|
| Verde `#0AE18C` | **1.73:1 ✗** | **1.73:1 ✗** | 12.16:1 ✓ |
| Laranja `#FA6914` | 2.96:1 ✗ | 2.96:1 ✗ | 7.10:1 ✓ |
| Ciano `#14C8FA` | 1.97:1 ✗ | 1.97:1 ✗ | 10.67:1 ✓ |
| Roxo `#962DFF` | 5.10:1 ✓ | 5.10:1 ✓ | 4.12:1 (só grande) |
| Lima `#C3E61E` | 1.43:1 ✗ | 1.43:1 ✗ | 14.66:1 ✓ |
| Cinza `#646464` | 5.92:1 ✓ | 5.92:1 ✓ | 3.55:1 |
| Vermelho `#EA0B25` | 4.59:1 ✓ | 4.59:1 ✓ | 4.57:1 ✓ |

Conclusão: a marca é "preto sobre vivo". **Verde nunca pode ser texto, link, ícone ou borda sobre branco, nem receber texto branco.** O DS respeita isso nos botões (tinta `#06120C` sobre verde = **10.88:1**) e usa `positive-text #03784A` para link (5.59:1 no card, 5.21:1 no bg).

**Pares de texto — claro:** foreground/bg 17.58 · foreground/card 18.88 · muted-fg/bg 5.62 · muted-fg/card 6.03 · muted-fg/muted 5.24 · secondary 11.41 · accent-fg/accent 6.83 · branco/destructive 4.60 · positive-text/subtle 5.24 · warning-text/subtle 4.80 · info-text/subtle 4.98 · negative-text/subtle 4.73 · preto/warning fill 6.68 · preto/info fill 10.09. **Todos ≥4.5 ✓** (warning, info e negative raspando).

**Pares de texto — escuro:** fg/bg 17.85 · fg/card 16.57 · fg/popover 15.46 · muted-fg/card 7.14 · verde/bg 11.25 · accent 11.90 · positive 7.89 · warning 5.46 · info 7.57 · negative/subtle 4.77 · negative/card 4.93. **Todos ✓.**

**Não-texto (1.4.11, alvo 3:1) — onde o "AA validado por script" do README não se sustenta:**
- `--border`/`--input` sobre card: **1.27:1 claro, 1.34:1 escuro ✗** — contorno de input não é perceptível como limite de controle.
- `--ring` verde sobre branco: **1.74:1 ✗**; e o foco real é `shadow-focus` com alpha 0.35 → ainda mais fraco. No tema claro o indicador de foco é praticamente invisível para baixa visão.
- Rail verde do item ativo da sidebar sobre card branco: 1.74:1 (compensado pelo peso do rótulo e wash de accent).
- chart-2 laranja sobre branco: 2.96:1 (limite); os demais ≥3.4 ✓.
- `prefers-reduced-motion`: só o Skeleton e a doc HTML respeitam; Button (`active:translate-y-px`), Sidebar (transição de largura) e fade-in não.

### 3.2 Notas (0–10)

| Critério | Nota | Justificativa curta |
|---|---|---|
| Cobertura de tokens semânticos (surface/fg/border/state) | **7** | Todo o vocabulário shadcn + 4 status com fill/fg/text/subtle, claro e escuro. Faltam: `--sidebar-*`, hover/pressed/selected/disabled como token (usa `/90`, `opacity-50`), `border-strong`, `surface-raised`, tokens de texto de link, overlay/scrim. Tipografia, z-index e escala de fonte ficam no JSON e não chegam ao Tailwind |
| Dark mode | **8** | Tema escuro escolhido (não invertido), passos próprios de chart e sombra, status re-derivados. Perde ponto por ring/border fracos também no escuro e ausência de regra de quando usar qual tema |
| Acessibilidade (AA) | **6** | Texto: 100% AA nos dois temas. Não-texto: borda de input 1.27:1, foco 1.74:1 com alpha, reduced-motion parcial. "Status nunca só cor" está bem aplicado (Badge, StatTile) |
| Componentes de dados (tabela, KPI, gráfico, filtro, vazio) | **5** | StatTile é bom; Table é só casca (sem sort, paginação, seleção, sticky header, densidade); charts são só paleta+legenda+tooltip (nenhum gráfico pronto, nenhum sparkline); **filtro inexistente** (sem date range, multi-select, combobox, chips, popover, checkbox); Empty/Error presentes, sem Loading de tabela/gráfico |
| Regras de uso (quando usar o quê) | **5** | Bons princípios (data-viz: série ≠ status ≠ marca; caps de série; voz; gradiente nunca atrás de texto). Faltam do/don't por componente, hierarquia de botões por tela, quando Dialog vs Sheet, quando Badge solid vs soft, densidades |
| Padrões de navegação | **3** | Um ASCII de dashboard e o componente Sidebar. Sem topbar/page header, breadcrumb, tabs de página, navegação mobile, estrutura de rotas multi-produto (Ops/Growth/Financeiro), troca de produto/unidade |
| Ícones / ilustração | **3** | "Use Lucide" e nada mais: sem tamanho/stroke por contexto, sem set de ícones de domínio. Ilustração: só 3 PNGs de pattern/grafismo sem regra de uso; símbolo isolado oficial ausente; `mark-icon` é o lockup |
| Hover / estados de interação | **5** | Botão, linha de tabela, item de sidebar, focus-visible e loading existem; sem estados documentados como matriz (default/hover/active/focus/disabled/selected/invalid), sem token de hover, focus fraco |
| Adoção fácil por app shadcn/Tailwind existente | **4** | Promete "troque a camada de token", mas é Tailwind **v3** + HSL em canal, enquanto os apps reais da Planning (todos os `planning-brain-*`, cockpit piloto) são **Tailwind v4 + `@theme inline` + hex**, com `--sidebar-*`. Não é pacote, não é registry, fontes ausentes, sem versão/changelog |
| **Média** | **5.1** | |

### 3.3 Defeitos concretos encontrados
1. `planning-mark-icon.png` contém o lockup inteiro; `brand-dna.md` o descreve como ícone/favicon.
2. `color-light`/`color-dark` têm fundo opaco embutido — não servem sobre superfícies `#F6F7F9` ou `#0A0D12` do próprio DS sem retângulo visível.
3. `PlanningMark`: gradiente em `objectBoundingBox` em `<line>` não pinta raios horizontais/verticais; geometria simplificada vs oficial.
4. `SEQUENTIAL.cyan` em `chart.tsx` ≠ `sequential.cyan` em `design-tokens.json`.
5. HSL `156 91% 46%` = `#0BE08B`, não o hex de marca `#0AE18C`.
6. `planning-fonts.css` referencia 4 `.woff2` inexistentes (404 em qualquer app que importe).
7. README afirma "WCAG AA em todos os pares" — verdade só para texto; não-texto falha.
8. Escala tipográfica, letter-spacing, z-index, `slower`/`decelerate`/`accelerate` estão no JSON e não no preset Tailwind nem no CSS.
9. `brand-dna.md` diz wordmark "caixa baixa"; o arquivo oficial tem "P" maiúsculo.
10. `package.json` lista Radix por pacote (`@radix-ui/react-*`); shadcn atual usa `radix-ui` monolítico.

---

## 4. Por que o DS não "transborda" para as telas

Medido no disco (`PM Work/execution/*/src/{index,styles,globals}.css`):
- **Adotaram:** só `brain-financeiro-planning` (HSL + Bw Glenn Sans + `positive-text`) e `conferidor-folha`.
- **Não adotaram:** os 12 apps `planning-brain-*` (inclui o cockpit piloto de 2026-09-22 e um `planning-brain-ds-v2-20260923` aberto hoje). Eles têm um tema próprio "Paleta Planning Brain": primária `#0ae18c` (bate), mas **fonte Poppins**, destrutivo `#c0392b`, ring `#00875a`, charts `#0ae18c #14c8fa #5b8def #ffc857 #c792ea` (três fora da marca), `--radius 0.75rem`, background `#f4f7f9`. O comentário no topo ainda fala em "verde mint #2EE5A8 / #14B881", resíduo de outra versão.

Causas, em ordem de peso:
1. **Formato incompatível com a stack real.** DS = Tailwind v3 (`tailwind.config.cjs`, `hsl(var(--x))`, canal HSL, `tailwindcss-animate`). Apps = Tailwind v4 (`@import "tailwindcss"`, `@theme inline`, valores completos, `tw-animate-css`, shadcn "new-york" com `--sidebar-*`). Colar `planning-tokens.css` num app v4 quebra as cores (vars em canal HSL sem `hsl()`), e o preset `.cjs` não é lido.
2. **Não é dependência, é cópia.** `private`, sem build, sem publicação, sem registry shadcn (`registry.json`), sem workspace. Cada app copia e diverge; não há como "atualizar o DS" e ver as telas mudarem.
3. **Não mapeia o shadcn inteiro.** Faltam `--sidebar-*`, `--chart-*` não conversa com o `ChartConfig` do shadcn chart, faltam ~15 componentes que os apps usam (sheet, popover, checkbox, radio, calendar, pagination, breadcrumb, avatar, alert, form, command, collapsible, scroll-area, progress, toggle).
4. **A fonte da marca não existe no disco.** Sem Bw Glenn Sans, cada app escolheu um substituto (Inter no DS, Poppins nos Brain, Hanken Grotesk na Caixa). A tipografia, que é metade da identidade, não chega a lugar nenhum.
5. **Sem regras de layout.** Não há container/grid de página, largura máxima, page header, filtro-barra, densidade de tabela, ordem de seções, breakpoints de dashboard. É exatamente o que um agente precisa para montar tela; na falta, cada sessão inventa.
6. **Sem logo utilizável em UI.** Nenhum SVG oficial no DS; o `PlanningMark` é aproximação; os apps passaram a usar o SVG do Illustrator vindo do `revenue-auditor-hub` (com gradiente de outra cor). O DS perdeu autoridade exatamente no ativo mais visível.
7. **Congelado desde 2026-07-21, sem dono ativo nem changelog.** Os apps evoluíram dois meses sem ele; a "Paleta Planning Brain" virou o DS de fato.
8. **Nenhuma instrução para agentes.** `CLAUDE.md`/`AGENTS.md` dos apps não apontam para o DS; o `component-writer` usa shadcn puro. Sem esse elo, nada obriga a leitura.

### O que faria ele ser adotável (mínimo)
- Emitir os tokens em **Tailwind v4** (`@theme inline` + vars em hex/oklch, `:root`/`.dark`), incluindo `--sidebar-*` e z-index/tipo/motion como `--*` do `@theme`.
- Publicar como **registry shadcn** (ou pacote de workspace) com `planning-theme`, `stat-tile`, `empty-state`, `filter-bar`, `data-table`, `page-header`, `app-shell`.
- Resolver fonte (licenciar Bw Glenn Sans ou oficializar um substituto único) e logo (SVG oficial com gradiente `#14C8FA→#0AE18C`, símbolo isolado, favicon).
- Corrigir não-texto: borda de input ≥3:1 (ex.: neutral-400 `#A7AEBB` ≈ 2.2 não basta; neutral-500 `#7B8492` ≈ 3.8), foco com anel escuro/verde-texto `#03784A` no claro.
- Escrever `layout.md` (shell, grid, page header, filtros, densidade) e uma matriz de estados por componente.
- Referenciar o DS no `CLAUDE.md` de cada app Brain e reconciliar a "Paleta Planning Brain" com ele (hoje é o DS de fato).
