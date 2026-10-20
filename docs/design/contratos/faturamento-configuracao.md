# Contrato · Faturamento › Configuração (`/faturamento/configuracao`)

**Dono de produto:** Pedro Luca   **Operação:** Ana Carvalhais (controladoria)   **Dono do código:** Pedro Luca; merge do Eliezek   **Data:** 20/10/2026

**Estado:** rascunho. Aguarda o "contrato ok" do dono (`PROCESSO.md` §4). Moldura comum (menu, situações, simulação, regras gerais): `faturamento.md` §1.

## Propósito
- **Pergunta (`<h1>`):** "Quem pede e aprova em cada empresa, e o que ela já manda ao Omie?"
- **Público:** controladoria (papel `fat_controladoria`, área Faturamento · Controladoria; a Ana). Ligar a gravação no Omie é só do administrador do Brain (na E1, o Pedro).
- **Decisão ou ação que provoca:** cadastrar donos, gestores, solicitantes e substitutos; liberar os serviços que aparecem no pedido; dizer como a empresa fatura; ligar o Pipefy; e, com o "pode ativar" do Pedro, tirar a empresa da simulação.
- **Métrica de sucesso:** toda empresa que entra no portal (DOC e PIS primeiro) tem dono, gestor e serviços liberados antes do primeiro pedido; nenhum pedido devolvido por "serviço não aparece".
- **Arquétipo:** Configuração.
- **Universo (`descricao`):** "Empresas do grupo no seu recorte · situação de agora · empresa". Efeito, na mesma linha: "Mudança de pessoa vale para o próximo pedido; ligar a gravação vale para o próximo envio."

## Anatomia (ordem fixa)
1. `PageHeader` com pergunta, universo e efeito, `procedencia` ("Empresas: cadastro do grupo · serviços: catálogo do Omie sincronizado em {data}").
2. Busca por empresa ou pessoa ("Hugo" mostra as empresas em que o Hugo tem papel) e o filtro "Mostrar empresas inativas".
3. Tabela das empresas (uma linha por empresa).
4. Linha abre `Sheet` da empresa, com três `Secao`.
5. Confirmação de efeito antes de salvar o que alarga acesso ou liga envio de verdade (`AlertDialog`).
6. `toast` de sucesso ou erro (V19) e registro da mudança (ver "Lacunas", item 3).

### Tabela das empresas
| Coluna | Conteúdo |
|---|---|
| Empresa | apelido e razão social |
| Fatura por | OS, Contrato ou Ambos (o mapeamento da Ana) |
| Donos | quantos ativos; primeiros nomes em 13px |
| Gestores | idem |
| Solicitantes | quantos ativos |
| Serviços liberados | "{n} de {m}": ativos com tributação, do catálogo da empresa |
| Omie | `StatusBadge`: Simulação (`info`), Gravando (`sucesso`), Sem chave (`neutro`), Indisponível (`perigo`, com a mensagem legível no `title`) |
| Pipefy | Ligado (`sucesso`) ou Desligado (`neutro`) |

Ordem: empresas com pedido no portal primeiro, depois por apelido. Inativas (AGRO, ROIT, PNC: "não há mais faturamento", Ana em 15/10) só aparecem com o filtro.

### `Sheet` da empresa (`?empresa=DOC`)

**Seção 1 · "Quem responde pela {empresa}?"**
- Três grupos: Donos (com o substituto de cada um), Gestores, Solicitantes. Cada pessoa: nome, e-mail, desde quando, e as ações "Trocar substituto" (só dono) e "Desativar".
- "Adicionar pessoa" abre `Dialog`: pessoa (busca pelo nome entre as pessoas ativas do Brain), papel (dono, gestor, solicitante), substituto (só para dono; padrão: o gestor da empresa, RF-A03). Ajuda abaixo do papel, com o efeito de cada um:
  - Dono: "Responde pelo que é faturado. Dá o OK nos pedidos em que é o dono."
  - Gestor: "Vê todos os pedidos da empresa e substitui o dono ausente."
  - Solicitante: "Cadastra pedidos; eles vão para o OK do dono antes do Omie."
- Se a pessoa ainda não tem a área Faturamento, o diálogo avisa: "{Nome} ainda não abre o Faturamento. Ela só entra quando alguém der o acesso em Administração › Pessoas." Salvar continua possível.
- Mudar o papel de alguém é desativar e adicionar de novo (o histórico fica).

