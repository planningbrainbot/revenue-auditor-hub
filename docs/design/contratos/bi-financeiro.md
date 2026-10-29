# Contrato · Área BI Financeiro (`/bi-financeiro`, `/financeiro-semanal`)

**Dono de produto:** CEO (leitor) e Financeiro da Partners (dono dos números)   **Dono do código:** a decidir pelo dono de produto   **Data:** 19/10/2026

**Estado:** aprovado e publicado em 19/10/2026 ("pode publicar" do dono, depois de ver a prévia local). Pedido de 19/10/2026: criar a área **BI Financeiro**, mover para ela o Financeiro semanal e o BI Financeiro que hoje moram em Receita e Repasses, e atualizar o BI para ficar "igual ao de Growth", com as análises da planilha "Financeiro - Planning Partners", para o CEO acompanhar diariamente.

Referência de forma: a tela "Executivo" do Growth (`brain-web`, rota `/`): pergunta no topo ("A meta de outubro ainda fecha?"), pulso Meta · Realizado · Forecast · Falta, arco contra a meta, "onde perde", ritmo, e "como fechamos os últimos meses".

Referência de conteúdo: as abas visíveis da planilha, que são o que o CEO já lê: **Forecast Oficial**, **Forecast x Realizado**, **DRE**, **FCX**, **DRE Aquisição**, **DRE Retenção**, **Burn Rate**, **Competência × Caixa**, **CAC Agenda (parcelas)**, **Rateio CSC Comercial**, **Rateio Comissões**, **Custos Growth**.

---

## 1. A área

Slug `bi_financeiro`, nome "BI Financeiro", descrição "Resultado contra o plano, caixa e fôlego da Partners, todo dia.", escopo `nenhum`. As duas telas **saem** de Receita e Repasses (o grupo "Caixa da Partners" deixa de existir lá).

Lateral (cada item é um assunto; as abas que o `/dre-caixa` tinha viram itens, como `?frente=` no Cockpit do CEO, para cumprir N6). Uma rota só, `/bi-financeiro`, com o assunto em `?aba=`; `/dre-caixa` redireciona para ela com os mesmos filtros.

| Grupo | Item | URL | Situação |
|---|---|---|---|
| Visão geral | Visão executiva | `/bi-financeiro` | **nova** |
| Resultado | Forecast × Realizado | `?aba=forecast` | **nova** (calculada no retrato, não lida da aba) |
| | Resultado do período | `?aba=geral` | existe (era a "Visão geral" do BI) |
| | DRE | `?aba=dre` | existe |
| | Aquisição × Retenção | `?aba=aquisicao-retencao` | **nova** (DRE Aquisição, DRE Retenção) |
| | Variação | `?aba=variacao` | existe |
| Caixa | Previsibilidade de caixa | `/financeiro-semanal` | existe; desde 22/10/2026 é o painel de saídas (a pagar pelo vencimento, lido de `ops.saidas_omie`), no lugar do Caixa da semana |
| | Fôlego | `?aba=folego` | **nova** (Burn Rate + agenda de CAC) |
| | Competência × Caixa | `?aba=ponte` | existe, ganhou o "deveria × recebeu × ficou para trás" |
| | Entradas e saídas | `?aba=caixa` | existe |
| | Inadimplência | `?aba=inadimplencia` | existe |
| Aquisição | Mídia | `?aba=midia` | existe |
| | Mídia × CAC | `?aba=midia-cac` | existe |
| | Eficiência | `?aba=eficiencia` | existe |
| Fechamento | Conferências | `?aba=conferencias` | existe |

A barra de abas dentro do `/dre-caixa` sai; quem troca de assunto é a lateral. Links antigos com `?aba=` continuam abrindo a mesma coisa.

## 2. Visão executiva (`/bi-financeiro`)

