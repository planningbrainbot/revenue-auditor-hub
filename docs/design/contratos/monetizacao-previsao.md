# Contrato · Previsão (`/monetizacao?aba=previsao`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca (tela) · Victor Eliezek (casca, `areas.ts`, merge)   **Data:** 28/09/2026
**Estado:** **aprovado** ("contrato ok" do Pedro em 28/09/2026). Na implementação, **substitui** `monetizacao-temporal.md`, `monetizacao-forecast.md` e `monetizacao-capacidade.md`, que vão para `aposentados/`. A moldura comum segue `monetizacao.md`.
**Insumo:** o modelo de forecast com cenários vem do chat de Forecast (branch `feat/monetizacao-forecast-v12-20260928`). Este contrato só diz o que a tela lê (spec §12).
Mockup com dado real de 28/09: https://claude.ai/artifact/J56Uuu2cnKQyaKCTT8uw7F

## Propósito
- **Pergunta que responde (h1):** O mês vai bater a meta, e quanto o pipe sustenta nos próximos meses?
- **Público:** Pedro, diretoria, daily comercial.
- **Decisão ou ação que provoca:**
  - salvar o plano do mês seguinte;
  - cobrar data prevista e valor das validadas;
  - mudar a alocação quando um produto descola do projetado.
- **Métrica de sucesso da tela:**
  - plano salvo antes do dia 1º de cada mês;
  - nenhuma validada aberta sem data prevista;
  - a daily lê meta, projetado e realizado sem abrir a planilha.
- **Arquétipo:** Visão geral. O plano do mês é editado num `Sheet` (Configuração), sem trocar de rota.
- **Universo medido (`descricao`):** "Toda a frente · {mês} até {corte} · realizado: movimentos do mês no CRM · meta: plano de {mês} · projetado: {versão} de {data} · unidade: negócio".

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Contratos ganhos (meta) | `signed` no mês, qualquer ator; `meta` = `plan.target_contracts`; nota: esperado até hoje = meta × dias úteis decorridos ÷ dias úteis do mês | negócio | carga + `monetizacao_planos` | `measured_at` | lista dos ganhos | sim |
| Oportunidades validadas (projetado) | `validated` no mês; `meta` = projetado do cenário base | negócio | carga + `monetizacao_forecasts` | idem; `imported_at` do forecast | lista | sim |
| Reuniões realizadas (projetado) | `meeting` no mês (inclui Stand by); `meta` = projetado | negócio | idem | idem | lista | sim |
| Validadas em aberto | abertos com `validated_at`, todos os donos; estado "Sem data: N" enquanto houver validada sem `expected_close` | negócio | carga | idem | lista | sim |
| O que pede atenção (a) | validadas abertas sem `expected_close` ou sem valor | negócio | carga | idem | lista | sim |
| O que pede atenção (b) | a partir do dia 20, plano do mês seguinte ainda **sugerido, não confirmado**; ou alocação somando 0 no mês corrente | — | `monetizacao_planos` × forecast | — | abre o Sheet | — |
| O que pede atenção (c) | forecast importado há mais de 30 dias, ou sem o mês corrente | — | `monetizacao_forecasts.imported_at`, `months` | — | abre "Ver o modelo" | — |
| Contratos por mês · ganhos | `signed` por mês e produto (empilhado, ≤ 3 séries) | negócio | carga | idem | lista do mês | sim |
| Contratos por mês · projetado | cenário base por mês | contrato | forecast | `imported_at` | tooltip com a premissa | — |
| Contratos por mês · faixa | mínimo e máximo dos cenários por mês | contrato | forecast | idem | — | — |
| Contratos por mês · meta | `plan.target_contracts` dos meses com plano (tracejado neutro "Meta") | contrato | plano | — | — | — |
| Desvio por produto (halteres) | realizado × projetado por produto e marco: leads trabalhados, reuniões realizadas, validadas, contratos | negócio | carga + forecast | idem | lista do realizado | sim |
| Plano · perfil aderente, disponível no mês, alocação (no Sheet) | os números de hoje em Capacidade, sem mudança de cálculo | conta, oferta | Base + plano | `catalog_at` | `/clientes?view=produtos&produto=` | não, e a tela avisa: a Base conta a disponibilidade no dia, o plano conta no mês (herdado do contrato de Capacidade) |

- **N13:** meta, projetado e realizado nunca somam, nunca dividem a mesma barra e nunca usam o mesmo rótulo. O projetado sempre diz a versão e a data ("Projetado v12 de dd/mm"). O "esperado até hoje" é conta de proporção sobre a meta, não previsão.
- **P3 · a meta vem do modelo sugerida e de uma pessoa confirmada** (Pedro, 28/09, opção C). Plano salvo em `monetizacao_planos` é meta confirmada. Sem plano salvo, a sugestão é calculada na hora a partir do cenário base do forecast, sem gravar nada:
  - `target_contracts` = contratos do cenário base no mês;
  - `capacity` = leads trabalhados do mês;
  - `daily_target` = leads trabalhados do mês ÷ dias úteis do mês, arredondado;
  - `allocation` = leads trabalhados por produto;
  - `rates` = premissa de validada → contrato por produto, se o modelo trouxer;
  - `meetings_capacity` fica a do último plano salvo.

  A sugestão vale como meta na Operação e na Previsão, sempre com o selo "sugerida", até alguém confirmar. Com a v10, a sugestão de out/26 seria 16 contratos, 240 leads (11 por dia útil) e alocação de 15, 151 e 73 leads (Cella, Consultoria e Finance), porque a v10 supõe 2 closers. O selo existe para essa diferença ser vista antes de virar cobrança.
