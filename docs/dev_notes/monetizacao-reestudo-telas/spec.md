# Spec · Monetização em quatro telas: Funil e ciclo, Previsão, e o que sai

**Frente:** PLANNING (interno) · **Dono de produto:** Pedro Luca · **Código:** Pedro Luca (telas) · Victor Eliezek (casca, `areas.ts`, merge e deploy)
**Data:** 28/09/2026 · **Branch:** `docs/monetizacao-reestudo-telas-20260928` (base `origin/main` `4302f48`)
**Estado:** **aprovada** em 28/09 ("contrato ok" das duas telas novas, PROCESSO §4, e respostas P1–P3, P5 e P6 aplicadas em §14). Nada foi implementado. Segue pendente só a P4 (alinhamento com o Matheus), que não bloqueia o início.
**Mockup com dado real:** https://claude.ai/artifact/J56Uuu2cnKQyaKCTT8uw7F (privado; o modelo sem dado e o gerador estão em `mockup/`)
**Medições:** `medicoes.md`, nesta pasta. **Contratos novos:** `docs/design/contratos/monetizacao-funil-ciclo.md` e `docs/design/contratos/monetizacao-previsao.md`.

---

## 1. Contexto

O módulo `/monetizacao` tem nove abas. Três delas (Temporal e previsão, Projetado × realizado, Capacidade e alocação) respondem pedaços da mesma pergunta, que é se o mês fecha. Outras três não têm dado entrando: Follow Day, Pessoas e PDI, Distribuição. O funil por produto e o ciclo de vendas, que são o que o dono quer ler, não existem em tela nenhuma. Os números que existem estão espalhados: o evento "lead trabalhado" aparece em cinco abas, cada uma com um recorte de ator ou período diferente.

A medição de 28/09 dá o tamanho do problema e da oportunidade. O pipe 39 tem 194 negócios, 189 deles criados em setembro. Consultoria aparece com 29 negócios e nenhuma reunião, mas 26 deles são o lote de 15/09 que na prática foi trabalhado como Finance (e um como Cella), com o campo ainda por trocar (§4.2). Finance perdeu 28 negócios por "fora de perfil" direto da Base elegível. Cella fez 3 dos 3 contratos e tem 11 negócios parados em "Proposta enviada" há 7 dias ou mais. Nenhuma tela de hoje mostra essas três coisas.

Quem ganha: o Pedro, que lê o funil por produto sem planilha; o Matheus, que vê onde o pipe dele está parado; e a daily, que ganha uma tela de previsão só.

## 2. A proposta em cinco linhas

1. O menu cai de 9 para 7 itens. Ficam **Operação diária**, **Follow Day** (em stand by), **Abordagens**, **Pessoas e PDI** e **Distribuição** (as duas últimas para uso futuro). Entram **Funil e ciclo** (na URL `?aba=funil`) e **Previsão** (`?aba=previsao`).
2. **Funil e ciclo** junta Funil comercial e o ciclo da Temporal, e mostra os abertos parados pelo tempo na etapa. Os gráficos são: funil por produto com as saídas em cada marco, curvas de tempo até cada marco, envelhecimento dos abertos, motivos de perda e coortes semanais.
3. **Previsão** junta Temporal, Projetado × realizado e Capacidade. Tem meta × projetado × realizado, contratos por mês com a faixa de cenários do modelo novo, desvio por produto, e o plano do mês num Sheet.
4. **Nenhuma aba é apagada.** As três que fundem em Previsão redirecionam, e o destino avisa de onde a pessoa veio (N14). Follow Day, Pessoas e PDI e Distribuição ficam como estão (Pedro, 28/09).
5. A carga do CRM ganha a **v6**. Ela corrige a ordem de duas trocas de etapa no mesmo segundo e grava a hora exata de ganho e perda. O resto do dado de funil e ciclo já está gravado.

---

## 3. Inventário das nove abas

Frescor medido em 28/09/2026 pela Management API (`npknehhyyzelmrbbxvtu`, só leitura) e pelo Pipedrive (GET). Horário de São Paulo. Detalhe e consultas em `medicoes.md`. Código em `b5c44d7..4302f48` (mapa completo por arquivo:linha em `medicoes.md` §4).

**A automação comum.** Quase todo número vem de `ops.monetizacao_deals.payload`, gravado pela Edge Function `monetizacao-crm`:

- Quem dispara é o `pg_cron` `monetizacao-crm-5min` (`*/5`), que chama `ops.monetizacao_cron()`. O agendamento foi criado por `scripts/monetizacao/bootstrap.py`, fora das migrations.
- **Está ativa:** 2.010 execuções nos últimos 7 dias, 0 falhas. A última carga é de 28/09 às 15h20: 194 negócios, `metric_version` 5, sem erro.
- Quando a tabela abaixo diz "carga ativa", é isto. A carga estar viva não garante dado na tela: os campos que ela copia do Pipedrive podem estar vazios.

