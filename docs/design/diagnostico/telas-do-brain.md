# Auditoria de UX/UI e front-end: Planning Brain

Data: 23/09/2026. Auditoria só de leitura: nenhum arquivo de repositório foi alterado e nenhum servidor foi iniciado.

## 0. Versão analisada e ressalvas

| Repositório | Versão lida | Observação |
|---|---|---|
| Ops (revenue-auditor-hub) | `planningbrainbot/revenue-auditor-hub` **origin/main `2350a0a` (22/09 14:53)**, exportado com `git archive` para `scratchpad/snap/` | É a ponta mais recente de uma `main`. O checkout "principal" (`execution/revenue-auditor-hub`) tem origin = `victoreliezek/revenue-auditor-hub`, e o origin/main dele está em `2a93602` (15/09), numa branch de feature com arquivos alterados. O worktree `planning-brain-filtros-multi` (HEAD `aa16914`) está 7 commits à frente dessa main e 1 atrás de `2350a0a`. |
| brain-web (Growth) | `master` / origin/master `b0c1400` (14/09) | Há 1 arquivo não versionado (`docs/spec-acesso-growth-20260920.md`). |
| brain-financeiro-planning | `main` = origin/main `74ea0be` (21/09) | Árvore limpa. |

**Não verifiquei** qual commit está publicado em `planningbrain.com.br`: para isso seria preciso a API da Vercel (`meta.gitCommitSha`), e eu não consultei nada de produção. Há também uma contradição de documentação: `AGENTS.md` do Ops diz "repo victoreliezek, `git push origin main` já dispara o deploy", mas a memória do workspace e os registros de 17/09 dizem que o deploy é feito pela CLI da Vercel e que o push não publica nada. Os números abaixo valem para `2350a0a`. Os achados principais (Toaster, `hsl(var())`, cabeçalhos) também foram conferidos no `origin/main` do victoreliezek e se repetem lá.

---

## 1. Inventário de módulos, rotas e telas

### 1.1 Mecânica
- Roteamento por arquivo (TanStack Start): 56 rotas em `src/routes/_authenticated/` e 4 na raiz (`auth`, `redefinir-senha`, `trust`, `__root`).
- A barra lateral vem de uma fonte única, `src/lib/areas.ts` (`AREAS`, 8 áreas). O filtro é aplicado em `src/components/app-sidebar.tsx:116-142`: a pessoa vê a área se tiver `temArea(slug)` e vê o item se tiver `can(chave)`.
- A lateral mostra **uma área por vez**. A troca de área fica num dropdown no cabeçalho da lateral (`app-sidebar.tsx:205-277`). A Administração saiu do seletor e foi para o rodapé (`app-sidebar.tsx:73-82`, `307-347`).
- A entrada depende do papel (`routes/_authenticated/index.tsx:23-60`): o sócio regional vai para `/painel-unidade`. Quem tem mais de um produto vai para `/inicio`, uma tela de escolha sem moldura (`route.tsx:43`). Os demais vão para `/rede-overview`.
- Os produtos irmãos (`/growth`, `/financeiro`) aparecem como `<a>` no mesmo seletor (`app-sidebar.tsx:256-273`).

### 1.2 Módulos do menu

Legenda do veredito: **Ação** = a tela leva a pessoa a agir. **Consulta** = a tela só expõe informação. **Misto** = tem ação, mas ela não é o centro da tela.

