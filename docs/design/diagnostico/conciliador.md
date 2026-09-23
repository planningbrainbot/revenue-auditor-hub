# Auditoria de design: por que o Conciliador (Recon) sai bom, e o que levar para o Planning Brain

Data: 2026-09-23. Somente leitura, nenhum arquivo de projeto foi alterado.
Base: `/Users/pluca/Desktop/AI Projects/PM Work`. As telas não foram renderizadas; a análise é de código, tokens, diretivas e histórico.

---

## 0. Tese em uma frase

O Recon sai bom menos por causa do Playbook 7 Níveis e mais por três coisas: **uma fonte de marca curta e cheia de proibições, que toda sessão é obrigada a ler**; **tokens que trazem a razão de cada valor escrita em comentário**; e, no dashboard, **um contrato de significado por número** (o que cada número pergunta, qual data conta, quando é zero e quando é falta de dado, e todo número abre os registros que o compõem). A hipótese do Pedro se confirma, com uma ressalva: a Planning **já tem** um design system de nível parecido (`PM Work/planning-design-system/`, de 21/07), mas ele não está ligado a nada. No Recon a fonte da marca é carregada pelo roteamento; no Planning Brain ninguém é mandado para ela.

---

## 1. O mecanismo, elemento por elemento

### 1.1 Uma fonte única de marca, obrigatória e declarada no roteador
- `PM Work/AGENTS.md`, Fluxo de Trabalho, passo 3: *"Frontend / design (DEV ou MKT) → `_sistema/brand/recon/estudo-de-marca.md` (OBRIGATÓRIO — marca Tessera, paleta, regras; usar os SVG/PNG dessa pasta, nunca redesenhar)"*. Toda sessão aberta em PM Work recebe essa instrução antes de qualquer trabalho visual.
- `_sistema/brand/recon/estudo-de-marca.md` tem 6 KB e cabe numa leitura. Abre dizendo *"FONTE ÚNICA DE DESIGN do Recon. Toda tarefa de design … começa lendo este documento … Nenhuma peça redesenha a marca, recria cor de cabeça ou usa os logos antigos."*
- O documento é feito de decisões, não de inspiração: 12 tokens de cor, cada um com seu papel; 3 famílias tipográficas com os pesos permitidos (*"Outfit 300–500 … Nunca peso >500"*); regras de "Nunca" e "Sempre"; tamanhos mínimos; clearspace.
- A marca chega como arquivo pronto para uso: SVG em `currentColor`, PNG nas duas cores e `recon-brand-kit/design-tokens.json`, que traz uma chave `forbidden`. O agente não precisa desenhar nada, só aplicar.
- A marca é restrita de propósito: *"A marca é monocromática … Nunca duas cores, nunca gradiente"*; âmbar só em número-âncora; CTA sempre verde (`lp-recon-marketplace/style.css`: *"CTA é VERDE (nunca âmbar)"*). Com poucas opções abertas, sobra pouco espaço para o modelo cair no padrão genérico de IA.

### 1.2 Tokens que explicam a si mesmos
Em `execution/lp-recon-marketplace/app/src/index.css`, cada grupo de token carrega o porquê. Quem estende o arquivo lê a regra e a segue:
- Status: *"Reservados: só significam bom, atenção e ruim, e sempre saem com ícone e palavra ao lado. Nenhuma série de gráfico usa estas cores … o texto é o passo mais escuro da mesma cor, para passar 4.5:1 sobre o fundo sutil."*
- Séries: *"Validadas contra o card claro (#fdf9f2): faixa de luminosidade, croma, separação para daltonismo e contraste passam. O verde da marca (#4f8c65) ficou de fora porque lê como cinza em série."* É o método da skill `dataviz` aplicado à marca.
- Funil: *"uma cor só, do claro ao escuro conforme o negócio avança … Sequencial, não categórica."* O escuro tem uma rampa própria: *"o passo mais fundo é o mais aceso, senão o Ganho some."*
- Dark: *"o par anterior … dava 3,0:1, abaixo dos 4,5 de texto pequeno. Este par dá 6,8:1."*
- Na LP (`style.css`): *"Tabular figures — obrigatório em todo número financeiro"*. São 312 usos de `var(--…)`, e hex só aparece no bloco de tokens.

