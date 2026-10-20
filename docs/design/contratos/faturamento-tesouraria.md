# Contrato · Faturamento › Fila da tesouraria (`/faturamento/tesouraria`)

**Dono de produto:** Pedro Luca   **Operação:** tesouraria (a pessoa do contas a receber indicada pela Ana), Ana Carvalhais (controladoria)   **Dono do código:** Pedro Luca; merge do Eliezek   **Data:** 20/10/2026

**Estado:** rascunho. Aguarda o "contrato ok" do dono (`PROCESSO.md` §4). Moldura comum (menu, situações, simulação, regras gerais): `faturamento.md` §1.

## Propósito
- **Pergunta (`<h1>`):** "Qual pedido eu confiro e faturo agora?"
- **Público:** tesouraria (papel `fat_tesouraria`, área Faturamento · Tesouraria). Na E1 só o Pedro tem o papel; os testadores (Daniel, a pessoa do contas a receber) entram quando ele der o acesso.
- **Decisão ou ação que provoca:** conferir, faturar pela tela, devolver com motivo, reenviar o que deu erro no Omie. A tesouraria não interpreta regra de negócio: confere e aperta o botão (spec §1).
- **Métrica de sucesso:** nenhum pedido redigitado no Omie; nenhum e-mail de "faturamento realizado" (o status aparece para o dono); erro do Omie resolvido em até 24 h (RNF-05).
- **Arquétipo:** Fila de trabalho.
- **Universo (`descricao`):** "Pedidos que chegaram à tesouraria · {DOC} (ou todas as empresas do seu recorte) · por dia de chegada · pedido".

## Anatomia (ordem fixa)
1. `PageHeader`: pergunta, universo, `procedencia` ("Omie da DOC lido às 14:00; próxima leitura às 18:00 · DOC em simulação: nada é gravado no Omie").
2. **Seletor de empresa:** fichas com o apelido e a contagem de trabalho ("DOC 5 · PIS 2 · Todas 7"), na URL. Empresa com o Omie fora do ar leva, na ficha dela, `StatusBadge` `perigo` "Omie indisponível" (depende do dado; some quando a leitura volta).
3. **Ritmo:** três `KpiCard` que filtram a tabela ao clicar.
4. **Higiene:** três contadores clicáveis que filtram a tabela.
5. `BarraFiltros` com busca, dia e situação, na URL, chips removíveis, "N de M".
6. **Tabela**, agrupada por dia de chegada (o mais antigo em cima) e, dentro do dia, na ordem de trabalho.
7. Clique na linha abre `Sheet` lateral com o pedido resumido e as ações, sem trocar de rota.
8. `Procedencia` no rodapé, visível também nos estados degradados.

### Ordem de trabalho (N5)
- **Por dia de chegada**, o mais antigo primeiro: é o "por dia" da RF-P08 e é tempo de espera, não data de criação do pedido (que N5 proíbe). "Chegou" = o momento em que o pedido entrou na fila do Omie (depois do OK, ou do envio quando o autor é o dono).
- **Dentro do dia:** primeiro Erro no Omie, depois Em conferência, OS criada, Simulado e, por último, Na fila do Omie (que só espera o Omie e não tem ação da tesouraria). Empate: 1º vencimento mais próximo.
- Depois de agir numa linha, o foco vai para a seguinte ("onde parei").

### Colunas
| Coluna | Conteúdo |
|---|---|
| Chegou | hora (dentro do grupo do dia) |
| Pedido | número; cliente abaixo |
| Empresa | apelido (some quando há uma empresa só no filtro) |
| O quê | serviço e projeto, numa linha |
| Documento | "Nota · 3x", "Recibo · à vista", "ND · 2x" |
| Valor | R$ |
| 1º vencimento | data |
| Situação | `StatusBadge` (`faturamento.md` §1.2) |
| Onde parou | o último fato, legível: "OS 3021 criada às 10:12", "Em conferência por Marina", "Omie recusou: 'Chave do Omie da MAROX Serviços suspensa: peça uma nova ao administrador da empresa.'" |
| Próxima ação | verbo e data: "Conferir · vence 24/10", "Faturar · vence 24/10", "Reenviar · erro desde 22/10 10:12", "O Omie tenta às 14:20" |
| (botão) | a ação da linha: Conferir, Faturar ou Reenviar. Na fila do Omie não tem botão. |

