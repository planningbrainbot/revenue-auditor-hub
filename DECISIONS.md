# Log de Decisões — Planning Dashboard

Log append-only de decisões de produto/arquitetura/negócio tomadas em conversas com o Claude Code (ou qualquer outra ferramenta). Cada sessão nova deve ler este arquivo inteiro antes de propor mudanças em áreas que já têm decisão registrada aqui, e deve adicionar uma entrada nova sempre que uma decisão não-óbvia for tomada — mesmo que a implementação ainda não tenha sido feita.

Nunca editar ou apagar entradas antigas. Se uma decisão for revertida, adicionar uma entrada nova referenciando a antiga.

Formato de cada entrada:

```
## [2026-09-15] Admin delegado do Financeiro, e o escopo do cockpit vira linha por pessoa

**Contexto:** o dono pediu duas coisas que não cabiam no modelo. (1) "a ana
consiga administrar acesso só da parte do financeiro, e não de todos os outros
módulos" — e `assertAdmin` é `has_role(user,'admin')`, binário, com dois admins;
dar admin à Ana daria os três produtos mais escrita em repasses, royalties e
sócios. (2) "quero dar acesso só à partners para o eliezek, ou só à Marox para o
roney" — e as oito chaves `view.brain_financeiro_*` viviam em
`ops.role_permissions`, que é (PAPEL, chave); as oito estavam marcadas para
`admin` e `financeiro`, e o papel `financeiro` tem oito pessoas. As oito recebiam
as oito unidades, idênticas.

Medido antes de desenhar: `public.produto_acesso` não tinha NENHUMA tela — a
porta dos três produtos era concedida só por SQL na mão. E `ops.can()` não lê
`role_permissions`: lê `user_roles → role_areas → area_chaves → areas`. Os dois
modelos discordam em 198 pares (papel, chave), e 16 dessas divergências são
exatamente as oito chaves do Financeiro nos dois papéis — elas não estão em
`area_chaves` nenhuma.

**Decisão — a concessão sai do papel e vira linha, na tabela que JÁ EXISTIA.**
O recorte passa a vir de `ops.usuario_escopo.todas_empresas` +
`ops.usuario_empresas`. Isto era o item "Pendente" declarado no commit
`078eabe` do mesmo dia: *"sessoes-irmas.functions.ts ainda monta o escopo do
cockpit lendo role_permissions em vez de ops.usuario_empresas"*.

**Erro meu, registrado porque custa caro repetir:** eu cheguei a criar
`public.produto_escopo` para isto, às 13h39 — três horas depois de `078eabe`
subir com o mesmo propósito. Não vi porque estava lendo um checkout local vinte
commits atrás do `origin/main`. A tabela foi apagada na migration 20260915190000,
com gate provando que ninguém perdia acesso na troca (as 23 linhas de
`usuario_escopo` estão com `todas_empresas = true`, então o estado descrito pelas
duas tabelas era idêntico). A dele fica porque é mais fina (empresa, não
unidade — "só a PARTNERS dentro da EXPANSÃO" só cabe nela), porque a flag
`todas_empresas` continua certa quando uma empresa nova for cadastrada amanhã, e
porque serve aos dois produtos. **Antes de criar tabela num repo de outra pessoa,
`git fetch` e leia o `origin/main`.**

NEO entrou junto, por decisão do dono: existia em `unidades_navegacao` com nove
telas habilitadas e não tinha chave em lugar nenhum.

**Decisão — admin delegado é ÁREA nova, não chave na área `admin`.**
`role_areas` é (papel, área), então pendurar a chave nova na área `admin`
obrigaria a dar as outras seis junto, incluindo `view.admin.credenciais` (chaves
do Asaas). Então: área `admin_financeiro`, chave `admin.acessos.financeiro`,
papel `financeiro_admin`. Ana Aguiar recebeu o papel — das duas Anas, é a que já
entrou no sistema (a carvalhais nunca logou).

**Decisão — `ops.can` passa a delegar para `ops.can_user(uuid, text)`.** O
servidor fala como service_role, onde `auth.uid()` é nulo, então precisava de uma
versão com a pessoa explícita. Escrita uma vez só: duplicar a lógica (a regra do
`data.scope.own_unit_only` é sutil) divergiria na primeira manutenção. 111
policies chamam `ops.can`; o gate comparou as 2.624 combinações (pessoa × chave)
antes e depois — zero divergências, 656 liberadas nas duas.

**Decisão — a concessão passa a ser sincronizada, não só emitida.** Achado do
caminho: `garantirSessoesIrmas` só reemitia quando faltava `brain.financeiro`.
Com ela presente, `updateUserById` nunca mais rodava e o `app_metadata` do
cockpit ficava congelado no dia da primeira entrada — as seis pessoas com sessão
lá estavam todas com os oito escopos de agosto. Isso tornava o painel inútil dos
dois lados: conceder não chegava, e REVOGAR não chegava também. Agora
`sincronizarConcessaoFinanceiro` roda a cada navegação e grava
`financeiro: false` quando a pessoa perdeu o acesso.

**Status:** aplicado em produção (`npknehhyyzelmrbbxvtu`, migration
20260915170000) e implementado. Tela em `/admin/acessos-financeiro`, guardada por
`ops.can('admin.acessos.financeiro')` no beforeLoad e em cada server fn — é a
única tela da Administração que não exige admin global. Ela é também o primeiro
uso do escape hatch `Item.area`: sem área própria o item herdaria `admin` e a
controladoria continuaria barrada. `areasVisiveis` no app-sidebar ganhou a
segunda condição correspondente — uma área aparece quando a pessoa tem a área
dela OU a área declarada por algum item seu. Build e typecheck limpos (os erros
remanescentes em reconciliacao.functions.ts e admin.integracoes.tsx são
anteriores e não foram tocados). Três pessoas administram: pedro.luca,
victor.eliezek e ana.aguiar.

**Próximos passos:** (a) a redundância dos dois modelos de permissão continua —
a chave nova foi semeada nos DOIS (`role_permissions` para a lateral aparecer,
`area_chaves` para o guarda passar) e isso está marcado como provisório na
migration; reconciliar é trabalho separado. (b) as oito chaves
`view.brain_financeiro_*` em `role_permissions` agora são legado: quem manda é
`produto_escopo`, e elas só servem de fallback para quem não tiver linha.
(c) no cockpit, `exigirEscopo` é chamado por 1 de 31 edge functions — o escopo
concedido aqui só vira barreira de verdade quando ele for espalhado, e isso NÃO
pode ir no mesmo release que acrescentar unidade nova à lista do consolidado.


## [YYYY-MM-DD] Título curto da decisão

**Contexto:** por que isso surgiu / qual problema resolve.
**Decisão:** o que foi decidido, especificamente.
**Status:** não implementado | parcialmente implementado | implementado (commit/arquivo).
**Próximos passos:** se houver.
```

---

## [2026-09-09] Fim do vocabulário de franquia: papel `socio_franqueado` vira `socio_regional`

**Contexto:** a Planning é uma rede de unidades regionais, no modelo de agência de banco — "franquia", "franqueadora" e "franqueado" não descrevem o negócio e não devem aparecer na plataforma. O termo estava espalhado em rótulo de papel, subtítulo de tela, descrição de permissão, textos de ajuda e comentários.

**Decisão — o papel passa a se chamar `socio_regional` / "Sócio Regional".** O rótulo antigo era "Sócio Franqueado" e precisava continuar distinguível do papel `socio` (matriz), por isso "Sócio Regional" e não só "Sócio". A troca inclui a chave técnica, não só o rótulo: `roles`, `role_permissions` (22 linhas), `user_roles` (2 usuários) e o valor do enum legado `public.app_role`. Foi seguro porque nenhuma policy de RLS e nenhuma função citam o papel pelo nome — as policies vão por `public.can(permission_key)` — e `app_role` não tipa coluna nenhuma, só a função `has_role`.

**Decisão — `tipo_unidade = 'franquia'` fica como está.** É valor de dado gravado em `empresas`/`contratos` pelos syncs (Pipedrive, Omie, n8n), fora deste repo. Não aparece em tela nenhuma, e trocá-lo exigiria coordenar a migração com todos os produtores ao mesmo tempo. Mesma razão para a tabela `recebimentos_franquias` e para o campo `nome_da_unidade_franqueada` do Pipefy, que é slug de campo externo.

**Decisão — `src/lib/franquias.ts` vira `src/lib/unidades-rede.ts`,** com `FRANQUIA_UNIDADES` → `UNIDADES_REDE` e `isFranquiaUnidade` → `isUnidadeDaRede`. Nas telas, "take rate da franquia" virou "take rate da rede", "obrigações financeiras com a franqueadora" virou "com a matriz", e "ROAS de expansão de franquia" virou "da rede".

**Status:** implementado no dev server local (`npm run build` limpo; `tsc --noEmit` sem nenhum erro novo — os 6 arquivos que já erravam antes seguem iguais e nenhum deles foi tocado). Migration em `supabase/migrations/20260909120000_papel_socio_regional.sql`, **ainda não aplicada**. Não commitado nem deployado.

**Atenção na hora de aplicar:** dev local e produção compartilham o banco `ulgiochewwpmmssksqlw`. Entre aplicar a migration e publicar o frontend novo, a produção (código velho, comparando com `socio_franqueado`) deixa de reconhecer o papel e os dois usuários caem no menu interno em vez do menu "Minha Unidade". Não vaza dado — `role_permissions` migra junto e as policies continuam resolvendo por permissão —, mas o menu fica errado nessa janela. Hoje só `italo.amaral@grupoplanning.com.br` e a conta de teste `victoreliezek@gmail.com` têm o papel, então a janela é de baixo impacto; ainda assim, aplicar migration e deploy na mesma janela.

## [2026-09-03] Broker: fatura de CashBrain passa a ser cobrada pelo Asaas (reverte decisão do mesmo dia)

**Contexto:** a entrada anterior de hoje registrou a decisão de **não** usar Asaas, para não misturar os recebimentos de royalties com os do broker, deixando a emissão preparada e desintegrada. O usuário reverteu no mesmo dia: "decidi que irei conectar com asaas mesmo".

**Decisão:**

1. **Asaas vira o gateway das faturas de CashBrain.** A separação de recebimentos, se ainda importar, terá de vir de carteira ou conta distinta dentro do próprio Asaas — não da escolha de gateway. Fica registrado porque foi a razão original de excluí-lo.
2. **Quem credita é o webhook, nunca a criação da cobrança.** `broker-asaas-cobranca` gera a cobrança e grava link, linha digitável e pix na fatura; `broker-asaas-webhook` recebe `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED` e chama `broker_fatura_pagar_por_gateway`, que lança o aporte. Fatura gerada não move saldo.
3. **O webhook é a única porta que credita sem uma pessoa**, então valida o header `asaas-access-token` contra `ASAAS_WEBHOOK_TOKEN` e **recusa tudo com 503 quando o segredo não está configurado** — mudo é melhor que aberto. Deploy com `verify_jwt = false`, porque quem chama é o Asaas.
4. **Idempotente de propósito:** `broker_fatura_pagar_por_gateway` devolve a fatura sem lançar nada se já estiver paga, e índice único em `referencia_externa`. O Asaas reenvia o webhook em caso de falha, e reenvio não pode creditar duas vezes. Cobrança que não corresponde a fatura nenhuma (outra carteira na mesma conta) responde 200 e é ignorada, para não gerar reenvio infinito.
5. **Cliente do Asaas é criado sob demanda** a partir de `unidades.cnpj`/`razao_social` e guardado em `unidades.id_asaas` (hoje vazio nas 11). Antes de criar, procura por CNPJ — cadastro pode já existir. **Construção Civil e Consultoria não têm CNPJ** e vão falhar com mensagem explícita; nenhuma das duas é franquia.
6. **Falha de cobrança não desfaz a fatura.** Se o gateway recusar, a fatura fica aberta sem link e a matriz ainda pode dar baixa à mão. A tela avisa em vez de fingir que deu certo.
7. **`ASAAS_BASE_URL` decide sandbox × produção**, e `ASAAS_BILLING_TYPE` o meio (padrão `UNDEFINED`, deixando o pagador escolher entre boleto, pix e cartão).

**Status:** implementado e deployado (migration 37, `broker-asaas-cobranca` v1, `broker-asaas-webhook` v1), **inativo até os segredos existirem**. Verificado que sem `ASAAS_API_KEY` a cobrança falha com mensagem clara e a fatura sobrevive, e que sem `ASAAS_WEBHOOK_TOKEN` o webhook responde 503. Front não commitado.

**Próximos passos:** definir `ASAAS_API_KEY`, `ASAAS_WEBHOOK_TOKEN` e `ASAAS_BASE_URL` nos secrets do Supabase; cadastrar a URL do webhook no painel do Asaas com o mesmo token; rodar uma cobrança de ponta a ponta no sandbox antes de apontar para produção.

## [2026-09-03] Broker: ficha do cliente, prazo de precificação e fatura de CashBrain

**Contexto:** com as duas telas no ar, o sócio da unidade não tinha como decidir a compra — a vitrine mostrava só empresa, segmento e preço. Faltava também o caminho do dinheiro: como a unidade obtém CashBrain.

**Decisão:**

1. **A vitrine passa a mostrar a ficha do cliente**, sincronizada do Pipedrive: faturamento anual, regime tributário, canal (campo fechado), condutor da reunião comercial, se usa ERP, segmento, estado e nome do contato. Nenhum desses revela composição de custo — qualificam o cliente sem abrir o motor. Preenchimento real de 37 a 42 de 42 registros.
2. **As duas análises de IA do Planning Brain são notas do deal, não campos.** Não existem em `dealFields` (520 campos, nenhum bate); a IA escreve como nota. O sync busca por marcador de texto ("Qualificação por IA", "Direcionamento de FUP"), com teto de 25 deals por rodada — varrer tudo já estourou o limite do Edge Function antes. Aparecem em "Minhas reservas", recolhidas, com o aviso "gerado por IA, confira antes de usar" que o próprio Planning Brain assina.
3. **Prazo de precificação de 7 dias, configurável em `broker_config`.** Só corre para reserva que ainda não tem preço — com preço não há o que precificar. **Nada expira sozinho:** a tela avisa que a matriz *pode* devolver o cliente para a fila, e a devolução é ato humano. Automatizar isso é decisão em aberto.
4. **A aba "Extrato" da unidade virou "Movimentações".** "Extrato" fica reservado para o financeiro, na aba de faturas.
5. **O saldo diz de onde veio o crédito:** `broker_saldo` ganhou `credito_recebido` (tipo `credito`, atribuído pela matriz) e `credito_comprado` (tipo `aporte`, comprado pela unidade). O card de "Crédito recebido" saiu do topo e virou duas linhas dentro do card de Disponível.
6. **Fatura de CashBrain = compra de crédito, e o crédito nasce do pagamento.** A unidade pede X CashBrain e a fatura nasce `aberta`; o movimento de `aporte` só é lançado quando a matriz dá baixa. Assim o saldo nunca mostra crédito não pago. **1 CashBrain = R$ 1,00** — o preço já é MRR × multiplicador em reais, então a paridade é por construção. Vencimento em 5 dias.
7. **Emissão fica preparada e desintegrada de propósito.** Decisão do usuário: não será Asaas, para não misturar os recebimentos; provavelmente outro gateway, com registro no Omie depois. `broker_faturas` já tem `gateway`, `referencia_externa` e `omie_id`, nenhum preenchido nesta versão. Enquanto isso a unidade lê instruções de pagamento de `broker_config.instrucoes_pagamento` — **texto placeholder, precisa ser revisto antes de ir para a rede**.
8. **`v_broker_meu_saldo` calcula direto de `broker_movimentos`, não pela view `broker_saldo`.** Uma view definer que lê uma view invoker volta a rodar como o usuário final, e o franqueado não tem SELECT na tabela — o saldo saía zerado. Bug encontrado só porque havia movimento real para conferir.

**Adendo — a unidade passa a precificar pelo broker (03/09):**

9. **Botão "Precificar" em Minhas reservas, e a escrita vai ao Pipedrive primeiro.** O Pipedrive é a fonte de verdade do MRR (DATA-RULES), então a ordem é: checar permissão → gravar `value = mrr × 12` lá → gravar aqui. O inverso quebraria: se a escrita no Pipedrive falhasse depois da local, o `broker-sync-fila` devolveria o preço antigo em 15 minutos e o bloqueio de saldo criado pelo gatilho ficaria pendurado sem preço que o justifique.
10. **O caminho passa por uma Edge Function nova (`broker-precificar`)**, não por server function do Ops. O Ops board não fala com o Pipedrive em lugar nenhum e não tem o token; quem tem é o Supabase. A permissão não é checada na Edge Function: ela chama `broker_pode_precificar` e `broker_precificar` com o JWT de quem pediu, então a regra vive só no banco.
11. **`broker_preco_definido` passou a carimbar o autor.** O gatilho gravava o bloqueio de saldo sem `criado_por` — o extrato mostrava a reserva sem dizer quem a causou.

**Consequência que fecha o assunto do vazamento:** com a unidade digitando o MRR e vendo o preço em CashBrain na mesma tela, o multiplicador passa a ser obtido por uma divisão. Não é mais um risco teórico. Enquanto o preço for múltiplo limpo do MRR, a camada interna é derivável — resolver exige faixa por porte ou arredondamento em degraus.

**Achado não resolvido:** `estorno` entra somando em `creditado`, junto de `credito` e `aporte`. Serve para reverter débito, mas **não reverte um aporte** — e `valor_cb > 0` impede lançamento negativo. Hoje não há caminho de correção para crédito lançado a mais. Precisa de um tipo de movimento redutor ou de permitir sinal.

**Status:** implementado e validado em dev local com login de franqueado real (migrations 31 a 35, já aplicadas). Não commitado nem publicado.

## [2026-09-02] Broker da Expansão: tela da matriz antes da tela da unidade

**Contexto:** o backend do broker está pronto (tabelas, extrato imutável, apuração do multiplicador, sync da fila do Pipedrive, gatilho de fechamento). O plano previa `/broker` para a unidade antes de `/broker/admin`. Ao levantar o mapeamento usuário→unidade descobriu-se que **os franqueados não têm login**: `socios` tem 35 linhas mas só 2 com `user_id`, e 12 dos 14 usuários do ops board são contas `@planning.com.br` da matriz. A tela da unidade não teria para quem servir.

**Decisão:**

1. **Inverter a ordem do F3: a tela da matriz (`/broker/admin`) vem primeiro.** Ela não depende de mapeamento por unidade, só de `view.broker_admin`, e deixa a matriz operar o broker à mão — reservar em nome de uma unidade, lançar crédito e aporte, acompanhar extrato e saldo, definir o multiplicador aplicado. O backend fica utilizável de imediato em vez de esperar um processo de RH.
2. **Mapeamento usuário→unidade usa `socios.user_id` + `socios.unidade`, não tabela nova.** A ponte já existe no schema; o que falta é preenchimento. Fica registrado que `socios.unidade` é texto livre e `unidades` usa `nome_da_praca` — os nomes precisam casar antes de qualquer RLS por unidade.
3. **Três chaves de permissão:** `view.broker` (unidade), `view.broker_admin` (matriz) e `manage.broker` (operar). Sem `manage.broker` a tela da matriz abre em leitura. Concedidas a admin e diretor; `view.broker` já vai para `socio_franqueado` para quando os logins existirem.
4. **`broker_reservar`, `broker_liberar` e `broker_fechar` viraram `SECURITY DEFINER` com checagem própria de permissão.** Como `INVOKER` a escrita era barrada pelo RLS de `broker_movimentos` (que só tem policy de SELECT) e o erro só apareceria no clique. Como as três são chamáveis direto pelo PostgREST, confiar na checagem da camada de aplicação deixaria a porta aberta por baixo — daí `broker_exige_operar()` dentro de cada uma. `broker_fechar` perdeu o grant de `authenticated` porque quem a chama é o gatilho em `contratos`, onde não há usuário logado.
5. **`broker_saldo` ganhou `security_invoker = true`.** Como view comum ela rodava com os direitos do dono, então o RLS de `broker_movimentos` não valia para quem lesse por ela: qualquer usuário logado veria o saldo de toda a rede.
6. **O `aplicado` do multiplicador só muda por ato humano e exige justificativa.** O job mensal grava `apurado` e nunca move `aplicado` — ele herda o do mês anterior. A tela é a única porta que move o preço que a rede vê, e o formulário recusa salvar sem observação. Piso de 1,0 validado no servidor.
7. **A tela da matriz mostra custo; a da unidade nunca vai mostrar.** Mídia, time C&M, New MRR, apurado e composição de preço ficam atrás de `view.broker_admin`. A unidade vê preço por cliente e mais nada — decisão de negócio já registrada no modelo, aqui virando fronteira técnica.

**Status:** implementado, validado só em dev local (`src/lib/broker.functions.ts`, `src/components/broker/broker-admin-view.tsx`, `src/routes/_authenticated/broker.admin.tsx`, sidebar e `KNOWN_PERMISSIONS`). Migrations 27 e 28 **já aplicadas** no banco (ficam em `AI Projects/migrations/`, que é onde as do broker moram). Não commitado nem deployado.

**Adendo do mesmo dia — tela da unidade (`/broker`) construída:**

8. **A unidade lê só views, nunca as tabelas.** `broker_oportunidades` e `broker_movimentos` tiveram a policy de SELECT restringida a `view.broker_admin`. A unidade lê `v_broker_fila`, `v_broker_extrato` e `v_broker_meu_saldo`, que expõem preço e mais nada e já filtram por `minhas_unidades()`. Verificado logando como o franqueado do RJ: tabelas cruas devolvem 0 linhas, a view devolve a fila com 8 colunas (sem `mrr_precificado`, sem `multiplicador`). Sem isso, conceder `view.broker` teria aberto a tabela inteira pela API mesmo sem tela.
9. **Autoatendimento por `broker_reservar_minha(oportunidade)`.** A unidade nunca informa o próprio id — ele vem de `socios.user_id` via `minhas_unidades()`. `broker_reservar` passou a aceitar dono da unidade além de `manage.broker`, e `broker_liberar` só deixa liberar o que é seu. Testado: franqueado do RJ não reserva para outra unidade nem forjando o id no parâmetro.
10. **O franqueado tem um menu próprio (`SOCIO_FRANQUEADO_GROUPS`), separado do time interno.** Item novo precisa ser adicionado nos dois lugares — adicionar só em `DEFAULT_GROUPS` faz a página existir e ficar invisível para a rede, que foi o que aconteceu na primeira tentativa.
11. **Vaza multiplicador por aritmética, e a tela não resolve.** Quem precifica o cliente é a unidade (F0-02), então ela sabe o MRR; vendo o preço em CB, dividir dá o multiplicador. Fechar isso exige o preço deixar de ser múltiplo limpo do MRR — faixa por porte ou arredondamento em degraus. **Decisão de modelo ainda em aberto**, e vale resolver antes de a tela ir para a rede.

**Próximos passos:** criar login dos franqueados e preencher `socios.user_id` (F3-06); depois RLS por unidade (F3-04) e a tela `/broker` (F3-01). Alinhar `tools/broker_sync_fila.py` ao `/stages/{id}/deals`, que hoje diverge da Edge Function em produção.

## [2026-08-25] Fila Cella (Funil B): tela nova em `/fila-cella`, migrations commitadas e **não aplicadas**

**Contexto:** o canal dedicado sobre a base instalada (Funil B) era operado numa planilha gerada por `build_planilha.py`, que é reconstruída a cada rodada — e a reconstrução apaga a camada operada (relacionamento, estágio, próximo passo, log de toques). A spec `spec-tela-fila-cella.md` v0.3 pediu a tela dentro do Ops. Esta entrada registra o que foi decidido no caminho, porque várias dessas escolhas contradizem documento existente e a próxima sessão precisa saber por quê.

**Decisão:**

1. **Migrations vão como PR e NÃO foram aplicadas.** As seis (`20260826080000` a `20260826094000`) estão commitadas em `supabase/migrations/`. Nenhuma rodou contra o banco. A regra da casa é mergear primeiro e aplicar depois; quem aplicar precisa rodar na ordem `090000 → 091000 → 092000 → 093000 → 094000`, e a de RLS (`080000`) é independente das outras cinco.
2. **`types.ts` não foi regenerado, e por isso a tela usa `(supabase as any).from(...)`.** Sem as tabelas no banco não há o que gerar. Precedente do repo para o mesmo caso: `cac.functions.ts:410` e `rede-headcount.tsx:61`. Quando as migrations forem aplicadas, regenerar `types.ts` e trocar `FilaContaRow` (`src/lib/fila-cella.types.ts`, escrito à mão) por `Database["public"]["Views"]["v_fila_cella"]["Row"]` é troca mecânica.
3. **A tela distingue "não migrado" de "vazio".** `listarFilaCella` classifica erro de relação ausente num estado nomeado (`nao_migrado`) em vez de lançar, e KPIs/cobertura/higiene renderizam `—`, nunca `0`. Zero é uma afirmação, e enquanto as migrations não rodarem a tela não tem o que afirmar. O matcher de erro (`relacaoAusente`) é defensivo de propósito: o código exato que o PostgREST devolve aqui **não foi verificado** contra o banco. Apertar na primeira execução real.
4. **Ordenação padrão ≠ Score.** A `v_fila_cella` ordena pelas 5 chaves que o Matheus já opera (`build_planilha.py:107-109`), com o veto de "Alerta aberto" na frente. Isso **contradiz `README.md:11`** ("curva → segmento → MRR"), que descreve a v1 da planilha. Score existe como coluna e como ordenação clicável, mas não é a ordem de abertura — ordenar por score colocaria conta sem ECD ao lado de conta com sinal apurado, e as duas não são comparáveis (daí a coluna `score_comparavel`).
5. **Força fica na regra (a) de `casa_ecd.py:88-94`, provisoriamente.** As três regras concorrentes de Força não foram conciliadas; a D1 continua aberta. A view implementa (a) e a aba Dicionário diz, na tela, que a decisão está pendente. Quando a D1 fechar, muda a CTE `sinal` da `20260826094000` e a função `calcularScore` de `fila-cella.functions.ts` — que é canônica: se as duas divergirem, vale o TypeScript.
6. **ECD entra materializada, não federada.** `ecd_empresa`/`empresa_consumo`/`ecd_gatilho_conta` recebem agregado por CNPJ vindo do Postgres da ECD (AWS). Linha crua de ECD não atravessa. O job que carrega (`carrega-ecd-para-ops.mjs`) mora **fora** deste repo e não faz parte deste PR — a credencial de leitura da ECD é a D9 e não cruza a fronteira do repositório.
7. **Cinco chaves novas de permissão**, semeadas na `20260826090000` e declaradas em `KNOWN_PERMISSIONS`: `view.fila_cella`, `manage.fila_cella`, `manage.de_para_cnpj`, `manage.fila_cella_sync`, `manage.fila_cella_override`. Sem o seed, `can()` volta `false` e nem admin abre a tela — mesma pegadinha registrada na entrada de 2026-08-24.
8. **Duas correções contra a spec v0.3**, ambas marcadas no `.sql`: (a) `ecd_empresa_curva_exige_receita` usava `receita_operacional > 0`, que **passa** quando a receita é NULL (CHECK que devolve NULL não rejeita) — virou `coalesce(receita_operacional,0) > 0`; (b) o fallback de razão social na view só cobria string vazia e deixava passar `'.'`, `'0'`, `'-'`, que são o lixo que a própria spec nomeia — virou regex que exige duas letras.

**Status:** parcialmente implementado. Tela, rota, server functions, hooks, componentes e navegação estão no código e passam no build. As migrations estão commitadas e **não aplicadas**, então a tela abre no estado `nao_migrado` até alguém rodá-las. O job de sync (`fila-cella-sync.functions.ts`), o handoff em PDF e o export do relatório semanal ficaram fora desta rodada.

**Próximos passos:**
- Revisar e aplicar as seis migrations (ordem acima). Depois: regenerar `types.ts` e trocar os `as any` da tela.
- Fechar a D1 (regra de Força) e a decisão de schema do 5º toque: `check (toque_num between 1 and 4)` e "5º toque com `manage.fila_cella_override`" se contradizem — ou o override significa reabrir ciclo, ou o CHECK vira trigger.
- Escrever o trigger de reentrada no banco. Hoje a trava dos 60/180 dias vive só no servidor (`abrirCiclo`), então escrita direta com `service_role` a contorna.
- Decidir o corte fuzzy sub-piso do de-para: a spec diz que abaixo de 0,45 entra como sugestão pendente, mas a constraint `piso_fuzzy` rejeita a linha inteira. A sugestão não tem onde morar.

## [2026-08-25] Revisão adversarial da Fila Cella: a migration de RLS vira aditiva por construção

**Contexto:** a branch `feat/fila-cella-e-performance-rls` foi submetida a uma revisão adversarial no mesmo dia. O revisor **também não conseguiu ler `pg_policies` no Ops** — o conector MCP do Supabase não aparece em `claude mcp list`, não há `.env` com credencial do Ops no clone e não há `psql` nesta máquina. Ou seja: a transcrição de `qual` que a `20260826093000` usava continuou não-verificável na segunda leitura. O que mudou não foi a informação; foi o desenho, para que a falta de informação deixe de importar.

**Decisão:**

1. **`20260826093000` não substitui mais `qual` transcrito à mão.** Os seis `alter policy … using (<lista escrita à mão>)` viraram um bloco que **lê o `qual` vivo em `pg_policies` e soma `(select public.can('view.fila_cella'))` com OR**. `alter policy … using` substitui a expressão inteira: com a lista transcrita, qualquer termo que exista no banco e não esteja na lista era **revogado em silêncio**. Cinco das seis policies estavam corroboradas em migration do repo; `contratos_documentos` não tem migration nenhuma. A forma aditiva não tem esse caminho — não existe entrada em que ela remova um termo. Se a policy não existir, ela **cria** (criar é aditivo: RLS é permissivo). Os seis comandos explícitos ficam comentados no apêndice do arquivo, porque documentam o estado lido em 25/08. Mesma técnica que a `20260826080000` já usava; não é convenção nova neste PR.
2. **`fila_cella_conta_operacao.estagio` ganhou `check`.** Nascia sem domínio, enquanto `relacionamento`, `papel_decisao`, `frente_escolhida` e `forca_override` tinham o seu. Como `salvarCampoOperado` grava com `supabaseAdmin` (RLS não filtra) e o validador não conferia, qualquer string entrava — e `kpisDaily` conta proposta comparando o estágio com string literal. Estágio fora da lista não dava erro: dava **KPI errado, calado**. O validador do servidor passou a conferir os cinco campos de domínio fechado.
3. **Oito índices de FK acrescentados às migrations novas.** A `20260826080000` (PARTE B) roda **antes** das cinco da Fila Cella, então as FKs criadas por elas não passavam por ela e reabriam o aviso `unindexed_foreign_keys` que ela acabara de zerar: `fila_cella_contas.gatilho_principal`, `fila_cella_toques(ciclo_id, frente)` / `gatilho_ref` / `corrige_toque_id`, `fila_cella_ciclos.conta_id` (só havia o parcial de ciclo aberto, que não serve ao `on delete cascade`), `ecd_gatilho_conta(cnpj, ano)` (só havia o parcial `where abs(valor) >= 1`) e `ecd_gatilho_conta.gatilho`, e `empresa_cnpj_de_para.empresa_id`.
4. **A verificação §8.0 da `20260826080000` deixou de ser circular.** O item (a) usava a própria transformação como oráculo — prova que ela convergiu, não que não sobrou chamada solta. Uma chamada que a regex não alcança (argumento com parênteses dentro) daria zero. Foi acrescentada a contagem independente do §8.1 dentro da migration, como `raise notice` (não aborta: falso positivo aqui não justifica derrubar 112 correções).
5. **Dois contratos de API que mentiam foram fechados.** `registrarToque` aceitava `override_motivo` e o **descartava** no insert — removido do contrato, porque o 5º toque é recusado pelo `check (toque_num between 1 and 4)` de qualquer jeito (a contradição da spec §6.5 continua aberta). E `resolverCnpjConta` devolvia `duplicate key value violates unique constraint …` cru quando o deal já tinha outro CNPJ principal — que é exatamente o caso de **corrigir um CNPJ errado**; virou mensagem de negócio.

**Status:** implementado na mesma branch, commits de correção. **Nenhuma migration foi aplicada; nenhum push em `main`; nada foi escrito em banco nenhum.** A revisão confirmou por leitura de `src/integrations/supabase/types.ts` (arquivo gerado do banco vivo) que as seis tabelas-alvo da `093000` existem, que `can`/`has_role`/`is_custom_role`/`current_user_unidade` existem com as assinaturas usadas, e que `app_role` tem `admin`, `diretor` e `auditor`. **Não** foi possível confirmar o `qual` vivo de nenhuma policy — daí a decisão 1.

**Próximos passos:** os mesmos da entrada anterior. Acrescente-se: ao aplicar a `093000`, ler o `raise notice` dela — ele imprime o ANTES e o DEPOIS de cada uma das seis policies, que é a pré-checagem transcrita, medida em vez de suposta.

## [2026-08-24] "Marcar churn" em /clientes vira permissão (`manage.clientes_churn`), separada de editar razão social/CNPJ

**Contexto:** usuário pediu que outros usuários (não só admin) pudessem marcar churn pela tela de Clientes, "como admin", mas transformando isso numa permissão ativável por usuário/papel — não abrindo pra todo mundo.
**Decisão:** nova chave `manage.clientes_churn` em `KNOWN_PERMISSIONS` (`permissions.functions.ts`), mesmo padrão de `manage.repasses` — checada via `can()` no servidor, não `has_role`. `marcarChurnCliente` (`clientes.functions.ts`) troca `assertAdmin` por essa checagem; `atualizarCliente` (editar razão social/CNPJ) **continua admin-only** — não fazia parte do pedido, e mexe em dado que sync automático pode sobrescrever (risco já documentado). Na UI (`clientes.tsx`), a coluna "Ações" e o botão "Marcar churn" aparecem pra quem é admin OU tem a permissão nova; o botão "Editar" (razão social/CNPJ) continua só pra admin dentro da mesma coluna. Concessão por usuário específico (não só por papel inteiro) usa o mecanismo de perfis customizados que já existe em `/admin/usuários` + `/admin/permissoes` (`view.admin.profiles`) — não foi criado nada novo pra granularidade por usuário.
**Status:** implementado. Migration `20260824160000_permissao_marcar_churn_clientes.sql` semeia `admin=true` (aplicada direto via REST no Supabase, pra não quebrar o próprio admin — sem o seed, `can()` volta `false` e ninguém, nem admin, conseguia mais marcar churn). Commitado e enviado pra `main` (`fd69c9a`) a pedido do usuário.
**Próximos passos:** usuário decide quais papéis/usuários recebem `manage.clientes_churn` em `/admin/permissoes`; commit + deploy quando confirmado.

## [2026-08-18] Domínio de produção trocado para ops.planningbrain.com.br

**Contexto:** `planning.opsboard.com.br` (consolidado em [2026-07-03](#2026-07-03-domínio-de-produção-consolidado-em-planningopsboardcombr)) deixou de ser o domínio desejado; nova marca/domínio é `planningbrain.com.br`.
**Decisão:** domínio oficial passa a ser `ops.planningbrain.com.br`, mesmo projeto Vercel `revenue-auditor-hub` (team `victor-eliezek` — não `planning-ops`, que estava errado nas memórias/decisões antigas). `planning.opsboard.com.br` é removido do projeto assim que o novo domínio verificar.
**Status:** parcialmente implementado — domínio adicionado ao projeto Vercel via CLI, aguardando registro DNS (`A ops.planningbrain.com.br → 76.76.21.21`, DNS only) ser criado manualmente na zona Cloudflare de `planningbrain.com.br`. URL do logo hardcoded em `src/components/reforma-tributaria/html-generator.ts` já atualizada.
**Próximos passos:** após verificação da Vercel, marcar `ops.planningbrain.com.br` como Primary e rodar `vercel domains rm planning.opsboard.com.br --scope victor-eliezek`. Conferir se algum link antigo (Slack, favoritos, e-mails automáticos) ainda aponta pro domínio antigo.

## [2026-07-03] Churn não propagava pros outros meses da apuração (royalties_itens é por mês)

**Contexto:** usuário marcou churn da "Academia de Líderes do Brasil" (data do churn: fev/26) enquanto olhava a apuração de julho/2026 de Belém. O card foi criado no Pipefy normalmente (`churn_pipefy_card_id` gravado no item de julho), mas ao navegar pra junho/2026 (mesmo contrato) o cliente continuava aparecendo em "Só no Pipedrive" pra apurar, sem o badge "churn" — pareceu que o churn não tinha funcionado. Causa raiz: `royalties_itens` é gerado **por apuração** (uma linha por contrato por mês) — `marcarChurn` só atualizava a linha do item clicado, então meses diferentes do mesmo contrato (passados ou futuros já criados) nunca ficavam sabendo do churn.
**Decisão:** `marcarChurn` agora propaga `churn_pipefy_card_id`/`churn_reportado_em` pra todas as outras linhas de `royalties_itens` do mesmo `contrato_id`, em apurações com `mes_referencia >= mês da data do churn` e status ainda não fechado (`rascunho`/`em_revisao` — nunca `confirmado`/`faturado`, mesma trava que já existe pra edição normal de item). Meses **antes** da data do churn não são tocados (cliente ainda estava ativo). Fiz backfill manual do caso já reportado (item de junho/2026 da Academia de Líderes do Brasil, id 163) direto via Supabase REST, já que o código novo só vale daqui pra frente.
**Status:** implementado. Arquivo: `src/lib/royalties.functions.ts` (`marcarChurn`). Build validado (mesmos erros de typecheck pré-existentes de `churn_pipefy_card_id`/tipos do Supabase desatualizados — não são novos, é o mesmo gap já documentado na entrada de "Editar CNPJ" acima, só que agora também aparece nessa query nova por tocar a mesma tabela).
**Próximos passos:** essa propagação só cobre apurações **já criadas** no banco. Se `gerarItensApuracao` gerar um mês novo no futuro (ex: agosto/2026) pra um contrato já marcado como churn, o item novo nasce sem o churn (porque `gerarItensApuracao` não consulta churn de outros meses ao criar itens, e a data exata do churn não é uma coluna própria em `royalties_itens` — só existe como campo no card do Pipefy e, com delay de sync, em `central_tratativas.data_churn`). Se isso incomodar na prática, a correção completa exigiria: (a) persistir `data_churn` como coluna em `royalties_itens` (hoje só existe `churn_reportado_em`, que é a data do clique, não a data real do evento), e (b) `gerarItensApuracao` checar essa data ao criar cada item novo. Não fiz agora pra não expandir escopo sem confirmar com o usuário — é uma decisão de schema, não só de código.

## [2026-07-03] Navegação de mês direto na tela de apuração de royalties (não só na lista)

**Contexto:** ao investigar por que "Aguia Produção Audiovisual LTDA" não casava na apuração de julho/2026 de Belém, descobri que o pagamento era de junho (26/06) — mas pra conferir a apuração de junho da mesma unidade era preciso voltar pra lista (`/royalties`, que já tem seletor de mês com setas ←/→ em `apuracao-royalties-content.tsx`) e clicar de novo na unidade. Dentro da tela de detalhe (`/royalties/$unidadeId/$mes`) não existia nenhuma forma de trocar de mês — só voltar.
**Decisão:** setas de mês anterior/próximo também no cabeçalho da tela de detalhe, ao lado do botão "Royalties" (voltar), navegando via `Link to="/royalties/$unidadeId/$mes"` com `mes` deslocado (`shiftMes`, mesma lógica já usada na lista — duplicada localmente, seguindo o padrão que o próprio `formatMesLabel` já tinha entre os dois arquivos). Não criei um componente compartilhado pra isso — são 6 linhas, dois arquivos, sem necessidade real de abstrair ainda.
**Status:** implementado. Arquivo: `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` (`ApuracaoLoaded` agora recebe `unidadeId` como prop). Build e typecheck validados (zero erros novos).
**Próximos passos:** nenhum pendente.

## [2026-07-03] Limpeza de `empresas` duplicadas (rede inteira) — 85 linhas removidas

**Contexto:** usuário notou que a apuração de royalties de Belém/jul-26 tinha 46 clientes com Pipedrive ID, mas a tela Clientes mostrava 63 pra mesma unidade. Investigação (comparando direto com a API do Pipedrive) confirmou: `empresas` nunca é limpa quando um deal sai do pipeline de vendas ativo (só `contratos` é podado por `sync_pipedrive_contratos.py`, linhas 409-421), então deals "(cópia)" do pipeline 28 (mirror da Central de Contratos) e reaberturas ("Segunda Oportunidade") ficaram como linhas fantasma em `empresas` pra sempre — sem CNPJ, sem contrato, mas com nome idêntico ao cliente real (a limpeza do sufixo "(cópia)" acontece antes de gravar, por isso a duplicata é invisível a olho nu na tela Clientes). Exemplo confirmado: "Almare Hoteis" tinha 3 linhas (`empresas.id` 36/158/525) pro mesmo CNPJ 60508567000103.
**Decisão:** cleanup em duas passadas via SQL direto (Supabase Management API), sempre com keeper = a linha que tem contrato Ativo correspondente (por CNPJ normalizado ou pipedrive_deal_id) e losers = as demais do mesmo grupo (mesma unidade + mesmo CNPJ normalizado, ou mesma unidade + título normalizado quando CNPJ está em branco). Antes de apagar: (1) backup completo em `empresas_backup_20260703` (999 linhas, tabela mantida no banco pra rollback se precisar); (2) merge das colunas do loser pro keeper via `COALESCE(keeper, loser)` — nunca sobrescreve valor já preenchido do keeper, só completa o que estava vazio; (3) reaponta `contratos.empresa_id` e `nps_pesquisas.empresa_id` de loser pra keeper antes de apagar (evita violar FK). Grupos onde os membros tinham CNPJs distintos entre si (ex: "Rocha Distribuidora e Comercial Ltda", duas razões sociais reais com o mesmo nome fantasia) foram propositalmente **excluídos** do merge automático — ambíguo demais pra decidir sem revisão humana.
**Status:** implementado. 85 linhas removidas de `empresas` em toda a rede (Matriz 26, Belém 14, Rio de Janeiro 10, Campo Novo 9, Construção Civil 9, São Luís 6, Patos de Minas 4, Maceió 3, Fortaleza 3, Curitiba 1). Belém: 63→49 empresas vs 46 contratos ativos (gap residual de 3, ver próximos passos).
**Próximos passos:** ficou um resíduo de grupos onde 2+ linhas de `empresas` batem no **mesmo** contrato via CNPJ (não 2 contratos diferentes) — caso do "Almare Hoteis" id 525 (mesmo CNPJ de id 36, mas título "ALMARE HOTEIS LTDA" não bate exato com "Almare Hoteis" nem entrou no grupo por CNPJ porque ambos já contam como "tem contrato"). Não mexi nesses de propósito — decidir se vale automatizar essa camada extra ou revisar manualmente. Vale também considerar consertar na origem: `sync_pipedrive_contratos.py` poderia apagar (ou marcar inativa) a `empresas` correspondente quando o `contrato` dela é removido no passo 3 do `run_sync()`, pra não reacumular esse tipo de lixo.

## [2026-07-10] Apuração de royalties e CAC abrem no mês fechado por padrão (não no mês corrente)

**Contexto:** usuário relatou que toda vez que abre `/royalties` ou `/cac` acha que está vendo junho, mas na verdade está aberto julho — porque `defaultMes()` em ambas as páginas usava o mês calendário atual. Isso não faz sentido pra essas duas telas especificamente: apuração de royalties/CAC só pode ser fechada depois que o mês termina (é preciso esperar o mês fechar pra apurar), então abrir no mês corrente sempre mostra uma apuração prematura/vazia. A página de Auditoria de Faturamento já tinha resolvido o mesmo problema antes (`auditoria-faturamento-content.tsx`, `defaultMes()` usa mês anterior) — só não tinha sido replicado pras outras duas.
**Decisão:** `defaultMes()` em `apuracao-royalties-content.tsx` e `apuracao-cac-content.tsx` agora retorna o mês anterior ao corrente (mesmo padrão da Auditoria de Faturamento). Além disso, adicionei um aviso visual (badge amarelo) quando o mês exibido (via navegação ←/→) é o mês corrente ou futuro, avisando que "a apuração só fecha depois que o mês termina" — cobre o caso de o usuário navegar manualmente pro mês atual e ficar confuso de novo.
**Status:** implementado. Commit `87029d2`, arquivos `src/components/royalties/apuracao-royalties-content.tsx` e `src/components/cac/apuracao-cac-content.tsx`. Push feito pra `origin/main`, deploy automático disparado. Typecheck rodado (`tsc --noEmit`) sem erros novos nesses dois arquivos (erros pré-existentes em `reconciliacao.functions.ts`, `reconciliacao.tsx`, `rede-overview.tsx`, `reforma-tributaria.tsx` não são relacionados).
**Próximos passos:** nenhum pendente. Se surgir outra tela de "apuração/fechamento mensal" no futuro, replicar o mesmo padrão de `defaultMes()` = mês anterior.

## [2026-07-03] Editar CNPJ direto no item "Só no Pipedrive" da apuração de royalties

**Contexto:** contratos sem CNPJ cadastrado (campo customizado vazio no Pipedrive) nunca casam com o Omie — ficam presos em "Só no Pipedrive" pra sempre, mesmo que o cliente esteja pagando normalmente, porque `gerarItensApuracao` cruza por CNPJ e não tem outro jeito de linkar. Não havia nenhuma forma de corrigir isso pela UI; só editando direto no Supabase.
**Decisão:** botão de editar (ícone lápis, no lugar do "—") na coluna CNPJ da seção "Só no Pipedrive", visível só quando `it.cnpj` é null, `it.contrato_id` existe e a apuração não está fechada. Abre diálogo simples (só o campo CNPJ). Ao salvar: (1) `atualizarCnpjContrato` grava o CNPJ em `contratos.cnpj` (não em `empresas.cnpj` — mesmo motivo já documentado no sync do Pipedrive: risco de colidir com `empresas_cnpj_unique` se o CNPJ já existir em outra empresa; `contratos.cnpj` é o único campo que `gerarItensApuracao` realmente lê pro match); (2) encadeia automaticamente o mesmo fluxo do "Forçar atualização" (`regerarMatchApuracao` + `gerarItensApuracao({force:true})`), então se o Omie já tiver recebimento com esse CNPJ o item vira "Matched" na hora, sem passo manual extra.
**Status:** implementado. Arquivos: `src/lib/royalties.functions.ts` (`atualizarCnpjContrato`), `src/hooks/use-royalties.ts` (`useAtualizarCnpjContrato`), `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` (`EditarCnpjButton`, handler `handleSalvarCnpj`). Build e typecheck validados localmente (zero erros novos).
**Próximos passos:** nenhum pendente. Mesma limitação de sempre: como o CNPJ é validado só por 14 dígitos (sem dígito verificador), um CNPJ digitado errado mas com 14 dígitos válidos entra sem aviso — se isso virar problema recorrente, vale adicionar validação de dígito verificador.

## [2026-07-03] Perfis dinâmicos: NPS/Tratativas na leitura de rede + páginas sem chave de permissão própria

**Contexto:** ao testar o perfil customizado "CS" (criado logo depois da feature de perfis dinâmicos acima), duas coisas quebraram: (1) NPS e Tratativas apareciam liberados na tela "Permissões" mas os dados não carregavam — porque permissão de página (`role_permissions`) e RLS (acesso real às linhas no Postgres) são camadas independentes, e o escopo original só cobria Clientes/Unidades; (2) várias páginas do sidebar (LTV Estimado, Headcount, Realizado Unidades, Reconciliação, página "Unidades" do grupo Receita da Rede) não tinham checkbox nenhum na tela "Permissões" — elas "pegavam carona" em chaves de outras páginas (`view.clientes`, `view.roas`, `view.auditoria.cac`), então não dava pra liberar/bloquear cada uma individualmente pra um perfil novo. Além disso, `view.nps`/`view.tratativas`/`view.funil_receita` já existiam como chaves em `KNOWN_PERMISSIONS` mas o sidebar nunca as usava de fato (usava `view.clientes`/`view.roas` no lugar).
**Decisão:** (1) mais 2 políticas RLS aditivas (`nps_pesquisas`, `central_tratativas`) pra perfis customizados, mesmo padrão de `is_custom_role()` — confirmado com o usuário antes de aplicar, já que amplia o escopo de dados combinado na decisão anterior. (2) 5 chaves de permissão novas (`view.rede_ltv`, `view.rede_headcount`, `view.rede_realizado`, `view.reconciliacao`, `view.unidades_rede`) + rewiring de `view.nps`/`view.tratativas`/`view.funil_receita` pras chaves que já existiam mas não eram usadas — com seed em `role_permissions` pros 6 papéis de sistema preservando exatamente o acesso que cada um já tinha antes da troca (perfis customizados como "cs" não foram alterados, ficam a critério do admin na tela de Permissões). `funil-content.tsx` também tinha um gate interno duplicado em `view.roas` que precisou ser trocado pra `view.funil_receita` pra não ficar inconsistente com o sidebar.
**Status:** implementado. Migration `supabase/migrations/20260703200000_permissoes_paginas_dedicadas.sql` aplicada em produção. Arquivos: `src/lib/permissions.functions.ts`, `src/components/app-sidebar.tsx`, `src/components/page-content/funil-content.tsx`.
**Próximos passos:** `view.roas` ficou só usado por `auditoria-faturamento-content.tsx` agora (não mais pelo sidebar) — não foi tocado, mas vale revisar se essa chave ainda faz sentido isolada ou se devia virar `view.auditoria` também. Se outro perfil customizado precisar de mais tabelas de dados além de Clientes/Unidades/NPS/Tratativas, repetir o padrão de política RLS aditiva por tabela.

## [2026-07-03] Perfis de usuário dinâmicos (tela "Perfis")

**Contexto:** usuário pediu uma tela para criar novos perfis de usuário (ex: "Financeiro"), não só novos usuários. Os papéis existentes (Admin, Diretor, Sócio, Head, Auditor, Sócio Franqueado) eram um enum fixo do Postgres (`app_role`) amarrado a ~25 políticas RLS em ~20 tabelas, separado da tela "Permissões" (que já era genérica por chave de permissão). Criar só uma tabela de perfis sem tocar nisso resultaria em perfis que aparecem no menu mas não leem nenhuma tabela de dados.
**Decisão:** nova tabela `public.roles` (key/label/description/is_system) substitui o enum como fonte de verdade dos perfis; `user_roles.role` e `role_permissions.role` viraram `text` com FK pra `roles.key`. `has_role(uuid, app_role)` manteve a mesma assinatura (só o corpo mudou pra comparar como texto) para não invalidar nenhuma política RLS existente dos 6 papéis de sistema — zero mudança de comportamento pra eles. Perfis customizados (`is_system=false`) ganham automaticamente leitura de rede (somente leitura) em **Clientes** (`empresas`, `contratos`) e **Unidades** (`unidades`) via 3 políticas RLS aditivas novas e a função `is_custom_role()` — escolha deliberada do usuário, mais restrita que dar acesso tipo Auditor a todas as ~14 tabelas que ele lê. Nenhum perfil customizado tem escrita em tabelas sensíveis (repasses, royalties, sócios) — isso continua exclusivo do Admin. Perfis de sistema são protegidos: não editáveis/excluíveis pela UI nova. Visibilidade de outras páginas continua manual, via tela "Permissões" (agora alimentada por `roles` em vez do array fixo `ALL_ROLES`).
**Status:** implementado. Migration `supabase/migrations/20260703190000_dynamic_roles.sql` aplicada em produção via Supabase Management API (verificado: `has_role` retorna `true` pra todos os usuários existentes após a migration — sem regressão). Arquivos: `src/lib/roles.functions.ts` (novo), `src/lib/permissions.functions.ts`, `src/lib/admin-users.functions.ts`, `src/hooks/use-permissions.ts`, `src/routes/_authenticated/admin.perfis.tsx` (novo), `src/routes/_authenticated/admin.usuarios.tsx`, `src/routes/_authenticated/admin.permissoes.tsx`, `src/components/app-sidebar.tsx`, `src/integrations/supabase/types.ts`.
**Próximos passos:** nenhum pendente. Se no futuro um perfil customizado precisar ler outras tabelas de dados hoje gated por `has_role(...)` direto (NPS, tratativas, contas a receber, CM/rateio, financeiro partners etc.), será preciso ampliar `is_custom_role()`/novas políticas RLS por tabela — não é automático via tela "Permissões" (que só controla visibilidade de página, não RLS).

## [2026-07-03] Restaurado acesso de admin/diretor a Financeiro Partners / Receita Partners / Despesas Partners

**Contexto:** usuário percebeu que o grupo "Planning Partners" (Financeiro Partners, Receita Partners, Despesas Partners) sumiu do sidebar. Investigação mostrou que `role_permissions` tinha **zero linhas** para `view.financeiro_partners`, `view.receita_partners`, `view.despesas_partners` — nenhum papel, nem admin, tinha essas permissões concedidas no banco (o item do sidebar só aparece se o papel do usuário tiver a permissão marcada `allowed=true`). Não foi causado pela página de Comissões (diff de `app-sidebar.tsx` e `permissions.functions.ts` não tocou esse grupo) — o gap já existia no banco antes.
**Decisão:** conceder `view.financeiro_partners`, `view.receita_partners`, `view.despesas_partners` para os papéis `admin` e `diretor` via upsert direto em `role_permissions` (Supabase REST, service_role). Além disso, usuário pediu explicitamente: **admin deve sempre ter todas as páginas/permissões `view.*` ativas** — regra geral daqui pra frente, não só para essas 3.
**Status:** implementado (upsert rodado 2026-07-03T17:53). Na mesma conversa, usuário confirmou a regra geral e uma varredura completa de `admin` vs `KNOWN_PERMISSIONS` foi feita: além das 3 acima, faltavam `view.comissoes`, `view.funil_receita`, `view.meus_royalties`, `view.nps`, `view.painel_unidade`, `view.reforma_tributaria`, `view.tratativas` — todas concedidas a `admin`. Resultado: admin tem hoje 23/23 permissões de `KNOWN_PERMISSIONS`, exceto `data.scope.own_unit_only` (não é uma página, é uma flag de restrição — dar essa ao admin restringiria, não liberaria, então foi deixada de fora de propósito).
**Próximos passos:** ao adicionar qualquer nova permissão `view.*` em `KNOWN_PERMISSIONS` (`src/lib/permissions.functions.ts`), conceder também para `admin` em `role_permissions` no mesmo passo — não deixar como tarefa manual separada em `/admin/permissoes`.

## [2026-07-03] Página de Apuração de Comissões (Closer/SDR) + closer/sdr sincronizados em `contratos`

**Contexto:** era preciso conferir, venda a venda, se ela foi realizada e paga antes de calcular comissão de Closer/SDR. O módulo de Auditoria já cobria quase tudo (razão social, CNPJ, data de fechamento, status/valor/data do 1º pagamento), mas Closer e SDR não existiam em nenhuma tabela do Supabase — só como campos customizados do deal no Pipedrive (`Closer Responsável` = chave `82f35432010d0c95fceeaa0b5bce5f8e7542a795`, `SDR responsável` = chave `216740813ecdc3d64c03e5e1d5685050048a01d1`, ambos `enum`).
**Decisão:** trazer Closer/SDR pelo sync diário existente (`/Users/victoreliezek/sync_pipedrive_contratos.py`, roda às 07:00 via LaunchAgent `com.victoreliezek.pipedrive-sync`), não ao vivo do Pipedrive nem em branco — consistente com a arquitetura de fonte única já estabelecida. Duas colunas novas (`closer`, `sdr`, nullable) em `contratos`. Página nova (não uma aba dentro de Auditoria) em `/comissoes`, com permissão própria `view.comissoes`, seguindo o padrão de página de conteúdo sem `beforeLoad` (visibilidade só via sidebar, igual `funil-receita`/`contas-receber`). Coluna "Nome" da tabela usa `deal_titulo` (nome do negócio no Pipedrive); "Valor/Data do Pagamento" usa o **primeiro** pagamento RECEBIDO em `contas_receber` (novo campo `valor_primeiro_pag` em `AuditRegistro`, análogo ao `data_primeiro_pag` já existente), não o total acumulado.
**Status:** implementado. Migration `supabase/migrations/20260703173326_contratos_closer_sdr.sql` já aplicada em produção via Supabase Management API; sync rodado manualmente uma vez para backfill (119/310 contratos com closer/sdr preenchidos — o resto reflete deals do Pipedrive sem esses campos preenchidos, não é bug). Arquivos: `src/lib/audit-types.ts`, `src/components/audit/data-context.tsx`, `src/lib/permissions.functions.ts`, `src/components/app-sidebar.tsx`, `src/components/page-content/comissoes-content.tsx`, `src/routes/_authenticated/comissoes.tsx`.
**Próximos passos:** nenhum pendente. Se no futuro quiserem apurar comissão sobre parcelas além da primeira, o dado (`pagamentos_mensais`) já existe em `AuditRegistro` e só falta expor na UI.

## [2026-07-03] Correção: contrato sem CNPJ desaparecia da apuração de royalties

**Contexto:** clientes com `mrr_mensal > 0` e recebimento no Omie não apareciam na apuração de royalties. Causa raiz: `gerarItensApuracao` (`src/lib/royalties.functions.ts`) filtrava `.not("cnpj", "is", null)` e também pulava contratos com CNPJ vazio na montagem do `contratoMap` — o contrato sumia da apuração inteira em vez de aparecer como pendência.
**Decisão:** contrato sem CNPJ agora gera um item `categoria: "royalties"`, `status_match: "so_pipedrive"`, `cnpj: null`, com `observacao` sinalizando "Contrato sem CNPJ cadastrado — não foi possível conciliar com o Omie."
**Status:** implementado (commit `ce33c0f`, `src/lib/royalties.functions.ts:219-243`). Vale rodar "Forçar atualização" nas apurações já existentes de todas as unidades pra aplicar a correção retroativamente.

## [2026-07-03] Botão "Forçar atualização" na apuração de royalties

**Contexto:** `gerarItensApuracao` só roda uma vez por apuração (skip se já existem itens) — pagamentos/contratos que entram no Omie/Pipedrive depois da apuração já gerada nunca aparecem, mesmo com CNPJ batendo dos dois lados. Não havia forma manual de reprocessar pela UI.
**Decisão:** botão "Forçar atualização" no cabeçalho da tela de apuração (`src/routes/_authenticated/royalties.$unidadeId.$mes.tsx`), visível só quando a apuração não está fechada. Ao clicar: chama `regerarMatchApuracao` (apaga itens automáticos não confirmados) e depois `gerarItensApuracao({force: true})`. Itens confirmados ou manuais nunca são apagados.
**Status:** implementado (commit `7379874`).

## [2026-07-03] Domínio de produção consolidado em planning.opsboard.com.br

**Contexto:** existiam dois projetos Vercel deployando a mesma aplicação — `planning-dashboard` (URL antiga `planning-dashboard-mu.vercel.app`) e `revenue-auditor-hub` (URL correta, domínio custom `planning.opsboard.com.br`). Isso gerava confusão sobre qual link é o oficial.
**Decisão:** projeto Vercel `planning-dashboard` foi excluído. Único projeto válido daqui pra frente: `revenue-auditor-hub` (team `planning-ops`), domínio oficial `planning.opsboard.com.br`. Remote git local também foi simplificado — `origin` aponta direto pro `revenue-auditor-hub` (não existe mais remote `prod` separado).
**Status:** implementado (projeto Vercel excluído, remotes confirmados). Pendente: configurar redirect 308 de `revenue-auditor-hub.vercel.app` → `planning.opsboard.com.br` no painel da Vercel (Settings → Domains → Edit no domínio `.vercel.app` → "Redirect to another domain").

## [2026-07-02] Feature de "marcar churn" na apuração de royalties — decisão perdida

**Contexto:** existem duas colunas na tabela `royalties_itens` (`churn_reportado_em`, `churn_pipefy_card_id`) que sugerem uma feature planejada de marcar um cliente como churn direto na tela de apuração de royalties. Essas colunas foram criadas direto no Supabase Studio (não há migration correspondente em `supabase/migrations/`), e nada no código (`royalties.functions.ts`, `royalties.$unidadeId.$mes.tsx`) as utiliza.
**Decisão:** **NENHUMA AINDA REGISTRADA.** Uma conversa em 2026-07-02 aparentemente definiu como essa feature deveria funcionar, mas não deixou rastro em código, migration ou memória — o contexto foi perdido. Se você (humano) lembrar o que foi decidido, descreva aqui antes de qualquer implementação.
**Status:** não implementado. Colunas existem no banco, órfãs.
**Próximos passos:** decidir (a) o que "marcar churn" deve fazer ao item da apuração (zerar+confirmar / remover / só registrar), (b) se deve refletir em `central_tratativas` (fonte oficial de churn usada em `clientes.tsx`/`rede-overview.tsx`) ou ficar restrito à apuração de royalties, (c) qual é a integração com Pipefy esperada por `churn_pipefy_card_id`.

## [2026-07-03] Feature de "marcar churn" — resolvida e implementada

**Contexto:** retoma a entrada de 2026-07-02 acima (contexto perdido). Usuário re-explicou o requisito: na apuração de royalties, precisa de forma simples de notificar churn de um cliente (data + motivo); essa ação precisa impactar o pipe "Tratativas" no Pipefy, e o pipe (via sync já existente) atualiza `central_tratativas` no Supabase. Descobri em paralelo que `sync_pipefy_tratativas.py` (script em `~/`, LaunchAgent `com.victoreliezek.pipefy-tratativas-sync`, roda a cada 15min) já existe desde 2026-07-02 17:27 e seu próprio docstring já previa este botão: "cards são criados manualmente pelo time ou via botão 'Marcar churn' na tela de royalties do Ops Board (chama a API do Pipefy direto, sem passar por este script)" — ou seja, parte da decisão perdida sobreviveu no código desse script, só a metade "criar o card" nunca foi escrita.
**Decisão:**
- Botão "Marcar churn" (ícone `UserX`) aparece só em itens da apuração com `contrato_id` preenchido (categorias Matched e Só no Pipedrive) e sem `churn_pipefy_card_id` ainda. Abre diálogo com campo de data (default hoje, editável) e motivo (obrigatório).
- Ao confirmar, chama `marcarChurn` (`src/lib/royalties.functions.ts`) que cria um card **direto na fase "Perdido"** (id `343394578`) do pipe Pipefy "Tratativas" (id `307196408`, "[PTRS-CLI-02] Central de Tratativas") — não passa pelo início do funil, decisão explícita do usuário de que a ação na apuração já é uma confirmação de churn, não uma suspeita a validar.
- Campos preenchidos no card: `unidade_de_neg_cio` (nome da praça), `mrr_r` (mrr_contratado do item), `motivo_do_churn` (texto livre), e um campo **novo** `data_do_churn` (date) — criado via API do Pipefy (`createPhaseField` na fase Perdido) porque o pipe não tinha campo de data editável (só teria a aproximação `updated_at`, insuficiente pois o cliente pode ter parado de pagar antes de o time saber).
- `royalties_itens.churn_pipefy_card_id` e `churn_reportado_em` são preenchidos no mesmo request, direto pelo backend (não espera o sync de 15min).
- Fluxo de volta (Pipefy → `central_tratativas`) usa o sync já existente — só precisou adicionar leitura do campo novo (`FIELD_DATA_CHURN = "data_do_churn"` → coluna `central_tratativas.data_churn`).
- O item da apuração de royalties **não é zerado nem confirmado automaticamente** ao marcar churn — continua com seu `valor_confirmado`/`confirmado` normais, só ganha o badge "churn" e para de mostrar o botão. Churn parcial no meio do mês ainda pode ter recebimento real a conciliar.
**Status:** implementado, mas **PENDENTE DE DEPLOY** — falta o usuário adicionar a env var `PIPEFY_TOKEN` no Vercel (Settings → Environment Variables do projeto `revenue-auditor-hub`) porque os dois tokens de API da Vercel que eu tinha (memória e CLI local) expiraram em 2026-07-02. Sem essa env var, `marcarChurn` falha em produção com "PIPEFY_TOKEN não configurado no servidor.". Arquivos: `src/lib/royalties.functions.ts` (função `marcarChurn`), `src/hooks/use-royalties.ts` (`useMarcarChurn`), `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` (`MarcarChurnButton`, botão nas seções Matched/Só no Pipedrive), `~/sync_pipefy_tratativas.py` (campo `data_do_churn`), `supabase/migrations/20260703180000_central_tratativas_data_churn.sql`. Testado manualmente via API do Pipefy (card de teste criado na fase Perdido com todos os campos e depois apagado) antes de escrever o código de produção.
**Próximos passos:** confirmar que `PIPEFY_TOKEN` foi adicionado no Vercel e rodar um teste real em produção (marcar churn de um cliente de teste, verificar que o card aparece no Pipefy e que `central_tratativas` reflete em até 15min).

## [2026-07-03] Corrigido: tela de Clientes nunca detectava churn de ninguém (pipedrive_deal_id nunca era populado)

**Contexto:** usuário testou o botão "Marcar churn" (ver entrada anterior) em produção — o card apareceu certo no Pipefy, e depois de forçar o sync manualmente também apareceu em `central_tratativas` e na tela **Tratativas**. Mas a tela **Clientes** não mostrou o badge de churn. Investigando, `clientes.tsx:170-198` cruza `central_tratativas.pipedrive_deal_id` (filtrado por `estagio='Perdido', status='lost'`) com `empresas.pipedrive_id`. Query direta no Supabase mostrou **0 de 110 registros** de `central_tratativas` com `pipedrive_deal_id` preenchido — ou seja, essa badge nunca funcionou pra nenhum cliente desde que `sync_pipefy_tratativas.py` foi criado (02/07), não é regressão do botão novo. Causa: o pipe Pipefy não tinha nenhum campo pra guardar o id do deal, então `map_card()` nunca tinha de onde ler isso.
**Decisão:** criado campo novo `id_deal_pipedrive` (short_text) na fase "Perdido" do pipe Tratativas via API do Pipefy. `marcarChurn` agora busca `contratos.pipedrive_deal_id` (via `contrato_id` do item, join `contrato:contratos(pipedrive_deal_id)`) e manda esse valor nesse campo ao criar o card — só quando existir (contratos sem `pipedrive_deal_id` simplesmente não preenchem o campo, sem erro). `sync_pipefy_tratativas.py` ganhou `FIELD_PIPEDRIVE_DEAL_ID = "id_deal_pipedrive"` e `parse_deal_id()`, escrevendo em `central_tratativas.pipedrive_deal_id` (antes esse valor nunca era escrito pelo script, ficava sempre null por omissão). Reaproveita a lógica que `clientes.tsx` já tinha — não precisou mudar nada na tela de Clientes.
**Status:** implementado e validado manualmente: rodei o sync (`python3 ~/sync_pipefy_tratativas.py`) e confirmei `central_tratativas.pipedrive_deal_id = 62143` pro card de teste (Academia de Líderes do Brasil, mesmo card da entrada anterior) — também fiz backfill retroativo desse card específico via `updateCardField` do Pipefy, já que ele foi criado antes do campo existir. Cards de churn criados **antes** desse fix (só o de teste) foram corrigidos manualmente; qualquer card criado a partir de agora já nasce certo.
**Limitação que continua existindo:** cards criados manualmente pelo time direto no Pipefy (sem passar pelo botão "Marcar churn") continuam sem `pipedrive_deal_id` a menos que alguém preencha esse campo à mão — mesma limitação de antes, não piorou.
**Próximos passos:** nenhum pendente na integração. Também troquei `src/integrations/supabase/types.ts` por uma regeneração via `npx supabase gen types typescript --project-id ulgiochewwpmmssksqlw` (rodava com erro de tsc porque o arquivo gerado estava desatualizado — faltavam `churn_pipefy_card_id`/`churn_reportado_em`/`data_churn` entre outras colunas já existentes no banco mas nunca refletidas nos tipos). Comparei lista de tabelas antes/depois pra garantir que nada sumiu — só adicionou `headcount_mensal` e `partners_financeiro_unidade_map` que já existiam no banco e não nos tipos. Adicionei `supabase/.temp/` ao `.gitignore` (artefato da CLI usada pra gerar os tipos).

## [2026-07-09] Apuração de CAC — botão "Marcar como pago" da Parcela 2 liberado mesmo sem gatilho automático do Omie

**Contexto:** a spec original ([[wiki/outputs/2026-07-spec-dashboard-cac-apuracao]] no repo AI Projects) definia que a Parcela 2 do CAC só vence "após o recebimento do cliente" (1º pagamento liquidado, detectado via sync do Omie em `data_recebimento_cliente`). A implementação levou essa regra ao extremo e desabilitava o botão "Marcar como pago" da Parcela 2 inteiramente enquanto `data_recebimento_cliente` estivesse vazio (`cac.$unidadeId.tsx`, prop `disabledMarcar`) — bloqueando até lançamento manual do usuário, mesmo em casos onde ele sabe que a parcela já foi paga mas o sync automático ainda não capturou o recebimento.
**Decisão:** usuário pediu explicitamente para liberar o botão da Parcela 2 sempre, igual à Parcela 1 — quem decide se pode marcar como pago é o usuário, não o gatilho automático. O gatilho do Omie continua populando `data_recebimento_cliente` e determinando o badge "Aguardando cliente" (informativo), mas não bloqueia mais a ação manual.
**Status:** implementado. Arquivo: `src/routes/_authenticated/cac.$unidadeId.tsx` — removida a prop `disabledMarcar` de `ParcelaCell` e `MarcarPagoButton` (ambas ficaram sem uso após a remoção, então foram simplificadas). Typecheck validado sem erros novos.
**Próximos passos:** nenhum pendente.

## [2026-07-09] Apuração de CAC — novo estado "boleto enviado" (cobrado) entre pendente e pago

**Contexto:** usuário pediu uma forma de registrar quando o boleto/cobrança do CAC foi enviado pra unidade, distinta de quando o valor foi efetivamente pago — hoje só existia "Marcar como pago", sem rastro de que a cobrança já tinha sido feita antes do repasse confirmado.
**Decisão:** novo par de colunas `data_envio_parcela_1`/`data_envio_parcela_2` (date, nullable) em `cac_apuracao_itens`, paralelo a `data_pagamento_parcela_1`/`2`. Novo status derivado "cobrado" (badge azul "Boleto enviado") entra na prioridade entre `atrasado` e `pendente`: `pago` > `atrasado` (se prazo já passou, mesmo com boleto enviado) > `cobrado` (boleto enviado, dentro do prazo) > `pendente`/`aguardando_cliente`. Como o status já é recalculado a cada leitura (`withLiveStatus`, não fica stale em banco), bastou estender as funções `statusParcela1`/`statusParcela2` com o parâmetro `dataEnvio`. Na UI, cada parcela não paga agora mostra dois botões empilhados — "Marcar boleto enviado" (vira "Desfazer envio" depois de marcado) e "Marcar como pago" — o usuário pode pular direto pro pago sem passar pelo boleto se quiser, o fluxo não é obrigatório em duas etapas.
**Status:** implementado. Migration `20260709120000_cac_apuracao_itens_data_envio.sql` (aplicada direto via Management API, já que o Supabase CLI não roda migrations automaticamente neste projeto). Arquivos: `src/lib/cac.functions.ts` (tipo `ApuracaoCacItem`, `statusParcela1`/`statusParcela2`, `updateItemCac`), `src/routes/_authenticated/cac.$unidadeId.tsx` (`PARCELA_BADGE`, `ParcelaCell`, renomeado `MarcarPagoButton` → `MarcarDataButton` genérico reaproveitado pelas duas ações). Typecheck validado — únicos erros no output são pré-existentes em `reconciliacao.functions.ts`/`reconciliacao.tsx`/`rede-overview.tsx`/`reforma-tributaria.tsx`, arquivos não tocados nesta mudança.
**Próximos passos:** nenhum pendente.

## [2026-07-09] Logo da Planning saía preta no PDF do demonstrativo de royalties

**Contexto:** usuário reportou que o logo no canto superior direito do PDF gerado (`gerarDemonstrativoRoyaltiesPdf`, `src/lib/royalties-demonstrativo.ts`) aparecia como um bloco preto sólido em vez do ícone gradiente + texto "Planning". A logo renderiza perfeitamente na tela (SVG normal via `<img>`/browser) — só quebra dentro do PDF.
**Causa raiz:** `addPlanningLogo()` usava `doc.addSvgAsImage(svg, ...)`, método do jsPDF que delega a rasterização pro `canvg` (SVG → `<canvas>` → JPEG embutido no PDF). O arquivo `planning-logo-dark.svg` usa uma estrutura complexa de `<clipPath>` + `<linearGradient gradientUnits="userSpaceOnUse">` com `gradientTransform` por `<use>` — o canvg não resolve essa combinação corretamente fora do DOM completo do navegador e cai no fallback de preenchimento preto sólido pros paths do ícone, que se funde com o texto "Planning" (também preto, `#0A0A0A`) formando o bloco preto reportado.
**Decisão:** em vez de depurar os limites do canvg com gradientes/clip-paths complexos, gerei um PNG estático do logo (via Chrome headless renderizando o SVG real — mesma engine que já renderiza correto na tela, garantindo fidelidade) e troquei `addSvgAsImage` por `doc.addImage()` com esse PNG. PDF/rasterização de imagem plana é muito mais robusto e não depende de nenhuma feature de parser SVG.
**Status:** implementado e verificado ponta a ponta (gerei um PDF de teste com a nova lógica via jsPDF Node e conferi visualmente com `qlmanage -t` — logo aparece correto, sem preto). Arquivos: `public/brand/planning-logo-dark.png` (novo asset, 2000×412px com transparência), `src/lib/royalties-demonstrativo.ts` (`addPlanningLogo` agora faz fetch do PNG, converte pra base64 e chama `addImage`). O SVG original (`planning-logo-dark.svg`) continua no repo — não é usado nesse fluxo, mas pode servir outros usos (tela, favicon etc.).
**Próximos passos:** nenhum pendente. Se o logo mudar de novo no futuro, regenerar o PNG a partir do SVG novo (headless Chrome, `--window-size` na proporção 1163.3:239.6, `--default-background-color=00000000` pra manter transparência).

## [2026-07-10] Cabeçalho fixo (sticky top) nas tabelas de apuração de royalties — revertido, mantido só coluna Cliente fixa

**Contexto:** a entrada de 2026-07-09 ("Colunas fixas na apuração de royalties") tinha fixado tanto a coluna Cliente (`sticky left-0`) quanto o cabeçalho de coluna (`sticky top-[140px]`) nas 3 tabelas de item da tela (grupo principal, base antiga, excluídos). Um fix seguinte (`ccfd585`) resolveu o cabeçalho grudando no meio da tabela em vez do topo (causa: `overflow-hidden` no `Card` ancestral virava containing block do sticky). Mas o usuário reportou de novo o layout quebrado: com múltiplas seções empilhadas na mesma página (Com CNPJ, Sem CNPJ, Só no Omie, Adicionados manualmente — cada uma um `Card`/`table` independente), **todos os cabeçalhos de tabela tentam grudar no mesmo `top: 140px` da viewport ao mesmo tempo** conforme a página rola — não existe como um "avisar" o outro que já não é mais o topo visível. Resultado: cabeçalhos de seções diferentes ficam empilhados/sobrepostos um por cima do outro perto do topo da tela, exatamente o sintoma do print (duas linhas "CLIENTE FILIAIS CNPJ..." quase coladas).
**Decisão:** `position: sticky` no cabeçalho de coluna não é compatível com o layout desta tela (várias tabelas independentes na mesma rolagem de página, sem contêiner de altura fixa por tabela) — resolver de verdade exigiria reestruturar cada seção pra rolar dentro de um contêiner próprio com altura limitada, o que muda a UX da tela (hoje todas as linhas aparecem sem scroll interno, de propósito). Dado que a coluna Cliente fixa (`sticky left-0`, sem `top`) não sofre desse problema — cada tabela rola horizontalmente de forma isolada, sem disputar posição com as outras — mantive só essa parte e removi o `sticky top-[140px]` do cabeçalho nas 3 tabelas.
**Status:** implementado. Arquivo: `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` — thead voltou a `bg-muted/50` normal (não sticky), só o `th`/`td` da coluna Cliente mantêm `sticky left-0 z-10`. Typecheck validado sem erros novos no arquivo.
**Próximos passos:** se cabeçalho fixo verticalmente for realmente necessário no futuro, a forma correta é dar a cada seção seu próprio contêiner com altura máxima + `overflow-y-auto` (scroll interno por tabela) em vez de sticky solto na rolagem da página inteira.

## [2026-07-10] Motivo de churn categorizado (select) + observação livre, separado do texto livre antigo

**Contexto:** o modal "Marcar churn" só tinha um Textarea de texto livre pro motivo. Isso alimenta `central_tratativas.motivo` no Pipefy (pipe Tratativas 307196408, fase Perdido, campo `motivo_do_churn`), que por sua vez alimenta a tabela "Motivo da perda" em `tratativas.tsx` — como cada motivo é uma string livre única, o agrupamento praticamente nunca junta duas linhas (cada churn vira sua própria categoria de 1 item), tornando o ranking inútil. Usuário pediu opção de múltipla escolha + campo de observação.
**Decisão:** criei um novo campo select no Pipefy (`categoria_do_churn`, label "Categoria do Churn", fase Perdido) com 6 opções fechadas (Inadimplência, Insatisfação com o serviço, Encerramento das atividades, Trocou de fornecedor/concorrente, Motivo financeiro do cliente, Outro) — lista provisória, o usuário pode pedir ajuste depois. Tentei renomear o campo antigo `motivo_do_churn` pra "Observação" via `updatePhaseField`, mas a API retornou "Permission denied" (token sem escopo pra isso, diferente de `createPhaseField` que funcionou); mantive o label do Pipefy como está ("Motivo do Churn") e só relabelei na nossa UI/schema — o campo `motivo_do_churn` agora é tratado como observação livre em todo o código nosso (variável, coluna). `marcarChurn` valida `motivo` contra a lista fechada (`MOTIVOS_CHURN`, mesmo padrão de `MOTIVOS_EXCLUSAO_ROYALTIES`) e envia `observacao` pro Pipefy só se não for vazio.
**Status:** implementado e testado ponta a ponta (card de teste criado via API do Pipefy com os dois campos, sync rodado manualmente, conferido em `central_tratativas` que `motivo`/`observacao` chegaram certos, depois card apagado). Arquivos: `src/lib/royalties.functions.ts` (`MOTIVOS_CHURN`, `marcarChurn`), `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` (`MarcarChurnButton` — Select + Textarea observação), `src/routes/_authenticated/tratativas.tsx` (coluna Observação), `supabase/migrations/20260710130000_central_tratativas_observacao.sql`, `~/sync_pipefy_tratativas.py` (`FIELD_MOTIVO` agora aponta pro campo novo `categoria_do_churn`, `FIELD_OBSERVACAO` pro campo antigo `motivo_do_churn`).
**Próximos passos:** histórico antigo em `central_tratativas.motivo` continua com texto livre (não foi recategorizado retroativamente) — a tabela "Motivo da perda" vai misturar categorias limpas (churns novos) com strings livres antigas até esse histórico ser reclassificado manualmente ou expirar. Se a lista de 6 categorias não servir, é só editar as `options` do campo `categoria_do_churn` no Pipefy e a constante `MOTIVOS_CHURN` no código, mantendo as duas em sincronia.

## [2026-07-10] Opção de cobrar royalties em clientes da Base Antiga (CSC)

**Contexto:** usuário pediu uma forma de cobrar royalties (com % escolhido, igual na base nova) em cima de clientes que hoje só entram no cálculo de CSC (tabela "Base Antiga", categoria `csc_base_antiga` — clientes pré-Planning achados só no Omie, sem contrato ativo no Pipedrive).
**Decisão:** duas perguntas de negócio confirmadas com o usuário antes de implementar: (1) ao marcar "cobrar royalties" num item, ele **sai** do cálculo de CSC (variável %) e conta **só** como royalties — evita cobrar CSC% e royalties% sobre a mesma receita; (2) o item **migra** da tabela "Base Antiga" pra tabela "Conciliação Pipedrive × Omie" (mistura com clientes novos), reaproveitando 100% da UI já existente lá (% editável por item, coluna Royalties, filtros de situação/pendentes). Implementação: `categoria` (`royalties` | `csc_base_antiga`) — campo que já existia e já determinava tudo isso no cálculo de totais (frontend e `fecharApuracao`) — agora pode ser trocado via `updateItem` (novo parâmetro opcional). Guard no backend: só permite trocar categoria de itens **sem** `contrato_id` (ou seja, só os "só Omie" sem contrato — nunca um item com contrato Pipedrive vinculado, que já nasce com categoria "royalties" fixa pela geração automática). Botão "Cobrar royalties" (ícone moeda) na tabela Base Antiga; ação reversível via botão "Mover pra Base Antiga" (ícone troca) na tabela de Conciliação, visível só pra itens `so_omie` sem contrato. Ambos os botões pedem confirmação (`confirm()`) antes de disparar, mesmo padrão usado em "Fechar apuração"/"Reabrir apuração" nesta tela. A linha `const conciliacao = [...matched, ...soPipe, ...soOmie]` deixou de excluir `soOmie` condicionalmente pra unidades com CSC variável — essa exclusão era redundante (itens assim sempre nasciam com categoria `csc_base_antiga`, então já ficavam fora de `planning`/`soOmie` de qualquer forma) e impedia o item migrado de aparecer na Conciliação.
**Status:** implementado. Arquivos: `src/lib/royalties.functions.ts` (`updateItem` — parâmetro `categoria` + guard `contrato_id`), `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` (`handleCobrarRoyalties`/`handleMoverBaseAntiga`, botões em `BaseAntigaTable` e na tabela de Conciliação, prop `onMoverBaseAntiga` em `GrupoProps`). Sem Node/npm/bun disponíveis no ambiente da sessão pra rodar typecheck/build — revisão feita manualmente lendo o diff completo; o hook de auto-deploy (`Stop`) publicou o trabalho em 2 commits intermediários antes de eu terminar (`33a668b`, `3e55d87`) — nenhum dos dois estados intermediários quebra em runtime (props extras não usadas ainda são só ignoradas pelo React), mas vale rodar `tsc --noEmit` numa sessão com Node disponível pra confirmar que não sobrou nenhum erro de tipo.
**Próximos passos:** nenhum pendente na lógica. Vale considerar, se o padrão se repetir noutras unidades, se cobrar royalties parcial (só uma fração do valor, não o valor cheio) seria necessário — hoje é tudo-ou-nada por cliente/mês.

## [2026-07-10] Royalties como fonte única do DRE/Receitas Partners — fim da entrada manual

**Contexto:** usuário apontou que fazer a apuração de royalties e ainda preencher manualmente a linha "Royalties" na aba Receitas Partners (pra alimentar o DRE) era trabalho duplicado — e de fato gerava divergência: existia até uma tabela "Validação Royalties — Projetado × Cobrado × Recebido" cuja única função era caçar a diferença entre o número digitado (Projetado) e o número calculado pela apuração (Cobrado). Modelo proposto pelo usuário: mês fechado vira "realizado" na DRE e também recalibra a projeção dos meses seguintes; taxas fixas (CSC) não precisam disso, e é preciso deixar visualmente claro o que é realizado vs projetado.
**Decisão:** `royalties_apuracao` passa a ser a fonte única da linha "Royalties" tanto na aba Receitas (`receitas-view.tsx`) quanto no DRE Projetada — visões Base apenas, `dre-projetada/itens-view.tsx` e `resumo-view.tsx` (cenários hipotéticos continuam com entrada manual normal, já que são simulações). Mês com `status` `confirmado`/`faturado` = **Realizado** (valor travado); `rascunho`/`em_revisao` = **Projetado** (recalculado a cada regeneração — já reflete contratos ativos e churn conhecido em cada mês, incluindo meses futuros, via a mesma lógica de `gerarItensApuracaoCore`/`churnInfoParaMes` já existente). Pra isso cobrir o ano inteiro, apurações rascunho dos meses futuros são criadas sob demanda (não automaticamente em todo page-load): botão "Gerar apurações futuras" chama o novo server fn `garantirApuracoesAno`. Junção Item↔unidade é por nome (`item.nome`/`receitas_cm_fornecedores.unidade` == `unidades.nome_da_praca`) — mesmo padrão de join-por-nome já usado pro rateio Partners (`pctPartnersFor`). A tabela "Validação Royalties" perdeu a coluna Projetado (ficava sempre idêntica a Cobrado depois dessa mudança) — confirmado com o usuário antes de remover.
**Status:** implementado. Arquivos: `src/lib/royalties.functions.ts` (`garantirApuracoesAno`), `src/hooks/use-royalties.ts` (`useRoyaltiesPorUnidade`, `useGarantirApuracoesAno`), `src/components/financeiro-partners/receitas-view.tsx` (linha Royalties somente leitura + badge Realizado/Projetado + botão), `src/components/financeiro-partners/dre-projetada/index.tsx`/`itens-view.tsx`/`resumo-view.tsx` (substituição de `valor_base`/overrides pela apuração nas visões Base), `src/components/financeiro-partners/rede-financeiro-view.tsx` (`ValidacaoRoyaltiesSection` sem coluna Projetado), `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` (banner de mês em andamento/futuro, mesmo padrão de `apuracao-royalties-content.tsx`). Deploy `revenue-auditor-44pq4f8as` verificado Ready em produção.
**Próximos passos:** histórico de meses já digitados manualmente antes dessa mudança continua em `receitas_cm_overrides` (não foi migrado/apagado) — não afeta nada porque a leitura pra categoria "Royalties" agora ignora essa tabela nas visões Base, mas os dados antigos ficam órfãos lá se algum dia quiserem limpar. Se o padrão "fonte única pela apuração" fizer sentido pra CSC/CAC no futuro, replicar a mesma abordagem — hoje ficou fora de escopo de propósito (taxas fixas não mudam mês a mês).

## [2026-07-14] "Outras receitas" da apuração de royalties vira lista itemizada por software

**Contexto:** usuário apontou (na apuração de Belém jun/26) que "Outras receitas" era um único campo numérico digitado à mão (R$ 1.737,89), somando vários custos de software repassados ao cliente sem nenhum registro de quais — no caso, Qulture.rocks (R$ 1.317,53, 64 colaboradores), Pipedrive (R$ 335,36) e Panda Pé (R$ 85,00), além de CEFIS e Power BI (sem valor informado nesse mês). Cada unidade usa um conjunto diferente de softwares, então um catálogo fixo por unidade seria rígido demais.
**Decisão:** nova tabela `royalties_outras_receitas_itens` (apuracao_id, nome, valor, observacao) — lista livre por apuração, sem catálogo fixo. Ao criar uma apuração nova (`getOrCreateApuracao`), os itens da apuração anterior mais recente da mesma unidade são copiados automaticamente (mesmo nome/valor) pra não redigitar a lista todo mês — só o valor que mudou precisa ser ajustado. `royalties_apuracao.outras_receitas` continua existindo como total denormalizado, mas vira somente leitura na UI: recalculado como soma dos itens a cada add/update/delete (`recomputeOutrasReceitas`), nunca mais editável como número solto — evita o total ficar dessincronizado da lista. Migration inclui backfill: o valor solto que já existia em cada apuração virou 1 item "Outras receitas (migrado)" (não foi zerado).
**Status:** implementado localmente (migration `20260714150000_royalties_outras_receitas_itens.sql`, `src/lib/royalties.functions.ts` — `addOutraReceitaItem`/`updateOutraReceitaItem`/`deleteOutraReceitaItem`/`recomputeOutrasReceitas`, `src/hooks/use-royalties.ts`, `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx` — `OutrasReceitasSection`). **Ainda não aplicado em produção**: migration não rodou contra o Supabase remoto, `src/integrations/supabase/types.ts` não foi regenerado (por isso `tsc --noEmit` acusa erros de tipo em todo uso de `royalties_outras_receitas_itens` — esperado até a migration rodar e os tipos serem regenerados), e não houve commit/push (que dispararia auto-deploy). Aguardando confirmação do usuário antes de tocar o banco de produção.
**Próximos passos:** aplicar a migration em produção, rodar `supabase gen types typescript` pra atualizar `types.ts`, rodar `tsc --noEmit` de novo pra confirmar zero erros novos, testar o fluxo na apuração de Belém (que já tem os 3 itens reais como exemplo) e então commitar/dar push.

## [2026-07-14] Listagem de CAC (`/unidades` → aba CAC) deixa de ser mês a mês

**Contexto:** usuário apontou que a listagem de unidades em "Apuração de CAC" (`ApuracaoCacContent`, aba CAC de `/unidades`) não fazia sentido como apuração mensal — mostrava 1 card por unidade com navegação ←/→ de mês e badge "Rascunho"/totais escopados a um único mês (ex: "Junho de 2026" com Parcela 1/2 = R$0), dando a falsa impressão de que não havia nada a fazer. O que importa pro CAC não é o mês, é se a 2ª parcela de cada cliente atribuído (repasse liberado só depois que o cliente paga a Planning pela 1ª vez) já foi cobrada — um cliente ganho em janeiro pode só gerar a 2ª parcela em julho. A tela de detalhe por unidade (`/cac/$unidadeId`, `listApuracaoCacItensUnidade`) **já** tinha sido construída assim — comentário no próprio código já dizia "Tela única por unidade (sem navegação mês a mês)" — só a listagem de entrada é que ficou pra trás com o padrão antigo (herdado de royalties, que É recorrente por mês de verdade).
**Decisão:** nova função `listCacUnidadesResumo` (sem parâmetro de mês) — agrega, por unidade, todos os `cac_apuracao_itens` não excluídos de todas as apurações (todos os meses) e calcula ao vivo (reaproveitando `statusParcela1`/`statusParcela2`, as mesmas funções que já computam status por data em vez de confiar só na coluna gravada): total de clientes com CAC atribuído, quantos têm 2ª parcela pendente de cobrança agora (`pendente`/`cobrado`/`atrasado`) com o valor total, quantos ainda aguardam o cliente pagar (`aguardando_cliente`, não é ação nenhuma ainda), e quantos têm 1ª parcela atrasada. `ApuracaoCacContent` foi reescrito: sem seletor de mês, 1 card por unidade com essas métricas contínuas e badge "Em dia" ou "N pendente(s)". `listCacUnidades` (a função antiga, escopada por mês) e o hook `useCacUnidades` foram removidos — não tinham nenhum outro uso no código.
**Status:** implementado. Arquivos: `src/lib/cac.functions.ts` (`listCacUnidadesResumo`, tipo `CacUnidadeResumo`), `src/hooks/use-cac.ts` (`useCacUnidadesResumo`), `src/components/cac/apuracao-cac-content.tsx` (reescrito). Não envolveu migration nem mudança de schema — só leitura agregada da mesma tabela `cac_apuracao_itens` que já existia. `tsc --noEmit` e `npm run build` limpos (mesmos 4 arquivos com erro pré-existente de sempre: `reconciliacao.functions.ts`, `reconciliacao.tsx`, `rede-overview.tsx`, `reforma-tributaria.tsx`). Commit automático (hook do repo) e push pra `origin/main` já disparados.
**Próximos passos:** nenhum pendente. A tela de detalhe por unidade (`/cac/$unidadeId`) não foi tocada — já seguia o padrão certo. Se o "Confirmar apuração" mensal (que ainda existe por baixo, por mês de aquisição do cliente) algum dia travar a marcação de "pago" da 2ª parcela de um cliente cujo mês de origem já foi confirmado, vale revisitar se esse trava ainda faz sentido pra CAC (royalties trava por bom motivo — fatura já emitida; CAC não emite fatura por mês).

## [2026-07-14] PDF do demonstrativo de royalties detalha os itens de "Outras receitas"

**Contexto:** depois da entrada acima (lista itemizada de "Outras receitas"), o PDF gerado pelo botão "Gerar demonstrativo" continuava mostrando só o total num único tile ("Outras receitas R$ 1.486,97"), sem listar Qulture.rocks/Pipedrive/Panda Pé etc. — o usuário pediu pra refletir o detalhamento no PDF também, já visível na tela.
**Decisão:** `DemonstrativoData` (`royalties-demonstrativo.ts`) ganhou `outrasReceitasItens: {nome, valor}[]`. Quando não vazio, o PDF renderiza uma tabelinha "Outras receitas — detalhamento" (2 colunas, mesmo estilo verde das outras tabelas) logo depois dos KPIs e antes da tabela de clientes — o tile do total no topo continua existindo, a tabela só adiciona o detalhamento. `handleGerarDemonstrativo` em `royalties.$unidadeId.$mes.tsx` passa `outrasReceitasItens` direto do estado já carregado da apuração (mesma fonte que a UI usa).
**Status:** implementado. Arquivos: `src/lib/royalties-demonstrativo.ts`, `src/routes/_authenticated/royalties.$unidadeId.$mes.tsx`. `tsc --noEmit`/`npm run build` limpos (mesmos 4 arquivos pré-existentes de sempre).
**Próximos passos:** nenhum pendente.

## [2026-07-17] Monitoramento de integrações (syncs travados/atrasados) + alerta por e-mail

**Contexto:** durante a migração das automações (LaunchAgent local -> Supabase Edge Functions) numa conversa com o Claude Code, o usuário perguntou "o que é mais seguro: continuar assim ou mover pro Make?" preocupado especificamente com falta de aviso quando uma automação trava. Constatação real ao investigar: `omie_clientes` estava atrasado há mais de 3 dias sem ninguém perceber — não existia nenhum mecanismo de alerta, nem no LaunchAgent antigo nem nas novas Edge Functions.
**Decisão:** não migrar pro Make (reescreveria lógica já testada, custo por execução, perde consistência com o resto do stack). Em vez disso: (1) tabela `integracoes_config` (fonte, nome de exibição, tipo cron/webhook, intervalo esperado em minutos) + view `v_integracoes_status` que cruza com `sync_log` e calcula se está "atrasada" (2x o intervalo esperado, só pra tipo cron) — migrations `20260717160000_integracoes_config_status.sql` e `20260717161500_integracoes_alertas_dedup.sql`; (2) Edge Function `integracoes-monitor`, agendada via pg_cron a cada 15min, que verifica a view e envia e-mail (via Resend) quando algo tem `ultimo_status='erro'` ou está atrasado — com dedup de 4h pra não spammar enquanto o problema persiste (tabela `integracoes_alertas`); (3) seção nova "Status dos syncs" na página `/admin/integracoes` já existente (que antes só gerenciava credenciais Omie), lendo a mesma view via novo server function `listIntegracoesStatus` (`src/lib/integracoes-status.functions.ts`).
**Status:** parcialmente implementado. Schema, Edge Function do monitor e página funcionando (testado: detectou corretamente o atraso real do `omie_clientes`). **Falta**: `RESEND_API_KEY` — usuário vai criar conta Resend e passar a chave; até lá o monitor só loga o que mandaria (`email_configurado: false` na resposta), não envia de verdade. As Edge Functions que ainda são scripts locais (`~/sync_omie_supabase.py`, `~/sync_omie_clientes.py`, `~/sync_pipedrive_contratos.py`, `~/sync_financeiro_fxc.py`, `tools/sync_partners_financeiro.py`) continuam sem cobertura de monitoramento real até serem migradas — os registros delas em `integracoes_config` já existem (apontando pro `sync_log.fonte` que os scripts locais já gravam), então assim que RESEND_API_KEY for configurada, essas 5 já entram no alerta automaticamente, mesmo antes de virarem Edge Function.
**Próximos passos:** ~~configurar RESEND_API_KEY~~ — usuário criou conta SendGrid (Twilio) em vez de Resend; adaptei `integracoes-monitor` pra usar a API do SendGrid (`POST /v3/mail/send`) em vez do Resend. Remetente `victor.eliezek@planning.com.br` verificado via Single Sender Authentication em 17/07/2026; alerta testado e confirmado funcionando de verdade (enviou e-mail real sobre o atraso do `omie_clientes`). Secrets: `SENDGRID_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO`. Ainda pendente: investigar por que `omie_clientes` parou de rodar. Considerar remover a fonte `omie_matriz` de `integracoes_config` se for confirmado que é duplicata/nome antigo de `omie`.

## [2026-07-17] omie_clientes: 3 bugs reais achados pelo monitor de integrações, corrigidos

**Contexto:** o monitor de integrações (entrada anterior) flagou `omie_clientes` atrasado há 3+ dias. Investigação revelou que o script (`~/sync_omie_clientes.py`) na verdade **rodava todo dia via LaunchAgent**, mas falhava de formas que nunca apareciam em `sync_log` — exatamente o cenário que o monitoramento existe pra pegar.
**Decisão/correções aplicadas:**
1. Tabela `omie_clientes` só tinha 9 das 18 colunas que o script grava (`bairro`, `cep`, `telefone`, `inativo`, `pessoa_fisica`, `is_planning`, `contrato_id`, `honorario`, `ultimo_pagamento`, `synced_at` não existiam) — todo upsert falhava com `PGRST204`, silenciosamente, "0 upserted" todo dia. Migration `20260717170000_omie_clientes_colunas_faltantes.sql` (aditiva).
2. Depois de corrigir (1), apareceu um segundo bug mascarado: a PK era só `(codigo_omie)`, mas `codigo_omie` é numerado por conta Omie (uma por unidade) — o mesmo código pode existir em unidades diferentes pra clientes diferentes. O upsert do script sempre pretendeu `on_conflict=codigo_omie,unidade`, mas essa constraint composta nunca existiu, causando `42P10` (no unique constraint matching ON CONFLICT). Migration `20260717170500_omie_clientes_pk_composta.sql`: dropa a PK antiga, cria PK composta `(codigo_omie, unidade)` — seguro porque a PK antiga já garantia que não havia duplicata nos dados existentes (5149 linhas).
3. `~/sync_omie_clientes.py`: `supa_get` não tinha retry (diferente de `omie_post`, que já tinha) — um `ConnectionResetError`/timeout transiente ao paginar `contas_receber` derrubava o script inteiro **antes** de chegar no `supa_insert_sync_log` do fim, então uma falha de rede virava silêncio total (nem card no monitor, porque não tinha status='erro' pra ler — só ausência de qualquer log). Corrigido: retry de 3 tentativas em `supa_get` (igual `omie_post`), e o carregamento inicial (contratos/pagamentos) agora fica num try/except que grava `sync_log` com `status='erro'` antes de re-lançar a exceção — garante que QUALQUER falha apareça no monitor, mesmo as que ainda não foram prevista.
**Resultado:** rodado manualmente após as correções — 4863 clientes upserted nas 5 unidades (Rio 316, Belém 191, Curitiba 4247, Patos 30, Campo Novo 79), tabela `omie_clientes` restaurada com dado real pela primeira vez em não se sabe quanto tempo (o bug de coluna faltante pode ser bem mais antigo que os 3 dias de atraso que o monitor pegou — esse só detectou o segundo bug, o do crash).
**Status:** implementado e validado. Arquivos: `~/sync_omie_clientes.py` (fora do repo git, script local), migrations no repo.
**Próximos passos:** nenhuma tabela/feature do OpsBoard consome `omie_clientes` diretamente hoje (é auditoria, per docstring do script) além do enriquecimento de UF em `/clientes` (via `omie_clientes` + BrasilAPI, ver entrada de `project_empresas_uf_estado` na memória) — validar se esse fluxo também estava mudo por causa desses bugs. Considerar migrar esse script pra Edge Function também (mesma lógica do plano geral de migração), já que ele tem o padrão exato de bug (retry/log ausente) que motivou todo esse trabalho.

## [2026-07-20] Direção: Planning Ops vira sistema de trabalho para churn/tratativas, Pipefy passa a downstream

**Contexto:** discussão sobre a visão geral do Planning Ops se tornar o sistema central de trabalho do time (não só consulta/BI) — o que implica passar a substituir, por partes, funções hoje feitas em outras ferramentas. Primeiro recorte escolhido pelo usuário: churn/tratativas.

**Decisão:** o time deve lançar e gerenciar as tratativas de churn dentro do Planning Ops — ninguém deve precisar abrir o Pipefy pra criar um card. O Pipefy continua sendo atualizado (porque a apuração ainda depende dele), mas passa a ser destino de escrita a partir do Planning Ops, não ponto de entrada manual do time.

**Estado atual (achado ao revisar o código antes de registrar esta entrada, não implementado nesta conversa):** já existe um write-path parcial. O botão "Marcar churn" na tela de apuração de royalties (`royalties.$unidadeId.$mes.tsx`) chama `marcarChurn` (`royalties.functions.ts`), que cria um card direto na fase "Perdido" do pipe Pipefy "Tratativas" (307196408). O sync de volta (`~/sync_pipefy_tratativas.py`, LaunchAgent local, roda a cada 15min) traz o card pra `central_tratativas` no Supabase. Ou seja, o padrão "Planning Ops escreve → Pipefy atualizado → apuração continua vendo lá" já é validado em produção, só que restrito a esse único botão.

**Gap identificado (não implementado, escopo da próxima etapa):** a tela `tratativas.tsx` hoje é só espelho de leitura do Pipefy — não dá pra (a) criar uma tratativa fora do fluxo de apuração de royalties, nem (b) gerenciar/avançar o status de uma tratativa já existente (mover pra "Recuperado", adicionar observação) de dentro do Planning Ops. Hoje só o Pipefy comanda a fase depois que o card nasce.

**Observação técnica à parte:** `sync_pipefy_tratativas.py` roda local via LaunchAgent com credenciais em texto puro em `~/` — mesmo débito já registrado em memória (`project_home_scripts_hardcoded_secrets`, `project_migracao_integracoes_supabase_cloud`). Migrar pra Edge Function seria natural fazer junto quando essa expansão for implementada (mesmo pivot já feito no sync de onboarding Pipedrive→Pipefy).

**Próximos passos:** nenhuma implementação ainda, só a direção registrada. Falta detalhar com o usuário: quais ações do ciclo de vida da tratativa o time deve poder fazer de dentro do Planning Ops, e o mapeamento exato de campos pra escrita de volta no Pipefy.

## [2026-07-20] Investigação: por que Contas a Receber não bate com relatórios de recebimento das unidades (ex: ANA_RJ_COMPLETA)

**Contexto:** usuário pediu pra investigar por que a planilha de recebimentos do Rio de Janeiro (`ANA_RJ_COMPLETA_2026.06.xlsx`, feita pela contadora) não batia com a tela Contas a Receber do Planning Ops. Gap aparente de ~22% pra junho/2026.

**Achado:** não é bug de sync. Três causas reais, quantificadas:
1. **Regime contábil diferente** — a planilha bucketiza por competência (mês de emissão, coluna `Data_Apuração`); Planning Ops usa caixa (`data_pagamento`). Sozinho explicava ~22% do gap.
2. **Bruto vs. líquido** — `contas_receber.valor` é o `valor_documento` bruto do Omie; `ListarContasReceber` (usado no sync em lote) não traz os valores de retenção de imposto, só `ConsultarContaReceber` (1 chamada por título) traz. ~5,3% do gap.
3. **Granularidade** — a planilha explode 1 lançamento em N linhas quando há rateio por Categoria; não afeta somas, só reconciliação por NF (não é chave única entre unidades/períodos).

Resíduo real após controlar os 3 fatores: ~3%, majoritariamente ajustes manuais pontuais da contadora e lançamentos financeiros sem cliente vinculado (fora do escopo de `contas_receber`).

**Decisão (usuário, via pergunta direta):**
- Contas a Receber ganha uma 2ª régua de data (toggle "Competência/Vencimento/Pagamento"), não substitui o regime caixa como padrão.
- Vale calcular valor líquido, mas só incremental (sem backfill histórico completo — custo de rate limit do Omie).
- Investigar o resíduo antes de fechar — investigado, não é bug (ver achado acima).

**Implementado:**
- `src/routes/_authenticated/contas-receber.tsx`: toggle `dataTipo` (competencia/vencimento/pagamento) controlando o filtro de data e refletido na URL (search param `dataTipo`).
- Migration `20260720150000_contas_receber_valor_liquido.sql`: coluna `contas_receber.valor_liquido numeric`, aplicada via Management API (sem CLI disponível no ambiente).
- `~/sync_omie_supabase.py` (script real de produção, roda 06:00 via LaunchAgent — ver `project_home_scripts_hardcoded_secrets` na memória): novas funções `fetch_valor_liquido_existentes` e `fetch_valor_liquido_titulo`; em `sync_unidade`, títulos `RECEBIDO` sem líquido calculado e com `data_pagamento` dentro dos últimos 60 dias (`VALOR_LIQUIDO_JANELA_DIAS`) chamam `ConsultarContaReceber` e gravam `valor - retenções`; títulos já calculados usam cache do Supabase (não rechama a API); títulos fora da janela ficam `NULL` (limitação aceita, sem backfill).
- Testado rodando `sync_unidade` isolado pra RJ: 1174 lançamentos, 165 valores líquidos novos calculados, bateu exato com o valor calculado manualmente na investigação (R$135.000 bruto → R$126.697,50 líquido pra um título de teste).

**Status:** implementado e validado (RJ). Não rodado ainda pras outras unidades (roda automaticamente na próxima execução do LaunchAgent das 6h, ou pode ser disparado manualmente do mesmo jeito).

**Próximos passos:** nenhum obrigatório. Se o resíduo de ~3% incomodar no futuro, os dois grupos identificados (ajustes manuais da contadora, lançamentos sem cliente) provavelmente exigem conversa com a unidade, não mais engenharia.

## [2026-07-20] Royalties passam a incidir sobre valor líquido recebido, não NF bruta

**Contexto:** durante a investigação de reconciliação de Contas a Receber (entrada anterior), um caso real (cliente ENGEPRED + Unioffice, RJ) mostrou uma NF de R$18.308,33 gerando só R$17.187,48 em caixa — retenção de PIS/COFINS/CSLL/IR na fonte (~6,15%). Usuário apontou o ponto central: quando há retenção na fonte, o valor bruto da NF **nunca chega a entrar em caixa do prestador** — o imposto é recolhido direto pelo pagador. Logo a base de cálculo de royalties (que deveria ser sobre o que a unidade efetivamente recebeu) estava inflada nesses casos.

**Decisão:** `gerarItensApuracaoCore` (`royalties.functions.ts`) agrega `contas_receber.valor_liquido` em vez de `valor` bruto. Fallback pro bruto só quando líquido ainda não foi calculado (título fora da janela de 60 dias do sync incremental — ver entrada anterior) — evita perder receita da apuração por dado ausente, ao custo de eventualmente usar bruto nesse caso raro (logado via `console.warn`).

**Implementado:**
- `src/lib/royalties.functions.ts`: select de `contas_receber` ganha `valor_liquido`; agregação usa `r.valor_liquido ?? r.valor` (fallback). Mudança isolada a essas duas linhas — resto da função (matching por CNPJ/filiais, churn, etc.) inalterado.
- `src/integrations/supabase/types.ts`: adicionado `valor_liquido` em `contas_receber` (Row/Insert/Update) — não estava no schema gerado.

**Efeito prático:** royalty calculado fica ligeiramente menor para clientes com retenção na fonte (a maioria dos contratos B2B recorrentes tem). Não afeta apurações já `confirmado`/`faturado` (guard existente em `gerarItensApuracaoCore` já impede regeração de apuração fechada) — só apurações em aberto, e apenas quando regeneradas.

**Status:** implementado, não testado em apuração real ainda (não gerei/regenerei nenhuma apuração de royalties nesta conversa — só a função foi alterada). Validar rodando uma geração de apuração de RJ e conferindo que os itens usam o valor líquido esperado antes de confiar no número final.

**Próximos passos:** rodar `gerarItensApuracaoCore` pra uma apuração aberta do RJ e conferir os valores item a item contra o líquido calculado manualmente.

## [2026-07-21] Nova página "Saúde da Carteira" — pilar financeiro do Customer Health Score

**Contexto:** apresentação da Expansão sobre a nova estrutura de Customer Success (jul/2026) define um Customer Health Score com 4 pilares (Relacionamento, Auditoria técnica, Financeiro, Sistema de tarefas) e um semáforo Saudável/Atenção/Risco por cliente. Usuário pediu para começar pelo pilar Financeiro no Planning Ops.

**Achado antes de implementar:** `empresas.status_financeiro` (ATIVO/EM_ATRASO/INADIMPLENTE/SEM_ATIVIDADE/NUNCA_PAGOU/SEM_AR) já existe e já é usado em `/clientes` e `/painel-unidade`, mas a lógica que o calcula não foi encontrada em nenhum script (`~/sync_omie_*.py`, `~/sync_recebimentos_franquias.py` etc.) nem em migration do repo — origem não rastreável no momento desta implementação.

**Decisão (usuário, via pergunta direta):** não usar `status_financeiro` como base do score novo. Calcular o pilar financeiro do zero, de forma transparente, direto de `contas_receber` + `central_tratativas` + `contratos`. Página nova dedicada (`/saude-carteira`), pensada como semente do CHS completo — os outros pilares (NPS/Relacionamento já existe em `/nps`; Auditoria técnica; Execução) entram depois na mesma página.

**Implementado:**
- `src/lib/saude-carteira.functions.ts`: server fn `listSaudeCarteira`. Junta `empresas` (franquias, filtradas por `unidades.tipo='regional'`) com `contas_receber` via CNPJ normalizado (`digits()` de `server-utils.ts`, mesmo cuidado de formato já registrado no bug de filiais de royalties), com `contratos` (MRR ativo, `status_contrato='Ativo'`) via `pipedrive_id`/`pipedrive_deal_id`, e com `central_tratativas` (tratativa ativa / churn) pelo mesmo deal id.
- Categoria financeira recalculada com as mesmas 6 faixas de `STATUS_META` (`clientes.tsx`), mas computada aqui: sem título → `SEM_AR`; nunca recebeu → `NUNCA_PAGOU`; título vencido em aberto → `EM_ATRASO` (≤90 dias) ou `INADIMPLENTE` (>90 dias); sem atraso mas sem pagamento recente → `SEM_ATIVIDADE`; caso contrário `ATIVO`. Corte de 90 dias escolhido por já ser a convenção implícita no texto de `STATUS_META` existente (não é um número novo inventado).
- Tratativa aberta em `central_tratativas` (estágio ≠ Perdido/Recuperado) força semáforo = Risco, independente da categoria financeira. Estágio = Perdido marca o cliente como `churn` e o remove da carteira ativa (não entra na contagem de saudável/atenção/risco).
- `src/hooks/use-saude-carteira.ts` + `src/routes/_authenticated/saude-carteira.tsx`: página com KPIs, aba "Por unidade" (semáforo agregado + MRR em atenção/risco) e aba "Clientes" (tabela filtrável).
- Permissão nova `view.saude_carteira` (não pega carona em `view.clientes`) — `permissions.functions.ts`, sidebar (`app-sidebar.tsx`, grupo Operação + grupo Minha Unidade do sócio franqueado), migration `20260721120000_permissao_saude_carteira.sql` seedando os 6 papéis de sistema (admin/auditor/diretor/head/socio/socio_franqueado), aplicada via Management API.

**Fora do escopo desta etapa (dados não existem ainda):** evolução de valor contratado / upsell-downsell (sem histórico de MRR, só estado atual em `contratos`) e renegociação de cobranças (sem tabela). Precisam de schema novo se viram pilar do score no futuro.

**Status:** implementado, build (`vite build`) validado sem erros novos. Não testado navegando na UI real ainda — validar dados na tela antes de divulgar para os sócios.

**Próximos passos:** abrir `/saude-carteira` no navegador e conferir números de 2-3 clientes conhecidos contra a Auditoria/Contas a Receber antes de considerar o pilar financeiro pronto. Depois, plugar o pilar Relacionamento (dados já existem em `/nps`) como segunda coluna do score composto.

## [2026-07-27] `/clientes` ganha Regime Tributário, Data do Ganho e Data de Contrato Assinado

**Contexto:** usuário pediu para trazer do Pipedrive o regime tributário do cliente, a data do ganho (won) e a data em que o card entrou na fase "Contrato Assinado" — pediu essa última como se fosse de um pipe do Pipefy.

**Conflito sinalizado e confirmado com o usuário:** minha memória tinha uma nota de 15/07/2026 dizendo que "Central de Contratos" (gatilho status Ganho + fase Contrato Assinado) é um pipe do **Pipedrive** (pipeline 28), não do Pipefy — nome parecido, sistema diferente. Perguntei antes de implementar; usuário confirmou que é o Pipedrive mesmo.

**Fontes:**
- Regime tributário: campo customizado do deal no Pipedrive, key `093e25bbb3aff5d379b996da8fcec39667c6ae4e` ("Qual é o regime tributário da sua empresa?"), enum Simples Nacional/Lucro Presumido/Lucro Real/MEI/Não tem CNPJ. Está no mesmo deal do pipeline 2 (Inside Sales) que `~/sync_pipedrive_contratos.py` já sincroniza — sem custo extra de API.
- Data do ganho: já existia como `contratos.ganho_em` (won_time do deal), só faltava expor na UI.
- Data de entrada em "Contrato Assinado": nova — stage 170 do pipeline 28. Os deals desse pipeline são cópias separadas (id diferente) dos deals do pipeline 2, sem campo de link explícito entre eles. Matching feito por `(unidade, título)` normalizado — mesma chave heurística que `run_merge_duplicates` já usa neste script para achar duplicatas em `empresas`. Data extraída via `GET /deals/{id}/flow` do Pipedrive (histórico de mudança de `stage_id`), timestamp da transição mais recente para 170.

**Implementado:**
- Migration `supabase/migrations/20260727150000_contratos_regime_tributario_datas.sql`: `contratos.regime_tributario` (text) e `contratos.entrada_contrato_assinado_em` (date), aplicada via Management API.
- `~/sync_pipedrive_contratos.py`: `map_contrato` grava `regime_tributario` a cada sync normal (zero custo extra). Nova função `run_backfill_contrato_assinado()` (modo `backfill_contrato_assinado`, e também chamada automaticamente no fim do fluxo padrão, dentro de um try/except que nunca derruba o sync principal) — incremental, só processa contratos com `entrada_contrato_assinado_em` nulo, então o custo de API (`/flow` por deal) cai a quase zero depois do backfill inicial.
- `src/routes/_authenticated/clientes.tsx`: novas colunas Regime Tributário, Data do Ganho, Contrato Assinado em (ordenáveis, exportáveis pro Excel), buscadas junto com o MRR (join por `pipedrive_deal_id`, já existente na tela).
- `src/integrations/supabase/types.ts`: `contratos` Row/Insert/Update ganham os dois campos novos (tipos gerados manualmente — não há Supabase CLI local, ver `project_migracao_integracoes_supabase_cloud` nas memórias).

**Rodado manualmente uma vez (backfill inicial, 27/07/2026):** sync completo populou regime_tributario em 309/532 contratos (só os que tinham won deal ativo retornado pela query do Pipedrive nesta run — comportamento normal do script, não é bug novo). Backfill de data de contrato assinado: 161 deals no stage 170 do Pipedrive, 140 casaram por (unidade,título) com um contrato existente e ganharam a data; 25 sem match (título/unidade divergente ou contrato sem par no stage 170); resultado final 133/532 contratos com a data.

**Limitação conhecida:** o matching por `(unidade, título)` é heurístico, não uma chave garantida — se dois contratos da mesma unidade tiverem título idêntico, a data pode ser atribuída ao par errado. Baixo risco na prática (mesmo padrão já usado e aceito em `run_merge_duplicates`), mas vale saber se um número individual parecer estranho.

**Status:** migration aplicada em produção, script de sync editado e testado rodando de verdade (não é só leitura), UI validada por `tsc --noEmit`, `eslint` e `vite build` limpos. Não testado clicando na tela real (sem navegador disponível nesta sessão) — validar visualmente os 3 campos em `/clientes` antes de confiar 100% no layout.

**Próximos passos:** nenhum obrigatório. Se quiser fechar a cobertura dos 25 contratos sem match, dá pra investigar caso a caso (provavelmente título editado depois da cópia pro pipeline 28, ou deal antigo sem cópia).

## [2026-07-27] CAC vira tabela única multi-unidade, com regra de repasse diferente por praça

**Contexto:** a tela de CAC era uma apuração por unidade (cards + navegação pra `/cac/$unidadeId`), com fechamento mensal como royalties. Usuário pediu pra simplificar: uma tabela só, com filtro por unidade, sem o conceito de mês fechado. Nessa mesma conversa, trouxe uma regra de repasse de CAC diferente por unidade, que não existia antes (até então era só "50% em 7 dias após assinatura + 50% após 1º pagamento do cliente" pra todo mundo).

**Decisão — fechamento mensal removido:** perguntei se deveria manter o botão de fechar/reabrir mês (trava edição, mantém histórico). Usuário escolheu remover — CAC agora é sempre editável, sem "confirmado"/read-only. `fecharApuracaoCac`/`reabrirApuracaoCac` foram deletados do código.

**Decisão — regra de repasse por unidade (`src/lib/cac.functions.ts`, função `regimeParaUnidade`):**
- **Fortaleza, Maceió, São Luis:** regime "atribuição" — 50% vence no fim do mês em que o contrato foi ganho (não mais 7 dias corridos da assinatura), 50% no fluxo de caixa do 1º pagamento do cliente (mecanismo igual ao de antes).
- **Campo Novo:** continua no regime antigo (7 dias) até acumular R$50 mil de MRR atribuído histórico (soma de todo o histórico de contratos ativos da unidade — hoje já em ~R$49,9 mil, então o próximo contrato deve cruzar). Ao cruzar, só contratos **novos** entram no regime "atribuição" — não retroage pros que já estavam pendentes. Calculado em `regimesCampoNovoPorContrato`.
- **Patos de Minas:** regime "excedente mensal" — sem parcela 1; CAC incide só sobre a fatia do MRR atribuído da unidade **no mês** que ultrapassar R$10 mil (contratos do mês em ordem de fechamento; quem fecha depois de já bater o teto banca o excedente inteiro). Reconhecido no fluxo de caixa do 1º pagamento do cliente. Calculado em `excedentesMensais`.

**Bug encontrado e corrigido na mesma sessão — corte histórico da Patos de Minas:** ao ativar `paga_cac=true` pra ela (unidade antiga, entrou em 08/24), o gerador de apuração rodou sobre TODO o histórico de contratos dela, criando CAC retroativo até dez/2024 — usuário notou no gráfico de projeção. Confirmado com o usuário: a regra da Patos de Minas só vale a partir de **agosto/2026** pra frente, nunca retroativo. Implementado como `PATOS_DE_MINAS_INICIO_CAC = "2026-08"` + função `mesMinimoCac`, aplicado tanto na descoberta de meses (`syncApuracoesEItensUnidade`) quanto como defesa extra dentro de `gerarItensParaApuracao` (mesmo que uma apuração de mês antigo já exista, nunca gera item pra ela). Os 12 registros de `cac_apuracao`/20 itens já gerados indevidamente (nenhum com parcela paga) foram apagados direto via Supabase REST (service_role) — não havia CLI/migration runner disponível pra rodar isso como migration de dados.

**Migration:** `supabase/migrations/20260727170000_patos_de_minas_paga_cac.sql` (ativa `paga_cac=true` pra Patos de Minas — aplicada em produção via REST no mesmo momento, já que não há Supabase CLI local).

**KPI "CAC a receber" — correção de fórmula:** primeira versão só contava parcela 2 como "a receber" quando o status já não era mais `aguardando_cliente` (i.e., só depois do cliente pagar a unidade) — resultava em `vendido ≠ recebido + a receber` (usuário percebeu a conta não fechando: R$352k vendido vs R$32k+R$156k = R$188k). Corrigido pra "a receber" = tudo que não está `pago`, incluindo `aguardando_cliente` — fecha a conta sempre, item a item, por construção. A diferença que antes ficava escondida (2ª parcela ainda sem o cliente ter pago) segue visível separadamente na timeline como "sem previsão".

**Timeline de projeção:** gráfico por mês (Recebido vs A receber, empilhado), cada parcela no mês do pagamento se já paga ou no mês do prazo se em aberto; perdeu a série "Atrasado" a pedido do usuário (entra junto em "A receber"). Parcela 2 ainda `aguardando_cliente` não tem mês pra entrar — soma à parte, fora do gráfico.

**Filtros adicionados:** unidade (select), status (Todos / CAC recebido / CAC a receber — usa a mesma `valorAReceber` pra decidir), mostrar excluídos (checkbox).

**Status:** implementado e no ar (push direto pra `main`, deploy via Vercel). `tsc --noEmit` e `eslint` limpos nos arquivos tocados (o padrão de `any` em `.functions.ts` é pré-existente no repo inteiro, não é regressão desta mudança). Não testado clicando na tela real — validar os números de Campo Novo (quando cruzar os R$50 mil) e Patos de Minas (a partir de agosto/2026) contra a expectativa do usuário no primeiro mês real de dados.

**Próximos passos:** nenhum obrigatório. Se surgir uma unidade nova em `paga_cac` sem regra definida, `regimeParaUnidade` cai no fallback "sete_dias" (regra antiga) — vale revisitar se isso for usado de verdade.

## [2026-08-03] Item de royalties nasce pré-confirmado se o mesmo contrato/CNPJ já estava confirmado no mês anterior

**Contexto:** usuário pediu uma "inteligência" na apuração de royalties — se um cliente já teve o item confirmado num mês, o mês seguinte já poderia nascer marcado, independente da fonte (Pipedrive ou Omie). Hoje `confirmado` não é só um checkbox de revisão: `fecharApuracao` só soma pro fechamento os itens com `confirmado=true` (itens não confirmados ficam de fora da fatura), então clientes recorrentes exigiam clicar em "confirmar" todo mês, mesmo sem nada ter mudado.

**Pergunta feita ao usuário:** o que fazer se o valor do Omie deste mês vier diferente do valor confirmado no mês anterior — só marca se o valor bater exatamente, ou marca sempre? **Resposta: marca sempre, independente do valor** — reduzir cliques pesa mais do que forçar revisão automática de reajuste; quem quiser revisar sempre pode desmarcar manualmente antes de fechar.

**Decisão:** em `gerarItensApuracaoCore` (`src/lib/royalties.functions.ts`), antes de gerar os itens do mês, busca a apuração anterior mais recente da mesma unidade e monta dois sets — contratos confirmados (`contrato_id`) e CNPJs confirmados (`cnpj`, pra itens só-Omie sem contrato) — a partir de `royalties_itens` com `confirmado=true` daquela apuração. Os 4 pontos onde um item **novo** é criado (contrato sem CNPJ, matched Pipedrive×Omie, só-Pipedrive, só-Omie) passam a nascer com `confirmado` = presença no set correspondente, em vez de sempre `false`. Só vale pra itens novos desta geração — itens que já existiam nesta apuração continuam com sua própria lógica de `confirmado` (preservado se já confirmado manualmente; resetado pra `false` quando o valor do Omie muda em relação ao que já estava salvo nesta mesma apuração — isso não foi tocado).

**Status:** implementado. Sem Node/npm/bun disponível na sessão pra rodar `tsc --noEmit`/build — revisão feita manualmente lendo o diff completo. Não commitado/pushado ainda (aguardando o usuário revisar, já que a branch atual tem outras mudanças não relacionadas em progresso).

**Próximos passos:** validar no primeiro mês real que roda com essa lógica — abrir uma apuração nova pra uma unidade que teve itens confirmados no mês anterior e conferir se eles já nascem marcados.

## [2026-08-06] Nova página `/royalties` — histórico de royalties por cliente + evolução do valor apurado

**Contexto:** usuário achou a apuração de royalties (`/unidades` → aba Royalties → `/royalties/$unidadeId/$mes`) pouco funcional sozinha — dá pra ver um cliente num mês de uma unidade, mas não dá pra ver o histórico de quantos boletos um cliente já pagou ao longo do tempo, nem acompanhar a evolução do valor apurado (geral e por unidade). Pediu uma tela nova, reaproveitando dados já usados (CNPJ, razão social, unidade, data do ganho), com filtro de cliente e de unidade.

**Decisão de escopo (perguntado ao usuário):** a evolução é só do valor **apurado** ao longo do tempo — não precisa cruzar com "recebido" (havia uma fonte candidata pra "recebido", `repasses_unidade`, usada em `/meus-royalties`, mas o usuário confirmou que não é necessário pra esta tela). Localização: página nova "Royalties" no menu lateral (grupo Receita da Rede), não uma aba dentro de `/clientes` nem dentro da apuração existente — a apuração por unidade/mês continua exatamente como está, acessível a partir de lá.

**Decisão técnica — reconstrução do valor apurado a partir dos itens, não do campo salvo na apuração:** `royalties_apuracao.royalties_valor` só é preenchido no fechamento (`fecharApuracao`) e fica `null` enquanto o mês está em rascunho/revisão (confirmado ao vivo: Campo Novo jul/2026 tinha `royalties_valor: null` com 13 itens já confirmados somando ~R$46,8k de base). A nova função (`listRoyaltiesHistoricoRede`, `src/lib/royalties-historico.functions.ts`) recalcula item a item — `valor_confirmado × (royalties_percentual_override do item, senão o da apuração) ÷ 100`, só itens `confirmado=true`, `categoria='royalties'`, `is_cac=false` e não excluídos — mesma fórmula de `fecharApuracao`, mas funciona também pra meses ainda abertos. Isso reaproveita o achado anterior de que o campo salvo na apuração pode ficar desatualizado/nulo.

**Agrupamento de cliente entre meses por CNPJ (dígitos), não por `contrato_id`:** `contrato_id` pode trocar entre meses (recontratação, merge de filiais pelo contrato "principal" em `gerarItensApuracaoCore`), mas o CNPJ persiste. Itens sem CNPJ (`status_match='so_pipedrive'` sem cadastro) caem num fallback por `contrato_id`/razão social — pode não casar perfeitamente entre meses nesse caso específico (mesma limitação já documentada pra contrato sem CNPJ).

**Cobertura de dados:** só aparecem meses em que alguém já abriu a tela de apuração daquela unidade pelo menos uma vez (itens nascem sob demanda; `garantirApuracoesAno` só pré-cria meses futuros do ano corrente, nunca passado). A página não dispara geração em massa de meses passados como efeito colateral de só visualizar o relatório — ficou como nota visível na própria tela.

**Permissão:** `view.royalties_historico` criada em `KNOWN_PERMISSIONS` (`src/lib/permissions.functions.ts`) e concedida ao papel `admin` via REST (service_role) na mesma sessão — outros papéis customizados precisam ser habilitados manualmente em `/admin/permissoes` se for o caso.

**Status:** implementado. Arquivos: `src/lib/royalties-historico.functions.ts` (novo), `src/hooks/use-royalties.ts` (`useRoyaltiesHistoricoRede`), `src/routes/_authenticated/royalties.index.tsx` (novo — rota `/royalties`, preenche o índice que antes só tinha o layout com `<Outlet/>`), `src/components/app-sidebar.tsx` (item "Royalties", ícone `HandCoins`), `src/lib/permissions.functions.ts`. `vite build` rodado com sucesso (regenerou `src/routeTree.gen.ts`) e `tsc --noEmit` sem erros novos nos arquivos tocados (erros pré-existentes de outras áreas do repo não são desta mudança). Validado contra dado real do Supabase (Campo Novo, jul/2026, apuracao_id 10) — recomputação bateu com a soma manual dos itens confirmados.

**Próximos passos:** nenhum obrigatório. Se o volume de meses/clientes crescer muito, considerar paginação ou limitar o range de meses da tabela (hoje traz tudo que existe, sem cap).

## [2026-08-10] Pipe Sócios somado como segunda fonte de vendas + venda de sócio via Omie

**Contexto:** existe um pipe no Pipedrive — pipeline 4, "Negociação - Sócios" — com vendas fechadas diretamente pelos sócios, fora do funil comercial padrão (pipeline 2, Inside Sales). Usa o mesmo campo "Unidade de Negócio" do pipeline 2. Além disso, algumas vendas de sócio são lançadas direto no Omie sem nunca virar deal no Pipedrive. Pedido do usuário: (1) somar o pipe Sócios como fonte de contratos/empresas; (2) permitir marcar, na apuração de royalties, um item adicionado manualmente como "venda de sócio", e a partir disso criar o deal correspondente automaticamente no Pipedrive.

**Achado paralelo, não relacionado ao pedido original:** ao abrir `~/sync_pipedrive_contratos.py` pra investigar, descobri que a fonte real de vendas em produção já é o **pipeline 2 (Inside Sales), `status=won`** — não mais o stage 170/pipeline 28 (Central de Contratos) como `DATA-RULES.md` e a memória do agente diziam desde jun/2026. A migração foi confirmada como intencional pelo usuário; a documentação é que nunca foi atualizada. Corrigido em `DATA-RULES.md` (seção 1) e na memória do agente.

**Decisão:**
1. `contratos`/`empresas` ganham coluna `origem_pipeline` (`'inside_sales' | 'socios'`, default `'inside_sales'`) — migration `20260810120000_pipe_socios.sql`. `~/sync_pipedrive_contratos.py` agora busca won deals dos dois pipelines (2 e 4) e marca a origem de cada linha. A lógica de remoção de contratos órfãos/lost (últimos 90 dias) passou a considerar os dois pipelines como válidos, não só o 2.
2. `royalties_itens` ganha `venda_socios` (boolean, default false), `pipedrive_deal_id_socios` (texto, id do deal criado) e `venda_socios_criado_em`. Checkbox "Venda de sócio" no diálogo de adicionar cliente manualmente (`AddItemDialog`) e na própria tabela de itens manuais (mesmo padrão do toggle de CAC, `is_cac`). Server functions `addItemManual`/`updateItem` (`royalties.functions.ts`) aceitam o campo.
3. `~/sync_pipedrive_contratos.py` ganhou `run_criar_deals_socios()`: lê itens com `venda_socios=true` e `pipedrive_deal_id_socios` ainda nulo, cria o deal via API (pipeline 4, stage 128 "Ganho", `status=won`, Unidade de Negócio mapeada de `unidades.nome_da_praca`, CNPJ se disponível), grava o id do deal de volta (idempotente — não recria). Roda automaticamente no fim do sync diário (mesmo padrão de `run_backfill_contrato_assinado`, não bloqueia o sync se falhar). Fecha o loop com o item 1: o deal criado entra em `contratos`/`empresas` normalmente na sincronização seguinte, como qualquer outro do pipeline 4 — não existe escrita direta em `contratos`/`empresas` a partir da apuração.
4. **Bug pré-existente corrigido de passagem:** a remoção de contratos lost/wrong_pipeline dava `409 Conflict` sempre que o contrato tinha parcela de CAC vinculada (`cac_apuracao_itens.contrato_id` é FK pra `contratos.id` e não estava sendo limpo antes do delete, diferente de `royalties_itens`/`contrato_omie_grupos`). Corrigido no mesmo commit.

**Status:** implementado e validado. Migration aplicada em produção via Management API. `~/sync_pipedrive_contratos.py` já rodou em produção real (93 contratos do pipe Sócios importados corretamente, 2 contratos lost removidos sem erro). `run_criar_deals_socios` testado ponta a ponta contra a API real do Pipedrive (deal de teste criado com pipeline/stage/status/campos corretos e apagado em seguida). Front-end: `tsc --noEmit` sem erros novos nos arquivos tocados (`royalties.functions.ts`, `royalties.$unidadeId.$mes.tsx`); `vite build` processa os módulos normalmente e para num erro pré-existente não relacionado (`xlsx-js-style` ausente de `node_modules`, import em `royalties-demonstrativo.ts` — não é desta mudança). `src/integrations/supabase/types.ts` regenerado via `supabase gen types` pra refletir as colunas novas.

**Próximos passos:** nenhum item de venda de sócio existia em produção até este commit, então `run_criar_deals_socios` ainda não criou nenhum deal real — validar o primeiro caso real quando o usuário marcar o primeiro item. Considerar investigar separadamente o `xlsx-js-style` ausente (fora do escopo desta mudança).

## [2026-08-11] Rede Overview v2: churn real + MRR novo vs royalties + plano de "Painel de Gestão à Vista"

**Contexto:** `/rede-overview` tinha 3 gráficos mortos (Crescimento %, Clientes Ativos, % NRR — nenhum trazia informação além do que os cards de topo já mostravam) e dois KPIs de churn (`Churn Receita`, `Churn Logo`) hardcoded em "—", nunca ligados a dado real. Logo em seguida, pedido separado (áudio da Mônica Sumaya, CS) por um "painel de gestão à vista" com qualidade (NPS/ICS), ranking de melhores/piores unidades e ranking de quem vende mais.

**Decisão (implementado):**
1. Removidos os 3 gráficos mortos.
2. Novo gráfico "MRR Novo vs Royalties Recebido (mês a mês)": MRR Novo = `contratos.mrr_mensal` agrupado por mês de `ganho_em` (mesma metodologia de New MRR já usada em BI de Vendas — não confundir com `v_reconciliacao_mensal.mrr_contratado`, que é o MRR ativo atual repetido em todos os meses via `CROSS JOIN`, não uma série histórica real). Royalties Recebido reaproveita `useRoyaltiesHistoricoRede()` (mesma fonte que `/royalties` já usa — `valor_confirmado × percentual`, regime caixa).
3. `Churn Receita`/`Churn Logo` ligados a `central_tratativas` (`estagio='Perdido'`, `status='lost'`) — mesma fonte que royalties/CAC já usam pra excluir cliente da apuração. Logo % = perdidos/total; Receita % = MRR perdido/(MRR ativo + MRR perdido).
4. Filtro de Unidade do topo passou a valer pros dois gráficos novos e pro churn (antes só valia pra tabela "Resumo por Unidade").

**Achado, não corrigido ainda:** `rede-overview.tsx` nunca aplicou `data.scope.own_unit_only` (permissão que existe e é respeitada em `/clientes` via `scopedToOwnUnit`) — um usuário com role `socio` (que tem essa flag = true) vê a rede inteira na página, não só a própria unidade. Não é regressão desta mudança, já era assim. Fica crítico pro próximo passo abaixo.

**Plano (não implementado, aguardando priorização do usuário):** ver spec completa em `[[outputs/2026-08-spec-painel-gestao-a-vista]]` no wiki (`AI Projects/wiki/outputs/2026-08-spec-painel-gestao-a-vista.md`). Resumo: consolidar NPS por unidade (já calculado em `painel-cs/nps-tab.tsx`), % carteira saudável por unidade (já calculado em `saude-carteira.functions.ts`) e churn por unidade (hoje só agregado) numa única tabela "Desempenho por Unidade", evoluindo a tabela "Resumo por Unidade" existente. Ranking de vendedores (`contratos.closer`/`sdr`) como leaderboard separado. **Bloqueado até resolver o achado de permissão acima** — subir ranking nomeado entre unidades em cima de uma página que já vaza dado de rede pra sócio de franquia piora o problema.

**Status:** itens 1–4 implementados e validados (`tsc --noEmit` e `eslint` limpos, testado via `vite dev` local). Plano da Fase 2+ documentado, não codado.

**Próximos passos:** decidir com o usuário (a) se "quem vende mais" é ranking de unidade, de vendedor, ou os dois; (b) se sócio deve ver só a própria linha no ranking ou nada; (c) corrigir `scopedToOwnUnit` em `rede-overview.tsx` antes de subir qualquer ranking entre unidades.

## [2026-08-11] Resolução das 3 perguntas + Fase 1 do Painel de Gestão à Vista implementada

**Respostas do usuário:**
1. "Quem vende mais" começa a ser medido pelo painel de Sócios no Pipedrive (pipeline 4) — todo card desse pipe é venda de sócio e precisa estar identificado no Ops.
2. Sócio de franquia pode ver o ranking completo — sem restrição por unidade. O achado de `scopedToOwnUnit` não aplicado em `rede-overview.tsx` (registrado na entrada anterior) continua real, mas o usuário decidiu explicitamente que, pro ranking, visibilidade total é o comportamento desejado — não é mais bloqueante pra essa feature específica.
3. Todo card do Overview (não só NPS) segue o padrão "resumo aqui + link Ver detalhe pra página específica" — não só os novos, os que já existem também.

**Implementado nesta sessão:**
- Cards "NPS da Rede" (`useNps()`) e "Carteira Saudável" (`useSaudeCarteira()`) — resumo agregado, respeitando o filtro de Unidade, com link "Ver detalhe" pra `/painel-cs`.
- Componente `VerDetalheLink` reutilizável — aplicado também nos cards de Churn (já existentes) e no card MRR Novo vs Royalties, todos agora linkando pra suas páginas de detalhe (`/painel-cs`, `/royalties`).
- Grid de KPIs foi de 5 pra 7 cards (`lg:grid-cols-4` em vez de `lg:grid-cols-5`, pra quebrar em 4+3 em vez de 5+2).

**Achado ao investigar a Fase 2 (ranking de vendas):** `contratos.closer` está `NULL` em 93/93 linhas com `origem_pipeline='socios'` — o campo customizado "Closer Responsável" do Pipedrive nunca é preenchido no pipe Sócios (confirmado direto na API: `82f35432010d0c95fceeaa0b5bce5f8e7542a795` vem `None` pros 93 deals). Isso significa que, hoje, **não dá pra saber qual sócio vendeu cada contrato** a partir do dado já sincronizado. Achado o substituto: o `user_id` do deal no Pipedrive (dono do card, sempre preenchido — testado ao vivo: 83 deals won em pipeline 4, 100% com `user_id`) já identifica a pessoa: Paulo (34), Jordana Vieira (24), Rogério (15), Eduardo Borsoi (5), Mateus Nunes (2), 1 usuário removido (3 deals). `~/sync_pipedrive_contratos.py` nunca leu esse campo — só lê os campos customizados `CLOSER_FIELD`/`SDR_FIELD`, que ficam vazios nesse pipe.

**Achado paralelo, não bloqueante:** o campo customizado "Unidade de Negócio" também só é preenchido em 41/93 cards do pipe Sócios (52 ficam com `unidade=NULL` em `contratos`) — é gap de preenchimento no Pipedrive pelos próprios sócios, não bug de sync (o código já lê o campo igual pros dois pipelines).

**Decisão pendente de confirmação do usuário antes de mexer em produção:** gravar `user_id.name` do Pipedrive em `contratos.closer` pra deals `origem_pipeline='socios'` (reaproveita a coluna, que hoje fica sempre vazia nesse pipe — dá um leaderboard único de "quem vendeu", misturando closers de Inside Sales com sócios) vs. criar uma coluna nova (`socio_vendedor` ou similar) pra manter os dois conceitos separados mesmo que exibidos juntos no ranking. Qualquer uma das duas exige alterar `~/sync_pipedrive_contratos.py`, que roda em produção via LaunchAgent diariamente — não deve ser tocado sem confirmação explícita.

**Status:** Fase 1 implementada e validada (`tsc --noEmit`/`eslint` limpos, testado via `vite dev` local). Fase 2 (ranking) ainda não iniciada — aguardando decisão de schema acima.

**Próximos passos:** usuário decide reaproveitar `closer` ou criar coluna nova; depois disso, alterar `~/sync_pipedrive_contratos.py` pra capturar `user_id.name` nos deals de `PIPELINE_SOCIOS`, rodar backfill nos 93 contratos já existentes, e então construir o leaderboard "Top Vendedores" no Overview.

## [2026-08-11] Reversão — dados de rede ficam fechados por padrão em `/rede-overview` (não mais "sócio vê tudo")

**Contexto:** ao planejar, numa sessão separada, um novo bloco pro Overview (Matriz vs. Sócios/"Hunter", Auditoria Interna, LTV — ver `[[outputs/2026-08-spec-painel-desempenho-unidade]]` no wiki), a permissão pedida pra esse bloco (sócio vê só a própria unidade) divergia da decisão registrada na entrada anterior deste arquivo ("Sócio vê o ranking completo, sem restrição"). Levada a divergência ao usuário pra confirmar se era proposital.

**Decisão:** não era proposital. **Revertida a decisão anterior.** A partir de agora, por padrão, dados agregados de rede ficam fechados — cada unidade (`role='socio'`) vê só os próprios dados em `/rede-overview`, aplicando `data.scope.own_unit_only` (`scopedToOwnUnit`, mesmo padrão já usado em `/clientes`) em **toda a página**, não seção por seção.

**Impacto no que já está implementado:**
- Fase 1 (cards "NPS da Rede" e "Carteira Saudável", entrada anterior deste arquivo) **foi implementada antes desta reversão e não aplica `scopedToOwnUnit`** — hoje mostra rede inteira pra `socio`. Precisa de correção retroativa.
- Fase 2 (ranking de vendedores/Top Vendedores, ainda não iniciada — ver "Decisão pendente" na entrada anterior) passa a exigir `scopedToOwnUnit` desde o início da implementação, não é mais opcional.
- Qualquer seção nova no Overview (Matriz/Hunter/Auditoria/LTV, ainda não implementada) já nasce com o filtro aplicado.

**Status:** decisão registrada, nenhuma implementação de código feita ainda. `rede-overview.tsx` tem mudanças locais não commitadas nesta working copy (de sessão anterior) — conferir se elas já tocam nesse ponto antes de aplicar a correção, pra não sobrescrever trabalho em andamento.

**Próximos passos:** aplicar `scopedToOwnUnit` em `rede-overview.tsx` cobrindo a página inteira (cards de topo, tabela "Resumo por Unidade", NPS/Saúde/Churn, e qualquer seção nova) antes de subir a Fase 2 ou o novo bloco Matriz/Hunter/Auditoria/LTV em produção.

## [2026-08-11] Implementado — blocos Matriz/Hunter/Auditoria + scopedToOwnUnit em rede-overview.tsx

**Contexto:** implementação do bloco planejado em `outputs/2026-08-spec-painel-desempenho-unidade.md` (wiki), e da correção de permissão da entrada anterior. `rede-overview.tsx` estava sendo editado ativamente por outra sessão do usuário em paralelo (mesmo arquivo, diff local crescendo em tempo real) — confirmado com o usuário que não era conflito antes de prosseguir; a outra sessão implementou simultaneamente, sem conflito destrutivo, os blocos da spec irmã `outputs/2026-08-spec-painel-gestao-unidades-indicadores.md` (Lifetime, Booking, Receita Total, Clientes Ativos série temporal, Churn de Receita waterfall).

**Implementado:**
1. **Matriz vs. Hunter**: `vendasMatrizPorUnidade`/`vendasHunterPorUnidade` — split de `contratos` por `origem_pipeline` (`inside_sales` vs. `socios`). Hunter aplica `unidade IS NOT NULL` (decisão de 11/08: cards do pipe Sócios sem "Unidade de Negócio" preenchida — 52/93 — são ignorados, não rateados nem mostrados numa linha "sem unidade"; nota de rodapé na tabela mostra quantos ficaram de fora). Coluna `% Hunter` (`mixHunterPct`) com destaque verde — mix mais Hunter é sinal positivo (autossuficiência comercial), não alerta.
2. **Auditoria Interna**: card de topo "Auditoria Interna (fiscal)" com Oportunidade/Contingência agregadas (`auditoriaStats`, fonte `auditorias_internas` — pipe Pipefy 307181077) + `VerDetalheLink` pra `/auditoria-interna`. Colunas Oportunidade/Contingência na tabela "Resumo por Unidade" (`auditoriaPorUnidade`, casado por `normalizeUnitName` porque o pipe de Auditoria é diferente do de vendas — nome de unidade pode não bater caractere-a-caractere).
3. **`scopedToOwnUnit` em toda a página** (reverte a permissividade da entrada anterior, agora aplicada de fato): helper `scopeRows()` filtra as 5 fontes buscadas na página (`rows`, `empresas`, `churnCards`, `contratosNovos`, `auditorias`) via `unitMatches(perms.unidade, r.unidade)` — não igualdade estrita, porque `perms.unidade` já provou não bater caractere-a-caractere com `empresas.unidade` em `/clientes` (é por isso que `unitMatches` existe). Linhas que passam têm `unidade` normalizada pro valor de `perms.unidade`, então os memos existentes (que já comparam por igualdade estrita contra `unidadeFilter`) continuam funcionando sem precisar reescrever cada um. `unidadeFilter` é travado em `perms.unidade` via `useEffect` quando `scopedToOwnUnit`; o `Select` de unidade vira `Badge` fixo (mesmo padrão de `/clientes`), corrigindo retroativamente a Fase 1 (NPS/Saúde) que tinha subido sem esse filtro.

**Ressalva conhecida, não corrigida:** o gate cobre as 5 fontes buscadas direto neste arquivo, mas não os dados de hooks externos (`useNps`, `useSaudeCarteira`, `useRoyaltiesHistoricoRede`) — esses continuam comparando `unidade` por igualdade estrita contra `unidadeFilter` (já travado em `perms.unidade`), sem a normalização `unitMatches`. Risco residual: nome de unidade não batendo faz o card mostrar "—" em vez de vazar dado (falha fechada, não é vazamento de segurança) — mas pode aparentar bug de "sem dado" pro sócio. Candidato a lint futuro se alguém reportar card vazio que deveria ter dado.

**Status:** implementado. `tsc --noEmit` limpo em `rede-overview.tsx` — os 11 erros do build inteiro são todos em arquivos não tocados por esta mudança (`integracoes-status.functions.ts`, `reconciliacao.functions.ts`, `admin.integracoes.tsx`, `reconciliacao.tsx`, `reforma-tributaria.tsx`, pré-existentes ou de outro trabalho em andamento). Não commitado nem dado push — mudança só na working copy local, que já tinha (e continua tendo) alterações de outra sessão em paralelo no mesmo arquivo.

**Próximos passos:** bloco LTV desta spec não foi tocado aqui — ver spec irmã / entradas relacionadas pro status (implementado em paralelo pela outra sessão). Investigar a ressalva de `unitMatches` nos hooks externos se algum sócio reportar dado ausente. Revisar e commitar o conjunto de mudanças de `rede-overview.tsx` (ambas as sessões) quando estabilizar.

## [2026-08-11] Implementado — Booking/Receita/LTV/Clientes Ativos/Churn de Receita em rede-overview.tsx (spec irmã)

**Contexto:** implementação de `outputs/2026-08-spec-painel-gestao-unidades-indicadores.md` (wiki) — usuário trouxe mockup de referência genérico de SaaS pedindo Receita Total, Booking Total, Qtd Proj. Ativos, ARPA, Clientes Ativos, Lifetime, split de receita por tipo, Churn de Receita, Crescimento Mensal. Rodou em paralelo, no mesmo arquivo, com a sessão da entrada anterior (Matriz/Hunter/Auditoria/`scopedToOwnUnit`) — sem conflito destrutivo, confirmado com o usuário.

**Decisões de definição (usuário, 11/08):**
- **Booking Total** = valor do novo MRR do mês × 12 (contrato assumido em 12 meses) — não existe conceito de "valor total contratado" na Planning, então essa é a aproximação.
- **Qtd Proj. Ativos** = mesmo número de Clientes Ativos (redundante, não virou card separado).
- **Lifetime (Ativo/Finalizado/Geral)**: soma de `royalties_itens.valor_confirmado` por cliente (não `contas_receber` bruto) — é o valor já confirmado/apurado na tela de royalties, categoria `royalties`, excluindo itens `is_cac` e excluídos. Finalizado = soma até a data de churn (`central_tratativas.data_churn`, cruzado por CNPJ); Ativo = soma até o mês atual, sem churn. Geral = média simples entre os dois médios (não pool ponderado).

**Implementado:**
1. Cards: Recebido (12 meses) e Booking Total (12 meses) — janela móvel de 12m vs. 12m anteriores, não acumulado desde sempre. ARPA (MRR ÷ clientes ativos). Lifetime (Geral/Ativo/Finalizado).
2. Gráficos: Crescimento Mensal (Clientes Iniciaram vs. Churn Logo, por mês), Variação do Booking % (barras verde/vermelho), Clientes Ativos em série temporal (reconstruído por evento — ganho menos churn acumulado por mês, sem snapshot salvo), Churn de Receita por Mês (waterfall Novo/Expansão/Contração/Perdido + linha Revenue Churn %).
3. `src/lib/royalties-historico.functions.ts`: campo `is_cac` passou a ser propagado no objeto por-mês do histórico por cliente (`RoyaltiesHistoricoMes`) — antes só era usado internamente pro cálculo de evolução da rede. Mudança aditiva, não quebra `/royalties`.
4. `contratos` ganhou `cnpj` na query do Overview (pra série de Clientes Ativos cruzar com churn por CNPJ, mesmo padrão do LTV).

**Adaptação de nomenclatura:** o waterfall de Churn de Receita usa rótulos **Novo/Expansão/Contração/Perdido**, não os do mockup original (**Perdido/Ganho/Variáveis/Exp. One Time**) — esses 4 nomes nunca tiveram definição no vocabulário da Planning; o waterfall de MRR padrão é o que dá pra computar direto da base de receita por cliente/mês já usada no LTV. Nota explicando isso ficou na própria UI do card.

**Não implementado — Fase 2a (Receita Recorrente/Variável/One Time):** adiada. Sem acesso a banco de dados na sessão que fez essa parte pra checar quais `codigo_categoria` realmente aparecem em `contas_receber` por unidade — mapear isso às cegas violaria a regra de sempre validar contra dado real antes de subir tela.

**Correção de passagem:** encontrada referência quebrada (`vendasMesPorUnidade`, variável removida pela sessão de Matriz/Hunter sem atualizar o único uso restante na tabela "Resumo por Unidade") — corrigida pra somar `vendasMatrizPorUnidade + vendasHunterPorUnidade` no mesmo lugar, sem alterar o resto daquela feature.

**Status:** implementado. `tsc --noEmit`/`eslint`/`vite build` **não foram rodados** nesta sessão — ambiente sem `node`/`bun` disponível. Revisão foi manual (balanceamento de chaves/parênteses, leitura linha a linha, checagem de referências). Ambas as sessões (esta + a de Matriz/Hunter/Auditoria) commitadas e enviadas juntas via `git push origin main` a pedido do usuário ("pode subir") — sem rodar o build antes por falta de toolchain; a sessão irmã já tinha validado `tsc --noEmit` limpo antes das mudanças desta entrada serem adicionadas por cima.

**Próximos passos:** rodar `bun run lint`/`bun run build` assim que possível (ambiente com toolchain) pra validar as mudanças desta entrada, que não foram checadas por ferramenta nenhuma antes do push. Fase 2a (Recorrente/Variável/One Time) segue pendente, precisa de acesso a dado real pra validar mapeamento de categorias.

## [2026-08-11] Backfill de royalties_apuracao — Patos de Minas jan/26 e fev/26

**Contexto:** usuário notou (via `/receita-partners?tab=financeiro-rede`, ver seção anterior de correção de royalties) que Patos de Minas não tinha apuração de royalties entre dez/25 e fev/26. Ao investigar, descobri que um backfill retroativo já tinha sido feito em 10/08/2026 (por uma sessão Claude Code anterior, autorizado por Victor Eliezek) para mar/abr/mai/26 — usando `royalties_itens.fonte='manual'`/`confirmado_por='backfill-planilha (Claude Code, aut. Victor Eliezek)'` — mas **essa decisão nunca foi registrada aqui**, o que causou boa parte da investigação de hoje. Fonte usada por aquela sessão (e por esta): `Desktop/Royalties/Planning Patos de Minas - Maio de 2026.xlsx`, aba "Fechamento mensal" — planilha viva que a unidade mantém, com receita bruta por cliente mês a mês desde out/2024.

**Achado paralelo (não corrigido, só documentado):** mar/abr/mai/26 guardaram o componente de 4% (carteira antiga) no campo `csc_valor_fixo` em vez de `csc_base_antiga_valor`/`csc_percentual_base_antiga` — tecnicamente errado (Patos de Minas não usa CSC fixo, só percentual; `unidades.csc_valor_fixo` é `null` pra essa unidade), mas sem efeito prático hoje porque `rede-financeiro-view.tsx` soma os dois campos do mesmo jeito. Abril também diverge do valor atual da planilha (R$3.152,19 no banco vs R$2.904,84 na planilha — provável revisão posterior da planilha, não investigado a fundo). Não mexido a pedido do usuário (só jan/fev por ora).

**Decisão:** criadas duas apurações novas (`royalties_apuracao` id 42 = jan/26, id 43 = fev/26), status `confirmado`, seguindo o **mesmo método de reconciliação por cliente já usado em mar/abr/mai** (não a geração automática via Omie/Pipedrive — Patos de Minas não tem essa régua completa) mas com os campos corretos (`csc_base_antiga_valor`/`csc_percentual_base_antiga`, como em jun/26, a única apuração dessa unidade feita pelo fluxo normal/real). Valores extraídos linha a linha da planilha (seção "Novos clientes", colunas jan/26 e fev/26) e conferidos contra os totais já fechados da própria planilha ("Royalties do período" + mídia = linha "Total"):
- Jan/26: Royalties 8% R$8.732,64 (13 clientes) + CSC base antiga 4% R$2.856,88 + mídia R$10.000 = **R$21.589,52** (bate exato com a planilha).
- Fev/26: Royalties 8% R$10.009,60 (15 clientes) + CSC base antiga 4% R$2.807,40 + mídia R$10.000 = **R$22.817,00** (bate exato).
- `outras_receitas=0` nos dois meses — a planilha não tem lançamento de Qulture.Rocks/Pipedrive/Power BI antes de mar/26 (ausência real, não lacuna). `cac_valor=0` — regra de CAC de Patos de Minas só entra em vigor a partir de ago/26 (ver decisão de CAC anterior). Dez/25 **não foi criado** — não existe nenhuma referência a dez/25 na planilha pra essa unidade, então não havia dado pra reconciliar (diferente de mar-jun, que têm dado real).

**Status:** implementado via REST direto (service_role key), sem passar pela UI/servidor — mesma abordagem da sessão de 10/08 (não há CLI/migration runner local pra isso). Escrita feita fora do fluxo `gerarItensApuracaoCore` (que depende de match Pipedrive/Omie, que essa unidade não tem completo) — itens gravados com `fonte='manual'`, `status_match='manual'`, mais um item agregado "Base Antiga Patos de Minas" (`categoria='csc_base_antiga'`) espelhando o padrão de jun/26. Conferido por query direta pós-escrita: `total_fatura` de ambos os meses bate exatamente com a linha "Total" da planilha.

**Próximos passos:** nenhum obrigatório. Se algum dia vier limpar mar/abr/mai/26 (mover o valor de `csc_valor_fixo` pra `csc_base_antiga_valor`), fazer os 3 meses junto e reconferir abril contra a versão mais recente da planilha antes de decidir qual valor é o certo.

## [2026-08-11] Rede Overview reorganizado em abas + filtro de período + correção de 3 bugs de dado

**Contexto:** depois das duas specs implementadas em paralelo (Matriz/Hunter/Auditoria + Booking/LTV/Churn de Receita, entradas anteriores), a página ficou com informação demais numa tela só. Usuário pediu reorganização em abas usando o mockup de referência como benchmark pra aba principal, e foi ajustando iterativamente ao ver a tela rodando local (`localhost:8080/rede-overview`).

**Decisão — estrutura de abas:**
1. **Visão Geral** (padrão) — 6 KPIs no estilo do mockup (Receita Total, Booking Total, Qtd Proj. Ativos = Clientes Ativos, Receita Média Cliente, Qtd Clientes Ativos, Lifetime) + gráfico Receita (barra única, sem o split Recorrente/Variável/One Time — usuário decidiu que não precisa) + Novo vs. Perdido por Mês (MRR) + Crescimento Mensal + Clientes Ativos (série) + Variação do Booking %.
2. **Vendas & Unidades** — card MRR, Ranking de Unidades (barra horizontal por **MRR Hunter**, não MRR total — usuário pediu explicitamente ranking de vendas próprias das unidades, não de MRR geral), tabela "Resumo por Unidade" (Matriz/Hunter/Auditoria).
3. **Financeiro** (nova) — gráfico "MRR Novo vs Royalties Recebido" (estava em Vendas & Unidades, movido pra cá a pedido do usuário, com Ranking de Unidades entrando no lugar).
4. **Qualidade & CS** — Churn Receita, Churn Logo, Carteira Saudável, Auditoria Interna. Removidos NPS da Rede e KPI—NRR (usuário pediu pra tirar).

**Decisão — filtro de período (novo):** dois campos de data no topo, padrão **ano corrente** (01/01 a 31/12). Afeta todo gráfico/KPI de período da aba Visão Geral (via helper `inRange`); MRR/Clientes Ativos continuam "estado atual", não filtrados. Receita Total/Booking Total viraram "período selecionado vs. período anterior de mesma duração" (antes era janela fixa de 12 meses).

**3 bugs de dado corrigidos nesta sessão (achados pelo usuário testando a tela local):**
1. **`hsl(var(--primary))`/`hsl(var(--muted-foreground))` inválidos** — `--primary` etc. já são `oklch(...)` no `styles.css`; envolver em `hsl()` produz CSS inválido, deixando as séries "MRR"/neutras invisíveis nos gráficos (bug pré-existente, não só das séries novas desta sessão). Trocado por `var(--primary)`/`var(--muted-foreground)` direto em todo o arquivo.
2. **Churn de Receita inflado por apuração não gerada** — a v1 do gráfico "Novo/Expansão/Contração/Perdido" contava cliente como Perdido sempre que sumia da apuração de royalties de um mês pro outro, sem checar se a apuração daquele mês/unidade tinha sido gerada (itens são sob demanda). Resultado: mês corrente sem apuração gerada aparecia como churn de ~R$1M sem nenhum churn real. **Corrigido trocando a fonte inteira**: Perdido agora vem só de `central_tratativas` (mesma fonte dos outros cards de churn da página), Novo de `contratos.ganho_em`. Expansão/Contração removidas (sem medição confiável de receita por contrato mês a mês ainda) — gráfico virou "Novo vs. Perdido por Mês (MRR)".
3. **Matriz/Hunter só somava vendas do mês corrente** — dava valores minúsculos (ex: Belém com R$1.621 de Matriz) numa tabela cujas outras colunas são "estado atual". Trocado pra somar `mrr_mensal` de todo contrato `status_contrato='Ativo'`, por origem — agora Matriz+Hunter bate exatamente com o MRR Atual da linha. Efeito colateral (não é bug, é gap real de dado): ficou visível que **~92% do MRR de origem Sócios está sem "Unidade de Negócio" preenchida no Pipedrive** (R$595k de ~R$645k), então a coluna Hunter mostra só uma fração pequena do volume real vendido pelos sócios — precisa ser corrigido direto no Pipedrive, não dá pra resolver no frontend.

**Decisão — Lifetime (LTV), 2ª revisão:** trocado de novo, agora pra **fórmula ARPA ÷ churn mensal** (padrão SaaS) em vez da soma empírica de `royalties_itens.valor_confirmado` — essa soma subestimava clientes antigos com pouco histórico de apuração gerado (dava LTV de R$13k, claramente baixo). Card mostra: LTV (R$), Vida útil projetada (1÷churn mensal), e **Vida útil dos concluídos** (métrica nova, complementar: tempo real de vida de quem já deu churn, `contratos.ganho_em` mínimo por CNPJ até `central_tratativas.data_churn` — não depende de `royalties_itens`, então não tem o problema de cobertura).

**Status:** implementado. Segue **sem rodar `tsc`/`eslint`/`build`** nesta sessão inteira — ambiente sem `node`/`bun`. Revisão manual em cada edição (balanceamento de chaves/parênteses, grep de referências órfãs). Recomendado fortemente rodar o build antes do próximo deploy real, já que várias mudanças de sintaxe (JSX com IIFE no rodapé da tabela, `LabelList` com `content` custom) nunca foram checadas por ferramenta.

**Próximos passos:** corrigir preenchimento de "Unidade de Negócio" no pipe Sócios do Pipedrive (fora do escopo de código — ação manual ou processo). Rodar lint/build. Fase 2a (split Recorrente/Variável/One Time) segue adiada, precisa de acesso a dado real pra validar categorias.

## [2026-08-14] RLS de `contas_receber` reescrita — timeout em /rede-overview

**Contexto:** usuário reportou "Erro ao carregar dados: Resumo por unidade: canceling statement due to statement timeout" em `/rede-overview`. Não era bug de código — a view `v_reconciliacao_mensal` (usada pelo card) roda em 65ms sem RLS, mas 1,2s como usuário autenticado (18x mais lento), numa tabela de só ~30k linhas.

**Causa raiz:** as 3 policies de SELECT em `contas_receber` chamavam `has_role()`/`can()`/`current_user_unidade()` "soltos" no `USING`, sem `(select ...)` ao redor. O Postgres não consegue cachear isso como `InitPlan` quando o `OR` inclui uma cláusula correlacionada à linha (`unidade = current_user_unidade()`, da regra de sócio) — resultado: as funções são reavaliadas linha a linha em cada `Seq Scan`. Confirmado isolando o mesmo predicado: 332ms (sem `select`) vs. 9ms (com `select`), 36x.

**Mesmo padrão existe em ~42 outras tabelas** do schema (`contratos`, `empresas`, `central_tratativas`, `unidades`, `auditorias_internas`, etc.) — não mexidas nesta sessão, escopo ficou só em `contas_receber` por decisão do usuário (a que realmente estava estourando timeout agora). Achado registrado aqui pra não se perder — vale revisitar se outra página começar a dar timeout parecido.

**Fix:** `supabase/migrations/20260814170000_rls_perf_contas_receber.sql` — `ALTER POLICY ... USING (...)` reescrevendo as 3 policies com cada chamada de função envolvida em `(select ...)`. Mesma lógica booleana, mesmos papéis, mesmas regras de acesso — puramente performance. Aplicado direto em produção via Management API (não há CLI/migration runner local nesta sessão, mesma limitação já registrada nas decisões anteriores). Verificado depois via `EXPLAIN ANALYZE` emulando o usuário autenticado: 1,2s → ~130ms.

**Próximos passos:** se quiser eliminar a causa raiz por completo, revisitar as ~42 tabelas restantes com o mesmo padrão — candidatas a estourar timeout conforme os dados crescerem, mesmo sem reclamação ainda.

## [2026-08-14] Sync diário de contratos quebrado 11–14/08 (FK `cac_apuracao_itens`) + 4 LaunchAgents desligados

**Contexto:** usuário perguntou se o "Ranking de Unidades (MRR Hunter)" estava atualizado com o pipe Sócios (Pipedrive pipeline 4). Investigando, achei dois problemas reais.

**1. Automação de `contratos` na nuvem (pg_cron 10:10 UTC → Edge Function `pipedrive-contratos-sync`) só cobre o pipeline 2 (Matriz/Inside Sales)** — nunca teve lógica pro pipeline 4 (Sócios). Isso só existe no script local `~/sync_pipedrive_contratos.py`, que não tem LaunchAgent/crontab agendando — só roda quando disparado manualmente. Ou seja, `origem_pipeline='socios'` em `contratos` só atualiza sob demanda. Não mexido nesta sessão (mudaria o escopo da automação existente, fora do que foi pedido).

**2. A automação diária (mesmo só cobrindo Matriz) estava falhando TODOS os dias desde pelo menos 11/08** — `DELETE contratos` batia em `23503 foreign key violation`: um contrato marcado como lost/wrong_pipeline ainda tinha parcela referenciada em `cac_apuracao_itens.contrato_id`, e essa FK não estava sendo limpa antes do delete (diferente de `royalties_itens`/`contrato_omie_grupos`, que já tinham esse tratamento). Resultado: sync silenciosamente quebrado 4+ dias, sem alertar ninguém (mesmo modo de falha de outras migrações anteriores, ver `[[project_migracao_integracoes_supabase_cloud]]` na memória).

**Achado curioso:** esse exato bug já tinha sido encontrado e corrigido no script local em **10/08/2026** (comentário no próprio script referenciando a data), mas o fix nunca foi replicado na Edge Function que realmente roda em produção — os dois arquivos divergiram.

**Fix:** replicado o mesmo `supaPatchFilter` pra `cac_apuracao_itens?contrato_id=in.(...)` antes do DELETE, em `supabase/functions/pipedrive-contratos-sync/index.ts`. Deploy feito via `npx supabase functions deploy` (CLI via npx funcionou desta vez — Docker não estava rodando mas não bloqueou o deploy). Invocação manual pós-fix: `ok:true, deals:368, lost_removidos:50` — sync completo, sem erro.

**3. 4 LaunchAgents locais desligados** (a pedido do usuário, "automações que já tem na nuvem funcionando pode desativar local") depois de confirmar que os equivalentes cloud rodaram com sucesso hoje: `financeiro-fxc-sync`, `omie-clientes-sync`, `omie-sync`, `recebimentos-franquias-sync`. `.plist` movidos pra `~/Library/LaunchAgents/disabled-migrated-to-cloud/` (não deletados). `notion-sync` continua ativo — não tem equivalente na nuvem. Detalhe completo em `[[project_migracao_integracoes_supabase_cloud]]` na memória.

**Próximos passos:** decidir se o pipe Sócios (pipeline 4) merece entrar na automação cloud também, ou se o fluxo manual sob demanda é aceitável por enquanto.

## [2026-08-21] CAC: separado "venda ganha" de "contrato assinado" — gate de disponibilidade pra cobrar

**Contexto:** usuário pediu a mesma visão de uma planilha ad hoc ("vendas com contrato assinado e CAC ainda não cobrado ≥50%") dentro da página de CAC do ops (`/unidades`, aba CAC), reclamando que a tela atual "não está muito prática" e que precisa que só apareça como **disponível pra cobrar** quem já tem contrato assinado.

**Achado (bug de nomenclatura, não de cálculo):** `cac_apuracao_itens.data_assinatura_contrato` é preenchido com `contratos.ganho_em` (data da venda GANHA no Pipedrive) — não é a data real de assinatura do contrato (`contratos.entrada_contrato_assinado_em`, vinda do Pipefy). O nome do campo sempre foi enganoso; o cálculo de prazo da parcela 1 (regime "7 dias" ou "atribuição") já usava e continua usando `ganho_em` de propósito (regra confirmada 27/07/2026, não mexida aqui). Rodando o corte hoje: dos 72 contratos com Parcela 1 pendente, só 36 (50%) têm `entrada_contrato_assinado_em` preenchida.

**Decisão (confirmada com o usuário via pergunta direta):**
1. A lista principal da página passa a **ocultar por padrão** clientes com algo pendente mas sem `entrada_contrato_assinado_em` — não há base contratual pra cobrar a unidade ainda. Não mexe no cálculo de prazo/atraso em si (isso continua usando `ganho_em`, regra de 27/07 preservada).
2. Esses casos ficam visíveis via banner ("N clientes aguardando assinatura, R$X") com toggle "Mostrar aguardando assinatura" — não desaparecem, só saem do caminho por padrão.
3. Itens manuais (`fonte='manual'`, sem `contrato_id`) não passam por esse gate — quem adicionou manualmente já vouches pela validade.

**Implementação:** `contrato_assinado_em` (novo campo, não persistido — calculado em `listCacItensTodasUnidades` juntando `contratos.entrada_contrato_assinado_em` por `contrato_id`, sem migration) trafega em `ApuracaoCacItemComUnidade`. Frontend (`apuracao-cac-content.tsx`): helper `contratoAssinado()`, filtro `mostrarAguardandoAssinatura` (default `false`), banner de aviso, nova coluna "Assinatura do contrato" na tabela (badge amarelo quando pendente), coluna antiga renomeada de "Assinatura" pra "Venda ganha" (pra não mentir sobre o que o dado realmente é). KPIs (`vendido`/`recebido`/`aReceber`) agora refletem só o que está "disponível pra cobrar" por padrão, já que são calculados sobre `filtrados`.

**Validado:** `npx tsc --noEmit` limpo pros arquivos tocados (erros restantes no projeto são todos pré-existentes, não relacionados). `npm run dev` local subiu sem erro de SSR (`/unidades` respondeu 200). **Não testado logado como admin** (sem sessão disponível nesta sessão) — recomenda-se conferir visualmente antes de considerar fechado.

**Status:** implementado localmente, não commitado/enviado — aguardando o usuário revisar rodando `npm run dev` antes de decidir sobre commit/push (regra padrão: dev local antes de produção).

**Próximos passos:** se o usuário confirmar que gostou da mudança, considerar propagar a mesma distinção pro `CacTab` mais simples (`src/components/audit/cac-tab.tsx`), que hoje não faz nenhuma diferenciação entre venda ganha e contrato assinado.

---

## [2026-08-25] Nova página `/indicadores-trimestre` — indicadores do deck de Expansão por unidade

**Contexto:** os dois slides trimestrais do deck de Expansão ("Indicadores financeiros do trimestre" e "Performance comercial do trimestre") eram montados à mão a cada trimestre, a partir do Power BI "Mkt e Vendas – BUs" e de consultas avulsas. A página traz isso pro Ops Board para as 8 unidades regionais.

**Definições adotadas (régua oficial é o Power BI, não fórmula deduzida):**
- **Receita anualizada** = MRR das vendas do período × 12.
- **Receita bookada (LTV)** = MRR das vendas do período × **60** (lifetime fixo de 5 anos). Corrige a definição anterior (`MRR ativo ÷ churn`), que não é a que o deck usa. Confirmado contra Curitiba Q2/2026: R$19.820 → R$237.840 → R$1.189.200.
- **Inadimplência** cortada por `data_vencimento`, **nunca** por `data_competencia` — 233 títulos de Curitiba têm competência gravada mais de 60 dias depois do vencimento (dois deles com vencimento em 2021 e competência em fev/2026, sozinhos distorciam o mês inteiro). O indicador também só estabiliza ~60 dias após o vencimento; a página avisa quando o trimestre selecionado ainda não maturou.
- **Royalties + CSC** soma `csc_valor_fixo` **e** `csc_base_antiga_valor`: Patos grava a mesma taxa de 4% em colunas diferentes conforme o mês.
- **Base nova** = CNPJ com item não-excluído em **qualquer** apuração da unidade, menos os marcados como base antiga. Usar só a última apuração derruba cliente que simplesmente não pagou naquele mês (a apuração é por caixa) — em Curitiba isso descartava 6 clientes, incluindo uma das vendas novas do próprio trimestre.

**Arquitetura:** RPC `public.indicadores_trimestre(_ini, _fim)` (migration `20260825120000`) em vez de cálculo no cliente — `contas_receber` tem 28 mil títulos só de Curitiba. `SECURITY DEFINER` com guarda interna em `public.can('view.indicadores_trimestre')`: devolve zero linhas para quem não tem a permissão, sem depender do RLS das tabelas base (que hoje não segue `role_permissions` em várias delas). Permissão semeada para `admin` e `diretor` — `public.can()` não tem bypass de admin, sem a semente a página abriria vazia para todo mundo.

**Lacunas tratadas explicitamente na UI, nunca como zero:** São Luís e Fortaleza não têm nenhum título no Omie; Patos tem 124 títulos com `data_vencimento` nulo (modelo da unidade é planilha manual); Maceió só passa a ter Omie em jul/2026. Take rate de unidade em rampa sai marcado com asterisco — o CSC fixo domina uma base ainda pequena (Campo Novo dá 38%).

**Churn:** a página mede pelo faturamento (cliente da base nova cuja última fatura caiu no período) e mostra alerta quando isso diverge do pipe de Tratativas. A divergência é sistêmica, não pontual — Q2/2026: Curitiba 5 cards × 14 clientes, Belém 2 × 10, Campo Novo 0 × 5, RJ 0 × 2. **Contorno, não correção:** os cards continuam faltando no Pipefy.

**Fora de escopo:** card "Taxa de conversão do funil". Os negócios perdidos do Pipedrive não existem no Supabase e o Power BI já resolve com Leads/MQLs que não são atribuíveis por unidade no Pipedrive. Deixado de fora em vez de exibir um número por régua diferente da do deck.

**Validado:** planilha `~/Desktop/indicadores-trimestre-validacao.xlsx` (4 abas) conferida antes de escrever a UI — foi ela que pegou os dois bugs de fórmula acima. `tsc` e `eslint` limpos nos arquivos novos; dev local respondeu 200 na rota. **Não testado logado** (sem sessão disponível na sessão de implementação).

**Ajuste no mesmo dia (antes do deploy):** o comparativo da rede nasce **fechado**, atrás de um toggle, e só é renderizado para quem tem `view.network.benchmarks`. Motivo: a tela é usada para apresentar os números **para a unidade**, na reunião trimestral — ninguém deve abrir a página na frente de um franqueado e mostrar sem querer o resultado das outras praças. Mesma lógica da decisão de 11/08/2026 em `/rede-overview` (dados agregados de rede ficam fechados por padrão).

---

## [2026-08-26] CAC "boleto enviado" → "pago" automático via confirmação de recebimento

**Contexto:** fecha o ciclo inverso do vínculo CAC → Royalties de 24/08/2026 (`vincularRoyaltiesCac`, [cac.functions.ts](src/lib/cac.functions.ts#L666)). Hoje, marcar uma parcela de CAC como "boleto enviado" já joga o valor automaticamente na apuração de Royalties da unidade (`royalties_itens.is_cac=true`, somado em `royalties_apuracao.cac_valor`). Faltava a volta: quando o analista confirma manualmente na tela de Recebimentos ([financeiro-partners?tab=pagamentos](src/components/financeiro-partners/pagamentos-view.tsx)) que a categoria "CAC + Tráfego pago" (`cac_trafego`, em `royalties_apuracao_pagamentos`) foi paga integralmente, a parcela de CAC ficava presa em "boleto enviado" até alguém repetir a marcação manualmente na tela de CAC.

**Limitação de dado assumida:** a categoria `cac_trafego` é conferida no agregado unidade/mês contra o Omie (título único, sem abertura por cliente), somando CAC + Tráfego pago. Não existe forma de saber qual cliente especificamente pagou — só que o total bateu. A automação portanto marca **todas** as parcelas de CAC vinculadas àquela apuração de uma vez, não cliente a cliente.

**Decisão (confirmada com o usuário via pergunta direta):**
1. O gatilho é a confirmação **manual** do analista na tela de Recebimentos (marcar `status_validado = 'confirmado_pago'`) — não existe sync direto do status do Omie disparando isso; a conferência com o Omie continua manual, só a propagação pro CAC que passa a ser automática.
2. Se a confirmação for desfeita depois (correção de conferência), a(s) parcela(s) de CAC revertem sozinhas pra "boleto enviado" — mas **só as que a própria automação marcou**. Se alguém já tinha marcado a parcela como paga manualmente (antes ou depois do trigger), a automação não mexe nela.

**Implementação:**
- Migration [20260826120000_cac_auto_pago_via_recebimento.sql](supabase/migrations/20260826120000_cac_auto_pago_via_recebimento.sql): colunas `cac_apuracao_itens.pago_auto_parcela_1/2` (boolean, marca o que foi preenchido pela automação) + trigger `trg_sync_cac_pago_via_recebimento` em `AFTER INSERT OR UPDATE OF status_validado ON royalties_apuracao_pagamentos`. Ida: para cada `cac_apuracao_itens` linkada via `royalties_item_id_parcela_1/2` a um item `is_cac=true` daquela apuração, se a parcela ainda não tem `data_pagamento_parcela_X`, seta `data_pagamento_parcela_X = validado_em::date`, `valor_pago_parcela_X = valor_parcela_X` (não tem breakdown real por cliente vindo do Omie, usa o valor previsto) e `pago_auto_parcela_X = true`. Volta: reverte só onde `pago_auto_parcela_X = true`.
- [cac.functions.ts](src/lib/cac.functions.ts#L874) (`updateItemCac`): marcar/desmarcar pago manualmente na tela de CAC agora também zera `pago_auto_parcela_X` — tira a parcela da automação, pra uma reversão futura da confirmação de recebimento nunca apagar um pagamento confirmado à mão.

**Validado:** `tsc --noEmit` limpo no arquivo tocado. **Migration aplicada manualmente pelo usuário no SQL Editor do Supabase em 26/08/2026** (a chamada automática via Management API foi bloqueada pelo classificador de permissões da sessão — ação de escrita direta em produção — então o usuário colou e rodou o SQL). Confirmado depois via query de verificação: `pago_auto_parcela_1/2` existem em `cac_apuracao_itens` e `trg_sync_cac_pago_via_recebimento` está criado e ativo.

**Status:** migration aplicada e verificada em produção (26/08/2026). O ajuste em `cac.functions.ts` (`updateItemCac` zera `pago_auto_parcela_X` ao marcar/desmarcar pago manualmente) ainda está só no working tree local, **não commitado/enviado** — o trigger já funciona sem ele, mas sem esse ajuste um pagamento marcado manualmente depois do trigger agir pode ser apagado por uma reversão futura da confirmação em Recebimentos.

**Próximos passos:** testar o ciclo completo num caso real (marcar "boleto enviado" no CAC → conferir que caiu na apuração de Royalties → confirmar "pago" nos Recebimentos → conferir que a parcela de CAC virou "pago" sozinha) e, validado, commitar/enviar o ajuste de `cac.functions.ts`.

## [2026-08-26] `/indicadores-trimestre`: faturamento e take rate passam a sair da apuração de royalties

**Contexto:** o usuário conferiu o Rio no Q2/2026 e o card "Faturamento base nova" (R$ 1.924.338) não bateu com o que a unidade lê na apuração (abr 668.095 + mai 346.390 + jun 514.540 = R$ 1.529.024). Gap de 25,9%, acima do limite de conflito do `DATA-RULES.md`.

**Diagnóstico (não era bug de cálculo — eram duas réguas):** o card somava `contas_receber` por `data_competencia`, valor bruto; a apuração usa recebido líquido, por caixa, com ajustes manuais. Ponte do RJ: base apurada 1.529.024 → +356.651 de títulos que a apuração não contou ou cortou → 1.885.676 (recebido líquido) → +50.140 de retenção de imposto → 1.935.815 (bruto) → −11.478 de regime → 1.924.338. **90% do gap é a própria apuração, não regime nem imposto:**
- Junho: o sistema puxou R$ 809.763 do Omie, o apurador editou 26 itens para baixo e excluiu 13, fechando em 514.540 — clientes com 2 títulos compensados no mês (backlog de emissão de maio) ficaram com 1. Ex.: Concessionária Rodovia da Integração recebeu 253.395 e virou item de 126.697,50, exatamente metade.
- Abril (apuração 33): **100% manual**, 18 linhas sem vínculo com o Omie, incluindo uma linha literal `GENIAL (grupo, sem detalhe por CNPJ em jan–mai/26)` — retroativo de meses anteriores lançado dentro de abril.
- 10 clientes com R$ 215.965 recebidos no trimestre não têm item na apuração ou têm item zerado.

**Defeito real que isso expôs:** o take rate dividia numerador da apuração (royalties + CSC — caixa, líquido, ajustado) por denominador de competência/bruto. Duas réguas no mesmo percentual.

**Decisão:** `fat_base_nova` e `take_rate_pct` passam a vir de `royalties_apuracao` (meses `confirmado` dentro do período), a mesma fonte do numerador. `fat_total` = `receita_base` + `receita_base_antiga`. Escolhido pelo usuário entre 4 opções (as outras: recebido líquido por caixa via Omie, faturamento por vencimento, mostrar os dois lado a lado). O número passa a ser o que a unidade vê e assina na apuração — **inclui os ajustes manuais, e isso é intencional**: é a régua da conversa com a unidade.

**Efeitos (Q2/2026):** RJ 1.924.338 → 1.529.024 (take 9,52% → 11,98%); Curitiba 617.928 → 548.976 (12,85% → 14,46%); Belém 586.194 → 541.123 (17,62% → 19,09%); Campo Novo 69.842 → 64.837 (38,00% → 40,93%). **Patos, São Luís, Fortaleza e Maceió deixam de aparecer sem faturamento** — hoje ficam vazias por falha de join com o Omie ou por item de apuração sem CNPJ; agora exibem 377.300 / 26.707 / 19.192 / 50.914.

**Lacunas continuam explícitas, nunca como zero:** mês sem apuração confirmada não entra e o card fica em `—` com alerta; `meses_apurados` < 3 gera aviso de trimestre subrepresentado (São Luís, Fortaleza e Maceió têm 1 de 3). `data_competencia` sai de vez do cálculo de faturamento — `DATA-RULES.md` (25/08) já marcava o campo como inconfiável, e o RJ é caso extremo: abr 719.705 / mai 94.651 / jun 1.109.982.

**Não muda:** `clientes_base_nova`, churn, inadimplência e estoque continuam vindo do Omie — não são faturamento, e a apuração não tem CNPJ confiável em todas as unidades (Patos, Fortaleza e Maceió gravam item sem CNPJ, por isso o hint de clientes só aparece quando > 0). Efeito colateral pequeno e aceito: a contagem de clientes agora ignora título cancelado (Curitiba 94 → 92).

**Arquitetura:** migration `20260826140000_indicadores_trimestre_fat_base_apurada.sql` (`create or replace` da RPC, assinatura idêntica) + ajustes de gate/hint em `indicadores-trimestre-view.tsx`. `tsc` sem erro novo no arquivo alterado (15 erros pré-existentes em outros arquivos, idênticos antes e depois), rota respondendo 200 no dev local.

## [2026-08-28] Método IDU — painel de apuração trimestral por unidade

**Contexto:** a atribuição às unidades é hoje decidida por relacionamento, a reunião de acompanhamento não tem âncora numérica, não existe ranking que posicione as praças, e meta não batida vira cobrança à franqueadora. A metodologia foi desenhada fora do repo (ver `wiki/outputs/2026-08-metodologia-metas-trimestrais-unidades.md` em `~/Desktop/AI Projects`) e batizada de **Método IDU** — Índice de Desempenho da Unidade.

**Decisão — a régua:** nota de 0 a 100 por unidade e por trimestre, em quatro pilares com dois conjuntos de peso (madura a partir do 5º trimestre / ramp-up): Crescimento 30/50 (venda de novos clientes 20/40 + venda para a base 10/10), Retenção 35/15 (churn de MRR), Qualidade 25/25 (satisfação do cliente 15 + exposição de carteira 10), Gestão 10/10 (e-NPS). Atingimento é `realizado/meta` quando maior é melhor e `meta/realizado` quando menor é melhor; piso de 50% **zera** o indicador, teto de 120%, nota final limitada a 100. A nota converte em percentual do forecast: abaixo de 50 libera 0%, de 50 a 74 libera a própria nota, **75 é a linha de corte que libera 100%**, de 90 a 100 libera até 120%.

**Decisão — churn:** é **apenas o que está lançado no pipe de Tratativas** (`central_tratativas`). Unidade com carteira e sem card no período tem churn zero, não "sem dado". Inadimplência no Omie é sinal para o time de CS investigar e lançar — explicitamente **não** vira automação. Meta de churn da rede: **5%**, aplicada como default quando não há meta por unidade.

**Decisão — indicador sem meta sai do denominador.** Deliberado: força a meta a ser pactuada e registrada antes do trimestre, em vez de a régua inventar um número. Mesma regra vale para indicador sem dado.

**Decisão — ranking aberto. ⚠️ Isto reverte decisão anterior.** O usuário decidiu que todo franqueado vê a nota de todas as unidades, com nome. Isso contradiz a entrada de 2026-08-11 (`/rede-overview`) e o ajuste registrado para `/indicadores-trimestre`, onde o comparativo da rede nasce fechado atrás de `view.network.benchmarks` justamente para não expor as outras praças numa reunião. A decisão nova é mais recente e explícita, e foi implementada — mas as duas telas antigas continuam com o comportamento fechado. **Se a intenção for abrir a rede em todo lugar, essas duas telas precisam ser revisitadas.**

**Status:** implementado e validado no dev server local (`http://localhost:8080/idu`, HTTP 200, `tsc --noEmit` limpo nos arquivos tocados). **Não commitado nem deployado** — segue a regra de subir só local até o usuário pedir.
- Migration `supabase/migrations/20260828120000_idu_metas_e_apuracao.sql`, **já aplicada no Supabase de produção** (só criação: tabela `idu_metas`, funções `idu_slug`, `idu_indicadores_catalogo`, `idu_apuracao`, `idu_ranking`, `idu_pode_ver`; nada existente foi alterado).
- Permissões `view.idu` (admin, diretor, head, cs, socio_franqueado) e `edit.idu_metas` (admin, diretor) inseridas em `role_permissions` e registradas em `KNOWN_PERMISSIONS`.
- Arquivos: `src/components/idu/idu-view.tsx`, `src/routes/_authenticated/idu.tsx`, `src/lib/permissions.functions.ts`, `src/components/app-sidebar.tsx`, `src/integrations/supabase/types.ts` (tipos do `idu_metas` e das RPCs adicionados à mão, sem regerar o arquivo inteiro).

**Próximos passos:**
1. **Metas do Q4 por unidade.** Sem elas, só o churn pontua e o resto sai do denominador — a tela mostra o aviso de quantos indicadores estão sem meta. Editáveis inline na própria página por quem tem `edit.idu_metas`.
2. **Exposição de carteira está errada como está.** `auditorias_internas.oportunidades_valor + contingencias_valor` são valores de **estoque** (passivo fiscal acumulado do cliente), não fluxo do trimestre: o Rio de Janeiro dá 564% de exposição sobre faturamento e Patos de Minas acumula R$ 4,7M contra carteira de R$ 175k/mês. Além disso 55 das 86 auditorias estão sem `data_conclusao`. O indicador precisa de definição antes de valer 10 pontos.
3. **Satisfação do cliente não produz nota.** A rodada `2026-08` teve 257 envios e 3 respostas com `nps_recomendacao` preenchido. A função exige amostra mínima de 5 respostas por unidade; hoje nenhuma unidade atinge isso.
4. **e-NPS não tem fonte** — o indicador devolve sempre nulo e os 10 pontos ficam fora do denominador.
5. Ver também: `contratos.mrr` é o valor de **12 meses**; o MRR mensal é `contratos.mrr_mensal`. A função usa `mrr_mensal`. Qualquer relatório que use `contratos.mrr` como MRR está 12x inflado.

## [2026-09-03] E-mail transacional de acesso — link de senha, não senha em texto

**Contexto:** criar usuário em `/admin/usuarios` gerava uma senha aleatória, mostrava em tela e o admin repassava por WhatsApp/e-mail na mão. O "esqueci minha senha" da tela de login já existia no código desde sempre, mas o Supabase Auth estava **sem SMTP configurado** (`smtp_host: null`) e com `rate_limit_email_sent: 2` — ou seja, usava o mailer interno do Supabase, com 2 e-mails/hora e entrega não confiável para quem não é membro do projeto. Na prática a recuperação de senha estava quebrada.

**Decisão — a senha nunca trafega por e-mail.** O usuário escolheu explicitamente link de definição de senha em vez de mandar a senha em texto. O e-mail de boas-vindas traz o e-mail de login e um botão que leva a `/redefinir-senha` com token de uso único (`auth.admin.generateLink({ type: "recovery" })`). Motivo: senha em texto fica gravada na caixa postal para sempre e vaza junto com qualquer comprometimento do e-mail.

**Decisão — "Resetar senha" do admin virou "Enviar redefinição".** O botão não sobrescreve mais a senha da pessoa: dispara o mesmo link por e-mail e a senha atual continua valendo até ela cadastrar a nova. **Isto remove a capacidade de forçar uma senha** — o fallback para quem não recebe o e-mail é o link exibido em tela, com botão de copiar.

**Decisão — escopo é só o Ops.** O login do Growth criado na mesma tela continua com senha em tela (card "Credenciais geradas" intacto), porque é outro projeto Supabase.

**Arquitetura:**
- `src/lib/email.server.ts` — envio pela API HTTPS do SendGrid (`POST /v3/mail/send`), nunca SMTP (porta bloqueada em droplet DO, e aqui roda na Vercel de qualquer forma). Nunca lança: e-mail que não sai não derruba a criação do usuário.
- `src/lib/email-templates.ts` — HTML em tabela com estilo inline (o que sobrevive a Gmail/Outlook), logo em PNG servido pelo próprio domínio.
- `src/lib/admin-users.functions.ts` — `adminCreateUser` passa a enviar o convite; `adminResetPassword` foi substituída por `adminEnviarRedefinicaoSenha`.
- Env novas (já criadas na Vercel `ops-brain`, escopo production/preview/development, e no `.env` local): `SENDGRID_API_KEY`, `EMAIL_FROM=noreply@planningbrain.com.br`, `EMAIL_FROM_NAME=Planning Brain`, `APP_URL`.

**Config aplicada em produção no Supabase `ulgiochewwpmmssksqlw` (não é código, já está valendo):** SMTP do SendGrid (`smtp.sendgrid.net:587`, usuário literal `apikey`), remetente `noreply@planningbrain.com.br` pelo domínio autenticado, `rate_limit_email_sent` de 2 → 30/hora, `mailer_otp_exp` de 3600 → 86400 (o link do convite precisa durar mais que 1 hora), e os templates de recovery/magic link/confirmation reescritos em português com a identidade Planning.

**Status:** validado no dev server local (`http://localhost:8080`, módulos compilando, `tsc --noEmit` limpo nos arquivos tocados, lint do arquivo saiu de 41 para 38 erros pré-existentes de prettier). **Não commitado nem deployado** — segue a regra de subir só local até o usuário pedir. As env vars da Vercel só passam a valer no próximo deploy.

**Pendente:** teste ponta a ponta com envio real (criar um usuário de teste e conferir a chegada do e-mail) — não feito por ser ação externa que dispara e-mail de verdade.

## [2026-09-03] Escopo por unidade do sócio franqueado — vazamento no Contas a Receber e painel com fonte errada

**Contexto:** revisão da experiência do papel `socio_franqueado` (conta de teste com `socios.unidade = 'Rio de Janeiro'`) mostrou três defeitos independentes.

1. **Contas a Receber entregava a rede inteira.** A tela não tem nenhum recorte por unidade — o franqueado do RJ via R$ 41M recebidos, 30.875 faturas e o resumo linha a linha de Curitiba, Belém, Partners etc. A policy de SELECT de `contas_receber` (`Permission-based read`) também não tinha predicado de unidade: só checava `can('view.contas_receber')`. Filtrar na tela não resolveria, porque o dado seguiria acessível via PostgREST com o token do próprio usuário.
2. **Painel da Unidade com números errados.** MRR R$ 183.326 contra R$ 216.151 reais, "Clientes Ativos = 2" com 24 contratos ativos, e "NPS 1.3" com 4 notas em 20 pesquisas.
3. **Funil de Receita no menu, mas negado.** O item está fixo em `SOCIO_FRANQUEADO_GROUPS` sem gate de permissão, enquanto `view.funil_receita` estava `allowed = false` para o papel. Link morto.

**Decisão — Contas a Receber recorta na tela e na RLS.** UI filtra por `unitMatches` quando o usuário tem `data.scope.own_unit_only`, e o seletor de unidade vira um badge fixo. No banco, `contas_receber."Permission-based read"` ganhou `AND (NOT can('data.scope.own_unit_only') OR public.unidade_do_usuario(unidade))`. Duas funções novas: `public.norm_unidade(text)` (caixa/acento/espaço) e `public.unidade_do_usuario(text)` (compara com `current_user_unidade()`, aceitando os apelidos legados "Sudeste (RJ)"/"RJ"). Validado por simulação de JWT: o franqueado do RJ enxerga 1.295 linhas de uma unidade; admin segue com 30.875 de sete.

**Decisão — Painel da Unidade passa a ler a unidade do próprio contrato.** Três causas, três correções:
- O filtro `tipo_unidade = 'franquia'` em `empresas` e `contratos` escondia a maior parte da base: a coluna está vazia em 79 das 104 empresas do RJ (as que vêm da Omie não a preenchem). Filtro removido.
- O MRR era somado cruzando `contratos.pipedrive_deal_id` com `empresas.pipedrive_id`, e só 27 das 104 empresas do RJ têm esse id. Agora o recorte é por `contratos.unidade`, que está preenchida.
- "Clientes Ativos" contava `empresas.status_financeiro = 'ATIVO'`; esse campo é `SEM_AR` ou nulo em 22 das 25 linhas visíveis. Passa a contar contratos ativos (24).
- **`Number(null)` é `0`**: a média de NPS mapeava todas as pesquisas sem resposta como zero e passava no `Number.isFinite`. Com 4 notas em 20 pesquisas a média caía de 7,25 para 1,3. O card virou "Nota média (90d)" com denominador explícito ("4 de 20 pesquisas com nota") — é média de nota 0–10, não NPS calculado, e o rótulo antigo mentia.

**Decisão — Funil de Receita liberado ao franqueado, mas só da própria unidade.** `view.funil_receita` passou a `allowed = true` para `socio_franqueado` (aplicado direto em `role_permissions`); `FunilContent` recorta as linhas de `v_funil_mensal` antes de montar a lista de unidades, e o seletor de unidades some para quem tem escopo. A aba "Esperado × Recebido" sai do menu de abas para quem não tem `view.roas`/`view.auditoria`, em vez de abrir numa tela de "sem permissão".

**Status:** implementado no dev server local (`tsc --noEmit` limpo nos arquivos tocados). **Não commitado nem deployado.** As mudanças de banco (policy, funções, permissão do funil) **já estão valendo em produção** no `ulgiochewwpmmssksqlw` — migration em `supabase/migrations/20260903120000_contas_receber_escopo_unidade.sql`.

**Pendente — o mesmo vazamento continua em `contratos`, `empresas`, `nps_pesquisas` e `central_tratativas`.** As quatro têm policy só por permissão de página, sem predicado de unidade, e o franqueado tem `view.clientes`/`view.painel_cs`. As telas recortam no cliente (`/clientes`, `/painel-cs`, `/nps` usam `scopedToOwnUnit`), então não vaza na interface — mas vaza na API. Efeito visível: `v_funil_mensal` é `security_invoker`, então o franqueado ainda lê o MRR contratado das outras unidades por ela, mesmo com faturado/recebido já zerados pelo recorte de `contas_receber`.

**Pendente — `italo.amaral@grupoplanning.com.br` tem o papel `socio_franqueado` e nenhuma linha em `socios`,** logo `current_user_unidade()` devolve nulo e ele passa a ver zero linha em Contas a Receber (antes via a rede toda). Precisa ser vinculado a uma unidade.

## [2026-09-14] Os três produtos continuam três aplicações, com casca única

**Contexto:** depois do corte do banco único, o usuário apontou que Ops, Growth
e Financeiro "parecem 3 sistemas diferentes". A causa não era o menu: eram três
molduras (lateral no Ops e no Financeiro, barra no topo no Growth), três fontes
(Poppins, Geist, Inter por fallback) e três paletas.

**Decisão:** unificar a casca, não o código. Os três seguem como aplicações
separadas, com repositório, build e deploy próprios; o que fica igual é a
moldura: barra lateral esquerda, trocador de produto, paleta da marca, fonte
Poppins, estado do menu e preferência de tema compartilhados por cookie.

**Alternativa recusada — fundir tudo num app só.** Medido antes de decidir:
163 mil linhas em três frameworks. Ops em TanStack Start com 51 rotas, Growth
em Next.js App Router com 25 páginas (23 delas server components) e 28 rotas de
API, Financeiro em Vite + React Router com 12 rotas. Portar o Growth significa
reescrever todos os server components e as rotas de API; são ferramentas que 15
pessoas usam diariamente, e o porte troca o motor com o carro andando. O ganho
restante seria só o recarregamento ao trocar de produto, que a casca idêntica já
disfarça quase por completo.

**Se o recarregamento incomodar depois**, a ordem de custo é: pré-carregar o
outro produto ao passar o mouse (meia hora), embutir por iframe com o app de
dentro escondendo a própria lateral (traz problema de link direto e de botão
voltar), e só então fundir — começando pelo Financeiro, que é o mesmo React e
são 12 rotas. O Growth só com um motivo além da estética.

**Consequência prática:** cada produto mantém o seu ambiente de teste. Não
existe uma homologação que cubra os três a menos que o `vercel.json` do branch
de homologação do Ops aponte para os endereços de branch dos outros dois.

## [2026-09-14] Emissão das faturas da apuração no Omie da Partners

**Contexto:** fechada a apuração do mês, alguém abria a conta Omie da Planning
Partners e digitava as ordens de serviço uma a uma. O histórico mostra o custo
disso: em 11/08/2026 saíram 5 OS manuais para a competência de julho (Belém
19.836,00 de royalties e 1.803,39 de outras receitas, Campo Novo 5.524,00 e
2.536,00 de CAC, São Luís 2.508,00 e 420,36), e em 14/09 mais três de Patos e
São Luís. Nenhuma com código de integração, nenhuma registrada em lugar nenhum:
a única trava contra cobrar a unidade duas vezes era a memória de quem fazia.

**Decisão:** botão "Emitir faturas no Omie" na aba Royalties de `/unidades`,
com diálogo que pergunta a data de vencimento do boleto e mostra, antes de
qualquer escrita, o que vai e o que não vai.

**Escopo da fatura (decisão do usuário):** royalties, CAC e outras receitas.
**CSC fixo e reembolso de tráfego pago ficam de fora** — os dois já são
emitidos pela `csc-faturamento-mensal` com os códigos `SIGLA-CSC-MMYYYY` e
`SIGLA-MIDIA-MMYYYY`, e incluí-los aqui cobraria a unidade duas vezes pela
mesma coisa. É o erro mais caro possível nesta tela, e por isso está no
comentário de topo dos três arquivos.

**Uma OS por unidade, um item por natureza,** cada item com a sua categoria
gravada em `cCodCategItem`: royalties no serviço 1906814347 (`1.01.95`), CAC no
2246218440 (`1.01.92`), outras receitas no 1868191225 (`1.01.99`). Mandar
`cCodCateg` só no cabeçalho não resolve — o item sobrescreve com a categoria
padrão do cadastro do serviço, que foi como 9 de 10 OS nasceram na categoria
errada no ciclo de agosto do CSC.

**Idempotência em duas camadas, porque uma só não cobre o passado:**
1. `ops.royalties_faturas` com `unique (competencia, unidade_id)`;
2. varredura no Omie antes de criar, que é o que enxerga o que foi digitado à
   mão e portanto não tem código de integração nosso. A competência sai do
   `cDadosAdicNF` por regex (os dois formatos em uso na conta: `REF: 07/2026` e
   `Referente|06/2026| ||`) e a natureza, da categoria do item.

Conferido contra dado real antes de entregar: simulando julho/2026, a varredura
marcou Belém, Campo Novo e São Luís como "já no Omie" apontando as OS 265, 259,
262 e 264, todas sem `cCodIntOS`. Simulando agosto/2026, nenhuma unidade cai
nessa trava (só CSC e mídia foram emitidos), e o lote fica em R$ 97.705,10.

**Três modos na Edge Function, nunca um clique só:** `simular` não escreve nada
(nem no Omie, nem no nosso banco) e é o que roda ao abrir o diálogo; `criar`
inclui a OS na etapa 50 sem gerar financeiro; `faturar` chama `FaturarOS` em
`servicos/osp`, que gera nota de débito, título e boleto. A tela usa simular e
faturar; `criar` fica para depuração.

**Parâmetros do Omie reaproveitados de `csc_unidades`** (cliente, projeto,
departamento, conta corrente, vendedor e destinatários) em vez de uma tabela
nova: corrigir um e-mail passa a consertar os dois faturamentos de uma vez.

**Status:** implementado e conferido com `tsc --noEmit` (zero erro nos arquivos
novos; os 14 do repo são anteriores e estão em outros arquivos) e `vite build`.
A Edge Function está publicada no banco único; a tela ainda **não** foi para a
main. Arquivos: `supabase/functions/royalties-faturamento/index.ts` e
`migrations/52_royalties_faturamento.sql` (no repo do wiki),
`src/lib/royalties-faturamento.functions.ts`,
`src/components/royalties/emitir-faturas-dialog.tsx`,
`src/components/royalties/apuracao-royalties-content.tsx`.

**Correção no mesmo dia, apontada pelo usuário ao ver o botão na tela:** ele
perguntou se, tendo só Belém fechada, o clique emitiria só Belém. Não emitiria.
A rotina somava os itens conferidos de cada unidade sem olhar o status da
apuração, então oferecia seis unidades pré-marcadas em agosto, todas em
rascunho, incluindo o Rio com R$ 61.460,81. **Agora só entra apuração em
`confirmado` ou `faturado`**; rascunho e `em_revisao` aparecem como "não
fechada", com o valor à vista para conferência mas sem checkbox. Rascunho ainda
muda de número, e nota emitida não muda. Conferido depois da mudança: com Belém
fechada às 14:50, a simulação de agosto passou a oferecer só Belém, R$
14.808,06.

A segunda pergunta dele — se, ao fechar outras unidades depois, Belém sairia de
novo — já estava coberta, e por duas camadas: a linha em `royalties_faturas`
volta como `ja_registrada`, e mesmo sem ela a varredura acharia a OS de Belém
com categoria 1.01.95 e `REF: 08/2026` no Omie.

**Pendente:** o botão só aparece em mês fechado (mês em andamento ainda recebe
recebimento). A varredura lê todas as OS da conta a cada simulação (274 hoje, 6
páginas) — se a conta crescer muito, vale filtrar por cliente na API.

---

## [2026-09-14] Módulo Gente: fica dentro do Ops, sem subdomínio, e a Matriz só vê agregado

**Contexto:** o Qulture.Rocks custa R$ 2.191/mês e cobre 4 das 8 unidades regionais. O export da ferramenta (215 pessoas, 55 colunas) mostrou que as 4 que usam são exatamente as 4 inauguradas antes de 2026, e as 4 de fora são todas de 2026: ninguém decidiu não adotar, as unidades novas nunca foram incluídas. Isso tirou "adesão" do problema e recolocou o projeto como três trilhas separadas, registradas em `PLANO-GENTE-REDE.md` no repo do wiki.

Com 215 pessoas, o preço real é **R$ 10,19 por pessoa/mês**, e chegar a 100% da rede custaria entre R$ 37 mil e R$ 43 mil por ano. Isso é menos que o tempo de engenharia de construir e manter o equivalente, então **custo deixou de ser razão para construir**. O que justifica é integração: ligar desempenho a IDU, churn, NPS e royalties, que o Qulture nunca vai fazer.

**Decisão:**

1. **Gente é módulo do Ops, não produto novo, e não ganha subdomínio.** Reafirma a Decisão 1 e 1-B do `PLANO-PLATAFORMA-PLANNING-BRAIN`: a organização é por path, e "subdomínio não é uma opção". As razões específicas aqui: o valor do módulo é cruzar com dado que vive no mesmo schema `ops`; a RLS que isola unidade depende do `auth.uid()` da mesma sessão, então outra origem exigiria replicar credencial ou montar um segundo fluxo de login; e mais um projeto na Vercel é mais um build e mais uma variável para errar. Se um dia virar produto grande, o caminho é `planningbrain.com.br/gente`, por path.

2. **Separar público é problema de permissão e de rota de entrada, não de DNS.** `view.gente` é chave própria, e quem só tem ela deve cair direto em `/gente` no login.

3. **A Matriz vê agregado por unidade, não nota nominal.** Daí `view.gente.agregado` ser chave separada de `view.gente.individual`. `admin`, `diretor` e `head` têm agregado e **não** têm individual; `socio` e `socio_regional` têm individual, sempre recortado pela própria unidade. A razão é de governança e de LGPD: quem é avaliado é empregado da unidade, não da Partners.
   **Ressalva que precisa sobreviver a esta entrada:** `manage.gente` dá leitura nominal do **cadastro**, de propósito, porque quem administra precisa ver as pessoas. A separação individual x agregado vale para **nota de desempenho**. A policy das tabelas de nota **não pode** repetir `or can('manage.gente')`, senão a Matriz volta a ver nota nominal pela porta dos fundos.

4. **Escopo de unidade em RLS é policy RESTRICTIVE separada, uma por tabela.** Policies `PERMISSIVE` se combinam por OR, então trava embutida em policy de leitura não trava nada: basta uma policy futura liberar. `contas_receber` tem esse defeito hoje; `omie_clientes` faz certo. Testado: sócio de Belém vê 68 de 215 linhas, e **continuou vendo 68 mesmo com uma policy `using (true)` adicionada**.

5. **O isolamento não é reimplementado no TypeScript.** A server function faz `select` simples e quem recorta é a RLS, porque o middleware usa a publishable key com o Bearer do usuário. Uma regra só, no banco, em vez de duas que podem divergir.

**Status:** parcialmente implementado. Migration `53_gente_cadastro.sql` (no repo do wiki) aplicada no banco único com `gente_pessoas`, `gente_cargos`, `minhas_unidades_gente()`, `e_gestor_de()`, `v_gente_por_unidade` e as 4 chaves; 215 pessoas e 196 vínculos de hierarquia carregados. Tela `/gente` com cadastro, agregado por unidade e filtros.

**Próximos passos:** o módulo hoje é **só o cadastro**. As funcionalidades que substituem o Qulture (1:1, feedback contínuo, pesquisa de clima/eNPS e ciclo de avaliação) são a trilha C e não existem. Antes delas, duas coisas: a trilha A, que atinge 100% de adesão cadastrando Campo Novo, São Luís, Fortaleza e Maceió no Qulture sem construir nada; e o portão de adesão ao Ops, já que nenhum dos 34 sócios das unidades regionais entra na plataforma hoje.

---

## [2026-09-14] Receitas Partners vira cinco páginas irmãs sob /unidades

**Contexto:** `/unidades` juntava cinco telas em abas (`?tab=regras|royalties|historico|cac|split`). A fusão fazia sentido quando a lateral era uma lista única de 35 links: ali, cinco entradas seguidas de royalties empurravam o resto da operação para fora da tela. Depois que o menu passou a mostrar uma área por vez, a economia virou custo: Split e Histórico só existiam para quem já soubesse abrir "Receitas Partners" e procurar dentro. Tela escondida dentro de tela não aparece em busca, não é favoritável por nome e não tem título próprio.

**Decisão:** cada aba vira página com caminho próprio, todas sob o mesmo tronco para a família continuar legível na URL.

1. `/unidades` (Regras da Rede), `/unidades/royalties`, `/unidades/historico`, `/unidades/cac`, `/unidades/split`. O tronco `unidades.tsx` é só `<Outlet />`; o conteúdo já morava em componentes separados (`RedeContent`, `ApuracaoRoyaltiesContent` e companhia), então o desmembramento foi de roteamento, não de lógica.

2. **As URLs antigas continuam de pé.** `/unidades?tab=X` redireciona para a página nova, e `?tab=regras` perde o parâmetro para não deixar dois endereços equivalentes circulando. Os redirects que já existiam de `/rede`, `/royalties` e `/royalties/split` passaram a apontar direto para o destino final, sem escala no `?tab=`.

3. **As chaves de permissão não mudaram.** `view.unidades_rede` continua cobrindo Regras, Royalties e CAC; `view.royalties_historico` e `view.royalties_split` seguem sozinhas nas suas. Desmembrar a navegação sem mexer em acesso mantém idêntico o que cada perfil enxerga hoje, e evita uma migration de concessão só para acompanhar uma mudança de menu. Se um dia fizer sentido separar quem vê Regras de quem apura, aí sim vale chave própria: a UI já está pronta para isso.
   Em compensação, quem não tem a chave agora encontra a tela dizendo qual permissão falta (`GuardaUnidades`), em vez de uma aba que some sem explicação. Com URL própria a pessoa consegue chegar lá digitando.

4. **O grifo da lateral passou a ser do caminho mais específico**, não de todo prefixo que casa. Com filhas sob `/unidades`, o critério antigo acendia "Regras da Rede" junto com "Split do Asaas": dois itens marcados e nenhum respondendo onde a pessoa está. O mesmo defeito existia em `/broker` x `/broker/admin` e foi corrigido junto.

5. **Validação de página é herdada pelo caminho pai.** `PAGE_DEFS` continua com uma entrada só para `/unidades`, e `useIsPageValidated` procura o prefixo mais longo quando não acha a chave exata. Sem isso, as quatro páginas novas nasceriam todas com o aviso de "dados em validação" no dia do desmembramento, denunciando um problema que não existe.

**Status:** implementado e buildando. Falta subir: o código está no dev local, conforme a regra de validar antes de ir para a main.

---

## [2026-09-15] Permissão é por área, e o filtro de unidade/empresa é por pessoa

**Contexto:** a matriz tinha 66 chaves por 10 papéis, e crescia uma linha a cada
página nova. Ninguém respondia "o que o CS enxerga?" sem ler 66 caixinhas. Pior,
a lista tinha furado: 7 chaves exigidas por policy (`manage.gente.avaliacao`,
`view.gente.avaliacao`, `manage.gente.clima`, `view.gente.clima`,
`view.csc_faturamento`, `edit.csc_faturamento`, `view.qualidade_base`) nunca
entraram em `KNOWN_PERMISSIONS`, então eram invisíveis na tela e impossíveis de
conceder. Três delas não tinham grant em papel nenhum, o que deixava
`csc_ciclos`, `csc_unidades`, `base_antiga_unidades` e `qualidade_base_historico`
ilegíveis para todo usuário logado. Ninguém tinha percebido porque a tela
simplesmente abria vazia.

**Decisão:** dois níveis. O **papel** abre **áreas**; a **pessoa** tem **escopo**.

1. **A área é a unidade de concessão, e libera tudo dentro dela.** Sem exceção
   por ação sensível. São 10 áreas, 8 delas as do menu.

2. **As 66 chaves não somem: viram ponte.** `ops.area_chaves` diz a que área
   cada chave pertence, e `ops.can()` passa a responder pela área. As 96 policies
   de RLS que falam em chave **não foram tocadas**. Reescrever 96 policies num
   banco com 24 pessoas trabalhando seria 96 chances de errar por um ganho de
   legibilidade que ninguém vê, e a ponte entrega o mesmo resultado mudando uma
   função. Efeito colateral bom: **página nova não precisa mais de chave nova**,
   herda a área em que mora, e a tela de admin para de crescer.

3. **Duas áreas existem por fronteira de confiança, não por menu.**
   `broker_matriz` porque a Matriz mostra multiplicador e composição de CAC, que
   são camada interna; e `minha_unidade` porque o sócio regional precisa de
   Contas a Receber sem levar comissões, EBIT e DRE Partners junto. "A área
   libera tudo" só é seguro quando a fronteira da área coincide com a de
   confiança. `minha_unidade` também absorveu `SOCIO_REGIONAL_GROUPS`, que era
   uma lista fixa em `app-sidebar.tsx` cujos itens **não declaravam permissão
   nenhuma** e apareciam sempre.

4. **Escopo é do usuário, não do papel**, em duas dimensões: unidade da rede
   (11) para o Ops e empresa do grupo (17) para o Brain Financeiro. Dois
   analistas com o mesmo papel cuidam de unidades diferentes, então isso nunca
   coube no papel. `todas_unidades` e `todas_empresas` são flags **explícitas**:
   ausência de linha fecha, não abre, para que um backfill esquecido falhe
   fechando.

5. **A tradução para o cockpit é conservadora.** A navegação do Financeiro é por
   grupo de apuração, não por empresa. A pessoa só recebe o escopo `BPO` quando
   tem **todas** as empresas ativas do grupo. Ter uma empresa não abre o grupo.

**Isto substitui o item 3 da decisão de 14/09** (Módulo Gente), que separava
`view.gente.individual` de `view.gente.agregado` para que a Matriz visse nota
agregada e não nominal, por LGPD. Com a área liberando tudo, quem tem Planning
People vê nota nominal, e `diretor`, `head` e `socio` passaram a ver. O usuário
foi avisado do conflito antes de decidir e reafirmou. O que sobrevive daquela
decisão é o **escopo**: o sócio regional continua vendo só a própria unidade,
agora pela tabela de escopo em vez da policy amarrada em
`data.scope.own_unit_only`.

**O que a simplificação alargou**, medido antes de aplicar: `cs` (3 pessoas) e
`auditor` (2) passaram a ver Receita inteira, com comissões, DRE Partners, EBIT e
despesas de C&M; `head` (1) idem, mais `manage.gente`; `diretoria_comercial` (2)
passou de uma chave para a área Clientes inteira, com NPS, disparos e churn.
Conferido usuário a usuário depois do corte: **ninguém perdeu acesso**, e as 4
tabelas ilegíveis voltaram a abrir.

**Status:** Fases 1 e 2 aplicadas. Migration `20260915100000_permissoes_por_area`
(em 3 partes), rollback em `supabase/rollback/`. `ops.role_permissions` ficou
intacta e deixou de ser consultada: é o retrato para voltar atrás, e voltar é
restaurar a versão antiga de `ops.can()`.

**Pendente:** a Fase 3, que é `sessoes-irmas.functions.ts` parar de montar o
escopo do cockpit a partir de `role_permissions` e passar a ler
`ops.usuario_empresas`. Enquanto isso não acontece, os 8 usuários do papel
`financeiro` seguem recebendo os 8 escopos pela tabela antiga, que é o
comportamento de hoje. E a Fase 4, tirar `data.scope.own_unit_only` das 8
policies em favor de um nome honesto.


## [2026-09-15] Aquário em Clientes; operação e análises dentro de Monetização

**Contexto:** Pedro pediu incorporar o painel Caixa de Oportunidade e as análises estudadas no Growth ao Planning Brain. A orientação final coloca as carteiras e listas do Aquário dentro do módulo Clientes. Há autorização explícita para publicar na Vercel, usar o acesso central de Pedro e Matheus e enviar somente oportunidades selecionadas e validadas.

**Decisões:**

1. Clientes → `/aquario` reúne carteiras por unidade, ficha da empresa, segmentação, sobreposição Consultoria/Finance, gates da base e listas compartilhadas para sócios. Monetização → `/monetizacao` reúne Operação, Temporal e previsão, Capacidade e alocação, Follow Day, Funil, Pessoas/PDI, Abordagens e Distribuição. Nada é iframe nem depende de senha adicional.
2. Tabelas e funções `ops.monetizacao_*` vivem exclusivamente no Brain unificado (`npknehhyyzelmrbbxvtu`). A reconciliação inicial é preservada por chave técnica; novos cadastros do Ops entram por ID, com vínculo por CNPJ/Pipefy exatos e fila de divergências. Nunca conciliar por semelhança de nome. Quantidade de registros conciliados não declara quantidade de clientes ativos pagantes.
3. As carteiras são leitura da área Clientes. A preparação/validação de listas e o envio ao CRM permanecem na área Monetização, com escopo por pessoa; não ampliar automaticamente os papéis de Clientes para operar a monetização. Esta é a fronteira entre consulta da carteira e operação central, preservando a autorização reservada. Uma primeira proposta de ampliar a edição para Clientes foi rejeitada na revisão automática e retirada; não reintroduzir por acidente.
4. Finance segue contrato ganho identificado no Pipedrive + faturamento anual abaixo de R$ 25 milhões + fora do Simples/MEI. Não há novo piso, requisito de contato/CNPJ ou gatilho de demanda. Consultoria é a prioridade das carteiras: Lucro Real e segmentos do perfil; faturamento é validado com o sócio, sem novo piso. Contato é filtro, não veto. Faixas desconhecidas, atravessando o limite ou divergentes ficam para conferência. As ofertas dos produtos se sobrepõem; não somar os produtos como clientes distintos.
5. O produto canônico é `Caixa · Produto`, chave `0646513ee16829605c0af8b15b415ebf05beb6c5` (1128 Cella; 1129 Consultoria; 1130 Finance). Não inferir pelo título. Oportunidade validada é a primeira entrada em Negociação ou etapa normal superior, inclusive salto direto; Reciclado não valida. Movimentos são atribuídos ao ator no histórico, não ao dono atual. Datas usam São Paulo e filtro personalizado.
6. Receita prevista total, Partners e unidade usam os três campos monetários próprios do CRM. Nulo não vira zero, moedas diferentes não são somadas, valores divergentes ficam para preenchimento. Não há rateio inventado nem divisão por 12. Metas e taxas de planejamento são hipóteses explícitas e editáveis; não herdar conversão/elasticidade de Growth como resultado observado de Monetização.
7. Envio exige lista salva, revisão vigente, validação registrada e seleção explícita. Reserva única por empresa/produto previne duas listas concorrentes. Timeout remoto fica como incerto, conciliado pelo identificador `[AQ:uuid]`, sem repetir POST. O sync roda a cada 5 minutos, a tela refaz a leitura a cada minuto e após uma mutação. Testes não criam oportunidades reais no CRM.
8. PDI e abordagens são registros operacionais editáveis, com evidência disponível; não são apresentados como análise de IA de reuniões que não foi executada. As análises temporais e de coorte calculam os denominadores e a mediana/p90 do histórico observado.

**Status:** implementação nativa e migrations aplicadas. Primeira carga conciliada: 128 cards; 1.683 registros da auditoria inicial, mais 81 cadastros novos do Ops e um vínculo por identidade (1.764 registros, não declaração de clientes pagantes). Testes de regras (15) e RLS/revisão/reserva em transação passaram. Build de revisão Vercel `dpl_8hMAU1uFRzWMgGfCZu36AL1VRb6e` Ready; publicação final será registrada em entrada própria após verificação. Identidade de Matheus no login central pendente de confirmação: o e-mail do CRM ainda não tem conta em `auth.users`; não foi enviado convite nem criada senha.


## [2026-09-15] Publicação da integração e conferência no domínio

**Status:** versão `81ecd67` publicada em `planningbrain.com.br` pelo deploy Vercel `dpl_B3b2xCaPXRwCBYya7XtSj3TUyxCq` (promoção autorizada, build Ready). `/aquario` está no módulo Clientes; `/monetizacao` no módulo Monetização. Verificadas no Chrome com a sessão existente de Pedro: navegação de Clientes, carteira lateral de Belém, ficha da empresa com fontes/contatos e preparação da lista para sócio, sem salvar lista de teste nem enviar oportunidade. Rotas do domínio respondem 200; endpoint de envio sem login responde 401. Carga corrente confirmou as 15 validadas de Matheus em 01–14/09. Sync v6 reaproveita históricos inalterados e os relê integralmente no máximo a cada 24h ou quando etapas/cadastro do negócio mudam; a contagem continua conciliada em toda rodada.

**Conferência visual:** a situação do CRM diz “Sem card aberto ou carga no mês”; ela não deve prometer elegibilidade de produto. Esta depende dos gates de perfil ao lado. Capacidade considera o mês completo da alocação, independentemente do intervalo diário selecionado.

**Repositório:** PR https://github.com/planningbrainbot/revenue-auditor-hub/pull/2 aberto. A revisão automática rejeitou push direto para `main`; aguarda autorização específica para merge. A publicação autorizada na Vercel foi feita separadamente sem alterar `main`. Até incorporar o PR, uma publicação de uma main antiga pode remover estas rotas. Não presumir que o deploy e a branch padrão já estão alinhados.


## [2026-09-15] Metas preservadas e ajuste final da publicação

**Decisão:** as metas já informadas para setembro foram preservadas via interface autenticada: Matheus, 120 leads/mês, teto de 60 reuniões/mês, 8 contratos/mês e 7 leads/dia útil. O plano está salvo no banco central. A alocação por produto permanece não definida (zero alocado, 120 vagas para distribuir), e as hipóteses de conversão são nulas. Os oito contratos continuam sendo meta, nunca previsão automática a partir de um mix de ofertas que não foi trabalhado.

**Status:** ajuste final de disponibilidade e período mensal (`b568aec`) publicado pelo deploy Vercel `dpl_9Tmj2RjFA7BDW1MPLNuECSiibHT9`, build Ready. A conferência de interface não salvou lista fictícia nem enviou negócio: contagens de listas/envios permanecem zero. A última carga consultada em 15/09 às 11h55 (São Paulo) concluiu sem erro. Os testes de domínio seguem 15/15. A conferência visual da carteira, ficha, preparação de lista e salvamento das metas foi concluída; o Computer Use perdeu a janela do Chrome antes de uma rodada completa das demais análises, que têm build e rotas conferidos.

**Pendências externas:** PR #2 aguarda a autorização de merge solicitada após rejeição do push direto pela revisão automática. O e-mail de login central de Matheus ainda aguarda confirmação. Nenhuma senha paralela ou convite foi criado. O painel independente antigo não foi redirecionado nesta publicação; as rotas oficiais integradas são `/aquario` e `/monetizacao` do Planning Brain.


## [2026-09-15] Três listas de produto e forecast comparado ao realizado

**Decisões:** o Aquário oferece entradas explícitas para Cella, Consultoria e Finance. Os números distinguem perfil aderente de disponibilidade atual, por conta/produto. Consultoria permanece a primeira opção das unidades. Contas aderentes a mais de um produto aparecem nas respectivas listas e no indicador de sobreposição. Uma lista geral pode ser preparada para qualquer produto por quem já tem escopo geral; as checagens de escopo por conta, revisão e validação continuam no servidor.

**Envio:** Registrar validação grava a aprovação; o envio exige selecionar os itens e confirmar o passo seguinte. O servidor preenche Caixa · Produto (1128/1129/1130), relê o negócio criado e só confirma o envio quando o valor canônico confere. Se a leitura ou o produto não forem confirmados, preserva o ID e a reserva como incertos. A conciliação agendada também verifica o produto, além do identificador único.

**Forecast:** a última planilha mensal localizada é a v10 de 09/09/2026, idêntica à versão em Downloads. A revisão v11 de 10/09 contém gates e declara o forecast ainda não pronto. A pesquisa no Drive conectado não encontrou outra planilha da frente. A comparação usa a v10 como referência histórica explícita, preservando as 44 linhas mensais e 12 meses, sem transformar seu mix em previsão operacional atual. O XLSX não tinha cache: o importador avalia somente as fórmulas suportadas e confere os valores de setembro/outubro e as identidades de trabalho, contratos, receita, caixa e margem em todos os meses. Os valores, fórmulas e hash de origem ficam em ops.monetizacao_forecasts no Brain unificado, com RLS da Monetização e escopo geral. O realizado usa o histórico do CRM até a última carga; futuro é nulo, não zero. A comparação é de toda a frente e por mês, sem aplicar o filtro pessoal da daily. Receita contratual prevista não é comparada ao caixa do modelo como se fossem a mesma medida.

**Acessos individuais:** Pedro nomeou matheus.carvalho@planning.com.br e jordana.vieira@planning.com.br. Jordana já existia e preservou seus papéis, produtos e escopo. Matheus foi criado no login central, sem envio de email; pode definir sua senha pela recuperação do próprio login. Ambos receberam o papel específico de Clientes/Monetização, sem administração ou novas áreas financeiras. Matheus ainda não tem unidades liberadas: sua concessão de escopo geral ficou pendente da confirmação exigida pela revisão automática. A interface identifica ausência de carteiras autorizadas, em vez de apresentar zero como tamanho da base.

**Alteração de área pendente:** Pedro também pediu que todo usuário que acessa a aba possa enviar ao pipe. A revisão automática rejeitou o script combinado de alteração global de area_chaves, criação de usuário e concessão de escopo geral, por considerar esse alcance além da concessão individual. Foi solicitada confirmação explícita do alcance. Até a resposta, somente os acessos individuais foram aplicados, preservando os escopos existentes. A proposta global está em supabase/proposals/20260915150000_monetizacao_acesso_produtos.sql, fora das migrations executáveis, e não foi aplicada. Seu teste transacional passou com ROLLBACK, incluindo acesso por área, isolamento de unidade, envio sem validação, revisão e reserva única.

**Validação:** 17 testes de domínio passaram; ESLint dos arquivos alterados sem erros; TypeScript não apontou erro novo em Monetização (persistem os erros anteriores de outras telas). Integração CRM v7 e tabela/referência do forecast aplicadas. A publicação web será registrada após confirmação da Vercel. Nenhum negócio de teste criado no Pipedrive.

## [2026-09-15] Publicação das listas dos três produtos e do comparativo

**Status:** commit de aplicação `940bedb`, incluindo a main até `2a93602`, publicado no domínio `planningbrain.com.br` pelo deploy `dpl_7KsBaGoUpPStEztwsv2zoF4cH51S` (Ready, promoção concluída). Conferência no Chrome autenticado: Projetado × realizado carregou setembro com 61 trabalhos, 18 reuniões, 16 validadas e 0 assinados, para toda a frente; outubro mostrou realizado ausente e 16 contratos projetados. O Aquário mostrou as três entradas de produto, 62/45/144 perfis aderentes (Cella/Consultoria/Finance) e disponibilidade 22/45/113 no instante da consulta. Preparar lista a partir de Cella abriu rascunho com Cella e unidade inferida, sem salvar nem enviar. O rascunho de conferência foi descartado por navegação e o comparativo ficou aberto para o usuário. A comparação não alterou a fonte XLSX; o arquivo de Downloads e o do repositório têm hash idêntico.

**Pendente:** a confirmação de escopo/ampliação dos acessos ainda não chegou. Jordana está habilitada para Clientes/Monetização com o escopo de rede preexistente; Matheus está cadastrado e habilitado para os módulos, sem carteira liberada até a aprovação do escopo. A proposta de ampliar o envio para todos que acessam Clientes permanece fora das migrations. Nenhum email foi enviado. PR #2 atualizado, sem merge na main por este trabalho.


## 2026-09-16 — Integração do Aquário na main

- A publicação automática da main não continha as rotas do Aquário e da Monetização, que permaneciam em um PR aberto.
- Integração reconciliada com a main atual, preservando as alterações de navegação e permissões de Financeiro da Unidade.
- Inclui as melhorias de apresentação do forecast e os ajustes de acesso já implementados: envio pelo Resend no servidor e redefinição de senha confirmada pelo usuário.
- Nenhuma credencial, lista de destinatários ou resultado operacional é incluído nesta atualização.
- Validação: testes de Monetização, e-mails e recuperação; build Vercel concluído; rotas de produção verificadas.


## 2026-09-16 — Recon no Aquário, antes da revisão de Consultoria

- Regra confirmada pelo usuário: faturamento anual estritamente acima de R$ 5 milhões e exclusão de qualquer BPO, incluindo contábil, fiscal, folha e financeiro. Contato e regime não são vetos adicionais. Faixas que atravessam o corte permanecem para conferência.
- O usuário corrigiu o destino: deixar a seleção no Aquário, sem criar negócios no Pipedrive. Recon tem visão própria de elegibilidade, motivos e exportação, sem alterar os produtos/forecast da operação de Monetização.
- A conferência combina os produtos de contratos ganhos e a carteira financeira por identificador exato. Falta de informação não comprova ausência de BPO. Evidências ficam no perfil privado da conta; o repositório contém apenas lógica, interface e testes sintéticos.


## 2026-09-16 — Consultoria exclusiva para origem retroativa

- Regra corrigida por instrução explícita: Consultoria exige Base Antiga das unidades comprovada, ausência de fechamento pelo comercial e regime fora do Simples/MEI. Faturamento, segmento, contato e exigência exclusiva de Lucro Real deixam de bloquear essa oferta. Regras de Finance e Cella preservadas.
- Origem confrontada nos cadastros vinculados de Ops/Pipefy e nos fechamentos comerciais por identificadores exatos. Divergência ou regime ausente permanece pendente. Evidências individuais são armazenadas no banco privado, sem publicação no repositório.
- A restrição vale na interface, na validação e na reserva para envio. A antiga confirmação de reoferta não permite incluir carteira comercial. Histórico de envios permanece visível como histórico; nenhuma oportunidade é criada ou alterada no Pipedrive nesta revisão.
- Recon foi publicado e conferido antes de iniciar a revisão de Consultoria, conforme a prioridade solicitada.

## 2026-09-16 — Origem por unidade, filtros efetivos e envio direto

- Por instrução explícita do usuário, a validação com o sócio deixa de ser pré-requisito para envio. A carteira permite selecionar contas, escolher produto e responsável e enviar diretamente. A seleção fica registrada em lista compartilhada; o servidor mantém as regras do produto, escopo do usuário, reserva por conta/produto e auditoria do ator. Validação com o sócio permanece como registro opcional, sem fabricar uma aprovação quando o envio é direto.
- Base Antiga/Base Nova são confrontadas a cada leitura com `ops.empresas.origem_da_base` e os fechamentos comerciais já conciliados. Base Antiga junto de Base Nova/comercial aparece como divergência. Ausência de contrato ou presença no Omie não prova origem retroativa; a tela legada de pré-Planning usa outra população. A nova leitura respeita o mesmo escopo das contas.
- Abrir uma unidade mostra sua carteira completa e a contagem por origem. Selecionar produto aplica perfil aderente por padrão, inclusive quando a situação estava vazia. Situações pendentes, excluídas e já trabalhadas são filtros explícitos. Mudanças de filtro limpam a seleção para impedir envio de contas ocultas.
- A revisão do Recon aproveita faixas antigas do CRM e notas de qualificação conferidas por identificador exato, mantendo data e fonte. Evidência contraditória ou CNPJ inválido permanece pendente. O radar distingue aptas, faturamento acima do corte com BPO pendente, faixas limítrofes e as demais lacunas/exclusões. O total potencial não é apresentado como total aprovado. Recon permanece sem envio automático ao CRM.
- Validação: testes de domínio e filtros; teste transacional de envio direto sem aprovação de sócio, escopo de unidade, identidade ausente, revisão concorrente e reserva duplicada. Dados individuais e evidências permanecem privados, fora do Git.

## 2026-09-16 — Regime ausente não significa ausência de potencial em Consultoria

- A apresentação anterior destacava somente aptas comprovadas e escondia a carteira retroativa sem regime ao abrir Consultoria. Isso induzia a interpretar uma lacuna cadastral como ausência de oportunidades.
- Consultoria passa a abrir por padrão a base retroativa para análise: origem antiga comprovada, sem fechamento comercial identificado, reunindo aptas e regime pendente. Regime Simples/MEI conhecido e origem comercial, nova ou divergente permanecem fora desse recorte. Cella e Finance conservam o filtro inicial de perfil aderente.
- Indicadores gerais, cartões por produto e carteiras por unidade distinguem contas para análise, aptas confirmadas e regime a confirmar. Falta de regime não gera elegibilidade nem liberação de envio; contato e faturamento continuam opcionais para Consultoria. O usuário pode organizar a carteira pendente em listas.
- A conferência interna adicional usa contagens agregadas de empresas, contratos, cadastro de broker e histórico de empresas. Evidências e resultados individuais não são publicados. Esta correção não consulta fornecedores externos nem envia negócios ao CRM.

## 2026-09-16 — Enriquecimento da carteira retroativa com Driva

- O usuário forneceu acesso à Driva e pediu consultar a carteira para preencher regime e faturamento. O site oficial identifica Kipflow como a API de dados da Driva; a documentação do dataset `complete` fornece opção pelo Simples/MEI, tributação, segmento e estimativas de faturamento. Foram consultados somente os CNPJs retroativos, sem envio de contatos ou outros projetos.
- O resultado é incorporado ao Aquário no banco unificado, com fonte, data da consulta e evidência por CNPJ. Regime e segmento complementam lacunas; dados preexistentes, origem da carteira e faturamento declarado são preservados. `false` explícito de opção pelo Simples é evidência de não opção; ausência, identidade divergente ou contradição permanecem pendentes. Em contas com múltiplos CNPJs, cobertura incompleta ou regimes mistos não gera aprovação automática.
- Faturamento Driva é estimativa. Valor do estabelecimento e faixa do grupo econômico aparecem separados nos detalhes. A faixa estimada do grupo tem filtro e coluna de exportação próprios e não substitui os cortes de faturamento comprovado de Cella, Finance ou Recon. Sem data de referência do fornecedor, a tela informa essa ausência e mostra separadamente a data de consulta.
- As contagens distinguem a carteira retroativa completa, aptas, excluídas por Simples/MEI e pendências de cadastro/consulta. Nenhum negócio é criado automaticamente no CRM. A consulta é uma carga com data, sem atualização paga recorrente implícita; chave e respostas individuais permanecem fora do Git e do cliente web.

## 2026-09-16 — Revisão das fontes Omie e dos conflitos de unidade

- A auditoria solicitada distingue cadastro Omie de cliente ativo ou carteira retroativa comprovada. A aba legada Base Antiga lê `ops.omie_clientes` sem os filtros que sua legenda promete; a função inclui cadastros pré e pós Planning, pessoas físicas e registros inativos. A presença nessa tabela não altera por si só a origem nem a elegibilidade de Consultoria. Proposta para a próxima implementação: incluir essa fonte no Aquário como cadastros a qualificar, com reconciliação por identidade e evidência de vínculo/origem.
- O aviso de conflito de unidade atualmente compara também rótulos equivalentes e códigos ainda não traduzidos. Aliases conhecidos como Sudeste (RJ)/Rio de Janeiro devem resolver para o mesmo ID. Unidade da carteira, cidade do cliente e unidade do cadastro financeiro representam conceitos distintos; coincidência de CNPJ entre unidades não autoriza escolher uma delas ou reatribuir carteira automaticamente.
- A rotina `monetizacao_refresh_ops` atualiza segmento, regime e contatos, mas não reconcilia a unidade e sua evidência histórica. A correção precisa atingir a fonte e o refresh, preservando decisão, responsável e procedência, para não recolocar uma divergência já resolvida.
- A revisão encontrou funções de cadastro Pipefy implantadas sem webhooks visíveis nas tabelas auditadas, rotinas atrasadas e falha de parsing de data em Auditoria Interna. A carga Omie necessita revisão da cobertura por conta e da flag `is_planning` (paginação, normalização e status do contrato). Os resultados individuais e consultas ficam no artefato privado da auditoria. Esta entrada registra diagnóstico e escopo proposto; nenhuma automação ou carteira foi alterada nesta revisão.


## [2026-09-17] Clientes único, espelho Pipefy e preservação no primeiro cruzamento

**Contexto:** instrução explícita para executar PRD + SDD a partir das cinco atividades do print. O trabalho está isolado na branch `feat/base-unica-pipefy-sdd-20260916`.

**Decisões:** `/clientes` reúne a base e as oportunidades; `/aquario` conserva o endereço por redirecionamento. Contas/empresas, contatos e negócios têm contagens próprias. Preservar os IDs de `monetizacao_contas`, listas e envios; Omie amplia esse catálogo por CNPJ completo validado, nunca por nome. CPF não vira empresa. Omie fora de Curitiba determina Base Nova independentemente de pagamento. Pipedrive sem fechamento comprovado e Curitiba ficam pendentes enquanto o usuário define o alcance das evidências. Sem vínculo suficiente, gerar validação da unidade com ator, responsável e evidência. O funil cumulativo é de completude; contato, faturamento mínimo e ECD não viram vetos adicionais à Consultoria.

Pipefy é a autoridade dos campos compartilhados. Evento autenticado solicita releitura e confirma tabela; não se escreve a partir do payload. Estado técnico registra duplicação, atraso, falha e origem ausente sem apagar histórico. Correções usam fila com comparação anterior, setter idempotente e releitura. Na primeira conciliação, vazios do Pipefy e conflitos de documento/vínculo não apagam enriquecimento existente: ficam pendentes com evidência preservada. Essa proteção prevalece sobre qualquer interpretação de sincronização que simplesmente eliminasse informação local.

ECD usa apenas metadados já autorizados dentro do Brain, por CNPJ único e exercício. Não acessar nem copiar escrituração bruta de outra frente. A autorização desta tarefa não é autorização para consultas pagas em massa nem para criar novos negócios.

**Execução:** após nova instrução “continua”, migrations e sincronizador foram aplicados com backup privado atualizado. Testes transacionais, idempotência Omie/ECD, colisão de vínculo e isolamento por unidade passaram. Webhooks e reconciliação estão ativos; publicação da interface e verificação final estão registradas em `docs/dev_notes/base-unica-pipefy/summary.md`.

Metadados ECD históricos ficam em `base_ecd_registros`, unidos ao cadastro fiscal por uma visão. A tabela fiscal exige dados de escrituração que não estão disponíveis; não inventar receita, plano de contas ou identificadores para preenchê-la. Colisões de ID de negócio ficam pendentes, preservando o dono do vínculo. Fichas mostram canais Omie e contatos atuais somente com permissão apropriada.

**Publicação:** banco e tela única disponíveis em `planningbrain.com.br/clientes`, com compatibilidade de `/aquario`. A conciliação concluída distingue sucesso de pendência; não anunciar igualdade integral enquanto houver conflitos. Validação somente leitura de Auditoria foi acrescentada para conferir datas sem acionar a remoção legada. Webhook perdido de exclusão é recuperado por releitura limitada por ciclo, preservando histórico. O PR e o estado de cada aceite estão no resumo SDD.

**Identidade:** CNPJ realmente contraditório entre fonte e espelho exige revisão antes de classificar origem ou enviar qualquer produto, inclusive na apresentação do Recon. Falta de CNPJ na fonte e diferença de máscara não equivalem a contradição. Ambos os valores e o vínculo anterior são preservados; não unir empresas por esse conflito.

## [2026-09-17] Base de clientes: estudo do fluxo produto, oportunidade e lista

**Contexto:** o usuário relatou que Recon permite ver a sugestão, mas não construir lista/enviar, e pediu estudo de UX e renomeação de Clientes.

**Implementado nesta entrega:** rótulo da tela, módulo e navegação passa a **Base de clientes**, preservando `/clientes` e permissões. Estudo em `docs/dev_notes/base-clientes-listas-ux/estudo.md`; protótipo independente em `public/estudos/base-clientes-listas.html`, somente com dados sintéticos e ações locais em memória.

**Diagnóstico:** Recon usa uma tabela própria com seleção/exportação, enquanto produto de lista, validação no servidor, constraint SQL e mapeamento CRM aceitam somente Cella, Consultoria e Finance. O envio e o sincronizador se concentram no funil 39. Isso preservava a orientação anterior de manter Recon no Aquário, mas cria uma quebra no fluxo aparente. Não se resolve apenas habilitando o botão.

**Proposta para revisão, ainda não implementada no fluxo real:** Base / Oportunidades / Listas; um seletor de quatro produtos; seleção persistente por produto com indicação de itens fora do filtro; painel de montagem e uma revisão comum de envio direto/lista salva. Listas novas de um produto, preservando listas históricas mistas. Recon aponta ao Conciliador após verificar campo canônico e etapa de entrada, sem inserir Recon automaticamente no forecast de Monetização. Pendências podem ser organizadas em rascunho; contato e aprovação do sócio permanecem opcionais. Perfil, disponibilidade e andamento são conceitos separados.

**Limite desta entrega:** estudo e renomeação, sem criar listas reais, modificar banco ou enviar negócios. Não tratar a proposta como funcionalidade já disponível. O protótipo é auditável no navegador e não usa APIs ou dados reais. Aceites de UX, idempotência, acesso e falhas parciais estão no estudo.

## [2026-09-17] Carteira: carga em lotes paralelos e agregação por conta

**Contexto:** usuário relatou demora excessiva na carteira. A carga esperava 20 páginas sequenciais para 7.937 contas, recalculando a base inteira por página.

**Decisão:** preservar a visão canônica e suas regras, movendo os agregados para consultas correlacionadas às contas solicitadas. Manifesto autenticado fornece limites por chave; cada página retorna perfil e metadados no mesmo snapshot, com até 400 contas e revalidação de permissão/escopo. Navegador usa no máximo quatro requisições simultâneas e só publica totais após conferir revisão, escopo, quantidade, limites e unicidade. Não usar cache global de clientes nem retirar validação para acelerar. Filtros de unidade usam conjuntos de chaves e os dados derivados da carteira são memorizados.

**Validação:** 7.937 contas comparadas sem alteração no resultado; consulta de 400 metadados caiu de 1.242 ms para 239 ms no teste transacional. As novas RPCs passaram para acesso geral, unidade e bloqueio anônimo. Testes cobrem duplicatas, lote parcial, troca de versão/escopo, ordem e cancelamento. Esses números medem SQL; não são uma afirmação sobre tempo total do navegador. Detalhes em `docs/dev_notes/carteira-performance/resultado.md`.

## [2026-09-17] Recuperação de senha: link tolerante a encaminhamento, código alternativo e e-mail Planning

**Contexto:** usuário reportou link inválido ao abrir “Esqueceu a senha?” e pediu aplicação do design system no e-mail. A configuração do banco unificado já usava Resend/1 hora. Testes reais com conta sintética funcionaram antes da mudança; o incidente específico não foi reproduzido e não foi atribuído, sem evidência, ao SMTP ou a scanners.

**Decisão:** manter validade de uma hora e verificação apenas após salvar a nova senha. A rota trata links legados explicitamente, sem a detecção automática do SDK, tolera os formatos usuais de encaminhamento e preserva o fragmento até terminar para não perder o token ao recarregar. Expiração só é afirmada após resposta do Auth. O usuário pode escolher código + e-mail quando o link não abre corretamente; código e link são o mesmo pedido de recuperação, nunca uma senha enviada por e-mail. A atualização verifica a identidade e não usa uma sessão existente de outra conta.

**Design e publicação:** layout compartilhado com logo, verde `#0ae18c`, texto `#10171c`, fundo `#f4f7f9`, CTA e alternativa por código. Template do Supabase gerado e testado a partir do código; a configuração hospedada deve ser aplicada separadamente, após a tela nova. Sem mudanças de provedor, remetente, permissões ou bancos legados. Relatório em `docs/dev_notes/recuperacao-senha/resultado.md`.
## [2026-09-15] A Apuração de CAC passa a ser lista do pipe do Pipefy, não dos contratos

**Contexto:** a tela `/unidades/cac` nascia dos contratos ganhos no Pipedrive: todo contrato de unidade que paga CAC virava item, e o pipe `[PTRS-CLI-03] Central de Contratos` (307285170) só respondia "já assinou?". Eram 117 itens, a maioria sem cobrança nenhuma em andamento, e a decisão de cobrar (quando, quanto) vivia fora do sistema, em planilha. Em 15/09/2026 o usuário montou o pipe **"Cobrança CAC Adiantado" (307316953)**, com uma fase por estágio da cobrança, e pediu que a tela passasse a se basear nele.

**Decisão — o pipe é a lista.** Um card é uma cobrança. Quem não tem card não aparece na lista principal. As cinco fases mapeiam o que está liberado para cobrar da unidade:

| Fase | O que libera |
|---|---|
| Nova Cobrança | nada |
| Ainda não Faturou | nada (segura: o cliente ainda não faturou) |
| Cobrar 50% | parcela 1 |
| Cobrar 100% | parcela 1 + parcela 2 |
| Cobrança Concluída | tudo |

Fase que não estiver nessa lista não libera nada, de propósito: melhor segurar até alguém mapear do que cobrar por engano. Esse mapeamento é interpretação dos nomes das fases, não foi dito com todas as letras pelo usuário, e é o primeiro lugar a conferir se a cobrança sair errada.

**Decisão — o valor continua vindo de `contratos.mrr_mensal`,** com as regras por unidade que já existiam (atribuição, 7 dias, excedente mensal de Patos, corte dos R$50 mil da Campo Novo). O pipe não tem campo de valor. O card se liga ao contrato pelo **nome do cliente normalizado** (sem acento, sem caixa, sem sufixo societário) dentro da unidade, porque o card não carrega CNPJ nem Deal ID. Nos 26 cards de hoje isso casou 26 de 26.

**Decisão — o gate antigo sai.** A fase no pipe de contratos deixa de decidir a cobrança de CAC: uma fonte só, a do pipe da própria cobrança. A coluna "Assinatura do contrato" virou "Fase da cobrança".

**Decisão — item sem card não some da base.** Os 80 itens anteriores ao pipe (R$ 184 mil em aberto; 25 deles já com pagamento marcado e vínculo com royalties) continuam gravados e aparecem num aviso à parte, com toggle "Mostrar". Sumir com eles apagaria da tela cobrança que já aconteceu. Para voltarem à lista, basta abrir card para eles.

**Status: superado pela remoção da tela em 18/09/2026** (entrada abaixo). O que valeu foi o sync do pipe, que ficou de pé. Migration `supabase/migrations/20260915160000_cac_cobranca_pipefy.sql` **já aplicada no banco único** (`cac_cobranca_cards` + `cac_apuracao_itens.pipefy_card_id`; ambas aditivas). Edge Function `pipefy-cac-cobranca-sync` deployada e rodada uma vez (26 cards). Agendada no n8n em `[Pipefy] Sync - Cobranca CAC Adiantado (n8n)` (`GJIMxhmzwgtJEFgj`), a cada 30 min.

**Próximos passos:** nenhum. A tela saiu; o que restou do trabalho é o sync do pipe.

## [2026-09-16] O financeiro da unidade vira área própria, e a Administração sai do seletor

**Contexto:** o usuário pediu para tirar do sócio regional o bloco "Financeiro"
do menu da unidade (Funil de Receita, Contas a Receber e Meus Royalties) e não
achou a opção em `/admin/permissoes`. Não era bug da tela: desde 15/09 a unidade
de concessão é a ÁREA, e as três chaves moravam dentro de `minha_unidade`. Tirar
o financeiro significava tirar junto carteira, CS, NPS e IDU.

**Decisão — área `minha_unidade_financeiro`.** Mesmo precedente do
`broker_matriz`: quando a fronteira do MENU e a fronteira da CONFIANÇA não
coincidem, o item declara área própria e o grupo continua no mesmo lugar da
lateral. As três chaves saíram de `minha_unidade` e entraram na área nova, que
nasce concedida ao `admin` e negada ao `socio_regional`. Elas seguem em
`receita`, que é quem as concede para a Matriz, então ninguém da Matriz perdeu
nada. Religar para o sócio é um clique na matriz de permissões.

A alternativa de apagar os três itens do menu foi descartada: some da tela e
volta a ser decisão em código, que é o defeito que o modelo por área corrigiu.

**Decisão — a Administração não divide o seletor com as áreas de trabalho.**
O seletor do topo responde "em que estou trabalhando agora", e a resposta nunca
é "configurando quem vê o quê". Ela virou linha fixa no rodapé da lateral, com
grifo quando você está dentro. Continua em `areasVisiveis`, então dentro dela a
lateral mostra as páginas normalmente. A porta de entrada (`/inicio`) segue
listando o cartão: ali é catálogo, não menu de trabalho.

**Status:** publicado. Migration `20260916100000_area_minha_unidade_financeiro.sql`
aplicada no banco único e deploy `442ccf1` READY em produção. Conferido no banco:
os dois sócios regionais respondem `false` para as três chaves e seguem `true`
em painel da unidade, clientes, CS, NPS e IDU.

**Achado de caminho, não corrigido:** o papel `financeiro_admin` tem a área
`admin_financeiro` mas não tem a área `admin`, e `areasVisiveis` filtra por
`temArea(a.slug)` ANTES de olhar item por item. Logo a Administração inteira não
renderiza para ele e `/admin/acessos-financeiro` fica inalcançável pelo menu (a
rota abre por link direto). Some se o filtro de área cair e a decisão passar a
ser só do item, que é o que `areaDoItem` já faz.

## [2026-09-16] Super admin e admins de área: quem delega o quê

**Contexto:** o usuário pediu uma estrutura de admin delegado. "O sócio regional
é o admin do painel da unidade dele, ele que controla o acesso dos colaboradores
dele; o admin de growth controla o que cada um vê no Growth; o admin do
financeiro controla o que cada um vê do resultado de cada empresa."

**Decisão — dois níveis, dois donos.** O super admin decide quais ÁREAS cada
papel e cada pessoa alcança, e quem administra cada área. O admin da área decide,
dentro dela, quais CHAVES daquela área cada pessoa vê, e o escopo dela. O super
admin nunca desce para a chave; o delegado nunca sobe para a área.

Isto não reverte o corte de 15/09: a chave segue invisível para quem concede
área. Ela reaparece só na tela do delegado, onde a pergunta é "dentro de Minha
Unidade, o Fulano abre CS e NPS mas não abre Clientes". As 76 chaves e as 111
policies não mudam.

**Decisão — colaborador de unidade vira usuário do Ops,** com login próprio,
papel `colaborador_unidade` sem área por padrão e escopo de uma unidade,
obrigatório. Quem abre área para ele é o sócio. Piloto no Rio, a única unidade
com escopo correto hoje.

**Decisão — uma tela só para os três domínios,** na Administração do Brain.
Unifica a operação, não as tabelas: Growth continua entrando por
`growth.membros` e o Financeiro por `produto_acesso` mais `usuario_empresas`.

**Decisão — não escalada na função, não na tela:** o delegado só concede o que
ele mesmo tem, só para gente dentro do escopo dele, e nunca toca em papel, área
ou na lista de admins. `ops.pode_administrar()` responde as três e a RLS amarra.

**Status:** plano escrito em `~/Desktop/AI Projects/PLANO-ADMIN-DELEGADO.md`,
nada implementado. Fase 0 (três consertos) antes de qualquer tabela nova: escopo
vazio do Italo Amaral, o menu inalcançável do `financeiro_admin` e a
`usuario_empresas` vazia.

## [2026-09-17] Níveis de acesso por área: banco aplicado, tela do super admin no dev

**Contexto:** as 11 decisões do PLANO-ADMIN-DELEGADO foram confirmadas. Os
níveis, nas palavras do dono: Super Admin (acesso full); Admin (todas as
empresas, só nas áreas que o super admin permitir); Sócio (full nas áreas e
unidades que o admin permitir, e convida a equipe); Usuário (só consulta, por
enquanto).

**Decisão — as escritas delegadas moram no banco.** Funções `ops.acesso_*`
(adicionar na área, definir páginas, remover da área, nomear, definir unidades,
negar página) conferem nível e recorte e registram em `ops.acessos_log`. As
tabelas novas só aceitam escrita direta do super admin. Refinamento sobre o
plano: o delegado ESCREVE em `usuario_areas` (convidar para a área dele é
justamente o pedido), mas só por essas funções.

**Decisão — "usuário só consulta" é uma constraint, não uma tela.**
`usuario_chaves` só aceita conceder chave `view.*`. Para isso valer, as seis
gravações que passavam com chave de ver ganharam chave de operar nas mesmas
áreas: `edit.nps` (envio, pesquisa, ligação e gravação do NPS, e o disparo) e
`edit.gente.conversas` (1:1 e feedback).

**Decisão — o menu lê o banco.** `acessoDoUsuario` passou a chamar
`ops.acesso_do_usuario`, a mesma regra do `can_user`. O Gente deixou de ler
`role_permissions`, congelada desde 15/09.

**Status:** migration `20260917100000_gestao_acessos_niveis.sql` aplicada em
produção; 2.940 pares pessoa × chave idênticos antes e depois; gate de 37
cenários em `supabase/gates/`, rollback ensaiado em `supabase/rollback/`. Tela
(botão "Acessos" e "Administra" na matriz) publicada em 17/09. Fase 0
aplicada no mesmo dia: Italo Amaral em Belém, e `headcount_mensal` e
`comite_correcoes` só aceitam escrita do super admin.

**Achado, não corrigido:** `headcount_mensal` (vazia, a tela só lê) e
`comite_correcoes` (1 linha, nenhuma tela do app grava) aceitam escrita de
qualquer pessoa com a porta do Ops.

## [2026-09-17] Minha equipe no ar, e o piloto do Rio aberto

**Contexto:** dono autorizou as Fases 3 e 4 do PLANO-ADMIN-DELEGADO.

**Decisão — o convite cria a conta e abre a porta do Ops.** Conta nova nasce
sem senha e sem papel, recebe `produto_acesso` do Ops (sem ele as policies com
`tem_produto('ops')` barram tudo) e o link de definir senha. A checagem de
quem pode convidar vem ANTES de criar a conta, e se o banco recusar o acesso a
conta recém-criada é apagada.

**Decisão — tirar da área só desativa a conta quando ela não entra em mais
nada.** Sem área no Ops, sai a porta do Ops; a conta só é banida (reversível)
se também não tiver Growth nem Financeiro.

**Decisão — item de menu pode exigir a página.** `Item.chave` nos itens de
Minha Unidade: o colaborador vê no menu só o que recebeu. Quem entra por papel
tem todas as chaves da área, então nada muda para ele.

**Status:** publicado (commit `8f9100f`). Piloto: o sócio regional do Rio é
sócio de Minha Unidade (migration `20260917170000`), páginas idênticas antes e
depois. Pela tela Acessos, a Victor nomeou o Mateus Nunes admin de Clientes.

## [2026-09-17] O admin do Financeiro estava na Ana errada, e o /inicio escondia a Administração

**Contexto:** a Ana da controladoria entrou procurando a Administração e não
achou. Três causas somadas.

**1. A pessoa errada.** Em `20260915170000` o papel `financeiro_admin` foi para
`ana.aguiar`, com o critério "das duas, só a aguiar já entrou". São duas
pessoas: a da controladoria é a Ana Laura **Carvalhais**; a Aguiar é uma das
quatro colegas que ela pediu para incluir no Financeiro. Migration
`20260917233000` move o papel (com gate: a Aguiar nunca concedeu nada). O gate
de `20260917_gestao_acessos.sql` passa a usar o uuid da Carvalhais.

**2. O cartão que não existia.** O `/inicio` filtrava por `temArea(a.slug)`, e
quem tem só a área de um ITEM (`admin_financeiro` dentro da Administração)
ficava sem cartão — o mesmo defeito que a lateral já tinha resolvido em
`areasVisiveis`. Agora usa a mesma segunda condição, e o cartão aponta para a
primeira página que a pessoa abre, respeitando `Item.chave`.

**3. Produto único ia para o Ops.** Quem só tem o Financeiro caía no
`/rede-overview`, inclusive pelo "Ver todas as frentes" do cockpit. Agora vai
para `/financeiro`, depois de `garantirSessoesIrmas()` (efeito de filho roda
antes do de pai; sair no render abria o cockpit em 401). Só o Financeiro: o
"Sair" do cockpit passa a ir para `/auth?sair=1`, que desloga Ops, Growth e
Financeiro; o do Growth não foi conferido, e voltar a ele com a sessão
reemitida prenderia a pessoa lá dentro.


## 2026-09-17 — Origem comprovada por registro e vigência contratual

**Regra confirmada pelo usuário:** fora de Curitiba, qualquer registro vinculado no Omie ou Pipedrive determina Base Nova, independentemente de pagamento ou fechamento ganho. Curitiba usa a primeira `cabecalho.dVigInicial` por CNPJ nos Contratos de Serviço do Omie: antes de abril/2025 é Antiga, após abril/2025 é Nova. Abril permanece pendente porque o usuário não definiu o tratamento do mês de corte. Esta decisão substitui o alcance Pipedrive pendente da entrada de Base Única.

**Identidade:** Curitiba, Planning CWB 01 e Planning CWB 02 são aplicativos diferentes. Código de cliente só identifica dentro do aplicativo; o vínculo com a base usa CNPJ completo válido. Data de cadastro/pagamento não substitui vigência. A primeira vigência preserva a origem em renovações. Cobertura parcial, CNPJs com coortes mistas, unidade ambígua e conflito de identidade exigem revisão. Nenhuma validação de sócio é fabricada.

**Execução:** evidências mínimas ficam no banco unificado, protegidas por RLS e expostas apenas pelas RPCs que já respeitam o escopo de unidade. A regra é calculada na leitura, sem mudar chaves de contas ou recriar listas. Correções no Pipefy passam pela outbox com comparação anterior e releitura; o worker aceita escoamento administrativo em lotes limitados. CNPJs recuperados por IDs ligados são propostos na mesma fila; colisões exigem reconciliação.

**Tributação:** reutilizar evidências anteriores e flags S/N explícitos do Omie; Driva complementa lacunas com fonte/data. Ausência não significa fora do Simples, divergências não liberam oferta e estimativas não substituem faturamento declarado. A evidência de não opção serve aos critérios existentes de Consultoria, Finance e Cella sem inventar Lucro Real/Presumido. Consultoria continua exclusivamente antiga e sem fechamento comercial; contato, segmento, faturamento e ECD não são vetos adicionais. Recon permanece no Aquário e mantém a comprovação de ausência de qualquer BPO.

**Operação:** carga inicial e correções autorizadas aplicadas. A consulta Driva é uma carga limitada ao saldo existente, sem compra ou recorrência paga automática. Atualização diária das vigências foi implementada em páginas com checkpoint, mas sua ativação aguarda autorização específica após bloqueio da revisão automática. Não ativar o cron só por aplicar a migration de metadados.

## 2026-09-17 — Atualização diária de vigências ativada

**Autorização e execução:** após a explicação da pendência, o usuário autorizou executar todos os passos listados. Foi aplicada a migration `20260917174200_base_vigencias_sync.sql` e publicado o sincronizador `base-clientes-sync` versão 5. O job `base-omie-vigencias` verifica a fila a cada dois minutos; cada chamada consulta até 50 contratos de um aplicativo. Ao terminar um aplicativo, seu checkpoint aguarda 24 horas. Isso não cria contratos nem agenda consultas pagas à Driva.

**Verificação:** primeiro ciclo completo nos três aplicativos Omie de Curitiba, sem erro e sem lease pendente; checkpoints reiniciados na página 1 com próxima execução no dia seguinte. O cron anterior do Pipefy e a fila de correções foram preservados. A rotina e a pausa diária estão verificadas; campos ausentes na fonte continuam pendentes.

**Refinamento complementar:** cadastros Omie sem flag explícita de Simples permanecem desconhecidos. Campos de unidade em negócios Pipedrive foram conferidos, mas não substituem o vínculo de identidade da empresa nem criam unidades automaticamente a partir de rótulos desconhecidos. Casos sem prova suficiente seguem em listas privadas para validação. O mês de abril/2025 continua aguardando a definição solicitada e nenhuma compra de créditos foi feita.

## [2026-09-18] Envio ao CRM inclui contexto comercial e retomada por negócio

**Contexto:** o closer recebia negócios sem contato, histórico ou arquivos; um bloqueio de perfil parecia erro de envio e interrompia o lote.

**Decisão:** preservar a elegibilidade por produto e explicar cada bloqueio, oferecendo consulta às alternativas elegíveis sem trocar o produto automaticamente. Finance mantém contrato ganho, faturamento abaixo de R$ 25 milhões e regime fora do Simples. Validação com o sócio continua opcional. Cada item é enviado separadamente e os demais continuam quando um falha.

Depois da confirmação do negócio, preparar contato principal, participantes, campos de qualificação existentes, nota fixada com empresa/origem/tese, histórico e arquivos dos vínculos confirmados. Não transportar ticket nem previsão de outra venda. Documentos externos ficam referenciados e ECD permanece resumo. Contatos respeitam a permissão do autor do envio; não casar empresa apenas por nome.

A fila complementar nasce na mesma transação do status `sent`, usa lease e marcadores por envio/nota/arquivo, e retoma no mesmo negócio. Falha parcial não cria outro card. A tela apresenta o link, a situação e a ação “Completar dados do card”. Pacotes antigos não iniciados não recebem preenchimento em massa automaticamente.

## [2026-09-18] Ganhos do CRM contam sem exigir data de assinatura

**Contexto:** um negócio marcado como ganho pelo closer não aparecia no indicador porque faltava preencher o campo customizado de assinatura.

**Decisão:** o realizado comercial passa a “Contratos ganhos”: status atual `won` e data `won_time` do Pipedrive (histórico de ganho como alternativa), no fuso de São Paulo. Atribuir o movimento ao usuário que marcou ganho quando disponível no histórico. Receita e assinatura continuam campos independentes de completude; não condicionar a contagem a eles nem inventar valores. Negócios reabertos/perdidos deixam esse realizado. A chave interna `signed` é preservada por compatibilidade, com versão 3 do cálculo para reprocessar o cache. `signed_on` conserva a data documental; `won_on` alimenta o ciclo comercial e as coortes.

## [2026-09-18] A Apuração de CAC sai do ar, e o pipe continua alimentando o broker

**Contexto:** três dias depois de a tela passar a nascer do pipe "Cobrança CAC Adiantado", o usuário pediu para excluir `/unidades/cac`. A decisão é dele e não precisa de motivo técnico registrado aqui.

**Decisão — sai a tela, fica o dado.** Foram removidos a rota `unidades.cac.tsx`, o conteúdo `components/cac/`, o hook `use-cac.ts`, as funções de servidor `lib/cac.functions.ts`, o item de menu em `areas.ts` e o redirect `/unidades?tab=cac` (que agora cai em `/unidades`). As três tabelas continuam gravadas: `cac_apuracao` (38), `cac_apuracao_itens` (117) e `cac_cobranca_cards` (84). Apagar histórico de cobrança que já aconteceu não foi pedido e não se desfaz.

**Decisão — a notificação de CAC é desligada.** `trg_contas_receber_notificar_cac` e `notificar_cac_pagamento()` saem: o aviso do sininho dizia "parcela 2 liberada" e mandava a pessoa para uma URL que não existe mais. Era o único emissor de notificação in-app; a tabela `notificacoes`, a RLS, o realtime e o sininho ficam de pé para o próximo emissor. Migration `20260918120000_cac_tela_removida_desliga_notificacao.sql`.

**Decisão — o sync do pipe NÃO é desligado, contra o pedido original.** A intenção era desligar todo o backend de CAC junto com a tela, mas `ops.broker_cac_sync()` lê `v_cac_cobranca_pipe` (ou seja, `cac_cobranca_cards`) para lançar os débitos de CAC no extrato do broker, origem `cac_pipe`: 82 movimentos, o último de 16/09/2026. Desligar a Edge Function `pipefy-cac-cobranca-sync` ou o agendamento `[Pipefy] Sync - Cobranca CAC Adiantado (n8n)` (`GJIMxhmzwgtJEFgj`, a cada 30 min) congelaria a cobrança de CAC das unidades no broker. Os dois seguem ativos, e a Edge Function e as duas migrations do pipe entram no repositório agora: estavam aplicadas em produção e fora do git, que é a pior combinação possível.

**Decisão — `trg_sync_cac_pago_via_recebimento` fica.** Dispara no pagamento de royalties, não na tela. Removê-lo mudaria o comportamento de uma página viva para limpar algo que não incomoda.

**Chave de permissão:** nenhuma foi removida. A tela usava `view.unidades_rede`, compartilhada com Regras da Rede e Apuração de Royalties; só os rótulos que citavam CAC foram corrigidos.

## [2026-09-18] O super admin veste a unidade: "ver como" o sócio regional

**Contexto:** o pedido do dono foi literal — "clico em Minha Unidade, seleciono a regional e ele me mostra a mesma visão que o sócio da unidade teria". Hoje não havia caminho nenhum: o perfil `admin` não tem a área `minha_unidade` (só `socio_regional` tem), então o Painel da Unidade nem aparece no menu dele; e mesmo abrindo por link direto, todas as telas do sócio recortam por `scopedToOwnUnit && unidade`, duas coisas que quem enxerga a rede inteira não tem. A única forma de saber o que o sócio via era perguntar a ele.

**Decisão — simula-se o ACESSO, não a identidade.** `ops.ver_como` guarda uma linha por pessoa (unidade, papel, expira em 8h) e `getMyPermissions` passa a devolver o perfil, as áreas, as chaves, o escopo e a unidade do sócio simulado. Nenhuma tela precisou saber que a simulação existe: todas já liam essa mesma resposta. O que NÃO muda é o `auth.uid()` — a RLS continua sendo a do super admin, e qualquer gravação feita durante a simulação é dele, com o poder dele. Trocar identidade de verdade significaria emitir token de outra pessoa, e esse preço não se paga para responder "o que o sócio de Curitiba está vendo".

**Consequência assumida:** a visão bate porque as telas do sócio filtram por unidade no cliente. Uma tela que dependesse só da RLS mostraria mais do que o sócio vê — das 155 policies, 4 isolam por unidade hoje. A tarja diz "as telas mostram só essa unidade", não "você está sem acesso ao resto".

**Decisão — simula-se o PERFIL, não a pessoa.** 12 das 14 unidades não têm sócio com login (só Rio e Belém têm). Simular "o Fulano de Curitiba" só funcionaria em duas praças, então `ops.acesso_do_papel('socio_regional')` responde o que o perfil alcança, e a lista de unidades mostra o nome de quem de fato entra por ali quando existe — para ninguém achar que está vendo a conta de uma pessoa que não existe.

**Decisão — a simulação expira em 8 horas e some do menu.** Esquecer a simulação ligada é o erro fácil, e o sintoma ("sumiu metade do meu menu") não aponta para a causa. Por isso a tarja âmbar no topo, grudada junto com o cabeçalho, com o botão de sair; e por isso o `administra` volta vazio durante a simulação: "Minha equipe" abriria a tela de convidar e remover gente, e convite é escrita, que sairia com o poder real do super admin.

**Auditoria:** entrar e sair gravam em `ops.acessos_log` (`ver_como_iniciar` / `ver_como_encerrar`), com unidade e papel. Migration `20260918160000_ver_como_unidade.sql`, rollback em `supabase/rollback/`.

**Chave de permissão:** nenhuma nova. Quem pode é o super admin, conferido no banco por `ops.eh_super_admin` dentro de `ops.ver_como_iniciar`.

## [2026-09-18] Funil de CAC: o grão é a venda, não o card, e a tela nasce de view

**Contexto:** a conciliação do dia entre o BI de vendas (Produtos por Cliente,
118 vendas de inside sales de 01/02 a 18/09/2026) e o pipe "Cobrança CAC"
(307316953) mostrou que ninguém no Ops enxergava o caminho inteiro. O pipe dizia
que faltava cobrar R$ 23 mil; faltavam R$ 170 mil. A diferença estava em 27 dos
84 cards (32%) com o campo "Valor 1º Honorário" vazio, que o relatório do Pipefy
soma como zero sem avisar. Cinco vendas já assinadas não tinham card nenhum, e
dois cards não tinham venda correspondente.

A tela `/unidades/cac` havia sido removida hoje de manhã (commit `5cd42ed`)
porque mostrava apuração, e apuração já vive no extrato do broker. O que faltava
não era aquela tela de volta: era o caminho entre os sistemas.

**Decisão 1 — o grão da tela é a VENDA, não o card.** Card como grão esconde
exatamente o vazamento mais caro, que é a venda assinada que nunca virou
cobrança. Cards órfãos não somem: viram a etapa `card_sem_venda`, porque card sem
venda é erro de cadastro que precisa aparecer, não linha a descartar.

**Decisão 2 — a lógica mora em view, não no componente.** `ops.v_cac_funil` e
`ops.v_cac_funil_resumo` (migration `20260918200000`). O mesmo cruzamento vai
precisar ser lido pelo extrato do broker e por qualquer auditoria futura; regra
de negócio duplicada em TSX é regra que sai de sincronia.

**Decisão 3 — o escopo é venda de inside sales desde 01/02/2026, nas unidades
que pagam CAC ou que já têm card.** Venda de sócio (pipeline 4) não gera CAC, por
decisão já registrada no broker. São Bernardo entra mesmo com `paga_cac = false`,
porque já tem cinco cards abertos, e leva o selo "não cobra CAC" na tela para que
ninguém confunda acompanhamento com cobrança devida. Patos de Minas entra mesmo
com zero card, porque paga CAC e tem 11 vendas: a ausência é justamente o achado.

**Decisão 4 — chave de permissão reaproveitada.** `view.unidades_rede`, a mesma
de Regras da Rede, Apuração de Royalties e da tela de CAC removida. Mesmo
público, nenhuma chave nova para administrar. A view aplica escopo de unidade
como `v_broker_cac_fila` faz: admin do broker vê a rede, os demais veem só
`ops.minhas_unidades()`.

**Armadilha resolvida na migration:** o pipe escreve "São Bernardo do Campo" e
`ops.unidades` guarda "São Bernardo". `ops.cac_unidade_chave()` normaliza os
dois, senão a unidade fica de fora do próprio funil. E o cruzamento com a Central
de Contratos é por `pipedrive_deal_id`, nunca por `cliente`: essa coluna vem com
a string `undefined` em 80 dos 460 cards, defeito do
`supabase/functions/pipefy-contratos-sync` que ainda não foi corrigido.

## [2026-09-18] O funil de CAC só conta como falha o que é falha: `unidades.cac_desde`

**Contexto:** o dono olhou o degrau "Contrato assinado → Card de cobrança
aberto" (96 para 81, −15, −R$ 93.350) e disse o óbvio: "esse gap não deveria
existir, se teve contrato assinado deveria ter card no CAC". Ele está certo, e o
número estava errado. Dos 15, nove eram de Patos de Minas com venda anterior a
agosto/2026 (a unidade só entra no CAC em 01/08/2026, decisão de 16/09), três
eram de São Bernardo (que está com `paga_cac = false`) e uma era Grupo Andrade
Bezerra, cujo card existe, só que aberto em Fortaleza enquanto o contrato diz
Maceió. Falha operacional de verdade: três.

**Decisão 1 — elegibilidade vira dado, não folclore.** Nova coluna
`ops.unidades.cac_desde`: data em que a venda da unidade passa a gerar CAC, nula
quando a unidade não cobra. Patos entra com 01/08/2026; as outras quatro com
01/02/2026. O funil anda só sobre vendas elegíveis, e o que fica de fora vira a
etapa `fora_da_regua`, visível na lista mas fora da conta. Sem isso o número de
falhas era cinco vezes maior que a realidade, e um painel que grita errado deixa
de ser lido.

**Decisão 2 — card aberto na unidade errada não é venda sem cobrança.** A busca
do card tenta a unidade da venda e, não achando, procura o mesmo cliente em
qualquer unidade: aparece como `card_em_outra_unidade`, com o nome da unidade
onde o card está. **O dinheiro continua com a unidade do card**, não com a da
venda, para não mover R$ 4.000 de Fortaleza para Maceió por causa de um cadastro
que o dono já decidiu em 18/09 que é venda de Fortaleza.

**Decisão 3 — o funil termina em dinheiro, não em fase.** Os degraus "1º
honorário lançado", "alguma parcela cobrada" e "cobrança concluída" viraram um
só, "Recebido", e embaixo do funil ficam as duas linhas que interessam:
**recebido** e **falta receber**, com o churn dito à parte porque não entra.
Pedido do dono: "preciso saber só o que já recebi e o que falta receber".

**Decisão 4 — a exceção vem nomeada.** Quando existe assinado sem card, a tela
abre com um alerta listando cliente, unidade, data do ganho e valor esperado.
Zero é o estado correto, então a lista tem que caber na tela.

## [2026-09-18] As quatro réguas do CAC: quem cobra, desde quando, acima de quanto, e o que nem é contrato

**Contexto:** ao ler o funil, o dono corrigiu quatro coisas de uma vez, e cada
uma virou dado em vez de exceção escrita no código.

**1. São Bernardo, Recife e Sorocaba cobram CAC.** O cadastro dizia
`paga_cac = false` para as três. Corrigido, com `cac_desde = 01/02/2026`. Efeito
imediato: as três vendas assinadas de São Bernardo sem card (Seminter, Resico,
SQi) deixam de ser "fora da régua" e viram a única falha operacional aberta da
rede.

**2. Piso por unidade.** Patos de Minas só paga CAC quando o contrato inteiro
passa de R$ 10.000. Virou `ops.unidades.cac_valor_minimo_contrato`, lida como
`coalesce(valor_total, mrr_mensal * 12, 0) >= piso`, e não como número escrito na
view. Das 11 vendas de Patos no recorte, uma é elegível.

**3. Churn não é falha de cobrança.** Bender Industrial (Fortaleza) está em
"Churn no Contrato" e nunca teve card. Contar isso como "assinado sem card"
acusa o time de algo que não aconteceu: cliente que saiu antes do 1º fee não
precisava de cobrança aberta. Nova etapa `churn_sem_cobranca`, antes do gate.

**4. Venda que não é contrato sai do funil.** MARKTECH Publicidade (Segunda
Oportunidade) é um deal ganho no Pipedrive (90577, Assessoria DOC, R$ 3.000
avulso) que nunca virou contrato. Em vez de um `where id <> 23219` na view,
criamos `ops.cac_funil_ignorados` (contrato_id, motivo): a exclusão fica
auditável, com motivo e data, e qualquer leitor futuro do CAC pode respeitá-la.

**Grupo Andrade Bezerra é Fortaleza.** O Pipedrive (deal 61648) já dizia
Fortaleza; `ops.contratos` dizia Maceió e `ops.empresas` também. Corrigidos: o
contrato direto no Ops, e a empresa pelo Pipefy (record `1430891562`), porque
`empresas.unidade` é campo que pertence ao Pipefy e o trigger
`sync_empresa_to_pipefy` recusa escrita direta, por desenho. Nas apurações de
CAC de julho, ambas em rascunho, o item de R$ 4.000 estava ativo em Maceió e
excluído em Fortaleza, exatamente ao contrário: invertido.

**Fica registrado como sintoma a investigar:** `ops.contratos.unidade` não é
reprocessada depois do primeiro sync. Quando a unidade do deal muda no
Pipedrive, o Ops fica com a antiga.

## [2026-09-18] Piso do CAC de Patos é no honorário mensal, não no contrato inteiro

Complementa a entrada anterior. Perguntado se os R$ 10.000 de Patos de Minas se
medem no contrato inteiro ou no mensal, o dono respondeu **honorário mensal**.
A coluna virou `ops.unidades.cac_honorario_minimo_mensal` e a elegibilidade lê
`coalesce(valor_1_honorario do card, mrr_mensal da venda, 0) >= piso`.

**Efeito:** nenhuma das 11 vendas de Patos no recorte gera CAC. A maior desde
01/08/2026 é DOM LOGISTICS, com R$ 7.500 por mês, e GRUPO MAGANHA entrou no
Pipedrive com valor zero e sem produtos (deal 94481). Patos aparece na tela com
zero a receber, e isso é o correto, não falta de dado.

Na mesma conversa: "Grupo Andrade Bezerra (Segunda Oportunidade)" (deal 89761,
R$ 4.200/mês) **fica como Matriz**, por decisão do dono. Só o contrato principal
(deal 61648) é Fortaleza.

## [2026-09-18] Mudança de contrato deixa rastro, e o sync do Pipedrive parou de morrer por causa do guarda do Pipefy

**O que se descobriu procurando a causa:** o sync `pipedrive-contratos-sync`
**estava quebrado desde 17/09/2026**. Ele roda 14:10 UTC e terminava em
`HTTP 400: Campo titulo pertence ao Pipefy. Use a fila de correção`. O PATCH em
`empresas` acontece ANTES do upsert de contratos, então o run inteiro morria e
nenhum contrato era atualizado havia dois dias. Não era "a unidade não é
reprocessada": era o sync inteiro no chão, sem ninguém perceber, porque o único
sinal era uma linha `status = 'erro'` em `ops.sync_log`.

**Decisão 1 — quem manda nos campos compartilhados é o Pipefy, e o sync aceita
isso.** No PATCH de empresa casada por CNPJ, o sync deixa de enviar `titulo`,
`razao_social`, `unidade` e `tipo_unidade`, e envolve a chamada em try/catch: uma
empresa recusada não derruba o sync de 600 contratos.

**Decisão 2 — mudança de contrato vira histórico.** `ops.contratos_alteracoes`
grava antes e depois de `unidade`, `titulo`, `cnpj`, `status_contrato`,
`mrr_mensal`, `origem_pipeline` e `ganho_em`, por gatilho, com `alterado_por`
nulo quando veio de sync e preenchido quando veio de tela. Só esses campos: valor
e produto mudam a cada sincronização e virariam ruído. Um contrato que troca de
unidade troca de dono do royalty, do CAC e do ranking; mudança assim não pode
mais acontecer em silêncio.

**Corrigido junto:** duas divergências vivas entre Pipedrive e Ops, Pamonha Doce
(Curitiba → São Bernardo) e Lisart (Belém → Maceió), as duas já registradas na
tabela nova.
## [2026-09-18] Filtros de múltipla escolha e situação por produto na lista de oportunidades

**Contexto:** o dono pediu para selecionar mais de uma opção em cada filtro e relatou que, ao escolher um produto, não conseguia distinguir na lista o que está validado, o que não está e o que ele já abordou — o que tornava difícil enviar oportunidades ao Pipedrive.

**Decisão — filtro múltiplo.** Dentro de um filtro as opções marcadas somam (OU); entre filtros vale a interseção (E); filtro vazio não restringe. Vale para Unidade, Origem da base, Faturamento anual, Faturamento estimado Driva, Segmento, Regime, Contato e Situação no produto, e na aba Recon para Classificação, Unidade e Contato. **Produto da lista continua valor único**: ele define o produto da lista e do card no CRM (uma lista, um produto — estudo de 17/09). Mudança de filtro continua limpando a seleção (entrada de 16/09). "Limpar filtros" preserva o produto escolhido.

**Decisão — perfil e abordagem por linha.** Com produto escolhido, cada conta mostra duas dimensões separadas: perfil (`oferta`: Apta · validada / A confirmar / Fora da regra, com o motivo) e abordagem no produto, lida dos dados que a tela já carrega: negócio aberto (etapa, dono, link), envio registrado ainda sem negócio sincronizado, negócio encerrado (ganho/perdido, data e motivo), item em lista salva (e se o sócio validou) ou nunca abordada. Negócio perdido é histórico e não bloqueia nova oferta: a disponibilidade continua exatamente a regra do servidor. "Apta · validada" refere-se ao perfil do produto; a validação do sócio aparece à parte.

**Decisão — atalhos para enviar.** Contadores clicáveis (Prontas para enviar, A confirmar, Aptas já em trabalho, Fora da regra), filtro "Abordagem no produto", botão "Selecionar prontas (N)" — seleciona todas as aptas e disponíveis do filtro atual, inclusive fora da página, nunca contas ocultas —, prontas primeiro na ordenação e colunas de situação e abordagem no CSV exportado. O envio direto segue recalculando e enviando só aptas e disponíveis. Em Consultoria, "A confirmar" é a base retroativa com regime pendente (o mesmo número do cartão); "Dados a confirmar · todas as pendências" inclui origem pendente e conflitos de identidade.

**Ajustes da revisão adversarial (mesma data):** envio e lista aceitam até 300 contas por vez (mesmo limite do servidor); "Selecionar prontas" pega as 300 primeiras na ordem da tabela e os botões explicam quando a seleção passa disso. O envio abre sobre uma cópia da seleção, para o resultado não perder nomes quando as contas enviadas saem do filtro. Reserva cujo negócio já chegou do Pipedrive é mostrada pelo negócio (aberto, ganho ou perdido), não como "envio registrado"; envio incerto tem texto próprio. Negócio do pipe sem o campo Produto aparece como tal e deixa de contar como "sem negócio neste produto" — sem mudar a regra de disponibilidade. Data de ganho usa `won_on`, com o horário UTC do Pipedrive convertido. A situação padrão do produto aparece marcada; desmarcar tudo significa todas as situações. Filtros de múltipla escolha não ficam dentro de `<label>`. O estado por conta+produto é calculado uma vez por carga (índices de negócios, reservas e listas).

**Pergunta ao dono, sem mudança de regra:** a disponibilidade (regra do servidor) não bloqueia conta com negócio GANHO no mesmo produto; "Selecionar prontas" pode incluí-la, e a linha mostra "Abordada antes · ganho". Manter ou bloquear é decisão de produto.

**Fora do escopo:** envio do Recon ao CRM (depende do funil do Conciliador — estudo de 17/09, Etapa B) e seleção persistente entre filtros.

**Status:** branch `feat/filtros-multiselecao-20260918`; testes do repositório 90/90. Publicação pendente de confirmação do dono: a CLI da Vercel desta máquina está logada em conta sem acesso ao time `planning17`.

## [2026-09-18] Fila "Validar origem" resolvida por regra, Receita Federal como evidência e limpeza da importação das unidades

**Contexto:** o dono pediu para aumentar as listas aptas por produto e disse "não quero praticamente nada pra confirmar ou validar aqui; já te passei um monte de informações relevantes". A fila tinha 2.263 contas com origem a confirmar e a Consultoria mostrava 303 aptas contra 2.734 com regime a confirmar.

**Decisão — regras de origem aplicadas como validação registrada** (responsável "Pedro Luca — regras de origem de 17/09 e instrução de 18/09", evidência por conta em `ops.base_origem_validacoes`; 1.871 contas: 1.494 antigas, 377 novas):
- Curitiba sem contrato de serviço no Omie: vale a data de inclusão do cliente no Omie de Curitiba (`info.dInc` dos aplicativos Curitiba, Planning CWB 01 e CWB 02). Antes de abril/2025 = Base Antiga; a partir de maio/2025 = Base Nova; abril continua pendente. Complementa a decisão de 17/09 (vigência do contrato) só onde não há contrato; não a substitui.
- Fora de Curitiba, sem registro no Omie nem no Pipedrive e com unidade definida = Base Antiga (ou Base Nova quando o Pipefy já declarava Base Nova). É a leitura da regra do dono de 17/09 aplicada à fila, por instrução explícita.
- Conta de Curitiba com registro no Omie de outra unidade (quase sempre a Matriz) = Base Nova, pela mesma regra.
- Registro no Pipedrive sem unidade responsável = Base Nova.
- Continuam pendentes (~390): contas sem unidade e sem CNPJ (cadastro incompleto), Curitiba fora dos três aplicativos Omie, abril/2025 e identidade divergente.
Reversão: apagar as validações com esse responsável e as correções geradas em `ops.base_alteracoes`.

**Decisão — Receita Federal como evidência tributária e de segmento.** Consulta em lote de 9.117 CNPJs gravada em `ops.base_enriquecimento_cnpj` (fonte "Receita Federal · consulta em lote 18/09/2026"). Opção Simples "Sim" = Simples Nacional (ou MEI); "Não" = excluída do Simples; "Outros" = nunca optou (sem registro de opção; 81% porte Demais, inclui S.A., associações e condomínios) — as duas últimas contam como fora do Simples. Regime e segmento entram no perfil só onde estavam vazios; o segmento vem de uma tabela fixa CNAE-divisão → opção do Pipefy e também é gravado no Pipefy só onde vazio. Situação cadastral, porte, capital social, natureza jurídica, CNAE e município ficam na ficha como informação. A consulta não traz faturamento; porte e capital social não viram faixa. A inferência de faixa pelo porte (ME/EPP) foi recusada pelo dono em 18/09 e não foi aplicada.

**Decisão — limpeza autorizada.** 38 duplicados da importação consolidados no cadastro antigo (CNPJ, unidade e origem completados; registro novo apagado), 35 cadastros de teste da planilha de São Luís/Campo Novo removidos do Pipefy e do Brain, 1 contato ligado à empresa errada removido. No Brain só saíram linhas criadas no mesmo dia para os registros apagados, numa transação com travas por chave estrangeira.

**Efeito medido com o código do app:** Consultoria retroativa de 303 para ~3.000 aptas; regime a confirmar na base retroativa de 2.734 para algumas dezenas. Das aptas, parte está baixada/inapta/suspensa na Receita — a situação aparece na ficha; excluir empresas fechadas das listas depende de decisão do dono.

**Correções de 19/09, após verificação independente (somente leitura, com contestação adversarial):** 19 contas validadas como Base Antiga pela regra "sem vínculo" tinham cadastro no Omie fora de Curitiba por CPF (clientes pessoa física que `ops.base_cnpj` não liga) e foram revalidadas como Base Nova. Em Maceió, a Receita mostrou que 65.571.993/0001-05 é W BARROS COMERCIO DE ALIMENTOS e 62.132.065/0001-48 é SL INFINITY IMPORTACAO E EXPORTACAO: registros renomeados, contato duplicado removido, contatos corretos recriados. Evidência da Receita da TERRIA INCORPORADORA corrigida para fora do Simples (exclusão em 31/08/2026). Resíduos no Brain removidos (2 contatos apagados no Pipefy, 25 evidências de CNPJs de teste). Segmento: 6 valores preenchidos no CRM que tinham sido substituídos pela Receita via Pipefy foram restaurados; 76 segmentos de texto livre da Driva ficaram com o da Receita (CNAE oficial, vocabulário do Pipefy). 

**Pendências de regra registradas:** (1) 82 contas de Curitiba com registro também na Matriz voltaram para "confirmar" porque `ops.base_unidade` passou a traduzir 'matriz' → 'goiania' e mudou o fingerprint; 71 delas têm cadastro em Curitiba anterior a abril/2025 — o dono precisa dizer se registro na Matriz torna a conta base nova. (2) 760 das 3.020 aptas de Consultoria estão baixadas, inaptas ou suspensas na Receita; `oferta()` não olha situação cadastral. (3) 206 baixadas foram "excluídas do Simples" na data da baixa — eram optantes até fechar.

## [2026-09-19] Empresa inativa na Receita sai das ofertas e vira lista à parte; porte vale como teto, não como faixa

**Contexto:** medida a base com o código do app, 760 das ~3.020 aptas de Consultoria estavam baixadas, inaptas ou suspensas na Receita, e o dono pediu: "deixa as inaptas ali como uma lista que em algum momento talvez possa servir para um serviço futuro, como para legal". Sobre faturamento: "trabalha com o que tiver, e logo mais eu volto com o DataStone".

**Decisão — situação cadastral é gate de oferta.** `situacaoForaDeOferta()` em model.ts: conta com `perfil.situacao_receita` diferente de 'ativa' fica `fora_regra` nos quatro produtos (Consultoria, Cella, Finance e Recon), com o motivo nomeando a situação e a fonte. Conta com mais de um CNPJ é ativa se qualquer CNPJ estiver ativo. Elas não somem da base: há filtro "Situação na Receita" na carteira e selo na linha, e a lista completa foi exportada (1.206 empresas: 809 baixadas, 350 inaptas, 47 suspensas) para o serviço futuro. A mesma regra vai ao servidor na migration `20260919120000_situacao_receita_e_teto_porte.sql`, aplicada junto com a publicação.

**Decisão — porte é teto legal, não faixa.** Sem faixa declarada, `perfil.faturamento_teto` (ME 0,36 · EPP 4,8, em R$ mi) entra como limite superior: resolve o corte do Finance (abaixo de R$ 25 mi) e exclui de Cella, nunca cria apta em Cella e nunca substitui faixa declarada ou revisão do editor de lista. Na tela aparece como "Até R$ X mi · teto pelo porte (Receita)". Isso substitui a tentativa recusada em 18/09 de gravar faixa a partir do porte.

**Efeito medido (régua com o código do app, 19/09):** Consultoria 4.733 na base retroativa, 2.331 aptas e 27 a confirmar; Cella 63 aptas e 3.985 a confirmar (eram 6.172); Finance 160 aptas (eram 140); Recon 31 no radar e 7 aptas; fila "Validar origem" em 379. Antes da publicação, a tela continua contando as inativas como aptas em Consultoria (~3.020).

**Curitiba:** por instrução do dono ("já te passei a regra de Curitiba, toma ela como premissa"), a data manda mesmo quando há registro no Omie de outra unidade; abril/2025 conta como Base Antiga, porque só o que é posterior a abril é Base Nova. Onde não há vigência de contrato, vale a data de inclusão do cliente no Omie de Curitiba. Isso resolveu 95 contas e revogou a leitura anterior, que tratava registro na Matriz como base nova.

## [2026-09-19] Correções da revisão adversarial das duas regras novas: um motivo de exclusão não pode virar outro

**Contexto:** rodada de revisão adversarial (código e dados, com contestação independente) sobre as duas regras da entrada acima. As regras em si passaram — a decisão de quem é apta está certa nos dois lados, cliente e servidor bloqueiam o mesmo conjunto, e a gravação no banco não tem divergência. O problema estava no que as outras telas passaram a **dizer** sobre as 1.206 contas que saíram: um motivo de exclusão estava sendo contado como outro.

**Decisão — exclusão por situação cadastral é contada à parte da exclusão por regime.** O cartão de Consultoria e o painel "De onde vem a base" diziam "2.375 retroativas excluídas por Simples/MEI", e 820 delas eram empresas baixadas, inaptas ou suspensas cujo regime nunca foi avaliado. Agora são duas contagens: 1.555 por Simples/MEI e 820 por situação na Receita, esta última nomeando a lista à parte. O número certo do Simples é o que o dono lê para decidir o que fazer com a carteira retroativa.

**Decisão — Recon ganha grupo próprio para empresa inativa.** `grupoRecon` mapeava qualquer `fora_regra` para `abaixo_corte`, cujo rótulo é "Até R$ 5 mi": com a regra nova, 1.190 contas sem nenhuma apuração de faturamento passaram a ser classificadas — em contador, filtro, linha e CSV — como faturando até R$ 5 milhões. Grupo novo `inativa` ("Inativa na Receita · baixada, inapta ou suspensa"), testado antes do corte de faturamento e na mesma ordem de `ofertaRecon`, fora do radar. O grupo "Até R$ 5 mi" volta a 168.

**Decisão — a gate tem caminho de volta pelo produto.** `Revisao.situacao_receita` no editor de lista (só aparece quando a conta não está ativa), aceito por `oferta()` e pela função do servidor. Sem isso, uma das 47 suspensas que regularize a inscrição ficaria fora dos quatro produtos até alguém rodar um script fora do app. Faixa e regime revisados continuam **não** reabrindo empresa fechada.

**Decisão — a ordem da guarda é a mesma nas duas pontas.** A situação passa a ser checada no wrapper `ops.monetizacao_offer_issue` logo após identidade e **antes** de cadastro ausente e da origem de Consultoria, como no cliente. Motivo: baixa na Receita é definitiva, cadastro ausente e origem pedem ação humana. O motivo gravado na auditoria passa a ser o mesmo que a tela mostra (386 contas não ativas têm origem ≠ 'antiga' e registrariam o motivo errado).

**Outras correções:** o CSV da carteira ganhou "Situação na Receita", "Fonte da situação" e "Conflito de faturamento", e a coluna de faturamento passou a exportar o mesmo texto da tela (era `a.band` cru, vazio nas 5.168 contas com teto); filtro e ordenação por faixa passaram a enxergar o teto, com opções próprias "Até R$ 0,36/4,8 mi · teto pelo porte" ("Não informado" virou "Nada informado" e agora quer dizer sem faixa **e** sem teto); a Base de clientes deixou de rotular empresa fechada como "A qualificar"; 15 contas com faixa declarada acima do teto legal do porte acendem aviso na linha e no CSV, sem mudar a decisão (a faixa declarada segue mandando); rótulo de situação unificado num mapa só, sem valor cru na tela.

**Decisão — o script de gravação passa a ser idempotente.** `receita/situacao-e-teto.py` reescrevia por merge e nunca removia chave: conta que ganhasse um CNPJ de porte "Demais" manteria o teto antigo, e conta que perdesse os CNPJs manteria a situação antiga. Agora cada rodada reavalia toda conta com CNPJ mais toda conta que já tem as chaves, e remove o que deixou de valer. Hoje o estado está limpo (0 divergências), então nada muda nos números — a correção é para a base se mover sem deixar resíduo sustentando oferta.

**Pendência aberta:** 151 contas têm CNPJ e nunca entraram num lote da Receita (154 CNPJs) — para elas a regra não existe e o filtro não as distingue das 740 contas sem CNPJ nenhum. Lista exportada para entrar na próxima consulta; a saída é consultar, não sinalizar na tela.

**Status:** branch `feat/filtros-multiselecao-20260918`; 95 testes do repositório passando (4 novos: guarda do Recon, precedência da situação sobre revisão de faixa/regime, filtro e ordenação por teto, conflito faixa × porte) e `tests/situacao-receita-teto.sql` (18 casos de paridade cliente/servidor, rodado em `pg_temp` contra o Postgres de produção sem tocar no schema `ops`). Publicação e migration continuam pendentes de confirmação do dono.

## [2026-09-21] Respostas do Eliezek às quatro pendências da importação das unidades, e a publicação

**Contexto:** as quatro pendências abertas desde 18/09 foram levadas ao grupo Team Planning Brain e respondidas pelo Victor Eliezek em 20/09.

**1 — Sorocaba (311 empresas retidas).** "Pergunta para Ana pf o email do financeiro e pode criar a unidade." A unidade **pode** ser criada no Pipefy; falta só o e-mail financeiro, que a Ana (Carvalhais, controladoria) tem. As 311 entram assim que a unidade existir.

**2 — 274 ex-clientes de Curitiba (só contrato cancelado no Omie).** "Entra mas considera como churn da base antiga e não como cliente ativo. Churn base antiga não entra nas métricas do brain em nada, apenas registro no pipefy e banco." Decisão: entram no catálogo como Base Antiga **marcados como churn**, e churn de base antiga não conta em nenhuma métrica, contagem de produto, carteira de sócio ou lista de oferta — é registro histórico no Pipefy e no banco, nada mais. Implementação pendente: precisa de marca própria na conta e de exclusão explícita das ofertas e dos contadores, não basta importar.

**3 — Corte de abril/2025 em Curitiba (7 empresas).** "Pós abril/2025 é considerado base nova." Confirma a premissa aplicada em 19/09: contrato que começa **em** abril/2025 é Base Antiga; só o posterior a abril é Base Nova. As 84 validações de abril gravadas como antigas seguem válidas; as 7 retidas resolvem por essa régua.

**4 — A empresa de Curitiba ligada a mais de uma unidade.** "Tem que entender qual a empresa, pode acontecer de serem contratos distintos." Apurado: é a conta `e0401900797cfff5`, que juntou **duas empresas diferentes** pela mesma organização do Pipedrive (org 55503) — "Cambraia Hotel" (CNPJ 45.896.637/0001-46, unidade Curitiba, Omie Curitiba) e "Cambraia & Fonseca LTDA" (**sem CNPJ**, unidade gravada como o id cru `1436672162`). Não são dois contratos da mesma empresa: são duas razões sociais do mesmo grupo econômico. Achado colateral: **165 empresas** têm `unidade` gravada como esse id `1436672162`, que não existe em `ops.unidades` — o id do Pipefy nunca foi traduzido para nome de unidade. Isso é causa de conflito de unidade além deste caso.

**Publicação (21/09).** Branch rebaseada sobre `origin/main` (que tinha andado três commits: ver-como, funil de CAC e acessos), commit `fb9c12a` em main, deploy por CLI no projeto `ops-brain` do time `planning17` e migration `20260919120000` aplicada em seguida. Verificação: produção serve o bundle com a regra nova, os 18 casos de `tests/situacao-receita-teto.sql` passam contra a função viva, e o wrapper passou a devolver o motivo de situação (antes devolvia o de origem) nas contas não ativas com origem ≠ 'antiga'. Backup do texto anterior das duas funções guardado para rollback.

## [2026-09-21] O card da carteira para de afirmar censo: CNPJs distintos como tamanho, procedência declarada

**Contexto:** o dono olhou a grade de carteiras e disse que o número não reflete o tamanho da unidade — "nenhuma unidade tem menos de 1K de CNPJs", contra cards de São Luís 256, Fortaleza 260, Campo Novo 246. A apuração (spec `docs/spec-cockpit-da-base.md`, rodada adversarial de 21/09) mostrou que o problema não é contagem errada: é o card afirmar censo sobre um número que só cobre o que foi conciliado.

**O que o número era.** `accounts.length` das contas da unidade, rotulado "contas". Mistura três coisas: não é CNPJ (uma conta reúne vários), não é empresa do catálogo, não é cliente faturado. E a cobertura por praça é desigual — Fortaleza, Recife, São Bernardo, Sorocaba e São Paulo não têm credencial em `ops.omie_credentials`, então delas só se enxerga o catálogo Pipefy.

**Decisão — três linhas, nada mais.**
1. Número dominante = **CNPJs distintos**, rotulado "empresas". Responde "tamanho da unidade". Encolhe em toda praça (Curitiba 2.854 → 2.791, Belém 360 → 282, Patos 161 → 135) porque conta que reúne vários CNPJs deixa de contar como um.
2. Linha de **procedência**: `catálogo Pipefy N · Omie M`, ou `Omie não integrado`. As fontes se sobrepõem e não somam. Selo "cobertura parcial" na face quando não há Omie.
3. Linha de **ação**: aptas em Consultoria, com selo do que falta confirmar. `N contas conciliadas` desce para linha de apoio — continua existindo, com o rótulo honesto.

**Onde o número vive.** View nova `ops.monetizacao_unidade_cobertura` (migration `20260921160000_cobertura_por_unidade.sql`), lida junto de `monetizacao_unidades` em `functions.ts`. O vínculo conta↔unidade da view **reproduz o do cliente** (`use-monetizacao.ts`: por `unidade_id` quando existe, senão por rótulo/chave no perfil) — conferido unidade a unidade contra a tela: Goiânia 3.110, Curitiba 2.854, Maceió 582, São Bernardo 454, Belém 360, Sudeste 318, Fortaleza 260, São Luís 256, Campo Novo 246, Patos 161. A procedência do Pipefy também casa por nome quando falta `unidade_id`, senão São Bernardo (451 CNPJs, todos do Pipefy) declararia "Pipefy 0".

**Integrada é a unidade cujo Omie chega aqui** (`cnpjs_omie > 0`), não a que tem credencial cadastrada: as credenciais de Matriz e Partners respondem por Goiânia e a string não bate com a praça.

**Ressalva registrada:** 8 CNPJs (de 9.247) aparecem em duas contas na conciliação — 0,08%. A contagem da view usa `count(distinct cnpj)` e não é afetada; o defeito de conciliação fica anotado.

**Card de produto.** Passa a ter uma métrica dominante ("N aptas e disponíveis") com o perfil aderente como prova secundária. As contagens que já estavam na faixa de KPIs logo acima saíram do card — eram a mesma informação duas vezes. O parágrafo âmbar de quatro cláusulas da Consultoria virou selo na face; a separação entre exclusão por Simples/MEI e por situação na Receita subiu para o KPI.

**Não entrou nesta rodada** (segue na spec): os quatro blocos numa página só (funil / oportunidades por produto / base por unidade / montagem de lista), o fluxo "clicar na unidade → auditar nominalmente → pesquisar → montar lista" como navegação real, e a persistência do rascunho.

**Pendência que a apuração levantou e precisa de decisão:** Recife tem 385 contas e **não aparece em card nenhum** por falta de linha em `ops.monetizacao_unidades`; São Bernardo (454) só aparece por casamento de string. São 839 contas de duas praças reais invisíveis na grade, independentemente do redesign.

## [2026-09-21] Auditoria de segurança do Mikael: o que se confirmou, o que não, e o que foi fechado

**Contexto:** Mikael rodou auditoria no banco único (Growth + Financeiro + Ops) e mandou `RECADO-OPS-FINANCEIRO.md` com quatro achados, pedindo que cada vertical analisasse o que é seu. Verifiquei os quatro no banco antes de aceitar qualquer um.

**Item 2 — rotinas do Ops sem login: CONFIRMADO, e a causa é outra.** O documento atribui a brecha a grants para `anon`. Não é: a execução vinha de **`PUBLIC`** (ACL `=X/postgres`). Revogar de `anon` é no-op — fiz isso primeiro e o teste mostrou `anon=True` depois da revogação. A correção certa é `revoke execute ... from public`. Aplicado em `broker_cac_sync()`, `propagar_cnpj_do_pipefy()`, `propagar_filiais_do_pipefy()` e `reconciliar_contrato_omie(text)`; `service_role` mantido. Conferido pelo efeito, não pela ACL: chamada pela chave pública passou a devolver 401 `permission denied for function`. Nenhuma das quatro é chamada pelo app (grep em `src/`: zero).

**Correção ao documento — a quinta não existe.** `registrar_alteracao_contrato()` retorna `trigger`. PostgREST não expõe função de gatilho e chamada direta é recusada pelo próprio Postgres. Eram quatro, não cinco.

**Correção ao documento — o mecanismo é o schema, não a função.** Medi 207 funções com EXECUTE para `anon` nos três schemas, incluindo escritoras do Financeiro (`fn_promover_stage_para_lancamentos`) e do Growth (`dist_regra_set`). Elas não são alcançáveis porque `anon` **não tem USAGE** em `financeiro` nem em `growth` — testado: os dois devolvem 401 `permission denied for schema`, o Ops devolve 200. O portão é o USAGE do schema. A conclusão dele ("só o Ops está aberto") está certa; a razão, não.

**Item 3 — backup de permissões aberto: CONFIRMADO, com uma ressalva.** `ops._can_antes_20260915` era a única tabela do Ops sem RLS, com SELECT/INSERT/UPDATE/DELETE para `authenticated`. Mas `anon` **não** lia (`has_table_privilege` falso), então era exposição a usuário logado, não anônima. Não apaguei: revoguei os grants e liguei RLS sem policy. 2.624 linhas e 41 usuários preservados.

**Item 4 — grants amplos: CONFIRMADO, número diferente.** Medi 303 tabelas com INSERT para `authenticated` (156 Ops, 97 Financeiro, 50 Growth), não 372 (215/105/52). A diferença provavelmente é contagem por união de INSERT/UPDATE/DELETE ou inclusão de views. O achado se sustenta; o número não bate e vale corrigir antes de virar meta.

**Item 1 — Financeiro:** não é nossa vertical e não toquei.

**Achado novo, que o documento não tem:** `anon` tem **0 tabelas** com SELECT no schema `ops` — a superfície anônima do Ops é só de funções. Isso torna `revoke usage on schema ops from anon` uma opção de baixo risco para fechar o resto de uma vez, em vez de caçar função por função. Não apliquei: fecha também as puras (`base_cnpj`, `base_unidade`) e é decisão que atravessa as três verticais.

**Reversão:** `grant execute on function ops.<nome> to public;` e `alter table ops._can_antes_20260915 disable row level security; grant ... to authenticated;`.

## [2026-09-21] A cobertura por unidade vira tabela: a view custava 1,3 s em cada carregamento

**Contexto:** logo depois de publicar o card novo, o dono reclamou que a tela ficou lenta ("Carregando carteira e operação…"). Era regressão minha, introduzida na mesma rodada.

**Medido, não suposto.** `ops.monetizacao_unidade_cobertura` como view custava **1.323 ms de execução** por carregamento, porque depende de `ops.base_conta_cnpjs` — `DISTINCT` + `UNION` com `NOT EXISTS` correlacionado sobre `monetizacao_contas × empresas`, que sozinha leva **2.539 ms**. Para comparação, todo o resto do payload da tela: `monetizacao_deals` 2 ms, `monetizacao_contas` 3 ms, `base_conta_estado` 5 ms, `monetizacao_itens` 3 ms. A view era ~200× a soma do resto.

**Decisão:** a cobertura vira **tabela** (`ops.monetizacao_unidade_cobertura`) alimentada por `ops.monetizacao_cobertura_refresh()`, agendada no pg_cron (`monetizacao-cobertura-10min`, jobid 4). Leitura passou de 1.323 ms para **0,08 ms**. O dado fica no máximo 10 minutos atrás, mesma ordem de defasagem do resto da carteira.

**Não é materialized view de propósito.** Matview ignora RLS — é exatamente o padrão apontado na auditoria de segurança do mesmo dia (relatório derivado que passa por cima da regra da tabela de origem). A tabela tem RLS ligada e policy de leitura para `authenticated`.

**Sem deploy.** Nome e colunas iguais aos da view, então o código do app não mudou: a correção é só de banco.

**Lição para a próxima:** medir o custo de qualquer objeto novo que entre no caminho de carregamento, antes de publicar. `explain (analyze)` na view teria mostrado 1,3 s em dez segundos de trabalho.
## [2026-09-18] A unidade "Matriz" passa a se chamar Goiânia

**Contexto:** o card com 3.270 contas na Base de clientes dizia "Matriz", e o dono corrigiu: quem atende cliente em Goiânia é a **Planning Auditores e Contadores SS LTDA** (`24.296.850/0001-47`), como qualquer regional. A **Planning Partners Brasil LTDA** (`58.565.726/0001-51`) é a matriz de fato, fica em Goiânia também e **não tem carteira**. Ou seja, "Matriz" não era nome de unidade, era papel da holding, e o rótulo atribuía à holding uma carteira que é da operação. A linha 9 de `ops.unidades` ainda carregava CNPJ e razão social da Partners.

**Decisão: muda o nome exibido, não o dado cru dos sistemas de origem.** `ops.unidades.nome_da_praca` e `ops.monetizacao_unidades.nome` passam a dizer "Goiânia", e o CNPJ da linha vira o da Planning Auditores (matriz e Filial 1, formato multi-linha igual ao de Curitiba). Os três apelidos que os sistemas gravam continuam existindo e continuam caindo na mesma unidade: Pipedrive (BU 694) grava `Matriz` em 145 contratos e 177 empresas, Pipefy grava `Goiânia / Matriz` em 10 sócios, Omie grava `Partners` em 566 contas a receber. Reescrever esse texto seria inútil: os syncs o regravam a cada rodada.

**Consequência: quem reconcilia é a normalização, então ela foi reescrita.** O token canônico de `ops.base_unidade` passa de `matriz` para `goiania`; `ops.base_intake_omie` e `ops.monetizacao_intake_ops` casavam por nome contra o literal `'Matriz'` e agora apontam para `'Goiânia'` aceitando os apelidos antigos; `ops.unidade_do_usuario` e `ops.unidades_do_usuario` ganharam o caso `goiania` para que o escopo de unidade siga enxergando linhas gravadas como "Matriz"; `ops.v_clientes_diretorio` mapeia `Partners` para `Goiânia`. Conferido depois de aplicar: as 3.270 contas do card continuam vinculadas à unidade 9.

**Fica de fora de propósito:** a policy `unit scope` de `ops.omie_clientes`, que mapeia `Partners` para `Matriz` e segue válida porque `matriz` continua no conjunto de apelidos do usuário; e a BU `Matriz` de `ops.v_rateio_cm_mensal`, que é rótulo de BU do Pipedrive, não esta unidade. Migration `20260918120000_unidade_goiania.sql`, aplicada em produção.

## [2026-09-21] Estratégia & Execução: a área nova do Brain, e os OKRs saem do Growth

**Contexto:** o dono pediu "uma área nova no Brain, o cockpit, com OKR, metas e dashboard do negócio", e, por ora, só o módulo criado e a área de OKR movida para lá. A tela de OKRs estava em `planningbrain.com.br/growth/okrs` — repo `brain-web`, Next.js com `basePath: /growth`. Ela nunca foi de Growth: o quadro cobre os dez departamentos da Expansão Nacional (CEO, Operações, Relacionamento & CS, Auditoria & Qualidade, Novos Sócios, Performance & Tech, Comercial, Receitas, Marketing, Rotina Semanal), e morar dentro do produto do comercial a escondia de quem não entra lá.

**Decisão — a área nasce no Ops, não no Growth nem em app novo.** O Ops é a casca do apex e é dele o conceito de área (`ops.areas` + `src/lib/areas.ts`, fonte única da lateral e da porta de entrada). Foi ali que "metas" e "dashboard do negócio" vão encostar: IDU, Pacto Trimestral, indicadores e o painel financeiro já são dado do Ops. As alternativas foram descartadas na conversa: uma frente dentro do `brain-web` deixaria a URL com `/growth` no meio do caminho de uma área que não é de Growth; um quarto projeto na Vercel duplicaria sessão, navegação e tema por uma tela só.

**Nome:** o dono descartou "Cockpit" porque a porta de entrada já descreve o Brain Financeiro como "Cockpit, fluxo de caixa, DRE e inadimplência" — duas coisas com o mesmo nome na mesma tela. Ficou **Estratégia & Execução**, slug `estrategia`, `ordem = 5` (primeira da lista) e `escopo = 'nenhum'`: não existe OKR "do Rio de Janeiro" neste quadro, filtrar por unidade aqui não significaria nada.

**O que foi portado e o que ficou:** a camada pura (`tipos`, `normalizar`, `dashboard`, `campos`, `vazao`) veio sem mudança de regra. O `brain.ts` mudou só de fonte — lia o projeto Supabase do Growth, agora lê o schema `growth` do banco único, com service role (`client.growth-schema.server.ts`). As cinco rotas de API do Next viraram server functions (`src/lib/okrs.functions.ts`). O cache do Next (`revalidateTag` + `next.revalidate`) virou cache de processo com TTL de 5 min, estourado pelo botão "Atualizar agora" — mesmo comportamento visível.

**Conferido antes de dar por feito:** o quadro montado pelo código novo bate número a número com o print da tela do Growth — ritmo 49%, esperado 34%, saúde 7/9/7/13 e 63 sem medição, confiança 12 com ponteiro real · 24 só execução · 63 sem medição, 99 KRs em 10 departamentos.

**Duas chaves, não uma:** `view.okrs` e `manage.okrs`. A tela GRAVA no ClickUp (status de ação, ponteiro da KR, KR e ação novas), e quem só acompanha o ciclo recebe a primeira e vê a mesma tela sem os campos de escrita. No Growth não havia esse corte: todo departamento liberado via e editava.

**Quem entra, de propósito conservador:** `admin`, `diretor`, `head` e `diretoria_comercial`. `socio`, `socio_regional` e `auditor` entram como linha explícita negada — o quadro é da matriz, e o sócio acompanha o próprio desempenho no IDU e no Painel da Unidade. **Consequência assumida:** no Growth qualquer pessoa liberada via os OKRs, inclusive os ~15 do comercial; várias delas não têm papel no Ops. Quem perder a tela volta com um clique em /admin/permissoes.

**O token do ClickUp:** no `brain-web` era variável de ambiente `sensitive` na Vercel. Aqui o leitor aceita `CLICKUP_API_KEY` do ambiente **ou** a linha em `ops.integracoes_segredos`, editável em Administração › Chaves de Integração — trocar o token deixa de exigir deploy. O cache dele é de 1 minuto, não permanente, para não existir instância servindo com token velho até o próximo deploy.

**O que NÃO se moveu, e por quê:** `/api/okrs/snapshot` e a lib de leitura continuam no `brain-web`. É o cron diário do GitHub Actions (repo `marketing-planning`) que alimenta `growth.okr_snapshot` com Bearer próprio; mover cron com segredo é outra tarefa, não o mesmo gesto de mudar uma tela de lugar.

**Decisão do dono, no fim da sessão — a mudança vai em DOIS passos.** "Crie apenas o módulo por enquanto, não publique a mudança do OKR para outro módulo." Então o `brain-web` voltou INTACTO ao commit `3faba58`: a lateral do Growth continua com o item OKRs, `/growth/okrs` continua servindo a tela, e a matriz de acesso de lá segue com a tela `okrs`. Ninguém do comercial perde nada, e nenhum link antigo quebra.

**Consequência assumida enquanto o passo 2 não vem:** a tela existe nos dois lugares, lendo o MESMO space do ClickUp. Não há divergência de dado possível — o ClickUp é a fonte, e as duas leituras usam a mesma régua, conferida número a número. O que existe é código duplicado, com prazo: o passo 2 é tirar a tela do `brain-web` (sidebar, matriz de acesso, componentes e as quatro rotas de escrita), deixando `/growth/okrs` como porta que redireciona preservando `?depto=` e `?faixa=`. Só o `snapshot` fica.

Migration `20260921170000_area_estrategia_execucao.sql`.

## [2026-09-21] Cadastro de sócio deixa de ser texto solto e passa a apontar para a unidade

**O pedido:** cadastrar os sócios das unidades no Ops sem liberar acesso, só para conferir se os dados estão certos. No meio da conversa o dono corrigiu o alvo: o que ele quer é **vincular o sócio à sua unidade**, porque é esse vínculo que libera "os dados da minha unidade".

**O que a apuração encontrou:** `ops.socios` nunca participou de escopo nenhum. Quem libera dado por unidade é `ops.usuario_unidades (user_id, unidade_id)`, lida por `minhas_unidades()` e `current_user_unidade()`. `socios.unidade` era texto livre, sem FK, divergindo do cadastro em dois pontos ("Goiânia / Matriz" contra "Goiânia", "São Luís" contra "São Luis"), e servia só para montar o bloco "Sócios & contatos" da página Rede. Os 34 sócios da planilha `Planning Expansão/Dados/Relação de sócios.xlsx` já estavam carregados desde antes, todos sem login.

**Consequência que estava escondida:** como `usuario_unidades` exige `user_id`, não existia forma de prender um sócio à unidade antes de ele ter conta. E são dois passos, não um: `adminCreateUser` (`/admin/usuarios`) grava `socios.user_id` mas **não** grava `usuario_unidades`; o escopo só entra depois, no botão "Escopo", por `salvarEscopoDoUsuario`.

**A decisão:** separar cadastro de acesso de vez. `socios.unidade_id` (FK para `ops.unidades`, migration `60_socios_unidade_id.sql`) guarda a que unidade o sócio pertence, valendo com ou sem conta. Não concede nada — quem concede segue sendo `usuario_unidades`. No dia em que o login for criado, o escopo já está definido e correto. O backfill resolveu 35 de 36 pelo texto livre, tratando os dois apelidos; sobrou só São Paulo.

**São Paulo virou unidade `interna` (migration `62_unidade_sao_paulo.sql`).** O dono decidiu: "São Paulo é uma unidade que não faz parte do projeto de expansão por rede, Marcos Amorim pode mover sim para SP". Entrou no molde de Goiânia, Consultoria e Construção Civil — sem royalties, sem CAC, sem absorver mídia, sem data de inauguração. Como royalties, NPS, saúde de carteira e contatos de CS filtram `tipo = 'regional'`, a unidade nova não entra em nenhum desses fluxos. Antes disso, Marcos Amorim era o único sócio invisível na interface: a página Rede lista por unidade cadastrada e "São Paulo" não existia.

**A conta de teste "Victor Unidade" foi revogada (migration `61`).** Criada para validar o "ver como a unidade" (ver entrada de 18/09), tinha papel `socio_regional` e vínculo real com o Rio de Janeiro em `usuario_unidades`, ou seja, acesso de verdade aos dados da unidade, sem corresponder a sócio algum. Saíram o escopo, o papel e o cadastro falso em `socios`. **O usuário no Auth e o profile ficaram de pé de propósito**, para a revogação ser reversível; apagar de vez está como bloco comentado na migration.

**Estado depois:** 35 sócios, todos com `unidade_id`, zero nulos. Três ainda têm login: Italo Amaral (`socio_regional`, escopo Belém) e Pedro Henrique e Jordana (matriz, sem escopo de unidade, como esperado para diretoria).

**O alerta que fica registrado, e que não foi resolvido aqui:** só **6 policies** de RLS filtram por unidade (as 4 do módulo Gente, `contas_receber` e `gente_pesquisa_envios`). Nas demais tabelas o vínculo não isola nada. Dar login a um sócio regional hoje não o prende à unidade dele fora dessas telas — ele enxerga a rede inteira. O vínculo é condição necessária, não suficiente. Antes de abrir acesso a sócio, fechar o escopo das outras policies. Ver `feedback_rls_escopo_unidade_restrictive`.

As três migrations (`60_socios_unidade_id.sql`, `61_revogar_conta_teste_socio_regional.sql`, `62_unidade_sao_paulo.sql`) vivem no repo `AI Projects`, em `migrations/`, e já foram aplicadas no banco único `npknehhyyzelmrbbxvtu`.

## [2026-09-21] Escopo de unidade na RLS: de 6 para 20 policies RESTRICTIVE

**Continuação da entrada anterior.** Lá ficou registrado que o vínculo sócio→unidade era condição necessária mas não suficiente, porque quase nenhuma tabela filtrava por unidade. Aqui isso foi fechado.

**O furo, medido e não estimado.** Em sessão simulada do Italo Amaral (`socio_regional`, sócio de Belém, a única conta de sócio regional real com login), ele enxergava **4.178 empresas e 770 contratos** — a rede inteira. Só `omie_clientes` (227) e `gente_pessoas` (68) o travavam, porque eram as duas únicas com policy RESTRICTIVE de unidade. `contas_receber` era o caso didático: tinha a expressão de escopo correta, mas dentro de uma policy PERMISSIVE, ao lado de `role_based_read` e `Auditors can read`. PERMISSIVE combina por OR, então qualquer uma que libere passa por cima.

**A correção (`migrations/63_rls_escopo_unidade.sql`):** uma policy `escopo_unidade`, `as restrictive for all`, em 15 tabelas — 11 com coluna de unidade em texto (`empresas`, `contratos`, `central_tratativas`, `cs_onboarding_cards`, `nps_pesquisas`, `contratos_documentos`, `contas_receber`, `auditorias_internas`, `repasses_unidade`, `roas_por_unidade`, `vendas_servicos_unidades`) e 4 por id (`idu_metas`, `royalties_apuracao`, `royalties_faturas`, `cac_apuracao`). `gente_pessoas` e `omie_clientes` ficaram de fora porque já tinham a sua, com exceção própria (a própria pessoa; o apelido Partners/Matriz). RESTRICTIVE agora são 20, contra 6 antes.

**Em `for all` sem `with check`, o Postgres usa a expressão do `using` também na escrita.** Então o sócio também não grava linha de outra unidade, não só deixa de lê-la.

**A expressão ficou inline, não numa função, e isso foi medido.** A primeira versão envolvia a checagem em `ops.escopo_unidade_ok(unidade)`. Virou chamada por linha e o ensaio estourou o timeout do gateway em `contas_receber` (31 mil linhas). Inline, `(select ops.can(...))` e `(select ops.unidades_do_usuario())` são subconsultas não correlacionadas que o planner resolve uma vez como InitPlan; por linha sobra só `norm_unidade()`, que é IMMUTABLE. O `explain analyze` confirmou: 12 InitPlans e **127 ms** no mesmo scan. É também o formato que `omie_clientes` e `contas_receber` já usavam, então não é invenção nova.

**O susto dos 107 segundos não era a policy.** Foi lock: a requisição que estourou o timeout antes ficou com a transação viva segurando ACCESS EXCLUSIVE das tabelas, e o DDL seguinte esperou. Vale lembrar ao rodar DDL de RLS por HTTP.

**O time de CS/matriz teria sido atropelado, e a saída foi a flag.** Cinco pessoas (Bruno Subires, Daniele Andrade, Leonardo Gomes, Sarah Ferreira, Thais Gerlach) estavam com `todas_unidades = false` e as 14 unidades listadas uma a uma, o que dava no mesmo enquanto a trava não valia. Passando a valer, daria diferente: **749 linhas de `empresas` não casam com unidade nenhuma** e sumiriam da vista delas. A migration passa essas pessoas para `todas_unidades = true`, que é o que descreve o escopo real de quem cobre a rede inteira. **Isso preserva o que elas já viam, não amplia** — conferido antes e depois, 4.178 empresas nos dois lados.

**Achado de qualidade de base, que fica pendente:** as tais 749 linhas são 260 com `empresas.unidade` vazio e **489 com um ID numérico no lugar do nome da unidade** (`1448470601`, `1436672162`, `1436672193`, `1439568426`, `1436672221`, `1436672203`, `1124`). É sujeira de sync gravando id onde devia ir nome. O `DATA-RULES.md` manda filtrar por `empresas.unidade`, então isso contamina qualquer recorte por unidade, não só a RLS. Não foi corrigido aqui.

**Testes, todos com `rollback` antes de valer:** Italo caiu para 304 empresas, 97 contratos, 187 NPS e 47 cards de onboarding, batendo linha a linha com os números de Belém; `contas_receber` (734) e `gente_pessoas` (68) não mudaram, já estavam certos. Admin, sócio com todas as unidades, CS com todas e as duas pessoas de CS com lista não mudaram em nada. E o teste que o desenho existe para resistir: com uma PERMISSIVE `using (true)` adicionada em `empresas` e `contratos`, o Italo continuou vendo 304 e 97.

**Quem ficou travado depois:** 5 usuários, contra 10 antes. O Italo, e quatro contas sem papel algum (Alexandre Almeida, Eduardo Torres, Luiz Carvalho, Thiago Domingos), que já viam zero antes da mudança — conferido em sessão simulada. Os outros 36 seguem livres.

**Fail-closed de propósito:** travado sem nenhuma unidade em `usuario_unidades` não vê linha alguma, e linha com unidade vazia não aparece para quem é travado. Os syncs não sentem nada: rodam com `service_role`, que ignora RLS.

## [2026-09-21] MRR por cascata Omie > Pipefy > Pipedrive, e a data de assinatura que secou

**A pergunta que abriu isso:** por que a aba Contratos de `/clientes` mostra tanto cliente sem MRR e sem data de assinatura. Eram três causas independentes, não uma.

**1. O MRR só existia para quem tinha deal.** A tela casava `empresas.pipedrive_id` com `contratos.pipedrive_deal_id`. Dos 2.920 clientes das unidades regionais, 2.474 não têm `pipedrive_id`: entraram pelo pipe de Onboarding, são a base antiga que as unidades integraram e nunca passaram pelo Pipedrive. Sem deal, nenhum número. Não era bug de sync, era a régua da tela.

**2. O pipe de Contratos foi reestruturado e o sync não soube.** A fase "Vigente", de onde `pipefy-contratos-sync` lia `valor` e `data_de_assinatura`, virou "Enviar para Onboarding". Os campos que a operação preenche hoje ficam em "Nova Solicitação" e "Contrato Assinado", e o sync não os conhecia. Medição dos 460 cards em 21/09: `honor_rio_mensal` 358 preenchidos, `valor_total_do_contrato` 261, `data_da_venda` 261, `data_de_assinatura_do_contrato` 157, contra **1** no `data_de_assinatura` que era a fonte primária do código. O sync rodava de 15 em 15 minutos, reportando sucesso, lendo o campo mais vazio do pipe.

**3. A data de assinatura nunca saiu do sync; saía de um backfill que morreu.** `contratos.entrada_contrato_assinado_em` era preenchida por um trecho à parte de `~/sync_pipedrive_contratos.py`, que lia no `/flow` do Pipedrive a entrada no stage 170. A Edge Function que substituiu o script deixou o trecho de fora de propósito (custa uma chamada `/flow` por deal), e o LaunchAgent foi arquivado em 31/08. Último valor gravado: **29/07/2026**. 630 dos 770 contratos sem data, incluindo 100% dos ganhos de agosto e setembro.

**A ordem decidida pelo usuário:** tem no Omie usa do Omie, não tem puxa do Pipefy, não tem puxa do Pipedrive. A justificativa é a distância até o dinheiro: o Omie é o contrato de serviço que fatura o cliente todo mês, o Pipefy é o contrato jurídico assinado, o Pipedrive é a intenção comercial. Vale para MRR. Para data de assinatura a cascata começa no Pipefy, porque contrato de serviço do Omie só guarda vigência, não assinatura.

**"Data da Venda" não vira data de assinatura.** Decisão explícita do usuário, mesmo custando 195 contratos de cobertura. Só assinatura real entra.

**O que mudou no banco:** tabela `omie_contratos_servico` (contrato de serviço do Omie, `cabecalho.nValTotMes`, 1.784 linhas das 10 contas, 670 ativas somando R$ 1.949.169,39/mês); três colunas novas em `contratos_documentos` (`mrr_mensal`, `valor_total_contrato`, `data_venda`); a view `v_cliente_mrr`, que resolve a cascata por cliente e expõe `mrr_fonte`; e a função `contratos_propagar_data_assinatura_pipefy()`.

**Três bugs corrigidos em `pipefy-contratos-sync`:**
- `parseValor` apagava a vírgula em vez de tratá-la como decimal: `"17.526,00"` virava `"17.52600"`, ou seja mil vezes menos. 199 dos 234 valores gravados estavam abaixo de R$ 100.
- `parsePipefyDate` assumia MM/DD/YYYY com base numa medição de 24/08. Em 21/09 o pipe manda dd/mm/yyyy (92 dos 157 valores com primeiro componente maior que 12, nenhum com o segundo). Os 65 cards com dia até 12 gravavam dia e mês trocados, em silêncio, porque a data continua válida. A regra agora decide pelo que o valor prova e só cai em dd/mm no caso ambíguo.
- `empresa_id` nunca resolvia (0 de 460, com `empresa_id_resolvidos: 0` no log): a resolução dependia de `id_organiza_o_pipedrive`, campo da fase antiga, hoje vazio. Agora tenta primeiro o connector "Empresa" (a database canônica, 325 cards), depois o Deal ID direto, e só então o caminho caro pelo Pipedrive.

**A armadilha que custou uma execução quebrada, e que vale para o próximo:** o repo `planning-dashboard` estava **desatualizado em relação à produção** para `pipefy-contratos-sync`. A versão publicada tinha uma linha a mais, `import "../_shared/perfil.ts"`, que carimba `Accept-Profile: ops` em toda chamada ao PostgREST. Publicar a cópia do repo por cima derrubou a execução das 22:37 UTC com `existing.map is not a function` — sem o carimbo o PostgREST procura as tabelas em `public`, onde nenhuma existe, e devolve objeto de erro no lugar da lista. O arquivo `_shared/perfil.ts` agora existe no repo. **Antes de publicar qualquer Edge Function a partir deste repo, comparar com o que está em produção.** Outras 27 funções em produção sequer existem aqui.

**O que a cascata resolveu e o que não resolveu.** Clientes com MRR na tela foram de 263 para 624 (316 pelo Pipedrive, 308 pelo Omie). Sobram 2.296 sem número, e a causa é de origem, não de sync: 2.114 deles **não têm contrato em nenhum dos três sistemas**. Só 149 aparecem no Omie, sempre com contrato encerrado ou cancelado. A concentração é em São Bernardo (465 clientes, 15 com MRR) e Recife (385, nenhum), unidades novas cuja carteira entrou por cadastro. Isso é pergunta de qualidade de base: ou são clientes que ninguém contratou no ERP, ou `empresas` está guardando prospect junto com cliente.

**Escopo de unidade:** `omie_contratos_servico` nasceu no mesmo dia em que 15 tabelas ganharam policy RESTRICTIVE, e ganhou a sua. Não pela coluna `unidade`, que aqui é o nome do aplicativo Omie e não bate com `unidades.nome_da_praca` (Curitiba responde por "Curitiba", "Planning CWB 01" e "Planning CWB 02"), mas pelo CNPJ pertencer a uma empresa que a pessoa já enxerga — herdando o recorte de `empresas` em vez de repetir a regra.

**Agendamento (nuvem, nunca local):** `[Omie] Sync - Contratos de Servico` às 03:30 UTC e `[Pipedrive] Backfill - Data de Contrato Assinado` às 04:10 UTC, ambos no n8n, chamando as Edge Functions como wrapper fino.

## [2026-09-22] `empresas.unidade` guardava id do Pipefy, e Sorocaba inteira estava invisível

**Como apareceu.** Ao explicar por que São Bernardo (465 clientes) e Recife (385) tinham tanto cliente sem MRR, o usuário perguntou de onde saía esse volume. A resposta é `ops.empresas`, com o mesmo filtro da tela (`tipo_unidade = 'franquia'` e `unidade` entre as regionais). Mas a pergunta descobriu duas coisas maiores que a resposta.

**A base triplicou em cinco dias.** `ops.empresas` tinha **1.359** linhas antes de 17/09/2026 e recebeu **2.819** entre 17 e 21/09, chegando a 4.178. Só no dia 18 entraram 2.413. Todas com `fonte_cadastro = 'Pipefy'`, quase todas declaradas `origem_da_base = 'Base Antiga'`, nenhuma com deal. A database "[PTRS-DB-01] Empresas" do Pipefy tem 4.025 registros, então o sync está espelhando e não duplicando (só 14 CNPJs repetidos, 29 linhas). São as carteiras declaradas das unidades, subidas em lote e **ainda não conferidas contra contrato**: das 2.819, apenas 363 aparecem no Omie, 255 com contrato ativo, e 26 têm deal no Pipedrive. Isso corrige o que eu havia escrito na entrada anterior — não é "prospect misturado com cliente", é carteira declarada sem reconciliação.

**O bug: connector gravado como id.** 489 linhas tinham número no lugar do nome da unidade. A causa está em `pipefy-sync`:

```js
if (col === "unidade" && f.value.startsWith("[")) {
  const p = JSON.parse(f.value); update[col] = Array.isArray(p) ? p[0] : f.value;
}
```

O `value` de um campo connector é um JSON com os **ids dos registros** ligados (`["1448470601"]`), nunca o rótulo. `p[0]` é o id, e `empresas.unidade` é texto livre, então nada reclamava. Linha assim some de todo recorte por unidade: da tela, dos totais e da própria RLS, cuja policy de escopo compara `norm_unidade(unidade)`. **Sorocaba, com 311 clientes, não existia em lugar nenhum do Ops.**

`ops.unidades.pipefy_id` já era o de-para para desfazer isso, e estava preenchido para as unidades antigas. Estava vazio exatamente para Recife, São Bernardo, Sorocaba e as internas — por isso o estrago se concentrava nas unidades novas. O sync agora resolve o id por essa coluna; id sem unidade correspondente é devolvido como veio, de propósito, porque ficar visivelmente errado é melhor que virar nome inventado.

**Ids resolvidos:** `1448470601` = Sorocaba (confirmado pelo usuário), `1436672162` = Goiânia (casa com a `razao_social` registrada em `unidades`). Ficaram 13 linhas sem resolução, com id de registro que não é unidade em `ops.unidades`: Agronegócio (8), ROIT (1), Itaúna (1), Rascunho (1) e `1124` (2), que nem registro do Pipefy é.

**Duas armadilhas no caminho do backfill.**

1. A trigger `sync_empresa_to_pipefy()` recusa escrita direta em campo que pertence ao Pipefy e manda usar a fila de correção. A fila existe para **discordar** do Pipefy, e não era o caso: o connector sempre apontou para a unidade certa, o errado era a leitura deste lado. Por isso o backfill usou a porta que a própria trigger prevê, `set local planning.pipefy_ingest = 'on'` — ingestão corrigida, sem nada para empurrar de volta.
2. Devolver o nome não bastava: `/clientes` filtra também por `tipo_unidade = 'franquia'`, e as 311 de Sorocaba estavam com esse campo nulo porque quem o derivou na carga casou pelo **nome**, que nelas era um id. São Bernardo e Recife, da mesma carga e com nome legível, saíram com 'franquia'. A migration termina a mesma derivação, com escopo estreito: só a carga do Pipefy, só onde `unidade` já é regional.

**Fica pendente, e não foi tocado:** ~720 linhas sem `tipo_unidade` vindas de `basenps_reconciliacao` (223), `Omie` (203), `pipefy_legado_reconciliado` (150) e `pipedrive_sync` (139), todas anteriores a esta carga. Elas também não aparecem na tela. Mexer nelas aqui seria mudar o que Belém, Rio e Curitiba mostram de carona numa correção de outro assunto.

**Trava nova:** check `empresas_unidade_nao_e_id`, `NOT VALID`, bloqueia id numérico com 3+ dígitos se passando por nome. As 13 linhas não resolvidas seguem no banco; nenhuma nova entra.

**Card corrigido no Pipefy.** O 1440464579 (GRUPO MAGANHA) passou de `12.900.000,00` para `12.900,00` no honorário mensal, batendo com o total de 154.800,00. A trava de coerência na `v_cliente_mrr` continua como rede.

## [2026-09-22] `/clientes` mostrava 1.000 de 3.219 clientes: o PostgREST corta em 1000 e `.limit()` maior não adianta

**Sintoma relatado:** "muitos ainda continuam vazio nesta página", na aba Contratos de `/clientes`, com colunas ERP, Contrato Assinado em e Vendedor quase todas em "—".

**Achado maior que o sintoma.** O projeto Supabase tem `max-rows = 1000` e o PostgREST **ignora `.limit()` acima disso**: pedir 5000 ou 20000 devolve as mesmas 1000 linhas, HTTP 200, sem erro e sem aviso. Medido na API: `empresas?tipo_unidade=eq.franquia` tem 3.220 linhas e devolve 1.000 com `limit=5000` e com `limit=20000`.

Consequências nesta página, todas silenciosas:

- A lista mostrava **1.000 de 3.219** clientes de unidade regional. Os outros 2.219 não existiam para a tela.
- O card "MRR total" somava só essa fatia: **R$ 559.999 contra R$ 2.094.936** reais no mesmo recorte. Era 27% do valor.
- `v_cliente_mrr` (1.120 linhas) também vinha cortada, então ~120 clientes da cauda apareciam sem MRR e sem data de assinatura tendo os dois no banco.
- O balão de contatos lia 1.000 de 2.575 vínculos.

**Correção:** as quatro consultas da página passam a paginar por `range`, no mesmo padrão de `contatos-cs.functions.ts`, ordenando por chave única (`id`), porque ordenar por `razao_social`, que repete, pula e duplica linhas entre páginas.

**Fica registrado que o mesmo padrão existe em outros ~20 pontos do app** (`.limit(5000)` e `.limit(20000)` em `audit/data-context.tsx`, `painel-cs/*`, `saude-carteira.functions.ts`, `painel-unidade.tsx`, `roas/data-context.tsx`, entre outros). Nenhum foi tocado aqui: cada um muda um número que alguém já leu, e isso é decisão de quem lê, não efeito colateral desta correção.

**As colunas vazias, medidas uma a uma no recorte de 3.219:**

| Coluna | Preenchida | Onde nasce | Por que está vazia |
|---|---|---|---|
| ERP | 24 (0,7%) | `empresas.erp`, via `pipefy-sync` | A database `[PTRS-DB-01] Empresas` do Pipefy **não tem campo de ERP**. O `FIELD_MAP` do sync aponta para `erp`, `regime_tribut_rio`, `e_mail_fiscal` e `telefone_corporativo`, e nenhum dos quatro existe na tabela. A coluna nunca vai encher sozinha |
| Estado (uf) | 119 (3,7%) | `empresas.uf` | 2.819 têm CNPJ e não têm UF. O backfill de 15/07/2026 cobriu só as linhas de `pipedrive_sync` da época. 437 sairiam de graça do `omie_clientes.estado`, 2.382 dependem da BrasilAPI |
| Regime Tributário | 309 (9,6%) | `contratos`, campo de seleção do Pipedrive | 461 dos 770 contratos ativos têm o dado. O resto está vazio no próprio Pipedrive |
| Contrato Assinado em | 157 (4,9%) | cascata + `contratos` | Teto conhecido, registrado em 21/09. 238 dos 770 contratos têm data |
| Vendedor (closer) | 172 (5,3%) | `contratos.closer` | 527 dos 543 contratos sem vendedor estão com "Closer Responsável" vazio no Pipedrive. Os outros 14 são bug nosso, abaixo |

**A causa estrutural das três últimas:** 2.812 das 3.219 empresas não casam com nenhum contrato ativo, porque 2.772 não têm `pipedrive_id`. São a carga do Pipefy de setembro. Coluna que nasce em `contratos` fica vazia para 86% da lista por construção, não por falha de sync.

**Bug corrigido no `pipedrive-contratos-sync`:** `CLOSER_LABELS`, `SDR_LABELS` e `REGIME_LABELS` eram cópias congeladas das opções dos campos de seleção do Pipedrive. Opção criada depois da cópia caía em `labels[id] ?? null`: o deal sincronizava inteiro, sem erro, com a coluna vazia. Três closers estavam nessa situação (Anna Carolina 1046, Gabryelly Morais 1058, Gabriella Oliveira 1126), valendo 14 contratos. O sync passa a ler as opções do `/dealFields` a cada rodada, uma chamada, com os mapas fixos como rede se a chamada falhar.

**Pendente, não decidido:** (1) tirar a coluna ERP da tela ou criar o campo no Pipefy e mandar a rede preencher; (2) rodar o backfill de UF (437 pelo Omie, 2.382 pela BrasilAPI, ~50 min por causa do rate limit); (3) os ~20 outros pontos com o mesmo corte de 1000.

## [2026-09-22] O que foi executado da entrada anterior, e o que ficou escolhido

**Publicado.** Front: commit `290da62`, deploy `dpl_5u1whqE1y4LrUFs13eLqDSYABLxH` pela CLI (o webhook Git→Vercel segue parado), READY em produção com o apex `planningbrain.com.br` no alias. Edge Function `pipedrive-contratos-sync` na versão 18, rodada uma vez: 655 deals, 655 contratos, 17s. Contratos ativos com vendedor subiram de 224 para 238, exatamente os 14 previstos, com Anna Carolina (4), Gabryelly Morais (5) e Gabriella Oliveira (5).

**Backfill de UF, perna do Omie feita.** 573 linhas de `empresas.uf` preenchidas a partir de `omie_clientes.estado`, casando por CNPJ, só onde `uf` estava nulo. No recorte de `/clientes` a coluna Estado foi de 119 para 556 de 3.219 (3,7% → 17,3%). Conferência antes de gravar: nas 251 linhas em que os dois lados já tinham UF, 246 concordam e 5 divergem (Omie traz o endereço do cadastro no ERP, a BrasilAPI traz a sede fiscal). Nenhuma das divergentes foi sobrescrita.

Uma linha recusou a escrita, e vale como sinal: id 1134 (MM Agro LTDA) bateu no check `empresas_unidade_nao_e_id` criado ontem, porque `unidade` nela ainda é `1436672193`. É uma das 13 linhas sem resolução daquela correção, não um efeito deste backfill.

**Perna da BrasilAPI: não rodada.** Sobram 2.382 clientes com CNPJ e sem UF, cerca de 50 minutos por causa do rate limit. Decisão do dono: fica para uma rodada agendada.

**ERP: fica como está**, por decisão do dono. A coluna continua na tela e continua vazia, e o `FIELD_MAP` do `pipefy-sync` continua apontando para `erp`, `regime_tribut_rio`, `e_mail_fiscal` e `telefone_corporativo`, quatro campos que não existem na database do Pipefy. Nada disso quebra nada hoje, mas quem for mexer no sync precisa saber que esses quatro nomes não têm do outro lado.

## [2026-09-22] Receita e Repasses ganha uma porta, e ela responde três perguntas antes de qualquer tabela

**O problema:** a área tinha nove telas e nenhuma abertura. Quem entrava caía no Funil de Receita — uma tela de detalhe — e não sabia o essencial: o mês fechou? a fatura saiu? a unidade pagou? Era a única área grande do Ops sem visão geral, enquanto Rede tem `/rede-overview` desde o começo.

**Decisão:** `/receita-overview`, primeiro item do menu da área (grupo "Visão geral"), o que a torna também a tela pós-login de quem entra pela área — `primeiraTelaAcessivel` escolhe o primeiro item que a pessoa abre.

**A regra que ela obedece, herdada do Overview da Rede:** a abertura nunca duplica a tela de detalhe. Ela mostra número-resumo, pendência e caminho; a apuração cliente a cliente continua em `/unidades/royalties`. A tabela unidade a unidade, que já existe lá, não foi copiada.

**As três pendências são o coração da tela, e vieram de um furo real:** em ago/2026 as 11 unidades fecharam e **4 faturas nunca foram emitidas** (Maceió, Recife, São Bernardo e Sorocaba, R$ 96.377 apurados e não cobrados), e das 7 emitidas 2 estão atrasadas (RJ e Patos, R$ 77.864). Isso só era visível para quem abrisse a apuração e lesse coluna por coluna. Agora é o segundo bloco da abertura.

**Duas réguas convivem na tela e cada bloco diz a sua** — misturá-las é o erro clássico desta área (foi a causa do "o recebimento não bate" de jul/2026, ver a entrada de 20/07):

- **Repasse** (unidade → matriz): `royalties_apuracao`, caixa, com os ajustes manuais da apuração.
- **Receita da rede** (cliente → unidade): `v_reconciliacao_mensal`, competência, bruto de nota. É a mesma fonte do Funil de Receita, de propósito: duas telas da mesma área não podem discordar do mesmo número.

**Take rate segue a definição do `DATA-RULES.md`:** royalties + CSC sobre a receita apurada, só dos meses fechados. CAC e mídia ficam de fora — são reembolso de custo, não remuneração da matriz. Em ago/26 deu 15,5% sobre R$ 1.586.315.

**Os números vêm dos campos do pai (`royalties_apuracao`), não recalculados dos itens.** Não é descuido: é a mesma fonte que a tela de apuração usa, e uma abertura que discorda da tela de detalhe destrói a confiança nas duas. Conferido no banco para ago/26 e jun/26 — a soma de `royalties_itens.royalties_item` bate com `royalties_valor` do pai.

**Nenhuma chave de permissão nova.** O portão é a área (`receita`), como em `/rede-overview`; dentro dela, cada bloco pergunta a chave da página que ele resume (`view.unidades_rede` para o repasse, `view.contas_receber`/`view.funil_receita` para a receita). Quem só tem um dos lados vê meia tela em vez de erro — a controladoria que acompanha recebimento não precisa da apuração.

**Cor dos gráficos, porque a escolha não foi estética:** a paleta da marca tem cinco slots, mas `--chart-2` (ciano), `--chart-3` (azul) e `--chart-5` (roxo) não se separam o bastante entre si (validado: ΔE 11 em visão normal no tema escuro, abaixo do piso de 15). Por isso o empilhado tem **três** séries — royalties, CSC e outras receitas — e CAC saiu para um gráfico próprio, em vez de virar a quarta fatia de uma pilha que ninguém conseguiria ler. Take rate é gráfico separado: dois eixos y no mesmo gráfico nunca.

## [2026-09-22] A tela Histórico de Royalties sai, e a série histórica sobrevive nela no gráfico do Overview da Rede

**Decisão do usuário:** apagar `/unidades/historico`. Saem a rota, o conteúdo (`royalties-historico-content.tsx`, tabela cliente x mês da rede toda), o item de menu em "Repasses das unidades" e o link de detalhe do gráfico de royalties no `/rede-overview`.

**O que NÃO sai, e é o ponto que faz a remoção ser barata:** `listRoyaltiesHistoricoRede` fica. Ela não servia só àquela página: o gráfico de evolução de royalties do `/rede-overview` e o cálculo de LTV leem dela (é a função que reconstrói o apurado a partir de `royalties_itens`, em vez de confiar em `royalties_apuracao.royalties_valor`, que envelhece quando o item é confirmado depois do fechamento). Apagar a função junto teria derrubado o Overview em silêncio.

**O que virou dead code de verdade e saiu junto:** `royalties-vendas.functions.ts` e o hook `useVendasPorUnidadeRede`, que tinham um consumidor só, a tabela apagada.

**As duas URLs antigas continuam de pé, como no precedente do CAC (18/09):** `/royalties` e `/unidades?tab=historico` passam a cair na Apuração de Royalties, que é onde o número por mês e por cliente se confere hoje. Link antigo em e-mail e favorito não pode virar 404.

**A chave `view.royalties_historico` sai também, e aqui a decisão é o oposto da tomada com `view.reconciliacao` em 17/09.** Naquele caso a chave ficou porque policies de `contratos` e `contas_receber` liam por ela. Nesta, foi conferido no banco antes de apagar: nenhuma policy de RLS e nenhuma function citam a chave, ela só abria a rota. Some de `ops.area_chaves` (área receita) e de `ops.role_permissions` (papéis admin e diretor) na migration `20260922210000`, com rollback escrito. Deixar chave morta no catálogo polui a tela de acessos com permissão que não guarda nada.

**Dado nenhum foi tocado.** `royalties_apuracao` e `royalties_itens` seguem inteiros: o que saiu foi a leitura em tabela, não a apuração.

## [2026-09-23] A abertura de Receita e Repasses diz a régua de data em cada número, não só no rodapé

**Pedido do usuário:** "para nao gerar confusao nesta página é interessante trazer a data sempre de competência e caixa". O seletor de mês é um só e governa os dois blocos, mas o mês significa coisas diferentes em cada um — e a tela dizia isso uma vez só, em letra pequena ao lado do título do bloco ("fonte: apuração de royalties (caixa)").

**Decisão: a régua aparece em três alturas, sempre visível, no mesmo padrão já usado na apuração de royalties (commit `fed069a`, 22/09).** (1) Faixa fixa logo abaixo do seletor: repasse é caixa, receita da rede é competência, os dois usam o mês do seletor e não têm por que dar o mesmo número. (2) Selo com tooltip ao lado de cada título de bloco — `caixa` e `competência`. (3) `help` de cada KPI citando o mês por extenso e a régua daquele número.

**O que a auditoria dos números mudou no texto, e não era cosmético:**

- **O repasse não é caixa inteiro.** Só royalties e o percentual do CSC sobre base antiga incidem sobre o que o cliente pagou dentro do mês. CSC fixo, CAC e mídia são valores da competência e não dependem de recebimento nenhum. O texto antigo ("fonte: apuração de royalties (caixa)") cobria os cinco com a mesma régua.
- **"Recebido" na receita da rede não é caixa do mês.** `v_reconciliacao_mensal` bucketiza por `data_competencia` e soma como recebido os títulos daquela competência com status `RECEBIDO`, em **qualquer** data de pagamento. Quem lia a barra como "entrou no mês" estava comparando com o repasse, que é caixa de verdade. O `help` agora diz a diferença e aponta qual das duas o bloco de repasse usa.
- **"Em atraso" por competência é exatamente o padrão que a decisão de 25/08/2026 proíbe para inadimplência** (`data_competencia` joga vencido velho em mês recente — GABI e Sidikum, vencimento em 2021 e competência em fev/2026). O card fica, porque é sinal útil de safra, mas o `help` manda medir inadimplência pela safra de vencimento em Contas a Receber.
- **MRR contratado não tem data.** É foto dos contratos ativos hoje no Pipedrive; não muda ao trocar o mês, e por isso não serve de denominador para um mês passado.

**"Faturado e não recebido" passa a mostrar data, não só nome de unidade.** O chip de cada unidade ganha o vencimento do título na Partners (`dd/MM`), que é a data que diz se já passou do prazo — nem o mês da apuração nem a competência da ND respondem isso. A formatação é feita por corte de string, não por `new Date`: `new Date("2026-09-10")` é meia-noite UTC e em São Paulo vira dia 09.

**Nada mudou no servidor.** `receita-repasses.functions.ts` não foi tocado: todas as datas exibidas já vinham na resposta (`vence_em`, `recebimento.vencimento`). A mudança é de leitura, não de número.

## [2026-09-23] Design System v2 do Brain

**Contexto:** a marca estava nos tokens e nenhuma regra levava marca, navegação e objetivo de negócio para a tela: `<Toaster/>` nunca montado, 33 `hsl(var())` sobre variáveis hex, cerca de 1.650 classes de cor crua, cerca de 230 fontes de 9–11px e cabeçalho desenhado de 9 jeitos. Spec: `docs/superpowers/specs/2026-09-23-design-system-v2-design.md`. Diagnóstico em `docs/design/diagnostico/`. Branch `feat/design-system-v2-20260923`, sem push nem deploy.

**Decisões não óbvias:**
- **O DS canônico mora no repo do Brain**: regras em `docs/design/`, código em `src/styles.css` e `src/components/planning/`. Regra que não está no repo que o agente abre não existe para ele. `planning-design-system/` (Tailwind v3, HSL) passa a apontar para cá. A marca (logo, paleta, grafismos) continua com o Mika.
- **Fira Sans é a reserva da Bw Glenn Sans.** A pilha começa na Bw Glenn e o `@font-face` já está pronto, mas os `.woff2` não existem no disco e dependem do Mika. Poppins sai.
- **Tokens por papel, não por matiz**, com contraste medido (WCAG 2.1 sobre `card`): `muted-foreground` 7,2:1 no escuro e 6,5:1 no claro; `input` 3,5:1 como borda de controle (`border`, com 1,3:1, é só divisória); `primary-text` claro `#007a4f` a 5,4:1; status success/warning/danger/info com variante `-soft`. Laranja da marca é atenção, ciano é informação, e o vermelho de `danger` é o único fora da paleta. Tabela em `docs/design/DESIGN.md` §3.
- **Cor de área só em anel, filete e eyebrow**, nunca fundo nem texto de corpo. No tema claro o texto do eyebrow é neutro (`muted-foreground`), porque verde, ciano e lima não passam 3:1 sobre branco.
- **Paleta de gráfico do escuro fica viva, mesmo reprovando a faixa de luminosidade do validador da skill `dataviz`** (verde 0,80, lima 0,87, contra a faixa 0,48–0,67). A marca vale mais que o validador: escurecer apagaria o "vivo sobre preto" que é a assinatura dela. Croma, separação para daltonismo e contraste passam. O risco fica contido por traço fino, no máximo 3 séries empilhadas e texto nunca na cor da série. No claro, cada cor foi escurecida no mesmo matiz. A lima foi até `#526b00`, porque em `#7d9b00` ela colapsava com o laranja para deuteranopia (ΔE 4,4). Registro completo em `src/lib/planning/grafico.ts`.
- **Funil é pintado numa cor só**, em rampa do claro ao escuro. Etapa não é categoria (`DESIGN.md` §5).
- **A integração com a `main` é feita por codemod reexecutável**, e não por conflito resolvido à mão. `scripts/design/codemod-cores.mjs` (`npm run design:codemod`) é idempotente. Depois de trazer a `main` do Eliezek, basta rodá-lo de novo. A catraca de `npm run design:lint` (`docs/design/lint-baseline.json`) impede que a contagem de erro volte a subir.

**Pendente de decisão humana (não resolvido pelo DS):** o logo vetorial oficial, porque há dois gradientes em uso e o SVG tem `#5FB77F → #4EBED8` (Mika); os arquivos da fonte (Mika); os nomes e a estrutura do menu propostos em `docs/design/NAVEGACAO.md` §4, que são proposta e não foram implementados (Pedro e Eliezek); e os conflitos de produto de `docs/design/PRODUCT.md` §5 (5.1–5.17, com os donos sugeridos lá).

**Status:** implementado na branch pelas tarefas do plano `docs/superpowers/plans/2026-09-23-design-system-v2.md`. Não integrado à `main` nem publicado.
**Próximos passos:** o Eliezek revisa e integra (`docs/design/PROCESSO.md` §3); depois o codemod roda de novo e a baseline é regravada.

## [2026-09-22] Recife ganha card, e com isso vira a terceira "cobertura parcial"

**Contexto:** 385 contas rotuladas Recife não apareciam em card nenhum. A causa não era dado faltando — as contas já carregam `unidade_id = 13` e a praça já existia em `ops.unidades`. Faltava a linha em `ops.monetizacao_unidades`, que é o que `ops.monetizacao_cobertura_refresh()` percorre para montar a cobertura.

**Decisão:** inserida a linha `('0384bff73f7cfcc0', 13, 'Recife', 'unidade')`. A chave segue a convenção das demais, decifrada por conferência: `sha256(nome)[:16]` — bate em Belém, Curitiba, São Bernardo, Fortaleza, Maceió, Campo Novo, Patos de Minas, São Luís, Sudeste (RJ) e Itaúna.

**Efeito medido, depois do refresh:** Recife entra com **385 contas / 385 CNPJs / 384 no Pipefy / 0 no Omie**, a quinta maior carteira — acima de Belém (360), Sudeste (318) e Fortaleza (260). Total de linhas de cobertura: 13 → 14.

**`unidade_id` preenchido, e isso importa.** O join de `monetizacao_cobertura_refresh()` usa o ramo do `unidade_id` quando ele existe e só cai no casamento por nome quando é nulo. As 385 contas de Recife já têm `13` em `unidade_ids`, então o ramo do id casa todas. Se a linha tivesse entrado com `unidade_id` nulo — como está São Bernardo — o card apareceria mesmo assim, mas por outro caminho. Repetir a inserção para Sorocaba (id 14) ou São Paulo (id 15) exige conferir antes se as contas daquela praça carregam o id; sem isso o card nasce zerado.

**Consequência que não é ganho:** `omie_integrado` fica falso (não há credencial Omie para Recife em `ops.omie_credentials`, que tem 10 e nenhuma dessa praça), então o card nasce com o selo **"cobertura parcial"** — o terceiro, junto de São Bernardo e Fortaleza. A troca é de "invisível" por "visível com ressalva verdadeira", e o aviso só sai quando as três praças tiverem credencial Omie.

**Sem deploy.** É linha de dado; a tabela de cobertura é lida em tempo de execução.

**Reversão:** `delete from ops.monetizacao_unidades where key='0384bff73f7cfcc0'; select ops.monetizacao_cobertura_refresh();`. Backup do estado anterior em `unidades-1344/unidades-backup-20260922.json`.

## [2026-09-22] Os avisos de "cobertura parcial" saem das telas; auditoria passa a morar num lugar só

**Contexto:** ao cadastrar Recife, o card nasceu com o selo âmbar "cobertura parcial" — o terceiro, junto de São Bernardo e Fortaleza, todos pela mesma causa (sem credencial Omie em `ops.omie_credentials`, que tem 10 e nenhuma dessas praças). O dono cortou a discussão: **"não usa esses avisos de cobertura parcial; deixa pra centralizar numa tela só o que precisa de auditar"** — uma tela que outra sessão está montando em paralelo.

**Decisão:** removidos os dois avisos de lacuna de fonte que existiam na interface:
- o selo âmbar no card de unidade do Aquário (`aquario.tsx`), que disparava com `omie_integrado === false && cnpjs > 0`;
- a tarja âmbar no topo do Funil (`funil-content.tsx`), que dizia "Faturado e Recebido cobrem apenas unidades com dados no Omie" e disparava com `mrr_contratado > 0 && faturado === 0`.

**O que fica, e por quê.** A linha de procedência do card continua (`catálogo Pipefy 384 · Omie não integrado`). Ela é informação sobre a origem do número, não alerta sobre o que está faltando — o card seguir declarando de onde conhece a carteira era decisão de 21/09 e não foi revogada.

**O princípio, para a próxima vez:** lacuna de fonte é assunto de auditoria, e auditoria mora numa tela só. Aviso espalhado pela interface não vira ação — vira ruído que o usuário aprende a ignorar, e some o sinal junto.

**Verificado:** `tsc --noEmit` dá os mesmos 7 erros antes e depois, nenhum nos arquivos tocados. `AlertTriangle` continua importado em `funil-content.tsx` porque a lista de alertas do rodapé ainda usa.

**Reversão:** os dois trechos removidos estão no diff deste commit; o comentário que ficou no lugar marca a posição exata.

## [2026-09-22] Faturamento da DataStone entra como faixa; procedência vira dimensão da tela

**Contexto:** 3.374 contas ativas de porte Demais estavam sem faixa de faturamento, e em Cella e Finance a faixa é a **última** trava da `oferta()` — quem para antes, no regime ou na situação cadastral, não muda de estado por enriquecimento nenhum. Medido pela régua: 3.410 contas travadas só pela faixa em Cella, 61 em Finance.

**Decisão — o endpoint é o da Consulta, não o do B2B.** `GET /v1/companies/?cnpj=<14 dígitos>` devolve o objeto inteiro em uma chamada. O `POST /b2b/companies/` que constava do plano é busca paginada e devolveria no máximo um `company_id`. Custo medido: **1 crédito B2C por CNPJ novo**, com carência de 24 h por documento (2 chamadas, 1 nova + 1 repetida, saldo caiu exatamente 1). O saldo B2B de 27 créditos descartou o endpoint de lote, que é o que consome essa carteira.

**Decisão — `estimated_revenue` é faixa em texto, e a tradução recusa precisão que a fonte não tem.** Valor real: `"DE R$ 50 MM ATÉ R$ 100 MM"`. A tradução para `FAIXAS` tem duas portas: cabe inteiro numa faixa do app, ou atravessa fronteira do app mas fica inteiro de um lado só do corte de R$ 25 mi (aí grava a faixa que contém o piso, porque Cella e Finance decidem igual). **Atravessar o próprio corte de 25 não passa**: `"DE R$ 10 MM ATÉ R$ 50 MM"` não diz se a empresa é Cella, e fingir que diz é pior que a lacuna. Em 1.921 consultas: 75% viraram faixa, 9% sem estimativa na fonte, 16% atravessando o corte.

**Aplicado:** 1.447 contas receberam `band`, `band_source` e `band_at`. O `band_source` carrega o texto exato do fornecedor (`"DataStone · estimativa DE R$ 50 MM ATÉ R$ 100 MM"`), porque a faixa gravada às vezes tem teto mais apertado que o intervalo original e quem abre a ficha precisa ler a afirmação da fonte, não só a traduzida. Backup dos perfis anteriores em `unidades-1344/band-backup-20260922.json`.

**A descoberta que mudou a tela: a régua do Cella não pergunta se a empresa é cliente.** Ela pede ativa na Receita, fora do Simples e faturamento acima de R$ 25 mi — nada mais. Como **6.162 das 9.992 contas entraram pelo ERP Omie da unidade**, e esse cadastro inclui quem a unidade *paga*, enriquecer faturamento converte contraparte de razão contábil em prospect. Apareceram na fila do Cella: Claro, Magazine Luiza, Amazon, B3, Localiza, Sodexo, Editora Globo, Accor (esta em 5 filiais).

**Hipótese testada e descartada:** "quem só existe no Omie não é cliente" parece um corte objetivo e **erra nos dois sentidos**. A HOTELARIA ACCOR tem cadastro no Pipefy e está marcada Base Antiga — é hotel. A UNIGGEL SEMENTES não tem nem Pipefy nem Pipedrive e é cliente real, com ECD na Planning. Nenhuma flag isolada responde "é cliente?": ECD cobre 404 contas, contrato Pipedrive 731, Base Antiga 2.221.

**Decisão — a tela declara procedência, não veredito.** `procedencia()` em `portfolio.ts` rotula cada conta pela melhor porta que ela tem: ECD → contrato no Pipedrive → cadastro no Pipefy → só Omie. É fato verificável e responde uma pergunta mais modesta do que a base sabe responder. A situação `so_omie` separa, na lista de cada produto, as contas que a régua aprova mas que entraram só pelo ERP; elas saem da contagem de aptas do card e ganham chip azul próprio — nem o verde de "pronta", nem o âmbar de "pendente", porque a régua aprovou e o que está em questão é a origem. Rodapé `ProcedenciaBase`, no molde do `ProcedenciaFooter` da fila do Cella, explica as portas e por que não valem o mesmo.

**Não resolvido:** 881 CNPJs da fila ficaram sem consulta (saldo B2C acabou), 4 falharam por rede, e 349 caíram no caso que atravessa o corte de R$ 25 mi. Esses continuam "a confirmar", que é a resposta honesta.

## [2026-09-22] A barra de frescor mostrava o relógio errado, e o aviso de falha despejava o Postgres

**Contexto:** print da Caixa de Oportunidade com `CRM · 21/09, 15:35 · atualização pendente` e uma tarja âmbar terminando em `canceling statement due to statement timeout`.

**Medido em `ops.monetizacao_sync`:** `catalog_at` = 22/09 13:29 (um minuto antes do print), `measured_at` = 21/09 15:35, `error` = timeout, `started_at` = 22/09 13:30. São **duas cargas com dois relógios**: o catálogo de empresas concluiu, o passo de métricas estourou o tempo. A barra lia só `measured_at`, então a tela dizia que a base inteira estava parada havia 22 horas — o que não era verdade e desautoriza o resto da tela sem motivo.

**Decisão:** a barra mostra os dois relógios (`Empresas · <data>` e `Indicadores · <data> (parados)`), e o farol fica âmbar só quando as duas cargas estão velhas; azul quando é só uma.

**Decisão — a mensagem do banco não é para o sócio ler.** `FalhaDeCarga` em `common.tsx` diz qual passo caiu, desde quando, e o que continua confiável; `motivoLegivel()` traduz os erros conhecidos (timeout, deadlock, permissão, conexão) e cai num texto genérico honesto para o resto. O texto cru continua no `title`, para quem for investigar. Aquário e Caixa de Oportunidade tinham cópias divergentes desse aviso e passam a usar o mesmo componente.

**Por quê:** erro de fonte tem que aparecer na tela — é a regra do `spec-dash-funil-cella.md`. Mas aparecer não é despejar: um erro em inglês, minúsculo, colado depois de um ponto, não informa ninguém e ensina o usuário a ignorar a tarja âmbar.

## [2026-09-22] Quatro perdas de trabalho no cockpit consertadas, e o estudo de navegação que contesta a spec

**Contexto:** o dono voltou com quatro queixas sobre `/clientes` — o menu de contatos/empresas/negócios "inútil", as duas dobras do meio mostrando a mesma coisa, o menu inferior de carteiras que "não pode estar ali", e "o que é contratos da rede?". Antes de mexer em navegação, rodou-se um estudo (seis lentes investigando código, banco e web, cada afirmação submetida a dois refutadores adversariais, três arquitetos com prioris opostos, júri e crítico de completude — 71 agentes). O estudo está em `docs/dev_notes/cockpit-navegacao-ux/estudo.md`.

**A causa dos três níveis de navegação, provada por commit.** `0b29b44` (17/09, "Unifica Clientes e oportunidades") **apagou o item "Aquário" do menu lateral** (`git show 0b29b44 -- src/lib/areas.ts` tem uma linha de diferença). Antes dele o Aquário era rota de primeiro nível e as cinco abas `Carteiras por unidade · Todas as contas · Recon · Listas para sócios · Entenda os números` eram a navegação principal dele. O commit embutiu a tela em `/clientes` como aba e as cinco abas viraram nível 3 sem redesenho. A queixa 3 do dono descreve esse resíduo. O padrão correto já existe na casa: `areas.ts:295-309` expõe cada aba de `/monetizacao` como item do menu lateral, sem aba aninhada.

**Consertado agora (perda de trabalho, sem mexer em rota):**

1. **A lista aberta deixa de ser destruída.** `list-workspace.tsx`: `empty()` não carrega `id`/`revision`, e o efeito de `initial` fazia `setDraft({ ...empty(), ... })`. Efeito: abrir lista salva → voltar à base → selecionar → "Preparar lista" **descartava a lista aberta**, e o próximo salvar criava outra (`persist` manda `id: draft.id`). Agora, com lista aberta, "Preparar lista" **soma** a ela, deduplicando por `account_key|product` — que é a chave `UNIQUE (list_id, account_key, product)` de `ops.monetizacao_itens` — e diz na tela quantas entraram e quantas já estavam. Sem lista aberta, o comportamento é o de antes. O rascunho de agora é lido por `draftRef`, não por dependência do efeito: o efeito só pode reagir a `initial`.
2. **A busca para de jogar fora a paginação.** `aquario.tsx`: `setLimit(50)` estava fora do guard `if (key !== "query")`. Digitar uma letra depois de três "Mostrar mais 50" devolvia a tabela para 50 linhas.
3. **O KPI de origem dentro da gaveta para de zerar o produto.** `aquario.tsx`: partia de `emptyFilters` e derrubava o produto que o operador tinha acabado de escolher. Agora troca só a chave `origin`, como o seletor de origem da tabela. A seleção continua sendo limpa — trocar filtro limpa seleção é decisão de 16/09 e vale nos dois caminhos.
4. **"Nova lista" passa a perguntar.** `list-workspace.tsx`: descartava rascunho sujo em silêncio, enquanto o botão de trocar de lista logo abaixo já perguntava. Mesmo portão nos dois.

**Onde o estudo contradiz `docs/spec-cockpit-da-base.md`, com evidência:**

- **A prop `embedded` não suprime nada.** São três ocorrências em `aquario.tsx` (default, tipo, `className` do `<main>`). A spec a tratou como mecanismo pronto de supressão de casca. Hoje a página monta **dois `<h1>`** e dois "Atualizar" **com efeitos diferentes** — o de fora só invalida cache, o de dentro (`Freshness`) é o **único gatilho de sync do CRM** em `/clientes`. Quem for suprimir, suprima o de fora.
- **O escopo por unidade é o inverso do que a spec diz.** Ela afirma "24 usuários com `todas_unidades`, 85 vínculos, a maioria vê a base filtrada sem saber". Medido em 22/09: **36 de 37 veem tudo**, e **um** usuário tem escopo restrito. Os 14 vínculos dos outros cinco são decorativos, porque `todas_unidades=true` sobrepõe.
- **A spec não considerou permissão em nenhum dos quatro blocos.** `ops.monetizacao_listas` e `ops.monetizacao_itens` só abrem com `view.aquario OR view.monetizacao`, e a área `minha_unidade` (por onde o sócio regional entra, `areas.ts:355`) tem `view.clientes` e **nenhuma das duas**. O único sócio regional do sistema aterrissa numa tela cuja aba se chama "Listas para sócios" e que, para ele, está vazia — sem aviso. É também a causa do "0 negócios" da aba Negócios. Numa página única empilhada não há como não renderizar esse bloco vazio; numa rota com chave no item de menu, o item não aparece. **Por isso o estudo recomenda rotas irmãs em vez dos quatro blocos numa rolagem só.**
- **A duplicação que `af0b980` declarou ter removido dos cards de produto continua lá.** "Cella · perfil aderente" = 63 no KPI e "63 com perfil aderente" no card, mesma expressão e mesmo rótulo; idem Finance (160) e as 2.329 aptas da Consultoria. E há uma contradição pior: o KPI diz "Consultoria · carteira **retroativa** 4.731" (`baseRetroativaConsultoria`) e o card diz "de 2.356 **retroativas**" (`potencialConsultoria`, subconjunto estrito) — dois denominadores com o mesmo nome, a 68 linhas um do outro. Números da régua sobre a carteira de 22/09.

**Defeito de rota encontrado de passagem, não consertado nesta entrada:** `rede-overview.tsx:979` e `:993` prometem "Ver clientes ativos" e mandam `status: ""`; `clientes.tsx:5` só escolhe a view `contratos` quando `status` é *truthy*, então os dois caem no cockpit de prospecção. Dois dos três pontos de entrada externos de `/clientes` erram o alvo.

**"Contratos da rede" (queixa 4):** lê `empresas`, `contratos` e `central_tratativas` — as mesmas três tabelas da aba Tratativas de `/painel-cs`, que existe desde `5bc5e5a` (14/09), **três dias antes** de `contratos-clientes.tsx` nascer em `0b29b44`. Nunca houve decisão de pôr contrato na tela de prospecção; foi colateral da mesma fusão. `central_tratativas` não recebe linha nova desde 19/08/2026. A recomendação é sair de `/clientes` como rota irmã renomeada — **não** como quarta aba de `/painel-cs`, porque `contratos-clientes.tsx` lê `contatos` e `omie_clientes_cadastro`, que `/painel-cs` não lê, e `status_financeiro` cru não é a `categoria_financeira` derivada de lá.

**Pendente de decisão do dono — nada de navegação foi implementado.** Sete perguntas no fim do estudo, todas com recomendação formada. As duas que mais importam: (a) "Empresas" seria **promovida** a corpo de `/clientes` em vez de sair, o que é o contrário do que ele pediu — é ela que tem a busca por CNPJ e o CSV completo; (b) qual chave guarda a tela de produtos e listas — `view.aquario` (22 pessoas), `manage.aquario` (16) e `send.monetizacao` (16) são três portões distintos e a tela modela um só.

**Ressalva de procedência do estudo:** a rodada adversarial marcou 29 de 30 afirmações como derrubadas, mas os refutadores foram instruídos a "na dúvida, refute" — lidas uma a uma, a maioria confirma o fato e corrige o *alcance* da conclusão ou um número de linha defasado. Todas as afirmações reproduzidas nesta entrada foram reconferidas à mão contra `HEAD ffed13a` e contra o banco.

## [2026-09-22] Decisões do dono sobre a navegação da Base de clientes, e o destino dos cards de cliente ativo

Respostas às perguntas abertas do estudo `docs/dev_notes/cockpit-navegacao-ux/estudo.md`. Registradas aqui porque nenhuma delas está implementada ainda — a implementação de navegação segue pendente.

**1. "Empresas" é PROMOVIDA, não removida.** O dono tinha dito que a aba estava inútil ("não vou usar ele ali"), e o estudo mostrou que ela é a única superfície com busca por CNPJ, coluna de CNPJ, estado do espelho do Pipefy com data, e cinco colunas de CSV que o `PortfolioTable` não exporta. Decidido: o **conteúdo** dela vira o corpo de `/clientes`; o que morre é a aba, não a ferramenta. Consequência prática: migrar essas colunas para o `PortfolioTable` é **pré-requisito** de qualquer fatia que mexa na faixa de abas — sem isso a promoção perde dado.

**2. A tela de produtos e listas é guardada por `view.aquario`, com os botões degradando.** Existem três portões distintos e a tela modela um só: `view.aquario` (22 pessoas), `manage.aquario` (16) e `send.monetizacao` (16) — contados na união de `user_roles×role_areas×area_chaves` e `usuario_areas×usuario_chaves`, em 22/09. Decidido: o **item de menu** aparece para quem tem `view.aquario`; "Preparar lista" e "Enviar ao Pipedrive" ficam **desabilitados com o motivo no `title`** para quem não tem `manage.aquario`/`send.monetizacao`, em vez de sumirem. As 6 pessoas do delta veem os cards de produto e não conseguem montar lista — e passam a saber por quê.

**3. "Preparar lista" soma à lista aberta mesmo quando o produto não bate.** Ao consertar a perda da lista aberta (entrada anterior de hoje), surgiu a pergunta: e se a lista aberta é de Consultoria e a seleção é de Finance? O banco permite — não há constraint de produto único por lista, só `UNIQUE (list_id, account_key, product)`. Alternativas oferecidas: (a) somar sempre, (b) recusar quando o produto difere, (c) perguntar. **Escolhida a (a)**, com o aviso na tela dizendo quantas entraram e quantas já estavam. Razão: era o conserto mínimo da perda de trabalho, e as 6 listas que existem hoje são todas de um produto só — o caso nunca aconteceu na prática. Se lista mista passar a ser considerada erro, a mudança é para (b) e são ~5 linhas.

**4. Os dois cards de "clientes ativos" do Rede Overview passam a declarar a view.** `rede-overview.tsx` tinha dois cards com `title="Ver clientes ativos"` mandando `search: { status: "", unidade: "" }`. Como `clientes.tsx` só escolhe a view de contratos quando `status` é *truthy*, os dois caíam no cockpit de prospecção — dois dos três pontos de entrada externos de `/clientes` erravam o alvo. Agora mandam `view: "contratos"` explicitamente.

**Não se manda `status: "ATIVO"` de propósito.** Naquela tela `ATIVO` quer dizer "pagou nos últimos 90 dias" (`contratos-clientes.tsx`, descrição do próprio status), enquanto o `clientesAtivos` do card é "empresa que não deu churn" — conjuntos diferentes. Mandar o filtro faria o destino mostrar menos do que o número clicado. **Fica registrado como folga conhecida:** o card leva à lista certa, mas o total de lá não bate com o número do card. Fechar isso exige um filtro de "não deu churn" na tela de contratos, que é decisão de dado e não entrou aqui.

## [2026-09-22] A tela de Operação parou de atualizar o CRM: o teto de 8 s do PostgREST contra uma função de 5,2 s

**Sintoma:** o dono reportou a Caixa de Oportunidade parada em "CRM · 21/09, 15:35 · atualização pendente", com a tarja "A atualização falhou; preservamos a última carga concluída. canceling statement due to statement timeout".

**Onde morria, apurado no banco.** `ops.monetizacao_sync` mostrava `status=error`, `measured_at` de 21/09 18:35 e `catalog_at` de **hoje**. Como `monetizacao_intake_ops` é quem grava `catalog_at` e `monetizacao_replace_snapshot` é quem grava `measured_at`, a falha estava entre as duas — e a única chamada pesada de banco ali no meio é `ops.monetizacao_refresh_ops()`. O `collect()` do meio só faz dois SELECT com `limit=1000`, e o erro é do Postgres, não HTTP.

**Medido, não suposto.** `explain (analyze) select ops.monetizacao_refresh_ops()` → **5.243,9 ms** de execução. A função é um laço PL/pgSQL linha a linha sobre as **3.761** contas com `empresa_ids`, com 5 statements por volta (2 selects + 3 updates) — cerca de 19 mil comandos numa chamada só. Do ponto de vista do PostgREST isso é **um** statement, então leva o `statement_timeout` inteiro.

**A causa do teto.** `pg_db_role_setting` dá `statement_timeout=8s` ao **`authenticator`**, que é a role de login do PostgREST, e o `service_role` não tinha override próprio. O `supautils` (carregado em `session_preload_libraries` do `authenticator`) aplica as configurações de role no `SET ROLE`, então o `service_role` herdava os 8 s. Prova por contradição: uma função de 5,2 s nunca estouraria um teto de 120 s — e estourava. Folga real: 1,5×. Qualquer concorrência derrubava, e derrubou 
por ~22 horas seguidas, a cada 5 minutos.

**Decisão:** `alter role service_role set statement_timeout = '60s';` — 11× de folga sobre os 5,2 s medidos. O `authenticated` **continua em 8 s**: o teto do usuário na tela não foi afrouxado, só o do backend que roda o sync.

**O passo que faltava, e que quase fez o conserto parecer errado:** o `ALTER ROLE` sozinho não teve efeito. O PostgREST guarda as configurações de role em cache; foi preciso `notify pgrst, 'reload config'`. Antes do reload o sync continuou estourando em 8 s; depois dele passou na primeira tentativa.

**Verificado pelo efeito:** `status=ok`, `error=null`, `measured_at=2026-09-22 17:15:21`, e `ops.monetizacao_deals` reescrita às 17:15:25 (176 negócios).

**Reversão:** `alter role service_role reset statement_timeout; notify pgrst, 'reload config';`

**Dívida que fica registrada, e que o teto novo só adia.** `monetizacao_refresh_ops` atualiza as 3.761 contas **incondicionalmente**, com `updated_at=now()`, a cada 5 minutos — 288 vezes por dia, três UPDATE por conta, para dado que quase nunca muda. São ~3,2 milhões de reescritas de linha por dia em `monetizacao_contas` e `monetizacao_detalhes`, com o vacuum correndo atrás. O conserto durável é tornar a função conjuntista (ou ao menos pular o UPDATE quando o `perfil` não mudou), o que levaria os 5,2 s para a casa dos milissegundos. Não foi feito nesta rodada: é cirurgia numa função `SECURITY DEFINER` em produção, e o sintoma do dono já estava resolvido. Enquanto não for feito, o tempo cresce com a base e volta a encostar no teto.

## [2026-09-22] Um menu só: as duas faixas de abas da Base de clientes viram cinco entradas

**Contexto:** o dono olhou a tela depois do deploy e disse "não mudou absolutamente nada no menu como eu tinha pedido". Ele estava certo — a rodada anterior entregou o pré-requisito (levar para a tabela da carteira o que só existia na aba "Empresas") e tratou isso como "o pendente", quando o pendente era a navegação. Erro de escopo de quem executou, não de pedido.

**A causa, provada por commit.** `0b29b44` (17/09) apagou o item "Aquário" do menu lateral (`git show 0b29b44 -- src/lib/areas.ts` tem uma linha de diferença) e embutiu aquela tela em `/clientes` como aba. As cinco abas que eram a navegação **principal** do Aquário viraram segundo nível dentro do primeiro, sem redesenho nenhum. Eram duas faixas, onze entradas, três níveis. É isso que a queixa 3 descrevia.

**Decisão: a faixa de cima passa a ser a única navegação, com cinco entradas.**
`Base de clientes · Produtos e listas · Validar origem (N) · Contratos e churn · Entenda os números`

O `<Tabs>` de dentro do Aquário **deixa de existir**. O componente recebe `secao` (`base` | `produtos` | `gates`) e `irPara` da casca. Ele renderiza na **mesma posição do JSX** nas três seções, então **não desmonta** ao trocar de entrada: filtro, seleção e rascunho de lista sobrevivem à navegação — o que a faixa de abas Radix não garantia. A montagem de lista continua sempre montada e escondida por classe, porque desmontá-la jogaria fora o rascunho do operador.

**"Carteiras por unidade" e "Todas as contas" foram fundidas.** Eram filtro da mesma tabela, não abas distintas — é a regra do design system da Atlassian citada no estudo (`docs/dev_notes/cockpit-navegacao-ux/estudo.md`): *"Don't use tabs to separate information that users need at the same time, such as filtering data within a single table."* Viraram "Base de clientes": grade de unidades e tabela na mesma seção.

**Recon** desceu para dentro de "Produtos e listas" e o cartão dele rola até o painel, em vez de trocar de aba. Ele não é produto (`PRODUTOS` tem três) e não produz lista — onde ele mora de verdade segue pergunta aberta do estudo.

**Destino de cada aba antiga:**
- **Empresas** — sai da faixa porque foi **promovida** (decisão do dono, entrada de hoje): busca por CNPJ, coluna de CNPJ, espelho do Pipefy e as cinco colunas do CSV já tinham ido para a tabela da carteira. Sai a aba, não a ferramenta.
- **Negócios** — **morre**. Era recorte pior do que `/monetizacao?aba=operacao` já mostra. O ramo e o `const deals` foram removidos do código.
- **Contatos** — sai da faixa e ganha link no rodapé do funil ("Ver contatos vinculados"), guardado por `view.contatos`. A view continua endereçável por `?view=contatos` através de uma lista `viewsOcultas`: sem isso ela cairia no fallback e o dado ficaria inalcançável. É a única tela do Ops que lista nominalmente os contatos vinculados a conta.
- **Contratos da rede** — vira **"Contratos e churn"** na aba **e no `<h1>` da própria tela**. Renomear só a aba deixaria a queixa 4 ("o que é contratos da rede? me deixou confuso") de pé.

**Cabeçalho duplicado.** Embutido, o Aquário para de renderizar o próprio `<h1>` e subtítulo — eram dois `<h1>` na mesma página. O `Freshness` **fica**, porque é o único gatilho de sincronização do CRM nesta tela (o "Atualizar" de fora só invalida cache). Os dois botões de atualizar continuam existindo: fica registrado como dívida, não foi resolvido aqui.

**Conferido no bundle construído, não no status do deploy:** os cinco rótulos novos aparecem em `.output/public/assets/`, e `Carteiras por unidade`, `Listas para sócios`, `Contratos da rede`, `Cockpit da base` e `negócios de Monetização` não aparecem em asset nenhum.

**Nota de ambiente:** o build local estoura o heap do Node com o padrão; precisa de `NODE_OPTIONS=--max-old-space-size=8192`. Não é erro de código — a Vercel constrói a mesma árvore sem isso.

**O que NÃO entrou, e segue no estudo:** rotas irmãs (`/clientes/produtos`, `/clientes/contratos`) em vez de views na mesma rota; a gaveta da unidade virar rota; `?conta=` na URL; publicar `aquario`/`clients` em `permissions` (`functions.ts`) para a tela poder dizer quando está vazia por RLS; e a chave que guarda "Produtos e listas" — hoje a entrada aparece para todos, a decisão registrada era `view.aquario` com os botões degradando.

## [2026-09-22] Cockpit do CEO: primeira fatia em piloto isolado, sobre Base e Monetização, com Jev atrás de adaptador

**Contexto:** o dono definiu o output final do programa como "um cockpit como mais um módulo do planningbrain onde o Pedro consiga responder todas as suas perguntas" (PRD de 22/09, fora deste repo). Esta rodada é um piloto supervisionado numa cópia local sem remote (`planning-brain-cockpit-piloto-20260922/app`, branch `feat/cockpit-ceo-piloto`, base `aa16914`), sem banco, sem deploy e sem migration aplicada.

**Decisão — área própria `cockpit_ceo` no seletor, não item de outra área.** O PRD pede o cockpit no seletor de módulos, e a fronteira de confiança é outra: ver Base não dá visão consolidada. A área ainda não existe em `ops.areas`; a proposta está em `supabase/proposals/20260922120000_cockpit_ceo_area.sql`, só para `admin`, **não aplicada** — hoje o item não aparece para ninguém. **Conflito sinalizado:** em 21/09 o dono recusou "Cockpit" como nome da área Estratégia & Execução, porque a porta de entrada descreve o Brain Financeiro como "Cockpit, fluxo de caixa…". O nome "Cockpit do CEO" vem da instrução mais recente dele; se a colisão incomodar, o módulo pode virar item de `estrategia`, que não existe neste checkout.

**Decisão — o cockpit não tem consulta própria.** Rota `/cockpit-ceo` lê `useMonetizacao()` (mesma carga, mesmas chaves e RLS de Base e Monetização). Não expõe a ninguém dado que a pessoa já não leia nessas telas. Consequência assumida: quando entrarem financeiro consolidado (F02) ou evidências de M&A (F10), esses blocos precisam de chave e servidor próprios antes de subir.

**Decisão — nenhuma regra nova.** Elegibilidade é `oferta()`, disponibilidade e procedência são `estadoProduto()`, eventos são `operacao()`, receita prevista é `receitaSomada()`. O cockpit agrega, explica e aponta a tela de origem (`src/lib/cockpit-ceo/indicadores.ts`). Seis indicadores na primeira dobra: meta de R$ 1 bi (sempre "não apurado" até haver perímetro, ano-alvo e faturamento conciliado), contratos ganhos no CRM, oportunidades validadas, leads trabalhados (eventos, com período anterior e plano mensal), receita prevista declarada no CRM e contas prontas (contas únicas; sobreposição de produtos não duplica).

**Decisão — contrato de indicador com cinco estados.** `disponivel`, `parcial` (carga com falha ou velha, com a data do dado), `nao_apurado`, `fonte_indisponivel`, `acesso_insuficiente` (sem `view.monetizacao` os comerciais não viram "0 negócios"). Cada número abre a composição com definição, período, perímetro, fonte, versão da regra, datas, soma das linhas e o destino, dizendo quando o destino não aceita o mesmo recorte (a Operação abre com o responsável padrão dela).

**Decisão — decisões e ameaças por regra fixa, não por IA.** No máximo três decisões (perímetro da meta; alocação do plano quando zerada; qualificação das contas só no Omie ou definição de cliente ativo) e ameaças determinísticas (CRM parado, ritmo de contratos abaixo da meta por dias úteis, plano sem alocação, receita prevista incompleta, queda de validadas, potencial que pode ser fornecedor).

**Decisão — preview sintético fora do `_authenticated`, só em dev.** `/piloto/cockpit-ceo` usa `fonteSintetica()` (nomes "Empresa Sintética NNN", "Unidade Exemplo …", links `#sintetico`) e responde 404 no build: conferido no bundle, `beforeLoad` compilado como `throw notFound()`. O script `scripts/cockpit-ceo/preview.sh` aponta Supabase para endereço local morto.

**Decisão — Jev só sugere, atrás de adaptador de servidor.** Contrato conferido em 22/09: `POST https://openrouter.ai/api/alpha/decisions`, `typesafe/jev-1.13`; o schema do OpenRouter exige `criteria` nas três primitivas (no `noul`, `"true"`/`"false"`), embora a página da TypeSafe o chame de opcional — o `jev_bridge.py` preparado para o piloto não enviava e seria recusado. `src/lib/cockpit-ceo/jev/`: pedido validado antes de sair, resposta validada contra a taxonomia, uma requisição sem retry, tempo limite, ledger JSONL com reserva antes da chamada, teto de 10 requisições e US$ 0,10, bloqueio quando falta `usage.cost`. Recusas 400/401/402/403/404/413/429 contam tentativa sem bloquear por custo (premissa não verificada no fornecedor). Chave lida do Keychain do macOS no servidor; nunca em variável `VITE_*`, arquivo, log ou Git. Liga só com `COCKPIT_JEV_PILOTO=1` e `NODE_ENV` diferente de production; as server functions aceitam só o id de uma pergunta fictícia. Confiança exibida como resumo da distribuição, não como probabilidade de acerto; limiar 0,5 provisório, não validado.

**Status:** implementado e testado só com fixtures, na branch do piloto. `node --test` 135/135 (95 anteriores + 40 novos), `tsc` com os mesmos 7 erros anteriores, build verde, verificação visual por CDP 15/15 sem requisição fora de 127.0.0.1 além da fonte do Google. **Não publicado, sem migration, sem homologação com dado real.** Relatório em `docs/dev_notes/cockpit-ceo-piloto/relatorio.md`.

**Próximos passos:** homologar a rota autenticada com a carga real (números conferidos contra Base de clientes e Operação no mesmo recorte; tempo de carga frio/quente); decidir área própria × Estratégia & Execução e aplicar a proposta de área; perímetro e ano-alvo da meta; definição de cliente ativo; ponte de faturamento (F02/F11) antes de qualquer número de receita realizada.

## [2026-09-22] Cockpit do CEO: revisão final corrigida e Jev real registrado (adendo à entrada anterior)

**Revisão independente da branch** (um revisor, só leitura): 0 críticos, 6 importantes. Corrigidos com teste, junto com 10 menores de efeito visível: soma da composição em centavos; carga com mais de 30 minutos marca parcial — o limite passou a ser `LIMITE_CARGA_PARADA_MS` em `monetizacao/model.ts`, usado também pela barra de frescor (antes era literal repetido); ritmo da meta só com dado fresco; recorte por unidade declara também negócio de conta sem unidade; contas prontas exigem leitura de negócios (sem ela toda conta apta pareceria livre); sem nenhuma chave, "acesso insuficiente" sem disparar a carga; período desconhecido avisa; área `cockpit_ceo` fora da primeira posição (não vira a área padrão de ninguém); fechar a composição no X desempilha o histórico. Jev: custo informado guardado mesmo com resposta fora do contrato (com o formato, sem valores), ledger em caminho fixo. Diferido: `payloadRoteamento` usar `Object.hasOwn` (inalcançável hoje). Status: `node --test` **146/146**, `tsc` com os 7 erros anteriores, build verde, CDP 16/16.

**Jev real:** 3 de 10 requisições, todas `typesafe/jev-1.13-20260917`, custo total informado US$ 0,00008379 — e-mail fictício (intenção `conhecer`, interesse exploratório, pede pessoa 0,92) e duas perguntas fictícias do CEO no preview (Execução comercial; Retenção e entrega). Detalhe em `docs/dev_notes/cockpit-ceo-piloto/jev.md`. Prova conectividade, contrato e custo, não qualidade; produção segue desligada.

**Credencial:** a chave OpenRouter foi colada no chat pelo dono. Foi gravada no Keychain (serviço `planning-openrouter-cockpit-piloto`) e não está em arquivo, log ou Git; por estar no histórico da conversa, **revogar no OpenRouter ao fim do piloto**. O revisor contestou o Keychain como depósito (persiste e é legível por processos do usuário, diferente da "chave só na memória do iniciador" do desenho original); mantido porque esta sessão não tinha iniciador, com a remoção ao fim do piloto como contrapartida.

## [2026-09-22] Cockpit do CEO, rodada 2: dado real, trajetória para 2030 e réguas candidatas lado a lado

**Contexto:** o dono pediu os lotes 1, 3, 4, 5, 6 e 7 do piloto ("executa tudo exceto a integração com a main") e decidiu, nesta sessão: leitura somente leitura da produção; área `cockpit_ceo` aplicada só para `admin`; perímetro da meta = "mostrar candidatos, decido depois"; **ano-alvo 2030**; Jev com a chave atual, até 50 chamadas na avaliação. Tudo continua na cópia isolada (`planning-brain-cockpit-piloto-20260922/app`, branch `feat/cockpit-ceo-piloto`, sem remote).

**Decisão — faturamento do grupo vem da função do Faturamento, não de soma de lançamentos.** A leitura "grupo" chama `financeiro.fn_faturamento_mensal` (a mesma da tela de Faturamento do Brain Financeiro): definição DRE 1.1 por emissão, nota cancelada fora, exclusões da controladoria, recortes padrão (Finance e Negócios Estruturados fora, com o valor declarado) e meses parciais são dela. Motivo medido: `financeiro.lancamentos` guarda planilha e Omie em paralelo por mês; somar a tabela crua dá ~2× (jan–jun/2026 ~R$ 11–12 mi/mês contra ~R$ 5–6 mi do Faturamento). `v_lancamentos` escolhe a fonte vigente. O número de ~R$ 11,9 mi/mês medido mais cedo nesta sessão estava errado por isso.

**Decisão — faturamento da rede vem da apuração de royalties confirmada**, `receita_base + receita_base_antiga` (a régua de 26/08 deste log), não do `v_funil_mensal` (`data_competencia`, declarada não confiável). Mês em que uma unidade já inaugurada (`unidades.data_inauguracao`) não tem apuração confirmada é **parcial** e quebra a janela; unidade sem data de inauguração conta a partir da primeira apuração. `royalties_valor` é gravado com 12 casas: o cockpit arredonda cada apuração ao centavo antes de somar, como a fatura.

**Decisão — meta sem perímetro não tem gap.** As leituras grupo e rede aparecem lado a lado, nunca somadas (royalties das unidades são receita do grupo). Cada uma mostra média mensal dos meses fechados contíguos, múltiplo necessário para R$ 83,3 mi/mês em 2030 e, só com 12 meses fechados, o crescimento anual necessário. Mês corrente e mês que a fonte marca parcial nunca entram.

**Decisão — porta da leitura do grupo conferida no servidor.** `fn_faturamento_mensal` é SECURITY DEFINER e não confere acesso: medido com JWT simulado, um sócio regional sem Financeiro lê 0 lançamentos pela RLS e recebe a série e uma linha de cliente pela função. O cockpit só chama a função se `public.tem_produto('financeiro')` (a regra da RLS de `lancamentos`) **e** `usuario_escopo.todas_empresas` (o Financeiro exige "tudo" para o consolidado). Do payload só sai agregado mensal.

**Decisão — cliente ativo: quatro réguas candidatas, por CNPJ, com sobreposição.** Contrato de serviço ativo no Omie (situação 10, valor > 0), pagou em 90 dias, `ops.qb_clientes_ativos`, MRR > 0 (`v_cliente_mrr`). Nenhuma escolhida. Registro sem documento torna a definição parcial; CPF é exclusão declarada. Penetração por produto = conta da Base (casada por CNPJ) com negócio **ganho** no pipe de Monetização (vínculo por organização, o mesmo da Monetização), rotulada "ganho no CRM", não consumo.

**Decisão — coorte de retenção:** contratos ganhos em `ops.contratos` (o sync grava todo ganho do pipeline 2 com status fixo "Ativo" e não apaga quem sai) × churn datado da Central de Tratativas (`status = 'lost'`, `data_churn`). Só `origem_pipeline = 'inside_sales'` e unidade regional pela regra da casa (`unidade ilike '%' || nome_da_praca || '%'`, sem acento nem caixa); o lote `socios` (119) e os 338 contratos de fora da rede (Matriz, sem unidade, unidades internas) ficam fora e declarados por tipo. Denominador fixo; mês corrente e futuro vazios; coorte que começa antes do registro de churn (06/2025) fica vazia inteira; a coorte do mês em andamento não aparece; churn sem data deixa a coorte parcial; coorte com menos de 90 dias é marcada. Agregada no servidor.

**Decisão — porta por fonte antes de ler (revisão final).** Cada fonte do cockpit tem a sua policy de SELECT (papéis e chaves diferentes), e tabela que a RLS devolve vazia virava "0 clientes, disponível" ou "nenhum churn registrado". `src/lib/cockpit-ceo/portas.ts` espelha as policies (só papéis e chaves que liberam a tabela inteira; sócio por unidade e papel customizado ficam de fora — na dúvida, fecha) e cada definição, a coorte e a rede passam por ela antes de ler. Conferido contra a RLS real com JWT simulado em 8 perfis (super admin, diretor, financeiro, cs, hunter_monetizacao, auditor, sócio regional, conta sem papel): onde a porta abre, a RLS entrega a tabela inteira; o papel `financeiro` mostra o caso que motivou a regra (0 de 1.784 contratos do Omie pela RLS). Se uma policy mudar, `portas.ts` muda junto — `scripts/cockpit-ceo/perfis.mjs` mede.

**Decisão — satisfação dos sócios** aparece como fonte existente sem leitura: `ops.pesquisa_satisfacao_comite_socios` tem só a policy de INSERT público; nenhum papel lê pelo app. Quem deve ler é decisão humana.

**Decisão — padrão de leitura da homologação:** Management API com `read_only: true`; onde o papel de leitura não alcança (funções sem grant), `begin transaction read only` com o papel padrão (escrita recusada, conferido). Permissões homologadas com `set local role authenticated` + `request.jwt.claims` simulado dentro da transação.

**Aplicado em produção:** só a área `cockpit_ceo` para `admin` (`supabase/migrations/20260922220000_cockpit_ceo_area.sql`, rollback ao lado). Nada mais.

**Lacunas de acesso encontradas (NÃO corrigidas — exigem decisão de quem é dono):**
1. As 63 funções SECURITY DEFINER do schema `financeiro` são executáveis por qualquer `authenticated` e nenhuma mostra checagem de acesso no corpo. `fn_faturamento_mensal` e `fn_dre_comp_caixa_base` devolvem receita e cliente por lançamento a quem não tem Financeiro. Correção sugerida: guarda `tem_produto('financeiro')` (e escopo) no início das funções, ou revogar EXECUTE de `authenticated` e servir por edge function.
2. `ops.qb_clientes_ativos` não é `security_invoker`: um sócio regional com escopo por unidade vê 1.236 empresas de 18 unidades pela view, contra 304 pela RLS de `empresas`. Correção sugerida: `alter view ops.qb_clientes_ativos set (security_invoker = true)` depois de conferir quem depende dela.

**Status:** implementado e homologado na cópia isolada; nada integrado à main. Relatório: `docs/dev_notes/cockpit-ceo-piloto/relatorio-rodada-2.md`.

## [2026-09-23] Cockpit do CEO no Design System v2, pronto para subir (sem deploy)

**Contexto:** o dono pediu levar o Cockpit do CEO ao padrão do DS v2 e deixá-lo pronto para subir, sem push/merge/deploy de produção sem perguntar (deploy do Ops é do Eliezek, por CLI) e sem mexer em cálculo, consultas, `portas.ts`, RLS ou na homologação da rodada 2. Contrato em `docs/design/contratos/cockpit-ceo.md`, arquétipo Visão geral, aprovado pelo dono em 23/09.

**Decisão — ordem da pilha: DS v2 → filtros-multi → cockpit.** O cockpit depende de `so_omie` em `estadoProduto()` (commit de filtros-multi `180b186`, aqui `521f789`), e os 7 commits de filtros-multi nunca chegaram à main. O dono aceitou que eles entrem antes, como PR próprio. O piloto foi trazido por `git format-patch` + `git am -3` sobre essa base; nenhuma lógica de filtros-multi se perdeu no rebase (conferido commit a commit).

**Decisão — onde o cockpit mora.** Card da área na tela `/inicio` (área própria `cockpit_ceo`, já aplicada só para `admin` na rodada 2) e rota `/cockpit-ceo`. Título do menu e da aba: "Visão executiva". Pergunta do `PageHeader`: "Estamos no plano para o bilhão, o que mudou e o que é decisão minha?".

**Decisão — as seis frentes saem das abas e viram itens da lateral** (`/cockpit-ceo?frente=receita|clientes|comercial|rede|retencao|capital`), como Monetização faz com `?aba=`. Aba que troca de assunto não é filtro (N6); o estado continua na URL (N7). Cada frente tem a própria pergunta no `PageHeader`.

**Decisão — destinos corrigidos.** "Contas prontas" e a decisão de contas só no Omie abrem Produtos e listas (`view: "produtos"`), não a Base inteira; o destino da rede é Apuração de Royalties em `/unidades/royalties` (o `/royalties` antigo só redirecionava, sem avisar). Só rota e rótulo mudaram, nenhum número.

**Decisão — cor da área reusa a da Estratégia** (`--area-cockpit_ceo: var(--area-estrategia)`) até a Mika definir uma. **Coortes em escala de um tom** (`color-mix` de `--chart-1` proporcional à retenção): os cortes verde/âmbar/vermelho em 95/85/70% do piloto não tinham sido decididos por ninguém, e o codemod de cores tinha convertido esses cortes para sucesso/atenção/perigo, o que os oficializaria.

**Decisão — Jev desligado em produção, em duas travas.** (1) A rota autenticada não passa o slot do Jev: o roteador só aparece no preview sintético `/piloto/cockpit-ceo`, que responde 404 no build. (2) As server functions só rodam com `COCKPIT_JEV_PILOTO=1` **e** `NODE_ENV !== "production"`, e a chave é lida do Keychain do macOS: numa build da Vercel o Jev não liga nem com a chave configurada. Ligar em produção exige decisão do dono e do Eliezek **e** mudança de código (chave por variável só de servidor, sem prefixo `VITE_`; tirar a trava de `NODE_ENV`; montar o slot na rota real). Nenhuma chave foi escrita em arquivo.

**Revisão final** (um revisor, só leitura; as quatro restrições conferidas e respeitadas): 2 importantes e 5 menores. Corrigidos:
- a variação % só é calculada contra período anterior inteiro; janela parcial vira nota "Anterior N (parcial)";
- o motivo dos números com cadeado fica listado sob os cartões, porque o `KpiCard` em "sem acesso" não abre nem mostra nota;
- o ritmo da meta vai para a nota quando o cartão não mostra valor;
- trocar de frente empilha no histórico;
- o título da aba acompanha a frente;
- o nome do filtro citado bate com o da tela.

Mantido de propósito: os itens da lateral são URLs fixas e não carregam período nem perímetro, o mesmo comportamento dos itens da Monetização.

**Status:** branch `feat/cockpit-ceo-ds-20260923`. `node --test` 187/187, `tsc` com os mesmos 7 erros anteriores, `design:lint` RESULTADO ok (0 erros), verificação por CDP do preview 23/23, capturas antes/depois em `docs/design/capturas/cockpit-ceo/` (comparativo em `comparativo.md`). **Não publicado.** Para publicar: merge na ordem da pilha e deploy pela CLI no projeto `ops-brain` (time `planning17`), a cargo do Eliezek.

## [2026-09-23] Cockpit do CEO publicado (adendo à entrada anterior)

**Publicação autorizada pelo dono** ("pode publicar e executar"). A produção estava em `5efc3b1`, a mesma base da pilha, então o deploy novo contém tudo o que já estava no ar. Os PRs #14 (DS v2), #15 (filtros multisseleção) e #16 (Cockpit do CEO) entraram na `main` nessa ordem, com merge commit para não duplicar commits entre PRs empilhados. A `main` ficou em `24d271d`.

Deploy `dpl_4rkG6stZveofYiU7hDZfPCu2YG2t`: CLI da conta `planningbrainbot-4862`, projeto `ops-brain`, time `planning17`, feito de um worktree limpo nesse commit. Status READY, e `planningbrain.com.br` aponta para ele. Rollback: promover `dpl_37VN7ZpzgXjm6HSEdj6fd9GAKN7M` (`5efc3b1`).

**Conferido em produção:**
- `/piloto/cockpit-ceo` e `/vitrine` compilam `beforeLoad: throw notFound()`, e o navegador mostra "Página não encontrada";
- `/cockpit-ceo` tem o título "Visão executiva · Planning Brain";
- o bundle não tem chave da OpenRouter nem `COCKPIT_JEV`.

**Sem migration nova:** a área `cockpit_ceo` já estava aplicada, só para `admin`.

**Pendências:** liberar a área para o CEO se ele não for `admin`, e as duas lacunas de acesso da rodada 2 (funções SECURITY DEFINER do `financeiro`, `ops.qb_clientes_ativos` sem `security_invoker`), que continuam com os donos.

## [2026-09-23] Senha provisória em tela, ao lado do link por e-mail (revisa a decisão de 2026-09-03)

**Contexto:** o pedido foi "na gestão de usuário quero uma opção de resetar a
senha e ela aparecer na tela para enviar pro usuário, hoje está só por e-mail".
A entrada de 2026-09-03 ("E-mail transacional de acesso — link de senha, não
senha em texto") decidiu o contrário: o "Resetar senha" virou "Enviar
redefinição", e a capacidade de forçar uma senha pela UI foi removida de
propósito. Essa entrada anotou o preço da decisão sem nomear: **quem não acessa o
e-mail não entra.** É o caso real do sócio com e-mail corporativo ainda não
entregue, da caixa cheia, e de quem pede acesso pelo WhatsApp na hora. O fallback
previsto em 03/09 (copiar o link em tela) só existia quando o **envio falhava** —
não quando a pessoa simplesmente não abre o e-mail.

**Decisão — os dois caminhos convivem, e o link continua sendo o primeiro.** Na
linha de `/admin/usuarios`, "Enviar redefinição" virou o botão **"Senha"**, que
abre um diálogo com duas opções, na ordem:

1. *Enviar link por e-mail* (marcada por padrão) — o que existia. Não toca na
   senha atual.
2. *Gerar senha provisória* — grava uma senha nova de 12 caracteres e a mostra em
   tela, no mesmo card "Credenciais geradas" que o cadastro do Growth já usava. A
   senha anterior para de valer na hora.

Um botão em vez de dois na linha: a diferença entre os caminhos (um troca a
senha, o outro não) não cabe num rótulo, e o diálogo é onde ela é dita.

**Decisão — a senha provisória é provisória de verdade, e isso é o que segura o
risco de 03/09.** O argumento de lá continua de pé: senha que trafega por
WhatsApp fica gravada no aparelho de duas pessoas. A resposta não é proibir o
caminho, é encurtar a vida da senha. `adminGerarSenhaProvisoria` marca
`senha_provisoria: true` no **`app_metadata`** da conta, e o portão de
`/_authenticated` manda quem está marcado para `/redefinir-senha` antes de
qualquer tela. A pessoa não navega no Ops com a senha que passou por WhatsApp.

Por que `app_metadata` e não `user_metadata`: `user_metadata` é escrita pelo
próprio usuário com o token dele, e a marca é justamente o que o obriga a
trocar — ele não pode se desmarcar. Como a marca viaja dentro do JWT, o portão
lê sem ida ao banco, e ela só aparece no token emitido **depois** da geração,
que é exatamente o login feito com a senha provisória.

**Decisão — não vale para a própria conta.** O rádio fica desabilitado quando o
alvo é o próprio admin, e o servidor recusa também. Trocar a própria senha por
uma aleatória que você mesmo terá de trocar no login seguinte não serve para
nada e derruba a própria sessão por engano; para isso existe o "Esqueci minha
senha" do login.

**Arquitetura:**
- `src/lib/senha-provisoria.ts` — a marca e o `temSenhaProvisoria(user)`, puro,
  lido pelo portão e pela tela de redefinição.
- `src/lib/senha-provisoria.functions.ts` — `concluirSenhaProvisoria` apaga a
  marca. Age só sobre `context.userId` (a pessoa marcada não é admin, então o
  alvo não pode vir do corpo do pedido). Apaga passando `null`: o GoTrue mescla
  o `app_metadata` recebido e remove chaves nulas, o que preserva a concessão do
  Financeiro (`brain`) e o `provider`, que moram no mesmo objeto.
- `src/lib/admin-users.functions.ts` — `adminGerarSenhaProvisoria`, ao lado de
  `adminEnviarRedefinicaoSenha`, que não mudou.
- `src/lib/password-recovery-flow.ts` — nova fonte de identidade `{ kind:
  "sessao" }`: sem OTP, a prova é a sessão que a pessoa abriu com a senha
  provisória. `{ kind: "missing" }` continua **recusando** sessão logada (o teste
  "Link ausente não aproveita uma sessão já logada" segue valendo) — só a tela
  escolhe a fonte `sessao`, e só depois de conferir a marca.
- `src/routes/redefinir-senha.tsx` — atende também quem chega sem link na URL e
  com a marca. Depois de salvar, apaga a marca e **renova o token**: sem renovar,
  o portão leria o JWT antigo e devolveria a pessoa para a mesma tela em laço. Se
  a limpeza ou a renovação falhar, faz `signOut` e pede para entrar de novo — a
  senha nova já está salva, e o próximo login emite token limpo.
- `src/routes/_authenticated/route.tsx` — o portão. Fica no layout e não em 56
  páginas; `/auth` e `/redefinir-senha` estão fora dele, então não há laço.

**Status:** `tsc --noEmit` sem erro novo (os 7 que aparecem são pré-existentes,
em `integracoes-status`, `admin.integracoes`, `rede-overview` e
`reforma-tributaria`), `node --test tests/password-recovery-flow.test.mjs` 10/10
com 2 casos novos, `design:lint --changed` sem violação nova. **Não commitado
nem deployado** — regra de subir só local até o dono pedir.

**Nota sobre a catraca do `design:lint`:** V6 aparece como 21 contra baseline 20,
e não é desta mudança — `origin/main` (`48ca198`) já tem 21 `confirm()` em `src`,
e o `lint-baseline.json` foi gerado em `3360bfa`. Quem regenerar o baseline
resolve; não regenerei para não misturar isso com esta mudança.

**Por que a senha nova não passa pelo nosso servidor:** a troca continua sendo
`supabase.auth.updateUser({ password })` do navegador direto para o GoTrue, e a
nossa função só apaga a marca depois. O preço é que a limpeza não é atômica com a
troca: alguém marcado poderia chamar `concluirSenhaProvisoria` na mão e ficar com
a senha provisória. Isso não escala privilégio nenhum — a senha é dele —, e o
outro desenho (mandar a senha nova para uma função de servidor, que trocaria e
limparia junto) faria a senha em texto passar pelo nosso código e pelos nossos
logs. Preferi o desenho em que ela não passa.

**Limite conhecido, pelo mesmo motivo que dá a vantagem:** a marca viaja no JWT,
então quem **já tinha sessão aberta** continua navegando com o token antigo (sem
marca) até ele expirar — a senha nova é exigida no próximo login, não na hora.
`updateUserById({ password })` não derruba sessões, e o supabase-js não expõe
revogação por `user_id`. Na prática não aparece: a senha provisória é para quem
não consegue entrar, e esse não tem sessão aberta. Se um dia precisar valer na
hora, o caminho é o portão ler a marca no banco em vez do token, ao custo de uma
consulta por navegação.

**Pendente:** teste ponta a ponta com uma conta de verdade (gerar, entrar com a
senha, conferir que o portão leva a `/redefinir-senha` e que depois de trocar a
navegação libera). Não feito porque mexe em senha de gente real em produção.
