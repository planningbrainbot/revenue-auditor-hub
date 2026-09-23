# DESIGN.md · Sistema visual do Planning Brain (v2)

Autoridade: `docs/superpowers/specs/2026-09-23-design-system-v2-design.md` (a "spec"). Este arquivo transforma a spec em regra de uso. Se os dois divergirem, vale a spec, e a divergência vira entrada no `DECISIONS.md`.

Código correspondente: tokens em `src/styles.css`, componentes em `src/components/planning/`, helpers em `src/lib/planning/`. Nomes de componente seguem o "Contrato de API" do plano (`docs/superpowers/plans/2026-09-23-design-system-v2.md`).

---

## 1. Princípios

1. **Ferramenta de trabalho, não vitrine.** O Brain é usado todo dia por quem cobra, apura, liga e fecha mês. Densidade alta, sóbrio, nada de efeito de landing page (brilho, vidro, contador animado, gradiente atrás de texto). Fonte: `diagnostico/pesquisa-referencias.md` §4; `diagnostico/conciliador.md` §5 "NÃO copiar".
2. **O número é o protagonista, e ele se explica.** Todo número diz o que conta, de onde vem, de quando é, e abre os registros que o compõem (N2, N3). Cor, ícone e gráfico existem para servir o número, nunca para decorar.
3. **Cor tem papel, não matiz.** Verde da marca é ação e marca; laranja é atenção; ciano é informação; vermelho é erro e só erro. Ninguém escolhe `emerald-600` porque "ficou bonito" (spec §2.4).
4. **Ausência não é zero.** Carregando, vazio, parcial, não apurado, fonte fora e sem permissão têm aparência diferente entre si e diferente de `0` (N4).
5. **A marca aparece nos detalhes, não no volume.** Filete, anel de área, degrau e grade de círculos (spec §2.2) dão identidade sem roubar área de dado.
6. **Uma decisão, um lugar.** Tela nova compõe `src/components/planning/`; não cria seu próprio card de KPI, cabeçalho, estado vazio ou paleta.

---

## 2. Marca

### 2.1 Paleta oficial (não alterar)
Fonte: `diagnostico/design-system-planning.md` §1.2 (arquivos `.ase` + `brand-dna.md`), confirmada pela spec §2.2.

| Cor | Hex | Pantone | Uso no Brain |
|---|---|---|---|
| Verde (primária) | `#0AE18C` | 352 C | preenchimento de ação principal, foco no escuro, série 1 |
| Ciano | `#14C8FA` | 311 C | informação, série 2, área Rede/Minha Unidade/Broker |
| Laranja | `#FA6914` | 1585 C | atenção, série 4, área Monetização |
| Roxo | `#962DFF` | 265 C | série 3, área Planning People |
| Lima | `#C3E61E` | 381 C | série 5, área Receita e Repasses |
| Preto | `#000000` | Neutral Black C | base do tema escuro |
| Cinza escuro | `#646464` | Cool Gray 10 C | referência de neutro |
| Cinza claro | `#CDCDCD` | Cool Gray 2 C | referência de neutro |
| Branco | `#FFFFFF` | — | base do tema claro |

Vermelho **não é cor da marca**. `danger` (`#ff6b6b` / `#c62a2f`) é a única exceção, e só para erro.

**A marca é "preto sobre vivo".** Verde, ciano e lima dão menos de 2:1 sobre branco (verde 1,7; ciano 2,0; lima 1,4). Consequência: no tema claro essas cores **nunca** são texto, ícone, link ou borda; texto na cor da marca usa `primary-text` (`#007a4f`).

### 2.2 Gradiente
`linear-gradient(90deg, #14C8FA, #0AE18C)` (ciano → verde). Só no logo e, no máximo, num filete de 3px da casca. Nunca atrás de texto, nunca em card, botão ou gráfico.

### 2.3 Logo
- Componente único: `src/components/planning-logo.tsx`. Não redesenhar, não recolorir o símbolo fora do gradiente, não distorcer.
- Não usar `planning-mark-icon.png` como ícone: o arquivo contém o lockup inteiro (`design-system-planning.md` §3.3, defeito 1).
- Não usar os PNG `color-light`/`color-dark` sobre superfície do app: têm fundo opaco embutido.
- **Pendência humana (Mika):** há dois gradientes em uso (o SVG do Illustrator tem `#5FB77F → #4EBED8`, não a paleta RGB). Até a decisão, não criar logo novo nem "corrigir" cor do SVG existente (spec §2.3).