### `Sheet` do pedido
- Cabeçalho: número, cliente, `StatusBadge`, "Abrir ficha completa" (vai à Ficha com `volta` desta fila).
- O que a tesouraria confere, em blocos curtos: cliente (nome, documento, situação na Receita, "situação não conferida" quando o autor digitou o nome), e-mails de envio, serviço (descrição e código no Omie), descrição da nota, valor e parcelas com vencimentos, boleto ou pix, competência, departamento, observações, dono e autor, "Empresa confirmada" quando houve o aviso de contrato em outra empresa.
- O que está no Omie: OS (número e etapa, "Abrir no Omie"), cliente no Omie (já existia ou cadastrado pelo portal). Em simulação: "Simulado: nada foi gravado no Omie da {empresa}" e o resumo do que iria (o mesmo da Ficha).
- Ações no rodapé do `Sheet`, uma `default` por situação (tabela "Ações").

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Para faturar | pedidos em OS criada ou Simulado, ainda sem conferência. Nota: R$ da soma | pedido | `ops.fat_fila_tesouraria` | ao abrir e a cada ação | filtra a tabela | sim |
| Em conferência | pedidos em conferência. Nota: R$ da soma | pedido | idem | idem | filtra a tabela | sim |
| Faturados hoje | pedidos que viraram Faturado hoje, pela tela ou direto no Omie. Nota: R$ da soma | pedido | idem; data da nota, ou do evento quando ela não vier | idem | filtra a tabela (`situacao=faturado&dia=hoje`) | sim |
| Higiene · Erro no Omie | pedidos em Erro no Omie | pedido | idem | idem | filtra a tabela | sim |
| Higiene · Vence em até 3 dias sem nota | pedidos sem nota cujo 1º vencimento cai em até 3 dias corridos | pedido | idem | idem | filtra a tabela | sim |
| Higiene · Parado há mais de 1 dia útil | pedidos em OS criada, Simulado ou Em conferência sem mudança há mais de 1 dia útil | pedido | idem; dias úteis com os feriados nacionais | idem | filtra a tabela | sim |
| Contagem na ficha da empresa | pedidos com ação da tesouraria nessa empresa | pedido | idem | idem | filtra a empresa | sim |

Os prazos da higiene (3 dias, 1 dia útil) são proposta. *A decidir pela Ana.* O erro há mais de 24 h (RNF-05) aparece como "há mais de 24 h" na coluna Próxima ação e entra no alerta da T6.

Meta: nenhuma definida para a tesouraria (N13). Os cards de ritmo não mostram meta; se a Ana quiser uma ("faturar em até 1 dia útil depois da OS"), ela entra no card Para faturar.

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | `fat_fila_tesouraria` em curso | `Carregando variante="tabela"` |
| Fila vazia | nada esperando a tesouraria | `EstadoVazio` "Nada para conferir ou faturar agora." + "Faturados hoje: {n}" |
| Vazio por filtro | o filtro não acha nada | `EstadoVazio total={n}` ("Nenhum pedido com esses filtros. 7 na fila.") |
| Empresa em simulação | o Omie dela está em simulação | linhas com "Simulado"; ações funcionam e ficam registradas como simulação; "Abrir no Omie" desabilitado com "Em simulação não há OS no Omie"; `procedencia` nomeia as empresas |
| Omie de uma empresa fora do ar (CA-12) | chave suspensa ou sem permissão | os pedidos dela ficam em Erro no Omie com a mensagem legível; a ficha da empresa leva "Omie indisponível"; **as outras empresas seguem normais** |
| Leitura de status atrasada | a última leitura falhou ou passou de 8 h em dia útil | `procedencia` diz "situação do Omie de {data}, a leitura seguinte falhou"; sem alarme fixo (N9) |
| Erro | `fat_fila_tesouraria` falha | `EstadoErro` com a fonte |
| Sem acesso | sem a área Faturamento · Tesouraria, ou a empresa fora do recorte | o item não aparece no menu; pela URL, `EstadoSemAcesso oQueFalta="Faturamento · Tesouraria"` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `emissora` | apelido, ou `todas` | a empresa com mais trabalho; `todas` se a pessoa tem uma só | tudo, menos as contagens das fichas de empresa |
| `situacao` | `para_faturar`, `em_conferencia`, `erro_omie`, `na_fila_omie`, `faturado` | todas menos `faturado` | tabela |
| `higiene` | `erro`, `vence_3d`, `parado_1du` | nenhum | tabela |
| `dia` | `AAAA-MM-DD` ou `hoje` | todos os dias em aberto | tabela |
| `busca` | número, cliente, documento, projeto | vazio | tabela |
| `pedido` | id | nenhum | abre o `Sheet` daquele pedido (o link do `Sheet` se compartilha) |

