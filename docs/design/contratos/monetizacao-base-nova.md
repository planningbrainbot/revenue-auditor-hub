# Contrato · Monetização › Base nova (`/monetizacao?base=nova&aba=operacao|pre-venda|fechamentos`)

**Dono de produto:** Pedro Luca   **Operação:** Matheus Carvalho (gestor do pipe 40) e Jordana Vieira (apresentação)   **Código:** Pedro Luca   **Data:** 16/10/2026

PRD: https://claude.ai/artifact/9SapRMdQ3ydy8srToQ7NSn (aprovado em 16/10/2026: "gere um PRD, e trabalhe na sequência" e
"publica direto"). Processo de origem: "Diagnóstico de Oportunidades e Riscos", v1.0 de 15/10/2026.

## Propósito
- **O que muda:** Operação diária, Pré-venda e Forecast ganham um seletor no topo, "Base antiga · pipe 39" (padrão, a tela de
  sempre) e "Base nova · pipe 40" (este contrato). A base nova é o cliente vendido pelo Inside Sales, que passa por um
  diagnóstico durante o onboarding, sem cadência de pré-venda.
- **Perguntas (N1):**
  - Operação: "O diagnóstico da base nova anda no prazo, e onde trava?"
  - Pré-venda › Hoje: "O que o Matheus e a Jordana fazem hoje no diagnóstico?"
  - Pré-venda › Ritmo: "As tarefas do diagnóstico estão saindo no dia?"
  - Pré-venda › Aderência: "O processo do diagnóstico está sendo seguido?"
  - Pré-venda › Ficha: "Onde está cada card do diagnóstico, e o que falta nele?"
  - Forecast: "Quanto o diagnóstico deve fechar, e quando?"
- **Público:** Matheus, Jordana, Paulo e Pedro na daily.
- **Decisão que provoca:** cobrar a área atrasada, apresentar dentro do prazo prometido, não deixar card parado.
- **Arquétipos:** Operação e Forecast = Visão geral; Pré-venda › Hoje = Fila de trabalho; Ritmo e Aderência = Visão geral;
  Ficha = Ficha.
- **Universo:** pipe 40 inteiro (cards abertos, ganhos e perdidos) · São Paulo · card.

## Números
| Número | Definição | Unidade | Fonte e régua | Frescor | Drill-down | Bate? |
|---|---|---|---|---|---|---|
| Entraram no diagnóstico | cards criados no período | card | `add_time` | 5 min | lista de cards | sim |
| Em execução agora | abertos na 04 | card | etapa atual | 5 min | lista | sim |
| Apresentados no período | entraram na 07 no período | card | histórico de etapas | 5 min | lista | sim |
| Ganhos no período | ganhos no período | card | `won_time` | 5 min | lista | sim |
| Receita em jogo | Σ produtos do card × probabilidade da etapa, abertos | R$ | produtos do card (honorário da Jordana) e probabilidade do pipe 40 | 5 min | cards com produto | sim |
| Funil (8 etapas + Ganho) | coorte do período, cada card até a etapa mais adiantada; taxa = etapa ÷ a de cima; Hoje = pipe inteiro agora | card | histórico + etapa atual | 5 min | lista por linha | sim |
| Relógio | dias desde o D0 contra o prazo prometido; em risco ≤ 5 dias; apresentado = chegou à 07 | card | campos D0 e prazo do card | 5 min | lista por situação | sim |
| Áreas | status de cada área nos cards que chegaram à 04; atrasada = pendente depois de D+20 (Real) ou D+45 (Presumido) | card | campos de status do card | 5 min | lista | sim |
| Hoje | tarefas do dia e vencidas por pessoa; parados além da estagnação da etapa; prazo em ≤ 5 dias; sem tarefa aberta | atividade / card | atividades do card no Pipedrive; 01–04 do Matheus, 05–08 da Jordana | 5 min (30 min para as atividades de card sem mudança) | lista | sim |
| Ritmo | previstas (vencimento no dia), feitas (marcadas no dia), vencidas, etapas avançadas por quem moveu | atividade / passagem | atividades e histórico | idem | — | sim |
| Aderência ao processo | passagens no período que cumpriram o "para avançar" da etapa deixada ÷ passagens conferíveis | passagem | dado do card de agora (o Pipedrive não guarda o campo no instante) | idem | lista por regra | sim, e a tela avisa a régua |
| Forecast por horizonte | fechamento = prazo prometido + 7 dias | R$ / card | campos do card | 5 min | lista | sim |
| Conversão por área | vendido ÷ apresentado com o produto | card | produtos e status | 5 min | lista | sim; venda parcial tira o produto do card (regra do processo) |

## Estados
| Estado | Quando | Mostra |
|---|---|---|
| Carregando | RPC em curso | `Carregando variante="kpis"` |
| Carga nunca rodou | `sync.measured_at` vazio | `EstadoVazio` |
| Pipe vazio | nenhum card no pipe 40 | `EstadoVazio` com de onde os cards nascem |
| Entrada ou tarefas desligadas | `resumo.entrada.ligada`/`resumo.tarefas.ligada` falsos | aviso com a prévia (quantas vendas e tarefas nasceriam) e a lista das vendas |
| Carga falhou | `sync.status = error` | `EstadoErro` com a data da última carga boa |
| Sem acesso | sem `view.monetizacao` | `EstadoSemAcesso` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `base` | `nova` | ausente = base antiga | as três abas |
| `de`, `ate` | aaaa-mm-dd | mês corrente | Operação, Ritmo, Aderência |
| `unidade` | ids separados por vírgula | todas | Operação |
| `regime` | `real`, `presumido` | os dois | Operação |
| `pessoa` | 28381245 (Matheus), 24067177 (Jordana) | os dois | Pré-venda |
| `visao` | `ritmo`, `aderencia`, `ficha` | Hoje | Pré-venda |
| `card` | id do card | o mais recente | Pré-venda › Ficha |

## Permissões (N8)
- Mesma porta das outras abas: `ops.monetizacao_can('view.monetizacao')`; recorte por unidade igual a
  `ops.monetizacao_deals_leitura()` (unidade da venda, Matriz = Goiânia). A prévia das vendas que ainda vão entrar só sai
  para quem vê todas as unidades.

## O que NÃO entra, e por quê
- A base nova não entra no IDU, no ranking das unidades nem nos Cockpits: a carga é separada (`ops.monetizacao_diagnostico_*`)
  e esses leitores leem `ops.monetizacao_deals` sem filtro de pipe. Entrar exige decisão do Pedro.
- Avaliação de ligação e gravação da apresentação da Jordana (o bot de reuniões existe; ligar ao pipe 40 depois).
- Meta: não há meta de diagnóstico definida.

## Para onde manda
- Cada empresa abre o card no Pipedrive. A Ficha abre pela URL (`card`).

## Checagem
- [x] Régua testada (`tests/monetizacao-diagnostico-tela.test.mjs`, `tests/monetizacao-diagnostico.test.mjs`)
- [ ] Conferência com dado real: só depois de o pipe 40 ter cards (entrada automática desligada até o "pode ativar")
