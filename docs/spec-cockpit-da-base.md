# Cockpit da Base - spec

> Escopo: o que o dono pediu nos 7 itens. Tudo que a pesquisa sugeriu além disso está em "Fora do escopo desta spec".
> Regra de evidência usada aqui: afirmação sobre código vem com `arquivo:linha`; afirmação sobre dado vem com o número conferido no banco (Management API, só SELECT, em 21/09/2026). Afirmação que a contestação derrubou aparece marcada como **hipótese não confirmada** e não sustenta nenhuma decisão.
> Repositório: `/Users/pluca/Desktop/AI Projects/PM Work/execution/planning-brain-filtros-multi` (worktree, branch `feat/filtros-multiselecao-20260918`). Todos os caminhos abaixo são relativos a essa raiz.

## O problema, em uma frase

A tela empilha duas cascas com controles duplicados e guarda 100% do trabalho do operador em `useState` de componentes que o próprio produto desmonta a cada clique, então montar uma lista é montar sobre areia — e o número que abre cada carteira não diz o que conta nem admite o que falta.

---

## O que está quebrado hoje (com evidência)

### 1. A ficha da conta é irmã da gaveta da unidade, e fechá-la derruba a gaveta — CONFIRMADO

`src/components/monetizacao/aquario.tsx:399` abre `<Sheet open={!!unit} onOpenChange={(o) => !o && setUnit(null)}>`; `aquario.tsx:429` renderiza `<AccountDetail ... close={() => setAccount(null)} />` **fora** do `<SheetContent>`, como irmão, dentro do mesmo `<main>` (fecha em `:430`). `AccountDetail` é um `Dialog` Radix (`src/components/monetizacao/account-detail.tsx:56`), a mesma primitiva do Sheet (`src/components/ui/sheet.tsx` importa `SheetPrimitive` de `@radix-ui/react-dialog`).

Mecânica verificada na lib instalada (`@radix-ui/react-dialog` 1.1.18): o `DialogContentModal` passa `disableOutsidePointerEvents: context.open` (`node_modules/@radix-ui/react-dialog/dist/index.mjs:147`). Quando `account` vira `null`, `open` já é `false` **enquanto o conteúdo continua montado** pelo Presence rodando os 200ms de fade (`src/components/ui/dialog.tsx:41`, `duration-200`). Nesse instante o `DismissableLayer` recalcula `isPointerEventsEnabled = index >= highestLayerWithOutsidePointerEventsDisabledIndex` (`@radix-ui/react-dismissable-layer/dist/index.mjs:49`) e a gaveta volta a ser dispensável por clique fora. O `SheetContent` de `aquario.tsx:400` não passa nenhum guard (`onPointerDownOutside` / `onInteractOutside`), e o overlay é `fixed inset-0` com `pointerEvents:auto` fixo (`src/components/ui/sheet.tsx:24`; `react-dialog/dist/index.mjs:116`), enquanto o painel ocupa só `sm:max-w-[min(1180px,95vw)]` à direita. Em tela de ~1600px a ficha centralizada (`dialog.tsx:41`, `sm:max-w-3xl`) fica em cima da fronteira: o ponteiro termina do lado de fora e o clique seguinte executa `setUnit(null)`.

Contraprova que fecha o diagnóstico: `DirectSend` (`aquario.tsx:659-678`) e o `Popover` do MultiSelect (`src/components/monetizacao/multi-select.tsx:44`) são igualmente portais, **mas são filhos React do SheetContent** (via `content(unitAccounts, true)` em `aquario.tsx:425`) e nunca fecham a gaveta.

**Efeito no operador:** ele confere um cadastro e volta para a grade de cards sem ter pedido.

### 2. Reabrir a unidade apaga filtros e seleção de propósito — CONFIRMADO

`aquario.tsx:331-339`, `onClick` do card: `setUnit(u); setFilters(emptyFilters); setPicked(new Set());` — incondicional, sem comparar com a unidade já aberta.

`picked` e `filters` são `useState` do `Aquario` (`aquario.tsx:94-95`), componente que **não** desmonta quando a gaveta fecha; só o estado local do `PortfolioTable` (`limit`, `sending`, `aquario.tsx:457-459`) morre. Ou seja: no instante do fechamento acidental o trabalho ainda existe na memória, e é destruído no ato de retomar. `setUnit` só aparece em três lugares (`:127`, `:335`, `:399`): o card é a única porta de volta, e ela sempre zera.

**Efeito no operador:** é isto que transforma "voltei pra tela dos cards" em "perdi completamente a montagem". Item 4 do dono = achado 1 + achado 2, nessa ordem.

### 3. A montagem de lista vive num `TabsContent` que o Radix desmonta — CONFIRMADO

`aquario.tsx:387-394` renderiza `<ListWorkspace>` dentro de `<TabsContent value="listas">`. `src/components/ui/tabs.tsx:38-51` repassa só `className` e `...props` — não há `forceMount` em nenhum lugar de `src/`. O Radix monta `<Presence present={forceMount || isSelected}>` e renderiza `children: present && children` (`@radix-ui/react-tabs/dist/index.mjs:157` e `:174`): aba inativa desmonta.

E o pacote de origem já foi queimado: `startList` grava `draft` (`aquario.tsx:125-130`), o `ListWorkspace` copia para `useState` próprio e chama `onConsume()` (`src/components/monetizacao/list-workspace.tsx:86-109`, `onConsume` na `:108`), que faz `setDraft(null)` no pai (`aquario.tsx:391`). Depois disso a lista existe em um lugar só, e esse lugar desmonta.

Os gatilhos ficam **acima** da faixa de abas (que só começa em `aquario.tsx:301`): card do Recon com `setTab("recon")` (`:220`), cards de produto com `setTab("contas")` (`:242-246`), botão "Conferir regime da base retroativa" com `setTab("contas")` (`:283-292`).

**Efeito no operador:** espiar "Todas as contas" apaga o rascunho, as observações digitadas, o regime confirmado e o segmento corrigido, sem aviso.

### 4. Trocar a visão da Base de clientes desmonta o Aquário inteiro — CONFIRMADO

`src/components/clientes/base-unica.tsx:328-329`: `{view === "monetizacao" ? (<Aquario embedded accountKeys={accountKeys} />) : ...}`. A `<nav aria-label="Visões da base">` (`:209-227`, `onClick` em `:213` chamando `change({ view: key })`, definido em `:71-74`) fica **fora** de todos os ternários, sempre clicável. Clicar em "Empresas" desmonta o `Aquario` e mata os sete `useState` de `aquario.tsx:91-101` (`tab`, `unit`, `account`, `filters`, `picked`, `draft`, `refreshing`).

### 5. Zero persistência: nada em URL, nada em storage, nenhum guard de saída — CONFIRMADO

`grep` em todo `src/`: nenhuma ocorrência de `sessionStorage`, `beforeunload`, `useBlocker` ou `indexedDB`. As 13 ocorrências de `localStorage` são da sessão Supabase (`src/integrations/supabase/cookie-storage.ts`) e do tema (`src/lib/tema-compartilhado.ts`). O rascunho nasce vazio (`list-workspace.tsx:77`, `useState<Draft>(empty)`) e só vira linha no banco pelos dois botões manuais: `persist("draft")` em `:601` e `persist("validate")` em `:650`.