### 2.4 Tipografia
- Pilha: `"Bw Glenn Sans", "Fira Sans", ui-sans-serif, system-ui, sans-serif`. Bw Glenn é a fonte oficial (pesos 200/400/700/900), mas os `.woff2` não existem no disco; o `@font-face` fica pronto e o navegador cai em Fira Sans. Poppins sai. Fonte: spec §2.3.
- Escala (px): **12 · 13 · 14 · 16 · 20 · 24 · 30 · 36**. Nada abaixo de 12.

| Uso | Tamanho / peso | Observação |
|---|---|---|
| Rótulo de KPI, cabeçalho de tabela, eyebrow | 12 / 600, maiúsculo, tracking largo | `muted-foreground` |
| Texto de apoio, procedência, célula densa | 13 / 400 | |
| Corpo, célula padrão, controle | 14 / 400–500 | |
| Título de seção (`Secao`) | 16 / 600 | é uma pergunta |
| `<h1>` do `PageHeader` | 24 / 700 | um por página |
| Valor de KPI | 30 / 700, `tabular-nums` | |
| Número de destaque único (Visão geral) | 36 / 700 | no máximo um por tela |

- Números sempre `tabular-nums` (utilitário `.num`), alinhados à direita em tabela.
- Pesos 500/600 são da Fira; ao entrar a Bw Glenn, 600 cai para 700.

---

## 3. Tokens por papel

Tema escuro é o padrão; claro usa os mesmos nomes. Contraste calculado em 23/09/2026 (WCAG 2.1) sobre `card`; os números em negrito são os que a spec §2.4 já declarava.

| Papel | Escuro | Claro | Contraste (esc. / claro) | Regra |
|---|---|---|---|---|
| `background` | `#06090b` | `#f5f7f8` | — | fundo da aplicação |
| `card` | `#0d1418` | `#ffffff` | — | superfície |
| `popover` / `surface-elevated` | `#121b21` | `#ffffff` | — | menus, sheets, diálogos |
| `foreground` | `#e8eef2` | `#0b1216` | 15,9 / 18,9 | texto |
| `muted-foreground` | `#93a4af` | `#4f606b` | **7,2 / 6,5** | texto secundário |
| `border` | `#1f2b33` | `#dde4e9` | 1,3 / 1,3 | só divisória decorativa |
| `input` | `#5b6d78` | `#7d8b94` | **3,5 / 3,5** | borda de controle, ≥3:1 obrigatório |
| `primary` | `#0ae18c` | `#0ae18c` | texto `#04110b` sobre ele: 11,2 | só preenchimento |
| `primary-text` | `#0ae18c` | `#007a4f` | 10,8 / **5,4** | link, texto na cor da marca |
| `ring` | `#0ae18c` | `#007a4f` | 10,8 / 5,4 | foco, 2px sólido + offset |
| `success` (+`-soft`) | `#3ef0a8` | `#00794e` | 12,6 / 5,5 | positivo |
| `warning` (+`-soft`) | `#ff9a5c` | `#b54400` | 8,9 / 5,5 | atenção (laranja da marca) |
| `danger` (+`-soft`) | `#ff6b6b` | `#c62a2f` | 6,7 / 5,6 | erro, negativo |
| `info` (+`-soft`) | `#5ad8ff` | `#0074a0` | 11,2 / 5,2 | informação (ciano da marca) |

Regras:
- `border` não serve de limite de controle (1,3:1). Input, select e checkbox usam `input`.
- Status sobre `*-soft` precisa de ≥4,5:1 para texto; conferir no T2 quando os `*-soft` forem fixados.
- Classes cruas `emerald|green|red|rose|amber|yellow|orange|sky|cyan|blue|slate|gray|zinc|neutral-*` são proibidas fora de `components/ui` e `components/planning` (spec §2.4).

### 3.1 Cor de área
Só em **filete, anel de área e grade de círculos do cabeçalho**. Nunca fundo de tela, nunca fundo de card, nunca texto de corpo. Fonte: spec §2.4.

| Área (slug em `areas.ts`) | Token | Cor |
|---|---|---|
| Rede (`rede`), Minha Unidade (`minha_unidade`), Broker (`broker`) | `--area-rede`, `--area-minha_unidade`, `--area-broker` | ciano |
| Base de clientes (`clientes`) | `--area-clientes` | verde |
| Receita e Repasses (`receita`) | `--area-receita` | lima |
| Monetização (`monetizacao`) | `--area-monetizacao` | laranja |
| Planning People (`people`) | `--area-people` | roxo |
| Estratégia & Execução (`estrategia`) | `--area-estrategia` | verde |
| Administração (`admin`) | `--area-admin` | neutro `#8a979f` |

