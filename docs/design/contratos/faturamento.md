# Contrato · Faturamento › Meu faturamento (`/faturamento`) e Pedidos (`/faturamento/pedidos`)

**Dono de produto:** Pedro Luca   **Operação:** Ana Carvalhais (controladoria), tesouraria, donos da receita das empresas do grupo   **Dono do código:** Pedro Luca (branch `feat/portal-faturamento-f1-20261015`); merge e deploy do Eliezek   **Data:** 20/10/2026

**Estado:** rascunho. Aguarda o "contrato ok" do dono (`PROCESSO.md` §4); nenhum código de tela antes disso.

Fontes: spec `PM Work/execution/portal-faturamento-prd-20261013/spec-portal-faturamento.md` v1.1 (§4, §5, §9, §12, §13.3) e plano `e1/PLANO-E1.md` (Travas, API, T4). Entrega E1, pedido pontual. Contratos irmãos: `faturamento-novo.md`, `faturamento-pedido.md`, `faturamento-tesouraria.md`, `faturamento-configuracao.md`.

---

## 1. Moldura comum da área (vale para as cinco telas da E1)

### 1.1 A área e o menu
Slug `faturamento` (já criado em `ops.areas` pela F1, ordem 35). Nome "Faturamento". Ícone da área: `Receipt` ("Repasse / fatura", `DESIGN.md` §7). `src/lib/areas.ts` é do Eliezek (`PROCESSO.md` §2): a entrada da área é **proposta ao Eliezek**.

| Grupo | Item (= `titulo` do `PageHeader`) | URL | Área da permissão | Ícone | Também acende para |
|---|---|---|---|---|---|
| Visão geral | Meu faturamento | `/faturamento` | `faturamento` | `LayoutDashboard` | — |
| Pedidos | Pedidos | `/faturamento/pedidos` | `faturamento` | `Receipt` | `/faturamento/novo`, `/faturamento/pedido/$id` (`tambem`) |
| Tesouraria | Fila da tesouraria | `/faturamento/tesouraria` | `faturamento_tesouraria` | `ListChecks` | — |
| Controladoria | Configuração | `/faturamento/configuracao` | `faturamento_controladoria` | `ShieldCheck` | — |

"Novo pedido" não é item de menu: é a ação principal (`default`) do cabeçalho de Meu faturamento e de Pedidos. O plano falava em "4 lugares do menu" com Novo pedido entre eles; aqui o quarto lugar é Pedidos, porque a lista saiu da Visão geral (ver §2, "Conflito com a spec").

**Cor da área:** `DESIGN.md` §3.1 não tem `faturamento`. Proposta: o lima de Receita e Repasses (`--area-receita`), que é o domínio dono das tabelas `fat_*`. Token é decisão do Mika; até lá, o eyebrow usa o anel neutro.

### 1.2 Situação do pedido (um rótulo, um tom, em todas as telas)
`StatusBadge` com ícone e palavra (V7). Os estados são os do plano (`PLANO-E1.md`, "Estados do pedido").

| Estado no banco | Palavra na tela | Tom |
|---|---|---|
| `rascunho` | Rascunho | `info` |
| `aguardando_ok` | Aguardando OK | `atencao` |
| `devolvido` | Devolvido | `atencao` |
| `na_fila_omie` | Na fila do Omie | `neutro` |
| `simulado` | Simulado | `info` |
| `erro_omie` | Erro no Omie | `perigo` |
| `os_criada` | OS criada | `info` |
| `em_conferencia` | Em conferência | `info` |
| `faturado` | Faturado | `sucesso` |
| `recebido` | Recebido | `sucesso` |
| `em_atraso` | Em atraso | `perigo` |
| `cancelamento_pedido` | Cancelamento pedido | `atencao` |
| `cancelado` | Cancelado | `neutro` |

### 1.3 Simulação (travas da E1)
- Cada empresa tem o Omie em **simulação** (padrão) ou **gravando**. Em simulação, o pedido percorre o fluxo inteiro, o Omie só é lido, e nada é gravado lá. O mesmo vale para o Pipefy desligado: o card é montado e guardado, não enviado.
- A tela mostra a simulação **no dado**, nunca como alarme fixo (N9): o pedido simulado leva o selo "Simulado" (`info`, não `atencao`), e a `Procedencia` da página diz quais empresas do recorte estão em simulação ("DOC e PIS em simulação: nada é gravado no Omie").
- E-mail desligado por variável: a tela não promete e-mail; a notificação na tela é a caixa "O que pede atenção".

