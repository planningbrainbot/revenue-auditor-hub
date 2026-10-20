# Contrato · Faturamento › Novo pedido (`/faturamento/novo`)

**Dono de produto:** Pedro Luca   **Operação:** Ana Carvalhais (controladoria; a lista de campos é dela, 09/10)   **Dono do código:** Pedro Luca; merge do Eliezek   **Data:** 20/10/2026

**Estado:** aprovado pelo Pedro em 20/10/2026 (commit `d1ffd28`). Moldura comum (menu, situações, simulação, regras gerais): `faturamento.md` §1.

## Propósito
- **Pergunta (`<h1>`):** "O que precisa ser faturado, para quem e como?"
- **Público:** dono da receita, gestor e solicitante (coordenador, CS, analista) de uma empresa que fatura. Tesouraria e controladoria não cadastram (spec §4).
- **Decisão ou ação que provoca:** enviar um pedido completo e certo de primeira, que vai ao Omie sem ninguém redigitar.
- **Métrica de sucesso:** 100% dos pedidos chegam ao Omie sem redigitação; cai a devolução por dado faltando (hoje 5 de 94 cards conferidos no Pipefy) e a nota cancelada por empresa errada.
- **Arquétipo:** Ficha em modo de edição (spec §9). **Lacuna:** nenhum dos cinco arquétipos cobre um formulário longo de criação. Segue a Ficha (trilha, cabeçalho com uma ação `default`, uma `Secao` por assunto) e as regras de formulário da Configuração (rótulo acima, ajuda abaixo, erro no campo). A faixa de 3 a 6 `KpiCard` da Ficha não se aplica a um objeto que ainda não existe; no lugar dela fica a prévia das parcelas.
- **Universo (`descricao`):** "Pedido pontual, avulso ou parcelado · empresas em que você pode pedir: {DOC, PIS} · vai ao Omie da empresa escolhida". Com empresa em simulação: "· o Omie da DOC está em simulação: nada é gravado lá".

## Anatomia (ordem fixa)
1. Trilha: Faturamento › Pedidos › Novo pedido (ou › FAT-2026-000123, quando é rascunho ou devolvido).
2. `PageHeader`: título "Novo pedido" (ou o número), pergunta, universo, `StatusBadge` "Rascunho" ou "Devolvido" quando houver.
3. **Faixa de devolução** (só quando o pedido voltou): caixa com borda, uma linha: "Devolvido por {nome} em {data}: '{motivo}'".
4. Quatro `Secao`, **na ordem da lista da Ana** (spec §5.2). Os campos que dependem de outro ficam desabilitados com o motivo até o anterior estar preenchido.
5. Prévia das parcelas.
6. Rodapé fixo com "O que acontece ao enviar" (uma frase) e as ações: **Enviar** (`default`), Salvar rascunho (`outline`).

### Seção 1 · "Quem fatura, e para quem?"
| Campo | Obrigatório | Comportamento |
|---|---|---|
| Empresa que fatura | sim | lista das empresas em que a pessoa é dona, gestora ou solicitante (`fat_contexto`), com apelido e razão social. Uma só: vem marcada. |
| Dono da receita | sim | **Não está na lista da Ana, e a RF-P05 precisa dele** (ver "Lacunas"). Lista dos donos ativos da empresa. Se quem cadastra é dono nela, vem marcado com ele mesmo. |
| Cliente PF ou PJ | sim | duas opções; decide se o campo seguinte pede CNPJ ou CPF. |
| CNPJ ou CPF | sim | máscara; dígito verificador conferido ao sair do campo. Com o número válido, a tela busca o cliente (`fat_tomador`) e mostra um quadro: nome, município/UF, situação na Receita (`StatusBadge`), de onde veio ("base de clientes" ou "Receita"). PF: só o dígito; o nome é digitado. |
| E-mail para envio | sim | um ou mais, em fichas removíveis. Vêm do cadastro quando existem; dá para tirar e acrescentar. Formato conferido em cada um. |

Comportamentos da seção:
- **Cliente inapto (RF-P02, CA-05):** situação diferente de ativa mostra, no quadro do cliente, "CNPJ {situação} na Receita desde {data}. O envio fica bloqueado." O rascunho continua podendo ser salvo; Enviar fica desabilitado com esse motivo.
- **Cliente não encontrado:** "Não achamos este CNPJ na base nem na Receita. Confira o número." Proposta: deixar digitar o nome e enviar, com a marca "situação não conferida" na Ficha e na fila da tesouraria. *A decidir pela Ana.*
- **Empresa diferente da do contrato (RF-P03, CA-04):** se o cliente tem contrato vigente em outra empresa, aparece, logo abaixo de "Empresa que fatura", caixa com borda: "Este cliente tem contrato vigente na PAC. Você escolheu a PRJ." + caixa de marcar **"Confirmo que quem fatura é a PRJ"** + botão "Trocar para PAC" (só se a pessoa pode pedir pela PAC). Sem a marca, Enviar fica desabilitado com o motivo "Confirme a empresa que fatura". Aviso, não bloqueio: salvar rascunho não exige a marca. Na E1 o contrato vem de `ops.omie_contratos_servico` quando existir (`PLANO-E1.md`, "Fora da E1"); a procedência do aviso diz "contratos lidos do Omie em {data}".
- Trocar a empresa depois de escolhido o serviço limpa o serviço (o catálogo é por empresa) e diz isso num `toast`.