O único `window.confirm` do arquivo está em `:316-323` (string na `:319`) e protege um caso só: abrir outra lista salva. **O botão "Nova lista" ao lado (`:297-308`) faz `setDraft(empty()); setDirty(false); setSelected(new Set())` sem confirm nenhum** — descarta rascunho sujo em silêncio, na mesma tela.

A rota valida seis parâmetros e nenhum é de trabalho: `src/routes/_authenticated/clientes.tsx:4-11` (`view`, `status`, `unidade`, `q`, `origem`, `gate`). `src/routes/_authenticated/aquario.tsx:3-8` é só um redirect para `/clientes?view=monetizacao`.

### 6. Um único par `filters`/`picked` serve duas superfícies — CONFIRMADO

`aquario.tsx:94-95` declara o par; `content()` (`:149-162`) injeta o mesmo par na aba "Todas as contas" (`:383`) e na gaveta (`:425`). `inUnit` esconde apenas o filtro "Unidade" (`:678`) — produto (`:803`), segmento (`:756`) e regime (`:768`) continuam editáveis dentro da gaveta e escrevem no estado compartilhado. Fechar a gaveta (`:399`) só limpa `unit`: os filtros ajustados lá dentro reaparecem em "Todas as contas".

### 7. Digitar na busca apaga a seleção a cada tecla e reinicia a paginação — CONFIRMADO

`aquario.tsx:464-474`: `change()` executa `setPicked(new Set())` (`:472`) e `setLimit(50)` (`:473`) incondicionalmente, para qualquer campo. O input de busca é controlado e sem debounce, chamando `change("query", ...)` a cada caractere (`:704`, dentro de `:698-708`). `limit` é `useState(50)` local (`:457`), consumido em `:497` e só incrementado pelo botão "Mostrar mais 50" (`:1038`).

O reset é seguro de remover para `query`: `query` já entra em `filtrarCarteira` (`src/lib/monetizacao/portfolio.ts:271` e `:277`) e os dois consumidores usam `selected = rows.filter(a => picked.has(a.key))` (`aquario.tsx:498`), não `picked` cru.

### 8. O filtro do topo encolhe a seleção em silêncio — CONFIRMADO

`base-unica.tsx:136` monta `accountKeys` a partir de `filtered`; `aquario.tsx:102-109` reduz `data.accounts` a esse recorte. Mudar busca/unidade/origem/funil no topo encolhe `rows` sem tocar em `picked`; as chaves ficam presas e não entram em `onList(selected.map(...))` (`:634`) nem em `setSending(selected)` (`:651`). O contador (`:895`) imprime `selected.length`, e `picked.size` não aparece em lugar nenhum de `src/`.

Agravante: o próprio arquivo aplica a regra oposta em oito pontos (`:129`, `:244`, `:290`, `:337`, `:420`, `:472`, `:673`, `:851`), com o comentário da `:463` — "Mudar filtro limpa a seleção: nunca enviar conta que saiu da tela (decisão de 16/09)". O filtro do pai é o único furo da invariante que o código declara.

### 9. Os KPIs de origem dentro da gaveta zeram tudo — CONFIRMADO

`aquario.tsx:418-421`: `setFilters({ ...emptyFilters, origin: [key] })` + `setPicked(new Set())`. O spread é sobre `emptyFilters` (= `EMPTY_PORTFOLIO_FILTERS`, `src/lib/monetizacao/portfolio.ts:77-91`), que zera treze campos. E o MultiSelect "Origem da base" logo abaixo (`:690-697`) faz o contrário: `change("origin", v)` → `{ ...filters, origin: v }`. Dois controles do mesmo campo com semânticas opostas no mesmo painel.

### 10. "Selecionar prontas" substitui em vez de somar — CONFIRMADO

`aquario.tsx:618`: `setPicked(new Set(prontas.slice(0, LIMITE_LOTE).map(a => a.key)))` — Set novo, sem ler `picked`. `LIMITE_LOTE = 300` (`:80`). Na mesma tabela, a checkbox de cabeçalho (`:921-927`) faz `const next = new Set(picked); visible.forEach(a => next.add(a.key))` — **soma**. E as checkboxes de linha não são `disabled` para conta fora de `free` (`:947`), enquanto a tela convida a marcá-las: `:899-902` ("N ficam fora do envio e podem ir para uma lista") e o aviso âmbar de `:880-889`.

### 11. "Preparar lista" sem produto cria lista de Consultoria em silêncio — CONFIRMADO

`aquario.tsx:158`: `onList={(keys) => startList(keys, unit, filters.product || "consultoria")}`. Ao abrir a gaveta, `filters` é `emptyFilters` (`:336`), logo `product` é string vazia e o fallback entra. O nome da lista sai como `Consultoria · <unidade>` (`list-workspace.tsx:94`).

### 12. Duplicação de casca entre `ClientesBase` e `Aquario` embutido — CONFIRMADO por inspeção

Na aba "Oportunidades" convivem: dois `<h1>` (`base-unica.tsx:185-208` e `aquario.tsx:165-176`); dois botões "Atualizar" com semânticas diferentes (a casca invalida cache; o `Freshness` do Aquário chama o sync do CRM, `aquario.tsx:113-124`); duas buscas (`base-unica.tsx:242-251` e `aquario.tsx:698-708`); dois filtros de unidade (`base-unica.tsx:252-264` e `aquario.tsx:678-688`); dois filtros de origem (`base-unica.tsx:265-277` e `aquario.tsx:689-697`); duas tabelas de contas; e dois `AccountDetail` montados ao mesmo tempo (`base-unica.tsx:617` e `aquario.tsx:429`).

Também há duplicação de número: o cartão "1 · Bruta" (`base-unica.tsx:290`, `counts.raw = rows.length`) e o KPI "Contas na base conciliada" (`aquario.tsx:190-194`, `data.accounts.length` já recortado por `accountKeys`) são, sem filtro ativo, o mesmo número com dois rótulos na mesma rolagem — **9.992** (conferido: `ops.monetizacao_contas` = 9.992 linhas).

### 13. A grade de unidades não cobre a base — CONFIRMADO no banco

`aquario.tsx:323` percorre `data.units`, que vem de `ops.monetizacao_unidades` (13 linhas). `ops.unidades` tem 15. Conferido por SELECT:

- **Recife (385 contas), Construção Civil (37) e Consultoria (13) não têm card nenhum** — não existe linha em `ops.monetizacao_unidades` com `unidade_id` 13, 10 ou 11.
- **São Bernardo (454 contas) só aparece por acidente**: tem linha com `unidade_id` NULL e é resolvida pelo fallback por nome de `src/hooks/use-monetizacao.ts:44` (`a.units.includes(u.key) || a.unit_label === u.name`). Mudou o rótulo, some a carteira.
- A grade ainda renderiza três cards zerados ("Rótulo indevido", "Sem unidade declarada", "Itaúna") que a própria casca já esconde no select (`base-unica.tsx:139` usa `units.filter(u => u.account_keys.length)`).

Fechamento da conta (todos conferidos): **8.601** é a soma exibida dos cards; **3** contas têm mais de uma unidade e são contadas duas vezes, então **8.598** contas distintas aparecem em algum card; **959** contas têm `unidade_ids` vazio; **435** estão em unidade sem card (385+37+13). 8.598 + 959 + 435 = **9.992**. Ou seja, **1.394 contas (14%) não aparecem em card nenhum**, e o único aviso na tela diz o contrário: "Os totais por unidade não devem ser somados" (`aquario.tsx:378-381`) sugere excesso por sobreposição quando o que há é falta.

