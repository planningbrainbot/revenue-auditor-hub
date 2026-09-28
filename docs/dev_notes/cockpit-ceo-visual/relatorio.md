# Cockpit do CEO · revisão visual (28/09/2026)

Branch `feat/cockpit-ceo-visual-20260928`, a partir da `main` `ef2b1ef`. **Não publicado**: o deploy do `ops-brain` é pela CLI e é do Eliezek.

## O que mudou para o CEO

A Visão executiva deixou de ter parágrafos. Cada bloco é um gráfico com o número principal em destaque e um título de uma linha. A explicação abre quando ele clica no gráfico.

| # | Bloco | Número em destaque (28/09, dado real) |
|---|---|---|
| 1 | Trajetória rumo ao bilhão (escala log, mês em curso tracejado, degraus até 2030, linha da meta) | meta R$ 83,3 mi/mês · média 2026 R$ 6,6 mi/mês · distância 12,7× · ritmo pedido 89% a.a. |
| 2 | Ponte do último mês fechado (cascata, níveis em traço) | +R$ 859 mil (07 → 08/2026) |
| 3 | Composição da receita (treemap, recorrente × não recorrente) | 76% recorrente (jan–ago/2026) |
| 4 | Churn mensal por fórmula (ponto na média, faixa do menor ao maior mês, referência 2,34%) | 0,8% a 9,0% |
| 5a | Rede: MRR ativo por unidade (Omie das unidades) | R$ 1,9 mi · Rio de Janeiro concentra 46% |
| 5b | Franqueadora: faturado × recebido por mês | R$ 313 mil em aberto nos 12 meses |
| 6 | Entrega: onboarding por fase | 152 em curso · gargalo em Setup técnico |
| 7 | Saúde das fontes | 2 de 4 paradas |
| 8 | Decisões (D0 primeiro) e ameaças | 4 decisões · 3 ameaças |

Degraus calculados, nada fixo no código: média de 2026 × ritmo^n, com ritmo = (83,3 ÷ média)^(1/4). Em 28/09 dão **12,4 · 23,4 · 44,2 · 83,3 mi/mês**, os mesmos do pedido.

Cada uma das nove frentes ganhou um cartão principal: número grande e mini gráfico. Os painéis viraram blocos clicáveis com título de uma linha. As perguntas da frente ficaram com uma linha cada, e o detalhe foi para a gaveta.

### A gaveta

Abre no clique em qualquer gráfico, cartão, painel ou pergunta, e o endereço fica na URL (`?grafico=<id>`). O "voltar" do navegador fecha a gaveta. Ela traz sempre:
- o que o gráfico diz;
- como se calcula;
- fonte, data e período;
- atenção ou limite;
- quem decide ou é dono;
- o botão para a tela que resolve;
- "Perguntar ao Brain sobre este gráfico";
- os dados desenhados em tabela, que servem de vista acessível.

A gaveta de indicador que já existia ganhou o botão "Perguntar ao Brain sobre este número".

### IA

- "Perguntar ao Brain" continua no cabeçalho e agora também aparece na gaveta.
- Pela gaveta, a conversa abre com `?grafico=<id>`. O navegador manda só o id do gráfico; o servidor monta o contexto com a carga e o acesso de quem pergunta e com as mesmas regras da tela.
- Os números desse contexto contam como "já mostrados" na conferência. Um número sem origem continua sendo retirado. Dois testes com modelo simulado cobrem esse caminho.
- Modelo e configuração não mudaram: `COCKPIT_CONVERSA_MODELO` segue `openai/gpt-5.5`, e o Jev segue desligado.

### Textos

- A decisão **D0 "O que é o bilhão: faturamento anual, valuation ou unicórnio"** (quem decide: CEO) entrou antes de todas as outras. Na trajetória, a meta leva o selo "D0 pendente: faturamento ou valuation".
- "Dado existe, ninguém lê" virou "dado existe, alerta sem dono atribuído". Não havia outros textos com "ninguém trata" ou "ninguém age" na tela.
- As nove frentes ficaram como estavam; os 8 pilares e os 15 componentes do livro não entraram.

## Leituras novas

Estão em `src/lib/cockpit-ceo/visual.functions.ts`. Cada parte confere a própria porta antes de ler e falha sozinha:

| Leitura | Fonte | Porta |
|---|---|---|
| Receita por categoria, meses fechados do ano | `fn_faturamento_mensal` (bloco `categorias`), Financial Brain | produto Financeiro + todas as empresas |
| Saída de faturamento só em Honorários Contábeis | `fn_faturamento_mensal(p_categorias)`, ponte por cliente | idem |
| MRR ativo por base e encerramentos por mês | `ops.omie_contratos_servico` (situação 10 ativo; 99 encerrado pela vigência final) | `omie_contratos_servico` + todas as unidades |
| Churn datado | `ops.central_tratativas` (lost com data) × `ops.contratos` Inside Sales | as duas portas + todas as unidades |
| Faturado × recebido da franqueadora | `ops.contas_receber` da Partners, por mês de vencimento | `contas_receber` + todas as unidades |

A ausência é desenhada como hachura ou área vazia com rótulo ("Fonte indisponível · motivo"), nunca como barra zerada. Enquanto a carga não chega, o bloco mostra esqueleto.