### Seção 2 · "O que foi feito?"
| Campo | Obrigatório | Comportamento |
|---|---|---|
| Nome do projeto | sim | texto; espaços das pontas tirados e espaços repetidos juntados ao sair do campo (é a chave de projeto da Ana). |
| Serviço | sim | busca no catálogo da empresa (`fat_servicos`): descrição e, em 13px, o código de serviço. Desabilitado até escolher a empresa ("Escolha a empresa que fatura primeiro"). Ninguém digita imposto: a tributação vem do cadastro. |
| Descrição da nota | sim | texto que vai na nota. Se estiver vazio quando o serviço é escolhido, recebe o padrão "{serviço} · {projeto} · {competência}", editável. |

Comportamentos da seção:
- **Serviço sem tributação (RF-P04):** não aparece na lista. Abaixo do campo, quando houver: "{n} serviços da {empresa} não aparecem porque falta a tributação no Omie. Peça à controladoria (Ana Carvalhais)." O mesmo texto aparece quando a busca não acha nada.
- **Sugerir serviço (T5):** botão `outline` ao lado do campo Serviço. Lê o nome do projeto e a descrição da nota, o que houver; sem texto nos dois, fica desabilitado com o motivo "Escreva o projeto ou a descrição primeiro". Resposta na própria linha: "Sugestão: {serviço} ({código}). [Usar esta] [Ignorar]". Se nada do catálogo combina: "Nenhum serviço da {empresa} combina. Escolha na lista ou peça à controladoria." Enquanto espera: "Procurando…" (meta da T5: menos de 3 s). Se falhar ou passar do tempo: "Não deu para sugerir agora. Escolha na lista." A sugestão só escolhe dentro do catálogo da empresa e nunca escolhe sozinha: quem decide é a pessoa.
- **Descrição que não combina com o serviço (T5):** ao sair do campo Descrição, com serviço escolhido, pode aparecer abaixo dele: "Esta descrição não parece ser de '{serviço}'. Confira o serviço antes de enviar." + "Sugerir outro serviço". É aviso: não bloqueia o envio nem pede marca. Se a checagem falhar, nada aparece.
- **Desligado por variável (T5):** sem o botão e sem o aviso. Não é falta de permissão, então não aparece desabilitado.
- A tela não diz "IA" nem o nome do modelo; diz "sugestão" e deixa a escolha com a pessoa.

### Seção 3 · "Quanto e como cobrar?"
| Campo | Obrigatório | Comportamento |
|---|---|---|
| Valor | sim | R$ com centavos, maior que zero. |
| Nota fiscal, recibo ou nota de débito | sim | três opções. Ajuda: "Recibo e nota de débito também saem por OS no Omie, como hoje" (resposta 7 da Ana, spec §13.1). |
| À vista ou parcelado | sim | parcelado abre "Número de parcelas", de 2 a 36. |
| Boleto ou pix | sim | duas opções. |
| 1º vencimento | sim | data. Proposta: não aceita data anterior a hoje ("O 1º vencimento já passou"). *A decidir pela Ana.* |
| Competência | não | mês; vem preenchida com o mês do 1º vencimento e acompanha a data até a pessoa mudar à mão. |

### Seção 4 · "Mais alguma coisa?"
| Campo | Obrigatório | Comportamento |
|---|---|---|
| Departamento | não | a mesma lista do Contas a Pagar (ver "Lacunas": a API não diz de onde a tela lê). |
| Observações | sim | texto livre. Ajuda: "Não é usado para regra: quem confere lê, o Omie não." |

### Prévia das parcelas: "Como o valor fica dividido?"
- Tabela pequena: Parcela · Vencimento · Valor, e a linha de total igual ao valor do pedido.
- Regra (spec §5.2, RNF-04): as parcelas seguintes caem no mesmo dia dos meses seguintes, ou no último dia do mês quando o dia não existe; a última absorve o arredondamento. Ajuda: "A última parcela leva os centavos que sobram da divisão."
- Muda na hora com valor, forma, número de parcelas e 1º vencimento. Sem esses campos: "Preencha valor e 1º vencimento para ver as parcelas."
- A prévia precisa usar **a mesma regra do banco**; as parcelas que valem são as gravadas no envio, e são as que a Ficha mostra (ver "Lacunas").
- CA-02 (fica para a E2, mas a regra é esta): R$ 16.000,00 em 3 parcelas = 5.333,33 + 5.333,33 + 5.333,34.

