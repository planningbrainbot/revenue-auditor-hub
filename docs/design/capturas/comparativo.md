# Antes × depois · design system v2

Base: `origin/main` `eea3d90` (22/09/2026). Branch: `feat/design-system-v2-20260923`. As capturas são da vitrine (`/vitrine`, só em desenvolvimento, dado sintético), porque as telas reais exigem login. A vitrine usa os mesmos primitivos, a mesma casca e o mesmo estilo de gráfico das telas. Os números de código abaixo contam o `src/` inteiro, ou seja, as telas reais.

## O que muda em toda tela, sem tocar nela

A mudança entra pela camada base: tokens, primitivos do shadcn, casca e `AppShell`. Por isso chega às ~43 telas reais de uma vez.

| Camada | Antes | Depois | Onde se vê |
|---|---|---|---|
| Fonte | Poppins, fora da marca | Bw Glenn Sans, com Fira Sans de reserva (humanista, algarismos tabulares) | todo texto |
| Tamanho mínimo | 205 textos de 9–11px | 0 | tabelas, selos, rótulos |
| Cor | 1.559 classes de cor crua do Tailwind, 108 hex, sem papel de status | 0 cor crua de status, 0 hex fora de exceção listada, tokens `success/warning/danger/info` com fundo `-soft` | selos, alertas, deltas |
| Gráficos | 40 usos de `hsl(var(--x))` sobre hex: barras pretas, linhas que somem | 0; paleta de série da marca validada para daltonismo e contraste; eixo, grade, tooltip e legenda únicos | todos os gráficos Recharts |
| Notificações | `<Toaster/>` nunca montado: 204 `toast()` invisíveis | montado, segue o tema | salvar, enviar ao CRM, emitir fatura |
| Idioma | `lang="en"`, 404 em inglês | `pt-BR`, 404 e erro em português | navegador, leitor de tela |
| Casca | seletor sem identidade de área; cabeçalho do topo vazio | anel colorido por área, filete no item ativo, trilha "Área › Página" | toda tela autenticada |
| Cabeçalho de página | 9 estilos; metade das telas sem data do dado | `PageHeader` único: área, título do menu, universo medido, procedência, ações | todas as telas; restam 2 `<h1>` próprios e os dois são justificados |
| Controles | foco fraco, borda de input com 1,3:1 | foco de 2px sólido, borda de input com 3,5:1, botão primário verde com hover de brilho | formulários, filtros |
| Tabelas | cabeçalho igual ao corpo | cabeçalho maiúsculo em faixa própria, números tabulares, cabeçalho grudável | todas as tabelas |
| Abas | pílula cinza | sublinhado verde de 2px | as 17+ telas com abas |
| Estados | 82 "Carregando…" soltos; sem estado vazio nem de erro | `Carregando` com esqueleto, `EstadoVazio` com total, `EstadoErro`, `EstadoSemAcesso`; KPI nunca mostra 0 no lugar de "não apurado" | todas as telas migradas |

Diff em `src/`: 155 arquivos, +5.598 / −1.886 linhas, sem mudança de lógica, query ou permissão (revisão final em `docs/design/diagnostico/`).

## Capturas

Lado a lado, com o antes à esquerda e o depois à direita, nos temas escuro e claro:

| Seção | Escuro | Claro |
|---|---|---|
| Primeira dobra (casca + tela) | `comparativo/escuro-viewport.jpg` | `comparativo/claro-viewport.jpg` |
| Casca | `comparativo/escuro-casca.jpg` | `comparativo/claro-casca.jpg` |
| Gráficos | `comparativo/escuro-graficos.jpg` | `comparativo/claro-graficos.jpg` |
| Dados (KPI, tabela, cards) | `comparativo/escuro-dados.jpg` | `comparativo/claro-dados.jpg` |
| Controles | `comparativo/escuro-controles.jpg` | `comparativo/claro-controles.jpg` |
| Estados | `comparativo/escuro-estados.jpg` | `comparativo/claro-estados.jpg` |

O "depois" completo, com os cinco arquétipos montados (Visão geral da Rede, Fila Cella, Lista de contas, Ficha de apuração e Configuração), está em `depois/escuro-arquetipos.png` e `depois/claro-arquetipos.png`. Ali se vê o que uma tela vira quando segue o contrato inteiro, e não só a camada base:
- a pergunta como título;
- a próxima ação por linha;
- número que abre o registro;
- procedência ao lado do número.

## O que a camada base não resolve sozinha

Os cards de KPI escritos localmente em cada tela (20 componentes e cerca de 70 blocos inline) mudam de fonte e cor, mas continuam com o desenho antigo até serem trocados pelo `KpiCard`. O mesmo vale para as perguntas de cada tela (N1) e o drill-down (N2): isso é migração por módulo, na ordem de `PROCESSO.md` §6, porque depende do contrato aprovado pelo dono.
