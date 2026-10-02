# Contrato · Handoff Consultoria (`/monetizacao?aba=handoff-consultoria`)

**Dono de produto:** Pedro Luca   **Dono do código:** Victor Eliezek (repo) · Pedro Luca (tela)   **Data:** 02/10/2026

Estado: **em aprovação**. Mockup com dado real: https://claude.ai/artifact/F5kUmqPVvKnkZL6X1CoecQ (medido em 02/10, 10h19).
A moldura comum (cabeçalho, estados, permissões) segue `monetizacao.md`. Os filtros são os desta tela (abaixo).

## Propósito
- **Pergunta (h1):** Quanto a Consultoria deve à Expansão pelos clientes do onboarding?
- **Público:** Pedro (dono), CEO e COO da Expansão, controladoria (quem paga o repasse), Consultoria (Pedro Siqueira).
- **Decisão ou ação que provoca:** pagar o repasse do mês; cobrar o cadastro de quem foi encaminhado e não chegou; cobrar da Consultoria o status do trabalho.
- **Métrica de sucesso:** o dono diz em uma frase quanto repassar no mês e de onde veio o número, sem planilha.
- **Arquétipo:** Visão geral. Lacuna registrada: a tabela "A repassar por mês" é uma lista curta de meses (no máximo 12 linhas), não registro a registro; o registro abre na gaveta.
- **Universo (descrição):** Onboarding Cliente da Expansão (Pipefy 307173656) · período do filtro · cliente = CNPJ distinto.

## Réguas
- **Chave do cliente:** CNPJ do card de onboarding, por esta ordem: conector "Card(s) de Contrato" (CNPJ do contrato ou do negócio do Pipedrive dele), conector "Data Base empresas" (`empresas.pipefy_record_id` → CNPJ), CNPJ do negócio ou da organização no Pipedrive. Medido em 02/10: 159 de 204 clientes com CNPJ; onde duas fontes existem, concordam em 82 de 82.
- **Chegou à Consultoria:** CNPJ (ou a raiz) cadastrado na plataforma da Consultoria (`ops.consultoria_clientes`, sem `ausente_desde`). Mês = dia do cadastro. O cadastro de 26/07 é a carga inicial e aparece marcado (hachurado no gráfico).
- **Encaminhado:** campo "Será Encaminhado Para Consultoria Tributária?" = Sim, na fase de kickoff (existe desde 16/09). Mês = data do kickoff.
- **Trabalhado:** chegou e tem proposta da Consultoria casada por CNPJ, valor a recuperar informado ou receita da PAT depois da chegada. Estado `parcial` enquanto a plataforma não enviar o status do trabalho.
- **Receita da Consultoria:** títulos da PAT (grupo PAT do Financial Brain) com crédito no caixa no dia da chegada ou depois; cliente casado pelo nome do Omie (`omie_contraparte`) → CNPJ.
- **Recuperado (estimado):** créditos tributários faturados pela PAT (categoria "Creditos triburários", `fn_faturamento_mensal`) a partir do mês da chegada ÷ fee (tabela de regras). Substituído pelo valor real quando a plataforma enviar.
- **A repassar à Expansão:** base × percentual da regra vigente (tabela de regras, nunca no código). Base: ver P2.
- **Faixa:** "Faturamento anual" declarado no negócio ganho do Pipedrive; sem ele, o mesmo rótulo no campo "Faturamento" do card de onboarding. A estimativa da DataStone nunca entra.

## Números
| Número | Definição | Unidade | Fonte e régua | Frescor | Drill-down | Bate? |
|---|---|---|---|---|---|---|
| Chegaram | clientes do onboarding na plataforma, cadastro no período | cliente | Pipefy + plataforma | sync de 15 min + hora | lista de clientes | sim |
| Trabalhados | chegaram e têm sinal de trabalho | cliente | plataforma + PAT | idem | lista | sim |
| Recuperado | créditos faturados ÷ fee | R$ | Financial Brain (PAT) | carga diária do Financeiro (`sync_log`) | clientes com crédito | sim |
| Receita Consultoria | recebido pela PAT desde a chegada | R$ | Financial Brain (PAT) | idem | clientes com recebimento | sim |
| A repassar à Expansão | base × regra | R$ | regra em tabela | idem | clientes na base, com "na base?" | sim |
| Funil | No onboarding → Na Consultoria → Trabalhados → Com receita na PAT → Geram repasse; taxa = etapa ÷ a de cima | cliente | as acima | — | lista de cada etapa | só desce |
| Faixa | chegaram ÷ no onboarding, por faixa declarada | cliente | Pipedrive | — | lista da faixa | sim |
| Tabela por mês | chegaram, recebido, fora da regra, base, Expansão, unidade | cliente / R$ | as acima | — | clientes do mês | sim |

## O que pede atenção (até 3)
- Encaminhados (Sim) e não cadastrados na plataforma → lista.
- Clientes sem CNPJ recuperável → lista (o card precisa de conector).
- Plataforma sem status, valor a recuperar e recuperado → o que falta.

## Estados
| Estado | Quando | Mostra |
|---|---|---|
| Carregando | primeira leitura | `Carregando variante="kpis"` |
| Financeiro indisponível | Financial Brain fora ou sem acesso | números de R$ em `indisponivel`, contagens seguem |
| Parcial | plataforma sem status de trabalho | "Trabalhados" com selo parcial |
| Estimado | recuperado vindo do fee | selo "estimado" |
| Sem regra vigente | tabela de regras vazia para o período | "A repassar" em `nao-apurado` |
| Sem acesso | sem `view.monetizacao` | `EstadoSemAcesso` da moldura |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `de`, `ate` | AAAA-MM-DD | 01/07/2026 → hoje | tudo |
| `unidade` | nome da unidade | todas | tudo |
| `grafico` | id do bloco | — | abre a gaveta |

## Permissões (N8)
- Área `monetizacao`, chave `view.monetizacao`. Números em R$ exigem também acesso ao Financeiro no servidor (`getFinanceiroAdmin()`); sem ele, os blocos em R$ ficam `sem-acesso` e as contagens continuam.

## O que NÃO entra, e por quê
- Escrever no Pipefy ou no Pipedrive (a tela só lê).
- Clientes da Consultoria que não vieram do onboarding da Expansão (Caixa de Oportunidade, BPO, carga direta): têm outra régua de repasse.
- Propostas da Consultoria sem CNPJ: não casam com cliente.
- Pagamento do repasse: a tela diz quanto; quem paga é a controladoria.

## Para onde manda
- Card do Pipefy (onboarding) e negócio do Pipedrive na lista da gaveta; Financeiro (`/financeiro`) para o detalhe de faturamento da PAT.

## Perguntas ao dono (02/10)
1. **P1 · Quanto vai à Expansão?** Recomendado: 50% do recebido (a parte da Partners), com a unidade ficando com 20 dos 50 (decisão de 29/09). Alternativa: 20%, só a parte da unidade.
2. **P2 · Base e marco.** Recomendado: recebido em caixa, desde a chegada, sem os clientes que a PAT já faturava antes da chegada. Alternativa: todos desde a chegada.
3. **P3 · Recuperado.** Recomendado: estimar pelo fee de 25% com selo "estimado" até a plataforma enviar o valor real.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (`scripts/monetizacao/conferir-handoff-consultoria`, recontagem independente)
