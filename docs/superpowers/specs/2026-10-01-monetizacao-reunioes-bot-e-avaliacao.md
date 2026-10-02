# Monetização · bot nas reuniões e nota automática de avaliação

Data: 2026-10-01. Dono do produto: Pedro Luca. Frente 05 da call de 01/10.

## O que o Pedro pediu (conversa, 01/10)

- "preciso que o bot seja convidado automaticamente para o Matheus ou para qualquer closer assim que a reunião for
  movida para agendada"
- "é pra ficar gravado, então quando a reunião for realizada, precisamos enviar uma nota automática no card avaliando a
  reunião exatamente como acontece hoje dentro do módulo do growth, só que para monetização e de acordo com os critérios
  do playbook"
- O closer registra toda reunião no card como atividade do tipo Reunião, com data, hora e link do Teams. Aprovado em
  01/10.

## O que já existe e não muda

- **Bot de reuniões (Brain Meet), do Mikael.**
  - Ele lê `growth.reunioes_agendadas` no projeto `npknehhyyzelmrbbxvtu`.
  - Em modo teste, pega só `event_id` com prefixo `pedido-` e `joiner_status` nulo.
  - Grava em `growth.gravacoes` (por `event_id`). A transcrição fica em `growth.gravacoes_transcricao` (`status`:
    fila, transcrevendo, pronta, sem_fala ou falhou) e as falas em `growth.gravacoes_falas` (`ordem`, `inicio_s`,
    `falante` = "Falante 1/2…", `texto`).
  - Do fim da reunião até `pronta` leva de 40 a 50 minutos.
  - No Teams, alguém precisa admitir "Planning - Assistente de Reuniao" no lobby. O limite é de 2 sessões simultâneas.
- **Como a SDR IA enfileira** (`growth.joiner_agendar_ia`, corpo em
  `/private/tmp/claude-502/-Users-pluca-Desktop-AI-Projects/ed0b4b56-83da-4dec-a98c-8d1b1c532527/scratchpad/f05b/funcs.sql`,
  linhas 566 em diante):
  - `event_id = 'pedido-ia-<deal>-<AAAAMMDDTHHMM UTC>'`;
  - na remarcação, a linha anterior do mesmo deal com `joiner_status` nulo e `inicio > now()` vira
    `status = joiner_status = 'cancelada'`;
  - o insert usa `on conflict (event_id) do update` só se `joiner_status` for nulo.
- **Não crie nem altere nada no schema `growth`.** Ele é do Mikael. A Edge Function grava direto em
  `growth.reunioes_agendadas` com service role e reproduz a lógica de `joiner_agendar_ia` em código, com o prefixo
  `pedido-monet-`. Sem `upsert` do PostgREST: faça um insert que ignora conflito e, em seguida, um update condicionado
  a `joiner_status is null`.

## A Edge Function `monetizacao-reunioes` (nova)

Deno, no padrão de `supabase/functions/monetizacao-crm/`:
- autenticação pelo segredo `x-monetizacao-sync` (o mesmo `MONETIZACAO_SYNC_SECRET`);
- `SUPABASE_SERVICE_ROLE_KEY`;
- `PIPEDRIVE_TOKEN`.

Ela recebe `{"action": "rodar"}`. Rode com `"dry": true` para não escrever nada e devolver o que faria.

### Parte A · Enfileirar (fica atrás da variável `MONET_BOT_ENFILEIRAR`; só roda com o valor `on`)

1. Os cards são os de `ops.monetizacao_deals`, abertos, cuja etapa atual é uma reunião. Leia a etapa por nome em
   `ops.monetizacao_sync.stages`, nunca por id:
   - `/reuni.*levantamento.*agend|reuni.*(agend|marc)/i` é levantamento;
   - `/reuni.*proposta/i` é proposta.
2. Para cada card, leia `GET /v1/deals/{id}/activities?done=0` no Pipedrive (`x-api-token`) e fique com as atividades
   de tipo `meeting`.
   - Início: `due_date` + `due_time`, que vêm em **UTC** na API v1. Confira com uma atividade real antes de confiar.
   - Fim: início + `duration`, ou 1 hora.
   - Link do Teams: o primeiro que casar `https://teams\.(microsoft|live)\.com/\S+` em `conference_meeting_url`,
     `location`, `public_description` ou `note`.
   - Ignore a atividade sem link, sem hora ou com início há mais de 1 hora.
3. Para a reunião válida mais próxima:
   - `event_id = 'pedido-monet-<deal>-<AAAAMMDDTHHMM UTC>'`;
   - `titulo = '<organização> · Caixa de Oportunidade · <Levantamento|Proposta>'`, até 200 caracteres;
   - `plataforma = 'teams'`, `status = 'agendada'`, `pedido_em = now()`;
   - `pedido_por_email` = e-mail do dono do card no Pipedrive (`GET /v1/users/{id}`), que é quem recebe o aviso "gravação
     pronta";
   - `departamento = 'Comercial'`, `departamento_origem = 'monetizacao'`. Se a coluna tiver check ou enum e recusar,
     deixe nulo e relate.
4. **Remarcação:** a linha `pedido-monet-<deal>-%` anterior, com `event_id` diferente, `joiner_status is null` e
   `inicio > now()`, vira `status = joiner_status = 'cancelada'`, com `joiner_erro = 'remarcada (Monetização)'`.
5. Grava ou atualiza `ops.monetizacao_reunioes`, descrita abaixo.
6. Cada rodada visita só os cards em etapa de reunião, cerca de 20 hoje. Respeite o limite do Pipedrive: em caso de
   429, espere e repita uma vez.

### Parte B · Avaliar e postar a nota

