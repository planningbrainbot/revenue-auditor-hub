# Contrato · Tarefas (`/tarefas`, `/tarefas/quadros/$quadroId`)

**Dono de produto:** quem pediu em 22/10/2026 (a confirmar o nome)   **Dono do código:** a decidir por Eliezek   **Data:** 22/10/2026

**Estado:** aprovado em 22/10/2026 ("aprovado pode seguir"), com as propostas padrão: admin não vê quadro de que não é membro; área para todos os papéis da matriz (sócio regional fora); projeto por quadro e departamento em lista única.

## Contexto

Pedido de 22/10/2026: "uma área para gerenciar as tarefas minhas com o Luiz, que é do meu time". Respostas dadas na mesma conversa:

- mora no **Ops atual**, não no sistema novo;
- as tarefas vivem **no próprio Ops** (tabelas próprias, o Ops é a fonte de verdade), sem espelho do ClickUp;
- tem **quadros separados**, e quem cria o quadro **convida outras pessoas**;
- tem **uma tela com todas as tarefas de uma pessoa, de qualquer quadro**;
- cada tarefa tem **responsável, prazo, status em colunas, prioridade, comentários, projeto e departamento**.

O primeiro uso é um quadro com duas pessoas. O desenho já nasce para N quadros e N pessoas.

Não confundir com **Tarefas e compromissos** do Cockpit do COO (`/cockpit-coo/compromissos`): aquela tela espelha o ClickUp do COO e não muda. Esta é um gerenciador de tarefas próprio.

## Propósito

- **Pergunta que responde (h1):**
  - `/tarefas`: "O que está comigo, e o que vence primeiro?"
  - `/tarefas/quadros/$quadroId`: "Em que pé está o trabalho deste quadro?"
- **Público:** qualquer pessoa com login no Ops que tenha a área Tarefas. Dentro dela, cada um só vê os quadros de que é membro.
- **Decisão ou ação que provoca:** pegar a próxima tarefa, mudar o status, cobrar a tarefa atrasada de alguém, redistribuir.
- **Métrica de sucesso:** o quadro do primeiro par está em uso diário depois de duas semanas (tarefas criadas e movidas por semana); "atrasadas" tende a zero.
- **Arquétipo:** Fila de trabalho nas duas telas (lista em `/tarefas`, colunas em `/tarefas/quadros/$quadroId`). A tarefa abre em `Sheet` lateral (Ficha), com o id na URL.
- **Universo medido (`descricao` do PageHeader):**
  - `/tarefas`: tarefas em que a pessoa é responsável, em todos os quadros de que é membro · abertas por padrão · contagem: tarefa.
  - quadro: todas as tarefas do quadro · todas as colunas · contagem: tarefa.

## Modelo

| Coisa | O que é |
|---|---|
| **Quadro** | Espaço de trabalho com nome, descrição, colunas e membros. Ex.: "Eu e Luiz". |
| **Membro** | Pessoa com login no Ops, com papel **dono** ou **membro** no quadro. Quem cria é dono. |
| **Coluna** | Status da tarefa no quadro. Nasce com **A fazer · Fazendo · Feito**; o dono renomeia, cria e reordena. Uma coluna é marcada como "concluída" (é o que tira a tarefa da lista de abertas). |
| **Tarefa** | Título, descrição, responsável (um membro do quadro), prazo (data), prioridade, projeto, departamento, coluna, ordem na coluna. |
| **Prioridade** | Alta · Média · Baixa. Padrão: Média. |
| **Projeto** | Lista do quadro (cada quadro tem os seus). Opcional. |
| **Departamento** | Lista única do Ops, a mesma em todos os quadros, para dar para filtrar "tudo de Financeiro" entre quadros. Opcional. |
| **Comentário** | Texto com autor e data, na ficha da tarefa. O autor edita e apaga o próprio. |
| **Histórico** | Toda mudança de coluna, responsável, prazo e prioridade fica registrada, com quem e quando. Aparece na ficha. |

## Números