### Hipóteses NÃO confirmadas (não usar como fato)

- **"'Preparar lista' pela segunda vez sobrescreve o rascunho em silêncio."** Refutada: quando o efeito de `list-workspace.tsx:86-109` roda, o componente acabou de montar (`dirty=false`, `items=[]`), porque os dois botões "Preparar lista" só existem na aba "contas" (`aquario.tsx:383`) e na gaveta (`:399-427`), nunca com `tab === "listas"`. A perda é a do achado 3 (troca de aba), não esta.
- **"A gaveta guarda um objeto de unidade congelado e diverge do card a cada 60s."** Refutada: `src/hooks/use-monetizacao.ts:19-25` tem curto-circuito por `catalog_at`/`scope_signature`/`base_count` e devolve `previous.units` por referência; `aquario.tsx:112` filtra sobre `data.accounts` sempre fresco, e card (`:346`) e gaveta (`:407`) calculam a mesma expressão. Resta só uma janela estreita: sync do CRM **durante** a gaveta aberta congela a pertinência das chaves.
- **"Nenhuma unidade tem menos de 1K de CNPJs."** Refutada como bug de contagem (ver seção seguinte); confirmada como lacuna de fonte.

---

## O número do card de unidade: o que ele é, o que deveria ser

**O que ele é hoje:** `accounts.length` em `aquario.tsx:346`, onde `accounts = data.accounts.filter(a => keys.has(a.key))` (`:323-325`), com `keys` vindo de `u.account_keys` montado em `use-monetizacao.ts:41-47` pela regra `u.id ? a.unit_ids.includes(u.id) : a.units.includes(u.key) || a.unit_label === u.name`. `unit_ids` é `ops.monetizacao_contas.unidade_ids` (`src/lib/monetizacao/functions.ts:144`). Ele conta **linhas de conta conciliada com unidade resolvida** — não CNPJ, não empresa, não cliente. E no modo embarcado ainda é recortado pelos filtros do topo (`base-unica.tsx:136` → `aquario.tsx:102-109`) com o mesmo rótulo "contas".

**Tabela por unidade** (SELECT em `ops.unidades` × `ops.monetizacao_contas` × `ops.base_conta_cnpjs` × `ops.empresas` × `ops.omie_clientes`, 21/09/2026):

| Unidade | Card hoje (contas) | CNPJs distintos | CNPJs no Pipefy (`ops.empresas`) | CNPJs no Omie | Tem card? |
|---|---:|---:|---:|---:|---|
| Goiânia | 3.110 | 3.099 | 0 | 3.577 | sim |
| Curitiba | 2.854 | 2.791 | 464 | 2.887 | sim |
| Maceió | 582 | 530 | 494 | 50 | sim |
| São Bernardo | 454 | 451 | 451 | 0 | só por fallback de nome |
| Recife | 385 | 385 | 385 | 0 | **não** |
| Belém | 360 | 282 | 232 | 160 | sim |
| Rio de Janeiro | 318 | 307 | 198 | 248 | sim |
| Fortaleza | 260 | 248 | 244 | 0 | sim |
| São Luis | 256 | 246 | 239 | 19 | sim |
| Campo Novo | 246 | 212 | 184 | 78 | sim |
| Patos de Minas | 161 | 135 | 128 | 55 | sim |
| Construção Civil | 37 | 10 | 3 | 0 | **não** |
| Consultoria | 13 | 4 | 0 | 0 | **não** |
| Sorocaba | 0 | 0 | 0 | 0 | não |
| São Paulo | 0 | 0 | 0 | 0 | não |
| **Sem unidade resolvida** | **959** | — | — | — | **não** |
| **Total `ops.monetizacao_contas`** | **9.992** | **9.247** | — | — | — |

**Veredito sobre o item 7 do dono.** Os números pequenos não são erro de contagem: para Fortaleza (card 260 / Pipefy 244 / Omie 0), Recife (385/385/0) e São Bernardo (454/451/0) **não existe no Brain nenhum número maior que o do card**. A premissa "nenhuma unidade tem menos de 1K de CNPJs" é verdadeira no mundo e falsa no banco, e a diferença é integração: `ops.omie_credentials` tem 10 linhas e cobre 8 praças (Belém, Campo Novo, Curitiba, Maceió, Patos de Minas, Rio de Janeiro, São Luis, mais "Planning Partners (Matriz)" e "Planning CWB 01/02"); Fortaleza, Recife, São Bernardo, Sorocaba e São Paulo não têm credencial nenhuma.

Duas distorções colaterais, ambas conferidas:
- **CNPJ é MENOS que conta** (9.247 contra 9.992). Belém cai de 360 para 282, Campo Novo de 246 para 212, Patos de 161 para 135 — 15% a 25% de conta duplicada por CNPJ nessas carteiras.
- **Goiânia não é uma praça comercial no card**: `ops.base_unidade()` reescreve literalmente `'matriz' -> 'goiania'` e `'partners' -> 'goiania'`, e as linhas Omie de "Matriz" (3.577 CNPJs) caem no `unidade_id` 9. Goiânia tem 0 empresas em `ops.empresas` e 100% das 3.110 contas classificadas como origem "nova" — é o razão consolidado da holding ocupando o maior card da grade e distorcendo a leitura de todos os outros por comparação.

**Definição proposta para o card** (três linhas, nada mais):

1. **Número dominante = CNPJs distintos da carteira, rotulado "empresas"**. É o número que responde "tamanho da unidade", que foi a pergunta do dono. Curitiba: **2.791 empresas**.
2. **Linha de cobertura = procedência por fonte**: `catálogo Pipefy 464 · Omie 2.887`, e `Omie não integrado` onde não há credencial (Fortaleza, Recife, São Bernardo). Isso responde o item 7 sem inventar dado: o card para de afirmar censo e passa a afirmar o que foi conciliado.
3. **Linha de ação = o que dá para fazer**: `1.017 aptas em Consultoria` (o produto de maior volume da unidade).

O número de **contas conciliadas** continua existindo, mas dentro do painel da unidade (onde ele é a unidade de trabalho correta) e rotulado `N contas conciliadas`, nunca `N contas`.

**Dependência de dado desta mudança:** `CNPJs distintos por unidade` e `cobertura por fonte` não estão no payload atual. Precisam ser expostos em `src/lib/monetizacao/functions.ts` junto de `monetizacao_unidades` (agregação de `ops.base_conta_cnpjs`, `ops.empresas` e `ops.omie_clientes` por `unidade_id`, mais `ops.omie_credentials` para o "não integrado"). Enquanto isso não existir, entrega-se só a correção de rótulo (`contas` → `contas conciliadas`), que já é metade do ganho e não depende de servidor.

---

## A tela nova, bloco a bloco

Nome: **Cockpit da base**. Caminho continua `/clientes` (ver "Renomear" abaixo). O sistema de abas do Aquário (`aquario.tsx:301-319`) **deixa de existir como navegação principal**: os quatro blocos são quatro seções da mesma página, empilhadas, todas montadas ao mesmo tempo.

### Renomear e pôr em primeiro (item 1 do dono)

Não existe item "Empresas" no menu lateral — o único "Empresas" do produto é a primeira aba dentro de `/clientes` (`base-unica.tsx:47`), e "Base de clientes" já é o primeiro item do primeiro grupo da área (`src/lib/areas.ts:149`). Logo "primeiro da lista, ao lado de Empresas" é a **faixa de abas da tela**, não a barra lateral.