### Propósito
- **Pergunta (`<h1>`):** "O mês fecha no plano?"
- **Público:** CEO; Financeiro da Partners. Sócio regional não vê.
- **Decisão que provoca:** onde agir hoje: cobrar quem deve, segurar despesa fora do plano, rever mídia, ou rever o próprio forecast.
- **Métrica de sucesso:** o CEO abre uma vez por dia e sabe, sem abrir planilha, se o mês está acima ou abaixo do Forecast Oficial, por quê, e quantos meses de caixa sobram sem o investidor.
- **Arquétipo:** Visão geral.
- **Universo (`descricao`):** "Planning Partners · competência (DRE) e caixa (extrato do Omie) · mês corrente parcial contra o Forecast Oficial".

### Anatomia (ordem fixa)
1. `PageHeader`: pergunta, universo, `Procedencia` com o horário do retrato, seletor de mês (`?mes=`, padrão o mês corrente) e selo **parcial até dd/mm** ou **fechado**.
2. **Pulso** (até 6 `KpiCard`, cada um com previsto, realizado e desvio no mesmo cartão, N13):
   | Número | Definição | Fonte | Drill-down |
   |---|---|---|---|
   | Receita bruta | DRE do mês × Forecast Oficial do mês | aba DRE · aba Forecast Oficial | Forecast × Realizado, linha de receita |
   | EBIT | idem | idem | Forecast × Realizado, linha EBIT |
   | Resultado do mês sem o investidor (queima) | EBIT + não operacional − aporte | aba Burn Rate | Fôlego |
   | Saldo em conta | saldo do extrato no fim do mês, e o mesmo saldo sem nenhum aporte | aba Competência × Caixa (FCX) | Competência × Caixa |
   | Meses de caixa sem o investidor | saldo ÷ queima média sem o investidor (competência) dos 3 últimos meses fechados | abas Burn Rate e Competência × Caixa | Fôlego |
   | Unidades devendo à Partners | vencido no Omie da Partners, hoje | retrato do BI (inadimplência) | Inadimplência |

   O Forecast Oficial não tem saldo de caixa acumulado (a linha "Saldo Final de Caixa" é o EBIT mais o aporte do mês), por isso o saldo em conta não tem previsto.
3. Receita e EBIT mostram a barra de progresso contra o Forecast no próprio cartão (prévia). O arco do Growth fica para depois: o mês corrente mede a emissão, não a receita final (risco 3).
4. **"Onde o resultado desvia"** (o "onde o funil perde" do Growth): as 3 linhas do Forecast × Realizado com maior desvio em R$ no mês, contra o plano, com sinal (a favor / contra). Cada uma abre a linha no Forecast × Realizado.
5. **"Como fechamos os últimos meses"**: barras Receita bruta × EBIT por mês, previsto em traço, de jan/26 até o mês corrente; embaixo, tabela curta Mês · Receita · EBIT · Margem · Desvio do EBIT · Saldo em conta.

Nada de tabela linha a linha nem abas nesta tela (ARQUETIPOS, Visão geral).

## 3. Forecast × Realizado (`?aba=forecast`)
- **Pergunta:** "Onde o realizado se afasta do Forecast Oficial?"
- Arquétipo Lista/Relatório. A mesma tabela da aba "Forecast x Realizado": linhas de receita, custos variáveis, custos operacionais, EBIT, margem, aporte e resultado; por mês Previsto · Realizado · Desvio R$ · Desvio %; coluna de acumulado. Verde a favor do plano, vermelho contra.
- Filtro `?de=&ate=` (AAAA-MM). Mês parcial com selo e o aviso da planilha: "o mês parcial sempre parece pior: a despesa entra no começo do mês e a receita vai sendo emitida".
- Linhas "fora do forecast" (receitas e despesas que o plano não previu) aparecem separadas, como na planilha.
- **Pessoal fica agregado.** O Forecast Oficial lista salário por pessoa; a tela mostra só "Pessoal (operação)".

## 4. Aquisição × Retenção (`?aba=aquisicao-retencao`)
- **Pergunta:** "A máquina de vender se paga, e a carteira cobre a estrutura?"
- Dois blocos lado a lado, com a mesma régua das abas DRE Aquisição e DRE Retenção (cada conta é a mesma célula da DRE): receita da aquisição × custo da aquisição (mídia, CSC Comercial, comissões, marketing) e receita da retenção × estrutura (pessoal, administrativo, bancos, viagens, impostos). Resultado e margem de cada um por mês.
- A projeção da planilha (média de jul–set + crescimento ao mês, premissas em amarelo) **não entra** nesta versão: premissa digitada na planilha não é fato (ver "O que NÃO entra").