| Área (slug) | Item → rota | O que mostra | Ação principal esperada | Veredito |
|---|---|---|---|---|
| **Rede** (`rede`) | Overview → `/rede-overview` (1.462 linhas) | 4 abas (Visão Geral, Vendas & Unidades, Financeiro, Qualidade & CS), 6 KPIs, cerca de 8 gráficos, filtro de unidade e datas (`rede-overview.tsx:890-951`) | Achar a unidade ou métrica fora da curva e aprofundar | **Consulta.** Os únicos atalhos são 3 cliques que levam a `/clientes` (`:979,993,1182`). Nenhum alerta e nenhuma comparação com meta. A aba ativa não fica na URL (`Tabs defaultValue`, `:946`). |
| | IDU → `/idu` | Índice por unidade (componente `idu/`) | Ver quem está abaixo e cobrar | Consulta |
| | Indicadores do Trimestre → `/indicadores-trimestre` | Cards de indicadores (`indicadores-trimestre-view.tsx`, `CardKPI` próprio) | Acompanhar o pacto trimestral | Consulta |
| | Realizado Unidades → `/rede-realizado` | Métricas por unidade no tempo | Comparar unidades | Consulta. O título da página é outro ("Realizado por Unidade"). |
| | LTV Estimado → `/rede-ltv` | LTV por cliente e unidade | Não há ação clara | Consulta |
| | Headcount → `/rede-headcount` | Admissões, demissões e turnover | Não há ação clara | Consulta. A página tem 3 `<h1>` (`:131,189,203`). |
| **Base de clientes** (`clientes`) | Base de clientes → `/clientes` (`components/clientes/base-unica.tsx`) | Menu próprio de 5 visões, filtros, "funil de refinamento" (Bruta → CNPJ → contato → ECD), tabela, exportação | Validar origem, montar lista e enviar ao CRM | **Ação.** É a tela mais orientada a ação do Ops: "Validar origem", "Exportar recorte", pendências com contador (`base-unica.tsx:208-223`). |
| | CS → `/painel-cs` | Abas Onboarding, Tratativas e Saúde da carteira | Tratar churn e risco | Misto. `Tabs defaultValue` (`painel-cs.tsx:25`); o estado de carregamento é texto solto. |
| | Auditoria Interna → `/auditoria-interna` (1.067 linhas) | Fases e KPIs de auditoria por unidade | Acompanhar e cobrar | Consulta |
| | Reforma Tributária → `/reforma-tributaria` | Gera apresentação a partir de arquivo de simulação | Gerar e baixar o HTML | **Ação** ("Baixar HTML"), mas o título usa `text-sm`, diferente de todas as outras páginas (`:255`). |
| | NPS → `/nps` | Painel e execução de NPS | Disparar campanha e registrar ligação | **Ação** ("Disparar campanha", "Registrar tentativa de ligação"). |
| | Disparos de WhatsApp → `/disparos-whatsapp` | Campanhas | Disparar | Ação. A área de acesso é separada (`disparos_whatsapp`). |
| | Base de Contatos → `/base-contatos` | Contatos | Consultar | Consulta |
| **Receita e Repasses** (`receita`) | Funil de Receita → `/funil-receita` | MRR contratado → faturado → recebido | Achar o vazamento | Consulta |
| | Contas a Receber → `/contas-receber` (617 linhas) | Títulos e KPIs | Cobrar inadimplente | Consulta. Nenhum botão de ação detectado. |
| | Regras da Rede → `/unidades` | Unidades e percentuais de royalty | Manter regras | Misto |
| | Apuração de Royalties → `/unidades/royalties` → detalhe `/royalties/$unidadeId/$mes` (2.368 linhas) | Fechamento mensal | Fechar a apuração, emitir faturas no Omie, gerar demonstrativo | **Ação.** "Fechar apuração", "Emitir faturas no Omie", PDF e Excel. O detalhe não tem breadcrumb de volta. |
| | Histórico de Royalties → `/unidades/historico` | Evolução do valor apurado | Não há ação clara | Consulta |
| | Funil de CAC → `/unidades/funil-cac` | Da venda à cobrança | Cobrar o CAC | Consulta |
| | Split do Asaas → `/unidades/split` | Retenção na fonte | Conferir | Consulta |
| | Comissões → `/comissoes` | Apuração por Closer e SDR | Fechar comissão | Consulta. O título é outro ("Apuração de Comissões"). |
| | EBIT Operacional → `/ebit-operacional` | EBIT por unidade | Não há ação clara | Consulta |
| **Planning People** (`people`) | Minha vez / Meu time / Minha unidade / Rede / Administração → `/gente?visao=…` | Avaliação, PDI, clima, conversas, liderança | Preencher avaliação ou PDI, criar meta | **Ação** (há ações como "Salvar rascunho", "Criar meta" e "Nova ação"), mas a navegação está duplicada (ver §2). |
| **Monetização** (`monetizacao`) | 9 itens → `/monetizacao?aba=…` + Fila Cella → `/fila-cella` | Operação diária, forecast, capacidade, Follow Day, funil, PDI, roteiros, distribuição | Trabalhar a fila de oportunidades, salvar lista, registrar validação | **Ação** ("Salvar lista", "Registrar validação", "Gerar handoff ao Cella", "Registrar toque"). O cabeçalho da página é um logo (`dashboard.tsx:148-153`) e não um título. |
| **Broker** (`broker`) | Fila de oportunidades → `/broker`; Matriz → `/broker/admin` | Fila e matriz | Atualizar, salvar, gerar fatura | Ação |
| **Minha Unidade** (`minha_unidade`, visão do sócio) | Painel `/painel-unidade`, Base, CS, NPS, IDU, Broker; Financeiro: Funil, Contas a Receber, Meus Royalties | As mesmas telas da matriz, recortadas por unidade | Acompanhar a própria unidade | Consulta. O painel do sócio não tem nenhuma ação detectada. |
| **Administração** (`admin`, no rodapé) | Usuários, Níveis, Equipes, Perfis, Permissões, Acessos do Financeiro, Atividade, Chaves de Integração, Integrações, Validação de páginas | Gestão de acesso | Conceder e revogar | Ação. "Chaves de Integração" e "Integrações" usam o mesmo ícone `KeyRound` (`areas.ts`). |

