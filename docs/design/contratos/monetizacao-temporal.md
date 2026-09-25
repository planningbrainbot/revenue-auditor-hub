# Contrato · Temporal e previsão (`/monetizacao?aba=temporal`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **aprovado pelas propostas** (Pedro, 24/09: "pode seguir conforme suas propostas"). Moldura comum: `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "Quando as oportunidades abertas devem virar contrato, e quanto valem?"
- **Público:** gestão comercial, diretoria.
- **Ação que provoca:** conferir com o dono as datas previstas vencidas e as receitas a preencher.
- **Métrica de sucesso:** zero oportunidade com data prevista vencida; receita prevista preenchida em todas as validadas.
- **Arquétipo:** **Lista/Relatório**.
- **Universo (`descricao`):** "Oportunidades validadas em aberto · dono atual: {responsável} · {produto} · estoque de hoje; ciclo e cenário no período {de}–{até} · receita declarada no CRM, não é MRR nem caixa".

## Números
| Número | Definição | Unidade | Fonte e régua | Drill-down | Bate? |
|---|---|---|---|---|---|
| Validadas em aberto | abertos com `validated_at`; ignora o período | negócio | carga do CRM | detalhe "abertas hoje" | sim |
| Ciclo mediano até assinatura | mediana de dias entre `started_at` e `won_on` dos ganhos do período | dias | idem | — | — |
| 90% das assinaturas até | p90 do mesmo conjunto | dias | idem | — | — |
| Data prevista vencida | validadas em aberto com `expected_close` < hoje | negócio | idem | detalhe | sim |
| Receita prevista · total conciliado | soma do total dos negócios com split ok/calculado e moeda BRL; "A preencher" se nenhum | R$ | campos de receita do CRM | detalhe **[apresentação]** (hoje não abre) | sim |
| Receita prevista · Partners / · unidades | mesmas linhas, partes do split | R$ | idem | idem | sim |
| Tabela semanal: Oportunidades · Receita conciliada · Pendências | por semana de `expected_close` ("Sem data" no fim) | negócio, R$ | idem | contagem abre o detalhe | sim |
| Por produto: validadas com data no período · cenário | cenário = validadas com data × hipótese de conversão do plano | negócio, contratos estimados | plano (`rates`) | "Conferir oportunidades" | sim |

**[apresentação]** Sete KPIs viram quatro: Validadas em aberto (nota: "{n} com data vencida", clicável) · Ciclo mediano (nota: "p90 {n} dias · {n} ganhos") · Receita prevista conciliada (nota: "Partners R$ x · unidades R$ y · {k} de {n} com split") · Data prevista vencida.

**N13.** O "cenário" é hipótese × volume, nunca previsão: o rótulo continua "Cenário (hipótese {r}%)", ao lado da "Meta mensal {n}", sem somar os dois. Sem hipótese: "Sem hipótese configurada" (já é assim).

## Zeros e somas parciais (N4)
- **[lógica · aprovar] Z3.** A receita mostra soma parcial sempre que ≥1 negócio tem split completo, e só o card de total diz "de N". Proposta: com `known < n`, os três valores ficam `estado="parcial"` com nota "{k} de {n} com split completo · {n−k} a preencher (abrir)". Com `known = 0`, `nao-apurado`.
- **[lógica · aprovar] Z2** (moldura): negócio sem histórico some de "Validadas em aberto" e do ciclo sem aviso; mesma proposta da Operação.
- Nota: com status `calculated` e total nulo, o total é Partners + unidade. O rótulo "total conciliado" continua; a `procedencia` diz "total = split quando o CRM não traz o total".

## O que NÃO entra
MRR, faturamento, caixa (moram em Receita e Repasses e no Financeiro). Comparação com a planilha do forecast (Projetado × realizado).

## Para onde manda
Detalhe → Pipedrive (conferir data e receita). Hipóteses → Capacidade e alocação.