## 5. Fôlego (`?aba=folego`)
- **Pergunta:** "Quanto queimamos sem o investidor, e até quando o caixa aguenta?"
- Série mensal: resultado da aquisição + resultado da retenção = EBIT; não operacional sem o aporte; **queima sem o investidor**; aporte; resultado com o aporte; caixa no fim do mês.
- Número de cabeça: meses de caixa sem o investidor. Premissas usadas (aporte por mês, caixa de hoje) aparecem escritas ao lado, com a data em que foram lidas.
- Embaixo, a projeção de caixa do CAC contrato a contrato (CAC Agenda): quanto de CAC deve entrar em cada mês e quanto está atrasado. Sem nomes de cliente na primeira dobra; a lista fica na gaveta.

## 7. ROAS e assinaturas (`?aba=assinaturas`)

Pedido de 29/10/2026: levar para o BI Financeiro o artifact "ROAS e Assinaturas 2026" (validado com o dono em 26 a 29/10, planilha `tools/output/2026-10-26-comissoes-historico-roas-2026.xlsx`). Decisões do dono no mesmo dia: aba nova (não substitui o ROAS da aba Vendas e ROAS), leitura ao vivo do banco, sem o "cenário planilha".

### Propósito
- **Pergunta (`<h1>`):** "A mídia do Inside Sales vira contrato assinado, e quando?"
- **Público:** quem tem a área BI Financeiro (CEO, Financeiro da Partners, gestão comercial).
- **Decisão que provoca:** cobrar a assinatura dos contratos parados (o card no Pipefy mostra a fase) e ler o ROAS pelo que virou contrato, não só pelo deal ganho.
- **Métrica de sucesso:** o ROAS de contrato que o comercial e o Financeiro citam é o desta aba, sem planilha à parte.
- **Arquétipo:** Lista/Relatório.
- **Universo:** vendas do pipeline Inside Sales (Pipedrive), rede toda, desde jan/26 · mês do ganho · MRR efetivo do deal.

### Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Mídia do Inside Sales | investimento da finalidade `inside_sales` no mês | R$ | `ops.v_roas_midia_inside_sales` (`growth.investimento_finalidade_dia`) | ao vivo | aba Vendas e ROAS | sim (mesma régua) |
| ROAS de contrato no mês | MRR das vendas do mês com assinatura até o fim do mês da venda ÷ mídia do mês (assinatura registrada antes do ganho conta como no mês) | razão | `ops.v_roas_assinaturas` | ao vivo | clientes do mês, situação "Assinado no mês da venda" | sim |
| ROAS de contrato da safra | MRR das vendas do mês com assinatura em qualquer data ÷ mídia do mês | razão | idem | ao vivo | clientes do mês | sim |
| M0, M1, M2, M3+ | MRR (ou %, ou contratos) das vendas do mês assinado no mês da venda, 1, 2, 3 ou mais meses depois | R$ / % / contratos | idem | ao vivo | clientes do mês | sim |
| Sem assinatura | MRR vendido − assinado até hoje | R$ | idem | ao vivo | situação "Sem assinatura" | sim |

Data de assinatura, nesta ordem: Pipefy Central de Contratos (`contratos_documentos.data_assinatura`) → stage 170 do Pipedrive (`contratos.entrada_contrato_assinado_em`) → Funil de CAC. Nunca a "Data da Venda" (21/09/2026). "(cópia)" ganha no mesmo dia que o original sai (é o mesmo cliente). Referência no gráfico: ROAS 0,8 (a do artifact validado).

**Nomes diferentes de propósito:** a aba Vendas e ROAS chama de "ROAS fato" o MRR **vendido** no mês ÷ mídia. Aqui o numerador é o MRR **assinado**, por isso os rótulos são "ROAS de contrato no mês" e "ROAS de contrato da safra" (N11).