| Aba (`?aba=`) | Pergunta de hoje | De onde vem cada número | Quem alimenta, e se está vivo (28/09) | Repete conjunto ou número com | Veredito e motivo |
|---|---|---|---|---|---|
| **Operação diária** (`operacao`) | O farmer está no ritmo, e onde a base trava? | Eventos `started/scheduled/meeting/validated/signed` com o Matheus como ator (`model.ts` `operacao()`, `metasOperacao()`); funil por etapa a partir de `moves` e do "hoje" (`funil()`); metas do plano (`monetizacao_planos`) | Carga ativa. Plano: 1 linha, set/26, salva em 15/09 | Funil comercial (mesmos eventos por produto); Projetado × realizado e Capacidade ("Leads trabalhados"); Distribuição | **Manter.** É a tela da daily. Outro chat corrige os defeitos dela. O funil dela conta **movimentos no período**; o de Funil e ciclo conta **coorte**. As duas réguas ficam declaradas (§4.4). |
| **Temporal e previsão** (`temporal`) | Quando as oportunidades abertas devem virar contrato, e quanto valem? | Validadas em aberto pelo dono atual; ciclo `won_on − started_at`; receita (`revenue`); `expected_close`; cenário = validadas com data × `plan.rates` (`model.ts` `temporal()`, `receitaSomada()`) | Carga ativa, mas **das 30 validadas abertas, 0 têm data prevista e 0 têm valor** no Pipedrive. `rates` do plano nulas desde sempre: o cenário sempre diz "Sem hipótese". A tabela semanal, a receita e o cenário nunca mostraram dado | Projetado × realizado (validadas com data no mês); Funil comercial (validadas em aberto); Cockpit do CEO (`receita-prevista-aberta`) | **Fundir em Previsão.** Os dois números vivos vão cada um para uma tela: "validadas em aberto" para Previsão, o ciclo para Funil e ciclo. A tabela por semana de fechamento só volta se o CRM passar a ter data prevista (§14, P4). |
| **Projetado × realizado** (`forecast`) | O mês está acima ou abaixo do que a planilha projetou? | Linhas 25–41 da planilha v10 × eventos do mês com qualquer ator (`forecast.ts` `forecastComparison()`); contas disponíveis da Base; grade do modelo (`forecast-model.tsx`) | `monetizacao_forecasts`: **1 versão** (v10 de 09/09), importada em 15/09. Nenhum processo recorrente grava nessa tabela: `scripts/monetizacao/import_forecast.py` só gera JSON. O realizado vem da carga ativa | Operação e Capacidade (mesmos eventos, outro recorte de ator); Temporal; Capacidade (disponíveis) | **Fundir em Previsão.** O modelo com cenários vem do chat de Forecast (branch `feat/monetizacao-forecast-v12-20260928`) e não é redesenhado aqui (§12). |
| **Capacidade e alocação** (`capacidade`) | A base disponível cobre o que planejamos trabalhar em cada produto neste mês? | `plano.capacity/allocation/rates`; "Leads trabalhados" do mês; Base (`oferta`, `disponibilidade` sobre `monetizacao_contas`) (`model.ts` `capacidade()`) | Plano: **1 linha em toda a história** (set/26, 15/09), com alocação 0/0/0 e hipóteses vazias. **Não existe plano de out/26**: a partir de 01/10 a Operação fica sem meta. Base viva (`monetizacao_contas` com 10.314 linhas atualizadas às 15h20; cron `monetizacao-cobertura-10min` com 989 execuções em 7 dias, 0 falhas) | Projetado × realizado (disponíveis); Distribuição (capacidade); Operação (metas do mesmo plano) | **Fundir em Previsão.** O editor do plano vira um Sheet "Plano do mês", e o resumo de base disponível vai junto dele. |
| **Follow Day** (`follow-day`) | Qual negócio aberto eu destravo hoje? | `next_activity`, `last_activity_date` e datas de evento dos abertos do Matheus (`analysis.tsx` `FollowDay`) | Carga ativa, mas o sinal não separa nada. **92 dos 105 abertos (88%) estão "sem próximo passo", 13 têm atividade futura e 0 têm atividade vencida.** O Matheus registrou 75 atividades em setembro (68 ligações concluídas), mas não agenda a próxima no Pipedrive. A fila é o pipe inteiro. O único corte que separa é "sem movimento há 7+ dias": 46 negócios | Distribuição (as "abertas hoje" do Matheus são o total do Follow Day); Operação ("Hoje" do funil) | **Fica em stand by** (Pedro, 28/09): sem investimento, sem remoção. O dado mostra que o sinal dela não separa negócio nenhum enquanto a próxima atividade não for agendada no Pipedrive. O envelhecimento de Funil e ciclo mostra os parados por outra régua. |
| **Funil comercial** (`funil`) | Quantas reuniões marcadas acontecem, e quantas validadas viram contrato? | Coortes de `scheduled` e `validated` com o Matheus como ator; tabela por produto (`analysis.tsx` `Funnel`) | Carga ativa | Operação (marcadas, realizadas, validadas e ganhos por produto); Temporal (validadas em aberto) | **Vira Funil e ciclo, na mesma URL.** As duas coortes de hoje ficam contidas no funil de marcos. |
| **Pessoas e PDI** (`pessoas`) | Como o hunter está nos cinco critérios, e qual é o próximo passo de desenvolvimento dele? | `monetizacao_registros` com `kind='pdi'` | Escrita manual. **0 PDI gravado desde a criação** (15/09) | `/gente?tela=pdi`, Growth `/pdi` (PRODUCT 5.7) | **Fica** (Pedro, 28/09: "vamos usar em algum momento"). Sem mudança nesta spec. |
| **Abordagens** (`roteiros`) | O que eu digo para este produto e este segmento? | `monetizacao_registros` com `kind='roteiro'` | Escrita manual. **4 registros, todos do Matheus em 23/09** entre 11h29 e 11h44: Finance e Cella aprovadas, 1 rascunho, 1 arquivada | Growth `/roteiros` (outro público) | **Manter.** É a única aba, fora a Operação, que o operador usou. |
| **Distribuição** (`distribuicao`) | A carga está bem dividida entre os responsáveis, ou alguém está sem base? | Eventos por dono; `plano.capacity` por dono; decisões em `monetizacao_registros` com `kind='distribuicao'` | Escrita manual. **0 decisões gravadas.** Um farmer só desde 24/09 (DECISIONS). O Matheus é dono de 189 dos 194 negócios. A lista de donos inclui quem não tem nenhum aberto (`analysis.tsx:1987`), o que contradiz a descrição da tela | Follow Day, Capacidade | **Fica** (Pedro, 28/09). Sem mudança nesta spec; o defeito da lista de donos fica registrado. |

**O que o inventário não mede:** uso. `ops.acessos_log` tem 77 linhas, todas de ação administrativa, e nenhum registro de página vista (PRODUCT 5.15). Os cortes acima se apoiam no dado que entra em cada tela, não em quem abre a tela. O código fica no histórico do Git: desfazer um corte é um `git revert`.

---

## 4. Dados para funil e ciclo

### 4.1 O que já dá para calcular, e com que campo

Unidade: **negócio** do pipe 39. Fonte: `ops.monetizacao_deals.payload` (carga v5). Medido em 28/09 sobre os 193 negócios criados de 30/06 a 28/09.

| Pergunta | Dá? | Campo | Medido em 28/09 |
|---|---|---|---|
| Tempo em cada etapa, por produto | **Sim** | `moves[]`: entrada em cada etapa, com hora e ator. A saída é a próxima entrada; na última etapa, o ganho, a perda ou agora | 614 de 620 passagens batem com o `stay_in_pipeline_stages` do Pipedrive (diferença < 1 dia). As 6 restantes são 3 negócios (§4.3) |
| Ciclo criação → ganho | **Sim**, com amostra pequena | `created_at`, `won_on` | 3 ganhos, todos Cella: mediana de **21 dias** |
| Reunião → ganho | **Sim**, com amostra pequena | `events.meeting[0]`, `won_on` | 3 ganhos: mediana de **15 dias** |
| Tempo até cada marco, contando também os abertos | **Sim** | eventos + `status` + idade | Cella: 17% com reunião em 7 dias, 34% em 14 e 46% em 27. Finance: 15% em 17 dias. Consultoria: 0% (curva de incidência acumulada, §6.1) |
| Conversão etapa a etapa | **Sim** | `moves` (por etapa) e eventos (por marco) | Geral: 193 criados → 142 trabalhados → 46 agendados → 38 com reunião → 36 validados → 3 ganhos |
| Perdidos por etapa | **Sim** | `stage_id` do negócio perdido: o Pipedrive preserva a etapa em que ele foi perdido | Finance perdeu 28 negócios na Base elegível; Cella perdeu 13 na Abordagem |
| Motivo de perda | **Sim**, com texto livre | `lost_reason` | 85 perdas com 25 textos distintos. Os 5 motivos da lista do Pipedrive cobrem 64. Os outros 21 são texto livre, e 14 deles são **remanejamento**, não perda comercial (duplicado, "feito em outro card", troca de produto) |
| Tempo de trabalho entre marcos | **Sim** | datas de evento | Criação → trabalhado: mediana de 5 dias. Trabalhado → agendada: 0 dia. Agendada → realizada: 2,5 dias. Realizada → validada: 0 dia |

