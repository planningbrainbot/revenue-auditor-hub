# Contrato · Faturamento › Pedido (`/faturamento/pedido/$id`)

**Dono de produto:** Pedro Luca   **Operação:** Ana Carvalhais (controladoria), tesouraria, donos da receita   **Dono do código:** Pedro Luca; merge do Eliezek   **Data:** 20/10/2026

**Estado:** aprovado pelo Pedro em 20/10/2026 (commit `d1ffd28`). Moldura comum (menu, situações, simulação, regras gerais): `faturamento.md` §1.

## Propósito
- **Pergunta (`<h1>`):** "Este pedido já virou nota, e o cliente pagou?"
- **Público:** todos que têm o pedido no escopo: dono, autor (solicitante), gestor da empresa, tesouraria, controladoria.
- **Decisão ou ação que provoca:** a próxima ação do ciclo de vida, conforme a situação e o papel: dar o OK ou devolver, corrigir, reenviar, conferir e faturar, pedir ou confirmar o cancelamento.
- **Métrica de sucesso:** o dono vê OS, nota e pagamento sem acesso ao Omie (CA-01); ninguém pergunta ao financeiro "onde está meu pedido?".
- **Arquétipo:** Ficha.
- **Universo (`descricao`):** "{cliente} · {projeto} · {empresa que fatura} · dono: {nome}".

## Anatomia (ordem fixa)
1. **Trilha:** Faturamento › {tela de origem} › FAT-2026-000123. A origem (Pedidos, Meu faturamento ou Fila da tesouraria) vem no parâmetro `volta`, e voltar devolve a lista com os filtros dela.
2. **`PageHeader`:** título = número do pedido; pergunta; universo; `StatusBadge` da situação (`faturamento.md` §1.2); `procedencia`; `acoes` do ciclo de vida, com **uma** ação `default` (tabela "Ações por situação").
3. **Faixa da situação** (quando pede algo de alguém): caixa com borda, uma linha. Exemplos: "Devolvido pela tesouraria em 22/10: 'Falta o e-mail do financeiro do cliente.'" · "Aguardando o OK de Hugo desde 21/10." · "O Omie recusou em 22/10 10:12: 'Chave do Omie da MAROX Serviços suspensa: peça uma nova ao administrador da empresa.'" · "Simulado: nada foi gravado no Omie da DOC."
4. **Resumo:** quatro `KpiCard`, nota com uma informação só.
5. **`Secao` "O que foi pedido?"**
6. **`Secao` "Como o valor foi dividido?"**
7. **`Secao` "Onde está no Omie e no Pipefy?"**
8. **`Secao` "O que aconteceu com este pedido?"** (linha do tempo)
9. `Procedencia` do objeto.

### Resumo (faixa de `KpiCard`)
| Número (rótulo exato) | Definição | Unidade | Fonte | Antes da nota | Drill-down |
|---|---|---|---|---|---|
| Valor | valor do pedido. Nota: "à vista" ou "3 parcelas" | R$ | `fat_pedido` | igual | seção de parcelas |
| Recebido | soma das parcelas pagas. Nota: "1 de 3 parcelas" | R$ (parcela) | idem, `pago_em` lido do Omie | "—" (`nao-apurado`, nota "sem nota ainda"; em simulação, "simulado") | seção de parcelas |
| Em atraso | soma das parcelas vencidas e não pagas. Nota: "1 parcela" | R$ (parcela) | idem | idem | seção de parcelas |
| Próximo vencimento | a próxima parcela não paga. Nota: o valor dela | data | idem | o 1º vencimento pedido, nota "previsto" | seção de parcelas |

Os quatro somam do mesmo jeito que a lista e Meu faturamento (a mesma RPC devolve; a Ficha não recalcula, ARQUETIPOS §4).

### "O que foi pedido?"
Os campos da §5.2, só leitura, nos mesmos três grupos do formulário ("Quem fatura, e para quem?", "O que foi feito?", "Quanto e como cobrar?"), mais: dono, autor, criado em, e "Empresa confirmada: sim · o cliente tem contrato vigente na PAC" quando o aviso da RF-P03 foi marcado. CPF e e-mails só vêm para quem tem o pedido no escopo (RNF-06), e quem garante é a RPC.

### "Como o valor foi dividido?"
Tabela: Parcela · Vencimento · Valor · Situação (`StatusBadge`: A vencer `neutro`, Pago `sucesso`, Em atraso `perigo`, Cancelado `neutro`) · Pago em. Linha de total igual ao Valor. São as parcelas gravadas no envio, não a prévia.

