# Contrato · Base de clientes (`/clientes?view=*`)

**Dono de produto:** Pedro Luca (navegação da Base, `PRODUCT.md` §4)   **Dono do código:** Pedro · Eliezek (casca, merge)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Levantado em `b5c44d7` (`clientes.tsx`, `clientes/base-unica.tsx`, `clientes/contratos-clientes.tsx`, `monetizacao/{aquario,list-workspace,recon,direct-send,account-detail}.tsx`). **Não muda:** regras de oferta/disponibilidade (`portfolio.ts`), limite de 300, reserva única, envio ao Pipedrive, `manage.aquario`/`send.monetizacao`/`manage.clientes_churn`, RLS. **Não resolve** `PRODUCT.md` 5.4 (forma final da Base: faixa única × rotas irmãs) nem 5.5 (guarda de "Produtos e listas"), que continuam decisão do Pedro; a faixa de 5 entradas de 22/09 fica.

## Moldura
- `PageHeader`: pergunta **por visão** (tabela), `descricao` com o universo da visão (hoje uma frase para todas), `procedencia` da carga. Remove o `TODO(design)`.
- **Um "Atualizar" só**: o do cabeçalho passa a ser o do `Freshness` (dispara a carga do CRM com escopo geral; sem ele, relê e diz o motivo). Hoje há dois com efeitos diferentes.
- A visão **Contratos e churn não espera a carga da Monetização** para abrir (hoje uma falha de `carregarMonetizacao` tranca a visão que não usa esses dados).
- Sem acesso: `EstadoSemAcesso` com a chave (hoje a mensagem do servidor aparece como erro).
- Filtros da tabela da Base (unidade, origem, faturamento, Driva, segmento, regime, Receita, contato, produto, situação, abordagem, sobreposição) vão para a URL; **a busca, a unidade e a origem deixam de existir duas vezes** (topo em URL × tabela em estado): fica a do topo, e a origem passa a ter os 4 valores de `origemBase` com os mesmos rótulos. **Unidade e origem continuam de múltipla escolha** (DECISIONS 18/09, "Filtros de múltipla escolha"): no topo são `MultiSelect`, e na URL `unidade` e `origem` são listas (link antigo com valor único continua valendo). Contratos e churn filtra uma unidade por vez: com mais de uma, ou sem a carga para resolver a chave, abre sem unidade e diz por quê (revisão da C1, 24/09).

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

## Adendo 28/09/2026 · Distrato e Consultoria na Base
Pedido do Pedro (28/09): considerar na geração de bases o pedido de distrato da Central de Tratativas (Pipefy) e o vínculo com a plataforma da Consultoria. Estado: **proposto, aguardando "contrato ok"** (pedido junto com o ok de publicação). Arquétipo e anatomia não mudam (Lista/Relatório).

**Entra**
- **Selos na linha da tabela** (abaixo dos selos de produto, `StatusBadge`): "Distrato concluído · dd/mm/aaaa" (perigo), "Em tratativa de distrato" (atenção), "Retido na tratativa" (sucesso); "Cliente da Consultoria" (info, "· raiz do CNPJ" quando casou pela raiz, "· R$ X a recuperar" quando a plataforma informar), "Ex-cliente da Consultoria" (neutro), "Contrato da Consultoria" (info), "Proposta Consultoria · R$ X" (info) e "Proposta Consultoria? · pelo nome" (neutro, incerta). O título do selo traz o motivo da regra.
- **Dois filtros** de múltipla escolha, na URL (`distrato`, `consultoria`): "Distrato · Central de Tratativas" (padrão marcado: sem card, em tratativa, retido; desmarcar tudo = todas) e "Consultoria · plataforma" (cliente por CNPJ, pela raiz, ex-cliente, contrato, proposta em aberto, proposta incerta, sem vínculo).
- **Distrato concluído sai da tabela padrão** e das ofertas; a tabela diz "N contas com distrato concluído ficam fora desta tabela e de todas as ofertas · Ver essas contas" (conta com os mesmos filtros).
- **Procedência** no pé da tabela, uma linha por fonte, com a data da última carga concluída (N3).
- **Ficha da conta**: painel "Distrato e Consultoria" com fase, data do churn, categoria, link "Abrir o card no Pipefy", cliente (razão social, CNPJ, desde, regime, parceiro, valor a recuperar), propostas (valor, produto, envio, último FUP, como casou) e o motivo da regra.
- **CSV**: colunas "Distrato · Central de Tratativas" e "Vínculo com a Consultoria".
- **Números**: cartão "Consultoria · carteira retroativa" separa "já clientes da Consultoria" de "por Simples/MEI"; "Contas na base conciliada" diz quantas têm distrato concluído; "Entenda os números" ganha "Consultoria · já clientes da Consultoria" (sem link: o filtro da tabela não se restringe à carteira retroativa), "Com distrato concluído" e "Em tratativa de distrato" (com link, total bate).

**Para onde manda**: o card da Central de Tratativas no Pipefy (ficha). A plataforma da Consultoria não tem link público por cliente.

**Não entra**: campo novo no negócio do Pipedrive (pipe 39) e gravação em negócio (pedem ok do Pedro); revisão manual que libere conta em tratativa (o caminho é o card ir para "Cliente Recuperado"); inclusão na base dos clientes da Consultoria que não existem no Brain (decisão de negócio pendente).

