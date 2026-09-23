# Ambiente real do piloto — 22/09/2026

## Como a sessão começou

Pelo chat do Claude Code (extensão do VS Code), **sem o `start.py`**. Por isso nada do que o
iniciador preparava vale aqui: sem `--settings ../settings.json`, sem sandbox, sem `--plugin-dir`,
sem ponte Jev local (`PLANNING_JEV_URL`/`PLANNING_JEV_TOKEN` ausentes) e sem o arquivo
`jev-live-*.json` do teste inicial. A instrução do usuário desta sessão substitui as de
inicialização e preserva as regras de negócio e as fronteiras.

## Repositório

- Diretório: `PM Work/execution/planning-brain-cockpit-piloto-20260922/app` (PLANNING interno).
- Git próprio, branch `feat/cockpit-ceo-piloto`, **zero remotes**, árvore limpa no início.
- Commit inicial `2a08621` ("Baseline local do Planning Brain aa16914"); `baseline.json` aponta o
  commit de origem `aa169148` do worktree `planning-brain-filtros-multi`.

## Isolamento: NÃO comprovado

Verificações feitas no Bash desta sessão, sem enviar dado:

| Verificação | Esperado no piloto com sandbox | Resultado aqui |
|---|---|---|
| Ler `../isolation-canary.txt` (fora de `app/`) | negado | **permitido** |
| Criar `../sandbox-write-test` | negado | **permitido** (arquivo removido em seguida) |
| `curl https://example.com` (5 s, sem dado) | negado | **HTTP 200** |

Ferramentas disponíveis nesta sessão, além de Bash/leitura/edição: WebFetch/WebSearch, subagentes,
MCPs com escrita (Pipefy, n8n da Planning, Notion, Google Drive/Calendar, Rize, Higgsfield, Banco
MCP), CLIs `supabase` e `vercel` no PATH e diretórios adicionais de outros projetos (AZB, Downloads).
Modo de permissão sem confirmação por ferramenta.

Conclusão: **isolamento por pasta não é isolamento**. As restrições do piloto valeram nesta sessão
por disciplina do agente, não por barreira técnica. Restrições que segui:

- Nenhum MCP chamado. Nenhuma CLI de Supabase/Vercel executada. Nenhum push, deploy ou migration.
- Leitura fora de `app/` restrita a `../briefing`, `../superpowers`, aos arquivos do iniciador e ao
  canário sintético.
- Rede usada apenas para: `registry.npmjs.org` (instalação pelo lockfile), documentação oficial
  (openrouter.ai, docs.typesafe.ai) e, só depois de a chave ser cadastrada, a API de Decisions do
  OpenRouter com texto fictício — toda chamada passa pelo ledger `jev-chamadas.jsonl`.
- Preview roda com Supabase apontado para endereço local morto: não há como tocar o banco único.

Para uma execução prolongada sem supervisão, o isolamento precisa voltar a ser técnico (runner com
`settings.json` do piloto ou VM dedicada).

## Dependências e baseline

- `npm ci --ignore-scripts`: 498 pacotes, todos resolvidos em `registry.npmjs.org` (lockfile).
  Nenhum lifecycle script executado; build e testes funcionaram sem eles.
- Testes de domínio (`node --test tests/*.test.mjs`): **95/95**.
- `tsc --noEmit`: **7 erros preexistentes** (`integracoes-status.functions.ts`,
  `admin.integracoes.tsx` ×4, `rede-overview.tsx`, `reforma-tributaria.tsx`), os mesmos citados no
  `DECISIONS.md` de 22/09.
- `vite build` com `NODE_OPTIONS=--max-old-space-size=8192`: verde em ~41 s.

## Superpowers

A cópia 6.4.1 existe em `../superpowers`, mas o plugin **não está carregado** nesta sessão (nenhuma
skill `superpowers:*` na lista). Usei `writing-plans`, `executing-plans`, `test-driven-development`
e `verification-before-completion` como instrução lida do disco, com os scripts de workspace e
ledger executados diretamente. O plano está em
`docs/superpowers/plans/2026-09-22-cockpit-ceo-piloto.md` e o ledger em
`.superpowers/sdd/2026-09-22-cockpit-ceo-piloto/progress.md` (ignorado pelo Git).

## Contrato Jev conferido nas fontes oficiais (22/09)

- `POST https://openrouter.ai/api/alpha/decisions` (a referência mostra `/api/alpha/decisions` com
  override de servidor para `https://openrouter.ai`); autenticação Bearer.
- Corpo: `model`, `state` (texto ou objeto), `questions` (mapa). Primitivas `choice` (criteria
  mapa), `score` (criteria lista ordenada, ≥1) e `noul` (criteria `{"true","false"}`).
  `instructions` e `criteria` são **obrigatórios** nas três pelo schema do OpenRouter; a página da
  TypeSafe descreve os critérios do `noul` como opcionais — sigo o schema do endpoint.
- Resposta: `id`, `model` (ex.: `typesafe/jev-1.13-20260917`), `provider`, `answers`, `usage`
  (`input_tokens`, `output_tokens`, `cost` **opcional**).
- `choice` → `choice`, `confidence?`, `probabilities?`; `score` → índice esperado entre 0 e n−1
  (pode ficar entre níveis), `confidence?`, `probabilities?`, `legend?`; `noul` → probabilidade
  0–1, **sem campo de confiança**.
- TypeSafe: confiança resume o formato da distribuição e **não é a probabilidade de a resposta
  estar certa**; limiares dependem do domínio e devem ser testados com dados próprios.
- Erros documentados: 400, 401, 402 (crédito), 403, 404, 413, 429, 500, 502, 503, 524, 529.

Divergência encontrada no material preparado: `jev_bridge.py` enviava a pergunta `noul` sem
`criteria`, o que o schema atual rejeita. O adaptador desta branch envia os critérios.