### 1.3 Rotas fora do menu

| Rota | Estado |
|---|---|
| `/operacao` (515 linhas), `/simulador-caixa` (641) | `beforeLoad` redireciona para `/`, então as páginas estão desativadas, mas o código continua no repositório (`operacao.tsx:27-31`, `simulador-caixa.tsx:24-30`). |
| `/pagamentos-unidades` (332), `/financeiro-partners` (75) | **Órfãs vivas:** abrem se a pessoa digitar a URL, mas nada no app leva até elas (`grep` só encontra `page-validations.server.ts`). |
| `/aquario`, `/auditoria`, `/auditoria-faturamento`, `/dre-partners`, `/rede`, `/royalties`, `/royalties/split` | Redirecionamentos de URL legada. Mesmo assim, a Monetização ainda mostra o link "Clientes → Aquário ↗" (`dashboard.tsx:167-169`), e esse nome não existe mais no menu. |
| `/trust`, `/inicio` | Telas públicas ou de entrada, sem moldura. |

---

## 2. Arquitetura de navegação

**Profundidade:** área → grupo → página → (aba) → (detalhe ou diálogo). Chega a 4 níveis. A escolha de área fica escondida num dropdown: quem não abre o seletor não sabe que as outras 6 áreas existem.

**Problemas concretos:**

1. **O cabeçalho global está vazio.** Em `route.tsx:81-83` há `SidebarTrigger` seguido de `<div className="min-w-0 flex-1" />`: nenhum título, breadcrumb ou busca. `components/ui/breadcrumb.tsx` existe, mas **ninguém o importa**. Em telas de detalhe (`/royalties/$unidadeId/$mes`) o caminho de volta depende do botão do navegador.
2. **Dois sistemas de cabeçalho de página convivem.**
   - 19 rotas usam `AppShell` (`components/app-shell.tsx:17-27`): barra fina com `h1` `text-sm sm:text-base`, `ValidationBanner` e `DataFreshnessBar`.
   - Cerca de 30 telas desenham o próprio `<h1>` com 9 combinações diferentes de classes: `text-2xl font-bold` (15), `text-2xl font-semibold tracking-tight` (10), `text-2xl font-semibold` (2), `text-sm font-semibold` (reforma-tributaria), entre outras.
   - Consequência: o aviso de frescor dos dados (Omie, Pipedrive, Tratativas) e o selo "dados em validação" aparecem em algumas páginas e não em outras. Não dá para saber se a data dos dados vale para a tela aberta.
3. **Navegação duplicada entre a lateral e as abas.**
   - People: a lateral tem 5 itens `?visao=` e a página repete os mesmos 5 como `TabsList` (`gente.tsx:66-72`).
   - Monetização: 9 itens na lateral e 9 abas de novo na página (`dashboard.tsx:156-166`). Os rótulos nem batem: "Operação diária" na lateral, "Operação" na aba.
   - Base de clientes: a lateral diz "Base de clientes" e a página tem outro menu de 5 visões (`base-unica.tsx:208`). O commit `8040aa7` ("um menu só") juntou duas faixas numa, mas a duplicação com a lateral continua.
