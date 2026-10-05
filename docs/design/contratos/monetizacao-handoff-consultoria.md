# Contrato · Handoff Consultoria (`/monetizacao?aba=handoff-consultoria`)

**Dono de produto:** Pedro Luca   **Dono do código:** Victor Eliezek (repo) · Pedro Luca (tela)   **Data:** 02/10/2026

Estado: **aprovado e publicado em 05/10/2026.** Construído a pedido do dono em 02/10 ("preciso que seja um painel ao vivo no módulo de monetização"); regras confirmadas por ele em 05/10 (abaixo) e gravadas como "confirmada" em `ops.handoff_consultoria_regras`. Mockup com dado real: https://claude.ai/artifact/F5kUmqPVvKnkZL6X1CoecQ.
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
- **Trabalhado:** chegou e tem projeto na plataforma da Consultoria (API desde 05/10: `projetos`, com etapa e datas), proposta casada por CNPJ, valor a recuperar informado ou receita da PAT depois da chegada. O mês do trabalho é o do primeiro sinal (normalmente o primeiro projeto), nunca antes do mês da chegada. Estado `parcial` só se a plataforma não mandar projeto nem crédito de ninguém.
- **Receita da Consultoria:** títulos da PAT (grupo PAT do Financial Brain) recebidos no caixa (`titulo_valor_pago`, líquido de retenções), pela data de crédito, do mês da chegada em diante; cliente casado pelo nome do Omie (`omie_contraparte`) → CNPJ. A régua é por mês, não por dia: o espelho guarda o recebido por CNPJ e mês.
- **Recuperado:** `credito_recuperado` da plataforma (acumulado por cliente; a API só dá a data da última recuperação), somado sobre quem chegou no período, ao lado do `valor_identificado`. Só quando a plataforma não informa, estima-se pelos créditos tributários faturados pela PAT ÷ fee (tabela de regras).
- **A repassar à Expansão:** base × percentual da regra vigente (tabela de regras, nunca no código): 50% à Planning Partners, o resto fica com a PAT. A unidade não recebe sobre cliente do onboarding (só sobre a base retroativa). Base: recebido em caixa pela PAT, do mês da chegada em diante, só do que veio do comercial.
- **Faixa:** "Faturamento anual" declarado no negócio ganho do Pipedrive; sem ele, o mesmo rótulo no campo "Faturamento" do card de onboarding. A estimativa da DataStone nunca entra.

## Números
| Número | Definição | Unidade | Fonte e régua | Frescor | Drill-down | Bate? |
|---|---|---|---|---|---|---|
| Chegaram | clientes do onboarding na plataforma, cadastro no período | cliente | Pipefy + plataforma | sync de 15 min + hora | lista de clientes | sim |
| Trabalhados | chegaram no período e têm projeto, proposta ou receita | cliente | plataforma (projetos) + PAT | sync de hora em hora | lista com a etapa | sim |
| Recuperado | crédito recuperado da plataforma, quem chegou no período | R$ | plataforma da Consultoria | sync de hora em hora | clientes com identificado, recuperado e saldo | sim |
| Receita Consultoria | recebido pela PAT do mês da chegada em diante | R$ | Financial Brain (PAT) | idem | clientes com recebimento | sim |
| A repassar à Expansão | base × regra | R$ | regra em tabela | idem | clientes na base, com "na base?" | sim |
| Funil | No onboarding → Na Consultoria → Trabalhados → Crédito identificado → Crédito recuperado; taxa = etapa ÷ a de cima | cliente | as acima | — | lista de cada etapa · pipe inteiro, não segue o período | só desce |
| Faixa | chegaram ÷ no onboarding, por faixa declarada | cliente | Pipedrive | — | lista da faixa | sim |
| Tabela por mês | chegaram, recebido, fora da regra, base, Expansão, unidade | cliente / R$ | as acima | — | clientes do mês | sim |

## O que pede atenção (até 3)
- Encaminhados (Sim) e não cadastrados na plataforma → lista.
- Clientes sem CNPJ recuperável → lista (o card precisa de conector).
- Plataforma sem projeto nem crédito de ninguém → o que falta (some quando a API manda).

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
| `de`, `ate` | AAAA-MM-DD | 01/07/2026 → hoje | chegadas, meses e dinheiro (o funil é o pipe inteiro) |
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

## Respostas do dono (05/10/2026)
1. **P1:** "50% pra pat. a unidade só recebe sobre base retroativa. Tirando isso não recebe." → 50% à Expansão, unidade 0 no onboarding.
2. **P2:** "sim. só paga a partners o que veio do comercial" → base sem os clientes que a PAT já faturava antes da chegada.
3. **P3:** "ok. Veja se consegue puxar da api do Pedro." → a API passou a mandar projetos e créditos; o recuperado vem dela, e o fee só estima quando ela não informa.

## Fontes técnicas
- Sync: Edge Function `handoff-consultoria-sync` (a cada 30 min, job `handoff-consultoria-sync-30min`), só leitura no Pipefy e no Pipedrive.
- Banco: migration `20261002180000_monetizacao_handoff_consultoria.sql` (duas tabelas espelho, regras, RPC `ops.handoff_consultoria_painel()`).
- A edge function antiga `pipefy-contrato-onboarding-link` não entra: a automação nativa do Pipefy 308120505 já cria o card de onboarding a partir do contrato.

## Checagem
- [x] Definição de pronto de `docs/design/README.md` cumprida (capturas claro, escuro, celular e gaveta com dado real, fora do repositório)
- [x] Números conferidos na fonte (`scripts/monetizacao/conferir-handoff-consultoria.mjs` contra `monetizacao/medicoes/2026-10-02-handoff-consultoria/medir_independente.py`)