1. Linhas de `ops.monetizacao_reunioes` com `status in ('na_fila', 'gravando')` e `inicio < now() - 30 min`. Leia o
   `joiner_status` da fila, a `growth.gravacoes` por `event_id` e a `growth.gravacoes_transcricao` por `gravacao_id`.
2. **Transcrição `pronta`:**
   - leia as falas;
   - avalie pela rubrica;
   - poste a nota no card (`POST /v1/notes` com `deal_id`);
   - grave a avaliação, a nota, o ofertado e o id da nota;
   - mude o `status` para `avaliada`.

   Se a avaliação já existe, não poste de novo: uma nota por reunião.
3. **Sem gravação:** `joiner_status` em `falhou_lobby` ou `falhou_join`, transcrição `sem_fala` ou `falhou`, ou nada
   gravado 3 horas depois do início.
   - Poste uma nota curta: "Reunião de <tipo> de <data> sem gravação: <motivo em português>. Para a próxima, admita
     'Planning - Assistente de Reuniao' no lobby do Teams."
   - Mude o `status` para `sem_gravacao`.
4. **A avaliação** é o porte para TypeScript do protótipo validado em
   `/Users/pluca/Desktop/AI Projects/monetizacao/comercial/guia-closer/avaliacao/avaliar.py`, com a rubrica em
   `.../avaliacao/rubrica.json`. Copie a rubrica para dentro da função como JSON e mantenha a versão.
   - O modelo é `anthropic/claude-sonnet-5.5` na OpenRouter (`OPENROUTER_API_KEY`), com `max_tokens` 9000 e
     `reasoning.max_tokens` 2000.
   - Recuse resposta com `finish_reason` diferente de `stop`.
   - A transcrição vem das falas no formato `[mm:ss] Falante N: texto`. Abaixo de 2.000 caracteres, ela fica fora da
     régua: nota "sem conversa suficiente para avaliar".
   - **A conferência dos trechos e o cálculo da nota ficam iguais aos do protótipo:**
     - a comparação é normalizada: minúsculas, sem acento, só letras e dígitos;
     - o trecho conta se aparecer inteiro ou numa janela de 12 palavras seguidas;
     - o crédito é sim = 1, parcial = 0,5 e não = 0;
     - nota = 10 × Σ(crédito × peso) ÷ Σ(peso), com uma casa decimal;
     - antipadrão não desconta.
   - O HTML da nota é igual ao de `nota_pipedrive()` no protótipo. O título é "Avaliação da reunião por IA (playbook do
     Caixa) - confira antes de usar", como as notas do Growth.

## Migration: `ops.monetizacao_reunioes`

| coluna | tipo | |
|---|---|---|
| `event_id` | text, pk | `pedido-monet-…` |
| `deal_id` | bigint, não nulo | |
| `tipo` | text, check em (`levantamento`, `proposta`) | |
| `inicio`, `fim` | timestamptz | |
| `link` | text | |
| `closer_pipedrive_id` | bigint | dono do card |
| `atividade_id` | bigint | atividade do Pipedrive |
| `status` | text, check em (`na_fila`, `cancelada`, `gravando`, `avaliada`, `sem_gravacao`, `erro`) | |
| `gravacao_id` | uuid | |
| `avaliacao` | jsonb | saída de `apurar()` |
| `nota` | numeric(3,1) | |
| `ofertado` | jsonb | `{cella, consultoria, finance}` |
| `nota_pipedrive_id` | bigint | |
| `erro` | text | |
| `created_at`, `updated_at` | timestamptz | |

- RLS ligada. Pode ler quem passa em `ops.monetizacao_can('view.monetizacao')`, ou a função de permissão que a tabela
  `ops.monetizacao_deals` já usa; copie a policy dela. Escrita só com service role.
- Cron: `select cron.schedule('monetizacao-reunioes-5min', '*/5 * * * *', $$select ops.monetizacao_reunioes_cron()$$)`.
  A função `ops.monetizacao_reunioes_cron()` é igual a `ops.monetizacao_cron()`, mas chama a nova Edge Function. A
  definição dela está no banco; leia com `pg_get_functiondef`.
- Ponha a migration em `supabase/migrations/` com timestamp de hoje.

## Testes (obrigatórios antes de entregar)

1. **Avaliação:** um script Deno ou Node em `scripts/monetizacao/` roda a avaliação em TypeScript sobre a transcrição
   de teste. O caminho é `/private/tmp/claude-502/-Users-pluca-Desktop-AI-Projects/ed0b4b56-83da-4dec-a98c-8d1b1c532527/scratchpad/f05c/reuniao-20260910.md`.
   É dado de cliente: não copie para o repo.
   - Converta as falas de lá para o formato do Brain Meet e compare com o protótipo Python
     (`f05c/teste/avaliacao-proposta.json`).
   - A conferência dos trechos tem de dar o mesmo resultado sobre a mesma resposta do modelo.
   - Teste a função de conferência e a de nota com a resposta bruta salva, sem chamar o modelo de novo.
2. **Enfileirar em `dry`:** a função devolve, para os cards reais em etapa de reunião, o que faria. Hoje deve devolver
   "sem atividade de reunião com link" para todos, porque ninguém registra ainda.
3. Typecheck do Deno (`deno check`), se o Deno estiver instalado. Se não estiver, relate.

## Fora do escopo

- A tela Gravações e o campo de produtos ofertados no Pipedrive (frente 01).
- Mudar o modo do bot.

## Regras

- Não faça deploy, não aplique a migration, não crie secrets, não agende cron. Isso fica para depois da revisão.
- Commits pequenos na branch `feat/monetizacao-reunioes-20261001`, com o trailer
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push.
- Uma entrada no fim de `DECISIONS.md`.