4. **Aba que não fica na URL.** Há 17 `<Tabs defaultValue>` (rede-overview, painel-cs, contas-receber, rede-realizado, fila-cella, auditoria-interna, base-contatos…). Recarregar a página ou compartilhar o link volta sempre para a primeira aba. Isso contradiz o próprio raciocínio de 14/09 no DECISIONS.md ("tela escondida dentro de tela não é favoritável").
5. **O nome no menu difere do título da página.** Exemplos: "Overview" / "Overview — Gestão da Rede"; "Realizado Unidades" / "Realizado por Unidade"; "Comissões" / "Apuração de Comissões"; "Usuários" / "Gerenciar usuários"; "Painel" / "Painel da Unidade"; "Base de clientes" → visão "Contratos da rede"; Monetização → logo "Caixa de Oportunidade".
6. **O produto tem 5 nomes.** "Planning Brain", "Planning" (sufixo de 17 títulos de aba), "Planning Expansão" (`admin.validacao.tsx`), "Ops Board" (subtítulo de `atividade.tsx`) e "Planning Dashboard" (`AGENTS.md`). Só 23 das 56 rotas definem `<title>`.
7. **Os mesmos destinos aparecem em mais de uma área.** `/clientes`, `/painel-cs`, `/nps`, `/idu`, `/funil-receita` e `/contas-receber` estão tanto em "Minha Unidade" quanto nas áreas da matriz. O código trata isso bem (a área vem da rota), mas numa URL compartilhada o grifo pode acender a área "errada" para quem tem as duas, porque `areaDaRota` pega a primeira correspondência (`app-sidebar.tsx:166-168`).
8. **Filtros sem padrão.**
   - Datas em `<input type="date">` nativo em rede-overview (`:919-934`), enquanto o shadcn tem `calendar.tsx`.
   - Unidade em `Select` shadcn (rede-overview) ou em `<select>` nativo (base-unica `:232-253`): 44 `<select>` nativos contra 110 `<Select>`.
   - Seletores de período diferentes ("Hoje / 7 dias / Mês" na Monetização).
   - Nenhum filtro persiste entre páginas. O "filtro de unidade por pessoa" existe na permissão, mas não como filtro global.
9. **Estados de carregamento, vazio e erro sem padrão.**
   - Carregando: 82 textos "Carregando…" soltos (ex.: `painel-cs/onboarding-tab.tsx:230`, `saude-carteira-tab.tsx:184`). `Skeleton` aparece em só 14 arquivos.
   - Erro: cada tela faz o seu (`rede-overview.tsx:938-943` usa um Card vermelho).
   - Vazio: há 30 frases do tipo "nenhum … encontrado" ou "sem dados" e nenhum componente `EmptyState`. O único componente de estado é `LoadingState` em `monetizacao/common.tsx:101`.
10. **Feedback de ação invisível** (ver Top 10, item 1): nenhum `<Toaster/>` está montado.
11. **Confirmação nativa do navegador:** 20 chamadas de `confirm()` para ações destrutivas (ex.: `admin.integracoes.tsx:265`, `equipe.tsx:396`, `dre-projetada/itens-view.tsx:124`), apesar de `alert-dialog.tsx` existir.
12. **A moldura mistura idiomas:** `<html lang="en">` (`__root.tsx:111`) e uma página 404 em inglês ("Page not found", `__root.tsx:21`) num app em português.

---

## 3. Estilo visual atual (Ops)

**Base técnica**
- Tailwind **v4**. Não existe `tailwind.config`: tudo fica em `@theme inline` em `src/styles.css:14-56`.
- As variáveis do shadcn estão em **hex**, não em HSL (`styles.css:72-142`).
- Paleta da marca: fundo `#f4f7f9`/`#06090b`, card `#ffffff`/`#10171c`, primária `#0ae18c`, texto e borda de destaque `#00875a` no tema claro, e destrutiva `#c0392b`/`#ff6b5e`.
- Gráficos: `chart-1..5` = `#0ae18c #14c8fa #5b8def #ffc857 #c792ea`.
- `--radius: .75rem`.
- Fonte Poppins (300-700), carregada do Google Fonts em `__root.tsx:95-99`.
- O tema é compartilhado com Growth e Financeiro pelo cookie `pb_tema` (`lib/tema-compartilhado.ts`). O padrão é escuro.

