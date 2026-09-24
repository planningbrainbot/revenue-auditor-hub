# Atualização para o artifact "Receitas rumo ao bilhão" — 23/09/2026

Estado real do Cockpit do CEO depois da ampliação para a empresa inteira. Gerado do registro único da tela e da homologação com dado real (somente leitura). Sem credenciais, sem nomes de clientes ou pessoas.

## O que mudou no escopo

- A meta é **R$ 1 bilhão de faturamento anual da Planning** (ano-alvo 2030). O perímetro continua por decidir: as leituras do grupo e da rede aparecem lado a lado, nunca somadas.
- O cockpit deixou de ser um painel de Monetização. Monetização virou uma frente (Portfólio e monetização) e um dos motores da ponte.
- **Fonte do faturamento corrigida.** O cockpit lia uma cópia do Financeiro congelada em 02/09, que ficava cerca de 10% abaixo da tela oficial. Agora lê a mesma função da tela de Faturamento, no projeto do Brain Financeiro.
- Entraram Growth (aquisição, plano × realizado, forecast do mês), Operação (fila de onboarding), Caixa e margem, a ponte de faturamento por cliente e a cadeia venda → ativação → faturamento → recebimento → saída.

## Números lidos em 23/09/2026 (somente leitura)

- **Faturamento do grupo** (Financeiro, DRE 1.1 por emissão, Finance e Negócios Estruturados fora por padrão): 8 meses fechados, de 01/2026 a 08/2026. Média de R$ 6,58 mi por mês, ou 12,7× abaixo dos R$ 83,3 mi/mês que a meta pede em 2030. Última carga do Financeiro: 20/09/2026.
- **A cópia que o cockpit lia** ficava entre -10.8% e -7.6% da fonte oficial, mês a mês.
- **Ponte de 08/2026** (R$ 6,60 mi → R$ 7,46 mi): 64 clientes novos (R$ 220 mil), 19 retornos (R$ 74 mil), expansão de 105 clientes (R$ 1.564 mil), contração de 83 (R$ -595 mil) e 47 sem faturamento no mês (R$ -404 mil). Todos os 7 meses fecham em centavos com a fonte.
- **Margem bruta no ano:** 44,4% sobre R$ 58,81 mi de receita bruta. Caixa livre no fim de 08/2026: R$ 1,90 mi (sem saldo: AGRO, NEO, PARTNERS).
- **Vencido e não recebido:** R$ 4,98 mi em 801 títulos, de R$ 11,84 mi em aberto (Omie ao vivo).
- **Aquisição (Inside Sales):** 06/2026 R$ 223 mil vendidos contra R$ 245 mil de plano; 07/2026 R$ 216 mil vendidos contra R$ 220 mil de plano; 08/2026 R$ 267 mil vendidos contra R$ 230 mil de plano. O pipeline aberto tem 861 negócios, R$ 1,41 mi de MRR sem ponderação, e **nenhum tem data de fechamento esperada**.
- **Onboarding:** 147 clientes em curso, **71 há mais de 30 dias na mesma fase** (22 há mais de 60). 36 concluídos, mediana de 27 dias do card à conclusão. Não há SLA decidido.
- **Cadeia da safra** de 17/07/2026 a 22/09/2026: 139 contratos ganhos → 27 com onboarding iniciado → 0 concluídos → 11 faturados (11 pela unidade, 0 pelo grupo) → 4 com título pago na unidade → 0 saídas registradas. **96 dos 139 contratos não têm CNPJ**: é o elo que mais quebra a cadeia.
- **Conferências com SQL independente:** 10 de 10 batem.

## Pilares

| Pilar | Respondidas | Parciais | Lacunas | Dono proposto |
|---|---|---|---|---|
| 1. Base e inteligência de clientes | 0 | 1 | 0 | Dados e RevOps |
| 2. Portfólio e monetização | 1 | 3 | 1 | RevOps e donos de produto |
| 3. Distribuição e execução comercial | 4 | 3 | 0 | Comercial executa; RevOps desenha e mede |
| 4. Retenção e expansão | 1 | 1 | 0 | CS e Operações |
| 5. Economia e saúde da rede | 2 | 0 | 2 | Expansão e Controladoria |
| 6. Entrega e produtividade | 1 | 1 | 1 | Operações e donos de produto |
| 7. Consolidação e capital | 0 | 0 | 1 | CEO, M&A e CFO |
| 8. Governança e evidência | 2 | 3 | 3 | CFO, Jurídico e CEO |