- `src/lib/areas.ts:143` (nome da área), `:149` (item do menu) e `:355` (o mesmo item no menu do sócio regional) → "Cockpit da base".
- `base-unica.tsx:46-53`: mover `["monetizacao", "Cockpit da base"]` para a **primeira** posição do array `views`, antes de `["empresas", "Empresas"]`.
- `src/routes/_authenticated/clientes.tsx:5`: default de `view` passa de `"empresas"` para `"monetizacao"`.
- Ordem da lateral: a barra obedece à ordem do array `AREAS` (`areas.ts:103`), não à coluna `ops.areas.ordem` (que existe e diz `clientes=20`, mas só é lida pelas telas de administração). Mover o bloco da área `clientes` (`areas.ts:140-186`) para antes do bloco `rede` (`:104-139`).
- Para as telas de admin não discordarem, atualizar `ops.areas.nome` do slug `clientes` (hoje "Clientes", divergente de `areas.ts:143`).
- **Não trocar o path `/clientes`.** Ele é referenciado em `areas.ts:149` e `:355`, `src/routes/_authenticated/rede-overview.tsx:979`, `:993`, `:1182`, `src/components/page-content/funil-content.tsx:393`, no redirect de `src/routes/_authenticated/aquario.tsx:4-7` e em `src/routeTree.gen.ts:258-259` — e `ops.page_validations` guarda uma linha com `page_key='/clientes'` (lista canônica em `src/lib/page-validations.server.ts:4`). Rótulo não é chave de nada; path é.

### Bloco 1 — O funil (dobra 1, como está hoje)

**Entra:** filtros da base (`base-unica.tsx:238-284`) e os quatro cartões cumulativos (`:285-316`), sem mudança de comportamento.
**Sai:** nada.
**Muda de lugar:** o KPI "Contas na base conciliada" (`aquario.tsx:190-194`) **deixa de ser renderizado quando `embedded === true`** (a prop já existe em `:84-87`). O funil já respondeu "quantas contas"; o bloco 2 começa pelo que é dele.

### Bloco 2 — Oportunidades por produto

**Entra:** os cards de produto (`aquario.tsx:217-278`), um por produto, redesenhados (ver "Redesign dos cards").
**Sai da dobra:** a faixa de 5 KPIs (`aquario.tsx:189-216`), que hoje repete Cella, Consultoria e Finance com denominadores diferentes dos cards logo abaixo — vai para "Entenda os números" (`:1146-1288`), que existe exatamente para isso. Sai também o card "Mais de um produto" (metadado de leitura, não decisão).
**Muda de lugar:** o botão solto "Conferir regime da base retroativa" (`:279-295`) vira um chip dentro do card da Consultoria; ele continua setando o preset de filtro (`product=consultoria`, `origin=[antiga]`, `status=[qualificar]`) mas **para de chamar `setTab`**.
**Comportamento:** clicar num card de produto aplica o recorte e rola para o bloco 3, com o recorte visível como chip removível no topo da tabela. O card ativo ganha `border-primary bg-primary/5` e `aria-pressed`.

### Bloco 3 — Base de cada unidade

**Entra:** a grade de cards de unidade (`aquario.tsx:320-377`), redesenhada, mais dois cards que hoje não existem:
- um card por unidade de `ops.unidades` que tenha contas — o que faz Recife (385), Construção Civil (37) e Consultoria (13) aparecerem;
- um card fixo **"Sem unidade resolvida — 959 contas"**, clicável, que abre a mesma superfície com o recorte de pendência.

**Sai:** os três cards zerados. Aplicar em `aquario.tsx:323` o mesmo filtro que a casca já usa em `base-unica.tsx:139`: `data.units.filter(u => u.account_keys.length)`.

**Muda de lugar — a mudança estrutural:** o `<Sheet>` (`aquario.tsx:399-428`) **deixa de existir**. O conteúdo dele (os 4 KPIs de origem + o `PortfolioTable`) passa a renderizar **inline, logo abaixo da grade**, na mesma página. A aba "Todas as contas" (`:383`) some como aba e vira o **estado padrão deste bloco**: sem unidade selecionada, a tabela mostra todas as contas; com unidade selecionada (`?unidade=`), mostra a carteira daquela unidade e a grade colapsa para uma linha de breadcrumb com botão "voltar para todas as unidades".

Isso resolve três achados de uma vez: mata a pilha de overlays (achado 1), elimina a segunda superfície que compartilhava `filters`/`picked` (achado 6) e tira a gaveta do ciclo de montagem (achado 13 de paginação/rolagem).

**A ficha da conta** deixa de ser `Dialog` irmão. Dois níveis, e só dois:
- **peek inline**: clicar no nome da empresa expande um `<tr>` extra abaixo da linha (`aquario.tsx:938-960`, gatilho hoje em `:952-955`), com 6 a 10 campos de conferência. O checkbox da linha não se move e a seleção não é tocada. Reaproveita a query `detalheAquario` (`account-detail.tsx:30-45`, `staleTime` 60s) por `account.key`.
- **ficha completa**: dentro do peek, um "ver ficha completa" abre o `AccountDetail` como **painel à direita da tabela** (grid CSS de duas colunas, sem dependência nova), não como camada. A tabela encolhe; nada desmonta.

**Nova action bar fixa de seleção:** os controles que hoje ficam no cabeçalho da tabela (`:617-654`: "Selecionar prontas", "Preparar lista (N)", "Enviar ao Pipedrive (N)") e o resumo de `:895-903` viram uma barra `sticky` no rodapé do bloco, que aparece com N ≥ 1 e some com N = 0. Ela é a prova visível de que abrir uma ficha não apagou nada. Quando houver contas selecionadas fora do filtro atual, ela imprime `N selecionadas · M fora do filtro atual` (hoje `picked.size` não aparece em lugar nenhum — achado 8).

### Bloco 4 — Montagem de lista

**Entra:** o `ListWorkspace` (`list-workspace.tsx:292-754`) como quarta seção fixa da página, **sempre montada**, fora de qualquer `TabsContent`.
**Sai:** nada de conteúdo.
**Muda:** `draft` deixa de morrer no `useState` do componente (ver seção de estado). O botão "Nova lista" (`:297-308`) ganha o mesmo `window.confirm` que `:316-323` já tem.

### O que fica fora dos quatro blocos

- **"Entenda os números"** (`aquario.tsx:395-397`, `Gates` em `:1146-1288`): vira uma seção recolhida no rodapé da página (`<details>`, como `base-unica.tsx:598-614` já faz), recebendo os textos que hoje ocupam a dobra de decisão: `aquario.tsx:296-299`, `:378-381`, `:1280-1284` e o bloco âmbar de Consultoria de `:879-889`.
- **Recon** (`aquario.tsx:384-386`, `src/components/monetizacao/recon.tsx`): não está nos quatro blocos do dono e hoje é uma ilha — só exporta CSV (`recon.tsx:171-183`), não chama `onList`, não chega na montagem, traz o terceiro jogo de filtros da página (`:185-240`) e o aviso dela diz "Seleção somente no Aquário" (`:143-144`) dentro do próprio Aquário. **Pergunta ao dono** (ver seção final). Decisão default desta spec, se ele não responder: Recon sai da tela e vira entrada própria no menu, e os textos contraditórios de `recon.tsx:143-144` e `aquario.tsx:231` são corrigidos.
- **"Acompanhar operação"** (`aquario.tsx:312-318`): sai da faixa de abas. É um link para outra área (`/monetizacao?aba=operacao`) que troca a área ativa da lateral (`src/components/app-sidebar.tsx:166-171`) sem caminho de volta. Desce para o rodapé do bloco 2 ou some — o menu lateral já leva lá.
- **Casca duplicada:** com `embedded === true`, o Aquário para de renderizar cabeçalho e `Freshness` (`aquario.tsx:165-176`) e para de renderizar os filtros de unidade e origem (`:678-697`), que já existem no bloco 1. O mecanismo já está no código: a prop `inUnit` (`:678`) faz exatamente esse tipo de supressão.