### Anatomia
1. "A mídia vira contrato assinado?": procedência ao vivo, 3 `KpiCard` (mídia, ROAS de contrato no mês, ROAS de contrato da safra; verde a partir de 0,8), barras por mês com a linha de 0,8.
2. "Quando cada safra assinou": tabela única por mês da venda (mídia, vendas, MRR vendido, M0 a M3+, assinado até hoje, % assinado, sem assinatura, os dois ROAS) com linha de total e o seletor MRR / % do MRR vendido / Contratos. O mês leva aos clientes.
3. "Clientes de <mês>": seletor de mês e de situação (Todos, Assinado no mês da venda, Assinado depois, Sem assinatura, com contagem); cliente (abre o deal no Pipedrive), unidade, closer, MRR, ganho, assinatura, dias, situação, fase do contrato (abre o card no Pipefy).

### Estados
Carregando (`Carregando variante="pagina"`); sem vendas no período (`EstadoVazio` "escolha outro período"); nenhum cliente na situação (`EstadoVazio`); erro de leitura (`EstadoErro` com tentar de novo); sem área (o mesmo `SemAcessoArea` da rota).

### Filtros na URL
`de`/`ate` (os do BI; quando `ate` é o último mês do retrato, os meses mais novos da view também entram), `ver` (mrr, pct, n; padrão mrr), `mes` (AAAA-MM; padrão o último do período), `situacao` (todos, fato, depois, sem).

### Permissões e dados
Área `bi_financeiro`, conferida na server fn `carregarRoasAssinaturas`. As views `ops.v_roas_assinaturas` e `ops.v_roas_midia_inside_sales` (migration `20261029120000_roas_assinaturas.sql`) são só do `service_role`. Sem ações: a tela só lê.

### O que NÃO entra
- O "cenário planilha" do artifact (clientes que a planilha de acompanhamento diz assinados e o Pipefy não tem data): é premissa à mão; o caminho é preencher a data no card do Pipefy, e o cliente passa a contar sozinho.
- As colunas de divergência com a planilha de acompanhamento (abas JULHO e AGOSTO): foto de um dia, não fonte viva.
- Contratos com `origem_pipeline = inside_sales` cujo deal está em outro pipeline (ex.: deal 70606): ficam fora, como na planilha validada.
- Venda de sócio (pipe Sócios): não é mídia do Inside Sales.

## 6. O que muda nas telas que já existem
- `/financeiro-semanal`: só troca de área. Nenhum número muda.
- `/dre-caixa`: perde a barra de abas (a lateral assume); Mídia vira parte de Mídia × CAC; DRE × Caixa ganha o bloco "deveria × recebeu × ficou para trás" por receita (royalties, CSC, CAC, reembolso de mídia) da aba Competência × Caixa. O título da página passa a seguir o item da lateral (N1).

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | leitura em curso | `Carregando variante="pagina"` |
| Vazio (sem retrato) | `ops.dre_caixa` sem linha | `EstadoVazio` "o retrato ainda não foi gerado" |
| Retrato velho | `gerado_em` com mais de 26 h | faixa de aviso no topo com a data do retrato; os números aparecem, marcados como de dd/mm |
| Mês parcial | mês corrente | selo "parcial até dd/mm" em todos os cartões |
| Sem forecast para o mês | mês fora da aba Forecast Oficial | cartão com `—` no previsto, nunca 0 |
| Fonte indisponível / erro | falha na leitura | `EstadoErro` com a fonte |
| Sem acesso | sem a área | `SemAcessoArea` "BI Financeiro" |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `aba` | executiva, forecast, geral, dre, aquisicao-retencao, variacao, folego, ponte, caixa, inadimplencia, midia, midia-cac, eficiencia, conferencias, assinaturas | executiva | `/bi-financeiro`, pela lateral |
| `mes` | AAAA-MM | último mês do forecast (o corrente) | Visão executiva |
| `de`, `ate` | AAAA-MM | jan/26 até o último mês fechado | as demais visões |

