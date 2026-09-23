# Referências de UI/UX para o Planning Brain — o que um agente de IA consegue de fato consumir

Pesquisa de 23/09/2026. Estrelas e última atividade conferidas pela API do GitHub (`gh api repos/...`) nesta data. Onde a afirmação vem de marketing do próprio fornecedor, está marcado.

Contexto: app interno B2B (CRM/base, carteira, financeiro/DRE, fila de atendimento, cockpit do CEO, oportunidades), React + TS + Tailwind + shadcn/ui + Recharts, construído por Claude Code / Codex. Problema: telas genéricas, sem nexo de navegação.

---

## 0. Diagnóstico em uma frase

O problema descrito ("telas genéricas **e sem nexo de navegação**") tem duas metades, e só uma delas é visual. A metade visual (tipografia, cor, densidade, gráficos) se resolve bem com tokens + blocos + um linter. A metade estrutural (quais objetos existem, como uma lista leva a um detalhe, onde mora o filtro, o que o CEO vê primeiro) é **arquitetura de informação**, e nenhuma biblioteca de componentes resolve isso. A melhor fonte pronta para essa metade são os **floorplans do SAP Fiori** e os **UI patterns do GitHub Primer**, não um kit de dashboard.

---

## 1. Avaliação por grupo

### A. Design systems com documentação de USO

| Sistema | Situação 2026 | Nota para o nosso caso | Por quê |
|---|---|---|---|
| **SAP Fiori** — https://www.sap.com/design-system/fiori-design-web/ | ativo (web docs v1-136; UI5 webcomponents push 23/09/2026) | **A melhor para navegação/IA** | Único que codifica *tipos de página* (floorplans): List Report → Object Page, Overview Page (cards), Analytical List Page, Worklist, e um guia de "qual floorplan usar quando" (https://www.sap.com/design-system/fiori-design-web/v1-136/page-types/floorplans/when-to-use-which-floorplan). Isso é exatamente o "nexo de navegação" que falta: base de clientes = List Report; cliente = Object Page; cockpit = Overview Page; fila = Worklist. Visual é datado/corporativo — usar as **regras**, não a estética. |
| **GitHub Primer** — https://primer.style/product/ui-patterns/ | ativo (primer/react 3,9k★, push 23/09/2026) | **Melhor conjunto de padrões de estado** | Páginas curtas e prescritivas de empty states, loading, degraded experiences, navigation, forms, saving (https://primer.style/product/ui-patterns/empty-states/). Produto denso para usuário técnico, próximo de app interno. Texto enxuto = ótimo para colar no contexto de um agente. |
| **IBM Carbon** — https://carbondesignsystem.com/data-visualization/dashboards/ | ativo (9,5k★, push 23/09/2026) | **Melhor para data viz e dashboard** | Seção de data visualization completa (tipos de dashboard, cores consistentes por série, anotação, legendas), mais Carbon Charts (https://charts.carbondesignsystem.com/dashboards) e padrões de data table/filtro. Denso e B2B por natureza. |
| **Atlassian** — https://atlassian.design | ativo (repo interno; mirror não localizado) | Bom em conteúdo/mensagens | Guia de escrita de empty state e mensagens (https://atlassian.design/foundations/content/designing-messages/empty-state) e o novo sistema de navegação (https://www.atlassian.com/blog/design/designing-atlassians-new-navigation). Bom para microcopy; menos útil para dashboards. |
| **Ant Design / Ant Design Pro** — https://ant.design , https://pro.ant.design | ativo (99,6k★ / 38,8k★, push 21–23/09/2026) | Bom como *catálogo de páginas de admin* | Pro traz arquétipos prontos (lista, detalhe, formulário por etapas, resultado, exceção 403/404/500, ProTable com filtro em cima). Serve de referência de estrutura; não trazer a lib (conflita com shadcn e tem estética própria). |
| **Microsoft Fluent 2** — https://fluent2.microsoft.design | ativo (fluentui 20,3k★) | Médio | Boas docs de uso, mas voltado ao ecossistema M365; pouca orientação de dashboard. |
| **GOV.UK Design System** — https://design-system.service.gov.uk/patterns/ | ativo (govuk-frontend push 23/09/2026) | Excelente para formulários, fraco para dashboard | Padrões baseados em pesquisa com usuário real (uma pergunta por página, validação, check answers). Use para cadastros e fluxos transacionais, não para cockpit. |
| **Shopify Polaris** — https://polaris.shopify.com | **Polaris React depreciado**; repo `polaris-react-archive` arquivado; migração para Web Components em 01/10/2025 (https://github.com/Shopify/polaris-react-archive) | Médio, e caindo | As docs de uso (index tables, filtros, empty states) continuam boas para ler, mas o código não serve a React e o site está em transição. |
| **Salesforce Lightning (SLDS 2 / Cosmos)** — https://www.lightningdesignsystem.com | repo `salesforce-ux/design-system` **arquivado** (último push 02/06/2026); SLDS 2 em beta | Baixo | Referência de CRM, mas docs presas à plataforma Salesforce; muda de base. |
| **Vercel Geist** — https://vercel.com/geist | vitrine, sem pacote público de componentes | Baixo como referência de *uso* | É vitrine de componentes e fonte; quase não tem regra de uso. O valor real da Vercel para agentes está nas Web Interface Guidelines (seção C). |
| **Material 3** — https://m3.material.io | ativo (material-web 11,3k★) | Baixo | Genérico, orientado a mobile/consumo; densidade ruim para B2B; puxa a estética "Google genérico". |