| Número (rótulo exato) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | O destino bate? |
|---|---|---|---|---|---|---|
| Abertas | tarefas da pessoa (ou do quadro) fora da coluna concluída | tarefa | `ops.tarefas` | ao vivo | filtro `status=abertas` | sim |
| Atrasadas | abertas cujo dia do prazo em São Paulo já passou | tarefa | idem, dia de São Paulo (mesma régua do COO, DECISIONS 29/09) | ao vivo | filtro `prazo=atrasadas` | sim |
| Vencem nesta semana | abertas com prazo de hoje até domingo, dia de São Paulo | tarefa | idem | ao vivo | filtro `prazo=semana` | sim |
| Sem prazo | abertas sem prazo | tarefa | idem | ao vivo | filtro `prazo=sem` | sim |
| Contagem por coluna (quadro) | tarefas na coluna, depois dos filtros | tarefa | idem | ao vivo | a própria coluna | sim |

Os quatro cartões aparecem no topo das duas telas. Tarefa vencendo hoje **não** é atrasada.

## Estados

| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | consulta em curso | `Carregando variante="tabela"` (lista) / `"pagina"` (quadro) |
| Vazio (sem dado) | pessoa sem nenhum quadro | `EstadoVazio` "Você ainda não está em nenhum quadro" + botão Criar quadro |
| Vazio (quadro novo) | quadro sem tarefa | colunas vazias com "Nova tarefa" em cada uma |
| Vazio por filtro | filtro sem resultado | `EstadoVazio total={n}` |
| Erro | falha de leitura | `EstadoErro` com a fonte (`ops.tarefas`) |
| Sem acesso à área | sem a área Tarefas | `EstadoSemAcesso oQueFalta="a área Tarefas (a administração concede)"` |
| Sem acesso ao quadro | não é membro do quadro do link | `EstadoSemAcesso oQueFalta="ser membro deste quadro (peça ao dono)"`, sem mostrar nome nem conteúdo do quadro |

## Filtros na URL (N7)

| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `quadro` (só `/tarefas`) | id de quadro | todos | lista |
| `responsavel` (só no quadro) | user id, `eu`, `ninguem` | todos | colunas |
| `prioridade` | alta, media, baixa | todas | ambas |
| `projeto` | id | todos | ambas |
| `departamento` | id | todos | ambas |
| `prazo` | atrasadas, semana, sem | todos | ambas |
| `status` (só `/tarefas`) | abertas, concluidas, todas | abertas | lista |
| `busca` | texto (título e descrição) | vazio | ambas |
| `tarefa` | id da tarefa aberta na ficha | vazio | `Sheet` |

`/tarefas` é ordenada por: atrasadas primeiro, depois prazo ascendente, sem prazo por último; empate por prioridade.

## Permissões (N8)

- **Área que abre a tela:** área nova `tarefas` em `ops.areas`, concedida por papel em `/admin/permissoes` como as outras. Proposta de concessão inicial: todos os papéis internos da matriz (não sócio regional). A decidir pelo dono.
- **Dentro da área, o que vale é ser membro do quadro**, e isso é RLS no banco, não só na tela: quem não é membro não lê nem escreve nada do quadro, nem pela API.
- **Dono do quadro:** convida e remove membros, promove a dono, edita colunas e projetos, renomeia e arquiva o quadro. Um quadro tem sempre pelo menos um dono.
- **Membro:** cria, edita, move e comenta tarefas do quadro; apaga só tarefa que ele criou.
- **Super admin:** não vê quadros de que não é membro. Tarefa de trabalho entre duas pessoas é privada do quadro. (A decidir pelo dono se o admin deve ver tudo.)
- **Departamentos:** a lista é mantida por admin, em Configuração (dentro da área).

## Ações

| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Criar quadro | quem tem a área | não | abre o quadro novo |
| Convidar pessoa | dono do quadro | não | toast "Fulano entrou no quadro"; a pessoa vê o quadro no próximo carregamento |
| Remover membro | dono | `AlertDialog` (as tarefas dele ficam sem responsável) | toast |
| Criar tarefa | membro | não | cartão aparece na coluna |
| Mover tarefa (arrastar ou trocar status na ficha) | membro | não | otimista; desfaz e avisa se falhar |
| Editar campos | membro | não | salva ao sair do campo |
| Comentar | membro | não | comentário aparece na ficha |
| Apagar tarefa | quem criou e dono | `AlertDialog` | toast (sem Desfazer na v1: recriar perderia comentários e histórico) |
| Editar colunas e projetos | dono | apagar coluna com tarefa pede destino | toast |
| Arquivar quadro | dono | `AlertDialog` | some da lista; tarefas somem de `/tarefas` |

