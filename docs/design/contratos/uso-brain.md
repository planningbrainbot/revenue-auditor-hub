# Contrato · Uso do Brain (`/uso-brain`)

**Dono de produto:** dono do Ops (aprovou o PRD em 27/10/2026)   **Dono do código:** Ops   **Data:** 27/10/2026

PRD: `wiki/prds/2026-10-ops-uso-do-brain.md` (repo AI Projects). Modelo: a tela `/growth/uso-brain` do Growth.

## Propósito
- **Pergunta que responde (h1):** "Quem está usando o Ops, quanto e em quais telas?"
- **Público:** admin (chave `view.admin.uso`, área Administração).
- **Decisão ou ação que provoca:** cobrar ou treinar quem tem acesso e não usa; tirar do menu tela que ninguém abre; ver se uma tela nova pegou.
- **Métrica de sucesso da tela:** a gestão consegue dizer, numa olhada, o % de quem tem acesso e usou na semana e as 5 telas mais usadas.
- **Arquétipo:** Visão geral, com Ficha da pessoa (detalhe em `?pessoa=`).
- **Universo medido (descricao do PageHeader):** pessoas com acesso ao Ops · semana segunda a domingo, horário de Brasília · minuto ativo (aba visível e interação no último minuto). Uso registrado desde a publicação da coleta.

## Números
| Número (rótulo exato) | Definição | Unidade de contagem | Fonte e régua | Frescor | Drill-down (destino) | O destino bate? |
|---|---|---|---|---|---|---|
| Agora no Ops (28/10/2026) | pessoas com minuto ativo nos últimos 2 minutos, com a tela atual e o início da sessão; recarrega a cada 30 s; respeita o filtro de super admins | pessoa | `ops.uso_minutos` via `ops.uso_brain_agora` | 30 s | detalhe da pessoa | sim |
| Ativos na semana | pessoas com ≥ 1 minuto na semana escolhida | pessoa | `ops.uso_minutos` via `ops.uso_brain_painel` | tempo real | ranking filtrado pela semana | sim |
| % ativos | Ativos na semana ÷ pessoas com acesso ao Ops (`produto_acesso`), "N de M" no rodapé | % | idem + `public.produto_acesso` | tempo real | lista "Sem uso na semana" | sim |
| Horas na semana | soma dos minutos ativos da semana ÷ 60 | hora | idem | tempo real | ranking | sim |
| Média 4 semanas | horas das 4 semanas fechadas anteriores ÷ 4 (semana sem uso conta zero) | hora por semana | idem | tempo real | ranking | sim |
| Ranking (por pessoa) | horas na semana e média 4 semanas, com papel e último uso | hora | idem | tempo real | detalhe da pessoa | sim |
| Telas mais usadas | minutos por rota normalizada na semana, top 10, filtrável por pessoa | minuto | idem | tempo real | nenhum (rota é o link para a tela) | sim |
| Mapa de horário | minutos por dia da semana × hora, últimas 4 semanas | minuto | idem | tempo real | nenhum | sim |
| Sem uso na semana | quem tem acesso e não teve minuto, com último login | pessoa | `produto_acesso` + `auth.users.last_sign_in_at` | tempo real | detalhe da pessoa | sim |
| Detalhe: minutos por dia e sessões | sessão = minutos com intervalo de até 15 min; início, fim, duração, telas | minuto / sessão | idem | tempo real | nenhum | sim |

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | chamada em curso | `Carregando variante="pagina"` |
| Vazio (sem dado na fonte) | nenhum minuto registrado ainda (primeiros dias após a publicação) | `EstadoVazio`: "O uso começou a ser registrado em dd/mm. Os números aparecem conforme o time navega." |
| Vazio por filtro | pessoa ou semana sem uso | `EstadoVazio total={n}` |
| Parcial / não apurado | semana corrente ainda aberta | rótulo "semana em andamento" no seletor |
| Fonte indisponível / erro | falha na função | `EstadoErro` com "ops.uso_brain_painel" (ou "ops.uso_brain_agora" só no bloco Agora no Ops) |
| Ninguém online | nenhum minuto nos últimos 2 minutos | `EstadoVazio` "Ninguém usando o Ops agora" no bloco |
| Sem acesso | sem `view.admin.uso` | `EstadoSemAcesso oQueFalta="view.admin.uso"` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `semana` | segunda-feira AAAA-MM-DD | semana corrente | indicadores, ranking, telas |
| `pessoa` | user_id | nenhum | abre o detalhe da pessoa |
| `admins` | mostrar, ocultar | mostrar | todos os números (R-06) |

## Permissões (N8)
- Área que abre a tela: Administração.
- Chaves dentro da tela: só `view.admin.uso` (leitura; a tela não edita nada).
- Quem não tem a chave: o item não aparece no menu; link direto mostra `EstadoSemAcesso`; a função devolve vazio.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Nenhuma de escrita | | | |

## O que NÃO entra, e por quê
- Uso do Growth e do Financeiro: decisão P-02 do PRD (só Ops na v1).
- Custo de IA e resultado comercial por pessoa: o Ops não tem esses dados.
- Histórico antes da publicação: não existia coleta.
- Minutos de "ver como": o admin simulando não é o sócio usando.

## Para onde manda (tela dona)
- Ficha do usuário em `/admin/usuarios/$userId` (botão no detalhe da pessoa).

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem independente)