## As 11 exigências do mapa de investidores (p. 25)

| # | Exigência | Pergunta | Situação | O que falta |
|---|---|---|---|---|
| 1 | Receita por produto e cliente | R3 | parcial | De-para auditável produto comercial ↔ serviço ↔ entidade faturadora (F02). |
| 2 | Penetração por vertical | C3 | parcial | Definição de cliente ativo e sinal de ativação por vertical. |
| 3 | Economia por produto | R5 | lacuna | Coletar custos de originação e entrega por produto. |
| 4 | Retenção por coorte | T1 | parcial | Datar todo churn; contrato com início e fim por cliente e produto; reproduzir os 2,34% do mapa. |
| 5 | Privacidade da base | K3 | lacuna | Inventário de finalidade, base legal e retenção. |
| 6 | Performance da matriz com as unidades | E4 | parcial | Registrar roteamento e unidade de destino no evento. |
| 7 | Documentação da rede e histórico de sócios | K4 | lacuna | Fila de documentação da rede. |
| 8 | Economia padronizada da unidade | N1 | lacuna | Plano de contas gerencial comum por unidade (F07). |
| 9 | Satisfação dos sócios das unidades | N2 | lacuna | Decidir quem lê a pesquisa e criar a política de leitura. |
| 10 | Consolidação com números | K1 | lacuna | Mandato de aquisição e acesso restrito ao módulo. |
| 11 | Demonstrações consolidadas reproduzíveis | K2 | lacuna | Fluxo pendente → conciliado → revisado → fechado (F07). |

## Perguntas por frente

### Receita e trajetória

- **R1 · Qual é nossa trajetória para R$ 1 bi de faturamento anual?** — parcial (nesta versão (não publicada); PRD 22/09). Média dos meses fechados, ritmo anualizado e múltiplo necessário para R$ 83,3 mi/mês em 2030, por leitura candidata. Sem 12 meses fechados não há crescimento anual necessário. Falta: Escolher o perímetro (ano-alvo 2030 definido em 22/09); fechar 12 meses de histórico. Decisão pendente: Perímetro da meta (grupo, rede ou outro).
- **R6 · De onde veio a variação do faturamento no último mês fechado?** — respondida (nesta versão (não publicada); desdobramento 23/09). Ponte por cliente: novos, retornos, expansão, contração e sem faturamento no mês, fechando em centavos com o total. Unidade nova, monetização e aquisições ainda não têm vínculo de receita e aparecem como não modelados. Falta: Vínculo receita → unidade, produto e vertical para abrir as linhas de unidade nova e monetização.
- **R7 · Qual previsão sustenta os próximos meses, e com que premissas?** — parcial (nesta versão (não publicada); desdobramento 23/09). Camadas separadas e rotuladas: forecast do mês do Growth, pipeline aberto não ponderado por mês de fechamento esperado e forecast v10 da Monetização. Não existe previsão empresarial de faturamento. Falta: Plano de receita por mês e motor (orçamento), probabilidades por etapa e cenário de gestão registrados. Decisão pendente: Escolha entre forecast v10 e v11 da Monetização; previsão empresarial de receita.

### Aquisição e conversão

- **A1 · Quanto investimos em aquisição e quanto isso vira venda?** — respondida (nesta versão (não publicada); desdobramento 23/09). Funil mensal de investimento → leads → MQL → vendas → MRR novo e custo de mídia por venda. O custo é só mídia (não é o CAC completo), e 86% dos negócios de 2026 não têm canal. Falta: Canal preenchido no negócio para atribuição; custo completo de aquisição.
- **A2 · A aquisição cumpre o plano do mês?** — respondida (nesta versão (não publicada); desdobramento 23/09). Plano × realizado de investimento, MQL, vendas e MRR novo por mês (plano desde jun/2026). Mês sem plano aparece sem plano, não com 0%.
- **E3 · Qual produto e qual unidade convertem?** — parcial (no ar; PRD 22/09). Monetização por produto (validadas e ganhos). Venda por unidade aparece em Unidades, pela meta trimestral do Growth. Falta: Conversão por unidade de ponta a ponta (lead roteado → contrato).

### Clientes

