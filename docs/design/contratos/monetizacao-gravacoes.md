# Contrato · Gravações (`/monetizacao?aba=gravacoes`)

**Dono de produto:** Pedro Luca   **Operação:** closers do pipe 39 (Matheus Carvalho, Willian Linhares)   **Dono do código:** Pedro Luca · Eliezek (merge, `areas.ts`)   **Data:** 02/10/2026
Estado: **conteúdo aprovado no mockup** (https://claude.ai/artifact/GS3D2jtsYttXfmWp4EdzDG, frente 05, 01/10). A forma segue o DS v2 e o arquétipo, não o CSS do mockup. Moldura comum: `monetizacao.md`. Spec: `docs/superpowers/specs/2026-10-02-monetizacao-gravacoes-tela.md`.

## Propósito
- **Pergunta (N1):** "O que foi dito e ofertado em cada reunião do pipe 39?"
- **Público:** o closer (vê só as reuniões dos próprios cards); admin da Monetização (nível 3) e super admin (veem todas).
- **Ação que provoca:** conferir a reunião antes da proposta (o que o cliente disse, o que foi ofertado, a nota pelo playbook) e corrigir o registro do card quando a reunião não tem gravação ("sem registro no card").
- **Métrica de sucesso:** "Sem registro no card" chega a zero, e a fatia "Avaliadas" cresce a cada mês.
- **Arquétipo:** **Lista/Relatório** que abre a **Ficha** ao lado (no celular, em `Sheet`).
- **Universo (`descricao`):** "Reuniões de levantamento com sócio e de proposta dos cards do pipe 39 · mês da reunião em São Paulo · reunião". (Rótulo "levantamento com sócio" desde 09/10/2026, com a renomeação das etapas 4 e 5 do pipe 39.)

## Números
| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Avaliadas | reuniões do recorte com transcrição pronta e nota pelo playbook ("X de N", N = reuniões do recorte) | reunião | `ops.monetizacao_reunioes.status = avaliada` | cron de 5 min | filtra a lista (`gravacao=avaliada`) | sim |
| Sem gravação | reuniões que aconteceram sem o bot: o bot não entrou, a transcrição falhou, ou a reunião é do histórico do card sem pedido ao bot | reunião | `status = sem_gravacao` + histórico do card | idem | filtra a lista | sim |
| Sem registro no card | card parado numa etapa de reunião (levantamento agendado, "4 · Agendado - Levantamento com sócio" desde 09/10, ou reunião de proposta) sem atividade de Reunião com link do Teams | reunião | etapa de hoje do card × `ops.monetizacao_reunioes` | carga do CRM | filtra a lista | sim |
| Na fila do bot | reunião registrada que o bot ainda vai gravar | reunião | `status = na_fila` | cron de 5 min | filtra a lista | sim |

Nenhum número mistura unidade: tudo conta reunião, e N é o mesmo nos quatro (N11).

## A lista
- Uma linha por reunião, a mais recente primeiro (reunião futura no topo). Colunas: Data (dd/mm hh:mm, São Paulo), Empresa (e card), Tipo, Etapa de hoje, Gravação (`StatusBadge`), Nota.
- De onde vem cada linha:
  - **registrada:** `ops.monetizacao_reunioes` (o bot foi pedido pela atividade de Reunião do card), menos as canceladas;
  - **do histórico do card:** levantamento = card que chegou a levantamento agendado ou além (régua cumulativa: etapa em que ficou 30 min, avançou ou terminou); a data é a primeira entrada em levantamento realizado ou além, senão em agendado. Proposta = entrada em "Reunião de proposta" desde 01/10 (funil novo). Linha registrada do mesmo card e tipo substitui a do histórico.
- Gravação: Na fila · Gravando · Avaliada · Sem gravação · Erro · Sem registro no card.
- Acima de 100 linhas, "Mostrar mais 100".

## A ficha
Empresa e card (link para o Pipedrive), tipo, data, closer, etapa de hoje, situação da gravação, e:
- **Avaliação** (quando avaliada): nota /10, blocos, fases com ✔ ◐ ✘ e a recomendação. É a mesma nota que foi ao card.
- **O que foi ofertado**: Cella, Consultoria e Finance, cada um com trecho, minuto e confiança (alta = trecho inteiro numa fala; média = só 12 palavras seguidas), e o que a reunião somou ao campo "Caixa · Produtos ofertados".
- **Transcrição por falante** ("[mm:ss] Falante: texto"), com exportar em .txt.
- Sem gravação: o motivo (bot no lobby, não entrou, sem conversa, reunião sem pedido ao bot).

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | leitura das gravações | `Carregando variante="tabela"` |
| Vazio (sem reunião) | nenhuma reunião no seu acesso | `EstadoVazio` com o motivo (closer sem card com reunião, ou quem não é closer nem admin) |
| Vazio por filtro | mês, situação ou busca sem linha | `EstadoVazio total={n}` |
| Transcrição ainda não pronta | gravação em curso ou transcrevendo | texto com o prazo (40 a 50 min depois do fim) |
| Erro | RPC fora (migration pendente) ou rede | `EstadoErro` com a fonte |
| Sem acesso | sem `view.monetizacao` | moldura (`EstadoSemAcesso oQueFalta="view.monetizacao"`) |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `mes` | `aaaa-mm` | todos os meses | mês da reunião (São Paulo) |
| `gravacao` | `na_fila`, `gravando`, `avaliada`, `sem_gravacao`, `erro`, `sem_registro` | todas | situação da gravação |
| `q` | texto, até 80 caracteres | vazio | empresa, card ou closer |
| `reuniao` | chave da reunião | nenhuma (a primeira da lista no desktop) | ficha aberta |

## Permissões (N8)
- Área: Monetização (`view.monetizacao`).
- **Trava no servidor:** RPC `security definer` `ops.monetizacao_gravacoes_lista()` e `ops.monetizacao_gravacao(event_id)`. Closer = login do Brain com o mesmo e-mail do usuário do Pipedrive dono do card (`ops.monetizacao_closers`). Admin = `ops.nivel_na_area(…,'monetizacao') >= 3` (o super admin é 4). Com "ver como" ativo, ninguém é admin. A RLS de `ops.monetizacao_reunioes` segue a mesma regra.
- Quem tem `view.monetizacao` mas não é closer nem admin vê a tela vazia, com o motivo.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Exportar transcrição (.txt) | quem vê a reunião | nenhuma | arquivo baixado |
| Exportar lista (CSV, sem transcrição) | quem vê a tela | nenhuma | arquivo baixado |
| Abrir o card no Pipedrive | quem vê a reunião | nenhuma | nova aba |

## O que NÃO entra, e por quê
- O MeetGeek da Monetização (1 reunião de 10/09, fora do banco) e as gravações do Brain Meet pedidas à mão (`pedido-…` sem `monet`): não estão ligadas ao card.
- Editar a nota, o ofertado ou o card: a tela só lê. O campo do pipe é escrito pela Edge Function, atrás da chave `MONET_GRAVAR_OFERTADOS`.
- Vídeo e áudio: ficam no Brain Meet (Growth).
- Reuniões de proposta de setembro: a etapa só existe desde 01/10.

## Para onde manda
Pipedrive (o card e a nota de avaliação). A régua de reuniões do mês fica na Operação diária.

## Checagem
- [x] Definição de pronto de `docs/design/README.md` (captura só no claro e no celular, por pedido do orquestrador)
- [x] Números conferidos na fonte (montagem testada contra a carga real de 02/10)
