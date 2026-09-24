# Cockpit do CEO — diagnóstico de cobertura empresarial (23/09/2026)

Varredura somente leitura, feita antes de redesenhar a tela. Serve para o escopo novo: a meta é
**R$ 1 bilhão de faturamento anual da Planning** (não Monetização, não valuation), e o cockpit precisa
responder pela empresa inteira.

Como foi lido:
- **Banco unificado Planning Brain** (`npknehhyyzelmrbbxvtu`, criado em 02/09): Management API com
  `read_only: true`.
- **Projeto Financial Brain** (`itpddzjfrgrbathcqbpo`): transação `begin transaction read only` com o
  papel padrão, porque o papel de leitura não tem EXECUTE nas funções. Escrita recusada, conferido com
  um INSERT.
- **Código:** `feat/cockpit-ceo-empresa-20260923`, a partir da `main` `b5c44d7`.
- **Documentos:** mapa de investidores, livro de RevOps, artifact "Receitas rumo ao bilhão" e
  `monetizacao/outputs/` de 18 e 22/09.

Não foi lido nada de Pessoal, Crool, Yellot ou outros clientes. Nenhum CRM, e-mail ou automação foi
tocado.

## 0. Três achados que mudam o desenho

1. **O Financeiro que o cockpit lia é uma cópia congelada.**
   - A tela do Brain Financeiro em produção lê o projeto Financial Brain (`itpddzjfrgrbathcqbpo`).
     Conferido no bundle servido em `planningbrain.com.br/financeiro`.
   - O cron do Financeiro também grava lá: 2.386 cargas bem-sucedidas depois de 03/09, a última em
     20/09.
   - O schema `financeiro` do banco unificado, que o cockpit publicado consultava, parou no corte de
     02/09. Nele a função é outra (8.985 contra 15.854 caracteres), os lançamentos também (90.786 até
     31/08 contra 96.830 até 20/09) e o de/para tem 26 mil linhas contra 43 mil.
   - Resultado: **a série do cockpit ficava ~10% abaixo da tela de Faturamento, inclusive nos meses
     fechados.** Jan/26: R$ 6,03 mi contra R$ 6,76 mi. Média jan–jul: R$ 5,83 mi contra R$ 6,45 mi.
     A homologação da rodada 2 conferiu o cockpit contra a mesma cópia, por isso não pegou a diferença.
   - **Correção:** o cockpit passa a ler o Financial Brain no servidor, pela credencial que o Ops já
     usa para emitir a sessão do Financeiro (`FINANCEIRO_SUPABASE_URL` e service role, presentes em
     Production e Preview do `ops-brain`). A porta continua a mesma: produto Financeiro + todas as
     empresas.
2. **Os crons do Financeiro não rodam desde 21/09.**
   - As GitHub Actions da conta `pedroluca-prog` recusam os jobs: "recent account payments have failed
     or your spending limit needs to be increased".
   - A última carga de lançamentos foi em 20/09. `sync-titulos`, `sync-caixa` e `saude-frescor` falham
     a cada disparo em 4–10 s, sem chegar a rodar.
   - **Quem resolve:** o dono da conta GitHub (cobrança). O cockpit mostra a data da última carga
     bem-sucedida, em vez de fingir frescor.
3. **Growth é a área mais completa do banco e nenhuma tela do Ops a lê.**
   - Tem mídia paga diária por canal desde 08/2025, 34 mil negócios desde 11/2023 e plano mensal de
     aquisição (`growth.metas`: investimento, MQL, reuniões, vendas, MRR novo, ticket).
   - Tem meta trimestral por unidade (`growth.dist_metas`) e o forecast do mês corrente do Inside Sales
     (`growth.mes_corrente`: ritmo, pipeline, win rate, cobertura do gap).
   - Tudo atualizado hoje. O cockpit anterior não usava nada disso.

## 1. Diagnóstico por área

A última coluna usa uma escala única:
- **exposto:** no cockpit publicado;
- **integrado agora:** entra nesta branch com consulta real;
- **lacuna:** vira estado explícito na tela.

