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

## Adendo · 20/10/2026 · O mesmo desenho da base antiga

Pedido do Pedro: "A tela do pipe 40 tem que ter o mesmo design da tela do 39. Os ícones do funil, a estrutura, etc."
Os números, as réguas e os filtros não mudam. Muda o desenho, que passa a usar as mesmas peças da base antiga
(`src/components/monetizacao/funil-desenho.tsx`, compartilhado pelos dois pipes):

- **Cabeçalho:** a assinatura da Caixa de Oportunidade ao lado do Atualizar, como na base antiga.
- **Operação:**
  - quadros em `KpiCard`;
  - ao lado, o funil "Onde o diagnóstico avança e onde trava?", com a mesma grade do funil do pipe 39:
    - ícone em rampa por etapa (01 Building2, 02 BadgeCheck, 03 FolderOpen, 04 ScanSearch, 05 ClipboardCheck,
      06 CalendarClock, 07 Presentation, 08 Scale, Ganho Trophy);
    - colunas Cards, Etapa, Hoje e Taxa, com a taxa na passagem;
    - a linha "Recorte";
  - o relógio fica ao lado do funil, no lugar da série diária;
  - "De que unidade vêm" (quatro colunas soltas) virou "Em que unidade o diagnóstico avança?", o funil em pílulas do
    pipe 39:
    - uma linha por unidade e uma coluna por etapa (01 a 08 e Ganhos);
    - pílula centrada contra os que entraram da unidade, com a taxa em cima e o gargalo em vermelho (3 cards ou mais na
      etapa da esquerda);
    - linha Total.
    A régua é `funisPorUnidadeDiag`: a mesma coorte de `funilDiagnostico`, uma linha por unidade. Ela substitui
    `unidadesDiagnostico`.
  - Áreas e cadastro ficam lado a lado.
- **Pré-venda:**
  - Hoje: uma `Secao` por pessoa, com os cinco números em `KpiCard` (tom só com número acima de zero) e a tabela "O que
    fazer hoje" (vencidas, de hoje e prazo). Os botões soltos e as listas de oito saíram.
  - Ritmo: o gráfico feito com `div` virou o `BarChart` do pipe 39 (tokens de `@/lib/planning/grafico`).
  - Aderência: os quadros em `KpiGrade`.
- **Forecast:** no molde do pipe 39.
  - "Quanto o diagnóstico deve fechar?": quatro `KpiCard`.
  - "Quando deve fechar?": um `KpiCard` por horizonte, e a "Data passou" em perigo. Antes era uma tabela com barra.
  - Lado a lado:
    - "Em que etapa está a receita?", com o ícone em rampa da Operação;
    - "Quanto cada área converte, e por quanto?".

## Adendo · 20/10/2026 · A fila do dia no Forecast e os cards pausados

Pedido do Pedro: "Aqui no forecasting do pipe 40 eu não deveria ter a mesma visão do 39 de fazer hoje > semana > mes?"
Ele escolheu a fila "Régua do processo, já", sem o Jev.

**Forecast › "O que fazer hoje"** (`filaDiagnostico`, em `src/lib/monetizacao/diagnostico.ts`). A pergunta da tela passa a
ser "O que fazer hoje para o diagnóstico fechar?".

O universo são todos os cards abertos, não só a reta final, porque no pipe 40 o fechamento depende do relógio de 30 ou 60
dias. Os pausados ficam fora e são contados à parte.

| Número | Definição | Drill-down |
|---|---|---|
| Fazer hoje | tarefa aberta vencida ou de hoje, prazo do cliente vencido ou vencendo hoje (antes da apresentação), ou card sem tarefa aberta | a fila abaixo |
| Nesta semana | o resto, com tarefa ou prazo do cliente até domingo | a fila |
| Fecha no mês | prazo prometido + 7 dias até o fim do mês | a fila |
| Sem data nem valor | antes do D0, ou sem produto com honorário ("N de total") | a fila |

- **Filtro na URL:** `?fila=semana|mes|semdata`, o mesmo parâmetro do pipe 39. Sem ele, Fazer hoje. Se chegar
  `fila=consultoria`, a base nova abre em Fazer hoje.
- **Fila:** agrupada pela etapa do processo. Cada linha traz:
  - empresa (abre o Pipedrive);
  - unidade, regime e dono;
  - selos "antes do D0" e "sem produto";
  - por que está em Fazer hoje ou Nesta semana;
  - a tarefa aberta que vence primeiro;
  - a última nota do dono, do Matheus ou da Jordana;
  - prazo e fechamento esperado.

Os quadros de receita, horizontes, etapas e áreas continuam abaixo.

**Cards pausados** (pausa de Belém, caso Arcanjo, 19/10).
- **Como a pausa é lida:** pela nota fixada que começa com "Pausado em". A carga passou a ler as notas do card e grava
  `pausa` e `ultima_nota` no retrato.
- **Pré-venda › Hoje:** o card pausado sai de "Parados", "Prazo" e "Sem tarefa aberta" e vai para um sexto quadro,
  "Pausados".
- **Ficha:** mostra o aviso da pausa e quantas tarefas estão guardadas.
- **Régua:**
  - enquanto a nota estiver fixada, o card não recebe tarefa;
  - a tarefa que a pausa tirou do Pipedrive fica com status `pausada` (migration `20261020140000`);
  - quando a nota é desafixada ou apagada, a tarefa volta ao Pipedrive com o mesmo assunto. Se estiver vencida, vence no
    dia útil de hoje;
  - se o card mudou de etapa durante a pausa, a tarefa guardada sai.