### 1.4 Regras que valem para todas
- Tudo vem de RPC no schema `ops` (`PLANO-E1.md`, "API"). Nenhuma tela lê tabela `receita.*` ou `integracoes.*` direto, e nenhuma soma valores no navegador: total, soma e contagem vêm do servidor.
- Escopo (RF-A02, CA-09): dono e solicitante veem os pedidos em que são dono ou autor; gestor vê os da empresa; tesouraria e controladoria veem as empresas do seu recorte. Quem decide é a RPC; a tela não filtra por papel.
- E-mail e CPF só aparecem para quem tem o pedido no escopo (RNF-06), e quem garante é a RPC.
- Dinheiro em R$ com centavos, `tabular-nums`, à direita (V9). Valor ausente é "—", nunca "R$ 0,00" (N4, V10).
- Datas em `America/Sao_Paulo`. Competência mostrada como "out/2026".
- Nenhuma chave do Omie em tela, nem mascarada.
- `Procedencia` de toda página: "Portal de Faturamento · situação do Omie lida às {hora} (a cada 4 h em dia útil)".

---

## 2. Meu faturamento (`/faturamento`)

### Propósito
- **Pergunta (`<h1>`, N1):** "O que eu pedi já virou nota, e o cliente pagou?"
- **Público:** dono da receita, solicitante (coordenador, CS, analista) e gestor da empresa que fatura. Tesouraria e controladoria também abrem (é o primeiro item da área), e veem o recorte delas.
- **Decisão ou ação que provoca:** ir para a pendência certa: dar o OK, corrigir o devolvido, olhar o erro do Omie, ou fazer um pedido novo. Esta tela não executa nada (N10).
- **Métrica de sucesso:** o dono para de pedir ao financeiro "já faturou?"; o e-mail de "faturamento realizado" deixa de existir (spec §1, métricas).
- **Arquétipo:** Visão geral.
- **Universo (`descricao`):** depende do papel, e a frase diz qual: "Seus pedidos como dono ou solicitante · DOC e PIS · mês de out/2026" · "Todos os pedidos da DOC (você é gestor) · …" · "Todas as empresas do seu recorte (tesouraria) · …". Unidade de contagem em cada número.

### Anatomia (ordem fixa)
1. `PageHeader`: pergunta, universo, `procedencia`, filtros `mes` e `emissora`, ação `default` "Novo pedido".
2. `KpiGrade` com quatro `KpiCard` (abaixo). Nota de cada card com **uma** informação.
3. **O que pede atenção:** caixa com borda, até três linhas, uma por pendência, cada uma com botão de destino, na ordem: erro no Omie, OK a dar, devolvidos (tesouraria: erro no Omie, para faturar). Quem tem os dois papéis vê as três primeiras; "Para faturar" fica na Fila da tesouraria. Sem pendência, a caixa diz "Nada pede sua atenção agora."
4. Uma `Secao` com gráfico: "Em que etapa estão os pedidos em aberto?", barra horizontal por etapa, com "Ver todos os pedidos →".
5. Nenhuma tabela linha a linha (ARQUETIPOS §1, item 5). A lista mora em Pedidos (§3).