**Resposta à pergunta A:** navegação/estrutura → **Fiori**; tabelas, filtros e estados → **Primer + Pencil & Paper** (seção D); dashboards/gráficos → **Carbon**.

### B. Bibliotecas para shadcn/Tailwind

| Fonte | Estado (GitHub) | Veredito |
|---|---|---|
| **shadcn/ui charts + blocks** — https://ui.shadcn.com/charts , https://ui.shadcn.com/blocks | 124,5k★, push 21/09/2026; CLI v4 com **skills, MCP e llms.txt** (https://ui.shadcn.com/docs/skills , https://ui.shadcn.com/docs/mcp , https://ui.shadcn.com/llms.txt) | **Base obrigatória.** Charts já são Recharts com tokens `--chart-1..5`; blocks trazem `dashboard-01`, sidebars, login. O MCP/skill deixa o agente listar e instalar do registry em vez de reinventar. |
| **satnaing/shadcn-admin** — https://github.com/satnaing/shadcn-admin | 14,3k★, push 10/09/2026 | **Melhor esqueleto de navegação** para app admin: sidebar agrupada, command palette, tabelas com TanStack (filtro facetado, paginação, ações em massa), páginas de erro, temas. Use como referência de *casca*, não como fork cego. |
| **Tremor** — https://tremor.so | comprada pela Vercel em jan/2025 (https://vercel.com/blog/vercel-acquires-tremor); `tremor-npm` parado desde 13/01/2025; `tremor` (copy-paste) último push 10/10/2025 | **Ler, não depender.** Blocks de KPI/tabela/gráfico ainda são das melhores referências visuais de dashboard e são MIT, mas o projeto parece congelado. Copie o padrão, não instale. |
| **coss ui (ex-Origin UI)** — https://coss.com/ui/docs | 10,6k★, push 22/09/2026; base em Base UI; registry shadcn | Bom repertório de inputs/filtros/tabelas; ainda "pode quebrar" (roadmap declarado). Útil para peças pontuais (date range, multi-select). |
| **Kibo UI** — https://www.kibo-ui.com | adquirida pela shadcnblocks (out/2025), 3,9k★, push 04/05/2026 | Útil para peças que faltam no shadcn (kanban, gantt, calendário) — relevante para a fila de atendimento. Atividade caiu. |
| **tweakcn** — https://tweakcn.com | 10,4k★, push 03/09/2026 | **Ferramenta de tokens**, não de telas: editor visual que exporta as variáveis CSS do tema shadcn. É o caminho mais curto para um tema próprio da Planning. |
| **Magic UI** — https://magicui.design / **Aceternity** — https://ui.aceternity.com | Magic UI 22,4k★ | **Não usar no app** (ver seção 3): efeitos de landing page. |
| **Recharts** (27,6k★, push 22/09/2026) vs **Nivo** (14,1k★, jul/2026) vs **visx** (21,1k★, jun/2026) vs **ECharts** (67,4k★, set/2026) | — | **Fique no Recharts** (é o que o shadcn charts usa e o que o agente mais viu em treino). Traga **ECharts** só para casos que o Recharts faz mal: heatmap/calendário grande, sankey de funil, >10k pontos. visx é de baixo nível (agente escreve mais código, erra mais); Nivo cobre bem mas duplica o sistema de tema. |