- **C1 · Quantos clientes temos de verdade?** — parcial (no ar; PRD 22/09). Quatro réguas com sobreposição (rodada 2). A ponte mostra ainda os clientes com faturamento no mês, outra régua. Falta: Escolher, por contexto, qual régua vale; completar CNPJ das empresas sem documento no cadastro. Decisão pendente: Definição de cliente ativo por contexto.

### Retenção e expansão

- **T1 · Quem permanece, expande ou sai, por coorte?** — parcial (nesta versão (não publicada); mapa, exigência 4). Coortes de logo (teto, porque só 29 churns têm data) e, na ponte, expansão, contração e sem faturamento por mês, pela régua de emissão. Falta: Datar todo churn; contrato com início e fim por cliente e produto; reproduzir os 2,34% do mapa.

### Operação e capacidade

- **O1 · Conseguimos ativar o que vendemos?** — respondida (nesta versão (não publicada); desdobramento 23/09). Fila por fase e idade na fase, concluídos, churn no onboarding. As faixas de 30 e 60 dias são de leitura: não há SLA decidido. Falta: SLA de onboarding decidido por Operações.
- **O2 · A venda chega até o faturamento e fica?** — parcial (nesta versão (não publicada); desdobramento 23/09). Contagem por elo, com o que não liga por falta de chave (sem empresa, sem CNPJ, CNPJ fora do cadastro do Omie, nome ambíguo). Recebimento por cliente não é lido. Falta: Recebimento por cliente; CNPJ no lançamento do Financeiro.
- **T2 · A entrega comporta crescer?** — lacuna (não iniciada; PRD 22/09). Não respondida. O único sinal é a fila de onboarding parada (O1). Falta: Instrumentar a entrega (horas, SLA, retrabalho, capacidade por equipe).

### Unidades

- **E4 · O que a matriz gerou, distribuiu e converteu para cada unidade?** — parcial (nesta versão (não publicada); mapa, exigência 6). Vendido contra meta por unidade e trimestre. Leads gerados, distribuídos e trabalhados por unidade ainda não são rastreados como evento. Falta: Registrar roteamento e unidade de destino no evento.
- **N3 · Como estão faturamento, repasses e concentração por unidade?** — respondida (no ar; PRD 22/09). Faturamento, participação, royalties + CSC e concentração na janela de meses completos. Recebido por unidade fica fora (régua de competência não confiável). Falta: Recebido por unidade com régua confiável.
- **N4 · Quais unidades cumprem a meta trimestral de venda?** — respondida (nesta versão (não publicada); desdobramento 23/09). Meta × vendido por unidade no trimestre, com o total da rede.
- **N1 · Quais unidades crescem com margem?** — lacuna (não iniciada; mapa, exigência 8). Não respondida: custo por unidade não existe no Brain. Falta: Plano de contas gerencial comum por unidade (F07).
- **N2 · O sócio da unidade está satisfeito?** — lacuna (não iniciada; mapa, exigência 9). Não respondida: nenhum papel lê a pesquisa pelo app. Falta: Decidir quem lê a pesquisa e criar a política de leitura. Decisão pendente: Quem lê a pesquisa dos sócios.

### Portfólio e monetização

- **R3 · Quanto vem de cada produto e de cada cliente?** — parcial (nesta versão (não publicada); mapa, exigência 1). Por cliente: sim, dentro do Financeiro (a ponte usa). Por produto e vertical: não, a receita não tem produto; o cockpit mostra a receita por grupo de apuração (entidade) em Caixa e margem. Falta: De-para auditável produto comercial ↔ serviço ↔ entidade faturadora (F02).
- **E1 · Quantos contratos de monetização ganhamos no período, e estamos no ritmo do plano?** — respondida (no ar; PRD 22/09). Contratos ganhos no pipe de Monetização contra o ritmo do plano do mês. Falta: A Operação abre com filtro próprio de responsável.
- **E2 · A demanda de monetização está sendo trabalhada?** — respondida (no ar; PRD 22/09). Leads trabalhados e oportunidades validadas pela data do evento.
- **C2 · Onde há oferta disponível para trabalhar agora?** — respondida (no ar; PRD 22/09). Contas únicas prontas em ao menos um produto, sem duplicar sobreposição.
- **C3 · Quantos clientes ativos consomem cada vertical?** — parcial (no ar; mapa, exigência 2). Só penetração vendida (ganho no CRM), rotulada como tal; penetração efetiva exige evidência de consumo. Falta: Definição de cliente ativo e sinal de ativação por vertical. Decisão pendente: Definição de cliente ativo.
- **R4 · De onde vem o próximo incremento da monetização?** — parcial (no ar; PRD 22/09). Soma da receita prevista declarada; negócios sem valor contados à parte. Falta: Ligar ao faturamento realizado (F02) antes de projetar contribuição à meta.
- **R5 · Qual produto compensa originar e entregar?** — lacuna (não iniciada; mapa, exigência 3). Não respondida: não há custo por produto. Falta: Coletar custos de originação e entrega por produto. Decisão pendente: Regra de rateio Partners × unidade × parceiro (E09).