Medido: **0 hex literal** nos componentes do dashboard Recon (`app/src/components/dashboard/*` + `DashboardPage.tsx`). O cockpit do Planning Brain tem **80** em `.tsx`.

### 1.3 Pipeline que obriga a ler antes de fazer (workflow MKT)
- `_sistema/workflow_mkt.md`: Brief → Break → Plan → Execute + Audit. O `mkt-planner` (`~/.claude/agents/mkt-planner.md`) tem como passo obrigatório ler `_sistema/brand/`, e se a peça for UI, também o Playbook. *"Regra: nunca pular esta etapa. Sem o plano, o agente-equipe infere e o output sai genérico."*
- `mkt-funnel-builder`: *"Sem Playbook 7 Níveis lido, sem UI … Não entregar nível 1 (AI slop). Mínimo nível 3"*; *"CTA único por página"*; *"Métrica âncora visível"*; *"Mobile-first"*.
- `skill-landing-page-builder` (em `~/.claude/skills/`) transforma o Playbook num roteiro com fases: plan mode → design system gerado pelo engine `ui-ux-pro-max`, com a regra dura *"brand manual do cliente sobrescreve paleta e tipografia"* → moodboard → teardown → hero autoral → micro-detalhes → QA por grep.

### 1.4 Portão de auditoria que reprova de fato
- `_sistema/pm-skills/skill-auditoria-conciliador/SKILL.md`: 8 critérios × 12,5, com nota mínima de 80. *"Falha citada precisa ter trecho específico"*, *"Não aprovar abaixo de 80 mesmo com pressão."*
- As notas encontradas em `recon/` foram 61, 68, 74, 88, 89, 90, 91 (×3), 93 e 94 (×2). O portão reprova de verdade, não serve só de carimbo.
- Além dele há uma segunda camada humana, `recon/revisao/<disciplina>/` (`recon/Regra_Auditoria.md`).

### 1.5 Banco de imagens com estilo da casa e sufixo de prompt fixo
`_sistema/brand/recon/imagens/README.md` fixa uma assinatura visual (*"still-life de estúdio escuro … uma luz rasante … um único acento âmbar … nunca pessoas"*) e um **sufixo de prompt para colar** no fim de todo prompt. Tem também a pasta `_descartadas/`, com o motivo de cada descarte, e uma regra de corte: *"Se a imagem serve pra qualquer SaaS, está fora."*

### 1.6 No dashboard: contrato de significado + lógica testada + verificação adversarial
Isto não vem do Playbook; é o que faz o dashboard ser "bom de navegar":
- `execution/lp-recon-marketplace/dashboard-README.md` explica **o que cada número pergunta e qual data ele conta** (tabela "O que cada número responde"). Também registra o que o número **não consegue** perguntar (*"Três verdades desconfortáveis"*).
- Honestidade de categoria: *"três caixas, nunca duas"* (acima do corte, abaixo do corte e "não separável"), para que o código não decida por conta própria de que lado cai quem não tem dado.
- Zero não é o mesmo que falta de dado: *"com ele vazio, os quadros de esforço mostram o motivo em vez de zero"*; `is_client: null` em vez de `false`; o quadro "Cliente Planning" some quando o campo inteiro está vazio.
- *"dois eixos inventam uma correlação que não está no dado"*, então cada gráfico tem um eixo só.
- Log datado de remoções com o motivo (*"O que saiu em 2026-09-17"*, *"Um quadro só para o funil"*).
- Lógica pura separada da tela e testada: `features/dashboard/aggregations.ts`, `metasWill.ts` e `produtividade.ts`, com 26, 19 e 95 testes.
- *"Correções da verificação independente de 18/09/2026 (recontagem direta no Pipedrive bateu 8 de 8 …, teste de tela com refutação adversarial)"*.

### 1.7 Self-annealing registrado
O AGENTS.md e as diretivas mandam que cada erro vire regra (*"errar a mesma coisa duas vezes é falha de sistema"*). Isso aparece na prática nos comentários dos tokens e no log do README.

