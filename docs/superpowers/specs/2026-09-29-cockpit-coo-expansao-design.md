# Cockpit do COO · Expansão (spec, 29/09/2026)

Branch `docs/cockpit-coo-expansao-spec-20260929`, worktree `PM Work/execution/planning-brain-cockpit-coo-20260929`, a partir da `main` `a2def36`.

**Estado:** rascunho para aprovação do Pedro. Nenhum código, migration ou escrita no ClickUp foi feito.

**Método.** O método Superpowers foi seguido à mão, como nas rodadas do Cockpit do CEO, porque as skills não estão instaladas: `~/.claude/plugins/data/superpowers-inline` continua vazia. Os passos:
1. brainstorming com levantamento do repositório, do banco (só leitura) e do código do ClickUp no Growth (esta spec);
2. plano em lotes (`docs/superpowers/plans/2026-09-29-cockpit-coo-expansao.md`), escrito depois da aprovação;
3. testes das regras críticas (§10) antes do código que elas protegem;
4. execução por lote, com revisão entre lotes;
5. verificação antes de declarar pronto: homologação contra SQL independente, captura comparada com o arquétipo e escrita real numa lista de teste do ClickUp.


## Revisão de 29/09/2026: respostas do COO (esta seção vence o resto da spec onde divergir)