### Growth (aquisição)

- **Fontes encontradas:**
  - `growth.midia_paga` (17.019 linhas, 01/08/2025–22/09/2026): investimento, cliques, leads, MQL, RR,
    RM e vendas por anúncio e dia; Google Ads e Meta Ads.
  - `growth.campanhas_mes` e `growth.serie_mensal`: views mensais.
  - `growth.metas`: 84 linhas de jun–set/2026, plano por métrica.
  - `growth.deals`: Inside Sales e "fora do ICP".
  - `growth.passagens`: 12.969 passagens SDR → closer.
  - `growth.activities`: 60 mil, desde 01/2026.
- **Responsável:** diretoria de Growth (dono do schema; a policy de escrita é `growth.e_admin()`).
  Nome da pessoa a confirmar.
- **Cobertura e atualização:** mídia desde 08/2025, metas desde 06/2026. Todas as tabelas atualizadas
  em 23/09, 22h (sync do Growth).
- **Grão e chaves:** anúncio × dia; negócio (`deal_id`, que é o id do Pipedrive); mês × métrica do
  plano.
- **Qualidade:**
  - Em 2026, 8.188 de 9.482 negócios Inside Sales não têm `canal`, então a atribuição por canal no
    negócio é parcial.
  - A mídia atribui vendas pela própria planilha (`vendas`, `rmm`), sem id de negócio.
- **Cálculo existente:** `serie_mensal` calcula ROAS e "CAC", que aqui é custo de mídia por venda.
  `mes_corrente` calcula forecast por ritmo e por pipeline.
- **No cockpit:** não exposto.
- **Ação:** integrado agora (funil plano × realizado, custo de mídia por venda, forecast do mês lido da
  view). A lacuna declarada é a atribuição por canal no negócio.

### Comercial (todas as frentes)

- **Fontes e motores de venda:**
  - **Inside Sales:** `growth.deals`, pipeline "Inside Sales". 467 ganhos; MRR novo de R$ 145 mil (jan)
    a R$ 281 mil (set).
  - **Sócios:** `ops.contratos`, `origem_pipeline = socios`. 203 contratos; o lote de agosto (119) é
    migração, não venda.
  - **Monetização:** `ops.monetizacao_deals`, pipe 39. 178 negócios.
  - **Broker:** `ops.broker_oportunidades`. 77 oportunidades desde 01/09; 1 comprada.
- **Passagem à operação:** `ops.contratos` → `ops.cs_onboarding_cards`.
- **Responsáveis:** Comercial Inside Sales (Growth); Departamento de Receitas (Monetização); Expansão
  (Sócios e Broker). A confirmar.
- **Conciliação:** os ganhos do Growth batem com os contratos Inside Sales de mai–set, com diferença
  de 1 a 5 por mês. De jan a abr há contratos Inside Sales sem negócio no Growth (33 em janeiro).
- **Forecast vigente:**
  - Inside Sales: `growth.mes_corrente`, só o mês corrente.
  - Monetização: `ops.monetizacao_forecasts` v10 de 09/09, importado em 15/09. Mede valor
    **assinado**, não faturamento. A escolha entre v10 e v11 não tem registro.
  - Financeiro: `fn_projecao` projeta caixa, não receita.
  - **Não existe forecast empresarial de faturamento.**
- **No cockpit:** exposto só Monetização.
- **Ação:** integrado agora (motores Inside Sales, Sócios e Monetização em MRR vendido por mês; plano ×
  realizado; forecast do mês do Growth). Broker fica como lacuna: exige `view.broker_admin` e ainda não
  tem série. Não há probabilidade por etapa em fonte nenhuma, então o pipeline aparece **sem
  ponderação**.

### Ops e entrega

- **Fontes:**
  - `ops.cs_onboarding_cards` (198 cards desde 16/07/2026, com histórico de fases).
  - `ops.auditorias_internas` (88).
  - `ops.custo_operacional_mensal` (planilha "Controle de Gastos Geral", jul/2026–jul/2027, parada em
    03/09).
  - `ops.gente_*` (215 pessoas).
  - `ops.headcount_mensal`: **vazia**.