**Medições por grep em `src/`** (330 arquivos):

| Métrica | Valor |
|---|---|
| Hex `#rrggbb` fora de `styles.css` | 134 ocorrências. Parte é legítima: e-mail e gerador de HTML somam cerca de 47. Os demais ficam em gráficos e tabelas: `audit/overview-tab.tsx` 11, `simulador-caixa` 10, `fxc-view` 10, `monetizacao/dashboard` 5… |
| `hsl(...)`/`rgb(...)` literais | 94 |
| Cores cruas do Tailwind (`bg-amber-100`, `text-emerald-600`…) | **1.650 ocorrências em 93 arquivos**: amber 430, emerald 377, red 309, slate 187, orange 75, sky 70, indigo 60, blue 59, purple 45… |
| Variantes `dark:` | 607. As cores cruas são compensadas uma a uma para o tema escuro, o que é caro de manter. |
| Tokens semânticos (`bg-primary`, `text-muted-foreground`…) | cerca de 2.675 usos. A base é boa. |
| `text-[10px]` / `text-[11px]` / `text-[9px]` | 87 / 113 / 4, somando 209 tamanhos arbitrários. Isso mostra que a escala tipográfica não dá conta da densidade de dashboard. |
| `bg-[` / `border-[` | 1 / 1 |
| `style={{…}}` | 47 |

Não há token de **status** (positivo, atenção, negativo, info). Verde, âmbar e vermelho de status são escritos à mão com emerald, amber e red em cada tela. Esse é o motivo das 1.650 cores cruas.

**Gráficos**
- Recharts 2.15, importado em 25 arquivos. O `ChartContainer` do shadcn (`components/ui/chart.tsx`) existe e é usado em **0** arquivos.
- Cada tela define sua própria paleta, por exemplo `COLORS` em `audit/cac-tab.tsx:29`, `painel-cs/onboarding-tab.tsx:47`, `ebit-operacional-view.tsx:37`, `auditoria-interna.tsx:75` e `simulador-caixa.tsx:41`. São quase sempre a paleta padrão do Tailwind (`#6366f1 #10b981 #f59e0b #ef4444 #8b5cf6 #ec4899`), **não a da marca**. As variáveis `--chart-*` aparecem em só 3 lugares.
- **Bug de renderização:** 40 ocorrências de `hsl(var(--x))` em 16 arquivos (ex.: `royalties-historico-content.tsx:425-445`, `auditoria-interna.tsx:896`, `ebit-operacional-view.tsx:37`, e sombras de cabeçalho em `contas-receber-view.tsx:273`).
  - Como as variáveis são hex, o navegador recebe `hsl(#dde4e9)`, que é CSS inválido.
  - Efeito provável (não confirmei com captura de tela): grade e eixos sem traço, tooltip sem fundo, barras "primárias" pretas ou sem preenchimento, e a sombra do cabeçalho fixo não aparece.
  - Origem: a troca da paleta de HSL para hex (comentário em `styles.css:62-71`) não varreu os consumidores.

**Outros componentes**
- Ícones: lucide-react 0.575, em 109 arquivos. `app-sidebar.tsx:3-36` importa cerca de 30 ícones que não usa, resto de quando o menu vivia ali.
- Botões:
  - Variantes usadas: `outline` 159, `ghost` 60, `secondary` 32, `destructive` 14, `default` explícito 2. Tamanhos: `sm` 110, `icon` 37.
  - Há ainda **159 `<button>` crus** contra 243 `<Button>`, e cada `<button>` cru tem classes próprias. Exemplos: abas feitas à mão com `border-b-2` em 6 arquivos, e o botão "Sair" do cabeçalho em `route.tsx`.
  - Como `outline` domina e `default` quase não aparece, a ação principal raramente se destaca visualmente.
- Cards: `Card` shadcn, com 70 KPIs escritos direto no JSX (`<Card className="p-4">` + rótulo `text-xs`) e mais cerca de 20 componentes de KPI locais (§5).
- Tabelas: 91 `<table>` crus contra 63 `<Table>` shadcn. `pagination.tsx` não é usado: as listas longas não têm paginação padronizada.
- Componentes de `ui/` que ninguém importa: `alert`, `avatar`, `breadcrumb`, `chart`, `form`, `pagination`, `scroll-area`, `sonner` (!), `toggle`.