### "O que acontece ao enviar" (uma frase, muda com o caso)
- Quem cadastra é o dono: "O pedido vai para a fila do Omie da {empresa} e depois para a tesouraria faturar."
- Quem cadastra não é o dono (RF-P05, decisão 3A): "Você não é o dono da receita: o pedido vai para o OK de {dono} antes de ir ao Omie." O botão vira **"Enviar para o OK de {primeiro nome}"**.
- Empresa em simulação, acrescenta: "O Omie da {empresa} está em simulação: o pedido percorre o fluxo, mas nada é gravado lá."
- Pipefy: nada na tela. O card no pipe Contas a Receber nasce e anda sozinho quando a empresa tem o Pipefy ligado (decisão 4, spec §13.3); a Ficha mostra o card.

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Parcelas da prévia | valor ÷ número de parcelas, com o arredondamento na última | R$ (parcela) | regra da §5.2; as definitivas vêm de `fat_pedido_enviar` | na hora | — | a soma bate com o Valor; as gravadas aparecem na Ficha |
| Serviços que não aparecem | serviços ativos da empresa sem tributação no Omie | serviço | `fat_servicos` | sincronização do catálogo | — | — |

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | `fat_contexto` ou o rascunho em curso | `Carregando variante="pagina"` |
| Buscando cliente | `fat_tomador` em curso | "Buscando o cliente…" no quadro do cliente; os outros campos seguem editáveis |
| Sem empresa para pedir | a pessoa tem a porta e nenhuma linha de dono, gestor ou solicitante | `EstadoVazio` "Você ainda não pode pedir faturamento em nenhuma empresa." + "Quem cadastra é a controladoria (Ana Carvalhais)." |
| Catálogo vazio | a empresa não tem serviço ativo com tributação | campo Serviço desabilitado com "A {empresa} ainda não tem serviços liberados no portal. Peça à controladoria." |
| Erro ao salvar ou enviar | a RPC recusa | a mensagem de cada campo aparece abaixo dele, com ícone e texto (não só cor); erro geral em `toast` com o que fazer |
| Erro ao carregar | `fat_contexto` ou o rascunho falha | `EstadoErro` com a fonte |
| Pedido que não se edita mais | `?pedido=` aponta para um pedido que já saiu de rascunho ou devolvido | redireciona para a Ficha, que diz em que pé está |
| Sem acesso | sem `view.faturamento`; ou tesouraria e controladoria sem papel numa empresa | `EstadoSemAcesso oQueFalta="ser dono, gestor ou solicitante numa empresa que fatura"` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `pedido` | id do pedido (rascunho ou devolvido) | ausente = pedido novo | carrega o pedido; depois do primeiro "Salvar rascunho" a URL ganha o id (troca sem empilhar), e recarregar não perde nada |
| `emissora` | apelido | nenhuma | pré-seleciona a empresa |

Sair da página com alteração não salva pergunta antes (N7: "descartar rascunho sempre pergunta").

## Permissões (N8)
- Área `faturamento` (`view.faturamento`, `edit.faturamento_pedido`) **e** linha ativa de dono, gestor ou solicitante na empresa escolhida (`receita.fat_donos`). A lista de empresas já vem recortada.
- Corrigir um devolvido: o autor; o dono e o gestor também podem (`fat_pedido_salvar`).

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Salvar rascunho | quem pode pedir na empresa | — | `toast` "Rascunho salvo · FAT-2026-000012"; a URL ganha `?pedido=` |
| Enviar (autor é o dono) | dono, ou gestor que se escolheu como dono | — (o rodapé já diz o efeito) | `fat_pedido_enviar`; `toast` "Enviado. Vai ao Omie da {empresa}." (em simulação: "Enviado em simulação."); abre a Ficha |
| Enviar para o OK de {dono} | solicitante, ou quem escolheu outro dono | — | `fat_pedido_enviar` → Aguardando OK; `toast` "Enviado para o OK de {nome}"; abre a Ficha |
| Reenviar (devolvido) | autor, dono, gestor | — | o mesmo envio; a faixa de devolução some |
| Sugerir serviço | quem preenche | — | sugestão na linha; nada muda sem "Usar esta" |
| Trocar para {empresa do contrato} | quem pode pedir nas duas | — | troca a empresa e limpa o serviço |
| Sair sem salvar | quem preenche | `AlertDialog` "Sair sem salvar? O que não foi salvo se perde." | volta à origem |