### "Onde está no Omie e no Pipefy?"
Uma linha por etapa do envio, em português, com a hora:
| Linha | O que mostra |
|---|---|
| Cliente no Omie da {empresa} | "Já existia" · "Cadastrado pelo portal em {data}, com os dados da Receita e o e-mail do pedido" (CA-05) · em simulação: "Já existe" ou "Seria cadastrado" · erro com a mensagem legível |
| OS | "OS {nº} · etapa {etapa}" + "Abrir no Omie" · "Na fila: o Omie tenta de novo às {hora}" · erro com a mensagem legível · em simulação: "Seria criada com o código {número do pedido}" |
| Nota | "NFS-e {nº} emitida em {data}" + "Abrir a nota" · "Ainda não emitida" · "Faturada direto no Omie (lida às {hora})" quando a tesouraria faturou fora do portal (RF-P08) |
| Card no Pipefy | "Fase {fase} no pipe Contas a Receber" + "Abrir card" · Pipefy desligado para a empresa: "Card montado e guardado, não enviado. Iria para a fase {fase}." · erro com a mensagem |
| Última leitura | "Situação lida do Omie às {hora}; a próxima é às {hora}" + "Atualizar agora" |

**Em simulação** a seção abre com "Simulado em {data}: nada foi gravado no Omie da {empresa}. Isto é o que iria:" e uma lista legível: empresa, cliente (nome, documento, se já existe no Omie), serviço (descrição, código e se existe no Omie; se não existe, "o envio daria erro: serviço não encontrado no Omie da {empresa}"), código do pedido no Omie (o número), descrição da nota, valor, parcelas e vencimentos, e-mails de envio, boleto ou pix. Abaixo, recolhido, "Detalhes técnicos" com o envio completo (sem chave), visível só para tesouraria e controladoria.

### "O que aconteceu com este pedido?" (RF-P10)
Linha do tempo, mais recente em cima, uma linha por evento: o que aconteceu em português ("Hugo deu o OK", "Tesouraria devolveu: '{motivo}'", "Omie criou a OS 3021", "Omie recusou: '{mensagem}'", "Nota 4521 emitida", "Parcela 1 de 3 paga", "Cancelamento pedido por Hugo: '{motivo}'"), quem fez ("Portal" quando foi automático), quando, e a diferença de campos quando houve ("Valor: R$ 7.500,00 → R$ 5.000,00"). Nada nela se edita nem some.

## Ações por situação
Uma ação `default` por situação; as outras ficam `outline`. Botão de quem não tem o papel fica desabilitado com o motivo (N8), e não escondido, quando a pessoa vê o pedido mas não pode agir.

| Situação | Ação `default` (quem) | Outras ações (quem) |
|---|---|---|
| Rascunho | Continuar editando → `/faturamento/novo?pedido=` (autor) | — |
| Aguardando OK | Dar OK (dono, substituto, gestor) | Devolver (dono, substituto, gestor) |
| Devolvido | Corrigir → `/faturamento/novo?pedido=` (autor, dono, gestor) | — |
| Na fila do Omie | — | Atualizar agora (todos no escopo) |
| Erro no Omie | Reenviar (autor, tesouraria) | Devolver (tesouraria) |
| Simulado | Conferir (tesouraria) | Faturar em simulação, Devolver (tesouraria) |
| OS criada | Conferir (tesouraria) | Faturar, Devolver (tesouraria); Abrir no Omie |
| Em conferência | Faturar (tesouraria) | Devolver (tesouraria); Abrir no Omie |
| Faturado, Em atraso, Recebido | — | Pedir cancelamento (dono); Abrir a nota; Atualizar agora |
| Cancelamento pedido | Confirmar cancelamento (tesouraria) | — |
| Cancelado | — | — |

"Pedir cancelamento" também vale para o dono em Aguardando OK, Na fila do Omie, Erro no Omie, OS criada e Em conferência (RF-P11: o dono pede, a tesouraria efetiva).

## Números
Os do Resumo, acima. Nenhum outro número nesta tela.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | `fat_pedido` em curso | `Carregando variante="pagina"` |
| Não encontrado | o id não existe | `EstadoVazio` "Pedido não encontrado." + "Ver pedidos" |
| Fora do escopo (CA-09) | o pedido existe e não é da pessoa | `EstadoSemAcesso oQueFalta="ser dono, autor ou gestor da empresa deste pedido"`; nenhum dado do pedido aparece |
| Ação em curso | o OK, o reenvio ou o faturar foi pedido e o Omie ainda não respondeu | o botão vira "Enviando…"/"Faturando…" e fica desabilitado; a linha do Omie diz "Na fila: o Omie tenta às {hora}" |
| Omie não lido | a última leitura de status falhou | a seção "Onde está no Omie" mostra a última leitura boa e "a leitura seguinte falhou às {hora}"; sem selo fixo (N9) |
| Erro | `fat_pedido` falha | `EstadoErro` com a fonte |
| Sem acesso à área | sem `view.faturamento` | `EstadoSemAcesso oQueFalta="Faturamento"` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `$id` (caminho) | id do pedido | — | o objeto |
| `volta` | caminho e filtros da tela de origem | Pedidos sem filtro | a trilha e o botão de voltar |