**Consequência de desenho:** com 3 ganhos, box plot ou violino do ciclo não diz nada. A tela usa curvas de incidência acumulada, que aproveitam os 105 abertos como observação parcial, e mostra a mediana de ciclo só como `KpiCard` em estado `parcial` enquanto houver menos de 5 ganhos.

### 4.2 Fonte de verdade do produto: o campo, não o título

**Regra: o produto é o campo "Caixa · Produto"** (`0646513e…`: 1128 Cella, 1129 Consultoria, 1130 Finance), como já decidido em DECISIONS 15/09, item 5 ("Não inferir pelo título"). A medição de 28/09 confirma:

- Nos 194 negócios, campo e título concordam em 127. Outros 52 têm o produto só no campo, 10 não têm produto em lugar nenhum, e em 2 o nome da empresa contém "Consultoria" mas o sufixo confere com o campo.
- **3 divergem de verdade:** 96070 "Hospitel · CELLA", 96094 "SAM MEDIC · FINANCE" e 96110 "RV Industria · FINANCE", todos com o campo em Consultoria. Os três vieram do envio da Base de 15/09 às 13h21, e `ops.monetizacao_envios.product` diz **consultoria** nos três. O histórico do Pipedrive não mostra mudança do campo nem do título depois da criação.
- **O que o dono esclareceu em 28/09:** o lote de Consultoria de 15/09 (26 dos 29 negócios de Consultoria; os outros 3 vieram em 28/09) **não foi trabalhado como Consultoria**. Foi trabalhado quase todo como Finance, e um como Cella (Hospitel). Nos 3 divergentes, o título mostra o produto real, e **o campo é que está errado**. O Matheus vai trocar o campo no Pipedrive.
- **A regra não muda:** a tela lê o campo. Quando o campo for trocado, o `update_time` do negócio muda e a carga relê o negócio em até 5 minutos. O negócio passa para o painel do produto certo em todo o histórico, e nada precisa mudar no código.
- **Até a troca, o funil de Consultoria não mede Consultoria.** Os "29 negócios e 0 reuniões" são o lote de Finance mal rotulado, e Finance aparece menor do que é. Não tire conclusão de Consultoria antes da troca. O mockup de 28/09 mostra o dado antes da troca.
- A tela não "corrige" nada. A lista de qualidade da moldura ("negócios sem produto · sem organização · sem histórico lido", `dashboard.tsx:461`) ganha uma linha: "título indica outro produto: N". Ela abre a lista para quem for acertar o campo no Pipedrive. Essa linha só pega os casos em que o título denuncia a troca; o resto do lote de 15/09 depende do Matheus.

### 4.3 O que a carga precisa passar a gravar (v6)

A carga já grava quase tudo. A v6 muda três coisas. Todas ficam na Edge Function `monetizacao-crm` (`crm.mjs` `summarize`) e sobem `metric_version` para 6. A mudança de versão força a releitura de todos os negócios, que a carga já faz sozinha (`index.ts`, filtro `changed`).

1. **Defeito: trocas de etapa no mesmo segundo saem invertidas.** `crm.mjs` ordena as mudanças por `log_time` com `localeCompare`. O `/flow` do Pipedrive devolve do mais novo para o mais antigo, e a ordenação estável preserva essa ordem nos empates. No 95211, as trocas 274→275 e 275→276, ambas às 12h02min06s de 14/09, ficaram na ordem errada. Resultado: a carga calculou a etapa inicial como 275 em vez de 274, marcou "trabalhado" em 11/09 em vez de 14/09 e gravou 275 como última etapa, quando a etapa real é 276. Acontece também no 95196. **Correção:** inverter a lista da API antes de ordenar (ou encadear `old_value → new_value` nos empates), com teste sobre esse caso.
2. **Gravar `won_at` e `lost_at` com hora** (hoje só a data em `won_on` e `lost_on`). É o fim exato da última passagem de etapa. O dado já vem no objeto do negócio (`won_time`, `lost_time`); falta copiar.
3. **Nada mais.** O tempo em etapa é calculado no `model.ts` a partir de `moves`, numa função só, usada pela tela e pelo teste. Não se grava cópia. O `stay_in_pipeline_stages` do Pipedrive não entra na carga: exigiria um GET por negócio a cada 5 minutos, e ele fica só como conferência em script (`medicoes.md` §2.3).

**Negócio que sai do pipe 39.** A carga só lê o que está no pipe 39 agora. Um negócio movido para outro pipe some da coorte sem deixar rastro. Isso não aconteceu até hoje: os 66 negócios enviados pela Base estão todos na carga. Fica como risco, com a consulta de detecção em `medicoes.md` §2.4, e não como mudança nesta spec.

### 4.4 Regras de contagem das telas novas (N11)

| Regra | Definição | Por quê |
|---|---|---|
| **Coorte** (Funil e ciclo) | Negócios criados no período do filtro. O período escolhe quem entra; os marcos contam até hoje | Conversão e ciclo só fazem sentido acompanhando o mesmo grupo. A régua é outra da Operação, que conta **movimentos no período**, e o rótulo diz qual régua está em uso ("Criados de…" × "Movimentos de…") |
| **Chegou ao marco** | O negócio tem o marco ou qualquer marco posterior | Sem isso o funil não fecha: 7 negócios foram a Negociação sem reunião registrada. A tela mostra quantos "pularam o registro" |
| **Marcos** | Criado · Trabalhado · Reunião agendada · Reunião realizada · Oportunidade validada · Ganho (os eventos que a carga já grava) | São os mesmos nomes da Operação e do plano. Não se cria evento novo |
| **Stand by** | Conta como reunião realizada (DECISIONS 28/09) e como validada | Mesma regra da carga v5 |
| **Remanejado ou duplicado** | Perda cujo motivo é duplicado, "feito em outro card", troca de produto ou "volta à fila". Aparece em linha própria nos motivos e **sai da taxa de perda** | Não é perda comercial. Hoje são 14 de 85. **Decidido pelo Pedro em 28/09** (P5) |
| **Sem produto** | Entra em "Todos" e no painel Geral. Não tem painel próprio | São 10 negócios, 9 perdidos. Não há produto para comparar |
| **Fora da coorte** | O TECH MED (78988), ganho em abril noutro pipe e trazido já ganho, fica fora | DECISIONS 24/09 |
| **Produto** | Campo "Caixa · Produto" (§4.2) | DECISIONS 15/09 |
| **Previsão: realizado** | Movimentos do mês, com **qualquer ator** e todos os donos | É a régua de hoje em Projetado × realizado, porque o projetado é da frente inteira |