Enviar valida tudo no servidor (`fat_pedido_enviar`); a tela também confere na hora o que dá (obrigatórios, dígito, e-mail, valor, parcelas, marca da empresa), para a pessoa não descobrir o erro só no fim.

## O que NÃO entra, e por quê
- **Contrato ligado** (último campo da lista da Ana): contratos são da E2 (`PLANO-E1.md`, "Fora da E1"). O campo aparece na E2.
- Enviar e-mail ao cliente: quem manda a nota é o Omie, com os e-mails do pedido.
- Pedido em lote ou importação de planilha: um pedido por vez na E1.
- PAT (Consultoria): entra aos poucos, em paralelo com o sistema da Consultoria (decisão 5); não há tela própria na E1.
- Escolher categoria, conta corrente ou retenção: vêm do cadastro da empresa e do serviço; quem mexe é a controladoria.

## Para onde manda
- Depois de enviar: a Ficha do pedido. Rascunho salvo: fica aqui. Voltar: Pedidos (ou Meu faturamento, se veio de lá).

## Casos de aceite que esta tela cobre
- CA-01 (os campos do e-mail do Fortaleza viram um pedido da DOC com e-mails e serviço do cadastro).
- CA-04 (aviso de empresa diferente; só envia com "Confirmo" marcado).
- CA-05, segunda parte (CNPJ inapto bloqueia o envio com o motivo).

## Lacunas (para a T1b e a T5, antes da T4)
1. **Dono da receita não está na lista da Ana (§5.2)**, mas `fat_pedidos.dono_id` e a RF-P05 dependem dele. O contrato põe o campo logo depois da empresa. A Ana confirma.
2. **Prévia das parcelas:** a API não tem prévia. Proposta: `fat_pedido_salvar` devolve as parcelas calculadas pela função do banco; ou a regra fica numa função pura testada contra os mesmos casos da função do banco. A tela não inventa uma terceira regra.
3. **Departamentos:** "a mesma lista do Contas a Pagar" não tem origem na API. Proposta: `fat_contexto` devolve a lista.
4. **Gestor que escolhe outro dono e depois aprova o próprio pedido:** a API permite (`fat_pedido_aprovar`: dono ou gestor). Proposta: o autor nunca dá o OK no que ele mesmo enviou, senão o OK da decisão 3A vira carimbo. *A decidir pelo Pedro.*
5. **Descartar rascunho:** o portal não apaga pedido (RF-P11) e a API não tem descarte. Proposta: rascunho esquecido fica como rascunho, visível só para o autor; descartar vira cancelar com motivo "descartado pelo autor". *A decidir pelo Pedro.*

## Divergências registradas na implementação (20/10/2026)
1. **1º vencimento no passado:** só avisa ("O 1º vencimento já passou."), não bloqueia. A regra ainda é *a decidir pela Ana*, e o banco aceita a data; bloquear na tela seria decidir por ela. Ano fora de 2000 a 2100 ou dia que não existe dá "Data inválida".
2. **Competência:** seletor de mês próprio (12 meses para trás, 24 para a frente, mais "Mês do 1º vencimento"), porque o campo de mês do navegador não se edita no Firefox desktop.
3. **Busca do cliente:** sempre leva a empresa escolhida (o banco confere o papel nela, revisão M5). Sem papel, o quadro do cliente diz "A busca do cliente na {empresa} é de quem pede faturamento por ela. O nome do cliente pode ser digitado." Sem empresa escolhida, a busca não roda. No aviso de contrato em outra empresa, número e valor do contrato só aparecem quando a pessoa também tem papel lá.
4. **Jev:** antes de ir ao modelo, sai do texto o nome do cliente digitado, o nome e a razão social que o banco tem para o documento e cada palavra deles com 3 letras ou mais. O nome fantasia não sai, porque `fat_tomador` não o devolve.
5. **Quem tem a porta e nenhum papel:** a tela vazia com "Você ainda não pode pedir faturamento em nenhuma empresa." e "Quem cadastra é a controladoria (Ana Carvalhais).", como o contrato pede (não é divergência; estava como "sem acesso").
6. **Com o banco da revisão de 20/10/2026:** o aviso de contrato em outra empresa traz só o nome da empresa (um item por empresa; número, valor e vigência vêm nulos). O nome de pessoa física vindo da base só aparece para quem tem papel na empresa escolhida, e o e-mail da base só para tesouraria e controladoria: para os outros, os campos vêm vazios e se digitam.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Regra das parcelas conferida contra a função do banco (2, 3, 12 e 36 parcelas; 1º vencimento em 31/01 e 29/02)
- [ ] CA-04 e CA-05 testados com os CNPJs do E0
