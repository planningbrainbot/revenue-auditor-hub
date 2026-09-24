# Contrato · Planning People (`/gente?tela=*`)

**Dono de produto:** Eliezek (People)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09: "padronizar e melhorar TODAS as telas de TODOS os módulos"). Tabelas `gente_*`, RLS, permissões e regras (DECISIONS 14/09, 22/09) não mudam. Levantado em `b5c44d7`.

## Moldura (vale para as 11 telas)
- `PageHeader`: `titulo` = rótulo do menu (`areas.ts`; "Adoção" passa a "Adoção por unidade"), `pergunta` da tela (tabela abaixo), `descricao` com o universo de cada tela (hoje é a mesma frase nas 11). Remove o `TODO(design)`.
- **N6:** a `TabsList` que repete os 11 itens da lateral sai; `?tela=` continua, e os links antigos (`?visao=`, `?aba=`) continuam aceitos.
- **Estados (a correção que mais pesa):** hoje, enquanto carrega, "Minha vez" diz "Nada pendente para você agora", e "Meu time" diz "Você não lidera ninguém"; em várias telas, erro de leitura vira "sem acesso" ou tela em branco (`return null`). Cada tela passa a separar `Carregando`, `EstadoErro` (com a fonte e "Tentar de novo"), `EstadoSemAcesso` (com a chave) e `EstadoVazio`.
- Filtros e seleção (ciclo, rodada, unidade, busca, status) na URL.
- Truncamentos silenciosos (`slice(0,40)`, `slice(0,80)`, `slice(0,120)`) passam a dizer "mostrando 40 de N".

| `tela` | Pergunta (N1) | Arquétipo |
|---|---|---|
| minha-vez | O que está pendente comigo esta semana? | Fila |
| meu-time | Quem do meu time precisa de mim agora? | Fila |
| um-a-um | Com quem estou há mais tempo sem 1:1? | Fila |
| sentimento | Como o time está, e quais são as prioridades da semana? | Lista |
| feedback | Que feedback eu recebi e enviei? | Lista |
| elogios | Quem foi reconhecido, e por quê? | Lista |
| avaliacao | Em que pé está o ciclo de avaliação, e o que falta concluir? | Fila + Ficha |
| pdi | As metas de desenvolvimento estão andando? | Ficha |
| cadastro | Quem são as pessoas da rede, e onde estão? | Lista |
| clima | Como está o eNPS da rede e de cada unidade? | Visão geral |
| adocao | Quais unidades já usam o People? | Lista |

## Números que mudam de rótulo (N11)
- Cadastro: "Pessoas na rede" soma todos os status; passa a "Pessoas cadastradas (todos os status)", e a lista diz "N de M (ativas)".
- Clima: "eNPS" em três lugares com denominadores diferentes; os rótulos dizem o universo ("eNPS da rodada", "eNPS da unidade", "eNPS por departamento"). "—" com menos de 5 respostas (já é assim).
- Avaliação: "Média" de "Meu resultado" passa a "Média das avaliações recebidas (sem autoavaliação)" quando for essa a régua do código; senão declara a régua que é.
- Adoção: "com login = 0" deixa de ser selo vermelho fixo (N9); é número.

## Ações: confirmação e motivo (N8, V6)
| Ação | Hoje | Passa a |
|---|---|---|
| Liberar devolutiva (Avaliação) | irreversível, sem confirmação, aparece em ciclo encerrado | `AlertDialog` com o efeito ("todos os avaliados do ciclo passam a ver a devolutiva"); some em ciclo encerrado |
| Notas do comitê | gravam no `onBlur` mesmo sem mudança | gravam só com mudança, com `toast` |
| Enviar convites (Clima) | dispara e-mail para a rede sem confirmação | `AlertDialog` com o número de destinatários |
| Encerrar rodada (Clima) | sem confirmação | `AlertDialog` |
| Trocar cadência de 1:1 | grava no select | continua, com `toast` de retorno |
| Progresso do PDI | grava sem retorno | `toast` |
| Criar meta (PDI) | aceita clique duplo | desabilitado enquanto grava |
| Enviar feedback · Publicar elogio | desabilitado sem motivo; elogio vazio publica | motivo no tooltip; elogio exige texto |

## Visual
KPIs locais do Clima → `KpiCard`; `Badge` de status → `StatusBadge`; nomes de unidade escritos no código (Cadastro) ficam, marcados como dívida.

## O que NÃO entra
Trilha que substituiria o Qulture (não existe); PDI da Monetização (fronteira declarada em `monetizacao-pessoas.md`).