**Seção 2 · "Quais serviços aparecem no pedido?"**
- Lista do catálogo da empresa: descrição, código no Omie, código de serviço (LC 116), código municipal, tributação ("configurada" ou `StatusBadge` `atencao` "Falta tributação no Omie: não aparece no pedido"), e "Aparece no pedido" (`switch`, o campo `ativo`).
- Categoria padrão e conta corrente padrão, editáveis por serviço (são as colunas que a controladoria pode alterar na F1).
- "Sincronizar com o Omie" (`outline`) no topo da seção, com "sincronizado em {data}". Serviço novo no Omie entra desligado; serviço que sumiu do Omie fica marcado "não está mais no Omie" e sai do pedido. Ver "Lacunas", item 1.

**Seção 3 · "Como a {empresa} fala com o Omie e com o Pipefy?"**
- **Fatura por:** OS, Contrato ou Ambos (editável pela controladoria).
- **Chave do Omie:** "Guardada no cofre" ou "Sem chave" (nunca a chave, nem mascarada) e a última leitura ("Lida às {hora}" ou "Falhou às {hora}: {mensagem legível}").
- **Conta corrente padrão da empresa:** só leitura (veio do levantamento do E0).
- **Gravar no Omie** (`switch`; desligado = simulação). Só o administrador do Brain liga. Para a controladoria, fica desabilitado com o motivo "Só o administrador do Brain liga a gravação no Omie (trava da E1)".
- **Criar e mover cards no Pipefy** (`switch`): liga o card no pipe Contas a Receber [FIN][MATRIZ] para os pedidos novos da empresa (decisão 4). Desligado, o card é montado e guardado, sem envio.

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Donos, Gestores, Solicitantes | linhas ativas em donos, gestores e solicitantes, por papel | pessoa | `ops.fat_config` | ao abrir | seção 1 do `Sheet` | sim |
| Serviços liberados | ativos com tributação ÷ todos do catálogo da empresa | serviço | `ops.fat_config` (catálogo `fat_servicos`) | última sincronização | seção 2 do `Sheet` | sim |
| "{n} pedidos esperam o OK dele" (no diálogo de desativar) | pedidos Aguardando OK em que a pessoa é a dona | pedido | `ops.fat_config` (ver "Lacunas", item 4) | ao abrir o diálogo | Pedidos `?pendencia=ok&dono=` | sim |

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | `fat_config` em curso | `Carregando variante="tabela"` |
| Empresa sem ninguém | nenhuma pessoa cadastrada | na tabela, "—" nas colunas de pessoa; no `Sheet`, `EstadoVazio` "Ninguém pede nem aprova pela {empresa} ainda." + "Adicionar pessoa" |
| Catálogo vazio | a empresa nunca foi sincronizada | `EstadoVazio` "O catálogo da {empresa} ainda não veio do Omie." + "Sincronizar com o Omie" |
| Empresa sem chave | sem segredo no cofre (PAI, PMN) | Omie "Sem chave"; os dois `switch` desabilitados com o motivo "A {empresa} não tem chave do Omie no cofre" |
| Omie indisponível | a última leitura deu 403 ou "aplicativo suspenso" | `StatusBadge` "Indisponível" com a mensagem; "Gravar no Omie" segue como está |
| Busca vazia | a busca não acha empresa nem pessoa | `EstadoVazio total={n}` ("Nenhuma empresa com esse nome ou pessoa. {n} empresas ativas.") |
| Erro | `fat_config` falha | `EstadoErro` com a fonte |
| Sem acesso | sem a área Faturamento · Controladoria | o item não aparece no menu; pela URL, `EstadoSemAcesso oQueFalta="Faturamento · Controladoria"` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `busca` | texto (empresa ou pessoa) | vazio | tabela |
| `inativas` | `sim` | ausente | tabela |
| `empresa` | apelido | nenhum | abre o `Sheet` daquela empresa |
| `secao` | `pessoas`, `servicos`, `omie` | `pessoas` | rola o `Sheet` até a seção |