### C. Conteúdo/regras para agentes

| Fonte | Estado | O que é | Evidência de que funciona |
|---|---|---|---|
| **Anthropic `frontend-design` skill** — https://github.com/anthropics/skills , post: https://claude.com/blog/improving-frontend-design-through-skills | anthropics/skills 177,8k★; **já instalada nesta máquina** | ~400 tokens contra "distributional convergence" (o modelo cai na média estética do treino). | Anthropic mostra antes/depois, sem métrica. Justin Wetch reescreveu a skill e mediu 50 prompts, juiz Opus 4.5, 75% de vitórias, p=0,0125, ganho maior em modelos menores (https://www.justinwetch.com/blog/improvingclaudefrontend/). Mas o juiz é um LLM. **Viés importante:** a skill empurra para estética "ousada/distinta", o que é certo para landing page e **errado para app operacional denso**. |
| **impeccable** (Paul Bakaus) — https://github.com/pbakaus/impeccable | 70,1k★, push 22/09/2026 | 24 comandos (`audit`, `critique`, `polish`, `distill`, `layout`, `harden`…), arquivos `PRODUCT.md` + `DESIGN.md` por projeto e um **detector com 61 regras determinísticas** que roda sem API. Suporta Claude Code e Codex. | Estudo de caso antes/depois; nenhuma métrica. **O detector determinístico é o que mais vale**: é lint, e lint não depende do humor do modelo. |
| **Vercel Web Interface Guidelines** — https://github.com/vercel-labs/web-interface-guidelines | 891★, push 18/08/2026 | Checklist de interação, foco, formulários, estado na URL, layout, performance, copy; instalável como AGENTS.md ou skill de review (`npx skills add`). | Sem métrica, mas as regras são verificáveis (ex.: "filtro e aba persistem na URL", "tabular-nums em números"). Poucas estrelas, alta densidade de regra útil. |
| **ui-ux-pro-max-skill** — https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | 130k★, push 21/09/2026 | Banco CSV + busca BM25: 50 estilos ativos, 192 paletas, 74 pares de fonte, 119 guidelines, 25 tipos de gráfico, 192 "regras por indústria". | **Nenhuma.** Estrelas ≠ qualidade. Risco: o agente "escolhe um estilo" de catálogo (glassmorphism, bento…), o que é o oposto de coerência entre telas. |
| **awesome-design-md** (VoltAgent) — https://github.com/VoltAgent/awesome-design-md | 117k★ | DESIGN.md extraídos do CSS público de Linear, Stripe, Vercel, Supabase, PostHog, Sentry etc. **Não oficiais** (o próprio README diz). | Nenhuma. Útil como *exemplo de formato* e como ponto de partida (PostHog/Linear/Sentry são próximos de app de dados). Risco: copiar a identidade de outra marca. |
| **Google DESIGN.md (Stitch)** — https://github.com/google-labs-code/design.md | 28k★, push 14/09/2026; Apache-2.0; **alpha**, aberto em 23/04/2026 | Formato: tokens em YAML front matter + racional em markdown. CLI com `lint` (referências quebradas, **contraste WCAG AA**), `diff` entre versões e **export para Tailwind v4 / DTCG**. | É formato, não conteúdo; a evidência é de engenharia (lint + export funcionam). Vale adotar como contêiner do nosso sistema. |
| **Rams** — https://www.rams.ai | SaaS; free 30 reviews/mês, planos pagos | Revisor hostado: MCP/skill que dá nota 0–100 e achados com arquivo:linha contra ~300 regras. | Marketing próprio, com conflito de interesse declarado na página de comparação (https://www.rams.ai/compare/rams-vs-design-skills). Ideia certa (gate com nota), fornecedor novo. |
| **v0 / Stitch como gerador** | — | Os prompts de sistema do v0 circulam vazados; não são uma fonte oficial. | Não é fonte de regra; ignore. |
| **Skill `dataviz` já instalada nesta máquina** | local | Método de forma/cor/validador de paleta, tiles de KPI, dark mode. | É a peça certa para gráficos; já existe. |

