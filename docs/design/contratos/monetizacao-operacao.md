# Contrato · Operação diária (`/monetizacao?aba=operacao`)

**Dono de produto:** Pedro Luca   **Dono do código:** Victor Eliezek (repo)   **Data:** 24/09/2026

Integração DS v2 (25/09/2026): este contrato (molde do Recon, 24/09) substitui a proposta de 23/09
da branch de migração ("O ritmo de hoje leva à meta do mês?", quatro KPIs e funil do dono atual).
A moldura comum (cabeçalho, filtros, estados, detalhe) segue `monetizacao.md`, sem o seletor de
responsável.

## Propósito
- **Pergunta que responde (h1):** O farmer está no ritmo, e onde a base trava?
- **Público:** Pedro (dono da frente), Matheus Carvalho (farmer).
- **Decisão ou ação que provoca:** acelerar a etapa com a pior conversão; cobrar o ritmo diário de leads.
- **Métrica de sucesso da tela:** a daily começa pelos quadros de meta e pela maior queda do funil, sem abrir o Pipedrive.
- **Arquétipo:** Fila de trabalho (faixa de ritmo) + Visão geral do funil. Lacuna registrada: o Recon junta os dois numa tela única; a regra N6 manda separar. Mantido junto por pedido do dono.
- **Universo medido:** pipe Monetização (39) no Pipedrive · período do filtro · card movido (um por dia).

## Números
| Número | Definição | Unidade | Fonte e régua | Frescor | Drill-down | Bate? |
|---|---|---|---|---|---|---|
| Leads trabalhados por dia útil | saídas da Base elegível no período ÷ dias úteis | card/dia | Pipedrive, movimento do farmer | carga de 5 min | lista dos cards | sim |
| Reuniões marcadas por dia útil | entradas em Reunião agendada ÷ dias úteis | card/dia | idem | idem | idem | sim |
| Reuniões realizadas por dia útil | entradas em Reunião realizada ÷ dias úteis | card/dia | idem | idem | idem | sim |
| Oportunidades validadas | primeiro avanço a Em negociação ou depois | card | idem | idem | idem | sim |
| Contratos ganhos | status ganho no período, pelo farmer | card | idem | idem | idem | sim |
| Funil · Entraram | entrada na etapa no período (`moves`) | card | carga v4 | idem | cards que entraram | sim |
| Funil · Hoje | abertos na etapa agora, sem filtro de data e dono | card | idem | idem | cards parados | bate com o pipe |
| Funil · Conversão | dos que entraram na etapa anterior no período, quantos depois chegaram a esta ou além (28/09: era entraram ÷ entraram, e passava de 100% com etapa pulada) | % | idem | idem | — | ≤ 100% |
| Funil · Perdidos | perdidos no período por quem marcou a perda (`lost_by`, carga v6) | card | idem | idem | lista | sim |
| Cadastro a corrigir | produto do título ≠ campo Caixa · Produto; mesma organização e produto em dois cards (abertos ou do mesmo mês); aberto sem produto. A contagem segue o campo | card | idem | idem | lista, pipe inteiro | — |

## Estados
| Estado | Quando | O que mostra |
|---|---|---|
| Carregando | sem dado | `Carregando` (moldura) |
| Não apurado | carga anterior à v4 | "—" na etapa, com nota |
| Sem meta | plano sem meta para o número | quadro sem selo |
| Carga parada | medição com mais de 30 min, com ou sem `sync_error` (28/09) | `EstadoErro` da moldura com o porquê |
| Falha isolada | `sync_error` com medição fresca | "· última tentativa falhou" na barra de frescor, sem alarme |
| Sem acesso | sem `view` | `EstadoSemAcesso` + link para Produtos e listas |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `de`, `ate` | AAAA-MM-DD | início do mês, hoje | tudo menos "Hoje" do funil |
| `produto` | consultoria, finance, cella | todos | tudo |

## O que NÃO entra, e por quê
- Seletor de responsável: um farmer só (24/09/2026).
- Segundo eixo no gráfico diário (V8).

## Para onde manda
- Todo número abre a lista dos negócios, com link para o Pipedrive. Negócio perdido ou ganho diz isso na lista, com a data; a etapa vira "estava em".

## Adendo · 30/09/2026 · Funil por produto, lado a lado

**Pedido do dono (30/09):** "transforma isso em um complemento da tabela de avanço por produto. A ideia é ter o mesmo funil que a tabela na dobra de cima, só que comparando produtos lado a lado". E também: "quero saber o que é stand by e o que é perdido mesmo aqui também".

- **Pergunta do bloco:** Em que etapa cada produto trava?
- **Onde:** logo abaixo de "Qual produto avança na base?", que ele complementa: aquela tabela conta movimentos (esforço, reuniões, resultado); este bloco conta etapas do pipe.
- **Arquétipo:** o mesmo Visão geral do funil de cima, em colunas.

**Números:**
| Número | Definição | Régua | Drill-down |
|---|---|---|---|
| Entraram, por etapa e produto | as mesmas etapas, a mesma entrada e a mesma passagem de `funil` (Stand by soma em Reunião realizada), uma coluna por produto (Cella, Finance, Consultoria) e o total | `funil` com `product` de cada coluna, mesmo período e ator | cards que entraram |
| Barra | entrada na etapa ÷ entrada na Base do mesmo produto | — | — |
| Passagem | dos que entraram na etapa de cima, quantos chegaram a esta ou além, com o mesmo cálculo do funil de cima; abaixo de 20% sai marcada | — | — |
| Em Stand by hoje | abertos nas etapas Stand by agora, pipe inteiro (como "Hoje" do funil) | card | cards parados |
| Perdidos no período | perdidos no período por quem marcou a perda, como o funil de cima | card | lista, com o motivo |

**Estados:**
- Com filtro de produto, o bloco não compara nada e diz isso numa linha: o funil de cima já mostra o produto.
- Carga sem `moves`: "—" na etapa, como no funil de cima.

**Cor:** série fixa do DS: Cella `--chart-1`, Finance `--chart-2`, Consultoria `--chart-3`, total `--chart-6`.

**Não entra:**
- Classificar o motivo de perda por categoria. O motivo é texto livre no Pipedrive e a categoria seria inferência; a lista mostra o motivo.