---

## 5. Nova arquitetura do módulo

Menu da área Monetização (proposta para o `areas.ts`, que é do Eliezek):

```
Oportunidades
  Operação diária      /monetizacao                   O farmer está no ritmo, e onde a base trava?                        (mantida)
  Funil e ciclo        /monetizacao?aba=funil         Onde cada produto perde negócios, e quanto tempo leva para fechar?  (nova, no lugar de Funil comercial)
  Previsão             /monetizacao?aba=previsao      O mês vai bater a meta, e quanto o pipe sustenta nos próximos meses? (nova)
  Follow Day           /monetizacao?aba=follow-day    Qual negócio aberto eu destravo hoje?                               (em stand by, sem mudança)
Desenvolvimento comercial
  Abordagens           /monetizacao?aba=roteiros      O que eu digo para este produto e este segmento?                    (mantida)
  Pessoas e PDI        /monetizacao?aba=pessoas       (sem mudança; uso futuro)
  Distribuição         /monetizacao?aba=distribuicao  (sem mudança; uso futuro)
```

Nove itens viram sete: Temporal e previsão, Projetado × realizado e Capacidade e alocação fundem em Previsão, e Funil comercial vira Funil e ciclo.

| Tela | Arquétipo | Absorve | Não repete |
|---|---|---|---|
| **Operação diária** | Fila de trabalho (faixa de ritmo) + funil do dia (lacuna já registrada no contrato dela) | — | Ganha um link "Ver por produto e ciclo →" no funil, que abre Funil e ciclo com o mesmo produto |
| **Funil e ciclo** | Lista/Relatório, variante **relatório analítico** (lacuna: o arquétipo prevê um gráfico, esta tela tem cinco; proposta de regra no contrato) | Funil comercial; ciclo mediano da Temporal; perdidos por etapa | Não mostra meta nem ritmo diário (é da Operação) nem projetado (é da Previsão) |
| **Previsão** | Visão geral, com o plano do mês num Sheet (Configuração, sem trocar de rota) | Temporal; Projetado × realizado; Capacidade | Não mostra funil nem ciclo |
| **Abordagens** | Lista/Relatório (biblioteca) | — | — |

**O que acontece com as outras.**

- **Operação:** fica como está nesta spec. A única mudança é o link para Funil e ciclo. As metas dela passam a vir do plano salvo na Previsão; a tabela é a mesma, `monetizacao_planos`.
- **Follow Day:** fica em stand by (Pedro, 28/09), sem mudança e sem investimento. O envelhecimento de Funil e ciclo mostra os parados por outra régua (dias na etapa), e os dois convivem.
- **Pessoas e PDI e Distribuição:** ficam (Pedro, 28/09: "vamos usar em algum momento"), sem mudança nesta spec. A PRODUCT 5.7 (PDI em três casas) continua aberta.
- **Abordagens:** fica, sem mudança.

---

## 6. Gráficos

Todos com a paleta do DS v2 e a regra de identidade: **a cor segue o produto**. As cores são Cella `--chart-1` (verde), Consultoria `--chart-2` (ciano), Finance `--chart-3` (roxo) e Sem produto `--chart-6` (neutro), fixadas num mapa `COR_PRODUTO` em `src/lib/planning/grafico.ts`. Nenhum filtro repinta produto. A validação com o script da skill `dataviz` foi feita em 28/09:

- **Tema claro:** passa nas cinco checagens, inclusive todos os pares (pior ΔE sob daltonismo 13,9; visão normal 18,5).
- **Tema escuro:** passa em daltonismo e contraste, mas o verde e o ciano da marca ficam acima da faixa de luminosidade (L 0,80 e 0,78; o limite é 0,67). É achado do DS e vai para o Mika. Não bloqueia esta spec.

Regras gerais, que valem para todo gráfico abaixo (DESIGN §5 e skill `dataviz`):

- um eixo Y;
- no máximo 3 séries empilhadas;
- marcas finas, barras ≤ 24 px com ponta arredondada de 4 px e 2 px de respiro entre segmentos;
- hover com tooltip e foco de teclado com o mesmo conteúdo;
- legenda sempre que houver 2 ou mais séries;
- tabela de apoio disponível;
- **todo número, barra, ponto e célula abre o `DealDetails`** com exatamente os negócios que o compõem, e o total bate (N2).

### 6.1 Funil e ciclo

