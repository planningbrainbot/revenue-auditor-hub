# Contrato · Monetização, moldura comum (`/monetizacao?aba=*`)

**Dono de produto:** Pedro Luca   **Operação:** Matheus Carvalho (hunter), Samira; gestão comercial na daily   **Dono do código:** Pedro Luca (telas) · Eliezek (casca, `areas.ts`, merge)   **Data:** 23/09/2026

Estado: **aprovado pelas propostas** (Pedro, 24/09).

Este arquivo vale para as nove visões de `/monetizacao`. Cada visão tem contrato próprio (`monetizacao-<aba>.md`) com pergunta, números e ações; aqui fica o que é igual em todas: cabeçalho, filtros, fonte, estados, permissões e o detalhe de oportunidades. Levantado no código em `b5c44d7` (`src/routes/_authenticated/monetizacao.tsx`, `src/components/monetizacao/{dashboard,analysis,forecast,forecast-model,common}.tsx`, `src/lib/monetizacao/{model,functions}.ts`, `supabase/functions/monetizacao-crm/crm.mjs`) e medido no banco em 23/09 (178 negócios, 0 sem histórico, última carga 23/09 20h20).

**Regras de cálculo, consultas, RLS e permissões não mudam.** O que muda está marcado como **[apresentação]** (aplicar direto depois do "contrato ok"), **[lógica · aprovar]** (proposta; só com aprovação caso a caso) ou **[fluxo · aprovar]**.

## Unidade de contagem e eventos
- Unidade: **negócio** do Pipedrive, pipeline 39, sempre distinto. Etapas "reciclado, perdido, descartado, estacionado, parking" ficam fora da carga (`crm.mjs:17`).
- Produto = campo "Caixa · Produto" (1128 Cella, 1129 Consultoria, 1130 Finance; outro valor = Sem produto).
- Eventos, com data em São Paulo e deduplicados por (dia, ator), `crm.mjs:39-85`:
  - `loaded` (carregado): criação do negócio; ator = dono na criação;
  - `started` (trabalhado): primeira saída da primeira etapa;
  - `scheduled` (reunião marcada) e `meeting` (reunião realizada): entrada na etapa correspondente;
  - `validated` (oportunidade validada): primeira entrada em Negociação ou etapa posterior;
  - `signed` (contrato ganho): status `won` com `won_time`; ator = quem marcou o ganho (DECISIONS 18/09).
- Negócio sem histórico lido (`history_known=false`) só tem `loaded` e `signed`. Hoje são 0 de 178.

## Cabeçalho (N1)
- `PageHeader` com `titulo` = rótulo do item do menu (`areas.ts`), `pergunta` da visão (ver o contrato de cada uma), `descricao` com o universo e `procedencia`.
- `procedencia`: "Pipedrive, pipeline 39, via carga da Monetização · atualizado em {measured_at}". O catálogo de empresas tem relógio próprio ("Empresas · {catalog_at}") e continua em `acoes`, ao lado do botão Atualizar (DECISIONS 22/09, "A barra de frescor mostrava o relógio errado").
- O logo "Caixa de Oportunidade" sai do cabeçalho de cada visão **[apresentação]**. Ele é a marca do painel antigo; na casca do Brain a área já se identifica pelo anel e pelo nome "Monetização" no eyebrow.
- Remover o `TODO(design)` de `dashboard.tsx:79`.

## Abas: a lateral é o menu (N6)
- Hoje a página desenha de novo, num `role="tablist"`, as nove visões que a lateral já lista, em outra ordem e com outro rótulo ("Operação" × "Operação diária"). A lateral não mostra a Fila Cella; a faixa da página não mostra a Fila Cella.
- **[fluxo · aprovar] F1.** A faixa de abas da página sai. A lateral passa a ser o único menu das visões (NAVEGACAO §4.1, princípio 2; é o que o Cockpit fez em 23/09). `?aba=` continua igual, então nenhum link quebra. `areas.ts` não muda.
- O link "Clientes → Aquário ↗" que mora na faixa sai junto. Os caminhos para a Base ficam onde há ação: Capacidade ("Preparar a base…") e Distribuição ("Abrir as listas…"), com o nome atual da tela ("Produtos e listas", `/clientes?view=produtos`) no lugar de "Aquário" (a rota `/aquario` é redirect desde 22/09).

## Filtros na URL (N7)
Hoje os quatro vivem em `useState` (`dashboard.tsx:85-91`) e se perdem ao recarregar ou colar o link.

| Parâmetro | Valores | Padrão | Afeta | Onde aparece |
|---|---|---|---|---|
| `de`, `ate` | `aaaa-mm-dd`, até 3 anos | 1º dia do mês corrente → hoje (São Paulo) | eventos do período | Operação, Temporal, Capacidade (só o mês de `ate`), Funil, Distribuição |
| `responsavel` | id do usuário no Pipedrive, ou `todos` | Matheus Carvalho (`28381245`) | ver cada visão: ator do evento ou dono atual | Operação, Follow Day, Temporal, Capacidade, Funil, Pessoas |
| `produto` | `cella`, `consultoria`, `finance`, `sem_produto` | todos | negócios do produto | Operação, Follow Day, Temporal, Funil, Distribuição |
| `dias` | 1–180 | 7 | régua de "sem movimento" | Follow Day |
| `mes` | `aaaa-mm` | mês de `ate` | mês comparado | Projetado × realizado |

