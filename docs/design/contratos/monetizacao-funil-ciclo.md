# Contrato · Funil e ciclo (`/monetizacao?aba=funil`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca (tela) · Victor Eliezek (casca, `areas.ts`, merge)   **Data:** 28/09/2026
**Estado:** **aprovado** ("contrato ok" do Pedro em 28/09/2026). Na implementação, **substitui** `monetizacao-funil.md` (Funil comercial), que vai para `aposentados/`. A moldura comum (cabeçalho, estados, permissões, `DealDetails`) segue `monetizacao.md`.
Spec: `docs/dev_notes/monetizacao-reestudo-telas/spec.md`. Mockup com dado real de 28/09: https://claude.ai/artifact/J56Uuu2cnKQyaKCTT8uw7F

## Propósito
- **Pergunta que responde (h1):** Onde cada produto perde negócios, e quanto tempo leva para fechar?
- **Público:** Pedro (dono da frente), Matheus Carvalho (farmer), gestão comercial.
- **Decisão ou ação que provoca:**
  - atacar o marco com a pior saída de cada produto (por exemplo, a lista de Finance com 28 perdas "fora de perfil" na Base elegível);
  - destravar os abertos parados há 7 dias ou mais na etapa;
  - revisar o produto que não converte. Atenção: até o Matheus trocar o campo no Pipedrive, o painel de Consultoria mostra o lote de 15/09 que foi trabalhado como Finance (spec §4.2, P6), e a leitura de Consultoria não vale.
- **Métrica de sucesso da tela:** na daily, o Pedro diz em um minuto qual produto perde onde e quantos dias leva da criação à reunião. Nenhuma planilha paralela de funil por produto.
- **Arquétipo:** Lista/Relatório, variante **relatório analítico**. **Lacuna registrada:** o arquétipo prevê um gráfico, e esta tela tem cinco. Proposta de regra nova para `ARQUETIPOS.md`: *"Relatório analítico: PageHeader, filtros, até 4 KpiCard, até 5 Secao com um gráfico cada, títulos-pergunta em ordem de leitura, nenhuma tabela linha a linha na página (a lista vive no detalhe)"*. A hierarquia segue a ordem da leitura do funil: até onde chega → quanto tempo → onde para → por que perde → está melhorando.
- **Universo medido (`descricao`):** "Pipe Monetização (39) · coorte: negócios criados de {de} a {até} · unidade: negócio · os marcos contam até hoje · {produto}".

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Criados na coorte | negócios com `created_at` no período e `produto` do filtro; nota: abertos · perdidos · ganhos | negócio | `monetizacao_deals` (carga) | `measured_at` | lista da coorte | sim |
| Chegaram à reunião realizada | coorte com reunião realizada ou marco posterior ÷ coorte; nota: quantos foram à Negociação sem reunião registrada | %, negócio | idem; Stand by conta como reunião | idem | lista | sim |
| Reunião realizada → ganho | ganhos ÷ chegaram à reunião realizada; nota: validadas ainda abertas | % | idem | idem | lista dos ganhos | sim |
| Da criação ao ganho | mediana de dias entre `created_at` e `won_on` dos ganhos da coorte; `parcial` com menos de 5 ganhos | dias | idem | idem | lista dos ganhos | sim |
| Funil · chegaram (por marco e produto) | tem o marco ou um posterior | negócio | eventos da carga | idem | lista | sim |
| Funil · avançaram / ainda abertos / perdidos neste marco | o marco mais alto é este, por situação atual | negócio | eventos + `status` | idem | lista do segmento | sim |
| Funil · conversão | chegaram(marco) ÷ chegaram(marco anterior) | % | idem | idem | — | — |
| Curva · % que alcançou o marco em N dias | incidência acumulada, com perda (e ganho sem o marco) como risco concorrente; para com menos de 5 negócios em observação | % | eventos + idade | idem | quem alcançou | sim |
| Envelhecimento · dias na etapa | por negócio aberto, dias desde a entrada na etapa atual (`moves`) | dias | carga v6 | idem | o negócio | sim |
| Envelhecimento · miolo e mediana | p25, p50 e p75 das passagens concluídas pela etapa | dias | `moves` | idem | — | — |
| Envelhecimento · "N há 7+ d" | abertos na etapa há 7 dias ou mais | negócio | idem | idem | lista | sim |
| Motivos · perdidos por grupo e produto | `grupoMotivo(lost_reason)` × produto; "Remanejado ou duplicado" fica em linha própria e sai da taxa de perda | negócio | `lost_reason`, `stage_id` | idem | lista, com o texto original | sim |
| Coortes · % da semana no marco | por semana de criação (segunda-feira), chegaram ao marco ÷ criados na semana; marca "amadurecendo" se a semana tem menos de 14 dias | %, negócio | eventos | idem | lista | sim |