---

## 2. Tokens e decisões visuais do Recon

### Específico do Recon (NÃO transplantar)
| Item | Valor |
|---|---|
| Símbolo | Tessera (disco partido em degrau), SVG `currentColor` |
| Paleta | dark `#0F1A13`, tinta `#1B1F14`, verdes `#1E3D28 / #2E5C3E / #3D7050 / #4E8C64`, cream `#F4EFE6`, surface `#FDFAF4`, muted `#F0EAE0`, border `#E3DAC9`, âmbar `#B07A2A`, vermelho `#C0483A` |
| Tipografia | Outfit 300–500 (tracking -0.03em em headings), DM Sans (deck), IBM Plex Mono (labels técnicos/eyebrows) |
| Grafismo | Terreno / ridge lines (4 camadas de verde, ≤40% da altura, sobre mesh gradient) |
| Imagens | 8 imagens de estúdio escuro com fio âmbar |
| Voz | "Antes do erro, não depois." |

### Estrutura (transferível como forma, com valores da Planning)
- **Raio**: `--radius: 0.75rem`, com derivados sm/md/lg e 2xl/3xl/4xl. Cards `rounded-xl`, quadros de meta `rounded-lg`, selos `rounded-full`.
- **Sombra**: só duas, sutis. `--shadow-card: 0 1px 3px rgba(0,0,0,.06), 0 1px 2px rgba(0,0,0,.04)` e hover `0 4px 12px rgba(0,0,0,.08)`. Não há sombra dramática em UI.
- **Espaçamento**: `--space-1..24` em escala de 4px; container `max-w-6xl` / `1200px`; seção de LP com 96px (64px no mobile).
- **Motion**: hover em 100ms com `cubic-bezier(0.25,0.46,0.45,0.94)` (*"padrão Linear"*), `scale 1.02 / 0.98` no active, entrada `fade-in-up 0.6s`. Na UI, a transição fica em `transition-shadow`.
- **Hover em card**: sobe a sombra, sem mudar de cor. Foco sempre com `focus-visible:ring-2 ring-ring`.
- **Ícones**: lucide, `size-3`/`3.5`, `aria-hidden`, e sempre acompanhados de palavra. No selo: Check = ok, ArrowUp = fora, TrendingUp = esticar, Clock = dia em curso, TriangleAlert = atenção.
- **Números**: KPI em `text-2xl font-semibold tracking-tight text-foreground`. O comentário diz *"cor de série e dourado não são para valor"*. Algarismo proporcional em número grande, tabular em tabela.
- **Status**: trio positive/warning/negative, cada um com `-subtle` (fundo) e `-text` (texto AA). "Fora" ganha borda cheia + anel: *"quem está fora grita"*.
- **Gráficos**: recharts sobre shadcn. Séries validadas para daltonismo, rampa sequencial para etapas, um eixo por gráfico, dark com passos próprios em vez de inversão automática.

---

## 3. Navegação e arquitetura de informação do dashboard Recon

1. **Uma tela, uma história**: *"anúncio → lead → pipeline → receita"* e o esforço que a produziu. As abas SDR IA e Produtividade foram fundidas em tela única em 17/09.
2. **Ordem de leitura**: filtro fixo no topo → 5 quadros de meta (ritmo contra meta, com selo) → bloco Campanha (funil + leads por dia → 8 KPIs → séries → distribuições → tabelas por campanha e por anúncio).
3. **Filtro global que recorta tudo**, incluindo as metas, e o título avisa quando há filtro ligado. Presets de período (Hoje / 7 / 30 / 90 / Mês / Personalizado), com dia contado no fuso de São Paulo.
4. **Tudo abre a lista nominal**: *"Qualquer quadro, indicador, etapa do funil, barra ou linha de campanha abre a gaveta lateral com os leads pelo nome"*. Cada linha expande no lugar (ficha, atividades, notas buscadas sob demanda). Investimento abre gaveta de campanhas, que expande em anúncios. Na prática, o drill-down funciona como auditoria (`KpiCard` → `onAudit`).
5. **"Como contamos"** num diálogo e fórmula no tooltip `Info` de cada quadro.
6. **Métrica de ritmo** (por dia útil), que não depende do tamanho do período. Período em curso ganha marca ("11 de 22 dias úteis") em vez de uma barra que parece fracasso.
7. **Estados honestos**: skeleton no carregamento, alerta "Leitura parcial" que lista os avisos do servidor, e "sem dado / sem histórico / sem SDR" no lugar de zero.
8. **Um quadro por pergunta**: "Negócios por etapa" saiu porque *"dizia a mesma coisa do funil em outro desenho"*.