---

## O fluxo que precisa funcionar

Item 3 do dono: *"Se eu clico em qualquer base eu audito nominalmente cada cliente, faço pesquisa e sou encaminhado pra tela de montagem de lista."*

| Passo | O que o operador faz | O que muda na tela | O que muda no estado | O que muda na rota |
|---|---|---|---|---|
| 1 | Clica no card de uma unidade (bloco 3) | A grade colapsa para breadcrumb; a tabela abaixo passa a mostrar a carteira daquela unidade; os 4 KPIs de origem aparecem acima dela | `filters` e `picked` **não** são zerados se a unidade for a mesma; se for outra, `picked` é limpo **com aviso na action bar** | `navigate({ search: prev => ({ ...prev, unidade: u.key }) })` — o param já existe (`clientes.tsx:7`) e a casca já filtra por ele, então o funil do bloco 1 passa a refletir a unidade, com rótulo dizendo isso |
| 2 | Clica no nome de uma empresa para conferir | A linha expande em peek inline; a tabela não se move; nenhum overlay abre | `peekKey` (estado local da tabela). `picked` intocado | nada |
| 3 | Clica em "ver ficha completa" | Painel de ficha abre à direita da tabela; a tabela encolhe | `account` deriva da rota | `?conta=<key>` |
| 4 | Fecha a ficha | O painel some; a tabela volta à largura; **a unidade continua aberta e a seleção continua viva** | nada é limpo | `conta` sai da search |
| 5 | Digita na busca | A tabela filtra | `picked` e `limit` **preservados** (correção do achado 7); a action bar mostra quantas selecionadas estão fora do texto | nada |
| 6 | Marca contas e clica em "Preparar lista" na action bar | A página rola até o bloco 4, já montado, com a lista montada | `draft` é entregue ao bloco 4, que **não desmonta** | opcional: `#montagem` |
| 7 | Volta para marcar mais | Rola de volta ao bloco 3 | `draft` do bloco 4 continua vivo; a nova seleção **soma** aos itens quando unidade e produto coincidem | nada |
| 8 | Aperta F5 no meio de tudo | Volta na mesma unidade, mesma ficha, com a cesta e o rascunho de volta | `picked` e `draft` reidratam de `sessionStorage` | `?view=monetizacao&unidade=belem&conta=…` reconstrói a navegação |

Dois portões de segurança:
- **"Preparar lista" fica `disabled` enquanto não houver produto escolhido** (`aquario.tsx:628` ganha `|| !product`), matando o fallback silencioso de `:158` (achado 11).
- **`useBlocker`** do TanStack Router (já disponível, `@tanstack/react-router ^1.168.25`) com `withResolver: true` + `AlertDialog` (`@radix-ui/react-alert-dialog ^1.1.15`, já instalado) quando o operador tenta sair da rota com rascunho sujo (`dirty` de `list-workspace.tsx:78`, o mesmo sinal que já governa o botão de salvar em `:601`). Não usar em toda navegação: só com `dirty === true`.

---

## Decisão de arquitetura de estado

**Escolha: URL search params para *onde você está*, estado elevado + `sessionStorage` para *o que você está fazendo*, e uma camada só de sobreposição.** Nada de `nuqs`, nada de `zustand` nesta spec.

**Por quê:**
- A rota `/clientes` já valida seis params e já implementa o padrão duas vezes (`clientes.tsx:4-11` e `src/routes/_authenticated/monetizacao.tsx:5-16`). É copiar o que existe, não introduzir biblioteca.
- `nuqs` está fora: o adaptador dele declara que "TanStack Router support is experimental and does not yet cover TanStack Start", e este app é TanStack Start (`@tanstack/react-start` no `package.json:39`).
- `zustand` não está no `package.json` (conferido). Uma dependência nova para guardar duas coisas não se paga quando o `Aquario` já é o pai comum das duas superfícies e vai deixar de desmontar.
- `picked` **não** vai para a URL: são chaves de conta em `Set`, podem chegar a `LIMITE_LOTE = 300` (`aquario.tsx:80`), e cada toggle de checkbox viraria uma entrada de histórico.

**Destino de cada estado:**

| Estado | Hoje | Depois | Observação |
|---|---|---|---|
| `tab` (`aquario.tsx:91`) | `useState("carteiras")` | **deixa de existir** | não há mais abas principais; os quatro blocos são seções |
| `unit` (`:92`) | `useState<Unidade \| null>` | derivado de `search.unidade` | guarda-se a **chave**, não o objeto; `unit = data.units.find(u => u.key === search.unidade) ?? null` — resolve de quebra a janela de pertinência congelada em caso de sync |
| `account` (`:93`) | `useState<Conta \| null>` | derivado de `search.conta` | ficha ganha endereço, F5 e botão Voltar |
| `filters` (`:94`) | `useState<Filters>` | continua `useState` no `Aquario`, **com uma superfície só** | exceção: `filters.product` sobe para `?produto=`, porque é o que o card do bloco 2 seta e o que governa "Preparar lista" |
| `picked` (`:95`) | `useState<Set>` | `useState` no `Aquario` + espelho em `sessionStorage` (chave fixa, try/catch em toda leitura e escrita) | a regra "mudar filtro limpa a seleção" (comentário de `:463`, decisão de 16/09) passa a viver **num lugar só**, em vez dos oito pontos espalhados (`:129`, `:244`, `:290`, `:337`, `:420`, `:472`, `:673`, `:851`) |
| `draft` do Aquário (`:96-100`) | `useState`, consumido e anulado (`:391`) | **deixa de ser entregue-e-queimado**: o bloco 4 nunca desmonta, então `onConsume` não precisa destruir a única cópia | |
| `draft` do ListWorkspace (`list-workspace.tsx:77`) | `useState<Draft>(empty)` | `useState` hidratado de `sessionStorage` na montagem, gravado a cada mudança, em try/catch | `sessionStorage` e não `localStorage`: a cesta é de uma sessão de trabalho, não estado permanente. Persistência de verdade continua sendo `persist('draft')` no servidor (`:146-185`) |
| `limit` (`:457`) | `useState(50)` no `PortfolioTable` | sobe para o `Aquario`, passado por prop | sobrevive ao ciclo de montagem e deixa de ser jogado fora pela busca |

**Regra dura que passa a valer:** *uma camada só*. Se já existe uma camada aberta, o próximo detalhe entra **dentro** dela (painel, peek, sub-view), nunca por cima. Onde um overlay for inevitável, ele recebe `onPointerDownOutside={e => e.preventDefault()}` e `onEscapeKeyDown={e => e.preventDefault()}` **com um X grande e um "Voltar para a lista"** visíveis — nunca só o bloqueio.

---

## Redesign dos cards

Princípio: **uma métrica dominante + no máximo três provas**. Hierarquia em quatro camadas — número (32-40px, `tabular-nums`) / contexto / prova (12-14px, `text-muted-foreground`) / detalhe — e a camada 4 não vive no card.