## Permissões (N8)
- Área `faturamento_tesouraria` (`edit.faturamento_tesouraria`) e a empresa no recorte da pessoa (`ops.usuario_escopo` / `ops.usuario_empresas`), conferidos pela RPC.
- Dono, gestor, solicitante e controladoria não abrem esta tela (spec §4: conferir e faturar é só da tesouraria).
- Botão de ação que a situação não permite fica desabilitado com o motivo ("Só dá para faturar depois de a OS existir no Omie").

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Conferir | tesouraria | nenhuma | `fat_tesouraria_acao('em_conferencia')`; a linha mostra "Em conferência por {nome}", para o colega não pegar o mesmo |
| Faturar | tesouraria, em OS criada, Simulado ou Em conferência | `AlertDialog` com o efeito: "Faturar FAT-…? O Omie da {empresa} emite a nota de R$ {valor} para {cliente}, com {n} parcelas. Pelo portal não dá para desfazer." Em simulação: "Faturar em simulação? Nada é emitido no Omie; fica registrado o que seria feito." | `fat_tesouraria_acao('faturar')` (enfileira o faturamento da OS, o mesmo comando dos royalties); "Faturando…" até o Omie responder; depois Faturado com o número da nota; `toast` |
| Devolver | tesouraria | `Dialog` com **motivo obrigatório**; o botão só habilita com texto, e o banco recusa vazio (CA-10). Com OS criada, o diálogo avisa: "A OS {nº} continua no Omie da {empresa}." (lacuna 2) | `fat_tesouraria_acao('devolver')`; volta ao autor com o motivo; sai da fila; `toast` "Devolvido a {autor}" |
| Reenviar | tesouraria (e o autor, pela Ficha) | nenhuma; ajuda: "Reenviar não duplica: o Omie reconhece o pedido pelo número" (CA-06) | `fat_pedido_reenviar`; Na fila do Omie |
| Reenviar os erros desta empresa | tesouraria, com empresa escolhida e erros nela | `AlertDialog`: "Reenviar os {n} pedidos com erro da MAROX? Use depois de a chave nova do Omie entrar." | `fat_pedido_reenviar` um a um; `toast` com quantos foram e quantos voltaram a dar erro |
| Abrir no Omie | quem vê | — | link externo da OS, em nova aba; sem OS, desabilitado com o motivo |
| Confirmar cancelamento | tesouraria | `AlertDialog` (o mesmo da Ficha) | `fat_pedido_cancelar`; Cancelado |

Faturamento feito direto no Omie (RF-P08): a leitura de status detecta, o pedido vira Faturado e a linha do tempo diz "Faturado direto no Omie (lido às {hora})". A tela não trata isso como erro.

## O que NÃO entra, e por quê
- **Lista do corte dos contratos recorrentes** (spec §9): é da E3.
- Exceções do pós-corte: E3, tela própria da controladoria.
- Cancelar a nota no Omie pelo portal: a tesouraria cancela no Omie e confirma aqui (RF-P11).
- Cobrança e régua de inadimplência: fora da v1.
- Faturar vários de uma vez: cada nota passa pelo diálogo com o efeito; lote fica para depois de a fila ter volume medido.
- Mexer no pedido (valor, serviço, cliente): a tesouraria devolve com motivo, quem corrige é o autor (spec §1: "não interpreta regra de negócio").

## Para onde manda
- Ficha do pedido ("Abrir ficha completa", com `volta` desta fila).
- Omie (OS e nota), em nova aba.

## Casos de aceite que esta tela cobre
- CA-06 (reenviar não duplica).
- CA-09 (a tesouraria vê todas as empresas do recorte; quem não é tesouraria não abre).
- CA-10 (devolver sem motivo bloqueado).
- CA-12 (Omie de uma empresa fora: erros legíveis nela, as outras seguem, reenviar depois da chave nova conclui sem duplicar).

## Lacunas (para a T1b e a T2, antes da T4)
1. **`fat_fila_tesouraria(p_emissora)` recebe uma empresa.** A ficha "Todas" e as contagens por empresa pedem `p_emissora` nulo = todas do recorte, e a devolução das contagens por empresa e dos três contadores de higiene (calculados no servidor).
2. **Devolver depois da OS criada:** ver `faturamento-pedido.md`, lacuna 3. Decidir na T2 se o reenvio corrigido altera a OS ou se a tesouraria a exclui antes.
3. **Empresa com o Omie indisponível:** a fila precisa saber, por empresa, se o conector a marcou como indisponível (spec §8: 403 ou "aplicativo suspenso" param a fila dela), para a ficha da empresa mostrar.
4. **Atualizar a situação sob demanda (RF-P09):** o mesmo da Ficha (`faturamento-pedido.md`, lacuna 1), aqui por empresa: "Atualizar agora" na `procedencia`.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Ciclo completo em simulação na DOC (T2), com a tesouraria conferindo, devolvendo e faturando pela tela
- [ ] CA-12 ensaiado com uma empresa marcada indisponível e outra normal