Nota: o funil foi *"redesenhado no molde do painel Mkt e Vendas da Planning"* e os quadros de meta *"seguem o painel de metas do dash do Mapa"*. O método já circulou da Planning para o Recon.

---

## 4. Pontos fracos do Conciliador

1. **O Playbook 7 Níveis é de LP, não de produto.** Ele vem de uma transcrição de vídeo e fala de Awwwards, teardown, vídeo no hero, glass morphism, contadores e light sweep. Não diz nada sobre dashboard, densidade, acessibilidade, estados vazios ou dataviz. Um trecho contradiz a disciplina de marca: *"Consistência forçada — não tenha medo de mudar paleta/tipografia entre seções"*. A qualidade do dashboard não veio dele.
2. **O portão de auditoria não cobre dashboard.** A skill é do workflow MKT; o DEV tem *"Audit: Manual"*. Na rubrica, visual vale só 12,5/100, medido por "Playbook nível 3", sem contraste AA, cor-como-único-sinal, drill-down ou estados. O rigor do dashboard veio de verificação ad hoc, não do sistema.
3. **Ponteiros quebrados ou velhos nas diretivas:**
   - `AGENTS.md` cita `_sistema/brand/conciliador-brandbook.pdf`, que não existe mais (foi para `legacy-conciliador-pre-rebrand/`), e `_shared/Estudo_Estrutural_V3_Recon.md`, que também não existe (só há `..._V3_Conciliador.md`).
   - `mkt-planner` lê `_sistema/brand/conciliador-brandbook.*` (marca aposentada).
   - `component-writer` manda ler brand em `directives/brand/` (não existe) e trata essa leitura como **"Opcional"**.
   - `conciliadorai-main/architecture.md` aponta para `directives/`; o `index.css` ainda diz *"Coinest-inspired … DM Sans"*.
4. **A spec de design system nunca foi executada.** `conciliadorai-main/specs/design-system-tokenizado.md` prevê um `design-system.md` canônico, a página `/style-guide`, motion tokenizado e escala tipográfica de produto. Nada disso existe: não há `StyleGuide.tsx` nem o doc.
5. **Dois dialetos de token para a mesma marca.** A LP usa `--ink-*/--green-*` com CTA `#3D7050`; o app usa HSL shadcn com `primary` `#1E3D28`. Há também o hack `serif: ['Outfit']` no Tailwind.
6. **O melhor trabalho não está versionado.** Em `lp-recon-marketplace`, `git status` mostra `?? app/`, `?? dashboard-README.md`, `?? architecture.md` e `?? specs/`: dashboard, testes e edge functions fora do git.
7. **Resíduos no dashboard.** Ainda há fonte pequena (`text-[11px]` ×6, `text-[0.7rem]` uppercase ×6); `DashboardPage.tsx` tem 880 linhas; o README tem 32 KB e pesa para quem chega agora; componente com nome de pessoa (`MetasWill`); acesso sem senha por decisão registrada (trade-off de CRM exposto a quem tiver a URL da função).
8. **Custo de processo.** O workflow MKT de 4 etapas + audit é pesado para um ajuste de tela. E ele funciona porque o Pedro itera em cima: o sistema só registra o gosto dele, não o substitui.

---

## 5. Transplante para o Planning Brain