O Paulo Carvalho respondeu à proposta pela página de aprovação (https://claude.ai/artifact/7sXeQ6Jbn1XApEbJpYKzrJ):

| Bloco | Resposta | O que muda |
|---|---|---|
| Quem entra | **ajustar**: "Preciso olhar para todas as unidades, inclusive matriz, consultoria e construção civil." | o perímetro passa a ser **as 15 unidades** do cadastro, em dois grupos, rede regional (11) e operação própria (Goiânia, Construção Civil, Consultoria, São Paulo). O filtro da URL (`?unidade=`) aceita vazio (todas), `rede`, `propria` ou o id. O número que só existe na rede (royalties, repasse, IDU) declara "só rede regional" |
| A semana | aprovo | — |
| Segunda | aprovo | — |
| Terça | **ajustar**: "projeção da DRE e para onde está apontando o nosso caixa… sustentabilidade do negócio e exposição de caixa." | entram quatro números do grupo (Financial Brain, ver abaixo); a pergunta do dia vira "O negócio se sustenta, para onde aponta o caixa e a entrega está andando?" |
| Quarta | **ajustar**: "quantas vagas abertas nós temos com a Heloisa, quantas preenchidas" | **não existe fonte de vagas** no Brain nem no Pipefy; o recrutamento roda no PandaPé, sem integração. O número "Vagas abertas" sai como **não apurado**, com a Heloísa como dona da lacuna; "Admissões no mês" (cadastro de pessoas) entra como número real |
| Quinta | **ajustar**: "quais são as unidades mais engajadas… ser alertado quando isso não acontecer" | régua de engajamento por unidade (abaixo) e dois tipos de alerta: cobrar a unidade e cobrar a matriz |
| Sexta, Compromissos, Assistente | aprovo | — |
| Por último | "trazer em TODAS as análises por área a evolução das OKRs" | todo tema ganha o bloco "OKRs do tema", com a série diária de progresso por departamento contra o esperado do ciclo |

**Terça: os números do Financeiro** (pesquisa de 29/09 no Financial Brain; perímetro = as 18 empresas do grupo, sem corte por unidade):
1. **Saldo em caixa**: `fn_cockpit_caixa_livre`, soma das fotos de saldo por empresa (12 de 15 empresas em 29/09; faltam AGRO, NEO e PARTNERS). Mostra a data da foto mais antiga.
2. **Geração de caixa e fôlego**: `fn_dfc_matriz_calcular` (fluxo realizado, mês do crédito). Fôlego = saldo ÷ queima média dos 3 últimos meses fechados; sem queima, "sem queima".
3. **Exposição em 30 dias**: `fn_aprovacoes_caixa` (saldo + a receber − a pagar com vencimento nos próximos 30 dias). Só a janela de 30 dias; 60 e 90 são artefato (a receita só é emitida no mês). Vencidos a pagar e a receber aparecem na gaveta, à parte.
4. **Resultado da DRE no ano e projeção**: `fn_dre_comp_caixa` (receita por emissão, despesa quando paga). **Não há orçado** (`orcamento` vazia): a comparação "× orçado" é lacuna da Controladoria. A projeção do ano é o ritmo dos 3 últimos meses fechados vezes os meses que faltam, rotulada como estimativa.

A porta é a mesma do Cockpit do CEO: produto Financeiro **e** todas as empresas. **O Paulo hoje só tem a PARTNERS**; até o dono do Financeiro abrir, ele vê "sem acesso" nesses quatro, com o motivo.

**Quinta: engajamento da unidade na Monetização** (pesquisa de 29/09). Hoje todo negócio do pipe é criado e movido pela matriz; não há registro de ação da unidade. A nota (0–100) usa o que existe:
- A · Base pronta (peso 25): elegíveis com contato ÷ elegíveis (a régua de oferta da Base);
- B · Aceite de reunião (35): leads da coorte madura (primeiro "trabalhado" entre D-30 e D-7) com reunião ÷ coorte; 50% vale 100;
- C · Avanço (20): validadas ÷ coorte; 40% vale 100;
- D · Ação da unidade (20): **não existe**; enquanto não existir, nota = (25A + 35B + 20C) ÷ 80. Proposta: campo "Participação da unidade" no pipe da Monetização.
- Faixas: 70+ engajada, 40–69 morna, abaixo de 40 parada; coorte com menos de 5 leads é "sem amostra".
- Alertas: **cobrar a unidade** (parada; caiu de faixa em 7 dias; 5+ leads maduros e nenhuma reunião) e **cobrar a matriz** (50+ elegíveis e menos de 5 leads maduros, ou cobertura abaixo de 5%).

**ClickUp**: a sincronização (`clickup-sync`) e o agendamento de 10 minutos já estão no ar desde 29/09, respondendo "sem token". Colar o token em Administração › Chaves de Integração liga o espelho, a foto diária de OKR e o monitor, sem deploy.

---

## 1. Para quem e para quê

**Usuário: Paulo Carvalho, COO da Expansão** (`paulo.carvalho@planning.com.br`, papel `diretor`, `todas_unidades = true`, com a área `cockpit_ceo` desde 28/09). Confirmado pelo Pedro em 29/09, que também confirmou que a pasta **Rotina Semanal** do ClickUp é do Paulo e que o departamento de Operações é do **Victor Eliezek**.

**O que muda em relação ao Cockpit do CEO:**

| | Cockpit do CEO | Cockpit do COO · Expansão |
|---|---|---|
| Perímetro | empresa inteira (grupo + rede) | **só a rede regional**: Goiânia e as internas ficam fora |
| Cadência | mês fechado, trimestre, trajetória até 2030 | **semana**, organizada pela rotina de cinco dias |
| Verbo | entender e decidir para onde ir | entender, **cobrar e acompanhar** |
| Execução | manda para a tela dona e não executa nada | manda para a tela dona **e registra compromisso no ClickUp** |
| IA | "Perguntar ao Brain" (GPT-5.5; Jev desligado) | Jev na triagem do ClickUp desde o início; "Perguntar ao Brain" no último lote |

**Pergunta do cockpit** (título da área, N1): *"A rede está no pacto, o que travou nesta semana e o que eu cobro de quem?"*

**Perímetro, conferido no banco em 29/09:**

| Grupo | Unidades | Entra? |
|---|---|---|
| Regionais em operação (com inauguração) | Rio de Janeiro, Patos de Minas, Curitiba, Belém, Campo Novo, São Luís, Fortaleza, Maceió | sim, em todos os números |
| Regionais em implantação (sem inauguração) | São Bernardo, Recife, Sorocaba | sim, mas só na sexta (Novos Sócios) e nos compromissos; ficam fora dos números de desempenho, porque ainda não operam |
| Internas | **Goiânia (id 9)**, Construção Civil, Consultoria, São Paulo | não |

A regra é uma função só, `unidadesDaRede()`, que lê `ops.unidades` (`tipo = 'regional'`) e devolve cada unidade com `emOperacao = data_inauguracao is not null`. O cockpit **não** usa a lista fixa `UNIDADES_REDE` (`src/lib/unidades-rede.ts`), que tem 9 nomes, inclui Itaúna e não tem Sorocaba, São Bernardo nem Recife.

---

## 2. Como o Paulo usa

A rotina dele é a espinha do cockpit:

| Dia | Tema | Departamentos do ClickUp ligados ao tema (proposta) |
|---|---|---|
| Segunda | Growth | Marketing, Comercial, Performance & Tech |
| Terça | Financeiro e Operações | Operações (Victor Eliezek), Auditoria & Qualidade |
| Quarta | CS e RH | Relacionamento & CS |
| Quinta | Monetização | Receitas |
| Sexta | Estratégico | CEO, Novos Sócios |

O ciclo que o cockpit fecha, e que hoje não fecha em lugar nenhum:

```
 número da rede ──▶ exceção ("Belém fechou a apuração sem fatura")
                        │
                        ▼
              [Virar compromisso]  ──▶  tarefa no ClickUp
                                         dono · prazo · unidade · tema · link de volta
                        │
     na próxima reunião do mesmo tema ◀──┘
     o cockpit mostra: feito? vencido? prazo empurrado?
                        │
                        ▼
     na sexta: revisão da semana (cumprido no prazo, por tema e por dono)
```

Ao abrir `/cockpit-coo` sem parâmetro, o cockpit cai no tema de hoje. Hoje, 29/09, uma terça, abriria em Financeiro e Operações. No sábado e no domingo, abre na sexta.

---

## 3. Menu da área (N6: tema é item da lateral, não aba)

| Item (rótulo = título) | URL | Arquétipo |
|---|---|---|
| Seg · Growth | `/cockpit-coo?tema=growth` | Visão geral |
| Ter · Financeiro e Operações | `/cockpit-coo?tema=financeiro-operacoes` | Visão geral |
| Qua · CS e RH | `/cockpit-coo?tema=cs-rh` | Visão geral |
| Qui · Monetização | `/cockpit-coo?tema=monetizacao` | Visão geral |
| Sex · Estratégico | `/cockpit-coo?tema=estrategico` | Visão geral |
| Compromissos | `/cockpit-coo/compromissos` | Fila de trabalho |
| Perguntar ao Brain | `/cockpit-coo/perguntar` | a mesma tela do CEO, com outro catálogo (lote 5) |

O item do dia leva o selo "hoje". A chave da URL é o **tema**, não o dia da semana. Se a rotina mudar de dia, basta trocar uma constante (`ROTINA_COO`), e nenhum link quebra.

---

## 4. Anatomia de um dia (arquétipo Visão geral)

É igual nos cinco temas. Os números abaixo são ilustrativos, não medição:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ◯ COCKPIT DO COO ▍ Ter · Financeiro e Operações      Fontes em dia · 09h │
│ A rede faturou, repassou e recebeu, e a entrega está andando?            │
│ 8 unidades em operação · ago/2026 · Goiânia e internas fora              │
│ [Período ▾] [Unidade ▾]                                [Perguntar ao Brain]│
├───────────┬───────────┬───────────┬───────────┬───────────┬──────────────┤
│ REPASSE   │ TAKE RATE │ APURAÇÕES │ VENCIDO   │ ONBOARDING│ VENDA SEM    │
│ (ilustr.) │           │ 7 de 8    │ A RECEBER │ PARADO    │ FATURAMENTO  │
├───────────┴───────────┴───────────┴───────────┴───────────┴──────────────┤
│ O que pede atenção                                              (até 3)  │
│  ⬣ Belém · apuração fechada sem fatura       [Abrir] [Virar compromisso] │
│  ⚠ Rio · faturado e não recebido há 22 dias  compromisso: Victor · 03/10 │
├──────────────────────────────────────────────────────────────────────────┤
│ Execução no ClickUp                                                      │
│  Compromissos de terça: 4 abertos · 2 vencidos · 5 feitos desde a última │
│  KRs de Operações e Auditoria: 3 no ritmo · 2 atrás · 1 sem medição      │
│  ⚠ Cobrar CSC de Curitiba · Victor · venceu 26/09              [Abrir]   │
│                                                        [Ver todos →]     │
├──────────────────────────────────────────────────────────────────────────┤
│ Como o repasse evoluiu por unidade nos últimos 12 meses?  [Ver detalhe →]│
│  (gráfico; clique abre a gaveta ?grafico=)                               │
└──────────────────────────────────────────────────────────────────────────┘
```

**Regras** (do arquétipo, mais o que o Pedro reprovou em 23/09):
- no máximo 6 cartões; cada nota de cartão tem uma informação só; meta ao lado do realizado quando existir (N13);
- "O que pede atenção" e "Execução no ClickUp" ficam em caixa com borda, uma linha por item, no máximo 3 itens cada;
- nada de tabela linha a linha;
- o parágrafo explicativo vai para a gaveta `?grafico=`, que é a mesma do CEO;
- cada exceção tem destino (a tela dona) **e** um compromisso: o botão "Virar compromisso", ou o compromisso que já existe, com dono e prazo;
- a exceção nasce de regra determinística com limiar escrito no contrato; o Jev não escolhe o que é exceção.

---

## 5. Os cinco temas: o que cada um mostra (proposta; o Paulo valida na primeira semana)

Todas as fontes já existem no Brain e já são calculadas por unidade. Não se cria cálculo novo de negócio; o que muda é o recorte da rede.

### Seg · Growth: "A matriz está gerando e convertendo demanda para as unidades no ritmo do trimestre?"

| Número | Fonte que já existe |
|---|---|
| MRR novo vendido na rede × meta do trimestre | `growth.dist_metas` (lido em `cockpit-ceo/aquisicao.functions.ts`) |
| Contratos novos na rede | RPC `indicadores_trimestre` (`novos_contratos`) |
| Ticket médio | idem (`ticket_medio`) |
| Mídia e ROAS da rede | idem (`midia`, `roas`) |
| CAC por unidade (pior e mediana) | `ops.v_cac_funil_resumo` |
| Broker: oportunidades abertas × convertidas | `broker_oportunidades` (`broker.functions.ts`) |

- **Gráfico:** meta × vendido por unidade no trimestre, ordenado pelo % da meta.
- **Exceções:** unidade em operação abaixo de 50% do ritmo esperado; unidade com mídia no mês e nenhum contrato novo; oportunidade do Broker parada há mais de 15 dias.

### Ter · Financeiro e Operações: "A rede faturou, repassou e recebeu, e a entrega está andando?"

| Número | Fonte que já existe |
|---|---|
| Repasse do último mês fechado (royalties + CSC) | `royalties_apuracao` confirmada (`receita-repasses.functions.ts`) |
| Take rate | idem |
| Apurações: fechadas × faturadas × recebidas (N de 8) | pendências de `/receita-overview` |
| Vencido a receber das unidades | `royalties_faturas` × `contas_receber` |
| Onboarding parado há mais de 30 dias | `cs_onboarding_cards` (unidades regionais) |
| Venda sem faturamento | cadeia de `cockpit-ceo/operacao.functions.ts` |

- **Gráfico:** repasse por unidade nos 12 meses fechados.
- **Exceções:** apuração fechada sem fatura; faturado e não recebido há mais de 15 dias; fase de onboarding que virou gargalo.
- **Limite declarado:** `data_competencia` não é confiável, por isso "recebido por unidade" aparece como parcial.

### Qua · CS e RH: "Os clientes e as equipes das unidades estão saudáveis?"

| Número | Fonte que já existe |
|---|---|
| Churn da rede no mês | Central de Tratativas (a régua do IDU) |
| Tratativas de cancelamento abertas | `central_tratativas` |
| NPS da rede e taxa de resposta | `nps_pesquisas` |
| Auditorias internas pendentes | `auditorias_internas` |
| Headcount e turnover | `headcount_mensal` (lançado à mão: selo parcial) |
| Clima | `v_gente_clima_por_unidade` |

- **Gráfico:** churn e NPS por unidade no trimestre.
- **Exceções:** tratativa de cancelamento aberta há mais de 10 dias; detrator sem ligação registrada; unidade sem lançamento de headcount no mês.
- **Limite declarado:** unidade sem card de tratativa aparece com churn zero. A tela diz "sem registro", não "0%".

### Qui · Monetização: "A base das unidades está virando receita de produto?"

| Número | Fonte que já existe |
|---|---|
| Contratos ganhos em clientes da rede | `ops.monetizacao_deals.unidade_ids` |
| Oportunidades validadas | idem |
| Receita prevista em oportunidades abertas | idem (valor declarado pelo comercial) |
| Cobertura da base por unidade | `ops.monetizacao_unidade_cobertura` |
| Contas prontas para trabalhar na rede | régua de oferta da Base |

- **Gráfico:** ganhos e oportunidades por unidade.
- **Exceções:** unidade com base e cobertura abaixo de 20%; oportunidade validada parada há mais de 15 dias.
- **Perímetro:** Goiânia sai daqui também, e a Monetização da matriz continua no Cockpit do CEO.

### Sex · Estratégico: "A rede está no pacto e o que eu levo para a próxima semana?"

| Número | Fonte |
|---|---|
| Unidades no pacto (IDU ≥ 75) | RPCs `idu_apuracao` e `idu_ranking` |
| Faturamento da rede em 12 meses e crescimento | `cockpit-ceo/rede.ts` (apuração de royalties) |
| Concentração (maior unidade, HHI) | idem |
| OKRs da Expansão: ritmo × esperado | ClickUp, leitura ao vivo (§6) |
| Compromissos da semana cumpridos no prazo | espelho do ClickUp (§6) |
| Unidades em implantação | `ops.unidades` sem inauguração, mais os compromissos de Novos Sócios |

- **Gráfico:** revisão da semana, com compromissos abertos, feitos no prazo, feitos com atraso e vencidos, por tema.
- **Exceções e decisões:** o IDU **não tem metas pactuadas** (`ops.idu_metas` tem 1 linha), então o pacto aparece como "não apurado" e vira decisão; compromisso vencido duas semanas seguidas; KR sem medição.

---

## 6. A parte tática: Compromissos no ClickUp

### 6.1 O que é um compromisso

É uma tarefa do ClickUp com cinco coisas obrigatórias:
- **dono único** (assignee);
- **prazo**;
- **tema** da rotina;
- **unidade**, ou "rede";
- **origem**: o link de volta para a exceção ou o indicador no Brain, quando a tarefa nasceu no cockpit.

A tela Compromissos (arquétipo Fila de trabalho) mostra:
- a faixa de ritmo: cumpridos no prazo na semana e vencidos;
- a faixa de higiene, com contadores clicáveis: sem dono, sem prazo, vencidos, parados há 7 dias, possivelmente bloqueados;
- a lista ordenada por prazo, com os vencidos primeiro;
- a ficha em `Sheet`, sem trocar de rota.

Ações disponíveis: concluir, mudar prazo, reatribuir, comentar, abrir no ClickUp. Filtros na URL: tema, dono, unidade, status e origem (rotina × ações de OKR).

### 6.2 Onde isso mora no ClickUp

- **Workspace:** "Expansão Nacional | Planning" (`90171400696`).
- **Space:** "Operação | Expansão Nacional" (`90176460033`).
- **Compromissos:** na pasta **Rotina Semanal**, que é do Paulo e já existe desde ~21/09, com estrutura ainda não lida. Se a pasta não servir como está, entra uma lista "Compromissos da rotina" com três campos criados à mão, porque a API não cria campo:
  - `Tema` (dropdown com os 5 temas);
  - `Unidade` (dropdown com as 11 regionais + "Rede");
  - `Origem Brain` (URL).
- **KRs dos departamentos:** lidos da estrutura que já existe (pasta = departamento, lista = objetivo, tarefa = KR, subtarefa = ação), com a régua de saúde e ritmo do Growth.

### 6.3 Como o Brain lê e grava (decisões técnicas)

- **Cliente:** porta a camada pura do Growth (`brain-web/src/lib/okrs/{tipos,normalizar,campos,dashboard,vazao}.ts`, com os testes) para `src/lib/clickup/` no Ops. Duas correções entram junto:
  - **paginação:** o leitor atual não passa `page`, e tudo depois de 100 tarefas some sem aviso;
  - **uma consulta filtrada** (`GET /team/{id}/task` com `space_ids[]`, `list_ids[]`, `date_updated_gt`) no lugar de uma chamada por lista.
- **Espelho no banco:**
  - `ops.clickup_tarefas`: estado atual de cada tarefa;
  - `ops.clickup_eventos`: mudanças de status, prazo e dono. É daí que saem "cumprido no prazo" e "prazo empurrado N vezes", que o ClickUp não entrega pela API.
- **Sincronização:**
  - reconciliação a cada 10 minutos (pg_cron → edge function `clickup-sync`, incremental por `date_updated_gt`);
  - webhook depois, se a espera de 10 minutos incomodar.
- **Saúde visível:** a hora do espelho aparece na procedência. Com mais de 1 hora sem carga, o bloco avisa "espelho parado desde hh:mm".
  - Motivo: em 29/09 achamos o snapshot diário de OKRs **morto desde 02/09 com o cron verde**. O `curl` sem `-L` tomava um redirect e contava como sucesso.
- **Escrita:** pela server function do Ops para a API do ClickUp.
  - O espelho é atualizado na hora da escrita.
  - Toda escrita fica registrada em `ops.cockpit_coo_escritas`: quem, quando, o quê e a resposta da API.
  - Esse registro é necessário porque o token é de uma conta só, e no ClickUp a tarefa aparece criada pelo dono do token. O autor real vai também na descrição.
- **Token:** fica na linha `CLICKUP_API_KEY` de `ops.integracoes_segredos` (tela Administração › Chaves de Integração, que já existe). Trocar o token não exige deploy.
- **Idempotência:** "Virar compromisso" grava a chave da exceção no campo Origem, então clicar duas vezes não cria duas tarefas.

---

## 7. O Jev: onde entra e onde não entra

O Jev (`typesafe/jev-1.13`, via OpenRouter Decisions) faz julgamentos pequenos sobre texto, com confiança. Custa cerca de US$ 0,00003 por chamada. **Saldo em 29/09: US$ 50** (`/api/v1/credits`), contra zero até 28/09. O adaptador já existe (`src/lib/cockpit-ceo/jev/adaptador.server.ts`) e é reaproveitado com taxonomias novas.

| Uso | Pergunta ao Jev | O que a tela faz com a resposta |
|---|---|---|
| **Triagem** do que chega sem campo | `choice`: qual tema? `choice`: qual unidade? (a partir de nome e descrição) | chip "sugerido" com botão **Confirmar**, que grava no ClickUp; abaixo do limiar, "sem sugestão" |
| **Duplicidade** antes de criar | `noul`: alguma tarefa aberta deste tema já trata disso? `choice`: qual? | oferece "vincular à existente" no lugar de criar outra |
| **Bloqueio** | `noul` sobre os últimos comentários: a tarefa espera outra pessoa ou área? | contador "possivelmente bloqueadas" na faixa de higiene; o status não muda |
| **Roteamento** do "Perguntar ao Brain" (lote 5) | `choice`: qual dos cinco temas? | dica ao modelo principal, como no CEO |

**O Jev não:**
- calcula número;
- escolhe exceção ou prioridade da pauta (isso é regra fixa);
- muda status;
- grava sem clique de uma pessoa;
- concede acesso.

**Calibração:** as mesmas regras do CEO (95% de acerto na avaliação rotulada de 22/09).
- Conjunto de cerca de 60 tarefas reais rotuladas pelo Paulo ou pelo Pedro.
- Limiar por pergunta: a faixa de confiança com pelo menos 90% de acerto.
- Ledger da avaliação em arquivo.

**Consumo:**
- `ops.cockpit_ia_consumo` ganha a coluna `cockpit` (`ceo`/`coo`), com teto separado, para o COO não gastar a verba do CEO.
- Em produção, o Jev precisa de `OPENROUTER_API_KEY` na Vercel. Recomendação: **uma chave nova**, porque as duas atuais passaram pelo chat.

---

## 8. Reaproveitamento do Cockpit do CEO

**Entra sem mudança:**
- `components/planning/*`, o tema de gráfico e a gaveta `?grafico=`;
- `contexto.ts`, `paginar.ts` (corte de 1.000 linhas) e `periodo.ts`;
- os cálculos de rede (`rede.ts`, a leitura "rede" de `receita-fontes.ts`) e de operação (`operacao.functions.ts`);
- o padrão de homologação de `scripts/cockpit-ceo/`.

**Generalização mínima, com a homologação do CEO (18/18) como regressão:**
- a checagem de área passa a receber a área como parâmetro;
- `portas.ts` ganha as fontes que o COO lê e o CEO não lia: `nps_pesquisas`, `auditorias_internas`, `royalties_faturas`, `central_tratativas` e as `broker_*`;
- `contrato.ts` separa o genérico (estados, contrato de indicador) do que é do CEO (`FRENTES`, `IdIndicador`);
- o orçamento de IA passa a ser por cockpit.

**Não muda:** nenhum cálculo, tela, porta ou taxonomia do Jev do CEO.

---

## 9. Acesso

| O quê | Quem | Como |
|---|---|---|
| Ver o cockpit | admin + Paulo Carvalho | área nova `cockpit_coo` em `ops.areas` (`escopo = 'nenhum'`), com card em `/inicio` |
| Gravar no ClickUp | Paulo + admin | chave `manage.cockpit_coo`; sem ela, os botões aparecem desabilitados com o motivo (N8) |
| Espelho do ClickUp | quem tem a área | RLS de leitura na área; escrita só pelo servidor |
| Sócio regional | não vê | é a visão da matriz sobre a rede; o sócio segue com IDU e Minha Unidade |

Cada número continua conferindo a porta da própria fonte (`portas.ts`). Sem porta, o bloco mostra "sem acesso", nunca 0.

---

## 10. Estados, falhas e testes que vêm antes do código

| Situação | O que a tela faz |
|---|---|
| ClickUp fora ou token inválido | os números seguem; a execução mostra o último espelho com a hora; o aviso "ClickUp desconectado" leva à tela de Chaves de Integração |
| Espelho parado há mais de 1 hora | selo na procedência do bloco |
| Jev fora ou sem saldo | sem sugestão; nada trava |
| Fonte com limite conhecido (headcount manual, churn só por tratativa, IDU sem metas, recebido sem competência) | selo "parcial" com o motivo e o dono |
| Unidade sem dado | "sem registro", nunca 0 (N4) |

**Testes escritos antes do código:**
1. **Perímetro:** o teste falha se Goiânia (9) ou qualquer interna aparecer em qualquer número, e se uma regional sem inauguração entrar em número de desempenho.
2. **Conciliação:** cada cartão é igual ao total da tela dona, e o teste roda contra SQL independente (`scripts/cockpit-coo/homologar.mjs`, só leitura).
3. **ClickUp:** com 250 tarefas simuladas, a paginação traz as 250; campos lidos por nome; tarefa sem campo não quebra a leitura.
4. **Escrita:** sem `manage.cockpit_coo`, a escrita é recusada no servidor; clique duplo não cria duas tarefas; toda escrita gera linha no registro.
5. **Jev:** nenhuma sugestão grava sem confirmação; abaixo do limiar, nada é sugerido.

---

## 11. Lotes (o plano detalhado sai depois da aprovação)

| Lote | Entrega | Depende de |
|---|---|---|
| **0 · Destravar** (fora do código) | token do ClickUp; leitura da pasta Rotina Semanal; criação dos 3 campos, se precisar; confirmação do COO, dos números e do mapa tema → departamento | Pedro / Paulo |
| **1 · Casca e números** | área, rota, cinco temas com números, atenção e gráfico, **sem ClickUp**; homologação; capturas comparadas com o arquétipo | aprovação desta spec |
| **2 · ClickUp, leitura** | cliente portado, espelho e sincronização com saúde; caixa "Execução no ClickUp"; tela Compromissos só leitura; KRs por tema | lote 0 (token) |
| **3 · ClickUp, escrita** | Virar compromisso; concluir, prazo, dono, comentário; registro de escrita. Testado primeiro numa lista de teste, depois na real | lote 2 |
| **4 · Jev** | triagem, duplicidade, bloqueio; calibração com rótulos; teto por cockpit | lote 2 + rótulos |
| **5 · Sexta completa + Perguntar** | OKRs e revisão da semana; "Perguntar ao Brain" do COO com catálogo próprio de consultas da rede | lotes 1–4 |

Cada lote vira um PR. A publicação segue o roteiro de sempre: "publica" do Pedro, deploy pela CLI da planningbrainbot e conferência do `gitCommitSha` no ar logo antes.

---

## 12. O que é decisão do Pedro

1. ~~COO = Paulo Carvalho?~~ **Confirmado em 29/09.** Falta decidir se mais alguém vê o cockpit (o CEO, o Eliezek).
2. **Token do ClickUp, de qual conta.** O token de hoje é do Mikael, e toda tarefa criada aparece em nome dele. As alternativas:
   - token do Paulo: as tarefas nascem no nome dele;
   - conta bot: custa um assento.
3. **Números de cada dia (§5):** proposta; recomendo publicar assim e ajustar com o Paulo na primeira semana.
4. **Mapa tema → departamentos (§2).**
5. **Unidades em implantação:** entram só na sexta e nos compromissos (recomendado) ou também nos números?
6. **Chave nova do OpenRouter para produção**, e revogação das duas que passaram pelo chat.

---

## 13. Não objetivos

- Não mexe no Cockpit do CEO além da generalização testada (§8).
- Não muda fórmula, régua, RLS existente nem permissão de outra área.
- **Não recria a área Estratégia & Execução.** A entrada de 21/09 do `DECISIONS.md` descreve `okrs.functions.ts`, `client.growth-schema.server.ts` e a migration `20260921170000_area_estrategia_execucao.sql`, e **nenhum dos três está em commit, branch ou produção** (conferido em 29/09). O cockpit porta só a leitura de que precisa, e o destino da área é outra decisão.
- Não tira os OKRs do Growth.
- Não corrige sujeira de base: `empresas.unidade` com id numérico, headcount manual, IDU sem metas, a linha "Maceio" sem `unidade_id` em `ops.socios`, a lista fixa `UNIDADES_REDE` que esconde tratativas de unidades novas no `/painel-cs`. O cockpit mostra essas lacunas como parciais, com dono.
- Não dá acesso a sócio regional.
- Não publica sem o "publica" do Pedro.

---

## 14. Achados de passagem (registrar no `DECISIONS.md` no lote 1)

- O snapshot diário de OKRs (`growth.okr_snapshot`) está parado desde **02/09**, com o job `okr-snapshot.yml` verde (redirect tratado como sucesso).
- O leitor de OKRs do Growth não pagina.
- A área Estratégia & Execução, registrada em 21/09, não existe no código nem no banco.
- `ops.socios` tem uma linha "Maceio" sem `unidade_id` (criada em 23/09), o que contradiz o "zero nulos" de 21/09.
- `UNIDADES_REDE` não tem Sorocaba, São Bernardo nem Recife.