### Card de unidade

| # | Antes (`aquario.tsx:331-373`) | Depois | Componente | Fonte |
|---|---|---|---|---|
| 1 | `{u.name}` (`:342`) + seta | `CardTitle` = nome + `CardAction` com `Badge` de estado (`cobertura parcial`, `sem base declarada`, `interna`) | shadcn `Card`/`CardHeader`/`CardTitle`/`CardAction` (`src/components/ui/card.tsx`), `Badge` (instalado) | shadcn Card docs; Carbon tile (clickable/selectable/expandable) |
| 2 | `{number(accounts.length)} contas` (`:345-348`) | **CNPJs distintos**, 32-40px, `tabular-nums`, rótulo `empresas` (Curitiba: `2.791 empresas`) | texto puro + token | how-to-dashboard (4 camadas, tamanhos por nível) |
| 3 | `Consultoria · C aptas · P com regime a confirmar` + `Cella X` + `Finance Y` (`:349-358`) | some do card; sobra **uma** linha de ação com o produto de maior volume: `1.017 aptas em Consultoria`. O `P com regime a confirmar` vira `Badge` (é gatilho de decisão, tem que estar na face) | `Badge` | NN/g progressive disclosure (não esconder o acionável) |
| 4 | `A antigas · B novas · C a conferir` (`:359-368`) | **barra de composição segmentada** de 3 segmentos, `h-1.5`, largura total, valores no `Tooltip`. Segmento presente com fatia < 2% ganha `min-w-[3px]` | `flex` de `div`s com `width` em % + `Tooltip` (`@radix-ui/react-tooltip ^1.2.8`, instalado). **Não usar Recharts** (`ChartContainer` exige `min-h-*` e carrega `ResponsiveContainer` para 3 segmentos) | Tremor `CategoryBar`; NN/g pré-atentivos (comprimento quantifica, cor categoriza) |
| 5 | `X com contato · Y sem faturamento declarado` (`:369-372`) | **linha de cobertura por fonte**: `catálogo Pipefy 464 · Omie 2.887`, ou `Omie não integrado`, com a fonte no `Tooltip` | mesma barra + `Tooltip` | bullet graph (Few); Smashing (parear cada dado com a sua condição) |
| 6 | — | **`Collapsible` "ver composição"** com o que saiu: Cella, Finance, sem faturamento declarado, com contato, a conferir | shadcn `Collapsible` (`@radix-ui/react-collapsible ^1.1.12`, `src/components/ui/collapsible.tsx`, instalado) | Carbon expandable tile; NN/g (máximo dois níveis) |

**Não usar:** donut (ângulo/área não se comparam bem e rouba espaço em card pequeno) nem sparkline (pede série temporal de 8-12 períodos; aqui é snapshot). `HoverCard` está fora — não está instalado e depende de hover, que não existe em touch.

**Limiar dos badges:** no máximo uma cor de alerta por card, e badge com texto (nunca só cor). Se 8 dos 15 cards receberem ressalva, o badge vira decoração e a tela fica mais carregada do que estava — que é a queixa 6.

### Card de produto

| # | Antes (`aquario.tsx:217-278`) | Depois |
|---|---|---|
| 1 | título do produto | `CardTitle` = produto |
| 2 | vários números concorrentes, repetidos na faixa de KPIs acima (`:195-215`) | **um** número dominante: `N aptas e disponíveis` |
| 3 | perfil aderente como segundo número solto | vira **prova** secundária, 12-14px, no mesmo card — a duplicação Cella/Consultoria/Finance entre as duas faixas acaba |
| 4 | parágrafo âmbar de 4 cláusulas na Consultoria (`:265-280`): "X com regime a confirmar", "Y aptas confirmadas", "Z retroativas excluídas por Simples/MEI", "W fora das ofertas por situação na Receita" | `Badge` "322 a confirmar" na face + o resto no `Collapsible` ou em "Entenda os números" |
| 5 | botão solto "Conferir regime da base retroativa" (`:279-295`) | chip dentro do card da Consultoria, que seta o preset e **não** troca de aba |

**Contrato de clique unificado (hoje há três).** Card de produto seta `filters`+`tab` (`:242-248`); card de unidade abre Sheet e zera tudo (`:334-338`); `Kpi` dentro do Sheet seta `filters` de novo (`:418-421`). Depois: **todo card — produto ou unidade — aplica um recorte e leva à mesma superfície (bloco 3)**, com `aria-pressed`, estado visual de selecionado (`border-primary bg-primary/5`, que os cards de produto já usam e os de unidade não) e o recorte visível como chip removível. Clique de card **nunca** é destrutivo de trabalho em andamento sem aviso.

---

## Referências de UX consultadas

