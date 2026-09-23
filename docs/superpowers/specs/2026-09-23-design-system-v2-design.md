# Planning Brain · Design System v2 — spec de design

23/09/2026 · Pedro Luca (pedido) · construído em `feat/design-system-v2-20260923`, a partir de `origin/main` `eea3d90`.

Esta spec fixa as decisões antes do código. Quem executa uma tarefa do plano lê esta página e as que ela aponta; não redecide o que está aqui.

## 1. Problema, em uma linha por evidência

O Brain tem a marca nos tokens e nenhuma regra que leve a marca, a navegação e o objetivo de negócio para a tela. Medido em `eea3d90`:

| Evidência | Número | Efeito |
|---|---|---|
| `<Toaster/>` não é montado em lugar nenhum | 45 arquivos chamam `toast()` | Quem salva, envia ao CRM ou emite fatura não sabe se deu certo |
| `hsl(var(--x))` sobre variáveis que viraram hex | 33 ocorrências em 16 arquivos | Eixo, grade, tooltip e barra de gráfico com cor inválida |
| Classes de cor crua do Tailwind | ~1.650 em 93 arquivos | Não existe "positivo/atenção/negativo"; cada tela inventa |
| Fonte arbitrária de 9–11px | ~230 | Leitura ruim; o Recon tem 7 |
| Cabeçalho de página | 19 rotas usam `AppShell`, ~30 desenham o próprio em 9 estilos | Metade das telas sem data do dado nem aviso de validação |
| Estado de carregamento/vazio/erro | 82 "Carregando…" soltos; nenhum componente de vazio ou erro | Zero, vazio e "sem permissão" parecem iguais |
| Card de KPI | 20 versões locais + ~70 inline | Mesmo número com cara diferente em cada área |
| Aba fora da URL | 17 telas | Recarregar ou compartilhar link volta para a primeira aba |
| `AGENTS.md` do app | 15 linhas, nenhuma de design | Agente monta cada tela do zero, sem saber da anterior |
| `planning-design-system/` | Tailwind v3, HSL, congelado desde 21/07 | Não é importável por nenhum app v4 |

A hipótese do Pedro ("o DS da Planning não é usado e não está bom") se confirma nas duas metades. A parte que ela não previa: o que faz o Conciliador sair bom não é o Playbook 7 Níveis (roteiro de LP), é **fonte de marca curta e obrigatória + tokens que explicam o porquê + contrato de significado por tela + lógica testada fora da tela**. Relatórios completos: `docs/design/diagnostico/`.

## 2. Decisões

### 2.1 Onde o design system mora
Canônico **dentro do repositório do Brain**, em `docs/design/` (regras) e `src/styles.css` + `src/components/planning/` (código). Motivo: regra que não está no repo que o agente abre não existe para ele. `PM Work/planning-design-system/` recebe um `v2/` com os mesmos tokens em formato Tailwind v4 e passa a apontar para cá como fonte das regras de produto; a marca (logo, paleta, grafismos) continua com o Mika.

### 2.2 Marca — o que se respeita e o que se cria
Respeitado sem alteração: paleta oficial (verde `#0AE18C`, ciano `#14C8FA`, laranja `#FA6914`, roxo `#962DFF`, lima `#C3E61E`, preto, `#646464`, `#CDCDCD`, branco), gradiente ciano→verde, logo existente (`planning-logo.tsx`), Bw Glenn Sans como primeira fonte da pilha.

Criado a partir dos elementos de apoio do manual (anéis, círculos concêntricos, filete vertical, seta em degrau, grade de círculos):
- **Filete**: barra vertical de 3px na cor da área. Marca item ativo do menu, cabeçalho de página e card de KPI em foco. É o hover-assinatura.
- **Anel de área**: cada área do menu tem um glifo = ícone lucide dentro de um anel na cor da área.
- **Degrau**: ícone de tendência (seta em degrau do manual) no delta de KPI, no lugar da seta genérica.
- **Grade de círculos**: textura a 6–8% de opacidade em estado vazio e no cabeçalho da área. Nunca atrás de número.