## Permissões (N8)
- Área `faturamento`. Ver: escopo da RPC (dono, autor, gestor da empresa, tesouraria e controladoria do recorte).
- Agir: o papel na empresa do pedido (`fat_donos`) ou a área `faturamento_tesouraria`, conferidos de novo pela RPC de cada ação. A tela só desabilita; quem recusa é o banco.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Dar OK | dono, substituto, gestor | nenhuma (RF-P05: um clique); o botão diz o efeito: "Dar OK e enviar ao Omie" | `fat_pedido_aprovar`; `toast` "OK dado. Vai ao Omie da {empresa}." (em simulação: "OK dado. Simulação: nada vai ao Omie."); situação vira Na fila do Omie |
| Devolver | dono, substituto, gestor (em Aguardando OK); tesouraria (depois) | `Dialog` com **motivo obrigatório**: o botão "Devolver" fica desabilitado até haver texto, e o banco recusa motivo vazio (CA-10) | `fat_pedido_devolver` ou `fat_tesouraria_acao('devolver')`; `toast` "Devolvido a {autor}"; o motivo entra na linha do tempo |
| Reenviar | autor, tesouraria | nenhuma; ajuda: "Reenviar não duplica: o Omie reconhece o pedido pelo número" (CA-06) | `fat_pedido_reenviar`; Na fila do Omie |
| Conferir | tesouraria | nenhuma | `fat_tesouraria_acao('em_conferencia')`; "Em conferência por {nome}" |
| Faturar | tesouraria | `AlertDialog`: "Faturar FAT-…? O Omie da {empresa} emite a nota de R$ {valor} para {cliente}, com {n} parcelas. Pelo portal não dá para desfazer." Em simulação: "Faturar em simulação? Nada é emitido no Omie da {empresa}; fica registrado o que seria feito." | `fat_tesouraria_acao('faturar')`; "Faturando…" até o Omie responder; depois Faturado com o número da nota |
| Pedir cancelamento | dono | `Dialog` com motivo obrigatório; texto: "A tesouraria cancela no Omie e confirma aqui. O pedido não é apagado." | `fat_pedido_cancelar`; Cancelamento pedido |
| Confirmar cancelamento | tesouraria | `AlertDialog`: "Confirma que a nota e os títulos de FAT-… foram cancelados no Omie da {empresa}?" | `fat_pedido_cancelar`; Cancelado |
| Atualizar agora | todos no escopo | nenhuma | lê a situação no Omie sob demanda (RF-P09; ver "Lacunas"); "Lida agora" na procedência |
| Abrir no Omie, Abrir a nota, Abrir card | quem vê | — | link externo, em nova aba. Sem OS (ou em simulação), desabilitado com o motivo "Ainda não há OS no Omie" |

## O que NÃO entra, e por quê
- Editar um pedido já enviado: só volta a ser editável quando devolvido. Alterar depois da nota é cancelar e pedir de novo (spec §5, RF-P11).
- Apagar pedido: o portal não apaga (RF-P11).
- Cobrar o cliente, reenviar boleto, segunda via: cobrança fica fora da v1 (spec §1).
- Navegar para o pedido anterior ou seguinte: a Ficha volta para a lista; irmãos não ajudam a decidir aqui.
- Contrato ligado e competências: E2.

## Para onde manda
- Volta: a tela de origem com os filtros (parâmetro `volta`).
- Rascunho e devolvido: o formulário (`/faturamento/novo?pedido=`).
- Omie, nota e Pipefy: links externos.

## Casos de aceite que esta tela cobre
- CA-01 (OS, nota e pagamento visíveis ao dono sem o Omie).
- CA-05, primeira parte (o cliente novo aparece como "Cadastrado pelo portal" na linha do Omie).
- CA-06 (Reenviar não duplica; a linha do Omie mostra uma OS só).
- CA-09 (fora do escopo, nenhum dado aparece).
- CA-10 (devolver sem motivo bloqueado; o motivo aparece na linha do tempo).
- CA-12 (erro legível na faixa da situação; reenviar depois da chave nova conclui sem duplicar).