### Números
| Número (rótulo exato) | Definição | Unidade de contagem | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| A faturar | soma do valor dos pedidos enviados que ainda não têm nota: Aguardando OK, Na fila do Omie, Erro no Omie, OS criada, Em conferência. Fora: rascunho, devolvido (está com o autor), simulado, cancelado. Nota: "n pedidos" | R$ (valor do pedido) | `ops.fat_pedidos` → `resumo`; situação **agora**, não segue o mês | leitura do Omie | Pedidos `?situacao=a_faturar` | sim |
| Faturado no mês | soma do valor dos pedidos cuja nota foi emitida no mês do filtro (inclui os que depois foram recebidos ou atrasaram). Nota: "n notas" | R$ (valor do pedido) | idem; data de emissão da nota lida do Omie | idem | Pedidos `?regua=nota&mes=AAAA-MM` | sim |
| Recebido no mês | soma das parcelas pagas no mês do filtro. Nota: "n parcelas" | R$ (parcela) | idem; data do pagamento do título no Omie | idem | Pedidos `?regua=pagamento&mes=AAAA-MM`, coluna "Pago no mês" | sim, pelo total da coluna "Pago no mês" |
| Em atraso | soma das parcelas vencidas e não pagas, hoje, de qualquer competência. Nota: "n parcelas" | R$ (parcela) | idem; situação **agora**, não segue o mês | idem | Pedidos `?situacao=em_atraso`, coluna "Em atraso" | sim, pelo total da coluna "Em atraso" |
| Pendência · OK a dar | pedidos Aguardando OK em que eu sou o dono ou o substituto dele; para o gestor, também os da empresa que esperam há 2 dias úteis ou mais (proposta; a decidir pela Ana) | pedido | `ops.fat_contexto` → `pendencias` | ao abrir | Pedidos `?pendencia=ok` | sim |
| Pendência · Devolvidos para corrigir | pedidos devolvidos em que eu sou o autor | pedido | idem | ao abrir | Pedidos `?pendencia=devolvido` | sim |
| Pendência · Erro no Omie | pedidos em Erro no Omie em que eu sou autor ou dono; para a tesouraria, todos do recorte | pedido | idem (ver lacuna 2) | ao abrir | Pedidos `?pendencia=erro` (tesouraria: Fila da tesouraria `?higiene=erro`) | sim |
| Pendência · Para faturar (só tesouraria) | pedidos OS criada ou Em conferência no recorte | pedido | idem | ao abrir | Fila da tesouraria | sim |
| Etapas (gráfico) | pedidos em aberto agora, por etapa: Aguardando OK, Devolvido, Na fila do Omie, Simulado, Erro no Omie, OS criada, Em conferência | pedido | `ops.fat_pedidos` → `resumo.por_situacao` | ao abrir | cada barra: Pedidos `?situacao=<etapa>` | sim |

Leitura dos quatro cards: dois são **estoque de agora** (A faturar, Em atraso) e dois são **fluxo do mês** (Faturado no mês, Recebido no mês). O rótulo carrega a régua; o filtro `mes` só mexe nos dois do meio, e a `descricao` diz isso (precedente: `CONTRATO-DE-TELA.md` §3, "estado atual não obedece ao filtro de período").

Simulação: pedidos simulados ficam fora dos quatro cards e aparecem só na barra "Simulado". Se **todas** as empresas do recorte estão em simulação, Faturado, Recebido e Em atraso ficam `estado="nao-apurado"` com a nota "Omie em simulação". Se só algumas estão, os cards ficam `parcial` e a `procedencia` nomeia as empresas que não entram.

Meta: não há meta de faturamento definida para o portal (N13). Nenhum card mostra meta.

### Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | `fat_contexto` ou `fat_pedidos` em curso | `Carregando variante="kpis"`, depois `variante="grafico"` |
| Vazio, sem papel | a pessoa tem a porta, mas nenhuma linha em donos, gestores ou solicitantes, e não é tesouraria nem controladoria | `EstadoVazio` "Você ainda não pede nem aprova faturamento em nenhuma empresa." + "Quem cadastra é a controladoria (Ana Carvalhais)." |
| Vazio, sem pedido | tem papel e nenhum pedido ainda | cards em "—" (`nao-apurado`, nota "nenhum pedido ainda"), caixa de atenção vazia, gráfico trocado por `EstadoVazio` com a ação "Novo pedido" |
| Parcial | parte das empresas em simulação | `KpiCard estado="parcial"`; `procedencia` diz quais |
| Omie não lido | a última leitura de status falhou ou passou de 8 h em dia útil | cards seguem com o último valor; `procedencia` diz "situação do Omie de {data}, a leitura seguinte falhou" (N9: sem selo fixo) |
| Erro | `fat_contexto` ou `fat_pedidos` falha | `EstadoErro` com a fonte "Portal de Faturamento" |
| Sem acesso | sem `view.faturamento` | o item não aparece no menu; pela URL, `EstadoSemAcesso oQueFalta="Faturamento"` |

### Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `mes` | `AAAA-MM` | mês corrente | Faturado no mês, Recebido no mês |
| `emissora` | apelidos separados por vírgula (`DOC,PIS`) | todas do meu recorte | tudo |

### Permissões (N8)
- Área que abre: `faturamento` (`view.faturamento`).
- "Novo pedido": quem tem linha ativa de dono, gestor ou solicitante em alguma empresa. Para os outros (tesouraria, controladoria), o botão fica desabilitado com o motivo "Quem pede faturamento é dono, gestor ou solicitante de uma empresa."

### Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Novo pedido | dono, gestor, solicitante | — | abre `/faturamento/novo` (com `?emissora=` se o filtro tiver uma só) |
| Abrir pendência | quem vê a linha | — | abre Pedidos ou a Fila da tesouraria com o filtro |

### O que NÃO entra, e por quê
- A lista dos pedidos: mora em Pedidos (§3). Visão geral não tem tabela linha a linha (ARQUETIPOS §1, N10).
- Dar OK, devolver, reenviar: são da Ficha do pedido e da Fila da tesouraria. Esta tela só aponta.
- Contratos recorrentes, confirmação do mês, renovação e vendas ganhas sem contrato: E2 e E3.
- Cobrança e régua de inadimplência: fora da v1 (spec §1). Em atraso aparece para o dono saber; quem cobra continua sendo o financeiro.
- Comparação com meses anteriores: sem série histórica na E1 (o portal começa vazio).

### Para onde manda (tela dona)
- Pedidos (§3), com o filtro do número clicado; Fila da tesouraria (tesouraria); Novo pedido.

### Casos de aceite que esta tela cobre
- CA-01 (o Hugo vê "OS criada", depois a nota e o pagamento, sem abrir o Omie: cards e gráfico; detalhe na Ficha).
- CA-09 (escopo: a `descricao` e os números vêm só do recorte que a RPC devolve).

---

## 3. Pedidos (`/faturamento/pedidos`)

**Por que existe:** a spec (§9) e o pedido da T4 põem "a lista dos meus pedidos" dentro de Meu faturamento. As regras do repo proíbem tabela linha a linha numa Visão geral (ARQUETIPOS §1, item 5; N10) e mandam separar tela que é dois arquétipos (N6). A lista virou esta rota, que também é o destino de todos os números de Meu faturamento (N2). Se o dono preferir a lista na mesma página, o caminho é o da Operação diária (`monetizacao-operacao.md`): manter junto e registrar a lacuna.

### Propósito
- **Pergunta (`<h1>`):** "Em que pé está cada pedido?"
- **Público:** os mesmos de Meu faturamento; cada um vê o seu recorte.
- **Decisão ou ação que provoca:** achar o pedido e abrir a Ficha para agir (dar OK, corrigir, reenviar, pedir cancelamento).
- **Métrica de sucesso:** nenhum pedido é procurado fora do portal (Pipefy, e-mail, Omie) para saber a situação.
- **Arquétipo:** Lista/Relatório.
- **Universo (`descricao`):** "{recorte do papel, como em §2} · todas as competências (ou o mês e a régua do filtro) · pedido".

### Anatomia
1. `PageHeader` com pergunta, universo, `procedencia`, ação `default` "Novo pedido".
2. `BarraFiltros` fixa, estado na URL, chips removíveis, "N de M pedidos".
3. Sem `KpiCard` (os números são de Meu faturamento; repetir seria o terceiro painel).
4. Tabela paginada no servidor (RNF-07), ordenável.
5. Linha abre a Ficha (`/faturamento/pedido/$id`), que volta para cá com os mesmos filtros.

### Colunas
| Coluna | Conteúdo |
|---|---|
| Pedido | número (`FAT-2026-000123`) |
| Cliente | nome do tomador; documento abaixo, em 13px |
| Projeto | nome do projeto |
| Empresa | apelido da empresa que fatura (some se o filtro tem uma só) |
| Dono | primeiro nome (some para quem só vê os próprios) |
| Valor | valor do pedido, R$ |
| Situação | `StatusBadge` (§1.2) |
| Próximo passo | quem age e o quê, com data: "OK de Hugo · desde 21/10", "Você corrige · devolvido em 21/10", "Tesouraria confere · vence 24/10", "Aguarda pagamento · vence 10/11", "Omie tenta de novo às 14:20" |
| Atualizado | data e hora da última mudança |
| Pago no mês / Em atraso | só aparecem quando o filtro vem desses cards; total no rodapé |