- **[apresentação]** A barra só mostra o que a visão usa: Follow Day não mostra De/Até (é estoque), Abordagens não mostra filtro nenhum, Projetado × realizado mostra só o mês.
- **[apresentação]** O rótulo do filtro diz o sentido que ele tem na visão: "Quem fez o movimento" (Operação, Funil, Distribuição) ou "Dono atual" (Follow Day, Temporal). Hoje é "Responsável pelo movimento" em todas, e em três delas o código usa o dono atual.
- **[lógica · aprovar] Z0.** O padrão `responsavel = Matheus` está fixo no código em quatro lugares. Proposta: manter Matheus como padrão, só que declarado na URL e escrito no cabeçalho ("Matheus Carvalho · set/2026"), para quem não é o Matheus saber que está vendo outra pessoa. Alternativa: padrão "Toda a frente". Decisão do Pedro.

## Detalhe de oportunidades (drill-down de todo número, N2)
- Todo número clicável abre o mesmo `Dialog` (`DealDetails`) com exatamente os negócios que compõem o número. Colunas: Empresa (link para o Pipedrive), Produto, Dono atual, Etapa atual, Data prevista, Receita prevista (com a situação do split), Partners, Unidade. Busca local. "Histórico no período" por linha.
- **[apresentação]** O cabeçalho do detalhe diz o recorte inteiro: "{n} oportunidades · {responsável} · {produto} · {de} a {até}". Quando o número é estoque (Funil agora, Follow Day, Validadas em aberto), diz "abertas hoje" e **não** mostra o período, que não vale para a lista.
- **[apresentação]** Ordem das linhas: data do evento que o número conta, mais recente primeiro (hoje é a ordem do id no banco). Vazio: `EstadoVazio` "Nenhuma oportunidade neste recorte."
- O destino bate: **sim** (é o mesmo conjunto de linhas).
- O detalhe continua `Dialog` (não `Sheet`) porque é lista, não ficha, e não troca de rota.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | primeira leitura | `Carregando variante="kpis"` (hoje: painel "Carregando carteira e operação…") |
| Erro sem dado em cache | falha de `carregarMonetizacao` | `EstadoErro` com a fonte ("carga da Monetização") e "Tentar novamente" |
| Sem acesso | sem `view.monetizacao` e sem `view.aquario` | `EstadoSemAcesso oQueFalta="view.monetizacao"` (hoje cai no erro com a mensagem do servidor) |
| Só Base | tem `view.aquario`, não `view.monetizacao` | `EstadoSemAcesso oQueFalta="view.monetizacao"` com ação "Abrir Produtos e listas" |
| Sem unidade liberada | acesso ativo sem escopo | `EstadoVazio` com o motivo (texto atual) |
| CRM nunca sincronizou | `measured_at` nulo | `EstadoVazio` com o motivo; os KPIs em `indisponivel` (hoje a visão some sem contorno) |
| Carga parada | `sync_error` com carga anterior | números da última carga, `procedencia` "parado desde {hora}" e **[lógica · aprovar] Z1** KPIs em `parcial` com nota "última carga {hora}" |
| Vazio por filtro | recorte sem negócio | KPIs em `0` legítimo (há carga, não houve evento); tabelas com `EstadoVazio total={n}` |

## Permissões (N8) — não mudam
- Entrada: `ops.monetizacao_can('view.monetizacao')`. Escrita (plano, PDI, abordagem, decisão de distribuição) e sync exigem `view.monetizacao` **e** escopo de todas as unidades (`monetizacao_scope`), conferidos de novo na RPC.
- **[apresentação]** Botão desabilitado diz o motivo no tooltip: "Exige acesso a todas as unidades (escopo geral)." ou o campo que falta. Hoje fica `disabled` sem motivo em seis botões.
- O botão Atualizar, sem escopo geral, hoje só relê a tela em silêncio. Passa a dizer "Relê a tela; disparar a carga do CRM exige escopo geral".

## Componentes
- `Kpi` (adaptador sobre `KpiCard`) fica; passa a repassar `estado`, `procedencia` e `nota`.
- `Panel` → `Secao` (título é pergunta). `Notice` → `EstadoVazio`/`EstadoErro` conforme o caso, ou texto de apoio da `Secao`. `LoadingState` → `Carregando`.
- Tabelas `<table>` cruas → `Table` do `ui/` (cabeçalho 12px, número à direita, `tabular-nums`).

## O que NÃO entra, e por quê
- Recálculo de qualquer evento ou mudança na carga (`crm.mjs`, `model.ts`): o v2 é apresentação.
- Uma "Visão geral de Monetização" como porta da área (NAVEGACAO §4.3, proposta): tela nova, exige contrato próprio e a decisão 5.2.
- A lista de contas e o envio ao CRM: moram em Base de clientes → Produtos e listas (DECISIONS 15/09, item 3).

## Para onde manda
- Negócio → Pipedrive (nova aba). Base e envio → `/clientes?view=produtos`. A Fila Cella foi aposentada em 24/09 (`/fila-cella` mostra um aviso e manda para o Follow Day).

## Conflitos de produto que este módulo esbarra (decisão do Pedro, `PRODUCT.md` §5)
- **5.2** Casa única da fila de ligação: Follow Day × `/crm` (Bodra). A Fila Cella saiu da disputa em 24/09 (aposentada por decisão do Pedro).
- **5.7** Pessoas/PDI em três casas: `/monetizacao?aba=pessoas` × `/gente?tela=pdi` × Growth.
- **5.8** Funil comercial e Distribuição em dois apps: Monetização (base) × Growth (inbound).

Proposta para esta migração: **nenhuma fusão**. As telas são migradas como estão, cada contrato declara o conflito, e a fusão fica para quando a decisão existir.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem independente pela Management API, só leitura)