### Caixa e margem

- **R2 · Quanto faturamos e quanto recebemos no período?** — parcial (nesta versão (não publicada); PRD 22/09). Faturado por mês, recebido do emitido nos meses que a foto de títulos alcança e vencido em aberto ao vivo. Meses depois da foto (jul/26 em diante) não têm recebido medido. Falta: Nova foto de títulos em aberto (a vigente é de 01/06) e retomada da carga diária do Financeiro, parada desde 20/09.
- **X1 · Com que margem operamos, e em qual grupo de empresas?** — respondida (nesta versão (não publicada); desdobramento 23/09). Receita bruta, lucro bruto (margem de contribuição da DRE) e resultado por grupo de apuração no ano, meses fechados.
- **X2 · Quanto caixa temos no fim do último mês fechado?** — parcial (nesta versão (não publicada); desdobramento 23/09). Saldo bancário no fim do mês, com as empresas sem saldo nomeadas.

### Evidências e capital

- **K1 · O que podemos consolidar, com qual capital e em que ritmo?** — lacuna (não iniciada; mapa, exigência 10). Não respondida: aquisições aparecem na ponte como não modeladas. Falta: Mandato de aquisição e acesso restrito ao módulo. Decisão pendente: Mandato de aquisição.
- **K2 · Conseguimos reproduzir as demonstrações consolidadas?** — lacuna (não iniciada; mapa, exigência 11). Parcial: a DRE mensal existe e declara meses fechados e parciais; não há versão imutável do fechamento. Falta: Fluxo pendente → conciliado → revisado → fechado (F07).
- **K3 · Podemos demonstrar origem e uso dos dados da base?** — lacuna (não iniciada; mapa, exigência 5). Não respondida. Falta: Inventário de finalidade, base legal e retenção.
- **K4 · A documentação da rede e o histórico de sócios estão completos?** — lacuna (não iniciada; mapa, exigência 7). Não respondida. Falta: Fila de documentação da rede.
- **G1 · Os dados que sustentam o cockpit estão atualizados?** — respondida (nesta versão (não publicada); desdobramento 23/09). Data da última carga de cada fonte e aviso quando passa da cadência. Em 23/09 o Financeiro está sem carga desde 20/09. Falta: Retomar os crons do Financeiro (cobrança das GitHub Actions).

## Decisões e pendências que continuam abertas

1. Perímetro da meta: grupo, rede ou outro (CEO + CFO).
2. Cobrança das GitHub Actions da conta que roda os crons do Financeiro: sem carga desde 20/09 (dono da conta).
3. Migração do Financeiro para o banco único; até lá, o cockpit lê o projeto do Financeiro pela credencial de servidor que o Ops já tem (Eliezek e dono do Financeiro).
4. SLA de onboarding e quem destrava a fila (Operações propõe, CEO aprova).
5. CNPJ em todo contrato ganho e data de fechamento esperada no pipeline (Comercial / Growth).
6. Previsão empresarial de receita por mês e motor (CFO + RevOps); escolha entre os forecasts v10 e v11 da Monetização.
7. Definição de cliente ativo por contexto (CEO + Receitas).
8. Vínculo receita → unidade, produto e vertical no Financeiro (Controladoria + Receitas).
9. Mandato de consolidação (CEO + CFO); quem lê a pesquisa dos sócios (Expansão).

## Onde está

- **Local e em PR de revisão**, branch `feat/cockpit-ceo-empresa-20260923`. **Não publicado:** o deploy do Ops é pela CLI do Eliezek e precisa de autorização.
- Preview sintético: `./scripts/cockpit-ceo/preview.sh` → `/piloto/cockpit-ceo`.
