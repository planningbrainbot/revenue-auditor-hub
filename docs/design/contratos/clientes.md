# Contrato · Base de clientes (`/clientes?view=*`)

**Dono de produto:** Pedro Luca (navegação da Base, `PRODUCT.md` §4)   **Dono do código:** Pedro · Eliezek (casca, merge)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Levantado em `b5c44d7` (`clientes.tsx`, `clientes/base-unica.tsx`, `clientes/contratos-clientes.tsx`, `monetizacao/{aquario,list-workspace,recon,direct-send,account-detail}.tsx`). **Não muda:** regras de oferta/disponibilidade (`portfolio.ts`), limite de 300, reserva única, envio ao Pipedrive, `manage.aquario`/`send.monetizacao`/`manage.clientes_churn`, RLS. **Não resolve** `PRODUCT.md` 5.4 (forma final da Base: faixa única × rotas irmãs) nem 5.5 (guarda de "Produtos e listas"), que continuam decisão do Pedro; a faixa de 5 entradas de 22/09 fica.

## Moldura
- `PageHeader`: pergunta **por visão** (tabela), `descricao` com o universo da visão (hoje uma frase para todas), `procedencia` da carga. Remove o `TODO(design)`.
- **Um "Atualizar" só**: o do cabeçalho passa a ser o do `Freshness` (dispara a carga do CRM com escopo geral; sem ele, relê e diz o motivo). Hoje há dois com efeitos diferentes.
- A visão **Contratos e churn não espera a carga da Monetização** para abrir (hoje uma falha de `carregarMonetizacao` tranca a visão que não usa esses dados).
- Sem acesso: `EstadoSemAcesso` com a chave (hoje a mensagem do servidor aparece como erro).
- Filtros da tabela da Base (unidade, origem, faturamento, Driva, segmento, regime, Receita, contato, produto, situação, abordagem, sobreposição) vão para a URL; **a busca, a unidade e a origem deixam de existir duas vezes** (topo em URL × tabela em estado): fica a do topo, e a origem passa a ter os 4 valores de `origemBase` com os mesmos rótulos.

| `view` | Título (menu interno) | Pergunta (N1) | Arquétipo |
|---|---|---|---|
| `monetizacao` | Base de clientes | Quais contas desta unidade atendem ao recorte, e quais estão prontas para trabalhar? | Lista/Relatório |
| `produtos` | Produtos e listas | Quantas contas cada produto pode trabalhar agora, e em que lista elas estão? | Visão geral + Lista |
| `pendencias` | Validar origem | Quais contas ainda precisam ter a origem confirmada? | Fila de trabalho |
| `contratos` | Contratos e churn | Quais clientes estão ativos, e quais deram churn? | Lista/Relatório |
| `gates` | Entenda os números | De onde vem cada número da base? | Lista (referência) |
| `contatos` (oculta) | Contatos | Quem são as pessoas das empresas deste recorte? | Lista |

## Números: correções N2/N11 (rótulo e destino; a régua não muda)
- Funil: "Com CNPJ válido" só testa se há CNPJ → "Com CNPJ".
- Cartão da unidade: número grande em **CNPJ** da cobertura (ignora filtros) ao lado de **contas** conciliadas (respeita filtros): o grande passa a "{n} CNPJs no cadastro da unidade" e a linha de contas diz "no recorte". Unidade sem cobertura: "—", não "0 empresas".
- "Omie não integrado" quando o dado de cobertura falta → "cobertura do Omie não apurada".
- **"Enviar ao Pipedrive (N)"**: o botão conta as prontas sem "só no Omie" e o modal envia com "só no Omie". O botão passa a mostrar o mesmo N do modal e a nota do modal diz quantas são "só no Omie".
- Produtos: "Cella · perfil aderente" (KPI, sem "só no Omie") × "com perfil aderente" (cartão, com): rótulos "sem os só no Omie" / "inclui só no Omie". Consultoria: "carteira retroativa" × "retroativas" (subconjunto): "carteira retroativa (base inteira)" × "retroativas aptas". Clique no cartão "aptas e disponíveis" leva ao destino **com a situação "prontas"**, para bater (hoje abre todas as aptas).
- "Mais de um produto" passa a abrir o filtro de sobreposição (a fórmula é a mesma).
- Validar origem: o selo da aba e o cabeçalho usam a mesma base (depois do gate), ou o selo diz "antes do filtro".
- Contratos e churn: "Clientes Ativos" (sem churn) × selo `status=ATIVO` (pagou em 90 dias) na mesma tela → "Clientes sem churn" e "Pagou nos últimos 90 dias". MRR total com churn somado quando o filtro de churn está vazio: nota "inclui clientes com churn". Matiz `indigo` → token.
- "0 alterações na fila de envio ao Pipefy" enquanto carrega → `Carregando`; o link leva à visão que mostra a fila, ou sai.
- "0 pessoas" em Contatos sem acesso ou carregando → o número só aparece com o dado.

## Filas e ações (N5, N8, V6)
- Validar origem: ordem padrão por motivo e unidade (hoje a do catálogo); "Validar origem" por linha desabilitado diz "exige manage.aquario"; o diálogo diz os mínimos (responsável com 3+ letras, evidência com 10+).
- "Preparar lista" desabilitado sem `manage.aquario` diz o motivo; "Selecionar prontas" sem prontas também.
- `confirm()` nativo da `ListWorkspace` (descartar alterações) → `AlertDialog`.
- "Salvar lista" e "Registrar validação" desabilitados dizem o motivo.
- Contratos e churn: tabela paginada/virtualizada na tela (hoje ~3.200 linhas de uma vez); vazio com total; erro de carga → `EstadoErro` (hoje "Carregando…" para sempre ou "Nenhum cliente").
- A ficha da conta (`AccountDetail`) continua `Dialog`; `?conta=` fica fora (decisão de 22/09).

## Visual
Cartões locais do funil, das unidades, dos produtos, dos chips, dos grupos do Recon e do churn → `KpiCard` (os que filtram usam `abrir`); barra de composição da origem com valor visível (não só no `title`).

## Defeitos de dado (não corrigidos; para o dono)
- `central_tratativas ... .limit(2000)` em Contratos e churn corta em 1.000: a contagem de churn pode estar baixa. A tela passa a dizer na `procedencia` "churn lido em até 1.000 cards".
- `origem=confirmar` do topo nunca casa conta sem `base` (que a tabela mostra como "A confirmar").

## O que NÃO entra
Rotas irmãs (5.4), guarda `view.aquario` (5.5), fusão com `/base-contatos` (5.9), `?conta=`.
