# Planning Dashboard — CLAUDE.md

## Antes de qualquer trabalho

Leia `DECISIONS.md` inteiro. É o log de decisões de produto/arquitetura/negócio tomadas em conversas anteriores (com Claude Code ou qualquer outra ferramenta). Se a tarefa pedida tocar em algo já decidido lá, siga a decisão registrada — não redecida do zero nem contradiga sem avisar o usuário.

## Depois de qualquer decisão não-óbvia

Sempre que uma decisão de produto, arquitetura ou regra de negócio for tomada durante a conversa — mesmo que a implementação fique pra depois, mesmo que pareça pequena — adicione uma entrada em `DECISIONS.md` (formato descrito no topo do próprio arquivo) **antes de terminar a resposta**. Isso vale mesmo se a conversa não resultar em nenhuma alteração de código.

**Por quê:** decisões discutidas em chat e nunca escritas em lugar nenhum se perdem entre sessões — já aconteceu (ver entrada de 2026-07-02 sobre a feature de churn, cujo contexto foi perdido). `DECISIONS.md` é versionado no git, então sobrevive a troca de sessão, de máquina, ou de ferramenta — ao contrário de memória de chat.

## Deploy

Ver `DECISIONS.md` (entradas 2026-07-03 e 2026-08-18) para o histórico de qual domínio/projeto Vercel é o correto. Resumo: repo `victoreliezek/revenue-auditor-hub`, remote único `origin`, domínio de produção `ops.planningbrain.com.br` (antigo `planning.opsboard.com.br`, descontinuado em 2026-08-18). `git push origin main` já dispara o deploy.
