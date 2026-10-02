# Monetização · tela Gravações e o ofertado no campo do pipe

Data: 2026-10-02. Dono do produto: Pedro Luca. Frente 05 da call de 01/10 ("Duplicar do growth uma área para registrar
todas as gravações e transcrições"; "pela gravação da call vou saber o que tá ofertado"). Conteúdo aprovado no mockup
https://claude.ai/artifact/GS3D2jtsYttXfmWp4EdzDG. Contrato: `docs/design/contratos/monetizacao-gravacoes.md`.
Vem depois de `2026-10-01-monetizacao-reunioes-bot-e-avaliacao.md` (bot, avaliação e `ops.monetizacao_reunioes`).

## 1. A tela (`/monetizacao?aba=gravacoes`)

Item "Gravações" em Desenvolvimento comercial. Arquétipo Lista/Relatório com a Ficha ao lado (no celular, em `Sheet`).

- **Pergunta:** "O que foi dito e ofertado em cada reunião do pipe 39?"
- **Linhas** (`src/lib/monetizacao/gravacoes.ts`, `montarReunioes`):
  - reunião registrada: `ops.monetizacao_reunioes` sem as canceladas (o bot foi pedido pela atividade de Reunião);
  - histórico do card, para card e tipo sem reunião registrada:
    - levantamento: o card chegou a levantamento agendado ou além pela régua cumulativa (etapa em que ficou 30 min,
      de onde avançou ou em que terminou). Data = primeira entrada em levantamento realizado ou além (Stand by conta
      como realizado), senão em agendado;
    - proposta: entrada em "Reunião de proposta" desde 01/10/2026 (a etapa nasceu no funil novo).
- **Situação da gravação:** Na fila · Gravando · Avaliada · Sem gravação · Erro (do `status` da linha registrada) e
  Sem registro no card (card aberto hoje em levantamento agendado ou em reunião de proposta, sem linha registrada).
  Histórico que não está pendente = Sem gravação.
- **Números** (mesma unidade, reunião; N = reuniões do recorte de mês e busca): Avaliadas "X de N", Na fila do bot,
  Sem registro no card, Sem gravação. Cada um filtra a lista.
- **Ficha:** situação explicada, avaliação (nota, blocos, fases, recomendação), ofertado com trecho, minuto e
  confiança, o que a reunião somou ao campo do pipe, e a transcrição por falante com exportar .txt.
- **URL:** `mes` (aaaa-mm, padrão todos), `gravacao`, `q`, `reuniao`.
- Conferido contra a carga real de 02/10: 69 reuniões (setembro 48 levantamentos; outubro 10 levantamentos e 11
  propostas). Os 15 "Sem registro no card" são os mesmos 15 cards que o cron `monetizacao-reunioes-5min` lista como
  "sem atividade de Reunião com hora e link do Teams". Contra o mockup de 01/10, a única diferença em setembro é o card
  98000, que entrou em agendada em 30/09 e em realizada em 01/10: pela data da reunião, ele é de outubro.

## 2. A trava (quem vê o quê)

O closer vê só as reuniões dos próprios cards; admin da Monetização (nível 3) e super admin veem todas. A regra mora no
servidor (migration `20261002180000_monetizacao_gravacoes.sql`):

- **Closer** = login do Brain com o mesmo e-mail do usuário do Pipedrive dono do card. Não existia essa ponte; a
  tabela `ops.monetizacao_closers` nasce com Matheus (28381245) e Willian (24813890), e a Edge Function a completa
  quando lê o dono do card. Conferido em 02/10: os e-mails batem nos dois.
- **Admin** = `ops.nivel_na_area(uid, 'monetizacao') >= 3` (super admin é 4). Com "ver como" ativo, ninguém é admin nem
  closer (mesma escolha da Base).
- `ops.monetizacao_gravacoes_lista()` (security definer) devolve só as reuniões que a pessoa pode ver, sem trecho e sem
  transcrição. `ops.monetizacao_gravacao(event_id)` confere de novo e só então lê `growth.gravacoes_falas`; a mesma
  mensagem serve para "não existe" e "é de outro closer".
- A RLS de `ops.monetizacao_reunioes` passa de "quem vê a Monetização" para a mesma regra (a coluna `avaliacao` tem
  trechos da conversa).
- As linhas do histórico vêm da carga do CRM, que a Operação já mostra a quem tem `view.monetizacao`; a tela aplica o
  mesmo recorte do closer a elas para não misturar reunião alheia.
- Teste: `tests/monetizacao-gravacoes.sql`, bloco único que termina em exceção. Ensaiado em 02/10 contra a produção com
  a migration dentro do bloco: `TESTE_OK`, e nada ficou gravado. Com os logins reais (no mesmo ensaio): Willian closer
  sem admin; Matheus admin (nível 3); Paulo (diretor, vê a Monetização) sem nada; Pedro admin.

**Fora do alcance desta trava: o Brain Meet do Growth.** As gravações `pedido-monet-` nascem abertas lá
(`growth.gravacoes_acesso` sem linha `particular`), e `growth.meet_gravacoes` e `growth.meet_transcricao` deixam
qualquer pessoa ativa com acesso a algum produto listar e ler a transcrição. Fechar isso é decisão do Mikael (o schema
é dele): ou marcar como particular cada `pedido-monet-` (com o closer e os admins em `permitidos`), ou uma regra para o
prefixo em `growth.meet_acesso_liberado`. Nada foi alterado no Growth.

## 3. "Caixa · Produtos ofertados" atrás de chave desligada

Campo do pipe 39 (frente 01): key `3298fa5361fa4a37c1b614518d6dc43b38645f8b`, tipo set, 1150 Cella, 1151 Consultoria,
1152 Finance. Lógica em `supabase/functions/monetizacao-reunioes/ofertado.ts`; Parte C de `index.ts`.

- **Confiança** (a partir do formato de `avaliacao.ts`, onde `apurar()` só deixa "sim" com trecho conferido):
  - alta: o trecho inteiro, normalizado, está numa fala da transcrição;
  - média: só 12 palavras seguidas do trecho estão numa fala;
  - nula: não apresentado, ou trecho não achado em fala nenhuma.

  O minuto é o início da fala. A avaliação passa a gravar `confianca` e `inicio_s` em cada produto do `ofertado`.
- **Limiar para gravar: confiança alta.** O campo só soma e nunca desfaz, então a dúvida fica de fora. Avaliação
  gravada antes desta versão (sem confiança) não passa.
- **Regra:** união com o que já está marcado no card (GET do card, PUT com a união); nunca remove. A linha registra o
  que a reunião somou (`ofertados_gravados`) e quando (`ofertados_gravados_em`); vazio com data = nada a somar.
  Idempotente: reunião com data não é relida, e a união repetida não muda o card.
- **Chave:** só roda com o secret `MONET_GRAVAR_OFERTADOS=on`. O padrão é desligado, e o secret não foi criado.
- Teste com o Pipedrive simulado (`tests/monetizacao-gravacoes.test.mjs`): desligado não chama a API; ligado faz PUT
  com a união ("1150,1152" quando o Finance já estava marcado); nada a somar não chama a API; já marcado só lê;
  reunião já gravada não é relida; ensaio (`dry`) não escreve.
- Antes de ligar: o prompt da frente 05 pede a calibração com uma amostra rotulada pelo Pedro.

## 4. Ordem para ir ao ar (cada passo com o "ok" do Pedro)

1. **Migration** `20261002180000` (aceita a função e o app antigos: só acrescenta tabela, colunas e funções, e aperta a
   RLS de uma tabela que hoje está vazia).
2. **Edge Function** `monetizacao-reunioes` (grava `confianca`/`inicio_s`, completa os closers e traz a Parte C
   desligada). Depende das colunas novas só com a chave ligada.
3. **App** (a tela usa as RPCs da migration).
4. Depois da calibração: o secret `MONET_GRAVAR_OFERTADOS=on`.

## 5. Fora do escopo

- Importar o MeetGeek da Monetização (1 reunião, fora do banco) e as gravações do Brain Meet pedidas à mão.
- Editar nota, ofertado ou card pela tela.
- Mudar o modo do bot ou o acesso no Growth.
