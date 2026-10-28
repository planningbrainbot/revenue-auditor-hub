# Contrato · Comitês da rede (`/comites`)

**Dono de produto:** dono do Ops (aprovou o PRD em 28/10/2026: "crie uma página no ops que traga as notas e o ppt e qual comitê foi")   **Dono do código:** Ops   **Data:** 28/10/2026

PRD: `wiki/prds/2026-10-ops-comites-da-rede.md` (repo AI Projects).

## Propósito
- **Pergunta que responde (h1):** "Como foi cada comitê, segundo quem participou?"
- **Público:** admin (chave `view.admin.comites`, área Administração).
- **Decisão ou ação que provoca:** ajustar o formato do próximo comitê pelo que os sócios avaliaram; reabrir a apresentação e a gravação de um comitê que passou.
- **Métrica de sucesso da tela:** em uma olhada, o NPS e as três notas de cada comitê lado a lado, e em um clique a apresentação daquele comitê.
- **Arquétipo:** Lista/Relatório, com Ficha do comitê (detalhe em `?comite=`).
- **Universo medido (descricao do PageHeader):** respostas da pesquisa de satisfação anônima, uma por envio, separadas pelo código do comitê.

## Números
| Número (rótulo exato) | Definição | Unidade de contagem | Fonte e régua | Frescor | Drill-down (destino) | O destino bate? |
|---|---|---|---|---|---|---|
| Respostas | envios da pesquisa com o código do comitê | resposta | `ops.pesquisa_satisfacao_comite_socios.comite_codigo` | tempo real | ficha do comitê | sim |
| NPS / NPS do comitê | % notas 9 e 10 menos % notas 0 a 6, de -100 a 100 | ponto | idem, `nps_recomendaria` | tempo real | ficha (promotores, neutros, detratores) | sim |
| Clareza / Resultados ficaram claros | média de `clareza_resultados`, 1 a 5, uma casa | nota | idem | tempo real | ficha | sim |
| Utilidade / Útil para o dia a dia | média de `utilidade_novidades` | nota | idem | tempo real | ficha | sim |
| Próximos passos / Saiu sabendo o que fazer | média de `clareza_proximos_passos` | nota | idem | tempo real | ficha | sim |
| Frente que a matriz deveria priorizar | votos por `frente_prioritaria` | voto | idem | tempo real | nenhum | sim |

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | chamada em curso | `Carregando variante="pagina"` |
| Vazio (sem dado na fonte) | nenhum comitê cadastrado | `EstadoVazio` com o botão Novo comitê no cabeçalho |
| Comitê sem resposta | pesquisa aberta e ninguém respondeu | `EstadoVazio` na seção de notas |
| Erro | falha ao ler as tabelas | `EstadoErro` com o nome da tabela |
| Sem acesso | sem `view.admin.comites` | `EstadoSemAcesso oQueFalta="view.admin.comites"` |

## Filtros na URL (N7)
- `?comite=<uuid>` abre a ficha do comitê.
