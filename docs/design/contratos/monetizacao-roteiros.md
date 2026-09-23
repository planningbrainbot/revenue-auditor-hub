# Contrato · Abordagens (`/monetizacao?aba=roteiros`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **rascunho, aguardando "contrato ok".** Moldura comum: `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "O que eu digo para este produto e este segmento?"
- **Público:** hunters; Pedro aprova.
- **Ação que provoca:** montar uma abordagem a partir do modelo, salvar como rascunho e aprovar.
- **Métrica de sucesso:** abordagem aprovada para cada produto × segmento prioritário.
- **Arquétipo:** **Lista/Relatório** (biblioteca) com edição em `Sheet`. Não é Fila.
- **Universo (`descricao`):** "Biblioteca de abordagens da equipe · {n} salvas, {k} aprovadas". Hoje há 4 registros, todos `roteiro`.

## Números
Nenhum KPI. A contagem da `descricao` é a única (abordagem, `ops.monetizacao_registros kind='roteiro'`).

## Mudanças de apresentação
- A barra de filtros da moldura (período, responsável, produto) **não aparece** aqui: a tela não usa nenhum deles.
- A lista vira `Table` com Produto (hoje salvo e não exibido), Segmento, Título, Situação (`StatusBadge`: rascunho = `info`, aprovada = `sucesso`), Atualizada em. Filtros próprios na URL: `produto`, `situacao`.
- "Nova abordagem" (`default`) abre o formulário num `Sheet`; hoje o formulário ocupa metade da tela o tempo todo.
- Linha abre a abordagem no mesmo `Sheet`, com "Copiar texto", "Aprovar" e "Arquivar" (`AlertDialog`).

## Ações
| Ação | Quem | Confirmação | Retorno |
|---|---|---|---|
| Montar a partir do modelo | quem vê | — | preenche o texto |
| Salvar abordagem | `view.monetizacao` + escopo geral | — | toast; formulário limpo (hoje não limpa) |
| Copiar texto | quem vê | — | toast "Copiado" |
| Aprovar abordagem · Arquivar | `view.monetizacao` + escopo geral | Arquivar: `AlertDialog` | toast |

Editar uma abordagem salva não existe hoje (a versão nunca sobe). Não entra: é funcionalidade nova.

## O que NÃO entra
Envio ao cliente ("Nada é enviado automaticamente", texto atual, fica). Roteiros do Growth (`/roteiros`).

## Para onde manda
Nenhum destino de negócio. Uso da abordagem: Fila Cella (toque) e Pipedrive.