- **N11:** "Leads trabalhados" é o evento `started` com qualquer ator no mês. É a mesma régua da antiga Projetado × realizado, e não a da Operação (só o Matheus). A `descricao` diz "toda a frente".

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | primeira leitura | `Carregando variante="kpis"` |
| Sem forecast importado | `monetizacao_forecasts` vazio | cards de validadas e reuniões sem `meta`, com a nota "sem projetado importado"; gráfico só com ganhos e meta |
| Forecast sem cenários (v10) | versão sem `cenarios[]` | linha do projetado sem faixa; legenda diz "cenários não importados" |
| Plano sugerido, não confirmado | `monetizacao_planos` sem o mês, com forecast que cobre o mês | "Contratos ganhos" com a `meta` do cenário base e o selo "sugerida"; item (b) em "O que pede atenção" |
| Sem plano e sem forecast do mês | nem plano salvo nem mês na planilha | "Contratos ganhos" sem `meta`, com a nota "plano de {mês} não salvo" |
| Validadas sem data | alguma validada aberta sem `expected_close` | card "Validadas em aberto" com o estado "Sem data: N" (nunca 0 disfarçado) |
| Mês futuro | `mes` > mês corrente | realizado "—" (futuro não é zero) |
| Fonte indisponível / erro | `sync_error` sem cache | `EstadoErro` da moldura |
| Sem acesso | sem `view.monetizacao` | `EstadoSemAcesso` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `mes` | `aaaa-mm` | mês corrente | KPIs, atenção, halteres; destaca o mês no gráfico |
| `plano` | `1` | — | abre o Sheet do plano (destino do link antigo de Capacidade) |
| `origem` | aba antiga | — | aviso N14 |

Sem filtro de produto nem de responsável: a comparação é da frente inteira, de propósito (como em Projetado × realizado).

## Permissões (N8)
- Área: `monetizacao`, chave `view.monetizacao`.
- Editar o plano: `view.monetizacao` **e** escopo de todas as unidades, conferidos de novo na RPC `monetizacao_save_plan` (sem mudança).
- Sem escopo geral, "Salvar plano" fica desabilitado com o motivo no tooltip ("Exige acesso a todas as unidades (escopo geral).").

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Abrir o plano do mês (`Sheet`) | quem vê | — | formulário com o plano salvo do mês; sem plano salvo, pré-preenchido com a **sugestão do cenário base** (regra P3 abaixo), com o selo "sugerido pelo modelo {versão}, não confirmado" |
| **Confirmar plano** (`default`; "Salvar plano" quando já existe plano salvo) | `view.monetizacao` + escopo geral | confirmação de efeito quando muda meta ou alocação ("Meta de out/26 passa de 8 para 10 contratos"; na confirmação de uma sugestão: "A meta de out/26 fica 16 contratos, como sugerido pelo modelo v10") | toast; o selo "sugerida" some da Previsão e da Operação; o item (b) some |
| Ver o modelo (`Dialog`) | quem vê | — | grade da planilha (a `forecast-model.tsx` de hoje) e exportar CSV |
| Abrir a planilha no Drive | quem vê | — | link externo (`drive_url`) |

## O que NÃO entra, e por quê
- **Funil e ciclo.** São de Funil e ciclo.
- **Receita prevista em R$ e a tabela por semana de fechamento.** Das 30 validadas abertas, 0 têm valor e 0 têm data prevista em 28/09. A seção volta se o CRM passar a ter esses campos (spec §14, P4).
- **Hipótese de conversão inventada.** Sem cenário importado, não há faixa, e a tela diz isso.
- **Filtro por responsável.** Um farmer só desde 24/09.
- **Redesenho do modelo.** É do chat de Forecast.

## Para onde manda (tela dona)
- Validadas sem data ou sem valor → Pipedrive (pela lista).
- Base insuficiente para o plano → Base de clientes › Produtos e listas.
- Onde o funil perde → Funil e ciclo.
- Ritmo do dia → Operação diária.

## Componentes
`PageHeader`, `KpiGrade` e `KpiCard` com `meta`, caixa "O que pede atenção" (linhas com borda e botão de destino), `Secao`, recharts (`ComposedChart` com `Bar` empilhada, `Line`, `ReferenceLine` e `ReferenceArea`) com os helpers de `grafico.ts`, `Halteres` (novo, em `components/planning`), `Sheet` com o formulário do plano, `Dialog` com `ForecastModel`, `AlertDialog` para a confirmação de efeito, `COR_PRODUTO`, `DealDetails`, `Procedencia`.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem independente; os valores de set/26 até 28/09 estão na spec §6.2)
- [ ] Captura clara e escura comparada com o arquétipo Visão geral da vitrine (até 6 KPIs, até 3 pendências, 1 ou 2 seções)
