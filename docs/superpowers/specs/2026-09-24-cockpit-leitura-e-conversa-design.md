# Cockpit do CEO: leitura de dez segundos e "Perguntar ao Brain" (spec, 24/09/2026)

Branch `feat/cockpit-ceo-conversa-20260924`, worktree `PM Work/execution/planning-brain-cockpit-conversa-20260924`, a partir da `main` `20a8e95` (inclui o cockpit empresarial publicado em 24/09, PR #20/#21).

**Método.** As skills do Superpowers não estão instaladas nesta sessão (só existe `~/.claude/plugins/data/superpowers-inline`, vazia). O método foi seguido à mão, como nas rodadas de 22 e 23/09:
1. brainstorming curto sobre o objetivo já fechado (esta spec);
2. plano em lotes (`docs/superpowers/plans/2026-09-24-cockpit-leitura-e-conversa.md`);
3. testes das regras críticas antes do código que elas protegem;
4. depuração sistemática quando algo falha;
5. verificação antes de declarar pronto.

## 1. O problema, medido na tela publicada

Captura `docs/design/capturas/cockpit-ceo/empresa/escuro-executiva-pagina.png` (1440 px, 3.083 px de altura):
- seis cartões;
- um cartão "não apurado" (meta de R$ 1 bi);
- procedência técnica em cada cartão (`fn_faturamento_mensal`, `cs_onboarding_cards`);
- três blocos de decisão com parágrafo;
- cinco ameaças;
- ponte;
- sete motores (dois "não apurado");
- o painel do Jev do piloto;
- nove cartões de frente com contagem de perguntas.

Na primeira dobra de 1440×900 só cabem os cartões e as decisões. O resultado, a tendência e o principal problema não aparecem juntos.

## 2. Referências e o que se aproveita

| Referência | Como foi lida | O que entra | O que não se copia |
|---|---|---|---|
| DS v2 (`docs/design/*`, `components/planning`) | código e documentos; vitrine por captura | `PageHeader`, `KpiCard`, `Secao`, `StatusBadge`, estados, tema de gráfico, N1–N14, V1–V21 | — |
| Cockpit publicado (`cockpit-ceo.tsx`, `empresa.tsx`) | código + captura | cálculos, contratos de indicador, portas, cache por pessoa | texto técnico na primeira leitura, cartão vazio |
| Growth (`PM Work/execution/brain-web`, Next.js) | **só código**: o repositório só abre pela conta `planningbrainbot`, e a cópia local está 48 commits atrás; não houve captura | Executivo: resultado, meta, ritmo e gap no mesmo cartão. Comercial: comparação temporal ao lado do número. Follow Day: o número que abre a carteira e a ação | métrica divergente, título longo |
| Estudo `monetizacao/medicoes/15-growth-para-monetizacao/` | leitura | "um número abre a lista e a ação" | — |

## 3. Decisões de desenho (reversíveis, tomadas aqui)

### 3.1 Visão executiva (arquétipo Visão geral)

**Primeira dobra**, a mesma em 1280×800 e em 1440×900:
1. **Cabeçalho compacto:**
   - pergunta aprovada (N1);
   - universo numa linha;
   - período e perímetro;
   - selo de **saúde dos dados** (quantas fontes em dia; o clique abre o frescor);
   - botão "Perguntar ao Brain".
2. **Quatro indicadores**, escolhidos por importância e qualidade da evidência:

   | # | Id | Por quê | Comparação | Tendência |
   |---|---|---|---|---|
   | 1 | `faturamento-mes` | o resultado da empresa; fonte canônica | mês anterior | 12 meses fechados do grupo |
   | 2 | `mrr-vendido` | crescimento contratado; tem plano | plano do Growth | MRR novo mensal |
   | 3 | `vencido-em-aberto` | o faturamento vira caixa? | total em aberto | — (fotografia) |
   | 4 | `onboarding-parado` | venda que não ativa | em curso | — (fotografia) |

   Saem da primeira dobra:
   - `meta-bilhao`: sempre "não apurado" enquanto não houver perímetro. Vira **decisão** com alternativas (leitura do grupo × leitura da rede) e efeito.
   - `faturamento-saiu`: vai para o gráfico principal, como "saiu".
3. **Gráfico principal:** faturamento mensal do grupo nos meses fechados, com o último mês destacado e a linha "entrou × saiu" da ponte embaixo.

   O total do cartão 1, a última barra e o total da ponte são **o mesmo número** (conciliação na tela, testada).
4. **"Pede sua atenção":** até 3 exceções. Cada uma tem impacto, responsável e botão de destino.

   As exceções vêm das mesmas regras determinísticas de ameaça, que ganham `responsavel`, o dono declarado no contrato do indicador.

**Abaixo da dobra:**
- decisões (até 3, com alternativas e efeito);
- "Aprofundar": as nove frentes numa linha de links, sem contagem de perguntas;
- método e fontes em `Sheet`.

**Fica fora da home:**
- motores;
- o painel do Jev do piloto;
- os cartões de frente com contagem;
- nomes de tabela e função (vão para a composição, em "Fonte e método").

**Placeholder:**
- nenhum cartão "não apurado" na home;
- número indisponível sai da grade e vira aviso curto com o último período confiável;
- sem acesso continua visível como "sem acesso" (N4/N8), porque ocultar mentiria sobre a cobertura.

### 3.2 "Perguntar ao Brain" (`/cockpit-ceo/perguntar`, item novo da área)

A tela tem duas colunas: conversa à esquerda e área visual à direita.
- **Resposta:** uma conclusão curta, depois os componentes, depois as próximas explorações sugeridas.
- **Contexto:** período, unidade, entidade, produto, métrica e base (nova/antiga/todas) aparecem como controles editáveis acima da área visual. Mudar um controle refaz a mesma visão com a mesma definição, sem passar pelo modelo.

### 3.3 Arquitetura (quatro camadas)

```
pergunta ─▶ A. Jev (classifica)  ─▶ B. modelo principal ─▶ C. ferramentas (catálogo fechado)
                 │ domínio, ambígua?        │ escolhe ferramentas         │ mesmas funções do cockpit,
                 │ confiança calibrada      │ e propõe a composição       │ porta e escopo no servidor
                 ▼                          ▼                             ▼
          pergunta curta ou        especificação (zod)  ──validação──▶ D. renderizador (componentes do DS)
          encaminhamento                     └ referências a resultados, nunca números
```

- **A. Jev:** `typesafe/jev-1.13` pelo adaptador existente (`jev/adaptador.server.ts`), com taxonomia nova `cockpit-ceo-conversa-v1`:
  - `dominio` (choice): receita, aquisição, operação, caixa, unidades, clientes, retenção, portfólio, composição de tela, gestão de visão, fora do escopo;
  - `ambigua` (noul): falta período, métrica ou entidade que mude a resposta.

  Os limiares ficam calibrados com as perguntas do Pedro (§6). Com confiança abaixo do limiar, o modelo principal recebe todas as ferramentas, sem dica. Com `ambigua` acima do limiar e nenhum contexto anterior que resolva, a resposta é uma pergunta curta com opções. Se o Jev falha, o modelo principal segue sem dica. O Jev nunca calcula número nem concede acesso.
- **B. Modelo principal:** OpenRouter pela chave de servidor. Candidatos `anthropic/claude-sonnet-5` e `anthropic/claude-opus-5.5`, ambos com ferramentas e saída estruturada no catálogo do provedor, conferido em 24/09. A escolha sai da avaliação (§6).
- **C. Ferramentas:** um catálogo fechado.
  - Cada ferramenta tem um schema zod e roda funções que já existem: `montarCockpit`, `resumirLeitura`, `resumirRedeUnidades`, `montarPonte`, `montarAquisicao`, `montarOnboarding`, `montarCoortes`, `extrair*`.
  - As funções rodam sobre a mesma carga do servidor (`carregar*Cockpit`), extraída para funções chamáveis com a sessão da pessoa.
  - Não há SQL livre nem ferramenta genérica.
  - O servidor confere a área `cockpit_ceo` e valida a unidade pedida contra o escopo da pessoa.
  - A resposta de cada ferramenta leva `resultadoId`, métrica, versão da regra, filtros aplicados, unidade de medida, estado, fonte, data do dado, cobertura e avisos.
- **D. Renderizador:**
  - A especificação (`VisaoSpec`, versão `1`) lista blocos de um catálogo (KPI, série temporal, barras comparativas, ranking, funil, ponte de variação, tabela, coorte, lista de ações), e cada bloco aponta para um `resultadoId`.
  - O servidor valida a especificação e troca cada referência pelos dados do resultado. O cliente monta os componentes.
  - Nenhum HTML ou JS do modelo é executado.
  - Todo número do texto de conclusão é conferido contra os resultados da rodada. Número sem origem remove a frase e registra o descarte.

### 3.4 Persistência e privacidade

São três tabelas novas em `ops`, com RLS "só o dono" e a área `cockpit_ceo` exigida:
- `ops.cockpit_conversas`;
- `ops.cockpit_mensagens`;
- `ops.cockpit_visoes`.

O que se guarda:
- **Mensagens:** a parte visível (texto, especificação, filtros e ids de resultado).
- **Números:** não ficam guardados como dado de negócio. Ao reabrir, a visão consulta de novo com a permissão vigente. Guardar o resultado seria snapshot e teria de aparecer como tal; esta versão não guarda.
- **Visão salva:** definição (especificação + filtros + versão), nome e data.

O consumo de IA vai para `ops.cockpit_ia_consumo`: tipo (jev/modelo), modelo, tokens, custo, latência e estado. O texto da pergunta não entra nesse registro. O orçamento do app é conferido **antes** de cada chamada:
- teto mensal global;
- teto diário por pessoa;
- nenhuma renovação por lote.

A avaliação tem ledger próprio em arquivo, cumulativo.

### 3.5 Falhas

| Falha | Comportamento |
|---|---|
| Jev fora | segue sem dica; a tela diz "classificação indisponível" no detalhe da resposta |
| Modelo fora ou orçamento esgotado | até 2 tentativas; depois, mensagem factual e atalhos para os painéis prontos; nenhum número |
| Ferramenta falha | estado `fonte_indisponivel` no resultado; o modelo precisa dizer que não há dado; o validador recusa bloco sobre resultado sem número |
| Pedido de visualização sem dado | estado vazio honesto, com o motivo |
| Cancelar | aborta o stream e as ferramentas em curso; a mensagem fica marcada como cancelada |
| Cockpit normal | não depende do Jev nem do provedor (carga própria, sem import do chat) |

## 4. Não objetivos

- Não mudar fórmula, régua, porta, RLS existente nem permissão.
- Não publicar. O deploy é do Eliezek.
- Não ligar o chat em produção sem a chave na Vercel e sem decisão sobre o custo.

## 5. Aceite (do pedido, verificável)

Cada critério tem teste, captura ou percurso registrado no relatório.

## 6. Avaliação

A avaliação tem um conjunto rotulado `docs/dev_notes/cockpit-ceo-conversa/avaliacao/perguntas.json`, com resposta esperada conferida contra a carga real. Cobre:
- perguntas simples;
- perguntas de vários domínios;
- refinamentos em várias mensagens;
- ambiguidade de "receita", "cliente ativo" e período;
- fonte parcial;
- falta de permissão;
- tentativa de instrução contrária às regras;
- falha simulada de Jev, modelo e ferramenta;
- visualização sem dado.

Mede-se, por modelo:
- escolha de métrica e filtro;
- números corretos (conferidos por máquina contra o resultado da ferramenta);
- utilidade da visualização (regra: tipo de bloco adequado ao dado);
- latência;
- custo.

Teto da avaliação: US$ 5 no total, no ledger cumulativo.
