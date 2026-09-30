# Contrato · Cockpit do COO · Expansão (`/cockpit-coo`, `/cockpit-coo/compromissos`, `/cockpit-coo/perguntar`)

**Dono de produto:** Pedro Luca   **Usuário:** COO da Expansão (Paulo Carvalho)   **Dono do código:** Pedro Luca (tela) · Eliezek (casca, área, publicação)   **Data:** 29/09/2026

**Revisão de 30/09/2026 (pedido do Pedro):** a execução passa a refletir o ClickUp inteiro da Expansão (tarefas das áreas, não só os compromissos da rotina), a quinta abre com o projetado × realizado do módulo de Monetização, e o guia do Paulo (https://claude.ai/artifact/XxbsHNypspDLro5fQdMHBV) descreve a tela nova. As seções abaixo já estão na versão de 30/09.

**Estado:** a proposta foi aprovada pelo COO em 29/09/2026, com ajustes. A página de aprovação é https://claude.ai/artifact/7sXeQ6Jbn1XApEbJpYKzrJ, e as respostas estão registradas na spec, na seção "Revisão de 29/09/2026". O Pedro deu o "pode rodar tudo" no mesmo dia. Falta o "contrato ok" formal no PR.

Spec: `docs/superpowers/specs/2026-09-29-cockpit-coo-expansao-design.md`.

## Propósito
- **Pergunta da área:** "A rede está no pacto, o que travou nesta semana e o que eu cobro de quem?" Cada tema tem a sua pergunta, no `<h1>` (N1):

  | Tema | Pergunta (`<h1>`) |
  |---|---|
  | Seg · Growth | A matriz está gerando e convertendo demanda para as unidades no ritmo do trimestre? |
  | Ter · Financeiro e Operações | O negócio se sustenta, para onde aponta o caixa e a entrega está andando? |
  | Qua · CS e RH | Os clientes e as equipes das unidades estão saudáveis, e as vagas andam? |
  | Qui · Monetização | A Monetização está entregando o projetado, e quais unidades eu preciso cobrar? |
  | Sex · Estratégico | A rede está no pacto e o que eu levo para a próxima semana? |
  | Tarefas e compromissos | O que está combinado no ClickUp, quem está devendo e o que vence esta semana? |
  | Perguntar ao Brain | O que você quer saber da rede nesta semana? |
- **Público:** o COO da Expansão. A área `cockpit_coo` é liberada só para `admin`, e o COO entra pela tela de acessos.
- **Decisão ou ação que provoca:** em cada reunião da semana, olhar o tema do dia e transformar cada alerta num compromisso no ClickUp, com dono e prazo. Na mesma reunião da semana seguinte, conferir o que foi cumprido.
- **Métrica de sucesso:** o COO conduz a reunião do dia só com a tela. Os compromissos da semana têm dono e prazo, e a revisão de sexta mostra quantos foram cumpridos no prazo.
- **Arquétipo:** os temas são Visão geral; Tarefas e compromissos é Fila de trabalho; Perguntar ao Brain está fora dos cinco arquétipos, como a do CEO.
- **Universo (`descricao`):** "15 unidades · 11 da rede regional (8 em operação) · 4 de operação própria". Com filtro, a linha muda para a unidade ou o grupo escolhido.

## Anatomia de um tema (ordem fixa)
1. `PageHeader`, com:
   - a pergunta;
   - o universo;
   - a procedência resumida;
   - o selo "Reunião de hoje" no tema do dia;
   - o botão "Perguntar ao Brain";
   - o filtro de unidade.
2. "Limites desta leitura": uma linha recolhida (N9, sem alarme fixo).
3. Até 6 `KpiCard`, em 3 colunas. Cada nota tem uma informação só; o motivo inteiro fica na gaveta.
4. Duas caixas lado a lado:
   - "O que pede atenção": até 3 itens, com [Abrir] e [Virar compromisso] ou o compromisso que já existe;
   - "Execução no ClickUp": as tarefas das pastas dos departamentos do tema (KRs, entregas, direcionamentos) e os compromissos da rotina do tema. Mostra abertas, vencidas, que vencem em 7 dias, sem dono e feitas desde a última reunião, e até 5 destaques, vencidas primeiro, cada um com link para o ClickUp.
5. Dois gráficos lado a lado:
   - o primeiro gráfico do tema;
   - "Como evoluem os OKRs deste tema?", a série diária por departamento contra o esperado do ciclo.

   Os outros gráficos do tema vêm embaixo, dois por linha quando há mais de um.
6. A gaveta (`?detalhe=`), com:
   - o que diz;
   - como se calcula;
   - que unidades cobre;
   - atenção;
   - dono;
   - a tela dona;
   - "Perguntar ao Brain";
   - os dados em tabela.

## Números
Todos os números de hoje foram conferidos contra SQL independente, na sessão do COO, com os scripts `scripts/cockpit-coo/homologar-*.mjs`.

**Seg · Growth**

| Número | Unidade de contagem | Fonte e régua | Cobre | Destino | O destino bate? |
|---|---|---|---|---|---|
| MRR novo vendido × meta | reais | `growth.dist_metas` do trimestre | todas as do filtro | Growth · unidades | não, e a tela avisa |
| Contratos novos no trimestre | contratos | `ops.contratos`, só o pipe Inside Sales (o lote do pipe Sócios fica fora) | todas | Indicadores do trimestre | não, e a tela avisa |
| Ticket médio | reais | mesma fonte; variação % contra o trimestre anterior | todas | idem | não, e a tela avisa |
| Mídia investida no trimestre | reais | série mensal do Growth; ROAS na nota | grupo | Growth · tráfego | não, e a tela avisa |
| Custo de mídia por contrato | reais | mídia ÷ vendas da rede (CAC por unidade não é medido) | grupo | idem | não, e a tela avisa |
| Oportunidades abertas no Broker | oportunidades | `ops.broker_oportunidades` | todas | Broker | sim |

**Ter · Financeiro e Operações**

A porta dos quatro números do grupo é a do CEO: produto Financeiro e todas as empresas. O COO só tem a PARTNERS, então vê "sem acesso" até o dono do Financeiro abrir.

| Número | Unidade de contagem | Fonte e régua | Cobre | Destino | O destino bate? |
|---|---|---|---|---|---|
| Saldo em caixa | reais | `fn_cockpit_caixa_livre` (12 de 15 empresas) | grupo | Brain Financeiro | não, e a tela avisa |
| Geração de caixa por mês | reais | `fn_dfc_matriz` (com cache), média dos 3 meses fechados; fôlego na nota | grupo | idem | não, e a tela avisa |
| Exposição de caixa em 30 dias | reais | `fn_aprovacoes_caixa`, vencimentos de hoje a hoje + 29 | grupo | idem | não, e a tela avisa |
| Resultado da DRE no ano | reais | `fn_dre_comp_caixa` em blocos de 3 meses; projeção pelo ritmo; sem orçado | grupo | idem | não, e a tela avisa |
| Repasse da rede no mês fechado | reais | apuração de royalties confirmada (royalties + CSC) | rede | Apuração de Royalties | sim |
| Onboarding parado há mais de 30 dias | clientes | `ops.cs_onboarding_cards` | todas | Painel de CS | não, e a tela avisa |

**Qua · CS e RH**

| Número | Unidade de contagem | Fonte e régua | Cobre | Destino | O destino bate? |
|---|---|---|---|---|---|
| Churn no trimestre | percentual | Central de Tratativas (churn confirmado) × MRR dos contratos | todas que usam o pipe | Painel de CS | não, e a tela avisa |
| Tratativas de cancelamento abertas | tratativas | `ops.central_tratativas` | todas | idem | não, e a tela avisa |
| NPS no trimestre | pontos | `ops.nps_pesquisas`, mínimo de 5 respostas | todas | NPS | não, e a tela avisa |
| Auditorias internas em andamento | auditorias | `ops.auditorias_internas` | todas | Auditoria Interna | sim |
| Admissões no mês | pessoas | `ops.gente_pessoas.data_admissao` | todas | Gente | sim |
| Vagas abertas | — | **não apurado**: o PandaPé não tem integração (dona: Heloísa) | — | — | — |

**Qui · Monetização**

Montado no navegador, com a carga da tela da Monetização. O Perguntar ao Brain lê no servidor só a parte do projetado × realizado (negócios e planilhas, na sessão da pessoa); a régua das unidades fica "não apurado" lá, com o motivo.

| Número | Unidade de contagem | Fonte e régua | Cobre | Destino | O destino bate? |
|---|---|---|---|---|---|
| Contratos ganhos × projetado | negócios | `forecastComparison` do módulo: `signed` no mês até o corte do CRM × linha 41 da planilha em uso (cenário padrão da versão mais recente) | grupo (frente inteira) | Monetização · Projetado × realizado | sim |
| Oportunidades validadas × projetado | negócios | idem, `validated` × linha 37 | grupo | idem | sim |
| Reuniões realizadas × projetado | negócios | idem, `meeting` × linha 35 | grupo | idem | sim |
| Leads trabalhados × projetado | negócios | idem, `started` × linha 29 | grupo | idem | sim |
| Unidades engajadas | unidades | régua de engajamento (A 25 + B 35 + C 20) ÷ 80; nota 70 ou mais | todas | Monetização · funil | não, e a tela avisa |
| Unidades paradas | unidades | nota abaixo de 40 | todas | idem | não, e a tela avisa |

Gráficos: "Em que degrau o mês descolou do plano?" (ao lado das OKRs), "Qual produto está abaixo do projetado?" e "Quais unidades estão mais engajadas no projeto?".

Alertas do projetado, antes dos de unidade na mesma gravidade: degrau com realizado abaixo de 70% (crítico) ou 90% (atenção) do projetado proporcional aos dias corridos, com ao menos 2 esperados até hoje; produto com 2 ou mais contratos projetados e nenhum ganho, com metade do mês corrida. Saíram dos cartões, em 30/09, os ganhos e as validadas por unidade, a cobertura da base e os leads sem unidade; os alertas de cobrar a matriz continuam.

**Sex · Estratégico**

| Número | Unidade de contagem | Fonte e régua | Cobre | Destino | O destino bate? |
|---|---|---|---|---|---|
| Unidades no Pacto Trimestral | unidades | IDU igual ou acima de 75, só com metas cadastradas (hoje **não apurado**) | rede | IDU | sim |
| Faturamento da rede · 12 meses | reais | apuração confirmada (a leitura "rede" do CEO) | rede | Apuração de Royalties | sim |
| Peso da maior unidade na rede | percentual | mesma janela | rede | idem | sim |
| OKRs da Expansão · ritmo | percentual | foto diária `growth.okr_snapshot` contra o esperado do ciclo | grupo | — | — |
| Tarefas da semana no prazo | percentual | espelho do ClickUp: tarefas das áreas e compromissos da rotina com prazo na semana | — | Tarefas e compromissos | sim |
| Unidades em implantação | unidades | cadastro sem data de inauguração | rede | Regras da Rede | sim |

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | carga do tema ou da Monetização | `Carregando variante="kpis"` |
| Vazio | fonte lida e sem registro | zero só quando a fonte contou zero; do contrário, "sem registro" |
| Parcial / não apurado | meses incompletos, meta ausente, foto de OKR parada | `KpiCard estado` com a primeira oração do motivo; o motivo inteiro fica na gaveta |
| Fonte indisponível | a consulta falhou (código na gaveta) | `KpiCard estado="indisponivel"`; o gráfico fica hachurado com o motivo |
| Sem acesso | sem a área; sem a porta da fonte (Financeiro, Growth, carga da Monetização) | tela inteira: `EstadoSemAcesso` com a área; por número: "sem acesso" com o motivo |
| ClickUp desconectado | sem token ou com a última rodada da sincronização em erro | as caixas de compromissos e o botão "Virar compromisso" desabilitado dizem o porquê |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `tema` | `growth`, `financeiro-operacoes`, `cs-rh`, `monetizacao`, `estrategico` | o tema do dia (sábado e domingo abrem a sexta) | qual item da lateral está aberto |
| `unidade` | vazio (todas), `rede`, `propria` ou o id da unidade | todas | os números de cobertura "todas" ou "rede"; os de cobertura "grupo" ignoram o filtro e dizem isso |
| `detalhe` | `n:<id>`, `g:<id>`, `okrs` | nenhum | a gaveta aberta; o "voltar" do navegador fecha |
| Tarefas e compromissos: `origem` (`area`, `rotina`), `area` (departamento), `tema`, `dono`, `unidade`, `status`, `higiene`, `tarefa` | — | abertas, todas as origens | a fila e a ficha aberta; origem, área, tema, dono e unidade também mudam os números e os atalhos |

## Permissões (N8)
- **Área:** `cockpit_coo`, criada pela migration `20260929120000`, só para `admin`.
- **Leitura:** a sessão da pessoa (RLS). Cada fonte confere a sua porta antes, e o Financeiro usa a porta do CEO.
- **Escrita no ClickUp:** quem tem a área. O servidor confere a área e só aceita tarefas da lista Compromissos da rotina. As tarefas das áreas são só leitura: a ficha mostra o aviso e o link para o ClickUp.
- **Espelho do ClickUp:** legível só com a área.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Virar compromisso (alerta → tarefa no ClickUp) | área + ClickUp conectado | diálogo com dono, prazo, tema e unidade; aviso de duplicidade do Jev | toast; a caixa passa a mostrar o compromisso. Idempotente pela chave do alerta |
| Concluir, mudar prazo, trocar dono, comentar | idem | botão na ficha | toast; o espelho é atualizado na hora e o evento fica registrado |
| Confirmar ou descartar sugestão do Jev | idem | botão na ficha | a unidade é gravada no ClickUp ao confirmar |
| Perguntar ao Brain | área + orçamento de IA do COO | — | resposta com números conferidos e as frases descartadas à mostra |

## O que NÃO entra, e por quê
- **Vagas do RH:** o PandaPé não tem integração.
- **CAC por unidade:** não existe medição.
- **Orçado da DRE:** a tabela `orcamento` está vazia.
- **Ação da unidade na Monetização:** não tem registro.
- **Histórico da conversa:** esta versão não grava a conversa.
- **Estratégia & Execução:** a área de 21/09 não existe no código. O cockpit lê só a foto de OKR e não recria a área.

## Para onde manda (tela dona)
- **Números da rede e financeiros:** `/unidades/royalties`, `/receita-overview`, `/painel-cs`, `/nps`, `/auditoria-interna`, `/gente`, `/idu`, `/broker/admin`, `/monetizacao`, e o Growth e o Brain Financeiro (externos).
- **Tarefas e compromissos:** o próprio ClickUp.
- **Projetado × realizado:** `/monetizacao?aba=forecast`.

## Checagem
- [x] Portão de design (`design:lint:changed`): 0 violação no escopo.
- [x] Números conferidos na fonte, com recontagem independente dos cinco temas na sessão do COO.
- [x] Checagem de tipos: só sobra o erro que já existia em `integracoes-status.functions.ts`.
- [x] Testes: 474 no total (30/09).
- [ ] "Contrato ok" formal do Pedro no PR.
