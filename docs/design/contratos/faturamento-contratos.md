# Contrato · Faturamento › Contratos do mês (`/faturamento/contratos`)

**Dono de produto:** Pedro Luca   **Operação:** donos e gestores das empresas (sócio dono do cliente, quando o contrato for repassado), Daniel Faria (patrocinador)   **Dono do código:** Pedro Luca; merge do Eliezek   **Data:** 29/10/2026

**Estado:** aprovado pelo Pedro em 29/10/2026 ("Contrato ok"). Moldura comum (menu, regras gerais): `faturamento.md` §1. Origem: call de 27/10/2026 e decisões do Pedro de 29/10 (spec §13.4, `PM Work/execution/portal-faturamento-prd-20261013/e2/call-27-10-recorrente.md`).

## Propósito
- **Pergunta (`<h1>`):** "Quais contratos do mês precisam da minha resposta?"
- **Público:** dono, gestor e substituto de cada empresa (`receita.fat_donos`) e quem recebeu um contrato por repasse. A controladoria vê todas as empresas, sem responder.
- **Decisão ou ação que provoca:** antes do faturamento, o dono confirma, ajusta ou segura o contrato que mudou. O que não mudou fatura sozinho (decisão 3 de 29/10). A dor que resolve: contrato que venceu e foi renovado pelo sócio parou de faturar sem ninguém ver; contrato cadastrado pela metade; honorário renegociado; cliente que saiu.
- **Métrica de sucesso:** nenhum contrato com mudança faturado sem resposta do dono; a auditoria de faturamento do mês seguinte não acha diferença que o portal não tenha mostrado antes.
- **Arquétipo:** Fila de trabalho.
- **Universo (`descricao`):** "Contratos recorrentes de {PAC} (ou das suas empresas) · competência nov/2026 · contrato".

## De onde vem cada linha
- **O contrato** é o do Omie da empresa, lido todo dia às 6h: número, cliente, projeto, itens, valor do mês, dia de faturamento, dia de vencimento e vigência. O portal não cadastra contrato: o Rafael (CS) segue cadastrando no Omie.
- **O mês anterior** é o que foi faturado de fato: as notas (NFS-e) e os recibos do Omie ligados ao contrato no mês anterior.
- **Dono da linha:** os donos da empresa que fatura, até alguém repassar o contrato a outro sócio (decisão 2 de 29/10). O repasse vale para os meses seguintes.
- **Novembro de 2026 é o primeiro ciclo.** Os contratos com faturamento de 1 a 10/11 saem pela automação do Omie, que a Ludmilla só desliga em 11/11 (decisão 1). Eles aparecem num grupo recolhido, "Faturados pela automação do Omie", só para conferência. O portal responde pelos contratos do dia 13 em diante: o corte de 13/11 leva os do dia 15, que cai num domingo de feriado.

## O que mudou (um selo por motivo; a linha pode ter mais de um)
| Motivo | Regra | Selo |
|---|---|---|
| Contrato novo | vigência inicial no mês, ou o contrato não teve nota no mês anterior | `info` "Contrato novo" |
| Valor diferente | valor do contrato no Omie ≠ total faturado no mês anterior (diferença acima de R$ 0,01) | `atencao` "Era R$ 12.000 em out" |
| Vence neste mês | vigência final dentro do mês | `atencao` "Vence em 30/11" |
| Faturou e sumiu | teve nota no mês anterior e o contrato não está mais vigente | `perigo` "Faturou em out, sem contrato" |
| Sem mudança | nenhum dos anteriores | sem selo |

## Situação da linha (um rótulo, um tom)
| Estado no banco | Palavra na tela | Tom |
|---|---|---|
| `precisa_resposta` | Precisa de resposta | `atencao` |
| `fatura_sozinho` | Fatura sozinho | `neutro` |
| `confirmado` | Confirmado | `sucesso` |
| `ajustado` | Valor ajustado | `info` |
| `nao_fatura` | Não fatura este mês | `neutro` |
| `encerrado` | Encerrado | `neutro` |
| `sem_resposta` | Sem resposta: não fatura | `perigo` |
| `faturado` | Faturado | `sucesso` |
| `faturado_diferente` | Faturado diferente | `perigo` |
| `faturado_omie` | Faturado pelo Omie | `sucesso` |

`sem_resposta`: a linha com mudança que chega ao prazo sem resposta não entra na lista do corte e volta ao dono com o aviso. É a regra 2 da spec com o ajuste da Ana de 20/10: o OK só é obrigatório quando há mudança.

## Anatomia (ordem fixa)
1. `PageHeader`: pergunta, universo, `procedencia` ("Contratos lidos do Omie hoje às 06:00 · notas de outubro lidas às 06:10").
2. **Mês e empresa:** seletor do mês (nov/2026 é o primeiro) e fichas de empresa com a contagem do que precisa de resposta ("PAC 12 · PMC 5 · Todas 17"), na URL.
3. **Ritmo:** três `KpiCard` que filtram a tabela.
4. **Higiene:** três contadores clicáveis.
5. `BarraFiltros`: busca (cliente, CNPJ, número do contrato), projeto, motivo, situação e dia de faturamento, na URL, com chips e "N de M".
6. **Tabela agrupada por projeto** (o "grupo" do cliente no Omie). Na linha do grupo: projeto, contratos, R$ do mês anterior, R$ deste mês e a diferença. Dentro do grupo, primeiro o que precisa de resposta, com o prazo mais curto antes, e depois o resto por valor.
7. Clique na linha abre `Sheet` lateral com o contrato e as respostas, sem trocar de rota.
8. Seleção em lote: "Confirmar selecionados" para as linhas com mudança que o dono aceita como estão.
9. `Procedencia` no rodapé.