---

## 4. O design system da Planning é usado?

| Repositório | Usa? | Evidência |
|---|---|---|
| **Ops** (revenue-auditor-hub) | **Não.** Só a paleta da marca foi copiada à mão. | Não aparece nada de `Bw Glenn`, `planning-tokens`, `@planning/design-system`, `StatTile`, `usePlanningPalette`, `--positive*`, `--warning-text` nem `brand-gradient`. O comentário em `styles.css:7-12` diz "Planning Design System", mas os valores são outros: hex em vez de HSL; Poppins em vez de Bw Glenn/Inter; `chart-2` ciano em vez de laranja (DS `css/planning-tokens.css`: `--chart-2: 22 96% 53%`); raio .75 contra .625; e sem tokens de status. Nenhum `EmptyState`/`ErrorState` do DS. |
| **brain-web** (Growth) | **Não.** | Tem um vocabulário próprio de tokens herdado do "painel v20": `--color-bg`, `--color-line`, `--color-green`/`--color-green-fill`, `cc1..8` (`src/app/globals.css:1-80`), com `data-theme` em vez de `.dark`. Não usa shadcn (não há `components/ui`). A única menção ao DS é um comentário sobre fonte em `src/app/layout.tsx:8`. A fonte é Poppins, via `next/font`. Tem 811 `text-[…]` e 104 hex em TSX. |
| **brain-financeiro-planning** | **Sim, parcialmente.** É o único. | `src/index.css:1-60` declara "Planning Design System — token layer (fonte: planning-design-system)" com as variáveis HSL do DS e `@font-face` de Bw Glenn Sans (com fallback para Poppins). `tailwind.config.ts:14-22` também. Tem `src/components/planning/index.ts` com `KpiCard`, `EmptyState`/`ErrorState` (17 arquivos usam), `usePlanningPalette`, `planningAxis`, `planningGrid` e `PlanningTooltip`, além de um `PageHeader` único (15 arquivos). Em 15/09, `destructive` e as cores de gráfico foram alinhadas **ao Ops**, e não ao DS. |

A pasta do DS (`PM Work/planning-design-system`, de julho de 2026) oferece tokens HSL, status semânticos, `stat-tile`, `chart.tsx` com paleta validada para daltonismo e `patterns/states.tsx`. É justamente o que falta no Ops.

---

## 5. Contagens (Ops)

| Item | Número |
|---|---|
| Rotas de página | 60 no total. Destas, 56 são autenticadas: cerca de 43 são telas reais, 9 são redirecionamentos, 2 estão desativadas e 2 são órfãs vivas. |
| Itens de menu | 55, somando as 8 áreas. Alguns destinos se repetem (§2.7). |
| Componentes shadcn em `components/ui` | 34, dos quais 9 não são usados. |
| Componentes de domínio (`components/**` fora de `ui`) | 114 arquivos `.tsx` em 30 pastas, além de 12 `.tsx` soltos. |
| Implementações de KPI card | **20 definições locais** (`KpiCard` ×5, `Kpi` ×8, `KpiCards`, `CardKPI`, `StatCard`, `Stat`, `Metric`…), por exemplo em `audit/kpi-card.tsx:22`, `audit/mensalidades-tab.tsx:234`, `audit/omie-sem-pipedrive-tab.tsx:144`, `audit/historico-mensal-tab.tsx:254` e `audit/vendas-pipedrive-tab.tsx:171`. Estas quatro últimas têm assinatura idêntica, `{label,value,sub,tone}`. Também `broker-admin-view.tsx:79` e `broker-unidade-view.tsx:178`, que são idênticas; `contas-receber.tsx:593` e `financeiro-partners/contas-receber-view.tsx:323`. Soma-se a isso cerca de 70 KPIs escritos direto no JSX. |
| Padrões de cabeçalho de página | 2 sistemas (`AppShell` e `<h1>` próprio) com 9 variações de classe no `h1`. |
| Padrões de aba | 3: `Tabs` shadcn (20 arquivos), `<button role=tab>` com `border-b-2` (monetização, base-unica…) e a lateral fazendo papel de aba (People, Monetização). |
| Paletas de gráfico locais | pelo menos 8 constantes `COLORS`/`*_COLORS`. |
| Chamadas a `toast()` | 204, em 42 arquivos, **sem `Toaster` montado**. |