## Adendo 29/09/2026 · Produtos e Listas em visões separadas, envio com pipe e closer

**Pedido do dono (29/09):** "quando eu clico no aquário do Recon ou da consultoria, ele me manda de volta pra tela da base e só um filtro é aplicado na sessão inferior — daí eu tenho que rolar até lá embaixo pra enxergar (...) preciso que você pense como um usuário precisa navegar de forma confortável em termos de listas, produtos e base". Desenho delegado; este adendo é o contrato.

- **Menu:** Base de clientes · **Produtos** · **Listas** · Validar origem · Contratos e churn · Entenda os números. "Produtos e listas" virou duas visões (URL `view=produtos` e `view=listas`).
- **Produtos (Lista/Relatório):** no topo, um seletor do produto em foco — Consultoria, Finance, Cella (ordem do caixa) e Recon —, com o número de prontas de cada um. É filtro da tabela logo abaixo (N6: não é aba), botões com `aria-pressed`. Escolher um produto mostra a tabela dele **na mesma visão, logo abaixo**, já em "Prontas para enviar": o número do botão é o total da tabela (N2). Recon mostra o painel do Recon no lugar da tabela (`painel=recon`). Sem `produto` na URL, Consultoria. As réguas (perfil aderente, carteira retroativa) ficam num "detalhes" recolhido no fim.
- **Listas (Fila de trabalho):** coluna de listas com filtro por situação (rascunho · validada · no Pipedrive) e busca por nome ou unidade; a lista aberta vai para a URL (`lista=<id>`), então o link abre a mesma lista. "Preparar lista" em Produtos abre o rascunho aqui, no topo. Estado vazio leva a Produtos.
- **Números sem produto** ("Mais de um produto", parte de "Entenda os números") abrem a Base e a página rola até a tabela. Números com produto abrem Produtos.
- **Rolagem:** filtro na mesma visão não mexe mais na rolagem (antes cada filtro voltava ao topo); troca de visão começa do topo.
- **Preparar lista exige produto:** na Base, sem produto no filtro o botão explica em vez de cair em Consultoria em silêncio.
- **Apresentação:** abre `/apresentacao/lista/<id>` numa aba própria (fora do menu, com login e a RLS de quem abre), clara, pronta para imprimir ou salvar PDF; lista com alteração não salva é salva antes ("Salvar e apresentar"). Campos: a lista fechada da spec de 18/09 (nunca CNPJ, contato, id de CRM, motivo interno). Faixa estimada pela DataStone aparece marcada "estimativa, confirmar com o sócio".
- **Envio ao Pipedrive (29/09, "na hora de enviar para o pipe nós precisamos selecionar o pipe: recon ou monetização caixa. E os closer são o Willian Linhares ou o Matheus Carvalho"):** a tela de envio pede **Pipe** (Monetização · Caixa de Oportunidade, pipe 39, com produto Consultoria/Finance/Cella no campo Caixa · Produto; ou Recon, pipe 38, etapa Entrada) e **Closer** (Matheus Carvalho 28381245 ou Willian Linhares 24813890, só os dois). O painel do Recon passa a enviar e a preparar lista. Por baixo: produto `recon` em itens e envios (migration `20260929130000`), regra do Recon no servidor espelhando `ofertaRecon`, e a Edge Function escolhe pipe e etapa pelo produto.

## Adendo 01/10/2026 · Prova de cliente e fornecedor só para admin
Pedido do Pedro (01/10): "edite isso no planning brain e garanta que quem não é admin não tenha acesso a fornecedor", depois do estudo "Quem é cliente na Base?". Estado: **aplicado a pedido do dono**; o pedido vale como "contrato ok" deste adendo. Arquétipo e anatomia não mudam (Lista/Relatório e Ficha).

- **Quem vê fornecedor:** super admin e admin (nível 3) das áreas Clientes ou Monetização. Para os outros, conta de **fornecedor** ou de **empresa do grupo** não existe: o banco não manda (página, manifesto, catálogo, ficha, exportação, listas). "Ver como" mostra o que a unidade vê, sem fornecedor.
- **Filtro** de múltipla escolha "Prova de cliente", na URL (`prova`): Cliente comprovado, Cadastrada no Pipefy sem prova, Só a tag Cliente do Omie, Sem prova de cliente, Fornecedor, Empresa do grupo (e "Prova a calcular" só quando houver conta sem a prova calculada). Contagem ao lado de cada opção, como "Cadastro no Omie · tag". Para quem não é admin, Fornecedor e Empresa do grupo aparecem com zero.
- **Ficha da conta:** painel "Prova de cliente" com o nível e o motivo (que prova tem, ou quem paga a empresa e onde).
- **CSV:** coluna "Prova de cliente" (nível · motivo).
- **Ofertas:** fornecedor, grupo e sem prova ficam fora de todas, com o motivo do banco; o cartão de Consultoria conta as três como "fornecedor" (não como Simples) e o Recon as agrupa em "Fornecedor, empresa do grupo ou sem prova de cliente".
- **Procedência:** conta só do Omie com carimbo "Base antiga" passa a dizer "Só no cadastro do Omie da unidade", não "Cadastro no Pipefy da unidade".