### Colunas
| Coluna | Conteúdo |
|---|---|
| (seleção) | caixa, só nas linhas que podem ser confirmadas |
| Cliente | nome; CNPJ abaixo |
| Empresa | apelido (some com uma empresa só no filtro) |
| Contrato | número no Omie; serviço principal abaixo |
| Fatura em | data do corte da linha ("13/11") |
| Mês anterior | R$ faturado (soma das notas e recibos do contrato); "—" quando não houve |
| Este mês | R$ do contrato no Omie ou o valor ajustado |
| Diferença | R$ e %, só quando há |
| O que mudou | selos da tabela acima |
| Situação | `StatusBadge` |
| Responder até | data e hora ("12/11 23:59"); some quando não precisa de resposta |
| (botão) | "Responder" quando precisa de resposta; nada nas outras |

### `Sheet` do contrato
- Cabeçalho: cliente, contrato, empresa, `StatusBadge`, dono (com "Repassar").
- Blocos: itens do contrato (serviço, quantidade, valor), vigência, dia de faturamento e de vencimento; as notas dos três últimos meses (número, data, valor), com "Abrir no Omie"; o histórico de respostas (quem, quando, o quê, motivo).
- Respostas no rodapé, conforme o motivo:
  - qualquer mudança: **Confirmar** (fatura o valor do contrato), **Ajustar o valor deste mês** (valor e motivo), **Não faturar este mês** (motivo);
  - vence neste mês: também **Renovado até** (nova vigência final) e **Encerrar o contrato** (último mês ou já encerrado);
  - faturou e sumiu: **Faturar este mês** (valor e motivo, por exemplo "renovado em contrato novo") e **Cliente saiu** (encerra).
- Uma resposta pode ser trocada até o prazo da linha.

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Precisam de resposta | linhas em Precisa de resposta. Nota: R$ deste mês | contrato | `ops.fat_contratos_mes` | ao abrir e a cada resposta | filtra a tabela | sim |
| Faturam sozinhos | linhas em Fatura sozinho. Nota: R$ | contrato | idem | idem | filtra | sim |
| Respondidos | Confirmado + Valor ajustado + Não fatura + Encerrado. Nota: R$ que vai faturar | contrato | idem | idem | filtra | sim |
| Higiene · Fecha em até 2 dias úteis | Precisa de resposta com prazo em até 2 dias úteis | contrato | idem; feriados nacionais | idem | filtra | sim |
| Higiene · Vence neste mês | linhas com o motivo Vence neste mês | contrato | idem | idem | filtra | sim |
| Higiene · Faturou e sumiu | linhas com o motivo Faturou e sumiu | contrato | idem | idem | filtra | sim |
| Contagem na ficha da empresa | Precisa de resposta nessa empresa | contrato | idem | idem | filtra a empresa | sim |

## Estados
- **Carregando:** `Carregando variante="pagina"`.
- **Erro:** `EstadoErro` com o que falhou e "Tentar de novo".
- **Vazio do mês:** "Nenhum contrato precisa da sua resposta em nov/2026. {N} faturam sozinhos." com o filtro limpo.
- **Sem empresa:** quem não é dono, gestor nem recebeu repasse vê "Você não responde por contrato de nenhuma empresa. Quem cadastra donos é a controladoria."
- **Omie sem leitura de hoje:** faixa `atencao` "Contratos da {PAC} lidos pela última vez em {data}: o que mudou depois não aparece." Some quando a leitura volta.
- **Mês fechado:** depois do último corte do mês, a tela vira leitura, com a situação final de cada linha.

## Filtros na URL (N7)
`mes`, `empresa`, `projeto`, `motivo`, `situacao`, `dia`, `busca`, `contrato` (abre o `Sheet`).

## Permissões (N8)
- Ver: área `faturamento` (`view.faturamento`) e papel na empresa (dono, gestor ou substituto) ou repasse do contrato. Controladoria e admin veem todas as empresas.
- Responder e repassar: dono, gestor ou substituto da empresa, ou quem recebeu o repasse. Sem papel, os botões ficam desabilitados com o motivo "Só o dono, o gestor ou quem recebeu o contrato responde."
- Repassar: só para quem já tem acesso ao Faturamento. Dar acesso a um sócio novo segue com o Pedro.

## Ações
Responder (no `Sheet`), Confirmar selecionados (lote), Repassar, Abrir no Omie.

## O que NÃO entra, e por quê
- **Faturar pelo Brain:** no primeiro ciclo, quem fatura é a tesouraria, no Omie, pela Lista do corte (decisão 4 de 29/10). O Brain fatura sozinho depois de um ciclo sem diferença.
- **Alterar o contrato no Omie pelo portal** (RF-R10): na v1, a tesouraria aplica no Omie o que o dono respondeu (valor novo, renovação, encerramento), pela Lista do corte.
- **Itens variáveis, escalonados e reajuste por índice:** a v1 usa o valor do mês do contrato do Omie; o dono ajusta o mês quando precisa.
- **Cadastro de contrato novo no portal** (RF-R01): o CS segue cadastrando no Omie.
- **Lembretes por e-mail** (RF-R09): o e-mail do portal segue desligado. O prazo aparece na tela e na contagem do menu.

## Para onde manda (tela dona)
Contrato e notas no Omie ("Abrir no Omie"); Lista do corte (`/faturamento/corte`) para a tesouraria.

## Checagem
- [ ] Pergunta e universo no `PageHeader`
- [ ] Procedência no topo e no rodapé
- [ ] Todo número com definição, fonte e drill-down
- [ ] Estados vazio, erro, carregando e sem acesso desenhados
- [ ] Filtros na URL
- [ ] Botão sem permissão diz o motivo
