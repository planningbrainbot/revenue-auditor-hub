# Base de clientes — estudo do fluxo produto → lista → CRM

Data: 17/09/2026. Análise da `origin/main` em `0b29b44`, do print enviado e das decisões de produto já registradas. Método: inspeção do código e avaliação heurística. Não foram feitas entrevistas nem testes de usabilidade com pessoas.

**Recomendação:** uma base, uma ficha por empresa e um fluxo de trabalho comum aos quatro produtos. Produto determina perfil e destino; lista organiza a execução. Recon precisa entrar nesse fluxo completo, incluindo o servidor.

[Protótipo clicável](https://planningbrain.com.br/estudos/base-clientes-listas.html). Todos os exemplos são fictícios. Salvar e enviar são simulações em memória; recarregar a página descarta a demonstração. O arquivo não consulta dados do Brain nem chama o Pipedrive.

## 1. O que está quebrado e por quê

| Achado verificável | Efeito para o hunter | Correção proposta |
| --- | --- | --- |
| `aquario.tsx`: Recon executa somente `setTab("recon")`; os outros cartões alteram `filters.product`, situação e tabela. | O mesmo tipo de cartão promete o mesmo comportamento, mas leva a operações diferentes. | Um seletor de produto controla título, tabela, filtros, seleção e destino. Recon deixa de ser uma aba independente. |
| `recon.tsx`: seleção local e exportação; não recebe callbacks para lista ou envio. | É possível selecionar Recon, mas não continuar a tarefa. | Reutilizar a mesma seleção e o mesmo editor de listas para os quatro produtos. |
| `types.ts`, `functions.ts`, constraint SQL e `send.mjs` aceitam apenas Cella, Consultoria e Finance; envio e leitura do CRM fixam o funil 39. | Habilitar o botão sozinho falharia ou enviaria ao destino errado. | Ampliar produto, persistência, reserva, leitura e escrita com configuração própria do Recon. |
| Produto aparece como cartão, aba especial e filtro. Há filtros na base e na tabela incorporada. | O hunter precisa descobrir qual controle manda; recortes podem se acumular. | Um estado de filtro visível, com URL, chips ativos e uma ação de limpeza previsível. |
| “Lista potencial” é uma consulta; “lista para sócio” é um objeto salvo; envio direto cria outra lista nos bastidores. | Não fica claro o que foi salvo, quem está trabalhando ou onde retomar. | Chamar o recorte de **Oportunidades** e o conjunto salvo de **Lista**. Mostrar a lista criada pelo envio direto. |
| `PortfolioTable.change` limpa a seleção em qualquer mudança de filtro. | Montar uma lista de várias unidades exige refazer trabalho. | Seleção explícita persistente por produto, contador dos itens fora do filtro e revisão nominal antes de enviar. |
| Preparar/enviar usam `disabled` para permissão e seleção, sem explicar a diferença no local. | O usuário vê bloqueio sem saber como avançar. | Estado vazio instrutivo; seleção revela ações; restrições reais têm motivo e próximo passo. |
| “Aderente”, “apta”, “disponível”, “radar” e “retroativa” disputam os mesmos cartões. | Potencial, comprovação e disponibilidade parecem o mesmo número. | Vocabulário comum e estados separados, sem tratar campo ausente como exclusão. |

O comportamento do Recon preservava a instrução anterior de manter a base no Aquário, sem criar negócios no CRM. Esse histórico explica a separação, mas não justifica uma interface que parece oferecer um fluxo que não existe. O pedido atual é estudar sua integração manual; não é uma ordem de disparo de um lote.

O print evidencia contexto visual conflitante entre Recon e “Todos os produtos”. O código confirma caminhos separados, mas não permite afirmar a sequência exata que produziu aquele estado. Não houve reprodução autenticada no navegador nesta sessão.

## 2. Organização da informação

```text
Base de clientes
├── Base             Quem são as empresas e qual a qualidade do cadastro?
├── Oportunidades    Quais empresas trabalhar para este produto?
└── Listas           O que selecionei, apresentei e enviei?
```

Isso reorganiza a navegação, não cria outra base. As visões atuais Empresas, Contatos e Negócios ficam dentro de Base; Validar origem e Contratos da rede continuam acessíveis nesse contexto. A proposta não elimina CS, NPS ou outras telas do módulo. Acompanhar operação continua em Monetização; Recon aponta ao acompanhamento do Conciliador quando disponível.

- **Empresa/conta:** identidade existente no Brain, com vínculos, unidades e procedência. Não fundir CNPJs por nome ou raiz. Contatos e negócios são entidades vinculadas, com contagens próprias.
- **Oportunidade de produto:** par `account_id + product`. Tem perfil e disponibilidade independentes. Uma empresa pode servir a Recon e Consultoria sem ser contada como duas empresas.
- **Lista:** seleção explícita e persistida de oportunidades. Nome, produto, responsável, unidades abrangidas, autor, datas e histórico de envio. Não é uma cópia do cadastro nem uma consulta que altera seus membros silenciosamente.
- **Filtro salvo, se criado futuramente:** consulta dinâmica; não chamar de lista. Novas empresas que passam pelo filtro não entram automaticamente em uma lista já enviada.

**Recomendação para listas novas:** um produto por lista. Facilita apresentação, destino e acompanhamento. Listas antigas com múltiplos produtos permanecem íntegras, agrupadas por produto; não converter ou descartar histórico automaticamente. Uma apresentação de unidade pode reunir várias listas.

## 3. Fluxo de trabalho proposto

1. **Escolher produto.** Quatro opções equivalentes. Abrir Recon, Consultoria, Cella ou Finance ajusta título, regras, contagens e destino no mesmo lugar. Por padrão mostrar disponíveis; se forem zero e houver pendências, oferecer “Ver empresas a qualificar”, com o número explícito. Nunca apresentar zero disponível como inexistência de potencial.
2. **Refinar a carteira.** Busca, unidade e origem visíveis. Contato, faturamento cadastrado, estimativa Driva, regime, segmento, ECD e sobreposição em “Mais filtros”, com indicação de filtros ativos. Contato continua opcional. Limpar filtros preserva o produto escolhido; “Limpar seleção” é outra ação.
3. **Selecionar empresas.** Checkbox da linha seleciona; nome abre ficha lateral. Seleção da página informa seu alcance. Selecionar todos os resultados exige ação explícita com quantidade, inclusive quando há paginação. Trocar filtros não apaga a seleção: informar quantas selecionadas estão fora do recorte. Trocar produto preserva uma seleção distinta, sem converter oportunidades de um produto em outro.
4. **Montar lista ou revisar envio.** Uma barra fixa mostra produto, selecionadas, prontas e pendentes. “Montar lista” abre painel lateral; “Revisar envio” oferece o caminho direto já solicitado pelo usuário, sem exigir apresentação prévia ao sócio.
5. **Salvar/apresentar.** Empresa pendente pode entrar no rascunho, acompanhada do que falta. Lista pode ser apresentada por unidade, com regime, faturamento e segmento antes de contato para Consultoria. Aprovação do sócio é registro opcional, não condição para envio.
6. **Revisar envio.** Mostrar empresas nominalmente, produto canônico, funil, etapa de entrada, responsável e quantidade que será enviada. Listar separadamente os itens que permanecem pendentes ou já estão em trabalho. Envio direto salva a lista para auditoria sem inventar aprovação do sócio.
7. **Acompanhar resultado.** Cada item mostra negócio criado/vinculado ou motivo de falha. Sucesso parcial continua parcial. Timeout incerto demanda conciliação, não repetição cega. Disponibilidade e listas atualizam após confirmação do CRM e pela sincronização.

O protótipo demonstra os passos centrais, incluindo ficha, quatro produtos, filtros, seleção preservada, rascunho com pendências, lista salva e atualização após envio simulado. Não implementa paginação, apresentação imprimível, todos os filtros avançados ou respostas remotas de falha; esses casos estão nos aceites abaixo.

## 4. Números e estados que não podem se confundir

Para cada produto, dentro do escopo e filtros vigentes:

| Estado | Significado | Próximo passo |
| --- | --- | --- |
| Disponível | Perfil comprovado e sem impedimento de disponibilidade para aquele produto. | Montar lista / revisar envio. |
| Em trabalho ou reservada | Oferta já vinculada no CRM ou reservada por outra operação. | Abrir negócio/lista responsável; não criar duplicata. |
| Com pendências | Evidência insuficiente ou conflitante. | Organizar rascunho e resolver campo indicado. |
| Fora do perfil | Evidência conhecida contraria a regra. | Consultar motivo ou trabalhar outro produto. |

Perfil e execução precisam existir como dimensões separadas nos dados. Uma mudança cadastral posterior não pode esconder um negócio já enviado: mostrar o histórico com alerta de perfil alterado. Reservas técnicas em processamento têm indicação própria, sem fingir avanço comercial.

“Perfil comprovado” inclui ofertas disponíveis e ofertas já em trabalho, quando continuam aptas. “No radar” é potencial a qualificar; não significa envio liberado. A soma dos produtos nunca é apresentada como total de empresas. Completude Bruta → CNPJ → contato → ECD permanece uma análise da base, não um gate geral de produto.

## 5. Regras preservadas e destino por produto

| Produto | Regra de perfil vigente | Destino de envio |
| --- | --- | --- |
| Recon | Faturamento estritamente acima de R$ 5 mi; excluir qualquer BPO, inclusive contábil, fiscal, folha e financeiro. Ausência de evidência não prova ausência de BPO. | Conciliador, conforme escolha anterior do usuário; implementação pendente. |
| Consultoria | Base antiga comprovada das unidades, sem fechamento comercial e fora do Simples/MEI. Contato, piso de faturamento, segmento e ECD não são vetos adicionais. | Monetização. |
| Cella | Faturamento a partir de R$ 25 mi e fora do Simples/MEI. | Monetização. |
| Finance | Contrato ganho no comercial identificado no Pipedrive, abaixo de R$ 25 mi e fora do Simples/MEI. | Monetização. |

Continuam valendo as proteções existentes de identidade, origem, acesso por unidade e disponibilidade. Estimativa Driva não substitui faturamento comprovado silenciosamente. Fonte, data de consulta e data de referência precisam ser distinguíveis na ficha. Não prometer ausência de conflito com parceiro concorrente a partir desses filtros.

**Recon não está pronto para envio real.** O produto canônico atual é `Caixa · Produto` (Cella 1128, Consultoria 1129, Finance 1130). Não foi inventado um ID Recon. Antes de implementar o envio, consultar os campos do funil Conciliador, definir sua opção canônica e etapa de entrada; o servidor deve reler e confirmar funil e produto do negócio. A leitura de disponibilidade precisa cobrir o Conciliador, pois o sincronizador atual se concentra no funil 39.

## 6. Execução recomendada, com critérios de aceite

### Etapa A — catálogo e fluxo comum

- Separar catálogo de produtos prospectáveis (quatro) do conjunto do forecast de Monetização (três). Incluir Recon não pode alterar metas, conversões ou mix financeiro automaticamente.
- Definir contrato comum `perfil / motivos / evidências / disponibilidade / destino`, reutilizando as regras atuais. Nada de reimplementar regras em cartões e filtros diferentes.
- Ampliar tipos, schemas de entrada, constraints e funções de lista de forma compatível com os registros existentes. Reutilizar `ops.monetizacao_*` no Brain unificado; não criar outra tabela de empresas.
- Um estado de filtros/seleção compartilhado entre abertura por produto e por unidade. Links diretos e voltar do navegador preservam o recorte.

**Aceite:** os quatro produtos permitem montar e salvar rascunhos; nome do produto coincide em cartão, tabela, lista e revisão; filtros cumulativos são visíveis; listas antigas permanecem consultáveis; usuário sem permissão vê motivo explícito.

### Etapa B — Recon e envio confiável

- Configuração de funil/etapa/opção de produto do Recon verificada no CRM. Leitura, criação, deduplicação e confirmação respeitam essa configuração.
- Reutilizar reservas por conta/produto, nonce e auditoria. Revalidar perfil, disponibilidade e escopo no servidor. Mudança de produto não reaproveita silenciosamente a mesma reserva.
- Ao salvar uma lista, não reservar toda a base indefinidamente. Reserva de envio deve refletir processamento real e ter conciliação segura.
- Uma revisão para lista salva e envio direto. Atualizar contagens e links após confirmação remota.

**Aceite:** confirmação deixa claro quem recebe qual produto e onde; fora de perfil/pendente não vira envio; permissão não é ampliada pelo frontend; dupla tentativa não duplica; falha parcial identifica cada item; timeout não repete POST sem reconciliação. Os testes usam payloads sintéticos e dry-run; não criam negócios de teste em produção.

### Etapa C — apresentação e acompanhamento

- Listas novas agrupadas por produto, unidade e responsável; busca e estados Rascunho, Com pendências, Pronta para revisar, Envio parcial, Enviada e Arquivada.
- Registrar apresentação/validação opcional. Exportação da seleção e da lista distingue escopo; inclui origem e evidências úteis ao sócio.
- Preservar histórico por item e link de negócio. A operação comercial não é apagada ao arquivar a lista.

**Aceite:** sem instrução do moderador, um hunter consegue montar Recon com empresa sem contato, salvar pendências, localizar a lista novamente e explicar exatamente quais itens irão ao CRM. Meta de avaliação proposta: concluir em até dois minutos após encontrar o produto, sem ajuda; medir resultado, não afirmar antecipadamente que foi atingido.

### Validação transversal

Teclado e foco ao abrir/fechar ficha e revisão; rótulos nos checkboxes; estado intermediário do “selecionar página”; mensagens não dependentes de cor; modo estreito sem perder as ações; filtro sem resultado com recuperação; troca de filtro com seleção fora da tela; mesma empresa em dois produtos; conflito cadastral surgindo após salvar; dois usuários enviando simultaneamente; resposta parcial e incerta; atualização assíncrona sem mover a seleção para outra empresa.

## 7. O que esta entrega altera

**Implementado:** título da página, nome do módulo e entradas de navegação passam a “Base de clientes”. URL `/clientes`, chaves de permissão, dados e regras permanecem iguais. O protótipo e este estudo documentam a proposta para a próxima implementação.

**Não implementado nesta entrega:** ampliação de Recon no banco/CRM e substituição do fluxo operacional pela proposta. Nenhum negócio foi enviado e nenhuma lista real foi criada. Publicação e verificações estão em `entrega.md`.

## Referências aplicadas

- [IBM Carbon — Data table](https://carbondesignsystem.com/components/data-table/usage/): seleção e ações em lote próximas da tabela; detalhes podem abrir painel lateral. Aplicação aqui: barra de seleção e ficha separada do checkbox.
- [IBM Carbon — Filtering](https://carbondesignsystem.com/patterns/filtering/): tornar recortes ativos compreensíveis e escolher forma de aplicar filtros conforme o contexto. Aplicação: um conjunto de filtros, contagens consistentes e limpeza explícita.
- [Nielsen Norman Group — Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): apresentar primeiro controles essenciais e revelar os secundários quando necessários. Aplicação: produto, unidade e origem primeiro; filtros adicionais recolhidos.
- [Nielsen Norman Group — Button States](https://www.nngroup.com/articles/button-states-communicate-interaction/): estado e texto do botão devem comunicar o que pode acontecer. Aplicação: explicar falta de seleção, pendência e permissão no lugar da ação.

Essas referências orientam os padrões de interação. A estrutura proposta e as regras são uma síntese específica do código e das instruções deste projeto.
