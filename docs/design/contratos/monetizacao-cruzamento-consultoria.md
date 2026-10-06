# Contrato · Cruzamento Consultoria (`/monetizacao?aba=cruzamento-consultoria`)

**Dono de produto:** Pedro Luca   **Dono do código:** Victor Eliezek (repo) · Pedro Luca (tela)   **Data:** 06/10/2026

Estado: **pedido do dono em 06/10/2026**: "preciso evidenciar o cruzamento da base com o Pedro. Quero que os números
mencionados pelo Pedro sejam vistos em uma tela dentro de monetização ao vivo. E que seja sexy, didática e dentro da
nossa IV. Preciso auditar isso." Construído e publicado com o "pode publicar" da mesma mensagem. A moldura comum
(cabeçalho, estados, permissões) segue `monetizacao.md`.

## Propósito
- **Pergunta (h1):** Os números que a Consultoria e o CEO deram em 05/10 batem com o que o Brain mede hoje?
- **Público:** Pedro (dono), CEO, Pedro Siqueira (Consultoria), diretoria.
- **Decisão ou ação que provoca:** cobrar a Consultoria onde o número dela diverge, e mostrar ao CEO se a máquina de
  vendas está chegando à Consultoria e sendo trabalhada.
- **Métrica de sucesso:** para cada número dito na call, o dono aponta em um clique a conta do Brain, a fonte e os
  registros, sem planilha.
- **Arquétipo:** Visão geral. Lacuna registrada: a seção "Dito × medido" é uma grade de cartões (um por número dito),
  e a tabela da coorte tem no máximo 5 linhas (meses); registro a registro só na gaveta.
- **Universo (descrição):** plataforma da Consultoria (API do Pedro Siqueira, cópia de hora em hora) · contratos ganhos
  em 2026 (`ops.contratos`) · receita da PAT (Financial Brain).

## Réguas
- **Dito:** citação literal da call de 05/10/2026 com quem falou e o tempo (`monetizacao/transcricoes/2026-10-05-consultoria-siqueira-ceo.md`,
  extraídos conferidos em `monetizacao/extraidos/2026-10-05-consultoria-siqueira-ceo.json`). Depois de 23:08 a
  transcrição não tem marcação de tempo: o cartão diz "depois de 23:08".
- **Medido:** a mesma grandeza contada agora, nos dados que o Brain recebe da plataforma (cliente = CNPJ cadastrado;
  projeto = item de `projetos` da API, com etapa, cadastro, entrega e valor identificado).
- **Comparação:** diferença relativa ≤ 10% = **bate**; ≤ 25% = **perto**; acima = **diverge**. **Outra conta** quando
  o número dito vem de um filtro da tela do Siqueira que a API não reproduz (o cartão diz por quê).
- **Máquina de vendas** (CEO, 05/10, 00:02:35): negócio ganho no pipeline Inside Sales do Pipedrive em 2026
  (`ops.contratos.origem_pipeline = inside_sales`). O pipe Sócios fica fora. CNPJ do negócio pelo contrato, pelo
  documento do Pipefy, pela empresa ou pelo onboarding; o que faltar, pelo negócio ou pela organização do Pipedrive
  (Edge Function `handoff-consultoria-sync`, tabela `ops.handoff_consultoria_negocios`).
- **Na plataforma:** CNPJ do negócio (ou a raiz) cadastrado na plataforma. **Trabalhado:** algum projeto do cliente
  passou de Fila de Processamento e Fluxo de Documentos, ou foi entregue. **Faturou:** a PAT faturou ou recebeu do
  CNPJ do mês do ganho em diante (só com a porta do Financeiro).

## Números
| Número | Dito (quem, quando) | Medido | Drill-down |
|---|---|---|---|
| Oportunidades apresentadas | R$ 760 mi (Siqueira, 00:19:09) | soma do valor identificado dos projetos | projetos com valor |
| Honorário médio | 20% (Siqueira, 00:19:09) | média do % de êxito das propostas que têm % | propostas |
| Entregues por mês | ~22 (Siqueira, depois de 23:08) | projetos com entrega nos últimos 28 dias | projetos entregues |
| Saem por semana | 6 (Siqueira, depois de 23:08) | entregues nos últimos 28 dias ÷ 4 | projetos entregues |
| Entram por semana | 16 (Siqueira, depois de 23:08) | cadastrados nos últimos 28 dias ÷ 4 | projetos cadastrados |
| Em Fluxo de Documentos | 44 (Siqueira, 00:14:41) | projetos abertos na etapa | projetos |
| Diagnóstico entregue com valor | 305 empresas (Siqueira, 00:19:09) | clientes com projeto em Pós-entrega e valor identificado | clientes |
| Lucro real com oportunidade | 361 empresas (Siqueira, depois de 23:08) | clientes de lucro real com valor identificado | clientes |
| Projetos de lucro real | 52% (Siqueira, depois de 23:08) | projetos de clientes de lucro real ÷ projetos | projetos |
| Oportunidade média no lucro real | R$ 1,7 mi (conta de bolso, depois de 23:08) | valor identificado do lucro real ÷ clientes de lucro real com valor | clientes |
| Chegaram em 3 meses | 124 (Siqueira, 00:08:54) | projetos cadastrados de jul a set/26 | projetos |
| Máquina em setembro | 80 (CEO, 00:11:02) | negócios ganhos no Inside Sales em set/26 | negócios |
| Máquina por mês (gráfico) | 30 · 40 · 60 · 85 grupos (CEO, 00:10:45) | ganhos no Inside Sales por mês | negócios do mês |
| Entram × saem por semana (gráfico) | 16 e 6 | cadastros e entregas por semana, 12 semanas | projetos da semana |
| Teste do CEO (coorte) | "pegar no mês passado os clientes que fecharam e ver se isso está sendo feito" (00:08:28) | ganhos → com CNPJ → na plataforma → trabalhados → faturou PAT, por mês, cumulativo | negócios de cada célula |

## O que pede atenção (até 3)
- Divergências: os números ditos que não batem com o medido → lista dos cartões.
- Fila crescendo: entram mais projetos do que saem nas últimas 4 semanas.
- Negócios da máquina sem CNPJ: não dá para saber se chegaram → lista.

## Estados
| Estado | Quando | Mostra |
|---|---|---|
| Carregando | primeira leitura | `Carregando variante="kpis"` |
| Sem acesso | sem `view.monetizacao` ou sem todas as unidades | `EstadoSemAcesso` |
| Financeiro fechado | sem a porta do Financeiro | coluna "faturou" em `sem-acesso`, o resto segue |
| Erro | RPC falhou | `EstadoErro` com a fonte |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `grafico` | id do cartão, da semana, do mês ou da célula | — | abre a gaveta |
| `regime` | real, presumido, simples, sem | todos | a coorte do teste do CEO |

## Permissões (N8)
`view.monetizacao` **e** escopo de todas as unidades (a tela agrega a Consultoria inteira). Valores da PAT exigem
também a porta do Financeiro, como no Handoff Consultoria.