---

## 6. Modo preview ou mock

- **Existe, mas só para o Cockpit do CEO.** O script é `execution/planning-brain-cockpit-piloto-20260922/app/scripts/cockpit-ceo/preview.sh`, na branch local `feat/cockpit-ceo-piloto`, **sem remote**. Ele aponta o Supabase para `http://127.0.0.1:9` (um endereço morto) e serve só `/piloto/cockpit-ceo` com fonte sintética. Todas as outras rotas redirecionam para `/auth`. O Jev só liga com a chave do Keychain.
- `local-producao.sh` (porta 8081) lê produção com a sessão da pessoa, ou seja, exige login real. **Não rodei.**
- O `main` do Ops **não tem modo mock**. Para ver as outras 40 telas é preciso sessão Supabase real.
- Há 13 capturas prontas em `docs/dev_notes/cockpit-ceo-piloto/capturas/`. A `01-primeira-dobra-1440x900.png` mostra um padrão visual bem mais coeso do que o do resto do app: KPI com rótulo de categoria, "o que ameaça o resultado", "decisões que pedem sua atenção" com botão de destino, e procedência declarada. **Nenhum servidor foi iniciado nesta auditoria.**

---

## 7. Regras de UI já registradas (AGENTS.md, CLAUDE.md, DECISIONS.md)

- `AGENTS.md` (15 linhas) pede apenas que se leia e atualize o `DECISIONS.md`. A seção de deploy dele está desatualizada (ver §0). `CLAUDE.md` é só `@AGENTS.md`. Não existe guia de estilo nem `architecture.md` no Ops.
- `DECISIONS.md` (2.056 linhas, 116 entradas) registra estas decisões de UI:
  - **14/09, "três produtos, casca única"** (`~l.934`): a moldura comum é lateral esquerda, trocador de produto, paleta da marca, Poppins e tema por cookie. A decisão recusa fundir os apps.
  - **14/09, "Receitas Partners vira cinco páginas irmãs"** (`~l.1071`): cada aba vira uma URL própria porque "tela escondida dentro de tela não aparece em busca, não é favoritável e não tem título". O grifo passa a ser do caminho mais específico. Esse princípio não foi aplicado às 17 `Tabs defaultValue` nem às visões de People e Monetização.
  - **16/09**: a Administração sai do seletor e vai para o rodapé. O financeiro da unidade vira uma área própria.
  - **11/08**: o Overview é reorganizado em 4 abas, com filtro de período padrão no ano corrente.
  - **17/09, Base de clientes**: estudo de UX em `docs/dev_notes/base-clientes-listas-ux/estudo.md` e protótipo em `public/estudos/base-clientes-listas.html`. A proposta Base / Oportunidades / Listas foi marcada como "não implementada no fluxo real". Ainda não conferi quanto dela entrou depois de `8040aa7`.
  - **17/09, recuperação de senha**: layout de e-mail com `#0ae18c`, `#10171c` e `#f4f7f9`.
  - **10/07**: o cabeçalho fixo nas tabelas de royalties foi **revertido**, e só a coluna Cliente continua fixa.
  - **22/09**: o PostgREST corta resultados em 1.000 linhas, e o padrão `.limit()` se repete em cerca de 20 pontos. Isso afeta listas sem paginação.
- Não existe regra escrita para cabeçalho de página, KPI, estado vazio, paleta de gráfico ou tokens de status.

---

## Top 10 problemas de UX/UI por impacto