| URL | O que foi aproveitado |
|---|---|
| https://www.nngroup.com/articles/accidental-overlay-dismissal/ | Diagnóstico do bug 4: casos medidos de usuário perdendo seleção ao fechar overlay sem querer; "não empilhe overlay sobre overlay"; X visível reduz fechamento acidental; botão Voltar como desfazer |
| https://www.nngroup.com/articles/modal-nonmodal-dialog/ | Regra de reservar modal para decisão bloqueante; custo de bloquear o conteúdo de fundo (remove o contexto que o operador está auditando) |
| https://21st.dev/blog/react-modal-dialog-components | "Closing on outside click loses work. Fine for a preview, hostile for a form"; "a dialog in local state cannot be linked, survives no refresh"; sheet lateral para list-detail no desktop |
| https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts | Padrão list-detail canônico: selecionar na lista atualiza o painel de detalhe, sem montar/desmontar a lista; responsivo preservando app state — base do bloco 3 |
| https://shopify.dev/docs/api/app-home/patterns/compositions/index-table | Bulk actions bar com contagem, checkbox de cabeçalho em três estados e o caso "selection across pages" — que é literalmente o "Selecionar prontas" de `aquario.tsx:617-623`. Evitar o defeito do Polaris: sobrepor a barra, não substituir o cabeçalho da tabela |
| https://tanstack.com/router/latest/docs/framework/react/guide/search-params | `validateSearch` tipado; `navigate({ search: prev => ({...prev, ...}) })` porque navegação sobrescreve todos os params; "modal visibility, drawer state" citados como estado que cabe na URL; limites de tamanho de URL (motivo de `picked` ficar fora) |
| https://tanstack.com/router/latest/docs/how-to/share-search-params-across-routes | Herança de search params por layout route e o alerta "Navigation overwrites all search parameters" |
| https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking | `useBlocker({ shouldBlockFn, withResolver: true })` devolvendo `{ status, proceed, reset }`; `enableBeforeUnload` para fechar aba/recarregar |
| https://tanstack.com/router/latest/docs/framework/react/guide/route-masking | Lido e **não adotado** nesta spec: dá endereço à ficha, mas não tira a pilha de camadas, que é o que causa o bug 4 |
| https://nuqs.dev/docs/adapters | Contraindicação decisiva: "TanStack Router support is experimental and does not yet cover TanStack Start" |
| https://zustand.docs.pmnd.rs/reference/middlewares/persist | Lido e **não adotado**: `partialize`, `createJSONStorage(() => sessionStorage)`, `skipHydration` para SSR. Fica como plano B se o estado elevado não bastar |
| https://how-to-dashboard.vercel.app/ | Hierarquia em 4 camadas, tamanhos por nível (32-40 / 20-24 / 14-16px), escada de disclosure (visível = resumo, hover = breakdown, clique = investigação), "Layer 4 does not live on the main KPI card", e "não usar sparkline em snapshot" |
| https://www.pencilandpaper.io/articles/ux-pattern-analysis-data-dashboards | Nome do problema dos cards ("density disjoint"); drawer preserva contexto vs página de detalhe cabe tudo |
| https://www.nngroup.com/articles/progressive-disclosure/ | Máximo dois níveis; o rótulo do segundo nível tem que criar expectativa correta |
| https://www.nngroup.com/articles/dashboards-preattentive/ | Comprimento e posição 2D quantificam; cor categoriza; área e ângulo (donut/gauge) não se comparam bem — base para barra segmentada |
| https://www.nngroup.com/articles/tooltip-guidelines/ | Nunca esconder em tooltip informação acionável; tooltip não existe em touch — por isso "regime a confirmar" vira badge, não tooltip |
| https://www.tremor.so/docs/visualizations/category-bar | Forma canônica da barra de composição (`values[]`, `colors[]`, `marker`) — desenho copiado, lib não adotada |
| https://en.wikipedia.org/wiki/Bullet_graph | Barra compacta com medida + marcador de alvo: forma certa para "conciliadas contra declaradas" em uma linha |
| https://v10.carbondesignsystem.com/components/tile/usage/ | Nomes e regras dos três comportamentos do card: base, clickable, selectable, expandable |
| https://posthog.com/docs/product-analytics/dashboards | Filtro no nível do painel herdado pelos tiles, com aviso quando o tile sobrepõe — padrão para "filtro do card vs filtro da tabela" |
| https://vercel.com/docs/analytics/filtering | Card/linha como filtro que aplica recorte e abre o drill-down, em produto de produção |
| https://www.smashingmagazine.com/2025/09/ux-strategies-real-time-dashboards/ | "Parear cada dado com a sua condição"; estados nomeados (Live/Stale/Paused) em vez de número nu — base do selo de procedência |
| https://ui.shadcn.com/docs/components/card, /collapsible, /tooltip, /sheet, /progress, /chart | APIs dos componentes usados; confirmação de que `Sheet` estende o `Dialog` (mesma primitiva — motivo da pilha) e de que `Progress` é single-track, sem empilhamento |
| https://ui.shadcn.com/blocks/dashboard | Layout cockpit de referência: faixa de métricas + gráfico + data table |
| https://ui.shadcn.com/docs/components/resizable | Lido e **não adotado**: `react-resizable-panels` não está no `package.json`; grid CSS de duas colunas resolve o split sem dependência |
| https://21st.dev/s/toolbar, /s/table, /s/drawer, /s/resizable, /s/stats, /s/card | Catálogo de referências visuais para a action bar ("Action Toolbar — Ruixen", "Unsaved changes — Steven Ching"), tabela com seleção de linha ("Data Grid Table — Sean Hello") e cards de métrica com progresso |

---

## Plano de execução em fatias

Cada fatia é entregável sozinha. **A fatia 1 não é redesign: é parar a perda de trabalho.**

### Fatia 1 — Parar a sangria (1 dia, ~15 linhas)

Seis edições pontuais, sem mudar arquitetura nem layout:

1. `aquario.tsx:400` — `<SheetContent onPointerDownOutside={e => e.preventDefault()} onInteractOutside={e => e.preventDefault()}>` **e** mover `<AccountDetail .../>` da `:429` para dentro do `<SheetContent>`, logo após `{content(unitAccounts, true)}` (`:425`). A segunda é a que corrige a causa (a ficha vira filha React da gaveta); a primeira é o cinto de segurança.
2. `aquario.tsx:334-338` — `onClick={() => { if (unit?.key !== u.key) { setFilters(emptyFilters); setPicked(new Set()); } setUnit(u); }}`.
3. `aquario.tsx:387` — `<TabsContent value="listas" forceMount className={tab === "listas" ? "" : "hidden"}>`. **A classe `hidden` é obrigatória**: com `forceMount`, `present` é sempre `true` e o Radix define `hidden: !present` = `false` (`@radix-ui/react-tabs/dist/index.mjs:157` e `:164`) — sem a classe o painel inativo ficaria visível.
4. `aquario.tsx:464-474` — `if (key !== "query") { setPicked(new Set()); setLimit(50); }`.
5. `aquario.tsx:418-421` — trocar por `change("origin", [key])` (o mesmo caminho do MultiSelect de `:690-697`), acabando com os dois comportamentos do mesmo campo.
6. `list-workspace.tsx:301-305` — o botão "Nova lista" ganha `if (dirty && !window.confirm("Há alterações não salvas. Descartar?")) return;`, igual a `:317-321`.

Com isso, o caminho relatado pelo dono deixa de destruir trabalho, **antes** de qualquer mudança visual.

### Fatia 2 — Persistência mínima (meio dia)

- `list-workspace.tsx:77` hidrata `draft` de `sessionStorage` (chave fixa, try/catch) e um `useEffect` grava a cada mudança.
- `useEffect` registrando `beforeunload` enquanto `dirty === true`.
- `useBlocker` + `AlertDialog` na saída da rota com `dirty`.

### Fatia 3 — Estado na URL (1 dia)

- `clientes.tsx:4-11` ganha `conta` e `produto` (`unidade` já existe).
- `aquario.tsx:92` e `:93` deixam de ser `useState` e passam a derivar de `Route.useSearch()`; escrita por `navigate({ search: prev => ({ ...prev, ... }) })`. Guardar **chave**, não objeto.
- `limit` (`:457`) sobe para o `Aquario`.
- `picked` ganha espelho em `sessionStorage`.

### Fatia 4 — Uma camada só (1 dia)

- O `<Sheet>` (`:399-428`) some; o conteúdo vira seção inline do bloco 3.
- "Todas as contas" deixa de ser aba e vira o estado sem unidade selecionada do mesmo bloco — o que elimina a segunda instância do `PortfolioTable` e o conflito do par `filters`/`picked`.
- Peek inline no `tbody` (`:938-960`) substituindo `showAccount` como primeiro nível.
- `AccountDetail` vira painel em grid de duas colunas (`account-detail.tsx:62` troca `Dialog`/`DialogContent` por container); ajustar os três chamadores de `setAccount` (`aquario.tsx:157`, `:385`, `:392`) e o de `base-unica.tsx:617`.
- Abaixo de ~1100px de largura útil, painel único com "voltar" — não forçar duas colunas no notebook do sócio.

### Fatia 5 — Os quatro blocos e o menu (1 dia)

- `ListWorkspace` sai do sistema de abas e vira o bloco 4 fixo.
- Ordem das seções: funil / produtos / unidades / montagem.
- KPIs (`:189-216`) e textos longos (`:296-299`, `:378-381`, `:879-889`, `:1280-1284`) migram para "Entenda os números" recolhido.
- `embedded` passa a suprimir cabeçalho, `Freshness` e os filtros duplicados (`:165-176`, `:678-697`) e o KPI duplicado (`:190-194`).
- Renomear: `areas.ts:143`, `:149`, `:355`; `base-unica.tsx:46-53` (Cockpit da base em primeiro); `clientes.tsx:5` (default `monetizacao`); `ops.areas.nome` do slug `clientes`. **Path `/clientes` intocado.**

### Fatia 6 — Action bar e seleção honesta (meio dia)