`estrategia` existe no banco (DECISIONS 21/09, migration `20260921170000`) mas ainda não está em `src/lib/areas.ts` desta branch; o token existe para quando a área entrar no menu.

No tema claro, verde, ciano e lima não passam 3:1 sobre branco. O eyebrow do `PageHeader` é escrito em `muted-foreground`; a cor da área fica só no anel e no filete, e o token claro de cada área precisa de variante escurecida até 3:1 (mesma técnica das séries de gráfico). Ler: `corDaArea(slug)` em `src/lib/planning/cores-area.ts`.

---

## 4. Status

- Sempre `StatusBadge` com **ícone + palavra**. Cor sozinha não comunica (daltonismo, impressão, leitura rápida).
- Cinco tons, e só cinco: `sucesso`, `atencao`, `perigo`, `info`, `neutro`.

| Tom | Ícone padrão (lucide) | Exemplos de palavra |
|---|---|---|
| `sucesso` | `CircleCheck` | Confirmado, Pago, No ritmo |
| `atencao` | `TriangleAlert` | Em revisão, Vence em 3 dias, Cobertura parcial |
| `perigo` | `OctagonAlert` | Atrasado, Erro na fonte, Fatura não emitida |
| `info` | `Info` | Rascunho, Em validação |
| `neutro` | `Minus` | Sem movimento, Emitida à mão |

- Estado de **dado** (parcial, não apurado, indisponível, sem acesso) não é status de negócio: vai no `estado` do `KpiCard` ou num `Estado*`, não num badge âmbar.
- Tela de trabalho não carrega alarme permanente (N9): lacuna de fonte vira linha de `Procedencia`, não selo laranja que nunca apaga.

---

## 5. Gráficos

Fontes: spec §2.4; skill `dataviz`; DECISIONS 22/09 "Receita e Repasses ganha uma porta" (cores e dois eixos).

**Ordem de série (fixa):** `--chart-1` verde → `--chart-2` ciano → `--chart-3` roxo → `--chart-4` laranja → `--chart-5` lima → `--chart-6` neutro. Variantes do tema claro escurecidas até 3:1 sobre branco, validadas pelo script da skill `dataviz` (registro em comentário em `src/lib/planning/grafico.ts`).

Regras:
1. Cor sempre `var(--chart-n)` via `CORES_SERIE`; eixo, grade, tooltip e legenda via `eixoProps`, `gradeProps`, `tooltipProps`, `legendaProps`. **Nunca `hsl(var(--x))`**: as variáveis são hex e o resultado é CSS inválido (33 ocorrências na baseline `eea3d90`).
2. Uma série = `--chart-1`. Comparação com meta = série + **linha tracejada neutra** com rótulo "Meta". Negativo = `danger`.
3. Status não é série: `success/warning/danger` não pintam categoria.
4. Um eixo Y por gráfico. Dois eixos inventam correlação (DECISIONS 22/09; `conciliador.md` §1.6).
5. No máximo três séries empilhadas; a quarta vai para gráfico próprio (DECISIONS 22/09: ciano, azul e roxo não se separavam, ΔE 11 < 15).
6. Todo gráfico diz a unidade no título ou no eixo e responde uma pergunta no título da `Secao`.
7. Barra, ponto ou fatia clicável abre os registros (N2). Se não abre, o cursor não muda.

**Quando usar o quê**

| Pergunta | Forma |
|---|---|
| Comparar poucas categorias (unidades, produtos) | barra horizontal ordenada por valor |
| Evolução no tempo, contínua (MRR, royalties por mês) | linha |
| Composição de um total ao longo do tempo (royalties + CSC + outras) | barra empilhada, ≤3 séries |
| Volume acumulado com ênfase na massa | área, só com uma série |
| Etapas em sequência (funil) | barras em rampa sequencial de uma cor, do claro ao escuro |
| Realizado contra meta num período | `KpiCard` com `meta`, ou barra + tracejado |

**Quando NÃO usar gráfico**
- Menos de 4 pontos: use `KpiCard` ou frase.
- A pessoa precisa do valor exato de cada linha para agir (cobrar, conferir, ligar): use tabela.
- Mais de 12 categorias: tabela ordenada com barra embutida na célula.
- Pizza/rosca com mais de 3 fatias, gauge decorativo, 3D, dois eixos: nunca.
- Gráfico que repete o que outro bloco já disse (`conciliador.md` §3.8, "um quadro por pergunta").

---

## 6. Grafismos da marca na UI

Derivados dos elementos de apoio do manual (spec §2.2). Componentes: `Degrau`, `AnelArea`, `GradeCirculos`, e o filete via token.