| # | Seção (pergunta) | Forma | Dados | Interação e drill-down |
|---|---|---|---|---|
| K | Quatro `KpiCard` | Criados na coorte · Chegaram à reunião realizada (% e n de N) · Reunião realizada → ganho · Da criação ao ganho (mediana; `parcial` com menos de 5 ganhos) | coorte do filtro | cada card abre a lista do conjunto |
| 1 | **Até onde cada produto chega, e onde os negócios saem?** | Pequenos múltiplos: Geral + um painel por produto (só o do produto, quando há filtro). Uma linha por marco, com barra horizontal empilhada em três partes: **avançou** (cor cheia do produto), **ainda aberto neste marco** (tom claro) e **perdido neste marco** (cinza claro). À direita, o número que chegou e a conversão sobre o marco anterior. A escala de cada painel são os criados do produto | `funilMarcos(coorte)`: por marco, quem chegou, avançou, parou aberto ou foi perdido; e quem "pulou o registro" | segmento abre a lista do segmento; o número abre quem chegou. O tooltip mostra os que pularam o registro |
| 2 | **Em quanto tempo o negócio chega a cada marco?** | Três pequenos múltiplos (até a reunião realizada, até a validação, até o ganho). Cada um tem uma linha em degrau por produto: a % da coorte que alcançou o marco N dias após a criação (incidência acumulada, com a perda como risco concorrente). A linha para quando restam menos de 5 negócios em observação. Eixo de 0 a 60%, comum aos três | `curvaMarco(coorte, marco)` | cruz vertical com tooltip de todas as séries naquele dia; o clique abre quem alcançou o marco |
| 3 | **Onde os negócios abertos estão parados, e há quanto tempo?** | Faixa de pontos por etapa (8 linhas). Cada ponto é um negócio aberto, posto pelos dias desde a entrada na etapa atual e colorido pelo produto. Atrás, uma faixa cinza com o miolo (p25–p75) e o traço da mediana de quem já passou pela etapa. Linha tracejada neutra em 7 dias, rotulada "régua: 7 dias na etapa". À direita: abertos na etapa e "N há 7+ d" | `permanencias(coorte)` a partir de `moves` | o ponto abre o negócio (e ele abre o Pipedrive); "N há 7+ d" abre os parados da etapa; a ação da seção abre todos os parados. Não substitui o Follow Day, que fica em stand by: a régua aqui é o tempo na etapa, e a do Follow Day é a próxima atividade |
| 4 | **Por que perdemos, em cada produto?** | Matriz de barras: linhas = grupo de motivo, colunas = produto, uma barra por célula na cor do produto, com escala comum. "Remanejado ou duplicado" fica separado no fim, com a nota "não é perda comercial" | `grupoMotivo(lost_reason)` (§6.5) × produto | a célula abre os perdidos; o tooltip mostra em que etapa eles saíram; a lista mostra o texto original do motivo |
| 5 | **As coortes mais novas avançam mais que as antigas?** | Mapa de calor em tabela: linhas = semana de criação, colunas = marco, célula = % da semana que chegou ao marco, com "n de N". Rampa sequencial verde de 5 passos. Semana com menos de 14 dias leva a marca "amadurecendo" | `coortesSemanais(coorte)` | a célula abre quem chegou |
| — | **Como contamos** | `details` recolhido com as regras do §4.4 | — | — |

### 6.2 Previsão

| # | Bloco | Forma | Dados | Interação e drill-down |
|---|---|---|---|---|
| K | Quatro `KpiCard` com `meta` | Contratos ganhos (meta do plano; nota com o esperado até hoje pelos dias úteis) · Oportunidades validadas (projetado do cenário base) · Reuniões realizadas (projetado) · Validadas em aberto (estado "Sem data: N" enquanto o CRM não tiver data prevista) | realizado do mês (§4.4); plano; forecast | cada card abre a lista |
| A | **O que pede atenção** (até 3 itens, com botão de destino) | Linhas em caixa com borda, uma por item (feedback de 23/09 do Cockpit) | Regras em ordem de prioridade: (a) validadas abertas sem data prevista ou valor; (b) plano do próximo mês não salvo a partir do dia 20, ou alocação zerada no mês corrente; (c) projetado com mais de 30 dias ou sem o mês corrente | (a) abre a lista; (b) abre o Sheet do plano; (c) abre o modelo |
| 1 | **Quantos contratos por mês, contra o projetado?** | Colunas de contratos ganhos por mês, empilhadas por produto. Linha do projetado (cenário base) e **faixa pessimista–otimista** do modelo novo. Meta do plano como tracejado neutro rotulado "Meta", só nos meses com plano. O mês corrente diz "até dd/mm" | forecast (cenários); eventos `signed`; plano | coluna abre os ganhos do mês; ponto do projetado mostra a premissa no tooltip |
| 2 | **Onde o realizado descola do projetado, por produto?** | Halteres em 4 pequenos múltiplos (leads trabalhados, reuniões realizadas, validadas, contratos). Cada linha é um produto mais o Total. Círculo vazado = projetado, ponto cheio = realizado, ligados por um traço. À direita, "real de projetado" e a %. Escala própria por painel, porque as grandezas são de ordens diferentes | forecast por produto e marco; eventos do mês | o ponto abre os negócios do realizado |
| S | **Plano do mês** (Sheet) | Formulário do editor atual de Capacidade, com o resumo "Perfil aderente · Disponível no mês · Alocação" por produto no topo. Mostra a confirmação de efeito quando muda meta ou alocação | `monetizacao_planos`; Base | Salvar (RPC `monetizacao_save_plan`, sem mudança); o aderente e o disponível abrem `/clientes?view=produtos&produto=` |
| M | Modelo completo | A grade atual (`forecast-model.tsx`) num `Dialog` "Ver o modelo" | forecast | exportar CSV (já existe) |

A medição de 28/09 que o mockup mostra (set/26 até 28/09 contra a v10):

| Marco | Cella | Consultoria | Finance | Total |
|---|---|---|---|---|
| Leads trabalhados | 60 de 9 projetados | 19 de 66 | 63 de 45 | 142 de 120 |
| Reuniões realizadas | 22 | 0 | 9 | 31 de 48,6 |
| Oportunidades validadas | 25 | 0 | 11 | 36 de 31,2 |
| Contratos ganhos | 3 de 1 | 0 de 4 | 0 de 3 | 3 de 8 |

O mix saiu invertido: a v10 apostava em Consultoria, e quem entregou foi a Cella.

### 6.3 Ideias avaliadas e descartadas