Rodapé: "N pedidos · R$ {soma do valor}" do recorte inteiro, calculado no servidor (não da página).

### Números
| Número | Definição | Unidade | Fonte | Drill-down | Bate? |
|---|---|---|---|---|---|
| N de M pedidos | pedidos no filtro ÷ pedidos no recorte | pedido | `ops.fat_pedidos` → `total`, `total_recorte` | — | — |
| Soma do valor | soma do valor dos pedidos no filtro | R$ | `ops.fat_pedidos` → `soma` | — | bate com A faturar e Faturado no mês quando o filtro vem deles |
| Pago no mês, Em atraso (rodapé) | soma das parcelas na régua do filtro | R$ (parcela) | `ops.fat_pedidos` → `soma_parcelas` | — | bate com Recebido no mês e Em atraso |

### Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | consulta em curso | `Carregando variante="tabela"` |
| Vazio | nenhum pedido no recorte | `EstadoVazio` "Nenhum pedido ainda." + "Novo pedido" (se pode pedir) |
| Vazio por filtro | filtro sem resultado | `EstadoVazio total={M}` ("Nenhum pedido com esses filtros. 37 no total.") |
| Erro | `fat_pedidos` falha | `EstadoErro` com a fonte |
| Sem acesso | sem `view.faturamento` | `EstadoSemAcesso oQueFalta="Faturamento"` |

### Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `situacao` | estados de §1.2, separados por vírgula; `a_faturar` = o grupo do card | todos menos `cancelado` | tabela |
| `pendencia` | `ok`, `devolvido`, `erro` | nenhum | tabela |
| `emissora` | apelidos | todas do recorte | tabela |
| `dono` | id da pessoa | todos do recorte | tabela (só para gestor, tesouraria, controladoria) |
| `mes` + `regua` | `AAAA-MM` + `competencia`, `nota` ou `pagamento` | sem mês | tabela; o chip diz a régua ("Nota emitida em out/2026") |
| `busca` | número, nome ou documento do cliente, projeto | vazio | tabela |
| `ordem` | `atualizado`, `valor`, `vencimento` | `atualizado` (mais recente primeiro) | tabela |
| `pagina` | número | 1 | tabela |

### Permissões (N8)
- Área `faturamento`. O recorte é da RPC. Rascunho aparece só para quem o escreveu.

### Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Novo pedido | dono, gestor, solicitante | — | `/faturamento/novo` |
| Abrir pedido | quem vê a linha | — | Ficha, com trilha de volta para esta lista com os filtros |

### O que NÃO entra, e por quê
- Ação em lote (aprovar vários, reenviar vários): na E1 cada OK passa pela Ficha, que mostra o que está sendo aprovado.
- Exportar: ninguém pediu na E1; o dado de controle da Ana continua no Pipefy (decisão 4).
- Contratos: E2.

### Para onde manda
- Ficha do pedido. Volta: Meu faturamento.

---

## 4. Lacunas da API (para a T1b, antes da T4)

1. **`ops.fat_pedidos` precisa devolver, além da página:** `total`, `total_recorte`, `soma` (valor) e `resumo` (a faturar, faturado no mês, recebido no mês, em atraso, por situação). Sem isso a tela teria de somar a página, o que o §1.4 proíbe. O filtro precisa aceitar `pendencia`, `mes` + `regua` e o grupo `a_faturar`.
2. **`ops.fat_contexto` devolve as pendências "OK a dar" e "devolvidos"; faltam "erro no Omie" (do autor e do dono) e "para faturar" (tesouraria).**
3. **Data da nota e data do pagamento:** os cards por mês dependem de o conector gravar a data de emissão da nota e o `pago_em` da parcela (RF-P09). Sem a data da nota, "Faturado no mês" usa a data do evento `faturado` e a `procedencia` avisa.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte: soma de "Faturado no mês" e "Recebido no mês" contra o Omie da DOC num mês com dado real (depois do "pode ativar")
- [ ] CA-09 testado por chamada direta à RPC com dois donos e um gestor (não só pela tela)