### Diagnóstico do lado Planning (medido)
- `PM Work/planning-design-system/` **existe**: `brand-dna.md`, `design-tokens.json`, `dataviz-guide.md` (skill dataviz aplicada, *"validada por script"*), `patterns.md` (layout de cockpit, estados, forms), AA validado, componentes shadcn e doc viva em HTML. Em rigor, está no nível do Recon.
- Ele é usado em `mapa-tributario-dashboard`, `brain-financeiro-planning`, `conferidor-folha` e `caixa-oportunidade-dashboard`, mas **não no Planning Brain / Ops**:
  - O `AGENTS.md` do app (`planning-brain-cockpit-piloto-20260922/app/AGENTS.md`) tem 15 linhas e **nenhuma** diretiva de design; manda ler só o `DECISIONS.md` (2.270 linhas de produto e dados).
  - `src/styles.css` usa **Poppins**, enquanto o DS define **Bw Glenn Sans → Inter**. O cabeçalho do arquivo diz *"verde mint vibrante (#2EE5A8)"*, mas o token real é `#0ae18c`: o comentário mente sobre o valor.
  - São **230** usos de fonte de 9–11px (`text-[11px]` ×132, `text-[10px]` ×98) contra 7 no dashboard Recon, e **80** hex literais em `.tsx` contra 0.
- O roteador de `PM Work/AGENTS.md` manda "Frontend/design → estudo-de-marca **Recon** OBRIGATÓRIO" sem distinguir frente. Uma sessão de Planning Brain aberta em PM Work é empurrada para a Tessera, o que é um risco de fronteira (a marca Recon vazar para a Planning).

### Copiar como MÉTODO
1. **Estudo de marca de 1 página para a Planning**, condensado de `planning-design-system/foundations/brand-dna.md` + `design-tokens.json`, no formato do Recon: tabela token → hex → papel, pesos permitidos, "Nunca/Sempre", arquivos prontos.
2. **Ligar esse documento ao roteador**:
   - No `AGENTS.md` do app Planning Brain: *"Antes de qualquer tela, ler `<estudo-de-marca Planning>` + `patterns.md` + `dataviz-guide.md`"*.
   - Em `PM Work/AGENTS.md`: tornar o passo 3 condicional por frente (Recon → Tessera; Planning → DS Planning).
   - Precisa de decisão humana: o Ops é repo do Eliezek, e a memória registra "pergunte".
3. **Tokens com o porquê em comentário**: status reservados (sempre com ícone + palavra), séries validadas pelo script da dataviz, rampa sequencial para funil e passos próprios no dark. Corrigir o comentário `#2EE5A8` vs `#0ae18c`.
4. **Duas regras mecânicas com grep no QA**: zero hex em componente e piso de 12px para texto.
5. **Contrato de significado por tela** (modelo `dashboard-README.md`): o que cada número pergunta, qual data conta, zero vs sem dado, "três caixas quando o dado atravessa o corte", um eixo por gráfico, e log "o que saiu e por quê".
6. **Todo número abre os registros** (gaveta com lista nominal). Isso vale como regra de IA do cockpit, não como enfeite.
7. **Lógica pura + testes** em `features/<x>/*.ts`, com a tela só renderizando.
8. **Verificação independente antes de dar por pronto**: recontar na fonte (Pipedrive/Omie) e testar a tela tentando refutá-la.
9. **Portão de UI no DEV**: uma rubrica curta de produto (AA, cor nunca como único sinal, drill-down, estados vazio/erro/parcial, densidade, tabular nums, um objetivo por tela). A rubrica MKT não serve para isso.
10. **Estilo da casa para imagem** com sufixo de prompt + `_descartadas/`. Isso já existe em `monetizacao/marca/banco-imagens/`; para o Planning Brain só é preciso se houver imagem.

### NÃO copiar
- Tessera, logos, paleta verde/cream/âmbar, Outfit/DM Sans/Plex Mono, ridge lines, banco de imagens e a voz "Antes do erro". Nenhum hex do Recon entra na Planning. Também não copiar o `index.css` do Recon "e trocar as cores": ele tem comentários de validação que só valem para aqueles valores.
- Os truques de LP do Playbook (vídeo no hero, glass morphism, contadores, light sweep, ticker) em ferramenta interna.
- O workflow MKT de 4 etapas para ajuste de tela (é pesado demais); basta ler a marca + checar a rubrica.
- Acesso sem senha e componentes com nome de pessoa.
- Deixar app/dashboard fora do git.
