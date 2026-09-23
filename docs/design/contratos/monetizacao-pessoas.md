# Contrato · Pessoas e PDI (`/monetizacao?aba=pessoas`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **rascunho, aguardando "contrato ok".** Moldura comum: `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "Como o hunter está nos cinco critérios, e qual é o próximo passo de desenvolvimento dele?"
- **Público:** Pedro (gestor do hunter).
- **Ação que provoca:** registrar a avaliação de uma amostra de trabalho e um PDI com ação e prazo; marcar concluído.
- **Métrica de sucesso:** todo hunter com PDI em andamento e prazo; nenhum PDI vencido sem conclusão.
- **Arquétipo:** **Ficha** (uma pessoa: avaliação + histórico de PDI). Hoje é formulário + lista solta.
- **Universo (`descricao`):** "Avaliação de {responsável} · amostra do período {de}–{até} · 5 critérios, nota 1–5".

## Números
| Número | Definição | Unidade | Drill-down | Bate? |
|---|---|---|---|---|
| Média da amostra | média das notas > 0 dos 5 critérios do formulário em edição; "—" sem nota | nota 1–5 | — | — |
| Nota por critério (lista) | nota salva; 0 = "Não avaliado" (já correto) | nota | — | — |

Não há KPI de volume. Não entra nenhum.

## Ações
| Ação | Quem | Confirmação | Retorno |
|---|---|---|---|
| **Salvar avaliação e PDI** (`default`) | `view.monetizacao` + escopo geral; exige responsável escolhido (não "Toda a frente"), título, amostra, objetivo, ação, prazo e ≥1 nota | — | toast; formulário limpo |
| Marcar concluído | idem | — | toast |
| Arquivar | idem | **[apresentação]** `AlertDialog` | toast |

- **[apresentação]** Cada motivo de botão desabilitado aparece no campo que falta (hoje o botão só fica cinza).
- **[apresentação]** A lista mostra de quem é o PDI e o período avaliado (hoje `owner_id`, `from` e `to` são salvos e não aparecem) e esconde arquivados por padrão (`arquivados=mostrar` na URL).

## O que NÃO entra
Avaliação de desempenho e PDI da empresa (Planning People, `/gente?tela=pdi`). Análise de IA de reunião (DECISIONS 15/09, item 8: são registros operacionais).

## Conflito (PRODUCT §5.7) — decisão do Pedro
PDI mora em três casas: aqui (`ops.monetizacao_registros`, `kind='pdi'`, pessoa = id do Pipedrive), `/gente?tela=pdi` (`gente_pdi*`, com `view/manage.gente.pdi`) e Growth `/pdi`. As bases não se ligam. Opções:
1. **Migrar como está** e declarar a fronteira na `descricao` ("PDI comercial do hunter; o PDI de carreira está em Planning People"). *Recomendada para esta rodada: não muda dado nem permissão.*
2. Tirar a visão do menu e mandar para `/gente?tela=pdi` (exige migrar os registros e mexer em `areas.ts`, que é do Eliezek).