- **Responsável:** Operações e CS. A confirmar.
- **Números de hoje:**
  - 36 onboardings concluídos, 15 com churn no onboarding;
  - **77 em "Setup técnico", em média há 44 dias na fase**;
  - 48 em "Nova Onboarding".
  - 111 dos 198 cards têm empresa e 105 chegam a um contrato.
- **Cálculo existente:** nenhum de ativação, SLA ou capacidade. Só a capacidade comercial do plano da
  Monetização.
- **No cockpit:** não exposto.
- **Ação:**
  - Integrado agora: fila de onboarding por fase, idade na fase, concluídos e churn no onboarding,
    tempo do ganho à conclusão onde houver vínculo.
  - Lacunas: horas, SLA, retrabalho, custo por cliente e capacidade da equipe. Não há fonte; o
    `headcount_mensal` está vazio.

### Unidades e rede

- **Fontes:**
  - `ops.royalties_apuracao`: 56 apurações de 12/2025 a 09/2026.
  - `ops.unidades`: 15.
  - `ops.v_reconciliacao_mensal`: faturado × recebido por unidade.
  - `growth.dist_metas`: meta trimestral por unidade. T3: 13 unidades, meta R$ 550 mil, vendido
    R$ 748 mil.
  - RPCs `idu_apuracao` e `indicadores_trimestre`.
  - `ops.nps_pesquisas`: 424 envios, 53 com nota.
  - `ops.pesquisa_satisfacao_comite_socios`: sem policy de leitura.
- **Responsável:** Expansão e Controladoria.
- **Qualidade:**
  - `v_reconciliacao_mensal` repete o MRR contratado de hoje em todos os meses (R$ 1,68 mi fixo), então
    não serve de série.
  - A apuração é a régua de faturamento da rede; ver DECISIONS de 26/08.
- **No cockpit:** exposto (faturamento, royalties + CSC e concentração por unidade).
- **Ação:** preservado e revalidado. A meta por unidade do Growth entra na frente Unidades.
  Custo e margem por unidade e satisfação dos sócios continuam lacunas.

### Financeiro

- **Fonte canônica:** Financial Brain (`itpddzjfrgrbathcqbpo`).
  - `fn_faturamento_mensal`: DRE 1.1 por emissão, por cliente e mês, com
    `Σ linhas + sem_cliente = total`.
  - `fn_receita_emitido_recebido`: emitido × recebido por mês de emissão, com o recebido acumulado
    até a foto.
  - `fn_inadimplencia_live`: Omie ao vivo.
  - `fn_cockpit_indicadores`: receita bruta, lucro bruto, margem e resultado por empresa e grupo de
    apuração.
  - `fn_cockpit_caixa_livre`: saldo bancário.
  - `fn_competencias_cobertura`: meses fechados e parciais.
- **Responsável:** Controladoria (Ana Carvalhais) e CFO.
- **Cobertura:** jan–ago/2026 fechados; set/2026 em curso. 17 empresas cadastradas.
- **Ausências declaradas pela fonte:**
  - PARTNERS em zero desde jul/2026, sem chave de API no Omie; pesava cerca de R$ 250 mil por mês.
  - AGRO sem credencial.
  - PNC e ROIT encerrando operação.
- **Atualização:** última carga em 20/09; os crons estão parados desde 21/09 (achado 2).
- **Réguas:** faturamento pelo bruto (09/09) e DRE pelo líquido (15/09), decididas pela Controladoria.
  Finance e Negócios Estruturados ficam fora por padrão (R$ 586 mil em jul–ago).
- **No cockpit:** exposto só o faturamento, e **da cópia errada**.
- **Ação:** integrado agora da fonte canônica: faturamento, ponte, emitido × recebido, inadimplência,
  caixa, margem e composição por grupo.

### Clientes e CS

- **Fontes:**
  - `ops.empresas`: 4.168 cadastros.
  - `ops.omie_contratos_servico`: 1.785.
  - `ops.contas_receber`: 31.246.
  - `ops.v_cliente_mrr`.
  - `ops.central_tratativas`: 31 tratativas, 30 perdidas, 29 com data de churn; as datas vão de
    06/2025 a 08/2026.
  - `ops.nps_pesquisas`.