| Ideia | Decisão | Motivo |
|---|---|---|
| Sankey por produto | Não | São 3 produtos × 6 marcos × 3 saídas: sobreposição ilegível e mais de 3 séries por nó. O funil empilhado de 6.1 mostra as mesmas saídas com uma escala só |
| Box plot ou violino de ciclo | Não, por enquanto | 3 ganhos. Volta quando houver 20 ganhos por produto; a curva de 6.1 já responde com os abertos |
| Cumulative flow por etapa | Não, por enquanto | O pipe tem 32 dias. Com 8 etapas, seriam 8 séries empilhadas (o DS limita a 3), e juntando em 3 fases o gráfico repete o funil e o envelhecimento. Volta com 3 meses de histórico |
| Envelhecimento (aging) | **Sim** (6.1 #3) | Substitui o Follow Day com um sinal que separa os negócios |
| Heatmap de coortes | **Sim** (6.1 #5) | Única forma de comparar semanas com maturidade diferente sem misturar |
| Leque de previsão | **Sim** (6.2 #1) | A faixa vem do modelo novo; sem ela, o gráfico mostra só o projetado e diz que os cenários não foram importados |
| Ganho × perdido por produto e motivo | **Sim**, como matriz (6.1 #4) | Empilhar motivo × produto passaria de 3 séries; a matriz lê por linha e por coluna |

### 6.4 Biblioteca e componentes

- **recharts 2.15** (já em `package.json`) para as curvas em degrau (`Line type="stepAfter"`), o gráfico de contratos por mês (`ComposedChart` com `Bar` empilhada, `Line`, `ReferenceLine` e `ReferenceArea` para a faixa) e o funil empilhado (`BarChart layout="vertical"`, `stackId`). Sempre com `eixoProps`, `gradeProps`, `tooltipProps`, `legendaProps` e `linhaMetaProps` de `src/lib/planning/grafico.ts`.
- **SVG próprio, como componentes novos em `src/components/planning/`** (com revisão, DESIGN §1.6):
  - `FaixaPontos`: pontos por categoria, com faixa p25–p75 e régua;
  - `Halteres`;
  - `MapaCalor`: tabela com rampa sequencial e célula clicável;
  - `MatrizBarras`.

  Os quatro entram na vitrine (`/vitrine#graficos`) com dado sintético. A Operação já desenha o funil dela em SVG próprio (`operacao.tsx:210-406`); os novos seguem o mesmo padrão.
- **Tokens novos** em `src/styles.css`, nos dois temas: `--chart-seq-1..5` (rampa sequencial verde do mapa de calor) e `--chart-perdido` (cinza claro do segmento "perdido"). Nenhum hex em `.tsx` (V2).
- `COR_PRODUTO` e `rotuloProduto` num lugar só, usados pelas duas telas e pelo `DealDetails`.

### 6.5 Grupos de motivo de perda

`grupoMotivo(texto)` em `src/lib/monetizacao/model.ts`, com teste. A primeira regra que casar vence:

| Grupo | Casa com (sem distinguir maiúsculas) | Hoje |
|---|---|---|
| Remanejado ou duplicado | "duplicad", "outro card", "em prospecção", "pela frente", "já está com contrato", "feito abordagem/prospecção", "volta à fila", "rota consultoria", "não dá para decidir", "prospectado pelo" | 14 |
| Fora de perfil | "fora de perfil", "fora do perfil", "não tem perfil", "sem oportunidades", "não tem cnpj", "baixa em cnpj", "simples" | 36 |
| Sem interesse | "sem interesse", "sem contrato" | 26 |
| Contato esgotado | "tentativa" | 6 |
| Concorrente ou parceiro | "concorrente", "parceiro" | 2 |
| Sem orçamento | "budget" | 1 |
| Outros | o resto | 0 |
| Sem motivo | vazio | 0 |

A lista fica no código porque é pequena e tem teste. Se o Pipedrive passar a aceitar só motivos da lista (§14, P5), a tabela encolhe para os 5 motivos de lá.

---

## 7. Páginas tocadas

| Página | Componentes principais |
|---|---|
| `/monetizacao?aba=funil` (**Funil e ciclo**, substitui Funil comercial) | `PageHeader`; `BarraFiltros` (período, produto); `KpiGrade` com 4 `KpiCard`; 5 `Secao` com `FunilMarcos` (recharts), `CurvaMarco` (recharts), `FaixaPontos`, `MatrizBarras`, `MapaCalor`; `details` "Como contamos"; `DealDetails` |
| `/monetizacao?aba=previsao` (**Previsão**, nova) | `PageHeader`; filtro de mês; 4 `KpiCard` com `meta`; caixa "O que pede atenção"; 2 `Secao` (contratos por mês em recharts, `Halteres`); `Sheet` "Plano do mês" (editor que hoje está em Capacidade); `Dialog` "Ver o modelo" (`forecast-model.tsx`); `DealDetails` |
| Moldura de `/monetizacao` | `busca.ts`: abas novas, mapa dos links antigos e o parâmetro `origem` do aviso; `dashboard.tsx`: títulos, perguntas, barra de filtros por aba, aviso N14; lista de qualidade com "título indica outro produto" |
| Operação diária | só o link "Ver por produto e ciclo →" no funil |
| Casca | `src/lib/areas.ts`: menu de 4 itens (Eliezek) |
| Cockpit do CEO | links que apontam para `?aba=temporal` (`indicadores.ts:608-614`) e `?aba=capacidade` (`:897-921`) passam para `?aba=previsao` e `?aba=previsao&plano=1` |
| Vitrine | os 4 componentes novos em `#graficos`; o exemplo de Fila (`vitrine.tsx:1418+`) deixa de citar o Follow Day |

## 8. Comportamentos do usuário

1. **Filtrar Funil e ciclo por período e produto**, com `de`, `ate` e `produto` na URL. O período padrão são os últimos 90 dias, com presets de 30, 90 e 180 dias e mês.
2. **Ler o funil por produto com as saídas em cada marco** e abrir a lista de qualquer segmento.
3. **Ler o tempo até cada marco por produto** (curvas) e abrir quem alcançou o marco.
4. **Ver os abertos parados por etapa e há quanto tempo**, e abrir os parados há 7+ dias (o que o Follow Day fazia).
5. **Ver os motivos de perda por produto**, separados os remanejamentos, e abrir os perdidos de cada célula.
6. **Comparar coortes semanais** e abrir quem chegou a cada marco.
7. **Ver na Previsão se o mês bate a meta**: KPIs com meta ou projetado ao lado e "O que pede atenção".
8. **Ver contratos por mês contra o projetado e a faixa de cenários**, e abrir os ganhos do mês.
9. **Ver o desvio por produto e por marco** (halteres) e abrir o realizado.
10. **Editar e salvar o plano do mês num Sheet**, sem sair da Previsão, com confirmação de efeito.
11. **Abrir um link antigo** (`?aba=temporal`, `forecast`, `capacidade`) e cair na Previsão com o aviso de onde veio (N14).
12. **Ver no Pipedrive** qualquer negócio de qualquer lista (já existe no `DealDetails`).

## 9. Mudanças de schema e carga

| # | Mudança | Onde | Observação |
|---|---|---|---|
| S1 | **Carga v6** (§4.3): desempate de trocas de etapa no mesmo segundo; `won_at` e `lost_at` com hora; `metric_version` 6 | `supabase/functions/monetizacao-crm/crm.mjs`, `index.ts` (condição de releitura) | Deploy da Edge Function. Nenhuma tabela nova: o payload é jsonb |
| S2 | **Tipos** de `Negocio` com `won_at` e `lost_at` opcionais | `src/lib/monetizacao/types.ts` | A carga v5 continua lida enquanto a v6 não roda |
| S3 | **Forecast com cenários** em `ops.monetizacao_forecasts` | chat de Forecast | **Dependência, não trabalho desta spec.** O formato que a Previsão lê está em §12 |

Nenhuma tabela é apagada. `ops.monetizacao_planos`, `ops.monetizacao_forecasts` e `ops.monetizacao_registros` continuam em uso.

## 10. O que é apagado (só o que fundiu)

| Tipo | O quê | Onde |
|---|---|---|
| Aba (valor de `?aba=`) | `temporal`, `forecast`, `capacidade` viram redirect (§11). `follow-day`, `pessoas` e `distribuicao` ficam | `busca.ts:11-21` (`ABAS`), `:73-89` |
| Componente | `Temporal` (`analysis.tsx:178-462`) e `Funnel` (`:1195-1375`). `FollowDay`, `People` e `Distribution` ficam | `src/components/monetizacao/analysis.tsx` |
| Componente que muda de lugar | `Capacity` (`:513-937`): o editor vira o Sheet do plano; `Forecast` (`forecast.tsx`): KPIs e tabelas saem, o que servir vai para a Previsão; `ForecastModel` vira `Dialog` | idem, `forecast.tsx`, `forecast-model.tsx` |
| Função de modelo | `temporal()` (o ciclo vai para as funções novas). `distancia()` fica: o Follow Day usa | `model.ts:295-323` |
| Menu | Três itens saem (Temporal, Projetado × realizado, Capacidade); Funil comercial vira Funil e ciclo; Previsão entra | `src/lib/areas.ts:459-471` |
| Contrato de tela | `monetizacao-{temporal,forecast,capacidade}.md` e `monetizacao-funil.md` vão para `docs/design/contratos/aposentados/` com a data e o destino | `docs/design/contratos/` |
| Teste | casos de `temporal` (`tests/monetizacao.test.mjs:286-291`) e os de `capacidade`, `forecastComparison` que deixarem de valer | `tests/` |
| Tabela, view, edge function | **nenhuma** nesta spec. `fila_cella_*` (0 linhas) seguem fora, por DECISIONS 24/09 | — |

## 11. Plano de migração (nenhum link quebra)

**Mecanismo:**

- `validarBuscaMonetizacao` (`busca.ts`) mapeia a aba antiga para a nova e acrescenta `origem=<aba antiga>`.
- O `dashboard.tsx` mostra no topo um aviso (`role="status"`) com o texto da tabela abaixo e o botão "Entendi", que tira `origem` da URL.
- O mapa fica para sempre: custa três linhas e protege favoritos e mensagens antigas.

| Link antigo | Destino | Aviso no destino |
|---|---|---|
| `/monetizacao` ou `?aba=operacao` | igual | — |
| `?aba=funil` (+ `de`, `ate`, `produto`) | Funil e ciclo, na mesma URL | — (a tela nova ocupa o mesmo endereço) |
| `?aba=follow-day`, `?aba=pessoas`, `?aba=distribuicao` | iguais (as abas ficam) | — |
| `?aba=temporal` | `?aba=previsao` | "Temporal e previsão virou Previsão. O ciclo de vendas está em Funil e ciclo." |
| `?aba=forecast` (+ `mes`) | `?aba=previsao` (+ `mes`) | "Projetado × realizado virou Previsão." |
| `?aba=capacidade` | `?aba=previsao&plano=1` (abre o Sheet) | "Capacidade e alocação virou o plano do mês, dentro de Previsão." |
| `?aba=roteiros` | igual | — |

**Ordem de entrega** (cada passo publica sozinho e se desfaz com `git revert`):

1. **Carga v6** (S1, S2). É independente das telas; a Operação passa a contar certo os 2 negócios do desempate.
2. **Componentes de gráfico no DS** (`FaixaPontos`, `Halteres`, `MapaCalor`, `MatrizBarras`, tokens, `COR_PRODUTO`), com vitrine.
3. **Funil e ciclo** em `?aba=funil`. Entra no lugar do Funil comercial, sem mudar o menu.
4. **Previsão** em `?aba=previsao`. Depende do chat de Forecast ter publicado a v12 com cenários. Sem ela, a tela sobe com a v10 e o estado "cenários não importados".
5. **Redirects, avisos e menu** (`busca.ts`, `dashboard.tsx`, `areas.ts` pelo Eliezek), mais os links do Cockpit. Só aqui as três abas que fundiram somem do menu. A `/fila-cella` continua mandando para o Follow Day.
6. **Remoção do código que fundiu** (Temporal, Funil comercial, partes de Projetado × realizado e Capacidade) e arquivamento dos quatro contratos.

Conferência de cada passo: build, `npm run test:monetizacao` (ou o nome que o planner achar), `npm run design:lint:changed` e captura das duas telas nos dois temas. Os números são recontados de forma independente contra a Management API (definição de pronto, `docs/design/README.md`).

## 12. Coordenação com os outros chats

- **Operação (`fix/monetizacao-standby-reuniao-20260928`, worktree `planning-brain-monetizacao-operacao`).** O commit "Stand by conta como reunião" (`4302f48`) já está na `main`, e esta spec parte dele. Esta spec não toca `operacao.tsx` nem as funções da Operação, fora o link do passo 5. O desempate da carga v6 muda a contagem da Operação em até 2 negócios; convém avisar o chat da Operação antes do deploy.
- **Forecast (`feat/monetizacao-forecast-v12-20260928`, worktree `planning-brain-forecast-v12-20260928`, sem commit em 28/09).** O modelo é dele, e esta spec não redesenha nada do modelo. A Previsão só precisa ler de `ops.monetizacao_forecasts` o formato abaixo. Se o chat de Forecast escolher outro, a Previsão ganha um adaptador e o contrato continua valendo.

| Campo | Formato | Uso na Previsão |
|---|---|---|
| `version`, `source_date`, `drive_url`, `imported_at` | texto, data, link, timestamp | rótulo "Projetado {versão} de {data}" e procedência; regra (c) de "O que pede atenção" |
| `months[]` | `aaaa-mm` | eixo de contratos por mês |
| `cenarios[]` | ids e rótulos (ex.: pessimista, base, otimista) | faixa (mín–máx) e linha (base) |
| `projetado[cenario][mes][produto][marco]` | número; `marco` ∈ leads trabalhados, reuniões realizadas, validadas, contratos | halteres e linha do projetado |
| `premissas[cenario][produto]` | taxas por etapa, ticket | tooltip "de onde vem este número" |

Hoje a Projetado × realizado usa **linhas fixas** da planilha v10 (29/35/37/41 e 25–27/38–40, `forecast.ts:27-35`). O formato acima troca o número da linha pelo nome do marco, e isso protege a tela de mudança de layout da planilha.

## 13. Fora do escopo

- O modelo de forecast, as premissas e a planilha nova da Cella (chat de Forecast).
- Os defeitos da Operação diária (outro chat).
- Previsão de receita em R$: das 30 validadas, 0 têm valor no CRM. Volta se o CRM passar a ter valor (§14, P4).
- Funil de inbound e distribuição de inbound (Growth, PRODUCT 5.8): a fronteira fica como está, com o perímetro na `descricao`.
- Telemetria de navegação (PRODUCT 5.15, Eliezek).
- Qualquer escrita no Pipedrive a partir do Brain.
- Tabelas da Fila Cella (DECISIONS 24/09).
- A tela `/crm` do Bodra (PRODUCT 5.2).
- Qualquer mudança em Follow Day, Pessoas e PDI e Distribuição (ficam como estão, P1 e P2).
- A lista fechada de motivos de perda no Pipedrive (P5): é configuração do Pipedrive, não do Brain.

## 14. Perguntas de negócio: respostas do Pedro (28/09)

| # | Pergunta | Resposta | Efeito na spec |
|---|---|---|---|
| P1 | O Follow Day sai? | "Deixa lá em stand by." | Fica no menu, sem mudança e sem investimento. Não há redirect nem remoção. A PRODUCT 5.2 (casa da fila de ligação) continua aberta |
| P2 | Pessoas e PDI e Distribuição saem? | "Não. Vamos usar em algum momento." | Ficam, sem mudança. A migration S4 (restringir os tipos de registro) caiu |
| P3 | De onde vem a meta do mês? | **C**: o modelo sugere, alguém confirma | Sem plano salvo, a meta é a sugestão do cenário base, com o selo "sugerida" na Previsão e na Operação até alguém confirmar. Regra de conversão no contrato da Previsão. Nova issue 21 (Operação), a combinar com o chat da Operação |
| P4 | O Matheus vai preencher data prevista e valor nas validadas? | "Vou alinhar isso com ele." | **Pendente.** A Previsão sobe sem a seção "quando fecha"; o card "Validadas em aberto" mostra "Sem data: N" até o dado existir |
| P5 | O remanejamento sai da taxa de perda? Travar o motivo numa lista fechada no Pipedrive? | "Sim." | Decidido: o remanejamento fica em linha própria e fora da taxa. A lista fechada é configuração do Pipedrive, feita por quem administra o Pipedrive, fora deste repositório |
| P6 | Os 3 títulos divergentes | "O Matheus tem que trocar o campo. De regra, nenhum de consultoria inicial foi trabalhado como consultoria, e sim Finance principalmente. Só um foi para Cella." | O campo está errado no lote de 15/09 (26 negócios), e não só nos 3. A regra de ler o campo não muda; a troca no Pipedrive corrige a tela sozinha (§4.2). Até lá, nenhuma leitura de Consultoria vale |

### P3 explicada: de onde vem a meta do mês

Hoje existem **dois números-alvo** para o mesmo mês, gravados em lugares diferentes:

- **O plano do mês.** Alguém digita à mão na aba Capacidade, e ele fica em `ops.monetizacao_planos`. Para set/26: 8 contratos, 7 leads por dia útil, 120 leads no mês e alocação por produto 0/0/0. **É dele que a Operação diária tira a meta:** o "no ritmo / abaixo" dos quadros de leads por dia e de contratos compara com esse plano.
- **O modelo de forecast.** É a planilha: a v10 hoje e, em breve, a v12 com cenários, do chat de Forecast. Ela projeta mês a mês, por produto, leads trabalhados, reuniões, validadas e contratos. A v10 dá para set/26 8 contratos (1 Cella, 4 Consultoria e 3 Finance). De out/26 em diante dá 16 contratos por mês, porque supõe 2 closers.

Em setembro os dois dão 8, porque o plano foi digitado a partir da planilha. **A partir de outubro eles se separam:** o plano de out/26 não existe, e a planilha diz 16. Com a v12 serão três números por mês (pessimista, base e otimista). A pergunta é: quando a Operação mostrar "Contratos ganhos: 3 de **8**", de onde vem o 8?

| Opção | Como funciona | A favor | Contra |
|---|---|---|---|
| **A. Meta digitada (como hoje)** | O plano é independente do modelo, e alguém salva todo mês | A meta é decisão da gestão e pode ser mais ambiciosa ou mais conservadora que o modelo | Alguém precisa lembrar todo mês: out/26 ainda não foi salvo, e em 01/10 a Operação fica sem meta. Meta e projetado podem divergir sem ninguém ver |
| **B. Meta = cenário base do modelo** | Ao importar o modelo, a meta de cada mês é o cenário base | Uma fonte só, que nunca fica vazia | A meta vira previsão (é o que a regra N13 do Brain proíbe): "abaixo da meta" passa a querer dizer "abaixo do que o modelo previu". Com a v10, a meta de outubro dobraria sozinha para 16 |
| **C. O modelo sugere, alguém confirma** (recomendada) | A partir do dia 20, o plano do mês seguinte nasce preenchido com o cenário base: contratos, leads por dia útil (leads do mês ÷ dias úteis) e alocação por produto. A Previsão mostra "Plano de out/26 sugerido pelo modelo, não confirmado" até alguém salvar, igual ou mudado. Enquanto não houver confirmação, a Operação mostra a meta com o selo "sugerida" | Não fica mês sem meta. A meta continua sendo decisão de alguém, com registro de quem salvou e quando. Divergência entre meta e modelo fica visível na Previsão | Um passo a mais por mês (confirmar) |

**Decidido em 28/09: C.** O Sheet do plano (issue 14) ganha o pré-preenchimento pelo cenário base e o selo "sugerida". A Operação usa a meta sugerida com o mesmo selo até alguém confirmar (issue 21, a combinar com o chat da Operação). Nada novo é gravado: plano salvo é meta confirmada, e a sugestão é calculada na hora.

## 15. Riscos e lacunas

- **Consultoria mal rotulada até a troca do campo:** 26 dos 29 negócios de Consultoria foram trabalhados como Finance ou Cella (P6). Qualquer número de Consultoria e de Finance anterior à troca está trocado entre os dois painéis.
- **Amostra pequena:** 32 dias de pipe e 3 ganhos. A tela declara isso: KPI `parcial`, curva que para com menos de 5 em observação, coorte "amadurecendo". Box plot e cumulative flow ficam para depois (§6.3).
- **Lacuna de arquétipo:** Funil e ciclo tem cinco gráficos, e o Lista/Relatório prevê um. O contrato propõe a regra "Relatório analítico". A hierarquia é mantida pela ordem de leitura (chega → quanto tempo → onde para → por que perde → está melhorando), e nenhuma tabela linha a linha entra na página.
- **Tema escuro:** verde e ciano da marca ficam claros demais para gráfico (§6). É achado do DS, para o Mika.
- **Uso não medido:** os cortes se apoiam em dado, não em uso (§3).
- **Dados individuais fora do Git:** o mockup publicado tem nomes de empresas. No repositório ficam só o modelo sem dado e o gerador (`mockup/`), como manda a regra de 16/09 ("Dados individuais e evidências permanecem privados, fora do Git").
