# Revisão final: feat/design-system-v2-20260923

- **Base:** `eea3d90`. **HEAD revisado:** `b4f8c73` (a branch andou durante a revisão: começou em `04f0ab3`, e os dois commits novos só trazem capturas e o comparativo).
- **Método:** leitura do diff inteiro. Os arquivos de tela foram lidos por um diff que ignora espaço e className, para achar lógica mexida. Também usei scripts de conferência, todos no scratchpad: classes contra `@theme`, `var(--x)` contra as variáveis declaradas, cálculo de contraste, e o codemod rodado de novo sobre `eea3d90` numa cópia, para comparar com o HEAD.
- **Aviso sobre a árvore de trabalho:** às 12:39–12:41, enquanto eu só lia, outro processo alterou 20 arquivos sem commitar (`git status`). Entre eles estão `audit/kpi-card.tsx` (virou adaptador do KpiCard do DS), `planning/kpi-card.tsx` e `painel-unidade.tsx`. Nenhum comando meu grava em `src/`: rodei o codemod com `--dry` e o lint sem `--baseline`. Esses arquivos em andamento **não** foram revisados. Tudo abaixo se refere ao que está commitado em `b4f8c73`.

## Nada bloqueia o PR

### Deve corrigir

**D1. Texto de status com opacidade fica abaixo de AA no tema claro.**
Os pares `*-soft` + texto do status foram calibrados em cerca de 4,7–4,9:1, sem folga. Quando se aplica `opacity-75/80`, ou `text-X/80`, sobre esse par, o contraste medido cai:

| Opacidade | success | warning | danger | info |
|---|---|---|---|---|
| 80% | 3,45 | 3,55 | 3,70 | 3,36 |
| 75% | 3,16 | 3,26 | 3,41 | 3,09 |

Antes o par era emerald-900 sobre emerald-50 (cerca de 10:1) e aguentava a opacidade.

Onde acontece:
- `src/components/audit/kpi-card.tsx:35` (rótulo `opacity-80`) e `:48` (`sub` com `opacity-75`), com os tons emerald/red/orange/indigo. São 25 usos em 10 arquivos: auditoria, contas a receber, pagamentos e outros.
- `src/components/clientes/contratos-clientes.tsx:682,686,700,702`.
- `src/components/audit/conciliacao-3-vias-tab.tsx:253`.
- `src/components/audit/overview-tab.tsx:257` (`text-danger/80`).
- `src/components/audit/unmapped-tab.tsx:145` (`text-warning/80`).

Todos em `text-xs`.

**Cenário de falha:** tema claro, tela de auditoria. A nota do card ("Sem card de churn…", "Investigar…") sai a 3,1–3,4:1.

**Correção:**
- Tirar a opacidade nesses filhos: usar `text-muted-foreground` no texto de apoio, ou o token cheio.
- Pôr no `design:lint` uma regra: `opacity-*` ou `text-(success|warning|danger|info)/NN` no mesmo bloco de um `bg-*-soft`.
- A versão ainda não commitada do `audit/kpi-card.tsx` pode já resolver o primeiro caso. Confira antes do PR.

**D2. O processo do PR C (PROCESSO §3) prevê refazer a branch e rodar o codemod, mas o codemod não reproduz o que foi commitado.**
Rodei `codemod-cores.mjs` sobre `eea3d90` numa cópia. Em 62 dos 100 arquivos o resultado é idêntico ao HEAD. Os **outros 38 diferem**, porque trazem trabalho manual dos commits `c21d977` (gráficos), `86eb236` (PageHeader e revisão) e `04f0ab3` (lint zerado).

Exemplos:
- `fila-cella/badges.tsx`: o codemod gera `bg-success text-background`; o HEAD tem `bg-success-soft text-success`.
- `royalties.$unidadeId.$mes.tsx:1613,1630`.
- `notification-bell.tsx`.
- `hsl(var(--border))` em `pre-planning-tab`, `fila-tabela` e `apuracao-royalties-content`, que o codemod não corrige.
- Todos os PageHeader e as paletas de gráfico.

**Cenário de falha:** no dia do merge alguém segue o §3 ao pé da letra. A tela volta com os selos sólidos e sem PageHeader, e as sombras continuam com `hsl()` inválido. As capturas e a conferência não batem com o que foi aprovado.

