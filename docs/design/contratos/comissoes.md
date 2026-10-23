# Contrato · Comissões (`/comissoes`, `/comissoes/revisao`, `/comissoes/fechamento`, `/comissoes/regras`)

**Dono de produto:** dono do Ops   **Dono do código:** Claude Code   **Data:** 23/10/2026

PRD: `wiki/prds/2026-10-comissoes-v1.md` (repo de wiki), revisão 2 (entrega no Ops). A regra foi validada no sistema novo com teste de banco; aqui muda só a porta e a tela.

Área nova, que substitui a Apuração de comissões (`/comissoes`, área Receita, julho/26). Três áreas de permissão concedidas pessoa a pessoa: `comissoes` (time comercial), `comissoes_revisao` (líderes comerciais) e `comissoes_fechamento` (financeiro). Grupo próprio na lateral, "Comissões".

---

## 1. Minhas comissões (`/comissoes`)

### Propósito
- **Pergunta (h1):** "Quanto eu recebo no dia 20?"
- **Público:** closer e SDR do Inside Sales (`view.comissoes`); cada um vê só o que é dele.
- **Decisão ou ação que provoca:** entender o próximo pagamento e o que falta acontecer em cada cliente que ficou para depois, sem perguntar ao líder.
- **Métrica de sucesso:** no primeiro pagamento pela tela, nenhuma pergunta "por que esse cliente não entrou?" sem resposta na própria tela.
- **Arquétipo:** Lista/Relatório.
- **Universo medido:** metades de comissão da pessoa logada · próximo pagamento (dia 20) e anteriores · unidade de contagem: metade de comissão (contrato × papel × 1ª ou 2ª).

### Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Próximo pagamento | soma das linhas não excluídas do mês, só depois que os líderes liberam | R$ | `comissoes.linhas` do mês, pela regra do PRD (seção 4) | última execução da prévia (de hora em hora) | tabela de linhas logo abaixo | sim: é a soma da tabela |
| Fica para depois | metades ainda não liberadas, com o motivo e o valor estimado no percentual atual | metade | contratos do Inside Sales desde 01/10/2026 sem linha | idem | a própria lista | sim |
| Pagamentos anteriores | total de cada mês liberado ou pago | R$ | idem | idem | linhas do mês, ao abrir | sim |

### Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | leitura da função | `Carregando variante="pagina"` |
| Em revisão | o mês ainda não foi liberado | `KpiCard estado` "Em revisão" com o prazo dos líderes; nenhum valor |
| Vazio (sem dado na fonte) | nenhuma metade gerada nem pendente | `EstadoVazio` "Nada a receber ainda" |
| Sem vínculo | o login não está ligado a um nome do Pipedrive | `EstadoVazio` "Peça ao líder comercial para ligar seu login ao seu nome no Pipedrive" |
| Fonte indisponível / erro | a função falha | `EstadoErro` com a fonte |
| Sem acesso | sem a área `comissoes` | `EstadoSemAcesso oQueFalta="view.comissoes"` |

### Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| nenhum | | | a tela é de uma pessoa e de um pagamento |

### Permissões (N8)
- Área que abre a tela: `comissoes`.
- Chaves dentro da tela: só leitura (`view.comissoes`).
- Quem não tem a chave vê: `EstadoSemAcesso`.

### Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| nenhuma | | | |

---

## 2. Revisão do mês (`/comissoes/revisao`)

### Propósito
- **Pergunta (h1):** "O pagamento de {mês} está pronto para liberar?"
- **Público:** líderes comerciais (`manage.comissoes_revisao`). O financeiro vê as mesmas linhas no Fechamento.
- **Decisão ou ação que provoca:** conferir percentuais e pendências, ajustar com motivo, lançar bônus e liberar até o dia 10.
- **Métrica de sucesso:** mês liberado até o prazo, com nenhuma pendência aberta.
- **Arquétipo:** Fila de trabalho (pendências no topo) + Lista (linhas do mês).
- **Universo medido:** todas as linhas do mês de pagamento · apurações de CAC do mês anterior · unidade de contagem: linha (metade, ajuste ou bônus).

### Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Total do mês | soma das linhas não excluídas | R$ | `comissoes.linhas` | prévia de hora em hora | linhas do pagamento | sim |
| Situação | Em revisão · Liberado · Pago, com o prazo (apurações até o dia 5, revisão até o dia 10, envio ao DP até o dia 11) | — | `comissoes.meses` | idem | — | — |
| Apurações confirmadas | apurações com CAC do mês anterior confirmadas / total | apuração | `ops.royalties_apuracao` | tempo real | Apuração de Royalties | sim |
| Por pessoa | total de cada pessoa no mês | R$ | `comissoes.linhas` | idem | filtra as linhas pela pessoa | sim |
| Pendências (contagem por bloco) | CAC sem parcela, aguardando data, regra antiga, sem closer ou SDR, sem pipe, pessoa trocada, pessoa sem login | item | funções de pendência | idem | o bloco | sim |

### Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | leitura | `Carregando variante="pagina"` |
| Vazio | mês sem nenhuma linha | `EstadoVazio` "Nenhuma linha neste mês ainda" |
| Vazio por filtro | busca ou pessoa sem resultado | `EstadoVazio total={n}` |
| Fora do prazo | depois do dia 10, ou mês liberado | `StatusBadge` "Fechado para mudanças"; ajuste avisa que vai para o próximo pagamento; bônus, excluir e incluir somem |
| Erro | a função falha | `EstadoErro` com a fonte |
| Sem acesso | sem `comissoes_revisao` | `EstadoSemAcesso oQueFalta="manage.comissoes_revisao"` |

### Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `mes` | AAAA-MM | o mês de pagamento corrente até o dia 20, depois o seguinte | toda a tela |
| `pessoa` | id da pessoa | todas | linhas |
| `busca` | texto | vazio | linhas |

### Permissões (N8)
- Área que abre a tela: `comissoes_revisao`.
- Chaves: `manage.comissoes_revisao` para toda ação.
- Quem não tem a chave vê: os números e as linhas, sem botões.

### Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Ajustar linha (base e %) | líder | motivo obrigatório no próprio formulário | toast "Ajuste gravado"; a linha mostra "Ajustada" |
| Excluir / restaurar linha | líder, até o prazo | motivo obrigatório | toast; linha riscada e fora do total |
| Escolher metade de CAC sem parcela | líder | não (botões 1ª, 2ª, as duas) | toast; as linhas nascem na hora |
| Incluir metade da regra antiga | líder, até o prazo | motivo obrigatório | toast |
| Lançar bônus | líder, até o prazo | motivo obrigatório | toast; pedido repetido não duplica |
| Vincular login a uma pessoa | líder | não | toast |
| Liberar para o time | líder | `AlertDialog` com o total e a quantidade de pessoas | toast "Pagamento liberado"; situação muda |

---

## 3. Fechamento (`/comissoes/fechamento`)

### Propósito
- **Pergunta (h1):** "Quanto pagar no dia 20 e para quem?"
- **Público:** financeiro (`manage.comissoes_fechamento`).
- **Decisão ou ação que provoca:** registrar as datas onde não há CAC, baixar a planilha e enviar ao Departamento Pessoal até o dia 11 (ou o próximo dia útil), e marcar como pago depois do pagamento pelo iFood no dia 20.
- **Métrica de sucesso:** total marcado como pago igual ao que saiu do caixa.
- **Arquétipo:** Lista/Relatório.
- **Universo medido:** linhas do mês de pagamento · unidade de contagem: pessoa e linha.

### Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Total a pagar | soma das linhas não excluídas do mês, pago pelo iFood no dia 20 | R$ | `comissoes.linhas` | prévia de hora em hora | total por pessoa | sim |
| Total por pessoa | soma por pessoa, com "sem login" quando falta vínculo | R$ | idem | idem | linhas da pessoa na Revisão | sim |
| Apurações de CAC | CAC de cada apuração do mês anterior e se está confirmada | R$ | `ops.royalties_apuracao` | tempo real | Apuração de Royalties | sim |
| Aguardando data | contratos sem CAC (ou de Recife) sem a data registrada | contrato | funções de pendência | idem | o próprio bloco | sim |
| Linhas do pagamento | as mesmas da Revisão, só leitura | linha | `comissoes.linhas` | idem | — | sim |

### Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | leitura | `Carregando variante="pagina"` |
| Em revisão | os líderes ainda não liberaram | `StatusBadge` "Em revisão"; "Marcar como pago" desabilitado com o motivo |
| Vazio | mês sem linhas | `EstadoVazio` |
| Erro | a função falha | `EstadoErro` |
| Sem acesso | sem `comissoes_fechamento` | `EstadoSemAcesso oQueFalta="manage.comissoes_fechamento"` |

### Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `mes` | AAAA-MM | igual à Revisão | toda a tela |

### Permissões (N8)
- Área: `comissoes_fechamento`. Chave `manage.comissoes_fechamento` em toda ação.

### Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Registrar data (pagamento do cliente ou assinatura) | financeiro | não | toast; as linhas nascem na hora |
| Baixar planilha para o DP | financeiro | não | download `.xlsx` com pessoa e valor, para o Departamento Pessoal agendar no iFood (formato a confirmar, P-13) |
| Marcar como pago | financeiro, mês liberado | `AlertDialog` com o total | toast; situação "Pago" |
| Reabrir para os líderes | financeiro, mês liberado e não pago | motivo obrigatório | toast; situação "Em revisão" |

---

## 4. Regras (`/comissoes/regras`)
Página de texto com as regras da seção 4 do PRD em linguagem do vendedor e o calendário do mês. Arquétipo: Configuração (só leitura). Área `comissoes`.

---

## O que NÃO entra, e por quê
- Estorno, trava pela baixa no Omie e classificação das saídas: fatia 2 do PRD.
- Cálculo do bônus por meta ou ROAS: os líderes lançam o valor; a régua muda todo mês.
- O rateio das comissões entre as BUs: é do Rateio Comercial.
- O pagamento em si: o Departamento Pessoal agenda pelo iFood, fora do sistema.
- Vendas fora do Inside Sales.

## Para onde manda (tela dona)
- Apuração de Royalties (`/royalties/$unidadeId/$mes`) é a dona do CAC que libera cada metade.
- Contrato e closer/SDR: Pipedrive (o vínculo corrige-se lá).

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem independente)
