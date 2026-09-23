# Planning Dashboard — AGENTS.md

## Antes de qualquer trabalho

Leia `DECISIONS.md` inteiro. É o log de decisões de produto/arquitetura/negócio tomadas em conversas anteriores (com Claude Code ou qualquer outra ferramenta). Se a tarefa pedida tocar em algo já decidido lá, siga a decisão registrada — não redecida do zero nem contradiga sem avisar o usuário.

## Depois de qualquer decisão não-óbvia

Sempre que uma decisão de produto, arquitetura ou regra de negócio for tomada durante a conversa — mesmo que a implementação fique pra depois, mesmo que pareça pequena — adicione uma entrada em `DECISIONS.md` (formato descrito no topo do próprio arquivo) **antes de terminar a resposta**. Isso vale mesmo se a conversa não resultar em nenhuma alteração de código.

**Por quê:** decisões discutidas em chat e nunca escritas em lugar nenhum se perdem entre sessões — já aconteceu (ver entrada de 2026-07-02 sobre a feature de churn, cujo contexto foi perdido). `DECISIONS.md` é versionado no git, então sobrevive a troca de sessão, de máquina, ou de ferramenta — ao contrário de memória de chat.

## Deploy

Ver `DECISIONS.md` (entradas 2026-07-03 e 2026-08-18) para o histórico de qual domínio/projeto Vercel é o correto. Resumo: repo `victoreliezek/revenue-auditor-hub`, remote único `origin`, domínio de produção `ops.planningbrain.com.br` (antigo `planning.opsboard.com.br`, descontinuado em 2026-08-18). ~~`git push origin main` já dispara o deploy.~~ **A confirmar com o Eliezek:** entradas mais recentes do `DECISIONS.md` contradizem esta frase e o resumo acima. Em 2026-09-15 o deploy foi publicado em `planningbrain.com.br` e o push direto para `main` foi rejeitado (PR em `planningbrainbot/revenue-auditor-hub`). Em 2026-09-21 o deploy saiu "por CLI no projeto `ops-brain` do time `planning17`". Em 2026-09-22 saiu "pela CLI (o webhook Git→Vercel segue parado)". Não conte com o push para publicar, e não publique sem perguntar.

## Antes de mexer em tela

Vale para toda tela nova ou alterada em `src/routes/` ou `src/components/`.

1. Leia `docs/design/README.md` e siga a ordem de leitura dele: PRODUCT → NAVEGACAO → ARQUETIPOS → CONTRATO-DE-TELA → DESIGN → DECISIONS.
2. Preencha o contrato (`docs/design/CONTRATO-DE-TELA.md`, salvo em `docs/design/contratos/<rota>.md`) **antes** do código. Sem "contrato ok" do dono, não abra código (`docs/design/PROCESSO.md` §4).
3. Declare o arquétipo (Visão geral, Fila de trabalho, Lista/Relatório, Ficha, Configuração) e siga a anatomia de `docs/design/ARQUETIPOS.md`.
4. Componha com `src/components/planning/` (`PageHeader`, `KpiCard`, `StatusBadge`, `EstadoVazio`, `EstadoErro`, `Carregando`, `Procedencia`...) e com os tokens de `src/styles.css`. Nada de cor crua, hex, `hsl(var(`, fonte menor que 12px.
5. **Não pesquise referência externa no meio da tarefa.** Se faltar regra, siga o arquétipo mais próximo e registre a lacuna no PR (`docs/design/REFERENCIAS.md` tem hora própria).
6. Antes do PR: `npm run design:lint:changed` sem violação nova (a catraca de `docs/design/lint-baseline.json` também não pode subir) e captura escuro/claro (`npm run design:capturar -- <rotulo>` ou a tela real).
7. No PR, use `.github/pull_request_template.md` e marque a definição de pronto do `docs/design/README.md`. Item não cumprido diz qual e por quê.