### 2.3 Tipografia
Pilha: `"Bw Glenn Sans", "Fira Sans", ui-sans-serif, system-ui, sans-serif`. Bw Glenn é licenciada e não existe em arquivo no disco; o `@font-face` fica preparado e cai para Fira Sans, escolhida por comparação visual com a prancha oficial (humanista, "g" de um andar, Black pesado como o da marca, algarismos tabulares). Poppins sai. **Pendência humana (Mika):** comprar/obter os `.woff2` da Bw Glenn e decidir o logo vetorial oficial (há dois gradientes em uso).

Escala (px): 12 · 13 · 14 · 16 · 20 · 24 · 30 · 36. **Nada abaixo de 12px.** Números sempre `tabular-nums`. Rótulo de KPI 12px maiúsculo com tracking; valor de KPI 30px peso 700.

### 2.4 Cor — papéis, não matizes
Tema escuro é o padrão (assinatura da marca); claro é suportado com os mesmos nomes.

| Papel | Escuro | Claro | Regra |
|---|---|---|---|
| `background` | `#06090b` | `#f5f7f8` | fundo da aplicação |
| `card` | `#0d1418` | `#ffffff` | superfície |
| `popover`/elevado | `#121b21` | `#ffffff` | menus, sheets |
| `foreground` | `#e8eef2` | `#0b1216` | texto |
| `muted-foreground` | `#93a4af` (7,2:1) | `#4f606b` (6,5:1) | texto secundário |
| `border` | `#1f2b33` | `#dde4e9` | divisória (decorativa) |
| `input` | `#5b6d78` (3,5:1) | `#7d8b94` (3,5:1) | borda de controle — ≥3:1 obrigatório |
| `primary` | `#0ae18c` | `#0ae18c` | só preenchimento; texto em cima `#04110b` |
| `primary-text` | `#0ae18c` | `#007a4f` (5,4:1) | link e texto na cor da marca |
| `ring` | `#0ae18c` | `#007a4f` | foco, 2px sólido + offset |
| `success` | `#3ef0a8` | `#00794e` | + `success-soft` para fundo |
| `warning` | `#ff9a5c` | `#b54400` | laranja da marca é a atenção |
| `danger` | `#ff6b6b` | `#c62a2f` | erro; o único vermelho, fora da paleta de marca |
| `info` | `#5ad8ff` | `#0074a0` | ciano da marca é informação |

Status nunca só por cor: sempre ícone + palavra. `emerald/green/red/rose/amber/yellow/blue-*` crus ficam proibidos fora de `components/ui` e `components/planning`.

**Cor de área** (só filete, anel e eyebrow; nunca fundo de tela): Rede, Minha Unidade e Broker = ciano; Base de clientes = verde; Receita e Repasses = lima; Monetização = laranja; Planning People = roxo; Estratégia = verde; Administração = neutro `#8a979f`.

**Gráfico**: ordem categórica verde → ciano → roxo → laranja → lima → neutro, com variantes do tema claro escurecidas até passar 3:1 sobre branco (validar com o validador da skill `dataviz`). Uma série = cor primária; comparação com meta = série + linha tracejada neutra; negativo = `danger`. Nada de `hsl(var())`: sempre `var(--chart-n)`.

### 2.5 Forma e movimento
Raio base 10px (controles 8, cards 12, sheets 16). Sombra só em elementos sobrepostos. Movimento 120ms (hover) / 200ms (entrada), `ease-out`, e desligado em `prefers-reduced-motion`. Hover de card clicável: borda vai para `input`, filete da área aparece, cursor de link — o card **diz** que abre algo. Card que não abre nada não reage a hover.

