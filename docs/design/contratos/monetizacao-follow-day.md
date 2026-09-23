# Contrato · Follow Day (`/monetizacao?aba=follow-day`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **rascunho, aguardando "contrato ok".** Moldura comum: `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "Qual negócio aberto eu destravo hoje?"
- **Público:** o dono do negócio (Matheus, Samira); gestão comercial.
- **Ação que provoca:** abrir o negócio no Pipedrive e marcar a próxima atividade com data.
- **Métrica de sucesso:** "Atividade vencida" e "Sem próximo passo" chegam a zero no fim do dia.
- **Arquétipo:** **Fila de trabalho**.
- **Universo (`descricao`):** "Negócios abertos do pipeline 39 · dono atual: {responsável} · sem movimento há {dias}+ dias · estoque de hoje, não usa período".

## Números
| Número | Definição | Unidade | Fonte | Drill-down | Bate? |
|---|---|---|---|---|---|
| Atividade vencida | abertos do dono com `next_activity` < hoje | negócio | carga do CRM (`next_activity`, `last_activity_date`) | filtra a tabela **[fluxo · aprovar]** (hoje abre o detalhe com período que não vale) | sim |
| Sem próximo passo | abertos do dono sem `next_activity` | negócio | idem | filtra a tabela | sim |
| Sem movimento recente | abertos do dono com último movimento há `dias` ou mais | negócio | último entre criação, última atividade e qualquer evento | filtra a tabela | sim |
| Sem movimento (coluna) | dias desde o último movimento | dias | idem | — | — |

Os três números são a faixa de higiene do arquétipo Fila (contadores clicáveis que filtram a fila), não KPIs de ritmo. **[apresentação]** Passam de `KpiCard` para a mesma faixa de contadores da Fila Cella, e o filtro ativo vai para a URL (`sinal=`).

## A fila (N5)
- Linha: Empresa · Produto / etapa · Sinal (`StatusBadge`: vencida = `perigo`, sem próximo passo = `atencao`, sem movimento = `atencao`) · Sem movimento · **Próxima atividade (data)** · ação.
- **[fluxo · aprovar] F5 · ordem de trabalho.** Hoje ordena só por dias sem movimento. Proposta: vencida primeiro (a mais antiga no topo), depois sem próximo passo, depois sem movimento; dentro de cada grupo, mais dias primeiro. O primeiro item é o próximo a trabalhar.
- **[fluxo · aprovar] F5 · ação na linha.** Hoje a ação é o nome da empresa, que abre o Pipedrive. Proposta: botão explícito "Abrir no Pipedrive" no fim da linha (`outline`, ícone `Briefcase`) e o clique na linha abre o detalhe do negócio (histórico e receita), sem trocar de rota. O Brain não escreve atividade no Pipedrive: a próxima atividade continua sendo marcada lá.

## Zeros (N4)
- "0 dias" quando a data mais recente é futura: continua (é piso, não ausência).
- Próxima atividade nula já mostra "A preencher".

## Filtros na URL
`responsavel`, `produto`, `dias` (padrão 7), `sinal` (vencida, sem_passo, sem_movimento). A barra **não** mostra De/Até.

## Estados
Vazio com a régua: `EstadoVazio` "Nenhum negócio fora da régua de {dias} dias. {n} abertos no total." Demais: moldura.

## O que NÃO entra
- Registrar toque ou atividade no Brain: a fila de toques por conta é a Fila Cella; aqui o registro é no Pipedrive.
- Negócios em dia (saem da lista de propósito; o total aparece no vazio).

## Para onde manda
Pipedrive (a ação). Ritmo do período → Operação diária.

## Conflito (PRODUCT §5.2)
Mesma pessoa, dois lugares para "com quem eu falo hoje": este (por negócio) e a Fila Cella (por conta, só Cella). O contrato não funde; declara.
