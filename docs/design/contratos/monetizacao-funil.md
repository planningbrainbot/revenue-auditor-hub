# Contrato · Funil comercial (`/monetizacao?aba=funil`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **rascunho, aguardando "contrato ok".** Moldura comum: `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "Quantas reuniões marcadas acontecem, e quantas validadas viram contrato?"
- **Público:** gestão comercial, Pedro.
- **Ação que provoca:** abrir a coorte que não converteu (marcadas sem realização, validadas em aberto) e cobrar o dono.
- **Métrica de sucesso:** taxa de realização e de assinatura por coorte lida sem planilha.
- **Arquétipo:** **Lista/Relatório**.
- **Universo (`descricao`):** "Coortes do período {de}–{até} · {responsável} · {produto} · negócio; realização e ganho contam até {até}".

## Números
| Número | Definição | Unidade | Drill-down | Bate? |
|---|---|---|---|---|
| Agendadas no período | negócios com `scheduled` no período | negócio | detalhe | sim |
| Depois realizadas | agendadas com reunião realizada até `ate`; nota: % da coorte ou "Sem amostra" | negócio | detalhe | sim |
| Sem realização · em aberto / · perdidas | agendadas sem realização, por status atual | negócio | detalhe | sim |
| Validadas no período | `validated` no período | negócio | detalhe | sim |
| Ganhos até o fim do período | validadas com ganho até `ate`; nota: % + "coorte ainda pode amadurecer" | negócio | detalhe | sim |
| Ainda em aberto | validadas com status aberto | negócio | detalhe **[apresentação]** (hoje não abre) | sim |
| Conversão por produto (tabela) | reuniões realizadas · validadas · ganhos · abertas da coorte, por produto | negócio | cada célula abre o detalhe **[apresentação]** (hoje nenhuma abre) | sim |

- **N11 · a soma não fecha.** Agendada que foi ganha sem passar por "Reunião realizada" não entra em nenhum dos três cartões de desfecho. **[apresentação]** A nota de "Agendadas" diz "{n} fora dos três desfechos (ganhas sem reunião registrada)" quando n > 0. O cálculo não muda.
- Com produto filtrado, as linhas dos outros produtos saem da tabela (hoje mostram 0 por estarem filtradas).
- **[lógica · aprovar] Z2** (moldura): negócio sem histórico.
- Os dois painéis viram duas `Secao` com a pergunta de cada coorte; cartões em `KpiGrade` de 4 e 3.

## O que NÃO entra
Funil de inbound (Growth `/comercial/*`). Receita (Temporal).

## Para onde manda
Detalhe → Pipedrive.

## Conflito (PRODUCT §5.8)
"Funil comercial" existe também no Growth (inbound). Proposta desta migração: manter o nome e declarar o perímetro na `descricao` ("base instalada, pipeline 39"), sem fundir.