- **N11:** "Reunião realizada" aqui conta quem **chegou ao marco** (inclui quem pulou o registro). Na Operação, o mesmo nome conta o **evento no período**. O rótulo desta tela sempre diz "chegaram"; a da Operação diz "por dia útil" ou "entraram". Os números não se somam nem se comparam na mesma tela.
- **Régua de envelhecimento:** o que conta são os **dias na etapa atual**, não "dias sem movimento". Uma ligação feita não tira o negócio da lista: o que importa é o negócio andar no funil. O tooltip mostra também o último movimento e a próxima atividade. Em 28/09: 57 abertos há 7+ dias na etapa, contra 46 pela régua do Follow Day, que continua no menu em stand by (Pedro, 28/09). As duas telas convivem, cada uma com sua régua declarada.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | primeira leitura | `Carregando variante="kpis"` e esqueleto das seções |
| Vazio (sem dado na fonte) | carga nunca rodou | `EstadoVazio` da moldura ("O CRM ainda não concluiu a primeira carga") |
| Vazio por filtro | coorte sem negócio | `EstadoVazio total={n}` ("Nenhum negócio criado neste período para {produto}. {n} no pipe.") |
| Parcial | menos de 5 ganhos na coorte; carga v5 lida (sem `won_at`/`lost_at`) | `KpiCard estado="parcial"` com a nota da amostra; curva interrompida com "menos de 5 em observação" |
| Não apurado | produto sem nenhum negócio que chegou à reunião | a curva mostra só o eixo, com a frase "Nenhum negócio de {produto} chegou a este marco" |
| Fonte indisponível / erro | `sync_error` sem dado em cache | `EstadoErro` com "carga da Monetização" |
| Sem acesso | sem `view.monetizacao` | `EstadoSemAcesso oQueFalta="view.monetizacao"` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `de`, `ate` | `aaaa-mm-dd` | últimos 90 dias até hoje; presets 30 · 90 · 180 dias · mês | quem entra na coorte |
| `produto` | `cella`, `consultoria`, `finance` | todos | tudo: KPIs, painéis, curvas, pontos, matriz, coortes |
| `secao` | `parados` | — | rola até o envelhecimento (atalho para os parados) |
| `origem` | aba antiga | — | mostra o aviso N14 até "Entendi" |

O filtro de produto **escopa** tudo abaixo dele; a cor de cada produto não muda com o filtro.

## Permissões (N8)
- Área que abre a tela: `monetizacao`, chave `view.monetizacao` (moldura).
- Chaves dentro da tela: nenhuma. A tela só lê.
- Quem não tem a chave vê `EstadoSemAcesso`.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Abrir a lista de qualquer número, segmento, ponto ou célula | quem vê | — | `DealDetails` com o recorte no cabeçalho |
| Abrir o negócio no Pipedrive | quem vê | — | nova aba |
| "Ver os N parados há 7+ dias" | quem vê | — | `DealDetails` |

## O que NÃO entra, e por quê
- **Meta e ritmo por dia útil.** São da Operação diária, que responde "estamos no ritmo?".
- **Projetado da planilha e cenários.** São da Previsão.
- **Receita.** Das validadas abertas, 0 têm valor no CRM (spec §14, P4).
- **Box plot ou violino de ciclo, e cumulative flow.** Com 3 ganhos e 32 dias de pipe, não dizem nada (spec §6.3).
- **Registro de atividade ou de toque.** O registro é no Pipedrive.
- **Negócios sem produto em painel próprio.** Entram só no Geral.

## Para onde manda (tela dona)
- Negócio → Pipedrive.
- Ritmo do dia → Operação diária.
- Se o mês fecha → Previsão.
- Qualidade da lista de um produto (as perdas por "fora de perfil" na Base elegível) → Base de clientes › Produtos e listas (`/clientes?view=produtos&produto=`).

## Componentes
`PageHeader`, `BarraFiltros`, `KpiGrade` e `KpiCard`, `Secao`, recharts com os helpers de `grafico.ts` (funil empilhado e curvas em degrau), componentes novos em `components/planning` (`FaixaPontos`, `MatrizBarras`, `MapaCalor`), `COR_PRODUTO`, `DealDetails`, `Procedencia`.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem independente pela Management API, só leitura; valores de 28/09 em `docs/dev_notes/monetizacao-reestudo-telas/medicoes.md` §2.6 e §2.7)
- [ ] Captura clara e escura comparada com a do arquétipo na vitrine (hierarquia e limites, feedback de 23/09 do Cockpit)