## Permissões (N8)
- **Área que abre as três rotas:** `bi_financeiro` (nova). As rotas e as server fns passam a checar `bi_financeiro` no lugar de `receita`.
- **Quem recebe na estreia:** exatamente quem tinha `receita` em 19/10/2026 (papéis admin, auditor, diretor, financeiro e head, mais 4 concessões por pessoa), para ninguém perder as duas telas na mudança. O dono não escolheu um recorte menor; enxugar é pela tela de acessos.
- Sem chave `view.*` própria: só leitura, a página herda a área (como os cockpits).
- Migration `supabase/migrations/20261019120000_bi_financeiro_area.sql` (copia as concessões de `receita`), com rollback.

## Ações
Nenhuma. A tela só lê.

## Dados e frescor (pré-requisito para "todo dia")
- Tudo vem de dois retratos: `ops.dre_caixa` (planilha + Omie + apuração, gerado por `tools/dre_caixa_payload.py`) e `ops.saidas_omie` (`tools/saidas_omie.py`, títulos a pagar do Omie da Partners pelo vencimento; até 22/10/2026 esta tela lia `ops.reporte_ceo`).
- O retrato do BI passa a carregar, na chave `bi` (`tools/bi_financeiro_payload.py`, chamado por `dre_caixa_payload.py`), **Forecast Oficial**, **Forecast x Realizado**, **DRE Aquisição**, **DRE Retenção**, **Burn Rate**, **Competência × Caixa** e **CAC Agenda**.
- **Forecast × Realizado é calculado no retrato, não lido da aba.** A aba "Forecast x Realizado" da planilha parou em 02/10: o `forecast_vs_realizado.py` lê os rótulos da DRE anterior a 15/10 e, rodado hoje, zera royalties, CSC, CAC e mídia. O de-para novo está em `bi_financeiro_payload.py` e a soma fecha com o EBIT da DRE em todos os meses.
- **Retrato velho avisa:** com mais de 26 horas, faixa "Desatualizado" no topo de todas as visões.
- **Hoje os dois retratos estão parados:** `ops.dre_caixa` foi gerado em 16/10 às 23h28 e `ops.reporte_ceo` em 13/10 às 12h01. O workflow `bi-financeiro.yml` (07:30, 12:30, 18:30) não roda porque os segredos não estão cadastrados no repositório dos scripts; o reporte das 12h e 18h também parou. Sem isso, a página não é diária. Faz parte desta entrega.

## Riscos
1. **O Forecast Oficial vive só na planilha**, e as premissas mudam à mão. A tela mostra a data em que leu a aba; quem muda o forecast é o Financeiro, na planilha.
2. **O total de receita do Forecast Oficial não soma todas as linhas dele:** CS, RH, Compliance e a taxa de administração do CSC Comercial estão previstos, mas ficam fora de "(+) RECEITAS BRUTAS TOTAIS" (set/26: 558.824 no total, 581.109 somando as linhas). A tela usa o total oficial e avisa nas duas linhas. Confirmar com o Financeiro se é intencional.
3. **Mês corrente não fecha no próprio mês:** a receita das unidades entra pela apuração, que só acontece no mês seguinte. Por isso o mês corrente sempre parece abaixo do plano até virar. O arco e os cartões dizem isso em vez de projetar em linha reta.

## O que NÃO entra, e por quê
- Edição de premissa ou de forecast pela tela: o forecast é da planilha.
- Projeções com premissa digitada (crescimento ao mês, chance de termo virar contrato): ficam na planilha até virarem regra aprovada.
- Ritmo dia a dia como no Growth: a DRE é por mês; o ritmo diário só existe para caixa (Previsibilidade de caixa, dia a dia pelo vencimento).
- Outras empresas do grupo e unidades: a área é da Partners.
- Salário por pessoa.

## Para onde manda (tela dona)
- Repasse que não fechou, não faturou ou não foi pago → `/receita-overview` e `/unidades/royalties` (ficam em Receita e Repasses).
- Comissões e EBIT Operacional → continuam em Receita e Repasses.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte: Forecast × Realizado da tela = aba da planilha no mesmo dia, linha a linha; Burn Rate idem
- [ ] Retrato atualizando sozinho 3 vezes por dia por uma semana antes de anunciar ao CEO