## Lacunas (para a T1b e a T2, antes da T4)
1. **"Atualizar agora" (RF-P09, sob demanda) não tem RPC no plano.** Proposta: `ops.fat_pedido_atualizar(p_id)`, que enfileira `consultar_status` daquele pedido, ou uma ação `atualizar` em `fat_tesouraria_acao` aberta a quem vê o pedido.
2. **`fat_pedido` precisa devolver os envios ao Omie e ao Pipefy com o texto legível de cada etapa** (cliente, OS, nota, card), não só o status cru, e a data da última leitura e da próxima.
3. **Devolver depois da OS criada:** a OS já está no Omie com o número do pedido como código. Se o autor corrige e reenvia, a idempotência ("já existe conta como sucesso", spec §8) faria o Omie manter a OS antiga com o dado errado. A T2 precisa decidir: alterar a OS no reenvio, ou a tesouraria excluir a OS antes de devolver. Até lá, o diálogo de Devolver avisa: "A OS {nº} continua no Omie da {empresa}; exclua-a lá antes de devolver."

## Divergências registradas na implementação (20/10/2026)
1. **"Abrir no Omie" virou "Copiar número da OS":** o conector não devolve um link estável da OS no Omie (só o da nota, `nf_link`), e um link montado à mão quebraria. O botão copia o número da OS e o `toast` diz em que Omie buscar. Sem OS (ou em simulação), fica desabilitado com o motivo "Ainda não há OS no Omie" ("Em simulação não há OS no Omie"). Quando o conector trouxer o link, o botão volta a ser "Abrir no Omie".
2. **"Omie não lido":** a falha vem da última leitura que falhou na empresa do pedido (`fat_contexto.emissoras[].omie.ultima_falha_em`), porque o pedido só guarda a última leitura boa. A linha "Última leitura" diz "Situação lida do Omie às {hora}; a leitura seguinte falhou às {hora}", e a procedência diz o mesmo, com a próxima leitura.
3. **Em atraso:** a nota conta as parcelas em atraso ("1 parcela"); o valor continua vindo da RPC.
4. **"Faturando…" e "Na fila":** a Ficha relê sozinha a cada 15 s enquanto o pedido está na fila do Omie, com envio pendente ou com leitura marcada.
5. **Com o banco da revisão de 20/10/2026 (`20261020220000_portal_faturamento_revisao.sql`):**
   - **Card do Pipefy em erro:** a linha "Card no Pipefy" ganha "Reenviar o card" (tesouraria, `acoes.reenviar_pipefy`, `fat_tesouraria_acao('reenviar_pipefy')`). Os outros veem o botão desabilitado com o motivo do banco ("Quem reenvia o card do Pipefy é a tesouraria.").
   - **Envio parado (`bloqueado`):** "Parado: espera {o cadastro do cliente | a criação da OS | o faturamento…}, que deu erro. Volta à fila quando o erro for reenviado."
   - **Envio `cancelado`:** "Não foi ao Omie (ou ao Pipefy): o pedido foi cancelado antes do envio."
   - **Pedir cancelamento durante o faturamento:** o botão fica desabilitado com a frase do banco ("O faturamento está em curso no Omie: espere a resposta para pedir o cancelamento."). Se a situação mudar com o diálogo aberto, o banco recusa (`55000`), o diálogo fecha, o `toast` mostra a mesma frase e a Ficha relê.
   - **Contrato em outra empresa:** só o nome da empresa ("o cliente tem contrato vigente na {empresa}"); número, valor e vigência não saem do banco.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Ciclo inteiro em simulação na DOC (T2): cada situação da tabela aberta na Ficha com o papel certo e com um papel errado (botão desabilitado com o motivo)
- [ ] CA-09 por chamada direta a `ops.fat_pedido` com dono de outra empresa

## Mudanças da call de 27/10/2026
Decisões confirmadas pelo Pedro em 28/10/2026. Valem sobre o que está acima.

1. **O Pipefy saiu do portal.** A seção vira **"Onde está no Omie?"**: sai a linha "Card no Pipefy" (e o "Reenviar o card"), e os "Detalhes técnicos" mostram só o envio ao Omie. Envio do Pipefy guardado antes da call não aparece. No banco, `receita.fat_transicao` só monta envio do Pipefy quando a empresa tem o Pipefy ligado, e nenhuma tem.
   - Por quê: "Card no Pipefy, Pipefy a gente pode tirar daqui" (Daniel); o portal já guarda a situação de cada pedido. Isto substitui a decisão 4 da Ana (15/10: manter o Pipefy como controle dos estados).
2. **Departamento saiu** de "O que foi pedido?".
