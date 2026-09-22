# Navegação da Base de clientes — estudo

> Escopo: as quatro perguntas do dono sobre navegação de `/clientes`. Não é redesenho de card, não é
> dado, não é performance.
> **Regra de evidência:** afirmação sobre código vem com `arquivo:linha` conferido contra `HEAD ffed13a`
> (22/09/2026); afirmação sobre dado vem com a consulta e o número; afirmação sobre contagem de conta
> vem da régua (`regua/calc.mjs`, que roda o código real do app), nunca de SQL sobre `perfil->>`.
> **Aviso de deriva:** a spec `docs/spec-cockpit-da-base.md` foi escrita em 21/09 contra `5dceb4f`.
> `af0b980` e `ffed13a` moveram linhas de `aquario.tsx` (1.341 → 1.334). Toda citação da spec precisa
> ser reconferida antes de usar. As citações **deste** documento foram conferidas em `ffed13a`.

Método: seis lentes independentes (uso/propriedade × 3 superfícies, mapa da duplicação, inventário de
navegação, pesquisa externa), cada afirmação carregadora submetida a dois refutadores adversariais com
lentes distintas (evidência literal / explicação alternativa), depois três arquitetos com prioris
opostos, um júri e um crítico de completude. 71 agentes. 30 afirmações contestadas, 29 corrigidas ou
estreitadas, 1 intacta.

**Calibragem honesta do número:** os refutadores foram instruídos a "na dúvida, refute". Lidas uma a
uma, a maioria das 29 confirma o fato e derruba o *alcance* da conclusão ou um número de linha
defasado. "Derrubada" aqui significa "não use como estava escrita", não "é falsa".

---

## 0. O achado que explica a tela inteira

**Os três níveis de navegação não foram projetados. São o resíduo de uma fusão.**