## Visual

- Paleta pedida em tokens `--viz-*` (`src/styles.css`) e `CORES_COCKPIT` (`src/lib/planning/grafico.ts`). Nenhum hex em `.tsx`.
- Validada pelo script da skill dataviz nos dois temas (card `#ffffff` e `#0d1418`): faixa de luminosidade, croma, contraste e piso de visão normal **PASS**.
- O par realizado × meta fica em ΔE 8,0 para protanopia, o que só é legal com codificação secundária. Por isso meta e pedido são sempre tracejados.
- Barras com canto de 4px só na ponta, grade tracejada discreta e um eixo por gráfico.
- Rótulos diretos só nos pontos que importam: último mês fechado, degraus, maior unidade, gargalo e em aberto acima de R$ 100 mil. Legenda sempre que há duas séries ou mais.
- A 400px os gráficos empilham. Na ponte, os rótulos de eixo encurtam e os valores de movimento saem (ficam na dica).

## Aceite

| Critério | Resultado |
|---|---|
| Nenhum texto de mais de uma linha na primeira dobra | ✓ medido por CDP em 1440×900 (linhas de cada nó de texto), tela real e preview |
| Pelo menos um gráfico por bloco da Visão executiva e um por frente | ✓ 10 de 10 blocos com gráfico; 9 de 9 frentes com cartão principal |
| Todo gráfico com dica e gaveta com os campos | ✓ `scripts/cockpit-ceo/visual-interacao.mjs`: passa o mouse até a dica aparecer, foca o título pelo teclado (anel visível), abre com Enter e confere os campos da gaveta e o botão da IA |
| IA pelo cabeçalho e pela gaveta | ✓ os dois links conferidos na tela real; a conversa abre com o gráfico como contexto e a pergunta sugerida. **A resposta real não foi obtida: a chave da OpenAI está sem crédito** (ver "Pendências") |
| Números batem com SQL independente | ✓ `homologar-empresa.mjs` estendido: 18 de 18 conferências, 9 delas novas (trajetória, composição, rede, 3 fórmulas de churn por SQL, saída de honorários, franqueadora, entrega). Resultado em `docs/dev_notes/cockpit-ceo-empresa/homologacao/resultado-2026-09-281513.json` |
| `npm run design:lint` sem piorar a catraca | ✓ RESULTADO ok, contagens iguais à baseline |
| Testes `tests/cockpit-ceo*.test.mjs` | ✓ 185 de 185 (eram 166; 17 novos em `cockpit-ceo-visual.test.mjs` e 2 no `responder`) |
| Build | ✓ `npm run build` |
| Capturas antes e depois, desktop e 400px | ✓ sintéticas em `capturas/sintetico/` (Visão executiva e duas frentes, antes e depois); conjunto completo e capturas com dado real fora do repositório (ver abaixo) |

As cinco fórmulas de churn reproduzem a investigação de 24/09 ao centésimo: 3,22% · 1,65% · 0,80% · 8,97% · 4,26%. Nenhuma chega aos 2,34% do mapa.

**Capturas com número real** não entram no repositório, pela regra dos scripts de 24/09. Estão em `PM Work/execution/cockpit-ceo-visual-capturas-20260928/`, junto com as sintéticas completas (as 10 vistas × 2 larguras × 2 temas, antes e depois) e a saída do aceite de interação.

## Achados no caminho

1. **Fechar a gaveta de um gráfico saía da página.** A rota gravava qualquer parâmetro novo com `replace`, e fechar faz `history.back()`. O `?grafico=` passou a empilhar no histórico, como o `?indicador=`. O aceite de interação encontrou o problema.
2. **Chave da OpenAI sem crédito.** A chamada real respondeu "You have no credits remaining". Se a chave de produção (`OPENAI_API_KEY` no `ops-brain`) for a mesma, o "Perguntar ao Brain" no ar responde "Não consegui montar a resposta agora".
3. **Pipeline do Inside Sales sem data.** Os 893 negócios abertos não têm data de fechamento esperada, então o gráfico por mês ficava vazio. Agora o bloco diz isso em uma linha.
4. **Carga da Monetização instável.** Em duas de cinco aberturas locais, a carga falhou ("Não foi possível carregar as empresas" ou "A base mudou durante a consulta"). Os blocos dependentes mostraram o estado "Fonte indisponível", sem zero. O comportamento é anterior a esta branch.
5. **Rolagem horizontal a 400px só no preview sintético.** Já existia no "antes" e vem da casca do preview. Na rota real, a 400px o documento mede 385px.

## Pendências (não são desta branch)

- **Crédito da OpenAI** ou chave nova: decisão do Pedro.
- **"Contrato ok"** formal da revisão de 28/09 (PROCESSO §4). O brief do Pedro foi tratado como o contrato.
- **Deploy pelo Eliezek.** Antes de publicar, confira se o `gitCommitSha` em produção bate com a `main` (em 25/09 havia commit fora da main).
- **Código 90 dos contratos do Omie:** a leitura é "suspenso" e fica fora do MRR ativo. A controladoria precisa confirmar, junto com o 99.
- **Paleta própria do cockpit:** diverge da ordem fixa de DESIGN §5 e está registrada no `DECISIONS.md`. Cabe ao DS decidir se adota para o Brain.