**Convite:** só para quem já tem login no Ops, escolhendo a pessoa numa busca por nome ou e-mail. Quem ainda não tem login entra pelo `/cadastro` e é liberado como hoje; depois o dono convida. Convite por e-mail para quem não tem conta não entra na v1.

## v2 (22/10/2026, pedidos do dono)

- **Notificação no sino**, por pessoa: tarefa atribuída a você, comentário em tarefa sua, vence hoje (08:00). Quem fez
  a ação não recebe. Clique abre a ficha. Nada por e-mail ou WhatsApp ainda.
- **Prazo de entrega e responsável obrigatórios**, também no banco. Exceção: responsável que sai do quadro.
- **"Nova tarefa" no topo de cada coluna**, pedindo título, prazo e responsável; a tarefa entra em primeiro.
- **Anexos** na ficha: até 25 MB, qualquer tipo, só membro do quadro vê; apaga quem anexou ou o dono.

## O que NÃO entra, e por quê

- **ClickUp.** Escolha do dono: o Ops é a fonte. Nada é espelhado nem escrito lá.
- **Notificação por e-mail ou WhatsApp** (tarefa atribuída, prazo chegando). A v2 tem o sino; e-mail e WhatsApp seguem fora.
- **Subtarefas, checklist, tarefa recorrente, mais de um responsável, horas.** Cabem depois; cada um complica o cartão e nenhum foi pedido.
- **Ligação com OKR, IDU ou compromissos do COO.** São outra régua e outra tela.
- **Sócio regional e equipe das unidades.** A v1 é para a matriz. Abrir para a rede é decisão do dono depois.
- **Gantt, calendário, relatório de produtividade por pessoa.** A tela não mede gente; mostra trabalho.

## Para onde manda (tela dona)

- `/tarefas` → cartão leva à ficha da tarefa (`Sheet`), e da ficha ao quadro dela.
- Quadro → configurações do quadro (membros, colunas, projetos) em `Sheet` ou `/tarefas/quadros/$quadroId?config=1`.
- Lateral da área Tarefas: **Minhas tarefas**, a lista de **Quadros** de que a pessoa é membro, e **Configuração** (departamentos, só admin).

## Banco (proposta)

Schema `ops`, migration nova com rollback em `supabase/rollback/`:

- `ops.tarefas_quadros` (id, nome, descricao, criado_por, arquivado_em, timestamps)
- `ops.tarefas_membros` (quadro_id, user_id, papel `dono|membro`, adicionado_por, timestamps) · PK (quadro_id, user_id)
- `ops.tarefas_colunas` (id, quadro_id, nome, ordem, concluida bool)
- `ops.tarefas_projetos` (id, quadro_id, nome, arquivado_em)
- `ops.tarefas_departamentos` (id, nome, ativo)
- `ops.tarefas` (id, quadro_id, coluna_id, ordem, titulo, descricao, responsavel_id, prazo date, prioridade, projeto_id, departamento_id, criado_por, concluida_em, timestamps)
- `ops.tarefas_comentarios` (id, tarefa_id, autor_id, texto, editado_em, apagado_em, timestamps)
- `ops.tarefas_eventos` (id, tarefa_id, autor_id, campo, de, para, criado_em), escrito por trigger

RLS em todas: função `ops.eh_membro_tarefas(quadro_id)` (security definer, `search_path` fixo) e `ops.eh_dono_tarefas(quadro_id)`; policies separadas por comando, `INSERT` com `RETURNING` coberto (memória: armadilha do INSERT+RETURNING), nada de `for all`. Responsável tem que ser membro do quadro (trigger). Dono não pode remover o último dono (trigger).

## Checagem

- [x] "contrato ok" do dono (22/10/2026)
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [x] Teste de RLS: quem não é membro não lê nem escreve (SQL como o usuário, não como service role), 22/10/2026
- [ ] Contagens dos cartões conferidas por SQL independente
- [ ] Captura escuro/claro das duas telas e da ficha
