# Contrato · Capacidade e alocação (`/monetizacao?aba=capacidade`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **aprovado pelas propostas** (Pedro, 24/09: "pode seguir conforme suas propostas"). Moldura comum: `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "A base disponível cobre o que planejamos trabalhar em cada produto neste mês?"
- **Público:** Pedro, gestão comercial.
- **Ação que provoca:** salvar o plano do mês (capacidade, metas, alocação por produto, hipóteses) e, se faltar base, preparar lista em Produtos e listas.
- **Métrica de sucesso:** plano salvo para todo responsável ativo no mês; alocação ≤ capacidade; "Falta de base" zero ou com lista em preparo. Hoje a alocação de set/26 é 0/0/0 (DECISIONS 15/09).
- **Arquétipo:** **Configuração** (edição do plano) com resumo do efeito. É a única escrita das cinco visões de ritmo.
- **Universo (`descricao`):** "Plano de {responsável} para {mês de ate} · base: contas elegíveis por produto · trabalho: negócios do mês".

## Números
| Número | Definição | Unidade | Fonte | Drill-down | Bate? |
|---|---|---|---|---|---|
| Capacidade mensal proposta | `plano.capacity` | leads/mês | `ops.monetizacao_planos` | — | — |
| Alocada entre produtos | soma da alocação; nota: vagas sem alocação ou "Supera a capacidade" | ofertas | idem | — | — |
| Trabalho realizado no mês | `started` do mês, por produto (sem "Sem produto") | negócio | carga do CRM | detalhe **[apresentação]** (hoje não abre) | sim |
| Falta de base na alocação | Σ max(0, alocação − trabalhado − disponível) | conta | plano + Base + CRM | — | — |
| Tabela por produto: Perfil aderente · Disponível · Alocação · Trabalhadas · Base faltante | elegíveis; elegíveis livres no mês; alocação; trabalhadas; falta | conta, ofertas, negócio | Base (`oferta`, `disponibilidade`) + plano + CRM | aderente e disponível → `/clientes?view=produtos&produto=` **[apresentação]**; trabalhadas → detalhe | não, e a tela avisa: a Base conta disponibilidade no dia, esta tela no mês do plano |

- **[apresentação · aprovar o nome]** "Disponível hoje" usa o mês do plano, não hoje: rótulo "Disponível no mês".
- "Trabalho realizado" segue o nome único que for aprovado (ver Projetado × realizado).

## Zeros (N4)
- **[lógica · aprovar] Z5.** Sem plano salvo, os KPIs mostram 120, 0, e "Falta de base" 0, que são o valor padrão do editor e não um plano. Proposta: sem plano salvo, "Capacidade" e "Alocada" ficam `nao-apurado` com nota "plano de {mês} não salvo"; "Falta de base" fica `nao-apurado` (sem alocação não há falta a medir). O editor continua abrindo pré-preenchido com os padrões. Com plano salvo, nada muda.

## Ações
| Ação | Quem | Confirmação | Retorno |
|---|---|---|---|
| Editar plano / Fechar editor | `view.monetizacao` + escopo geral | — | abre o formulário |
| **Salvar plano e hipóteses** (`default`, a ação principal) | idem, conferido na RPC | **[apresentação]** confirmação de efeito quando muda a meta de contratos ou a alocação ("Meta de set/26 passa de 8 para 10 contratos") | toast de sucesso/erro |
| Preparar a base nas carteiras | quem vê | — | abre `/clientes?view=produtos` |

Formulário: rótulo acima, ajuda abaixo, erro no campo ("Alocação 130 supera a capacidade 120") em vez de só desabilitar o botão.

## O que NÃO entra
`executable` e `estimate`, que `capacidade()` calcula e a tela nunca mostrou: continuam fora (mostrar é decisão de produto, não de design).

## Para onde manda
Base → Produtos e listas. Resultado do plano → Operação diária e Projetado × realizado.
