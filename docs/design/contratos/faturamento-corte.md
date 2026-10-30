# Contrato · Faturamento › Lista do corte (`/faturamento/corte`)

**Dono de produto:** Pedro Luca   **Operação:** tesouraria (Ana Paula Aguiar, Ludmilla Marcelino), Ana Carvalhais (controladoria)   **Dono do código:** Pedro Luca; merge do Eliezek   **Data:** 29/10/2026

**Estado:** aprovado pelo Pedro em 29/10/2026 ("Contrato ok"). Moldura comum: `faturamento.md` §1. Par desta tela: `faturamento-contratos.md`.

## Propósito
- **Pergunta (`<h1>`):** "Quais contratos eu faturo neste corte, e com qual valor?"
- **Público:** tesouraria (`fat_tesouraria`). A controladoria vê a mesma tela, com as diferenças depois do corte.
- **Decisão ou ação que provoca:** a tesouraria fatura no Omie só o que está na lista, com o valor da lista, e aplica no contrato do Omie o que o dono respondeu (decisão 4 de 29/10: no primeiro ciclo, quem fatura é a tesouraria, não o Brain). Depois do corte, o portal lê as notas e mostra o que faltou ou saiu diferente.
- **Métrica de sucesso:** nota de contrato que sai sem estar na lista, ou com valor diferente do da lista, é zero; o que sobrar vira diferença com nome e motivo, no mesmo dia.
- **Arquétipo:** Fila de trabalho.
- **Universo (`descricao`):** "Contratos recorrentes com faturamento em {13/11} · {todas as empresas do seu recorte} · contrato".

## Como o corte funciona (novembro de 2026)
- **Dia do corte** = o dia de faturamento do contrato no Omie ou, quando cai em fim de semana ou feriado nacional, o dia útil anterior. Em novembro: 13/11 (contratos do dia 15, que é domingo e feriado), 17/11, 18/11, 19/11 (os dias 20, 21 e 22) e depois.
- **A lista do dia fecha às 23:59 do dia útil anterior.** Até lá ela muda conforme os donos respondem e mostra "Lista aberta: os donos respondem até 12/11 23:59".
- Os contratos de 1 a 10/11 saem pela automação do Omie, que só é desligada em 11/11. Não entram na lista.

## Anatomia (ordem fixa)
1. `PageHeader`: pergunta, universo, `procedencia` ("Respostas dos donos até 12/11 23:59 · notas do Omie lidas às 12:00").
2. **Dia do corte e empresa:** fichas com o dia e a contagem ("13/11 · 731 · 18/11 · 94"); depois, fichas de empresa ("PAC 275 · PMC 195 · Todas 731"). Os dois na URL.
3. **Ritmo:** três `KpiCard` que filtram a tabela.
4. **Higiene (depois do corte):** três contadores clicáveis.
5. `BarraFiltros`: busca (cliente, CNPJ, contrato), instrução e situação, na URL.
6. **Tabela agrupada por empresa.** Dentro da empresa: primeiro "Não faturar", depois "Faturar com outro valor", as instruções de contrato e, por último, "Faturar como está". Empate: cliente em ordem alfabética, como na tela "Faturar hoje" do Omie.
7. Clique na linha abre `Sheet` com o contrato, a resposta do dono e o histórico.
8. **Baixar a lista da empresa (CSV):** número do contrato, cliente, CNPJ, valor a faturar e instrução, para trabalhar ao lado do Omie.
9. `Procedencia` no rodapé.

### Instrução da linha (o que a tesouraria faz no Omie)
| Instrução | Quando | Palavra na tela |
|---|---|---|
| Faturar como está | Fatura sozinho ou Confirmado | "Faturar como está · R$ 12.000,00" |
| Faturar com outro valor | Valor ajustado, ou Faturar este mês no contrato que sumiu | "Faturar R$ 9.500,00 (contrato: R$ 12.000,00) · motivo do dono" |
| Não faturar | Não fatura este mês, Encerrado, Cliente saiu ou Sem resposta | "Não faturar · {motivo} · {dono}" |
| Atualizar o contrato no Omie | Renovado até, Encerrar o contrato | "Mudar a vigência para 31/10/2027" ou "Encerrar o contrato no Omie" (some quando marcada como feita) |

### Colunas
| Coluna | Conteúdo |
|---|---|
| Cliente | nome; CNPJ abaixo |
| Contrato | número no Omie |
| Valor do contrato | R$ no Omie |
| Faturar | R$ que vai faturar; "—" quando não fatura |
| Instrução | tabela acima |
| Quem respondeu | dono e hora; "Sem mudança" quando faturou sozinho |
| Situação | antes do corte: "Na lista"; depois: Faturado (NF 4321), Falta faturar, Faturado diferente |
| (botão) | "Feito no Omie" nas linhas com instrução de contrato |

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Faturar como está | linhas com essa instrução. Nota: R$ | contrato | `ops.fat_corte` | ao abrir e a cada resposta | filtra | sim |
| Faturar com outro valor | linhas com essa instrução. Nota: R$ | contrato | idem | idem | filtra | sim |
| Não faturar | linhas com essa instrução | contrato | idem | idem | filtra | sim |
| Higiene · Falta faturar | depois do corte: na lista e sem nota do contrato no dia | contrato | idem; notas do Omie (8h, 12h e 16h) | 3 vezes por dia | filtra | sim |
| Higiene · Faturado diferente | nota com valor diferente do da lista | contrato | idem | idem | filtra | sim |
| Higiene · Faturado sem estar na lista | nota de contrato que estava em Não faturar ou fora da lista | contrato | idem | idem | filtra | sim |

## Estados
- **Carregando**, **Erro**: como em `faturamento-tesouraria.md`.
- **Vazio:** "Nenhum contrato fatura em {dia} nas suas empresas."
- **Lista aberta:** faixa `info` "Lista aberta: os donos respondem até {12/11 23:59}. Ela ainda pode mudar."
- **Notas sem leitura:** faixa `atencao` "Notas da {PAC} lidas pela última vez às {08:00}."

## Filtros na URL (N7)
`dia`, `empresa`, `instrucao`, `situacao`, `busca`, `contrato`.

## Permissões (N8)
- Ver e marcar "Feito no Omie": área `faturamento_tesouraria` (`edit.faturamento_tesouraria`). Controladoria e admin veem.
- Sem a área, a rota mostra `EstadoSemAcesso` com a área que falta.

## Ações
Feito no Omie, Baixar a lista (CSV), Abrir no Omie.

## O que NÃO entra, e por quê
- **Faturar pela tela:** a tesouraria fatura no Omie, em "Contratos › Faturar hoje" (decisão 4). Quando o Brain passar a faturar, o botão nasce aqui.
- **Pedido pontual:** segue na Fila da tesouraria (`/faturamento/tesouraria`).

## Para onde manda (tela dona)
Contratos do mês (`/faturamento/contratos?contrato=…`) para ver a resposta do dono; Omie para faturar.

## Checagem
- [ ] Pergunta e universo no `PageHeader`
- [ ] Procedência no topo e no rodapé
- [ ] Todo número com definição, fonte e drill-down
- [ ] Estados desenhados
- [ ] Filtros na URL
- [ ] Botão sem permissão diz o motivo
