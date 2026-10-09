# Contrato · Distribuição (`/monetizacao?aba=distribuicao`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **aprovado pelas propostas** (Pedro, 24/09: "pode seguir conforme suas propostas"). Moldura comum: `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "A carga está bem dividida entre os responsáveis, ou alguém está sem base?"
- **Público:** Pedro, gestão comercial.
- **Ação que provoca:** registrar a decisão de distribuição do período, com o motivo, e preparar as listas.
- **Métrica de sucesso:** decisão registrada por período; nenhum responsável com capacidade e sem abertos.
- **Arquétipo:** **Lista/Relatório** (tabela por responsável) com registro de decisão.
- **Universo (`descricao`):** "Responsáveis com negócio aberto hoje · {produto} · movimentos de {de} a {até} · negócio".

## Números (por responsável)
| Coluna | Definição | Unidade | Drill-down | Bate? |
|---|---|---|---|---|
| Abertas hoje | abertos cujo dono atual é o responsável; ignora o período | negócio | detalhe "abertas hoje" **[apresentação]** (hoje não abre) | sim |
| Carregadas · Trabalhadas · Validadas | eventos do período feitos pelo responsável | negócio | detalhe **[apresentação]** | sim |
| Capacidade mensal | `plano.capacity` do mês de `ate`; "A definir" sem plano (já correto) | leads/mês | → Capacidade com `responsavel=` | — |

- Linhas: donos **atuais** de algum negócio. Quem fez movimento e não é dono de nada hoje não aparece; a `descricao` diz isso.
- **[apresentação]** Ordem: mais abertas primeiro (hoje é a ordem do id do negócio).
- **[apresentação]** O filtro de responsável da moldura não aparece aqui: a tabela já é por responsável e o ignora.
- **[lógica · aprovar] Z2** (moldura): negócio sem histórico.

## Ações
| Ação | Quem | Confirmação | Retorno |
|---|---|---|---|
| **Registrar decisão** (`default`) | `view.monetizacao` + escopo geral; motivo obrigatório | — | toast; a decisão aparece no histórico |
| Abrir as listas | quem vê | — | `/clientes?view=produtos` |

- Regras de distribuição (5 textos fixos) ficam como texto de apoio da `Secao`.
- **[apresentação]** O histórico mostra a foto da tabela salva com cada decisão (hoje é salva e não aparece).

## O que NÃO entra
Distribuição de oportunidade inbound para unidade (Growth `/comercial/distribuicao`).

## Conflito (PRODUCT §5.8)
Mesmo nome, outro job no Growth ("Para qual unidade essa oportunidade deveria ir?"). Proposta: manter e declarar o perímetro na `descricao`, sem fundir.

## Adendo · 09/10/2026 · Abordagens por dia útil no lugar da capacidade

A capacidade mensal vinha do plano (`plano.capacity`) e levava à tela Capacidade e alocação, que saiu do menu em
09/10/2026 (sem meta por enquanto). A coluna passa a ser **"Abordagens por dia útil no mês"**: negócios de que a pessoa
é dona hoje com a primeira abordagem (`started_at`) no mês corrente, no fuso de São Paulo, ÷ dias úteis do mês
decorridos até hoje, inclusive; uma casa decimal; "—" antes do primeiro dia útil. Não usa o período da barra e não tem
link (`abordagensPorDiaUtil` em `src/lib/monetizacao/model.ts`). A foto salva com a decisão grava
`abordagens_por_dia_util`; as fotos antigas continuam mostrando "Capacidade (plano)".