**Correção:** no §3, trocar o passo 3 por "rebase ou cherry-pick de c21d977, 86eb236 e 04f0ab3 sobre a main do dia, **depois** rodar o codemod para a tela nova". Ou então separar o PR C em C1 (codemod puro) e C2 (manual).

### Menor

- **M1. `/vitrine` vai no bundle de produção.** Conferi em `.output/public/assets/index-*.js`: `beforeLoad:()=>{throw M6()}`, ou seja, `notFound` incondicional, e a rota não abre. Mesmo assim o chunk `vitrine-*.js`, com 2 mil linhas, é baixável pela URL do asset. O conteúdo é só sintético: os 8 CNPJs têm dígito verificador inválido, o e-mail é `socio@planning.com.br` genérico, e não há chamada a Supabase nem a server fn. **Sem vazamento.** Se quiser, dá para excluí-la do build com um `routeFileIgnorePattern` condicionado ao modo.
- **M2. Três requisições 404 de fonte por sessão.** `src/styles.css:48-68` declara `@font-face` apontando para `/fonts/BwGlennSans-*.woff2`, e `public/fonts/` não existe. O navegador tenta baixar os arquivos (404, ou o HTML do SPA se houver rewrite) antes de cair para Fira Sans. Correção: comentar os `@font-face` até o Mika entregar os `.woff2`.
- **M3. Lateral recolhida sem nome acessível no botão de área.** Em `src/components/app-sidebar.tsx:238-247`, no modo ícone o `PlanningLogo`, o nome e o chevron ficam `hidden`, e o `AnelArea` é `aria-hidden`. O `DropdownMenuTrigger` fica sem nome para o leitor de tela. Correção: `aria-label={areaAtual?.nome ?? "Planning Brain"}` no trigger.
- **M4. `--area-atual` nunca é vazio.** `corDaArea()` devolve `var(--muted-foreground)` quando não há área, e por isso o fallback `var(--area-atual, var(--primary))` (em `ui/sidebar.tsx:511`, `ui/card.tsx` e `kpi-card`) nunca entra. Em `/admin/*`, `/equipe` e outras telas fora de área, o filete do item ativo sai cinza, não verde, ao contrário do que dizem os comentários. Correção: fazer `corDaArea` devolver `undefined` e só definir a variável quando houver área, ou ajustar o comentário.
- **M5. KpiCard (`src/components/planning/kpi-card.tsx`).** Não há link dentro de link nem botão dentro de link: `StatusBadge`, `Procedencia` (`<p>`) e `Degrau` não são interativos.
  - A variante `<button>` (linha 167) envolve `<div>` e `<p>`, o que é conteúdo inválido para `button` (só aceita phrasing). O navegador tolera, mas o leitor de tela lê o card inteiro como nome do botão.
  - `aria-valuenow` (linha 216) passa de `aria-valuemax=100` quando a meta é superada.
  - Correção: trocar `div`/`p` por `span` com `block`, e limitar o valuenow com `Math.min(100, …)`.
  - Hoje o componente só é usado na vitrine. O adaptador em andamento vai levá-lo às telas de auditoria.
- **M6. `Card interativo` (`src/components/ui/card.tsx`) sem teclado.** Com essa prop o card ganha `cursor-pointer` e foco visível, mas continua `div`, sem `tabIndex` nem `role`. Ninguém usa ainda. Sugestão: documentar que só vale com `asChild`/`<Link>`, ou exigir `onClick` + `tabIndex=0` + Enter.
- **M7. `useFiltroNaUrl` (`src/lib/planning/filtro-url.ts`) está correto.**
  - Preserva o search anterior (`...prev`) e grava com `replace`.
  - Só navega por ação do usuário, então não há loop.
  - Não apaga parâmetros.
  - Ressalva, já documentada no JSDoc: 6 rotas têm `validateSearch` que devolve só as chaves conhecidas (`clientes`, `contas-receber`, `financeiro-partners`, `gente`, `monetizacao`, `unidades.index`). Nelas a chave nova é descartada e o filtro "não pega", em silêncio. Hoje só a vitrine usa o hook.
