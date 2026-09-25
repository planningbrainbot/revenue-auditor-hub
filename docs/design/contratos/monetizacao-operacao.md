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
| Funil · Conversão | entraram(etapa) ÷ entraram(etapa anterior) | % | idem | idem | — | — |

## Estados
| Estado | Quando | O que mostra |
|---|---|---|
| Carregando | sem dado | `Carregando` (moldura) |
| Não apurado | carga anterior à v4 | "—" na etapa, com nota |
| Sem meta | plano sem meta para o número | quadro sem selo |
| Erro de carga | `sync_error` | `EstadoErro` / `EstadoVazio` da moldura |
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
- Todo número abre a lista dos negócios, com link para o Pipedrive.
