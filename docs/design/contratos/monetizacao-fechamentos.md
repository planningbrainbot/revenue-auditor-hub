# Contrato · Forecast (`/monetizacao?aba=fechamentos`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 19/10/2026
Estado: **aprovado pelo protótipo**. O Pedro aprovou em 19/10 com "o resto tá top, pode implementar" e pediu uma
troca: o card "Sem sugestão do Jev" saiu e entrou "Fecha no mês". Protótipo:
https://claude.ai/artifact/C2zwdHXMixW8ZdWJd5VfEH. Moldura comum: `monetizacao.md`.

A tela de 14/10 (PRD https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4, slide 4) respondia "quando deve fechar". Ela
não dizia o que fazer hoje. Medido em 19/10: os 14 cards da reta final estavam sem data esperada e sem valor; "Hoje"
mostrava 0; e o Jev pedia 7 ações para o dia, que só apareciam dentro de cada card.

## Propósito
- **Pergunta (N1):** "O que fazer hoje para o mês fechar?" Substitui "O que deve fechar hoje, na semana e no mês?".
- **Público:** Matheus e Heloá (pré-venda), Pedro e Paulo na daily.
- **Ação que provoca:** abrir o card da primeira linha e dar o passo; na daily, preencher data esperada e valor.
- **Métrica de sucesso:** a daily começa pela fila e o "sem data esperada nem valor" cai a cada dia.
- **Arquétipo:** **Fila de trabalho** no topo (números que filtram e a fila agrupada pelo próximo passo) e
  **Visão geral** embaixo (horizontes de fechamento e receita do mês, como já eram).
- **Universo (`descricao`):** abertos da Reunião de proposta em diante, sem o Stand by (a régua de `fechamentos.ts`),
  com o filtro de responsável e produto da barra.

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Fazer hoje | cards do universo com urgência 2 do Jev ("Fazer hoje") | card | `ops.monetizacao_forecast_fila()` × universo | sugestão de hora em hora nos dias úteis; data de cada uma na linha | filtra a fila | sim |
| Nesta semana | urgência 1 ("Fazer nesta semana") | card | idem | idem | filtra a fila | sim |
| Fecha no mês | horizonte "Data já passou", "Hoje", "Até domingo" ou "Até o fim do mês": a data esperada do card; sem ela, a previsão do Jev | card | `forecastDeFechamento` (mesmo conjunto do "Esperado até o fim do mês" da receita) | carga de 5 min + previsão do Jev | filtra a fila | sim |
| Sem data esperada nem valor | sem `expected_close` e sem receita prevista no card | card ("n de N") | carga do pipe 39 | 5 min | filtra a fila | sim |
| Também na Consultoria | a empresa já é cliente da Consultoria, tem contrato ou proposta aberta na plataforma | card | `ops.base_consultoria_bloqueio` sobre `ops.base_conta_sinais` (a régua das ofertas) | sinais da Base | filtra a fila | sim |
| Fila (linhas) | card · etapa · frente · dono · próximo passo do Jev e urgência · por quê (o passo) · última nota do dono · próxima atividade · dias sem atividade · selos | card | idem + `ops.monetizacao_ultima_nota` | idem | link do card no Pipedrive | sim |
| Horizontes e receita | os mesmos de 14/10, abaixo da fila | card / R$ | `fechamentos.ts` | idem | abrem os cards | sim |

- Card sem sugestão do Jev entra no grupo "Sem sugestão", ao fim da fila.
- Selos de linha: "sem data esperada", "sem valor" e "na Consultoria". O motivo do bloqueio vai no `title`.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | leitura da Monetização em curso | `Carregando` da página (já existe) |
| Vazio | nenhum card no universo | `EstadoVazio`: "Nenhum card da Reunião de proposta em diante" |
| Vazio por filtro | o número escolhido tem 0 cards | `EstadoVazio total={universo}` com o nome do filtro |
| Sem a fila do Jev | a função falhou ou não existe | a fila mostra os cards sem passo, e a nota diz "sugestões do Jev indisponíveis" |
| Erro / sem acesso | iguais aos da Monetização | já tratados no painel |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `fila` | `semana`, `mes`, `semdata`, `consultoria` | ausente = `hoje` | qual número filtra a fila |
| `responsavel`, `produto` | os da barra | todos | universo inteiro |

## Permissões (N8)
- Área `view.monetizacao`. A fila respeita o recorte de unidade de `ops.monetizacao_deals_leitura()`.
- Nada é editável: a tela só lê. O passo é decidido na daily e feito no Pipedrive.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Escolher o número que filtra a fila | quem vê a tela | não | fila e título mudam; `?fila=` na URL |
| Abrir o card no Pipedrive | quem vê a tela | não | nova aba |

## O que NÃO entra, e por quê
- Escrever no Pipedrive (data, valor, atividade): a tela aponta, o time faz no card.
- Motivo do Jev em texto próprio: o Jev guarda só o passo e a urgência. O "por quê" é a explicação do passo e a
  última nota do dono, que é o que o Jev leu.
- O card "Sem sugestão do Jev" (protótipo): saiu a pedido do Pedro e virou "Fecha no mês".
- Pipe 40 (base nova): tem Forecast próprio no seletor de base.

## Para onde manda
- Cada linha → o card no Pipedrive.
- Cadência e parados do Agendado para trás → Pré-venda › Hoje.
