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

## Adendo · 01/10/2026 · Régua cumulativa e visão "Hoje"

**Spec aprovada:** `docs/superpowers/specs/2026-10-01-monetizacao-acompanhamento-diario.md` ("pode sim [...] pode fazer", Pedro, 01/10). Mockup aprovado: https://claude.ai/artifact/39RCh3RfopWzvb7KaLVLuJ.

**O que muda na régua.** O funil, "Qual produto avança na base?", o lado a lado e os quadros de meta passam a contar uma coorte, e não eventos:
- **Coorte do período:** cards com o primeiro `started` (saída da Base) no período, feito por quem o filtro mede (o Matheus), no produto do filtro.
- **Nível do card:** a etapa mais adiantada alcançada no período, depois desse `started`. Conta a etapa em que o card ficou 30 minutos ou mais, de onde avançou ou em que terminou. Ganho no período é o topo.
- **Níveis lidos do pipe** por nome e ordem (`data.stages`). Gatilho (encerrada) vale como Conexão; Stand by vale como Levantamento realizado.
- **Etapa:** cards da coorte com nível maior ou igual ao dela. A taxa é a etapa ÷ a de cima. As contagens só descem e validadas nunca passam de realizadas.
- **Fila:** cards que estiveram na Base elegível em algum momento do período, no pipe inteiro.
- **Dias úteis:** segunda a sexta, sem os feriados nacionais (`src/lib/monetizacao/feriados.ts`).

**Números (substituem "Entraram", "Conversão" e "Passagem" da tabela acima):**
| Número | Definição | Unidade | Drill-down | Bate? |
|---|---|---|---|---|
| Funil · Cards | Fila: na Base no período. Demais: coorte com nível ≥ etapa | card | os cards da contagem | sim |
| Funil · Hoje | abertos agora nas etapas do nível, pipe inteiro; não entra na taxa | card | cards parados | bate com o pipe |
| Funil · Taxa | contagem ÷ contagem da linha de cima | % | — | refaz-se de cabeça |
| Leads trabalhados por dia útil | abordados da coorte ÷ dias úteis | card/dia | coorte | sim |
| Levantamentos agendados, realizados, oportunidades validadas, contratos ganhos | coorte com nível ≥ etapa | card | cards | sim |
| Meta de contratos no período | meta do mês × dias úteis do período ÷ dias úteis do mês, arredondada para cima | card | — | — |

**Visão "Hoje"** (primeira seção quando o período inclui hoje). Arquétipo: Visão geral, dentro da aba.
- **Pergunta:** O mês vai chegar a 50% de marcação?
- **Universo:** pipe 39 · o farmer do filtro · produto do filtro · mês corrente até hoje.

| Número | Definição | Unidade | Drill-down |
|---|---|---|---|
| Hoje (dia útil anterior) · abordagens | `started` do dia, sem o usuário "Ops Planning" (23984402) | card | cards do dia |
| Hoje · conexões, levantamentos agendados, reuniões de proposta | entrada na etapa no dia; toque desfeito em menos de 30 min não conta | card | cards do dia |
| Hoje · levantamentos realizados | evento `meeting` do dia, sem toque | card | cards do dia |
| Conexão | Conexão ÷ abordados do mês, alvo 70% | % | coorte com Conexão |
| Levantamento | agendados ÷ Conexão, alvo 72% | % | coorte agendada |
| Marcação | agendados ÷ abordados, meta 50% | % | coorte agendada |
| Faltam para 50% | `max(0, ⌈0,5 × abordados⌉ − agendados)` | levantamento | — |
| Conexão por unidade | n de N abordados no mês, por `monetizacao_deals.unidade_ids`; sem unidade = "Sem unidade" | card | abordados da unidade |
| Base elegível | abertos na Base agora, pipe inteiro, por produto | card | cards |
| Abordagens por dia útil para a meta | `⌈(meta − abordados) ÷ dias úteis restantes, contando hoje⌉`; meta = `capacity` do plano do mês, ou 120 por closer | card/dia | — |

**O que pede atenção** (até 3, caixa com borda, uma linha por item): abordados há 3 dias úteis ou mais sem Conexão (quantos passam de 10) → abre a lista; a Base não cobre a meta → Produtos e listas; "Três produtos ainda não se mede" → por quê.

**Lista de atenção** (Fila de trabalho num `Sheet`): abertos em Abordagem iniciada, do dono atual, que nunca chegaram ao nível da Conexão nas etapas do pipe novo (Conexão ou além, com a regra dos 30 minutos), com o primeiro `started` há 3 dias úteis ou mais. Colunas: empresa (Pipedrive), produto, unidade, sócios da unidade (todos), abordado em, dias úteis. Ordem: dias úteis, do maior para o menor. Filtro "10 ou mais" / "3 a 9" na URL (`atencao`), CSV.

**Estados novos:** sócios sem permissão (`view.unidades_rede` ou `view.rede_headcount`) → "sem acesso aos sócios"; unidade sem sócio → "sem sócio cadastrado"; card sem unidade → "Sem unidade"; meta de abordagens com filtro de produto → o bloco diz que a meta é da frente inteira.

**Não entra:** inferir unidade pelo dono do card; sócio de referência (não existe, decisão de 01/10); medir três produtos no mesmo card (o campo aceita um só).