`git show 0b29b44 -- src/lib/areas.ts` (17/09/2026, "Unifica Clientes e oportunidades com sincronização
Pipefy") tem uma única linha de diferença:

```
-          { title: "Aquário", url: "/aquario", icon: Users },
```

Antes desse commit o Aquário era **rota de primeiro nível no menu lateral**, e as cinco abas
`Carteiras por unidade · Todas as contas · Recon · Listas para sócios · Entenda os números` eram a
navegação **principal** dele — `git show 0b29b44^:src/components/monetizacao/aquario.tsx` mostra os
mesmos cinco `TabsTrigger` nas linhas 258-264. O commit apagou o item do menu e embutiu a tela em
`/clientes` como uma aba. As cinco abas viraram nível 3 sem nenhum redesenho, e o resíduo do endereço
antigo sobrevive em `src/routes/_authenticated/aquario.tsx`, um `redirect` para `/clientes`.

A queixa 3 do dono ("esse menu inferior não pode estar ali") é a descrição exata desse resíduo.

**E a própria casa já sabe a resposta.** `src/lib/areas.ts:295-309`: `/monetizacao` é **uma rota só**
com `?aba=`, e **cada aba é um item do menu lateral** — "Operação diária", "Temporal e previsão",
"Projetado × realizado", "Capacidade e alocação", "Follow Day", "Funil comercial", "Pessoas e PDI",
"Abordagens", "Distribuição". Não existe barra de abas aninhada ali. O padrão de "reunir em um menu só"
está implementado na área vizinha desde antes desta discussão.

---

## 1. Quem usa cada superfície, e para quê

**Não existe telemetria de navegação.** `ops.acessos_log` tem 22 linhas (17-21/09) e é log de ação
administrativa. Então "quem usa" foi apurado por (a) permissão no código e no banco, (b) **trilha de
escrita**, que é a única prova de uso real. Onde a resposta é "não é usado", é inferência a partir de
ausência de escrita — e ausência de escrita não distingue aba morta de superfície de consulta.

### Empresas
Não tem guarda própria. É **o mesmo renderer** de "Validar origem": ambas caem no ramo `else` de
`base-unica.tsx`, diferindo no filtro (`:135`), no título (`:434`), na frase de apoio (`:440`), no
cabeçalho da última coluna (`:460`), no conteúdo da última célula (`:528-538`) e num parágrafo extra
de motivo (`:487-491`). Filtro, funil, CSV, paginação e a ficha da empresa são literalmente o mesmo
código.

**O que só existe aqui** (e some se a aba morrer sem migração): busca por CNPJ, coluna de CNPJ, estado
do espelho do Pipefy com data, e cinco colunas do CSV que o `PortfolioTable` do Aquário não exporta.
Os dois campos de busca da página **procuram em campos diferentes** — CNPJ só funciona no de fora
(`base-unica.tsx:104-113`); digitar CNPJ no de dentro devolve zero.

→ **Veredito: não pode simplesmente sumir.** Ou vira recorte do cockpit *depois* de as colunas
migrarem, ou a migração vira pré-requisito declarado.

### Validar origem
Mesma ausência de guarda. `ops.base_origem_validacoes` tem 4.040 linhas e **nenhuma veio de clique**:
ator único (`pedro.luca@planning.com.br`), três rótulos de regra em massa, e **96 segundos com
exatamente 25 linhas cada** (2.400 linhas), mais 27 segundos com 24 e 17 com 23. O diálogo da tela
manda **uma** conta por vez (`base-unica.tsx:631-722` → `clientes-base.functions.ts:25-45`), então
25/s por clique é impossível.

**Mas a fila não está drenada.** Hoje: **493** contas com `origem='confirmar'` em `ops.base_conta_estado`
(régua: `validar_origem: 493`), e **494** caem no filtro da aba (que é `needs_validation ||
needs_source_correction`). São exatamente os casos que a regra não cobriu — sem unidade e sem CNPJ,
Curitiba fora dos três apps Omie, abril/2025, identidade divergente — como `DECISIONS.md:1758` já
registrava. Dessas, **424 não têm `unidade_ids`**, então não aparecem em card de carteira nenhum.

→ **Veredito: a aba nunca foi usada como ferramenta, mas o trabalho existe.** Matar sem destino
explícito para as 494 não é remoção sem custo.

### Contatos
Guardada por `perms.can("view.contatos")` (`base-unica.tsx:91`, `:336`) — **29 pessoas**, mais que as
28 com `view.clientes`. Renderiza ~2.586 linhas de uma vez, sem paginação, sem busca por pessoa e sem
exportação — enquanto a aba vizinha tem as três coisas. É 100% leitura.

**Existe `/base-contatos`**, item de menu no **mesmo grupo** da lateral (`areas.ts:180`). Ele lê a
mesma tabela e cobre ~194 contatos que a aba nunca mostra (os sem `empresa_id`). As populações são
**complementares, não idênticas**: a aba é a única tela do Ops que lista nominalmente os contatos
vinculados a conta.

→ **Veredito: não é redundância pura.** O dado é único; o *lugar* é que está errado.

### Negócios
Sem guarda própria. 100% leitura. É subconjunto do diálogo de `/monetizacao?aba=operacao` — para onde
o próprio Aquário já manda o operador pelo link "Acompanhar operação" (`aquario.tsx:318-324`).

**Para o sócio regional ela mostra sempre "0 negócios", sem mensagem de permissão** — única afirmação
do estudo inteiro que sobreviveu intacta aos dois refutadores. Causa na seção 3.

→ **Veredito: é a única remoção limpa das cinco.**

### Contratos da rede
**É outro produto, e a confusão do dono é justificada.** 1.231 linhas lendo `unidades`, `empresas`,
`contratos`, `central_tratativas`, `contatos` e `omie_clientes_cadastro` (`contratos-clientes.tsx:261,
263, 271, 278, 342, 383`). As duas únicas escritas são de CS/retenção: `atualizarCliente` e
`marcarChurnCliente` (`:219-220`).

**Sobreposição com `/painel-cs`, medida:** a aba Tratativas lê `central_tratativas`, `contratos` e
`empresas` (`tratativas-tab.tsx:99, 103, 109`) — as mesmas três — e **existe desde 14/09** (`5bc5e5a`),
três dias **antes** de `contratos-clientes.tsx` nascer em `0b29b44`. Nunca houve decisão de pôr
contratos na tela de prospecção; foi colateral de uma fusão.

**Mas não é duplicata pura**, e é isso que manda mover em vez de apagar: `/painel-cs` é read-only sobre
churn (a única escrita lá é Sincronizar), e `contratos-clientes.tsx:342` e `:383` leem `contatos` e
`omie_clientes_cadastro`, que `/painel-cs` não lê em lugar nenhum.

**Uso:** `ops.central_tratativas` tem 31 linhas e **não recebe linha nova desde 19/08/2026**. Zero
correções de cadastro já pedidas pela aba.

**Ponto de entrada:** um só no produto inteiro — `rede-overview.tsx:1182`, `status: "ATIVO"`.

**Permissão larga demais:** `manage.clientes_churn` é chave de **área**, e alcança sete papéis,
incluindo `hunter_monetizacao` — prospecção pode registrar churn. Mover a tela **não fecha** essa porta.

→ **Veredito: sai de `/clientes`.** Como irmã (`/clientes/contratos`, renomeada), não como quarta aba
de `/painel-cs` — mover para lá trocaria os números da tela, porque `status_financeiro` cru ≠
`categoria_financeira` derivada.

### Defeito de rota achado de passagem
`rede-overview.tsx:979` e `:993` prometem `title="Ver clientes ativos"` e mandam `status: ""`. O
`validateSearch` (`clientes.tsx:5`) só escolhe `"contratos"` quando `status` é *truthy* — então os dois
cards caem no Cockpit de prospecção, não na lista de clientes ativos. Dois dos três pontos de entrada
externos de `/clientes` erram o alvo.

---

## 2. O mapa da duplicação, item a item

Números da régua sobre a carteira de 22/09 (`regua/calc.mjs`, código real do app).

### Duplicação pura — mesma expressão, mesmo rótulo, duas vezes na mesma dobra

| número | aparição 1 | aparição 2 | expressão |
|---|---|---|---|
| **63** | KPI "Cella · perfil aderente" `aquario.tsx:196-197` | card "63 com perfil aderente" `:271` | `oferta(a,"cella").status==="elegivel"` — `:131` e `:235` |
| **160** | KPI "Finance · perfil aderente" `:207-208` | card "160 com perfil aderente" `:271` | `oferta(a,"finance")` — `:142` e `:235` |
| **2.329** | hint do KPI "2.329 aptas" `:203` | card "2.329 aptas de…" `:270` | `oferta(a,"consultoria")` — `:132` e `:235` |

O commit `af0b980` declarou ter tirado essa repetição dos cards de produto. **Não tirou** — o rótulo
"com perfil aderente" está literalmente nos dois lugares.

### Contradição — pior que duplicação: dois denominadores com o mesmo nome

| | KPI `:202` | card `:270` |
|---|---|---|
| número | **4.731** | **2.356** |
| rótulo | "Consultoria · carteira **retroativa**" | "…de 2.356 **retroativas** para análise" |
| expressão | `baseRetroativaConsultoria` (`model.ts:55`) | `potencialConsultoria` (`portfolio.ts:23`) |

`potencialConsultoria = baseRetroativaConsultoria(a) && oferta(a,"consultoria").status !== "fora_regra"`
— subconjunto estrito. A diferença (2.375) é exatamente o que o hint do KPI acima enumera
("1.555 por Simples/MEI · 820 inativas na Receita"). O card não explica a lacuna, e os dois estão a 68
linhas um do outro.

**É esta a queixa 2 do dono, provada com número.**

### Duplicação de casca — a prop que não faz nada

`grep -n embedded aquario.tsx` devolve **três** linhas: `:85` (default), `:87` (tipo), `:164`
(className do `<main>`). **`embedded` não suprime nada.** A spec assumiu que o mecanismo de supressão já
existia; não existe. Consequência, na view padrão:

| controle | instância 1 | instância 2 | efeitos |
|---|---|---|---|
| `<h1>` | `base-unica.tsx:190` "Base de clientes" | `aquario.tsx:169` "Cockpit da base" | — |
| "Atualizar" | `base-unica.tsx:196-208` | `Freshness` `aquario.tsx:175` (`common.tsx:144-147`) | **diferentes**: o de fora só invalida cache; o de dentro dispara `sync` do CRM (`aquario.tsx:113-124`) |
| busca livre | `base-unica.tsx:247` | `PortfolioTable` | **campos diferentes** — CNPJ só no de fora |
| filtro de unidade / origem | `base-unica.tsx:254`, `:267` | `aquario.tsx:725-743` (sob `!inUnit`) | — |

**Cuidado com o atalho óbvio:** matar o botão de dentro mata o **único gatilho de sync do CRM** em
`/clientes`, e some junto o display de `measured_at`, único indicador de defasagem da tela. A supressão
correta é a do botão **de fora**.

### "Entenda os números" não explica — recalcula
`Gates` (`aquario.tsx:1192`, montado em `:429`) refaz, com expressões idênticas, a faixa de KPIs inteira
e a linha de cards inteira. É a terceira aparição dos mesmos números.

### A grade de unidade se contradiz sozinha
O número grande do card vem do banco (`monetizacao_unidade_cobertura`) e **ignora todos os filtros da
página**, enquanto o rodapé do mesmo card (`aquario.tsx:405`, `"N contas conciliadas · Cella X ·
Finance Y"`) é filtrado. Dois regimes de filtro dentro do mesmo cartão.

---

## 3. A proposta de navegação

### O fato de permissão que decide a forma (verificado por mim, no banco)

```
monetizacao_contas   view.clientes AND scope   |  (view.aquario OR view.monetizacao) AND scope
monetizacao_listas                             |  (view.aquario OR view.monetizacao) AND scope
monetizacao_itens                              |  (view.aquario OR view.monetizacao) AND list_scope
monetizacao_deals                              |  (view.aquario OR view.monetizacao) AND scope
```
`ops.area_chaves where area='minha_unidade'` → `view.broker, view.clientes, view.contatos, view.idu,
view.nps, view.painel_cs, view.painel_unidade`. **Nenhum `view.aquario`.**

O sócio regional entra em `/clientes` por essa área (`areas.ts:355`). Existe **um**: Italo Amaral,
`todas_unidades=false`, 1 vínculo. Ele vê contas e unidades; **listas, itens e negócios são zero por
RLS**. E `/clientes` abre no Cockpit por padrão (`clientes.tsx:5`, default trocado em `177ef46`). Ou
seja: o único sócio regional do sistema aterrissa numa tela cuja aba se chama **"Listas para sócios"** e
que, para ele, está vazia — sem uma palavra de explicação. É a causa do "0 negócios" da aba Negócios.

**Correção à spec:** ela diz "24 usuários têm `todas_unidades` e há 85 vínculos… a maioria vê a base
filtrada sem saber". Hoje é o inverso: **36 de 37 veem tudo**, os 14 vínculos de cinco usuários são
decorativos (`todas_unidades=true` sobrepõe), e **um** usuário é recortado.

O banco já separa *explorar a base* (`view.clientes`) de *montar e enviar lista* (`view.aquario`). Uma
navegação que desenha na mesma linha resolve esse caso por construção.

### Proposta: tronco com irmãs, e as cinco abas reunidas **no menu lateral**

Três níveis viram dois. Tudo dentro da área `clientes`, para a lateral nunca trocar debaixo do operador.

**Nível 1 — itens do menu lateral, grupo "Carteira":**

| entrada | path | chave | conteúdo |
|---|---|---|---|
| Base de clientes | `/clientes` | `view.clientes` | funil + grade de carteiras + tabela de contas |
| **Produtos e listas** | `/clientes/produtos` | a decidir (ver pergunta 2) | 3 cards de produto + tabela do produto + biblioteca de listas + montagem |
| **Contratos e churn** | `/clientes/contratos` | — | `contratos-clientes.tsx` |
| CS · Auditoria · Reforma | — | — | intocados |

Rotas sem item de menu (destino de clique e breadcrumb): `/clientes/unidade/$unitKey`,
`/clientes/contatos`, `/clientes/entenda`.

**Nível 2 — recorte com controle visível, nunca aba.** Em `/clientes`, "por unidade" e "lista de contas"
viram um controle de duas posições (`?recorte=`). **Não existe nível 3**: o `<Sheet>` da unidade
(`aquario.tsx:433`) vira rota, a ficha vira `?conta=`.

**O que responde "reunir em um menu só":** as cinco abas do Aquário deixam de ser abas e reaparecem
como **itens do menu lateral**, exatamente como `/monetizacao?aba=` já faz em `areas.ts:295-309`. O
menu único que o dono pediu é a lateral — que é onde elas estavam antes de `0b29b44` apagá-las.

**O nome.** Não "Listas" seco: a palavra já nomeia três coisas diferentes na mesma tela — o Panel
"Listas potenciais por produto" (`aquario.tsx:217`, que é recorte de produto), a aba "Listas para
sócios" (`:312`), e as linhas de `ops.monetizacao_listas`. **"Produtos e listas"** é a palavra do dono e
reserva "listas" ao objeto que vai ao Pipedrive.

### A alternativa que descartei, e por quê

**"Uma rolagem, quatro âncoras"** — a página única com as quatro seções empilhadas na ordem que o dono
ditou, que é o que a spec `docs/spec-cockpit-da-base.md` já decidiu (`:366-367`, tabela de fluxo
`:214-232`).

Seu melhor argumento, e é bom: *"âncora não é aba, porque as quatro seções ficam montadas ao mesmo
tempo, a rolagem é contínua, e clicar não troca conteúdo — só move o scroll"*. É a leitura mais fiel da
sequência que o dono ditou, e ela é honesta ao admitir sozinha que *"a barra de âncoras é uma faixa de
abas com outro nome"*.

Descartei por três razões concretas:

1. **A seção de montagem é estruturalmente vazia para o sócio regional** — `monetizacao_listas` e
   `monetizacao_itens` só abrem com `view.aquario`, que a área `minha_unidade` não tem. Numa página
   única não há como não renderizar. Numa rota com chave no item de menu, o item simplesmente não
   aparece. A spec não considerou permissão em nenhum dos quatro blocos.
2. **A fatia grande é indivisível, por admissão própria** — apagar o array `views`, a `<nav>`, o
   `<Tabs>`, fundir dois `TabsContent`, dissolver o `<Sheet>` e introduzir dois params, num commit só.
   Contra a regra de fatia publicável sozinha.
3. **Ninguém mediu o render** de uma página que monta grade de unidades + `PortfolioTable` +
   `ListWorkspace` (757 linhas) + `Gates` sobre 9.992 contas.

### Onde esta proposta ainda não responde ao dono — dito na cara

- **Queixa 3 ("reunir em um menu só")**: se as cinco abas virarem itens da lateral, responde. Se
  virarem três rotas espalhadas, **faz o contrário do verbo**. A versão acima escolhe a primeira.
- **Queixa 1 ("empresas/contatos/negócios estão inúteis, não vou usar ali")**: só **Negócios** morre.
  "Empresas" seria **promovida** a corpo de `/clientes`, e "Contatos" vira rota sem menu. Isso não é
  "sumir" — é o oposto. Vai como pergunta, não como decisão tomada.

---

## 4. Pesquisa externa de UX

Só entra referência aberta de verdade e que muda uma decisão aqui. As da spec não foram repetidas.

| URL | Regra operável em `/clientes` | O que não resolve |
|---|---|---|
| nngroup.com/articles/local-navigation/ | *"it realistically can support only 2–3 tiers"*; abaixo disso, breadcrumb em vez de camada | não diz qual nível vira rota |
| nngroup.com/articles/tabs-used-right/ | *"avoid stacking tab lists within one tab control"*; *"the fewer tabs, the better"* | não fala de linkabilidade |
| atlassian.design/components/tabs/usage | *"Don't use tabs to navigate to different pages, or states"* e *"…to separate information that users need at the same time, such as filtering data within a single table"* → "Todas as contas" e "Carteiras por unidade" são **filtro da mesma tabela**, não aba | não dá limite numérico |
| carbon (tabs/usage.mdx) | *"Do not use vertical tabs in place of navigation"*; "four tabs or less" | **achado negativo:** Carbon **não** proíbe aninhar — a proibição não vem daqui |
| linear.app/docs/filters | *"The applied filters are also reflected in the browser URL"*; só os filtros principais entram → resolve o limite de tamanho de URL que a spec levantou | não diz onde mora a seleção de itens |
| linear.app/docs/custom-views | view salva vive na página **Views**, com "Copy view URL" | view salva ≠ lote escolhido a dedo |
| knowledge.hubspot.com/lists/create-active-or-static-lists | lista é objeto de primeira classe em rota própria (CRM > Segments); **ativa** recalcula, **estática** não — distinção que falta ao Aquário | não descreve a tela de montagem |
| help.klaviyo.com (Lists & segments) | lista e segmento na **mesma** aba: biblioteca única, não uma aba por tipo | objeto é contato, não conta |
| attio.com/help/…/objects-lists-and-views | separa **objeto** / **lista** ("a group of records… used to represent a workflow") / **view** | não confirma URL própria da lista |
| braze.com/docs/…/segments | segmento é reutilizável entre campanhas, em seção própria | segmento é sempre dinâmico |
| github.com/Shopify/polaris — `IndexTable.tsx` | `getPaginatedSelectAllAction()`, `SelectionType.All` vs `.Page`, e `Polaris.IndexTable.undo` → o aviso de seleção maior que a página **tem desfazer no mesmo lugar** | é seleção por página, não sobrevivência a troca de filtro |
| ui.shadcn.com/docs/components/data-table | `getFilteredSelectedRowModel()` vs `getSelectedRowModel()` → a diferença entre os dois **é** o alerta de "seleção fora do filtro" | não persiste seleção entre rotas |
| ui.shadcn.com/docs/components | **achado negativo:** não existe Toolbar, Action Bar, Bulk Actions, Split View, Master Detail nem Segmented Control | barra de lote é composição, não instalação |
| ui.shadcn.com/docs/components/sidebar | `SidebarGroup` + `SidebarMenuSub` dá navegação secundária **sem aba** | ainda precisa de rota para ter endereço |
| ui.shadcn.com/docs/components/breadcrumb | compor `BreadcrumbItem` com `DropdownMenu` → trocar de unidade sem voltar à grade | breadcrumb não carrega seleção |

**Contraditório, que tem que constar:** a NN/g defende aba justamente quando o operador **não** precisa
ver dois conteúdos ao mesmo tempo, e o "One Thing Per Page" defende quebrar em páginas em vez de
empilhar. Juntos, dizem que "quatro blocos numa rolagem só" pode piorar — e é exatamente a proposta que
a spec adotou.

**Inventário conferido no repo** (`src/components/ui/`): existem `breadcrumb`, `sidebar`, `collapsible`,
`tooltip`, `toggle`, `sheet`, `tabs`, `pagination`, `scroll-area`. **Não existem** `toggle-group.tsx`
nem `resizable.tsx`, e `@radix-ui/react-toggle-group` não está no `package.json`. O controle de duas
posições é dependência nova ou composição de botões — não é instalar componente.

---

## 5. Fatias, a menos arriscada primeiro

**F0 — o payload declara a permissão.** `functions.ts:49-55` já calcula `aquario` e `clients` e
**descarta os dois** em `:120` (`permissions: { view, manage, send, all_units }`). Sem isso, qualquer
tela que caia vazia por RLS continua caindo vazia **em silêncio** — que é o defeito que a proposta diz
corrigir. Uma linha no servidor.

**F1 — a lista aberta para de ser destruída.** `list-workspace.tsx:29` declara `id?`/`revision?`;
`draftFrom` (`:40-46`) carrega o `id`; **`empty()` (`:47-56`) não tem `id`**; e o efeito de `:86-109`
faz `setDraft({ ...empty(), … })` quando `initial` chega. Efeito: abrir lista salva → voltar à base →
selecionar → "Preparar lista" → **a lista aberta é substituída e os itens somem**; o próximo salvar
cria lista nova. Perda de trabalho real, independente de arquitetura.

**F2 — o resto da Fatia 1 da spec, que ficou pela metade.** Conferido em `ffed13a`: feitos os itens 1, 2
e 3. Faltam três, ~6 linhas:
- `aquario.tsx:518-519` — `setPicked` está sob o guard, **`setLimit(50)` não**. Digitar na busca ainda
  joga fora "mostrar mais 50".
- `aquario.tsx:457-458` — o KPI de origem dentro da gaveta ainda faz `setFilters({ ...emptyFilters,
  origin: [key] })` + `setPicked(new Set())`: zera produto e seleção. Deveria ser `change("origin",[key])`.
- `list-workspace.tsx:301-305` — "Nova lista" descarta rascunho sujo sem perguntar, enquanto o botão de
  trocar de lista (`:317-321`) pergunta.

**F3 — parar a casca dupla.** `embedded` passa a suprimir o `<h1>` e o "Atualizar" **de fora**
(`base-unica.tsx:190`, `:196-208`), mantendo o `Freshness` — que é o único gatilho de sync do CRM.

**F4 — migrar para o `PortfolioTable` o que só existe em "Empresas"** (coluna CNPJ, espelho Pipefy com
data, cinco colunas do CSV). Publica sozinha; sem ela, matar "Empresas" perde dado.

**F5 — o tronco e os redirects, zero pixel.** `clientes.tsx` vira `<Outlet/>` (cópia de
`unidades.tsx`, 11 linhas); conteúdo vai para `clientes.index.tsx`; `beforeLoad` traduz `?view=` no
molde de `unidades.index.tsx:11-26`. **Precisa da tabela `view → destino` completa para os seis valores**,
e `src/routes/_authenticated/aquario.tsx` tem que entrar junto — hoje ele redireciona para `/clientes`,
não para a tela nova.

**F6 — "Contratos e churn" sai.** Responde à queixa 4 sozinha. Reaponta `rede-overview.tsx:1182` e
conserta `:979`/`:993` de quebra.

**F7 em diante** — "Produtos e listas", a gaveta da unidade como rota, o controle de recorte. Só depois
das perguntas abaixo respondidas.

---

## 6. Perguntas para o dono (decisão de produto, com recomendação formada)

1. **"Empresas" é promovida em vez de removida — ok?** Você disse "não vou usar ele ali", mas ela é a
   única tela com busca e coluna de CNPJ e com o CSV completo. *Recomendo:* promover o **conteúdo**
   (F4) e apagar a **aba**, não o dado.
2. **Qual chave guarda "Produtos e listas"?** Medido por mim (união de `user_roles×role_areas×area_chaves`
   e `usuario_areas×usuario_chaves`): `view.aquario` = **22** pessoas; `manage.aquario` = **16**;
   `send.monetizacao` (o botão de enviar ao Pipedrive) = **16**. São três portões distintos, e a tela
   modela um só. Guardar por `manage.aquario` esconde a tela de 6 pessoas que hoje leem os cards de
   produto; guardar por `view.aquario` dá o item de menu a 6 que não conseguem salvar lista.
   *Recomendo:* menu por `view.aquario`, botões de montar/enviar desabilitados com motivo no `title`.
   (O crítico do workflow reportou 15/15 "restrito a `produto_acesso='ops'`"; essa coluna **não existe**
   no schema `ops` — conferido em `information_schema.columns`. Valem 16/16.)
3. **"Contatos" some do menu ou ganha entrada própria?** É a única tela que lista nominalmente os
   contatos vinculados a conta; `/base-contatos` cobre a população complementar. *Recomendo:* rota sem
   item de menu, alcançável da ficha e de um link em `/base-contatos`.
4. **"Negócios" morre?** *Recomendo:* sim — a pergunta "quais negócios desta unidade" volta como bloco
   na rota da unidade, custo de query zero (`data.cards` já vem no payload).
5. **As 494 de "Validar origem" vão para onde?** *Recomendo:* chip de pendência no funil de `/clientes`,
   mais um card "Sem unidade resolvida" — mas as 424 sem `unidade_ids` são **issue de dado**, não de tela.
6. **`hunter_monetizacao` pode registrar churn?** Hoje pode, porque `manage.clientes_churn` é chave de
   área. Mover a tela não fecha. *Recomendo:* tirar, em issue separada de permissão.
7. **O default de `view` muda de novo?** `177ef46` (21/09) trocou para `monetizacao`. Esta proposta
   revoga isso oito dias depois, porque abrir todo mundo no Cockpit abre o sócio regional numa tela
   parcialmente cega. *Recomendo:* revogar e registrar em `DECISIONS.md`.

---

## 7. O que não foi provado

- **Nenhuma afirmação de tela vem de render.** Não há servidor rodando neste worktree; tudo é JSX lido.
- **Nenhuma arquitetura foi medida em desempenho.** O argumento contra a página única é de permissão e
  de fatiabilidade, não de render. E `use-monetizacao.ts:16-46` → `catalog-loader.ts:13-53` busca até
  100 páginas com concorrência 4 — entrada a frio em cinco rotas irmãs paga isso cinco vezes, e
  **ninguém mediu**.
- **Não se provou que alguém usa ou deixa de usar qualquer aba.** Só há trilha de escrita.
- **Recon não foi investigado a fundo por nenhuma lente.** O que se sabe: `recon.tsx` tem seis filtros
  próprios, **não** está em `PRODUTOS` (`types.ts:2`), e `grep onList|lista` devolve zero — **ele não
  produz lista nenhuma**. Onde ele mora é pergunta aberta, e exige abrir o arquivo antes de decidir.
- **`DirectSend`** (`aquario.tsx:697`, `:706-718`) criou metade das listas do banco e não foi
  considerado por nenhuma proposta. `filters.unit` alimenta o `unidade_id` que ele grava; errar isso
  grava unidade errada no Pipedrive.
- **`validated_at` é NULL nas 6 listas** de `ops.monetizacao_listas`. "Validada com o sócio", razão de
  ser declarada da lista, nunca aconteceu.

---

*Escrito em 2026-09-22 contra `HEAD ffed13a`. 71 agentes, 6,8M tokens, 75 min. Árvore de trabalho
conferida limpa antes e depois: nenhum subagente escreveu no fonte.*