- **Responsável:** CS e Departamento de Receitas.
- **Qualidade:**
  - `ops.contratos` tem status "Ativo" fixo para todo ganho.
  - O churn datado é recente e provavelmente incompleto: são R$ 190 mil de MRR perdido registrado
    desde 06/2025.
  - Não existe fonte de expansão ou contração contratual.
- **No cockpit:** exposto (quatro definições de cliente ativo e coortes).
- **Ação:** preservado. **Expansão e contração passam a ser medidas pelo faturamento por cliente**
  (ponte), com rótulo de régua de emissão. Churn contratual continua sendo o da Central.

### Monetização e verticais

- **Fontes:** `ops.monetizacao_*`, `ops.monetizacao_forecasts` (v10), `ops.monetizacao_planos`.
- **Responsável:** Departamento de Receitas.
- **Números:** 2 negócios ganhos no pipe de Monetização. A receita realizada por vertical não é
  separável hoje:
  - o Financeiro não classifica receita por vertical;
  - PARTNERS está sem Omie;
  - o recorte "Finance" do Financeiro é um departamento, não a vertical.
- **No cockpit:** exposto como primeira dobra.
- **Ação:** passa para a frente **Portfólio e monetização**, como uma dimensão da ponte. A receita
  realizada por vertical continua lacuna, com dono: Controladoria + Receitas.

### Consolidação e capital

- **Fontes:** nenhuma no Brain. O mapa de investidores fala em 13 unidades hoje, 20 no fim de 2026,
  cerca de 40 no fim de 2027 e rodada acima de R$ 200 mi. Não tem alvo de aquisição, capital nem
  ritmo. O mapa **não menciona o bilhão**.
- **Responsável:** CEO, M&A e CFO. A nomear.
- **Ação:** lacuna explícita (sem mandato). A ponte reserva a linha "aquisições" com o valor
  "não modelado", nunca zero.

## 2. Tipos de ausência encontrados (não são a mesma coisa)

| Tipo | Exemplos |
|---|---|
| Existe no banco, não aparece no cockpit | toda a área Growth; onboarding; margem por empresa; emitido × recebido; inadimplência; forecast do mês do Growth |
| Falta de permissão para ler | pesquisa do comitê de sócios (nenhuma policy de leitura); Broker (`view.broker_admin`); Growth exige ser membro |
| Falha de sincronização | crons do Financeiro parados desde 21/09 (cobrança do GitHub); cópia unificada do Financeiro parada em 02/09; `roas_por_unidade` e `investimento_bu` parados em 06/2026; planilha de custo operacional parada em 03/09 |
| Ausência de campo | canal vazio em 86% dos negócios Inside Sales de 2026; receita do Financeiro sem CNPJ (nome → CNPJ casa só 84,9% da receita, e 15,1% fica ambíguo); receita sem vertical |
| Ausência real do dado | horas e SLA de entrega; custo por unidade; plano de consolidação; probabilidade por etapa do pipeline; cenário de gestão registrado |

## 3. Divergências registradas, sem escolher por ninguém

- **Unidades:** 13 no mapa, 15 cadastros no Brain (8 regionais acompanhadas no artifact), 11 no
  forecast v10.
- **Base:** "mais de 6 mil" no mapa; 10.304 contas e 9.559 CNPJs no Brain. Clientes ativos variam de
  546 a 650 conforme a régua (rodada 2), e o faturamento do grupo tem 823–859 clientes com receita por
  mês.
- **Churn de 2,34%/mês** no mapa, sem fórmula; o Brain tem três medidas que não batem.
- **Faturamento do grupo:** R$ 47,7 mi em jan–ago pela régua da Controladoria de 01/09 (artifact).
  A tela de Faturamento hoje dá R$ 52,6 mi em jan–ago, com Finance e Negócios Estruturados fora.
  A diferença é de régua e data, e não foi reconciliada pela Controladoria.