1. **Nenhum `<Toaster/>` está montado**, então os 204 `toast()` de sucesso e erro em 42 arquivos não aparecem. Quem salva, envia ao CRM, dispara WhatsApp ou emite fatura e recebe um erro não vê nada. Evidência: `grep Toaster src` só encontra `components/ui/sonner.tsx`. Correção: uma linha em `__root.tsx` ou `route.tsx`.
2. **Gráficos com `hsl(var(--token))` sobre tokens hex** geram CSS inválido em 40 pontos de 16 arquivos (Royalties, EBIT, Auditoria Interna, LTV, Headcount, Realizado, Contas a Receber…). Eixos, grades, tooltips e barras primárias provavelmente renderizam sem cor ou em preto.
3. **A maioria das telas só mostra informação e não leva a nenhuma ação.** Rede (6 telas), Contas a Receber, Funil de Receita, Funil de CAC, EBIT, LTV e o Painel do sócio não têm próximo passo, alerta, meta nem link para onde agir. O Cockpit piloto mostra o padrão que falta: "o que ameaça" e "decisões que pedem atenção".
4. **A navegação está duplicada e inconsistente.** A lateral repete as abas da página (People com 5, Monetização com 9) e ainda há 3 implementações de aba. Os rótulos da lateral não batem com os títulos, e a Monetização não tem título (só um logo).
5. **O estado de aba e de filtro se perde** em 17 telas com `Tabs defaultValue`, filtros que não vão para a URL e nenhum filtro global de unidade ou período. O link compartilhado não reproduz a tela.
6. **Não há contexto de posição:** o cabeçalho global está vazio, não há breadcrumb (o componente existe e não é usado) e a área só aparece dentro do dropdown. Nas telas de detalhe, como `/royalties/$unidadeId/$mes`, não há caminho de volta.
7. **Dois sistemas de cabeçalho de página.** O frescor dos dados e o selo "em validação" aparecem em 19 telas e somem nas outras 30, então a confiança no número varia de página para página.
8. **Não há tokens de status e as cores são cruas:** 1.650 classes emerald, amber ou red em 93 arquivos, 607 `dark:` para compensar, e paletas de gráfico fora da marca (roxo `#6366f1` e rosa `#ec4899` do Tailwind). A cor não carrega significado de forma consistente.
9. **Estados de carregamento, vazio e erro sem padrão:** 82 "Carregando…" em texto, Skeleton em só 14 arquivos, nenhum EmptyState ou ErrorState, 20 `confirm()` nativos para ações destrutivas, e `lang="en"` com 404 em inglês.
10. **Componentes duplicados e código morto:** 20 variações de KPI card mais cerca de 70 inline, 91 tabelas cruas sem paginação, 9 componentes de `ui` sem uso, cerca de 1.150 linhas de páginas desativadas (`operacao`, `simulador-caixa`), 2 rotas órfãs vivas, cerca de 30 imports sem uso na lateral e dados fixos na interface (os IDs dos donos 28381245 e 27369179, "Matheus Carvalho" e "Samira Vieira", em `monetizacao/dashboard.tsx:126`).

## O que já está bom e deve ser preservado

- **A lateral vem de uma fonte única e é filtrada por permissão de área** (`lib/areas.ts` + `app-sidebar.tsx`). A área ativa vem da rota, e não de um estado solto. O grifo é do caminho mais específico. Isso já responde a vários anti-padrões comuns.
- **A casca é a mesma nos três produtos:** a mesma paleta de marca, Poppins, tema compartilhado por cookie `pb_tema` (padrão escuro) e trocador de produto no mesmo domínio, sem abrir outra aba (DECISIONS 14/09).
- **Os tokens semânticos do shadcn estão bem adotados** (cerca de 2.675 usos). O cuidado de contraste no tema claro também, com verde vivo só em preenchimento e `#00875a` em texto (`styles.css:62-71`).
- **URLs estáveis com redirecionamento das legadas.** O desmembramento de `/unidades` em páginas irmãs com título próprio é o modelo certo e deveria valer para as abas restantes.
- **Base de clientes** (`base-unica.tsx`): o "funil de refinamento" é clicável, as pendências têm contador, os filtros ficam na URL (`validateSearch`) e há exportação e "Validar origem". É a tela do Ops mais orientada a ação.
- **Apuração de royalties**: tem fechamento, emissão no Omie com prévia do que vai e do que não vai, e demonstrativos. É um fluxo de trabalho de verdade.
- **`DataFreshnessBar` e `ValidationBanner`**: a ideia de declarar a procedência e o frescor do dado é valiosa. Só falta estar em todas as telas.
- **O padrão visual do Cockpit do CEO (piloto)** e **a camada `components/planning` do Financeiro** (KpiCard, EmptyState/ErrorState, `usePlanningPalette`, PageHeader) são os melhores candidatos a fonte para padronizar o Ops.
- **`DECISIONS.md` como memória de produto:** o registro de porquês é raro e útil. Vale acrescentar ali as regras de UI que ainda não existem.