- Barra `sticky` no rodapé do bloco 3 com os controles de `:617-654` e o resumo de `:895-903`.
- `N selecionadas · M fora do filtro atual` (usando `picked.size - selected.length`).
- "Selecionar prontas" soma em vez de substituir: `setPicked(new Set([...picked, ...prontas.map(a => a.key)].slice(0, LIMITE_LOTE)))` — e o rótulo de `:622` ("Selecionar 300 de N prontas") precisa ser revisto junto, porque deixa de ser verdade quando as manuais consomem parte das 300.
- "Preparar lista" `disabled` sem produto (`:628`), removendo o fallback de `:158`.

### Fatia 7 — Cobertura da grade (meio dia de código + decisão de dado)

- `aquario.tsx:323` filtra `u.account_keys.length` (some os três cards zerados).
- Card fixo "Sem unidade resolvida — 959 contas", clicável.
- A `Notice` de `:378-381` vira reconciliação que fecha a conta: `8.598 em cards + 959 sem unidade + 435 em unidade sem card = 9.992` (e 3 contas aparecem em dois cards, por isso a soma exibida é 8.601).
- **Dado, não código:** criar a linha de Recife em `ops.monetizacao_unidades` e preencher `unidade_id` de São Bernardo (12) e Itaúna. Sem isso, 839 contas de duas praças reais continuam invisíveis.

### Fatia 8 — Redesign dos cards (1-2 dias)

- Card de produto primeiro (não depende de dado novo).
- Card de unidade em duas etapas: (a) rótulo `contas conciliadas` + barra de composição + `Collapsible`, com o que já está no cliente; (b) número dominante em CNPJs + linha de cobertura por fonte, **depois** que `functions.ts` expuser `cnpjs_distintos`, `cnpjs_pipefy`, `cnpjs_omie` e `omie_integrado` por unidade.

---

## Como testar cada fatia

**Fatia 1.** (a) Belém → marcar 10 empresas → abrir a ficha de uma → fechar com Esc, com X e com clique no escurecido → em cada caso a gaveta continua aberta e as 10 marcações intactas; repetir em tela ≥1600px. (b) Fechar a gaveta pelo X e clicar em Belém de novo: filtros e seleção preservados; clicar em Curitiba: zerados. (c) Preparar lista → digitar observação em 3 itens → clicar num card de produto → voltar: o rascunho está lá, e o painel de "listas" **não** aparece enquanto outra aba está ativa. (d) Marcar 20, clicar "Mostrar mais 50" três vezes, digitar uma letra: 20 marcações e 200 linhas continuam. (e) Dentro da gaveta escolher Consultoria, marcar 15, clicar no KPI "Base antiga": produto e seleção preservados, só a origem muda. (f) Com rascunho sujo, clicar em "Nova lista": aparece confirm.

**Fatia 2.** Montar lista com observações → F5 → rascunho volta. Montar → clicar em "Empresas" no topo → aparece o AlertDialog; "cancelar" mantém; "sair" descarta.

**Fatia 3.** Abrir Belém, abrir a ficha de uma conta, copiar a URL, abrir em outra aba: mesma unidade, mesma ficha. Botão Voltar do navegador fecha a ficha (não sai da tela). F5 volta na mesma unidade com a cesta.

**Fatia 4.** Percorrer o fluxo de 8 passos da seção "O fluxo que precisa funcionar", ponto a ponto. Em 1280px e em 1024px: abaixo de ~1100px o detalhe ocupa o lugar da tabela e o "voltar" traz a tabela de volta com a rolagem e a seleção. Conferir com teclado: Tab até o nome, Enter abre o peek, Esc fecha, Tab seguinte volta para a linha (hoje o foco cai em `document.body` porque `AccountDetail` não tem trigger — `account-detail.tsx:56-57`).

**Fatia 5.** Com perfil sem `todas_unidades` e com perfil de escopo total: contar `<h1>` na página (tem que ser 1), contar botões "Atualizar" (1), contar campos de busca (1), contar filtros de unidade (1). Entrar em `/clientes` sem search: abre no Cockpit da base. Conferir a lateral com papel de sócio regional (`areas.ts:355`) e as telas de admin (`/admin/validacao`) sem entrada morta.

**Fatia 6.** Marcar 5 contas "a confirmar" à mão + clicar "Selecionar prontas": as 5 continuam. Marcar 40, mudar o filtro de unidade no topo: a barra diz quantas ficaram fora. Abrir a gaveta sem escolher produto: "Preparar lista" está `disabled` com o motivo no `title`.

**Fatia 7.** Contar os cards: Recife aparece; os três zerados somem; existe o card "Sem unidade resolvida". Somar os cards na mão e conferir contra a frase de reconciliação e contra `select count(*) from ops.monetizacao_contas` (9.992).

**Fatia 8.** Ler cada card em 3 segundos e dizer o número dominante sem hesitar. Conferir Goiânia (0 antigas / 3.110 novas) — a barra tem que ser um bloco de cor só, que é o sinal de lote de pipeline que hoje some no texto. Conferir Fortaleza: o card diz `Omie não integrado`, não um número limpo passando por censo. Conferir quantos cards têm badge de ressalva: se passar de um terço, o limiar está errado.

---

## Fora do escopo desta spec

Tudo abaixo apareceu na pesquisa ou na auditoria, **não** está nos 7 itens do dono, e não deve entrar junto:

- **Rota filha `/clientes/conta/$key` com route masking.** Dá endereço compartilhável e botão Voltar, mas não resolve o bug 4 sozinho, e a fatia 3 já entrega F5 e link com `?conta=`.
- **`zustand` + `persist`.** Plano B se o estado elevado da fatia 3 não bastar.
- **`react-resizable-panels` / shadcn `Resizable`.** Grid CSS de duas colunas resolve o split sem dependência nova.
- **Tabela comparativa de unidades** (uma linha por unidade, ordenável, no lugar do grid de 13-15 cards). Faz sentido se o gesto principal virar "comparar unidades"; o dono descreve "entrar numa unidade".
- **Recon ganhar "Preparar lista"** (`recon.tsx:171-183` chamando o `startList` do pai) e correção dos textos de `recon.tsx:143-144` e `aquario.tsx:231`.
- **Corrigir a origem dos dados:** de-para de id de campo Pipefy → `ops.unidades` (178 empresas com `unidade` numérica, `unidade_id` NULL, gerando 410 contas em "Unidade a confirmar"); alinhar `ops.base_intake_omie` para gravar `ids` inteiro em vez de `case when cardinality(ids)=1 then ids else '{}'` (121 contas multiunidade hoje invisíveis); classificar as 410 contas órfãs de snapshot (chave hash de 16 hex, sem empresa e sem rótulo).
- **Separar "interna" de "regional"** pelo `ops.unidades.tipo` e tirar Goiânia/Matriz do grid de carteiras regionais.
- **Exibir o escopo do usuário no cabeçalho** ("você está vendo N de 15 unidades"). `data.permissions.all_units` já chega ao cliente (`functions.ts:99`) e hoje só habilita o botão de sync; 24 usuários têm `todas_unidades` e há 85 vínculos em `ops.usuario_unidades`, então a maioria vê a base filtrada sem saber.
- **Trocar o path `/clientes`.** Se algum dia for necessário, seguir o padrão que o repo já usa: criar a rota nova só com `beforeLoad` + `redirect` (igual `routes/_authenticated/aquario.tsx:1-8`) e só depois virar o path — nunca as duas coisas na mesma mudança.

---

## Perguntas em aberto para o dono

Estão no campo `perguntas_ao_dono`.
