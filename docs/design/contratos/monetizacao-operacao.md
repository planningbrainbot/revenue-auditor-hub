# Contrato · Operação diária (`/monetizacao`, `?aba=operacao`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **rascunho, aguardando "contrato ok".** Moldura comum (cabeçalho, filtros, estados, detalhe): `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "O ritmo de hoje leva à meta do mês?"
- **Público:** Matheus e Samira (hunters), gestão comercial na daily.
- **Ação que provoca:** ver onde o funil do período parou (trabalhado → reunião → validada → ganho) e abrir os negócios do degrau que travou.
- **Métrica de sucesso:** a daily lê o ritmo contra a meta sem planilha; plano de set/26: 120 leads, 60 reuniões, 8 contratos, 7 leads/dia útil (DECISIONS 15/09).
- **Arquétipo:** **Lista/Relatório** (resumo do recorte + gráfico + tabela por produto). Não é Fila: não há próxima ação por linha. A fila de negócios abertos é o Follow Day.
- **Universo (`descricao`):** "Negócios do pipeline 39 · {responsável} · {de} a {até} · contagem por negócio, pelo autor do movimento".

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Drill-down | Bate? |
|---|---|---|---|---|---|
| Leads trabalhados | negócios com `started` no período feito pelo responsável; meta = `plano.capacity` | negócio | carga do CRM; plano do mês de `ate` | detalhe com os negócios | sim |
| Reuniões realizadas | negócios com `meeting` no período | negócio | idem | detalhe | sim |
| Oportunidades validadas | negócios com `validated` no período | negócio | idem | detalhe | sim |
| Reunião → oportunidade | validadas depois de uma reunião do período ÷ reuniões do período; "—" sem reunião | % | idem | detalhe das convertidas | sim |
| Contratos ganhos | negócios com `signed` no período; meta = `plano.target_contracts` | negócio | idem | detalhe | sim |
| Funil agora · {n} abertos, e por etapa | negócios abertos cujo **dono atual** é o responsável, por etapa; **ignora o período** | negócio | carga do CRM | detalhe da etapa, marcado "abertos hoje" | sim |
| Dia a dia (gráfico) | por dia: trabalhados, marcadas, realizadas; linha marcadas ÷ trabalhados; tracejado "Meta {n}/dia" | negócio/dia, % | idem | — (barra não abre) | — |
| Por produto (tabela 4 × 6) | Fila carregada, Leads trabalhados, Reuniões marcadas, Reuniões realizadas, Oportunidades validadas, Contratos ganhos por produto | negócio | idem | cada célula abre o detalhe | sim |
| Critérios (rodapé) | cards sem produto · sem organização · históricos indisponíveis, sobre **toda** a carga | negócio | idem | — | — |

Meta ao lado do realizado (N13): os dois KPIs com meta usam `KpiCard.meta` (hoje a meta está no texto de apoio). Sem plano do mês/responsável, `meta` some e a nota diz "sem plano para {mês}".

**[apresentação]** Cinco KPIs: a regra de Lista/Relatório pede até 4. Proposta: juntar "Reuniões realizadas" e "Reunião → oportunidade" num cartão (a conversão vira `nota` do de reuniões, como KR1+KR2 da Fila Cella). Ficam 4: Leads trabalhados · Reuniões realizadas (+ conversão) · Oportunidades validadas · Contratos ganhos.

**[apresentação] Gráfico.** Hoje tem dois eixos Y (contagem e %), o que V8 proíbe. Proposta: o gráfico fica com as três séries de contagem e o tracejado de meta; a taxa marcadas ÷ trabalhados sai do gráfico e vai para a legenda como número do período.

**[apresentação] Funil agora** fica numa `Secao` própria com a pergunta "Onde estão os negócios abertos hoje?", e a descrição diz que ignora o período.

## Zeros (N4)
- **[lógica · aprovar] Z2.** Negócio sem histórico lido conta 0 em trabalhados, reuniões e validadas. Hoje são 0 de 178, então nada muda na tela de hoje. Proposta: quando o recorte tiver ≥1 negócio sem histórico, os quatro KPIs de evento ficam `estado="parcial"` com nota "{n} negócios sem histórico lido" e o rodapé vira link para esses negócios.
- Recorte com carga e sem evento: `0` é legítimo e continua `0`.

## Ações
| Ação | Quem | Confirmação | Retorno |
|---|---|---|---|
| Baixar dados (CSV dia a dia) | quem vê | não | download |
| Atualizar | ver moldura | não | toast "Carga pedida" / "Tela relida" |

Ação principal: nenhuma (tela de leitura). Nenhum botão `default`.

## O que NÃO entra
- Lista linha a linha de negócios na página (fica no detalhe e no Follow Day).
- Receita prevista (fica em Temporal e previsão); comparação com a planilha do forecast (fica em Projetado × realizado).
- Contas da base (Produtos e listas).

## Para onde manda
Detalhe → Pipedrive. "Quem está parado?" → Follow Day (link no rodapé da `Secao` Funil agora). Ajustar metas → Capacidade e alocação.