## Permissões (N8)
- Área `faturamento_controladoria` (`admin.faturamento`) e a empresa no recorte da pessoa; conferidos de novo em cada RPC.
- "Gravar no Omie": papel `admin` do Brain, além da controladoria (`PLANO-E1.md`: `modo_omie='gravar'` só admin; Travas: só com o "pode ativar" do Pedro). Desabilitado com o motivo para os outros.
- Tesouraria, dono, gestor e solicitante não abrem a tela. Eles leem quem é dono da empresa no próprio formulário (lista de donos) e na Ficha.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Adicionar pessoa | controladoria | o `Dialog` mostra o efeito do papel antes de salvar | `fat_dono_salvar`; `toast` "{Nome} agora é {papel} na {empresa}" |
| Trocar substituto | controladoria | — | `fat_dono_salvar`; `toast` |
| Desativar pessoa | controladoria | `AlertDialog`: "{Nome} deixa de ser {papel} na {empresa}. {n} pedidos esperam o OK dele; o gestor da empresa continua podendo dar o OK." | `fat_dono_salvar` (ativo = falso); `toast` |
| Liberar ou tirar serviço do pedido | controladoria | — (tirar avisa no `toast` quantos rascunhos usam o serviço) | RPC de serviço (ver "Lacunas", item 1); `toast` |
| Categoria e conta corrente do serviço | controladoria | — | idem |
| Sincronizar com o Omie | controladoria | — | lê o catálogo do Omie da empresa (ver "Lacunas", item 1); `toast` com quantos entraram, mudaram e saíram |
| Fatura por | controladoria | — | `fat_emissora_config`; `toast` |
| Ligar "Gravar no Omie" | administrador do Brain | `AlertDialog`: "A partir de agora, todo pedido da {empresa} que receber o OK cria cliente e OS **de verdade** no Omie da {empresa}, e o Faturar da tesouraria emite nota. Os {n} pedidos simulados continuam simulados e não vão ao Omie." | `fat_emissora_config`; `toast`; a empresa sai da `procedencia` "em simulação" de todas as telas |
| Desligar "Gravar no Omie" | administrador do Brain e controladoria | `AlertDialog`: "Os próximos envios da {empresa} voltam a ser simulados. O que já foi ao Omie fica lá." | idem |
| Ligar "Criar e mover cards no Pipefy" | controladoria | `AlertDialog`: "Cada pedido novo da {empresa} passa a criar um card no pipe Contas a Receber e a mover a fase a cada mudança (OS criada, faturado, recebido). Os pedidos já enviados não ganham card." | `fat_emissora_config`; `toast` |
| Desligar Pipefy | controladoria | — | idem; os próximos cards ficam guardados sem envio |

## O que NÃO entra, e por quê
- **Calendário do corte, parâmetros (salário mínimo, IPCA) e exceções:** E3 (spec §9 lista na Configuração; a E1 não tem contrato recorrente).
- Cadastro das empresas (razão social, CNPJ, criar empresa): é do domínio Rede e Organização e vem do Financial Brain. Aqui só "Fatura por" se edita.
- Colar ou trocar a chave do Omie: a chave entra no cofre por quem administra o banco, nunca pela tela.
- Dar a área Faturamento a alguém: é em Administração › Pessoas. Aqui a tela só avisa quando falta.
- Tratamento próprio da PARTNERS (royalties e CSC) e a migração da PAT: depois da E1 (spec §13.1, decisão 5).
- Mudar o pipe ou o mapa de campos do Pipefy: é da T3, não de tela.

## Para onde manda
- Administração › Pessoas, para dar a área Faturamento.
- Pedidos (`?pendencia=ok&dono=`), a partir do número de pedidos que esperam o OK de quem vai ser desativado.

## Casos de aceite que esta tela cobre
- CA-09, preparação: os donos e gestores cadastrados aqui são o que a RPC usa para recortar.
- Aceite da T1a ("Pedro com admin vê a área") e travas da E1 (gravar só com o "pode ativar").

## Lacunas (para a T1b e a T2, antes da T4)
1. **Serviços sem RPC no plano.** "Sincronizar com o Omie" é carga do conector (service role); proposta: `ops.fat_servicos_sincronizar(p_emissora)`, que enfileira a leitura do catálogo na fila de Integrações. E liberar ou tirar um serviço, categoria e conta corrente (as colunas que a F1 deixa a controladoria alterar) também precisam de RPC, porque o schema `receita` não está exposto: proposta `ops.fat_servico_salvar(p_id, p_dados)`.
2. **Busca de pessoa:** o `Dialog` precisa das pessoas ativas do Brain (nome, e-mail, se já abre o Faturamento). `fat_config` deve devolver isso só para a controladoria, sem abrir a lista de usuários inteira do Ops.
3. **Registro das mudanças da empresa** (`modo_omie`, `pipefy_sync`, `fatura_por`, serviço liberado): `receita.fat_eventos` só aceita as entidades pedido, contrato, item, competência e dono. Decidir na T1b: ampliar a entidade (`emissora`, `servico`) ou registrar em `/atividade`. Ligar a gravação no Omie sem rastro não pode.
4. **Pedidos que esperam o OK de quem vai ser desativado:** contagem por pessoa na resposta de `fat_config` (ou numa chamada à parte), para o diálogo dizer o efeito.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] DOC e PIS configuradas pela tela antes do primeiro pedido da E1 (donos, gestor, serviços liberados)
- [ ] "Gravar no Omie" testado com a controladoria (desabilitado com o motivo) e com o admin (diálogo com o efeito); nada ligado sem o "pode ativar" do Pedro