- **M8. `text-primary` como cor de texto continua em 92 lugares** (eram 119). No tema claro dá 1,73:1: por exemplo, a aba ativa em `monetizacao/dashboard.tsx:180` e `aquario.tsx`. É legado, não regressão, mas o lint não pega. Sugestão: uma regra que troque para `text-primary-text` e entre na catraca.
- **M9. Gráficos com mais séries que cores.** `CORES_SERIE` tem 6 cores (antes eram 8 a 10). `roas/trend-tab.tsx:74` e `rede-realizado.tsx:236` usam `i % length`: com mais de 6 unidades, duas linhas saem com a mesma cor e a legenda fica ambígua. É visual, não quebra.

## Itens pedidos e resultado

1. **Regressão de comportamento.** Nenhuma.
   - `app-sidebar.tsx`: só apresentação. O invólucro `display: contents` preserva o flex; `[&>button]:hidden` do Sheet não é afetado. A lógica de permissão, `areaAtual`, `mostrarFinanceiro` e o Growth ficaram intactos.
   - `routes/_authenticated/route.tsx`: acrescenta `trilhaDoCaminho` (só rótulo, sem mexer no portão), `--area-atual` e `Button` no Sair, com o mesmo `onClick`. O portão de área e o redirect não mudaram.
   - Nas telas, o diff sem className mostra só troca de cabeçalho para `PageHeader`/`Secao` (as ações e os botões passaram com os mesmos props e handlers), paleta de gráfico (`hsl(var(--hex))`, que saía preto, foi corrigido), "Carregando…" trocado por `<Carregando>` no mesmo ramo, e mapas de classe.
   - `admin.usuarios.tsx`: as pílulas de papel e produto perderam a cor por papel. É visual; tsc ok.
2. **`/vitrine`.** Inacessível em produção, confirmado no bundle. Sem dado real (ver M1).
3. **Classes e tokens.** O script `checa-classes.mjs` conferiu todos os `text|bg|border|ring|fill|stroke|from|to|via|outline|divide|…-<token>` de `src/` contra os `--color-*` do `@theme inline`: **0 classes inexistentes**. Não aparece `*-foreground` de status, nem `bg-X text-X` do mesmo papel. Os sólidos `bg-success/warning/danger/info` só existem em pontos e barras sem texto. Os `var(--x)` no TSX estão todos declarados (`--chart-csat` existe nos dois temas). `text-white` sobrou só em `fxc-view.tsx:78`, sobre indigo-600, que é legível.
4. **Toaster.** Um só, em `__root.tsx:143`. O `MutationObserver` faz `disconnect` no cleanup, sem vazamento.
5. **`filtro-url.ts`.** Ver M7.
6. **KpiCard e acessibilidade.** Ver M5.
7. **Scripts.** `codemod-cores.mjs --dry` mostra 0 arquivos alterados e 0 trocas: é idempotente. `npm run design:lint` e `design:lint:changed` dão `RESULTADO: ok`, com os erros V1–V4, V16, V18 e V19 zerados.
8. **tsc.** São 7 erros, todos em linhas que o `git blame` atribui a `^eea3d90`, ou seja, já existiam:
   - `integracoes-status.functions.ts:24`
   - `admin.integracoes.tsx:132,149(×2),180`
   - `rede-overview.tsx:1079`
   - `reforma-tributaria.tsx:79`

   Nenhum foi introduzido pela branch.

## Veredito

- **PR A (Fundação):** pronto. Recomendo resolver o M2 (fontes 404) antes, porque é trivial.
- **PR B (Casca):** pronto. Não há regressão de permissão nem de navegação. O M3 e o M4 podem ir junto ou logo depois.
- **PR C (Codemod e cabeçalhos):** pronto no conteúdo, **com duas condições**:
  - corrigir o D1 (contraste com opacidade), ou confirmar que o adaptador em andamento o resolve;
  - reescrever o passo 3 do PROCESSO §3 (D2). Se o procedimento atual for seguido, o trabalho manual dos 38 arquivos se perde no dia do merge.

Antes de abrir qualquer PR, commite ou descarte os 20 arquivos modificados que estão na árvore agora.