**Evidência geral:** o dado mais sólido não é sobre skill nenhuma. O **UI-Bench** (4.000+ julgamentos de especialistas humanos, 10 ferramentas, 300 sites; https://arxiv.org/abs/2508.20410) concluiu que o que separa as ferramentas boas das ruins é **orquestração, biblioteca de templates e curadoria de assets**, não o modelo em si. Tradução para nós: **blocos reais + tokens + gate** rendem mais que texto de inspiração.

### D. Heurísticas e pesquisa

| Fonte | Valor para o caso | Formato para agente |
|---|---|---|
| **Pencil & Paper** — https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables , …/ux-pattern-analysis-enterprise-filtering , …/ux-pattern-analysis-data-dashboards , …/ux-pattern-analysis-navigation , …/empty-states , …/ux-pattern-analysis-loading-feedback | **O mais aderente ao nosso caso.** Estúdio de enterprise UX; artigos longos com os padrões exatos (tipos de dashboard, filtro fixo no topo, drill-down em drawer vs página, defaults que não mostram tudo, ações em massa em tabela). Gratuito. | Destilar cada artigo em uma lista de regras verificáveis (1 página cada) e salvar no repo. Não mandar o agente "ler o site" ao vivo. |
| **NN/g** — https://www.nngroup.com/articles/dashboards-preattentive/ , https://www.nngroup.com/articles/empty-state-interface-design/ (+ artigos de data tables e filtros) | Alta credibilidade, baseado em estudo. Distingue dashboard operacional de analítico — decisão que precisa ser tomada para o Cockpit do CEO vs Fila. | Idem: destilar. Alguns relatórios são pagos. |
| **Laws of UX** — https://lawsofux.com | Vocabulário (Hick, Fitts, Jakob, Miller) útil para *crítica*, fraco para *gerar* tela. | Bom como checklist no passo de review. |
| **Refactoring UI** (Wathan & Schoger) — https://www.refactoringui.com | Melhor livro prático de hierarquia visual para devs; é a origem de muitas escolhas do Tailwind. Pago (~US$ 99+). | Resumir as ~20 regras em arquivo interno (não redistribuir o livro). |
| **Stephen Few, *Information Dashboard Design*** / **Tufte** | Fundamento de dashboard (data-ink, sem 3D/gauge decorativo, bullet graph, sparkline, small multiples). Livros. | Poucas regras, muito alavancadas; entram no arquivo de regras de gráfico junto com a skill `dataviz`. |
| **Baymard** — https://baymard.com | E-commerce, pago. **Não se aplica.** | — |
| **Mobbin** — https://mobbin.com | 621,5k telas / 142k fluxos de apps reais; **MCP lançado em mai/2026, em beta, só planos pagos** (https://www.businesswire.com/news/home/20260511053592/en/) — Pro a partir de ~€10/mês. | O único banco de telas reais com canal nativo para agente. Útil para *fluxos* (ex.: como SaaS reais fazem detalhe de cliente). |
| **Page Flows** — https://pageflows.com / **SaaSFrame** — https://www.saasframe.io | Fluxos gravados / telas de SaaS. Bons para humano; sem canal para agente (screenshots). | Humano escolhe 3–5 referências e anexa; agente não navega. |
| **Dribbble** | **Armadilha** (seção 3). | — |

### E. Awesome lists

- **awesome-design-systems** (https://github.com/alexpate/awesome-design-systems, 26k★, push abr/2026) — índice útil *uma vez*, para um humano achar sistemas. Para agente, é ruído: centenas de links sem juízo.
- **awesome-dashboard** (https://github.com/obazoud/awesome-dashboard, 1,2k★) — é sobre ferramentas de dashboard (Grafana etc.), não sobre design. Ruído.
- Regra geral: awesome list é mapa para humano, não entrada para agente. O agente precisa de 1 fonte escolhida e destilada, não de 300 opções.

---

## 2. Top 10 para o nosso caso

| # | Fonte | O que é / URL | Por que | Como o agente consome | Custo | Risco |
|---|---|---|---|---|---|---|
| 1 | **shadcn/ui charts + blocks + skill/MCP** | https://ui.shadcn.com/blocks , /charts , /docs/skills , /docs/mcp | Já é o stack; blocks são tela real, não inspiração; MCP evita componente inventado. | Instalar a skill do shadcn e o MCP; regra no AGENTS.md: "antes de criar componente, procure no registry". `llms.txt` como índice. | Grátis | Blocks genéricos se usados sem tokens próprios (todo app shadcn fica igual). |
| 2 | **SAP Fiori floorplans** | https://www.sap.com/design-system/fiori-design-web/v1-136/page-types/floorplans/when-to-use-which-floorplan | Resolve o "sem nexo": define arquétipos de página e como se ligam (lista → objeto → sub-objeto; overview por cards). | Humano/agente-pesquisador destila em `docs/design/page-archetypes.md` (5–6 arquétipos com anatomia e regra de navegação); cada tela nova declara seu arquétipo. | Grátis | Copiar a estética SAP; ler só a estrutura. |
| 3 | **Pencil & Paper (tabelas, filtros, dashboards, navegação, empty/loading)** | https://www.pencilandpaper.io/articles/ (URLs na seção D) | Regras de enterprise UX mais aplicáveis ao que o Brain faz todo dia. | Destilar em `docs/design/rules-*.md` (checklist verificável por item). | Grátis | Artigos longos; sem destilação o agente só parafraseia. |
| 4 | **Google DESIGN.md (formato + CLI)** | https://github.com/google-labs-code/design.md | Contêiner único de tokens + racional, com lint de contraste e export para Tailwind v4. | `DESIGN.md` na raiz; `design.md lint` e export para o CSS do tema no CI. | Grátis | Alpha: formato pode mudar. |
| 5 | **tweakcn** | https://tweakcn.com | Caminho mais curto para um tema shadcn da Planning (cor, raio, fonte, sombras, chart-1..5). | Humano ajusta visualmente, exporta variáveis; agente só consome. | Grátis | Nenhum relevante. |
| 6 | **impeccable (detector + audit/critique)** | https://github.com/pbakaus/impeccable | Detector de 61 regras determinísticas = gate que não depende do modelo; comandos `audit`/`critique`/`distill`. | `npx impeccable install`; rodar o detector em PR; `PRODUCT.md` do Brain. | Grátis | Parte das regras é gosto (ex.: proíbe Inter); ajustar config. Comandos "bolder/colorize" puxam para marketing. |
| 7 | **IBM Carbon — data viz + dashboards** | https://carbondesignsystem.com/data-visualization/dashboards/ | Melhor regra de dashboard/gráfico entre os design systems. | Destilar junto com a skill `dataviz` local em `rules-charts.md`. | Grátis | Nenhum relevante. |
| 8 | **GitHub Primer UI patterns** | https://primer.style/product/ui-patterns/ | Estados vazio/loading/erro/degradado e navegação, curtos e prescritivos. | Páginas curtas: dá para colar trechos quase literais em `rules-states.md`. | Grátis | Pensado para o GitHub; adaptar vocabulário. |
| 9 | **satnaing/shadcn-admin** | https://github.com/satnaing/shadcn-admin | Casca pronta: sidebar agrupada, command palette, TanStack Table com filtro facetado e ações em massa, páginas de erro. | Clonar à parte como *referência de código*; agente lê arquivos específicos (layout, data-table) ao montar a casca. | Grátis | Fork direto traz estrutura de pastas e deps de terceiro. |
| 10 | **Vercel Web Interface Guidelines** | https://github.com/vercel-labs/web-interface-guidelines | Regras de interação que agentes erram sempre: estado de filtro/aba na URL, foco, teclado, números tabulares, loading otimista. | Como AGENTS.md incluído ou skill de review. | Grátis | Uma parte é específica de Next.js. |

Menções honrosas: **Mobbin MCP** (pago, beta — bom para pesquisar fluxos quando for desenhar algo novo, como o detalhe de cliente), **NN/g** (fundamento para a decisão dashboard operacional vs analítico), **Tremor** (ler blocks de KPI; não instalar).

---

## 3. Stack de referência recomendado

**(i) Regras/heurísticas → Pencil & Paper + Fiori floorplans, destilados em arquivos do repo.**
Um único conjunto: `docs/design/page-archetypes.md` (Fiori: List Report, Object Page, Overview Page, Worklist, Form/Wizard) + `docs/design/rules-tables-filters.md`, `rules-dashboards.md`, `rules-states.md` (Pencil & Paper + Primer + Carbon). Justificativa: é a camada que resolve navegação; o agente consome bem regras curtas e verificáveis e mal consome artigos inteiros ou links.

**(ii) Sistema visual/tokens → DESIGN.md (formato Google) gerado a partir de um tema tweakcn.**
Justificativa: um arquivo, versionado, com lint de contraste e export para Tailwind v4 — o agente não "escolhe estilo", obedece token. Densidade (altura de linha de tabela, tamanho de fonte de KPI, espaçamentos) entra aqui como token, não como gosto.

**(iii) Componentes/blocos → shadcn/ui (charts + blocks via skill/MCP) com a casca do shadcn-admin como referência.**
Justificativa: é o stack atual, tem o melhor canal nativo para agente (registry + MCP + skill) e o UI-Bench mostra que template/biblioteca pesa mais que modelo. Recharts como padrão; ECharts só por exceção documentada.

**Gate transversal:** detector do impeccable (determinístico) + screenshot por Playwright comparado contra o arquétipo declarado. Sem gate, as três camadas viram sugestão.

---

## 4. Não use

- **Dribbble / Behance** — são imagens feitas para ganhar like, com dado fictício bonito, sem estados (vazio, erro, 5.000 linhas), sem fluxo, sem acessibilidade. Treinam exatamente a "média estética" que já é o problema. E o agente não enxerga as imagens pelo WebFetch: recebe só título e legenda.
- **Magic UI / Aceternity** — efeitos de landing page (spotlight, meteoros, cards 3D). Num app operacional tiram atenção do dado e custam performance.
- **ui-ux-pro-max-skill** (130k★) — catálogo de estilos com busca; empurra o agente a *escolher um estilo por tela*, o que destrói a consistência. Nenhuma evidência publicada. As estrelas medem viralidade.
- **awesome-design-md como fonte de identidade** — copiar o DESIGN.md da Linear/Stripe faz o Brain parecer produto de outra empresa; e é extração não oficial de CSS. Use só como exemplo de formato.
- **Anthropic `frontend-design` aplicada ao app sem ajuste** — foi escrita contra estética genérica em peças novas (landing, artifact). Aplicada a CRM/DRE, tende a trocar legibilidade por "personalidade" (fontes display, cor forte). Se usar, sobrescreva com "produto operacional, denso, sóbrio".
- **Material 3** — densidade e padrões de mobile/consumo.
- **Polaris React e SLDS como código** — depreciado/arquivado. Leia as docs; não instale.
- **Tremor como dependência** — congelado desde a compra pela Vercel.
- **Awesome lists como entrada para agente** — ruído; 300 links sem critério.
- **Listicles de SEO ("12 dashboard design principles")** — é o que a busca web devolve primeiro (ex.: uxpilot.ai, elevenspace.co nesta própria pesquisa). Repetem NN/g de terceira mão.

---

## 5. Veredito: dá para substituir um profissional de UI/UX?

**Sim, em boa parte do ofício de *UI*:** consistência visual, tokens, escolha de gráfico, estados de tela, tabelas e filtros "certos por padrão", acessibilidade básica, revisão de polimento. Com regras destiladas + tokens + blocos + gate, um agente entrega nível de "designer de sistema júnior/pleno executando um sistema existente".

**Não, no que é *UX* de fato:**
- **Pesquisa com usuário** — quem usa a fila de atendimento, o que o CEO olha às 8h, o que a controladoria confere no DRE. O agente não entrevista, não observa, não mede tarefa. Nenhuma fonte substitui isso.
- **Arquitetura de informação e modelo de objetos** — decidir que "cliente", "contrato", "oportunidade" são objetos com página própria e como se relacionam; qual é a navegação primária. Fiori dá o *vocabulário*, mas a decisão depende do domínio e dos usuários da Planning.
- **Priorização do que aparece** (o que entra no cockpit, qual KPI é principal) — decisão de negócio mediada por design.
- **Juízo de trade-off** entre times com necessidades opostas, e dizer "não" a uma tela.
- **Validar que funcionou** — teste de usabilidade com 5 pessoas pega o que nenhum linter pega.

Arranjo realista: um designer (ou o próprio PM com esse chapéu) por poucas horas por mês, dono de **PRODUCT.md, mapa de navegação e arquétipos**; agentes executam o resto contra essas regras.

---

## 6. Por que "pesquise referências de UI/UX" no meio de uma tarefa de dev falha

Explicação mecânica:

1. **A busca devolve o topo de SEO, não o canônico.** WebSearch rankeia listicles e blogs de ferramenta; NN/g, Fiori e Pencil & Paper aparecem, mas misturados com conteúdo raso, e o agente não tem critério para descartar.
2. **O agente não vê imagem.** WebFetch converte a página em markdown e resume com um modelo pequeno; galerias (Dribbble, Mobbin web, SaaSFrame) viram lista de títulos. "Pesquisar referência visual" sem canal visual é pesquisar legenda.
3. **Resumo de resumo.** O que volta ao contexto é paráfrase genérica ("use hierarquia clara, espaço em branco, consistência"), que é o próprio prior do modelo. A pesquisa confirma a média em vez de deslocá-la — é a "distributional convergence" que a Anthropic descreve.
4. **Competição de objetivo e de contexto.** No meio da tarefa, o objetivo dominante é "compilar e passar no teste". A pesquisa vira passo cerimonial; o agente volta ao padrão aprendido na hora de escrever JSX.
5. **Nada persiste.** A pesquisa morre com a sessão. A tela seguinte, em outra sessão, pesquisa de novo e chega a outra conclusão. **Esta é a causa do "sem nexo"**: cada tela é desenhada por um agente sem memória da decisão estrutural da anterior, e não existe contrato de navegação/arquétipo compartilhado.
6. **Sem critério de aceite de design,** não há como falhar. Teste de tipo passa; tela feia e desconectada também "passa".

Como estruturar para funcionar:

1. **Separe pesquisa de execução.** Uma rodada única (humano + agente pesquisador) produz artefatos no repo: `PRODUCT.md` (usuários, tarefas, objetos), `docs/design/nav-map.md` (objetos → rotas → arquétipo), `page-archetypes.md`, `rules-*.md`, `DESIGN.md`. Pesquisa vira arquivo, não passo de tarefa.
2. **Fontes escolhidas, destiladas, com URL de origem.** Uma fonte por camada (seção 3). Regras escritas como verificáveis ("filtro ativo aparece como chip removível acima da tabela e persiste na URL"), não como princípios.
3. **AGENTS.md aponta, não repete:** "antes de criar tela, declare o arquétipo de `page-archetypes.md` e a posição em `nav-map.md`; use só tokens do DESIGN.md; componente vem do registry shadcn".
4. **Referência visual entra como arquivo, escolhida por humano:** 3–5 screenshots de produtos reais (Mobbin/SaaSFrame/Linear/PostHog) salvos no repo e passados com Read — aí o modelo vê a imagem.
5. **Gate no fim de cada tela:** detector do impeccable + screenshot por Playwright + checklist do arquétipo. Falhou, volta.
6. **Primeiro a casca, depois as telas:** layout, sidebar, breadcrumb, header de página, padrão de lista e de detalhe implementados uma vez como componentes (`<ListReportPage>`, `<ObjectPage>`, `<OverviewPage>`). Telas novas compõem esses moldes, e a navegação passa a ter nexo por construção.