| Grafismo | O que é | Onde pode | Onde não pode |
|---|---|---|---|
| **Filete** | barra vertical de 3px na cor da área | item ativo do menu; eyebrow do `PageHeader`; `KpiCard` clicável em hover/foco | card que não abre nada; linha de tabela; mais de um filete aceso por grupo |
| **Anel de área** | ícone lucide dentro de anel na cor da área | seletor de área, eyebrow do cabeçalho, porta de entrada `/inicio` | dentro de tabela; como ícone de status |
| **Degrau** | seta em degrau do manual | delta de `KpiCard` (sobe, desce, estável) | como botão, como ícone de navegação |
| **Grade de círculos** | textura SVG a 6–8% de opacidade | `EstadoVazio`; faixa do cabeçalho de área | atrás de número, atrás de tabela, atrás de gráfico, em card de KPI |

A cor do degrau vem do `sentido` do delta (`maior-melhor` / `menor-melhor`), não da direção da seta: churn que desce é `sucesso`.

---

## 7. Ícones

- Biblioteca: `lucide-react` (0.575). Nada de outra biblioteca, emoji ou SVG solto.
- Tamanho: **16px** em linha de texto, botão, célula e badge; **20px** em cabeçalho de página, anel de área e estado vazio. Stroke **1.75**.
- Ícone decorativo leva `aria-hidden`; ícone sozinho em botão leva `aria-label` e tooltip.
- **Um ícone por conceito.** O mesmo desenho não significa duas coisas, e o mesmo conceito não troca de desenho entre telas.

**Tabela canônica** (hoje em `areas.ts`, `Coins` serve a royalties, à área Receita, à Matriz do broker e a Meus Royalties; `Gauge` a IDU, Minha Unidade, Clima e Capacidade; `Target` a Funil de CAC e Avaliação; `KeyRound` a duas telas de Administração):

| Conceito | Ícone canônico | Conflito que resolve |
|---|---|---|
| Unidade da rede | `Store` | Broker deixa `Store` e vai para `Handshake` |
| Cliente / conta | `Building2` | — |
| Contato | `BookUser` | Cadastro do People passa a `IdCard` |
| Contrato | `FileText` | — |
| Negócio / oportunidade (CRM) | `Briefcase` | — |
| Fila de trabalho | `ListChecks` | — |
| Lista preparada para envio | `ListPlus` | — |
| Enviar ao CRM / disparar | `Send` | — |
| Receita / MRR | `CircleDollarSign` | — |
| Royalties | `Coins` | Matriz do broker vai para `Calculator` |
| Repasse / fatura | `Receipt` | — |
| Contas a receber / recebimento | `Wallet` | — |
| CAC | `HandCoins` | sai de `Target` |
| Comissão | `Percent` | — |
| Funil | `Filter` | — |
| Meta / KR | `Target` | Avaliação vai para `Award` (`ClipboardCheck` é da Auditoria Interna) |
| NPS | `MessageSquareHeart` | — |
| IDU | `Gauge` | Clima vai para `Thermometer`, Capacidade para `Layers` |
| Pessoa | `User` | — |
| Time / equipe | `Users` | — |
| Churn / tratativa | `UserX` | — |
| Período | `CalendarRange` | — |
| Procedência / fonte | `Database` | — |
| Frescor do dado | `Clock` | — |
| Sem acesso | `Lock` | — |
| Alerta (atenção) | `TriangleAlert` | — |
| Erro (perigo) | `OctagonAlert` | — |
| Permissão / nível | `ShieldCheck` | — |
| Chave de integração | `KeyRound` | Integrações vai para `Plug` |
| Histórico / atividade | `History` | — |
| Visão geral | `LayoutDashboard` | — |
| Exportar | `Download` | — |

Todos os nomes foram conferidos em `node_modules/lucide-react` em 23/09/2026. Trocar ícone de item do menu é mudança em `areas.ts`, que é do Eliezek: aplicar na casca (T6) só com o aceite dele.

---

## 8. Hover, foco e movimento