### 2.6 Navegação e negócio
As 14 regras de `docs/design/NAVEGACAO.md` (N1–N14) são contrato, e cada uma vem de um documento já existente (DECISIONS, PRDs, specs). As centrais: título é a pergunta que a tela responde (N1); todo número abre os registros que o compõem e o total bate (N2); todo número diz de onde vem e de quando (N3); ausência ≠ zero ≠ sem permissão (N4); lista de trabalho tem próxima ação por linha e já vem em ordem de trabalho (N5); no máximo dois níveis (N6); filtro e aba na URL (N7).

### 2.7 Arquétipos de página
Toda tela nova declara um arquétipo (`docs/design/ARQUETIPOS.md`): **Visão geral** (agrega e manda para a tela dona), **Fila de trabalho** (próxima ação por linha), **Lista/Relatório** (explorar e exportar), **Ficha** (um objeto: cliente, unidade, apuração) e **Configuração** (admin). Cada arquétipo tem anatomia fixa e componentes próprios em `src/components/planning/`.

## 3. O que muda no código (escopo desta branch)

1. **Fundação**: tokens v2 em `src/styles.css` (papéis, status, área, gráfico, tipografia, raio, movimento); `lang="pt-BR"`; fonte; `<Toaster/>` montado; 404 e erro em português.
2. **Correções que já eram bug**: 33 `hsl(var())` → `var()`.
3. **Primitivos shadcn** reestilizados (button, card, badge, table, tabs, input, select, dialog, sheet, tooltip, skeleton, sidebar) — muda todas as telas de uma vez.
4. **Componentes Planning**: `PageHeader`, `KpiCard`, `StatusBadge`, `EstadoVazio`, `EstadoErro`, `Carregando`, `Procedencia`, `Degrau`, `AnelArea`, `BarraFiltros` (estado na URL), tema de gráfico.
5. **Casca**: lateral com anel de área e filete; cabeçalho com trilha (área › página); `AppShell` passa a usar `PageHeader`, então as 19 rotas que já o usam mudam sem tocar nelas.
6. **Codemod reexecutável** (`scripts/design/codemod-cores.mjs`): cor crua de status → token semântico; fonte <12px → 12px. Reexecutável de propósito: na integração com a `main` do Eliezek, roda-se de novo em vez de resolver conflito à mão.
7. **Cabeçalhos**: as rotas que desenham o próprio título passam a usar `PageHeader`.
8. **Vitrine** `/vitrine` (só em desenvolvimento, `notFound` em produção): tokens, componentes, os cinco arquétipos com dado sintético e a casca — é onde se revisa e se fotografa, sem login.
9. **Portão**: `scripts/design/lint.mjs` (`npm run design:lint`) com as regras verificáveis; `AGENTS.md` do app aponta para `docs/design/`; template de PR com a definição de pronto.

Fora do escopo: mudar regra de negócio, RLS, queries, permissões; resolver os conflitos de produto listados em `PRODUCT.md` §Decisões pendentes (são do Pedro/Eliezek); deploy, merge ou push.

## 4. Aceite

- `vite build` passa (baseline de `eea3d90` passou limpo).
- `npm run design:lint` sem violação nova em `components/planning`, `components/ui`, `styles.css` e nas rotas migradas; contagem global de cor crua e fonte <12px cai ≥80% frente à baseline.
- Capturas antes/depois da vitrine e da casca em `docs/design/capturas/`.
- Revisão por subagente de cada tarefa + revisão final da branch.
- Auditoria do Jev (rubrica fechada, abaixo) sem reprovação nos critérios binários e nota ≥ penúltimo nível nos de escala.

## 5. Rubrica do Jev

O Jev é classificador (choice/score/noul), não crítico livre. Ele recebe como `state` os documentos e o relatório de medição, e responde perguntas fechadas: a regra de marca respeita paleta/logo/tipografia? cada regra de navegação é verificável? o processo de subida define dono, portão e ordem? o diagnóstico responde à hipótese do Pedro com evidência? há impacto visual mensurável? Reprovação volta ao loop.