Fonte: spec §2.5.
- **Foco:** `ring` 2px sólido com offset de 2px, em todo elemento focável, visível só com teclado (`focus-visible`). Nunca remover `outline` sem pôr o anel.
- **Hover de card clicável:** borda vai para `input`, filete da área aparece, cursor de link. O card diz que abre algo.
- **Card que não abre nada não reage a hover.** Nem sombra, nem borda, nem cursor.
- **Linha de tabela:** fundo `muted/40` no hover; se a linha abre um `Sheet`, cursor de link.
- **Botão:** `default` (verde, texto `#04110b`) só para **a** ação principal da tela ou do bloco; o resto é `outline`, `ghost` ou `link`. Destrutivo usa `destructive` e confirma em `AlertDialog`, nunca `confirm()` nativo.
- **Movimento:** 120ms no hover, 200ms na entrada, `ease-out` (`--ease-planning`). Desligado em `prefers-reduced-motion`. Sem escala, sem bounce, sem parallax.
- **Sombra:** só em elemento sobreposto (popover, sheet, diálogo, toast).

---

## 9. Densidade, forma e espaçamento

- Grade de 4px. Espaços usados: 4, 8, 12, 16, 24, 32. Entre seções da página: 24. Dentro de card: 16. Padding lateral da página: 16 no celular, 24 a partir de `md`.
- Raio: base 10px; controles 8, cards 12, sheets 16.
- Controle: altura mínima 32px (`sm`) e 36px (padrão).
- Tabela: linha de 40px na densidade padrão, 32px na compacta; cabeçalho 12px maiúsculo `muted-foreground`; número à direita, `tabular-nums`; paginação ou virtualização acima de 100 linhas (o PostgREST corta em 1.000, DECISIONS 22/09).
- Largura: telas de lista ocupam a largura toda; `Ficha` e `Configuração` limitam o texto corrido a ~72 caracteres.
- `KpiGrade`: 2 colunas no celular, até 6 no desktop; Visão geral executiva tem no máximo 6 KPIs na primeira dobra (N12).

---

## 10. Regras verificáveis

"lint" = `npm run design:lint` (`scripts/design/lint.mjs`, criado no T9). "revisão" = checagem humana ou por subagente no PR, pelo template de PR.

| # | Regra | Como verificar |
|---|---|---|
| V1 | Nenhum `hsl(var(` em lugar nenhum de `src/` | lint (erro); `grep -rn "hsl(var(--" src` = 0 |
| V2 | Nenhum hex literal em `.tsx`, exceto allowlist (e-mail, PDF, logo) | lint (erro) |
| V3 | Nenhuma cor crua de status/neutro do Tailwind fora de `components/ui` e `components/planning` | lint (erro) |
| V4 | Nenhuma fonte abaixo de 12px (`text-[9px]`, `[10px]`, `[11px]`, `[0.7rem]`) | lint (erro) |
| V5 | Toda rota em `_authenticated/` renderiza `PageHeader` ou `AppShell` | lint (aviso); revisão |
| V6 | Nenhum `confirm(` nativo; ação destrutiva usa `AlertDialog` | lint (aviso) |
| V7 | Status sempre com ícone e palavra (`StatusBadge`), nunca cor sozinha | revisão; lint de V3 pega a maioria |
| V8 | Série de gráfico só com `CORES_SERIE` / `var(--chart-n)`; um eixo Y; ≤3 séries empilhadas | revisão; lint de V1/V2 pega a cor |
| V9 | Número em KPI e tabela com `tabular-nums` (`.num`, `KpiCard`, `Table`) | revisão; captura na vitrine |
| V10 | `KpiCard` com valor ausente usa `estado`, nunca `0` nem string vazia | revisão; teste do componente |
| V11 | Card clicável tem `abrir`; card sem `abrir` não tem classe de hover | revisão; `grep "hover:" ` em cards de KPI locais |
| V12 | Foco visível em todo controle (`focus-visible:ring-2`) | revisão com teclado na vitrine |
| V13 | Cor de área só em filete, anel e grade de círculos | revisão; `grep "var(--area-"` fora de `components/planning` e casca = 0 |
| V14 | Grade de círculos nunca atrás de número, tabela ou gráfico | revisão na captura |
| V15 | Ícone só de `lucide-react`, 16 ou 20px, e o conceito segue a tabela §7 | revisão; `grep` de outras libs de ícone = 0 |
| V16 | Movimento desligado em `prefers-reduced-motion` | revisão; bloco `@media` presente em `styles.css` |
| V17 | Gradiente da marca só no logo e na casca | `grep "linear-gradient"` fora de `styles.css` e logo = 0 |
| V18 | `lang="pt-BR"`, 404 e erro em português | revisão de `__root.tsx` |
| V19 | Todo `toast()` tem `<Toaster/>` montado no root | `grep "<Toaster"` em `__root.tsx` ≥ 1 |

Violação nova em arquivo tocado bloqueia o PR. Violação antiga em arquivo não tocado entra na contagem de `docs/design/medicoes.md` e cai pelo codemod (T7), não por correção manual espalhada.
