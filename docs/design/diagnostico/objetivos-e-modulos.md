# Planning Brain: diagnóstico de objetivo por módulo

Data: 23/09/2026. Auditoria somente de leitura, feita sobre specs, PRDs, DECISIONS, código de rotas e `git log`. Nenhum banco foi consultado.

**Siglas das fontes**

| Sigla | Arquivo |
|---|---|
| `PU/` | `PM Work/projeto-unificado/` |
| `FM/` | `PM Work/execution/planning-brain-filtros-multi/` (worktree mais novo do Ops) |
| `D` | `FM/DECISIONS.md` |
| `S` | `FM/docs/spec-cockpit-da-base.md` |
| `N` | `FM/docs/dev_notes/cockpit-navegacao-ux/estudo.md` |
| `CP/` | `PM Work/execution/planning-brain-cockpit-piloto-20260922/briefing/` |
| `W/` | `PM Work/execution/brain-web` (Growth) |
| `F/` | `PM Work/execution/brain-financeiro-planning` (Financeiro) |
| `M/` | `/Users/pluca/Desktop/AI Projects/monetizacao` |
| `FC` | `PU/spec-tela-fila-cella.md` |
| `CRM` | `PU/spec-telas-crm-nucleo.md` |

O mapa de rotas vem de `FM/src/lib/areas.ts`, que é a fonte única da lateral e da porta de entrada, de `FM/src/routes/_authenticated/*` e de `F/src/App.tsx`. O mapa do Growth vem de `W/src/components/Navegacao.tsx`.

---

## 0. Diagnóstico em uma página

1. **O Brain tem um objetivo declarado, mas ele mudou três vezes e nenhuma tela o herda.**
   - Em 20/08 o objetivo era "clareza de gestão ponta a ponta — a métrica do growth conectada à do financeiro e à da expansão", com monetização "adiada de propósito" (`PU/spec-banco-unico.md:18`).
   - Em 22/09 passou a ser o cockpit onde "o Pedro consiga responder todas as suas perguntas", com a meta de R$ 1 bi/ano (`CP/PRD.md:7-11`).
   - A narrativa operacional de 22/09 é "transformar essa capacidade [a base] em carteira comercial confiável, trabalho executado e receita atribuível" (`CP/contexto-roadmap.md:17`).
   - O que falta é o elo entre a pergunta do CEO e a ação de quem opera. Hoje a maioria das telas **exibe**. Só três **forçam ação por linha**:
     - Fila Cella;
     - Base de clientes com "Preparar lista → Enviar ao Pipedrive";
     - Distribuição do Growth.
2. **As regras de "tela que facilita a ação" já estão escritas, só que espalhadas.** Estão em FC, CRM, PRD do cockpit, DECISIONS e no Financeiro (selo de fonte, frescor). Nenhuma delas virou contrato transversal de navegação. A seção 3 consolida esse material em 14 regras citáveis.
3. **Os maiores riscos de produto são quatro:**
   - números homônimos com denominadores diferentes;
   - telas que mandam para destinos cujo total não bate com o número clicado;
   - o mesmo "job" em duas ou três casas: S2 `/crm` × `/fila-cella` × `/monetizacao`, OKRs em Growth e em Estratégia & Execução, e "Cockpit" com três significados;
   - a ausência de telemetria de navegação, porque ninguém sabe quais telas são usadas (`N:54`).

---

## 1. Objetivo do Brain e o "job to be done" por público

**Objetivo em uma frase.** Fazer cada pessoa do Grupo Planning, do CEO ao hunter, saber em minutos o que está acontecendo com clientes, rede e dinheiro. Isso vale só para números com procedência. A partir daí ela deve executar a próxima ação que converte a base que já é nossa em receita atribuível, rumo a R$ 1 bi/ano.

A síntese vem de `CP/PRD.md:15`, `CP/contexto-roadmap.md:17`, `PU/spec-banco-unico.md:16-18` e `PU/narrativas-v2.md:9-13`.

| Público | Job to be done (quando… quero… para…) | Onde está hoje | Fonte |
|---|---|---|---|
| **CEO / sócios da matriz** (Pedro Araújo) | Quando abro o Brain, quero entender em 1 min como estamos, o que mudou, de onde vem o crescimento, o que ameaça o resultado e quais decisões são minhas, para alocar capital e cobrar donos. | Piloto `/piloto/cockpit-ceo` (fixture sintética); Financeiro `/` (Cockpit); `/rede-overview`; OKRs | `CP/PRD.md:15,23-38`; `F/README.md:3-5` |
| **Comercial / pré-venda / hunter** (Matheus, Jordana, closers, SDR) | Quando começo o dia, quero saber quem ligar, com qual argumento e onde parei, para bater abordagens → reunião → proposta → ganho. | `/fila-cella`; `/monetizacao` (Operação, Follow Day); `/clientes` → Produtos e listas; Growth `/comercial/*` | `FC:1385-1442`; `CRM:20`; `D:1194`; `W/.../sdr/page.tsx:715` |
| **Marketing / Growth** (Mikael) | Quando reviso campanhas, quero saber qual recorte compra MQL/reunião no preço certo, para escalar ou cortar verba. | Growth `/trafego`, `/trafego/otimizacao`, `/criativos` | `W/.../trafego/otimizacao/page.tsx:521` |
| **CS / Relacionamento** (Mônica Sumaya, Thais) | Quando olho a carteira, quero ver quem está em risco (NPS, inadimplência, tratativa) e agir antes do churn. | `/painel-cs`, `/nps`, Contratos e churn, IDU | `D:616,862-870`; `N:111-136` |
| **Financeiro / controladoria** (Ana, Daniel) | Quando fecho o mês, quero DRE, caixa e repasse conciliados e com a régua declarada, para fechar sem planilha e sem número que ninguém percebe errado. | Brain Financeiro (`/dre-comp-caixa`, `/fluxo-caixa`, `/repasse-indicacao`, `/inadimplencia`) + Ops Receita e Repasses | `F/README.md:7-8`; `F/produto/duas-reguas-dre-e-fluxo.md:618-637` |
| **Gestão da rede / expansão** (diretoria, sócio regional) | Quando olho a rede ou minha unidade, quero saber quais unidades crescem com margem e o que devo, recebo ou cobro, para agir na unidade fraca. | `/rede-*`, `/idu`, `/indicadores-trimestre`, `/painel-unidade`, `/unidades/*`, `/meus-royalties` | `D:724-870,1069-1086,1346-1360` |
| **Gestão de pessoas** (líderes) | Quando cuido do time, quero ver minha vez, meu time e minha unidade (liderança, PDI, avaliação). | `/gente?visao=*` | `D:1044-1065`; commit `refactor(people)` 22/09 |
| **Admin** (Eliezek, super admin) | Quero conceder o mínimo necessário por área e página e ver como o usuário vê. | `/admin/*`, "ver como" | `D:1090-1130,1384-1434,1554-1564` |

---

## 2. Tabela por módulo

**Como ler a coluna Estado:**
- **E** = existe e em uso;
- **P** = parcial, existe mas não provoca a ação, ou tem defeito ou folga conhecida;
- **N** = não existe.

"Decisão/ação" é o que o módulo **deveria** provocar segundo as specs. Quando a spec não diz, a célula é marcada *[inferido]*.

### 2.1 Ops (apex `planningbrain.com.br`), por área de `areas.ts`

| Área → módulo | Rota | Público | Decisão / ação que deve provocar | Métrica de sucesso | Info mínima para agir | Estado | Fontes |
|---|---|---|---|---|---|---|---|
| Entrada | `/` → `/inicio` | todos | Ir direto ao produto de trabalho, sem pedágio: 1 produto vai direto, sócio regional vai para `/painel-unidade` | tempo até a 1ª tela útil *[inferido]* | produtos a que tem acesso; produto padrão (cookie) | E | `routes/_authenticated/index.tsx`, `inicio.tsx:14-28` |
| **Estratégia & Execução** | OKRs (área `estrategia`, ordem 5) | admin, diretor, head, dir. comercial | Atualizar status de ação ou ponteiro de KR; cobrar o KR sem medição | ritmo × esperado; KRs "sem medição" → 0 | KR, dono, ponteiro, confiança | P (módulo criado; OKRs ainda duplicados no Growth) | `D:1883-1907` |
| Rede | `/rede-overview` | diretoria, CS | Identificar a unidade/vendedor fora da curva e abrir o detalhe ("resumo aqui + link Ver detalhe") | NPS/ICS, ranking | MRR, churn, inadimplência por unidade | P (cards "Ver clientes ativos" levam a total que não bate) | `D:616,638,724-732,2158-2160` |
| Rede | `/idu` | diretoria, sócio | Definir plano de ação da unidade com nota baixa | IDU 0-100 por trimestre; churn ≤5% | 4 pilares, meta por indicador | E | `D:862-870` |
| Rede | `/indicadores-trimestre` | diretoria/Expansão | Substituir o deck manual | paridade com Power BI | LTV=MRR×60, inadimplência por vencimento | E | `D:796-804` |
| Rede | `/rede-realizado`, `/rede-ltv`, `/rede-headcount` | diretoria | *[inferido]* comparar unidades | — | — | E (sem spec de decisão) | `areas.ts` |
| **Base de clientes** | `/clientes` (5 entradas: Base · Produtos e listas · Validar origem (N) · Contratos e churn · Entenda os números) | hunter/closer, Monetização, sócio | "clicar na unidade → auditar nominalmente → pesquisar → montar lista", e daí enviar ao CRM | contas aptas e disponíveis por produto; lista → envio → 1º trabalho → oportunidade → ganho | CNPJs distintos, procedência, produto elegível, motivo de exclusão, estado no CRM | P (navegação refeita em 22/09; guarda `view.aquario` não aplicada; KPIs duplicados/homônimos) | `S:214`; `D:1823-1836,2148-2210`; `N:146-203`; `CP/contexto-roadmap.md:93-94` |
| Base | Validar origem (N) | Monetização/unidades | Resolver a conta pendente pelo motivo real | fila → 0 por motivo | motivo segmentado (identidade, unidade, origem, cliente/fornecedor…) | P (494 sem destino) | `N:74-88`; `CP/contexto-roadmap.md:83` |
| Base | Contratos e churn | CS | *[inferido]* agir sobre inadimplente/churn | — | status financeiro, tratativa | P (sobrepõe Tratativas de `/painel-cs`; `central_tratativas` sem linha nova desde 19/08) | `N:111-136`; `D:2202` |
| Base | `/painel-cs` | CS | Tratar o cliente em risco | churn, Customer Health | saúde da carteira, tratativas | P (tratativa sem caminho de escrita no Ops) | `D:452,497-505` |
| Base | `/nps` | CS, sócio | Responder ao detrator *[inferido]* | NPS, taxa de resposta | resposta + cliente | E | `areas.ts` |
| Base | `/auditoria-interna` | Qualidade | *[inferido]* | — | — | E (sem spec lida) | `areas.ts` |
| Base | `/reforma-tributaria` | consultor → cliente | Rodar simulação **para um cliente** | — | dados do cliente | E | `areas.ts` (comentário) |
| Base | `/disparos-whatsapp` | só super admin | Disparar campanha (custa por conversa) | — | público, template | E (bloqueada 17/09) | `areas.ts`; `D` 17/09 |
| Base | `/base-contatos` | CS/comercial | Encontrar o contato | — | contato ↔ conta | P (duplica a view Contatos de `/clientes`) | `N:90-98` |
| **Receita e Repasses** | `/funil-receita` | diretoria, controladoria | Ver onde a receita contratada não vira faturada/recebida | MRR → faturado → recebido | MRR em cascata Omie>Pipefy>Pipedrive | P (tarja de cobertura removida; auditoria "numa tela só" ainda não existe) | `D:1953-1980,2074-2089` |
| Receita | `/contas-receber` | controladoria, sócio (área própria) | Cobrar | aging | título, vencimento | E | `areas.ts`; `D:1346-1360` |
| Receita | `/unidades`, `/unidades/royalties`, `/historico`, `/funil-cac`, `/split` | controladoria/matriz | Apurar → confirmar → emitir faturas no Omie; cobrar CAC | apurações confirmadas/faturadas; CAC recebido × a receber | regra por unidade, base de caixa | E | `D:973,1027,1069-1086,1570-1689` |
| Receita | `/comissoes`, `/ebit-operacional` | matriz | Ratear custo e apurar comissão | — | — | E | `areas.ts` |
| **Planning People** | `/gente?visao=minha-vez / meu-time / minha-unidade / rede / admin` | colaborador, líder, sócio | Liderança, elogios, avaliação, PDI | — | — | P (trilha que substituiria o Qulture não existe) | `D:1044-1065`; `areas.ts` |
| **Monetização** | `/monetizacao` (Operação, Temporal, Forecast, Capacidade, Follow Day, Funil, Pessoas/PDI, Abordagens, Distribuição) | hunter, gestão comercial | Trabalhar a fila de negócios; alocar capacidade por produto | 120 leads / 60 reuniões / **8 ganhos** (set.) | negócio, produto, estágio, próximo passo | P (alocação Cella/Finance/Consultoria 0/0/0; refresh perto do timeout) | `D:1165-1215,1524-1538,2162-2181`; `CP/contexto-roadmap.md:41-52` |
| Monetização | `/fila-cella` | Matheus (escreve), daily (vê) | "abre a primeira linha desbloqueada" e registra toque | KR1 ≥40 abordagens/sem; KR2 ≥10% reunião; KR3 ≥5 propostas; 100% motivo de perda | 16 colunas "vale a pena? posso? o que eu digo? onde parei?" | P (spec v0.3 de 25/08; migrations eram proposta) | `FC:44-49,1385-1461,1854` |
| **Broker** | `/broker`, `/broker/admin` | unidade, matriz | Pegar oportunidade da fila; matriz vê custo/CAC | — | oportunidade; custo só na matriz | E | `D:165-177`; `areas.ts` |
| **Minha Unidade** | `/painel-unidade` (+ clientes, CS, NPS, IDU, broker, financeiro opcional) | sócio regional | Agir na própria unidade | IDU, carteira | dados da unidade (RLS restritiva) | P (sócio aterrissa em "Produtos e listas" vazio por falta de chave, sem aviso) | `D:1346-1360,1929-1951`; `N:206-229` |
| **Admin** | `/admin/*`, `/equipe`, `/atividade`, `/admin/validacao` | super admin, admins de área | Conceder o mínimo; validar página antes da main | — | papel, área, chave | E | `D:1090-1130,1384-1434` |
| Rotas órfãs/redirect | `/aquario`, `/operacao`, `/auditoria*`, `/simulador-caixa`, `/rede`, `/dre-partners`, `/royalties*` | — | nenhuma (redirecionam) | — | — | legado | `routes/_authenticated/*.tsx` |
| Fora do menu, vivas | `/financeiro-partners`, `/pagamentos-unidades` | ? | ? | — | — | **sem dono de menu** (Partners dissolvida em 14/09) | `areas.ts:~95` comentário |

### 2.2 Cockpit do CEO (piloto)

| Módulo | Rota | Público | Decisão | Métrica | Info mínima | Estado | Fonte |
|---|---|---|---|---|---|---|---|
| Cockpit do CEO | `/piloto/cockpit-ceo` (candidata `/cockpit-ceo`) | Pedro Araújo (CEO) | Responder as perguntas inventariadas e identificar a ação ou decisão | perguntas com evidência suficiente; resumo ≤3 s; clique confere com a composição | ≤6 indicadores + comparação com plano + ≤3 decisões; 6 frentes; contrato de indicador em 14 campos | P (piloto isolado, fixture sintética, sem remote; área só para admin) | `CP/PRD.md:21-38,77-79,106-117` |

### 2.3 Growth (`/growth`, brain-web)

Público: Marketing, Comercial e Diretoria, cerca de 25-30 pessoas. A diretriz de cada tela é o título-pergunta, e esse é o padrão mais maduro da casa.

| Rota | Pergunta que responde / ação | Estado | Fonte |
|---|---|---|---|
| `/` Executivo | "A meta de {mês} ainda fecha?" / "Onde o funil perde" | E | `W/src/app/page.tsx:376,397` |
| `/trafego`, `/trafego/otimizacao` | "O investimento está comprando MQL no preço certo?"; escalar ou cortar | E (realocação é só leitura) | `trafego/page.tsx:455` |
| `/criativos`, `/roteiros` | "Qual ângulo entrega a reunião mais barata?"; aprovar/descartar roteiro | E | `criativos/page.tsx:327` |
| `/comercial/sdr`, `/closer`, `/temporal`, `/followday` | qualificação → reunião → contrato; dinheiro parado | E | `sdr:715`, `closer:541` |
| `/comercial/distribuicao` (+fila, regras) | "Para qual unidade essa oportunidade deveria ir?" | E | `distribuicao/page.tsx:15-19` |
| `/pessoas`, `/pdi`, `/comparar` | radar do time, PDI | E (**duplica** Pessoas/PDI de `/monetizacao` e People) | — |
| `/okrs` | ritmo, risco, delta, confiança | E (**duplicado** com Estratégia & Execução) | `D:1883-1907` |
| `/decisoes`, `/tv`, `/usuarios` | registro de decisões; TV; admin | E | — |

### 2.4 Brain Financeiro (`/financeiro`)

Público: CEO (leitura), Daniel (operação) e Ana (controladoria). O menu vem do servidor e a empresa é escolhida primeiro.

| Rota | Pergunta / ação | Estado | Fonte |
|---|---|---|---|
| `/` Cockpit | "Como a empresa está agora?"; sobra para os sócios; alertas | E | `F/produto/30-perguntas-proposta.md:16-20` |
| `/dre-comp-caixa` | "Por que meu lucro caiu?" → drill até conta/fornecedor | E | `30-perguntas:22-30` |
| `/fluxo-caixa` | Caixa do mês e do próximo, 60/90 dias ("a tela mais útil" para Daniel) | E | `specs/fluxo-caixa-matriz/spec.md:4` |
| `/bpo-equipes`, `/repasse-indicacao`, `/faturamento`, `/inadimplencia` | custo por equipe; esperado × pago; aging | E/P | `App.tsx:49-75` |
| `/aprovacoes-caixa` | aprovar pagamento | P (não há dado de contas a pagar) | `planejamento-4-frentes:176` |
| `/orcamento`, `/orcamento-equipes` | projeção ancorada no orçamento | P / porta fechada | `App.tsx:77-88` |
| `/cfo` CFO AI | canvas generativo; "o número nunca vem do LLM" | P (risco: 346 CPFs com salário) | `specs/cfo-ai-dashboard/spec.md` |

### 2.5 Saídas planejadas que não viraram tela

| Saída | Pergunta | Estado | Fonte |
|---|---|---|---|
| S1 Clusterização (explorer do Bodra) | "Pra qual cliente convém qual produto, com qual precificação?" | P (ranking existe; colunas de dinheiro não) | `CRM:20-32,270-282` |
| S2 CRM `/crm` | "Quem eu ligo hoje e com qual argumento?" | N (e competindo com `/fila-cella` e `/monetizacao`) | `CRM:20,197` |
| S3 Relatório ponta a ponta (anúncio → margem) | "qual anúncio trouxe o cliente de maior margem?" | N | `PU/spec-banco-unico.md:16`; `PU/spec-arquitetura-dominios.md:775` |
| S4 Parcerias (contrapartes da ECD) | — | N (exige parecer LGPD) | `PU/spec-banco-unico.md:22-27` |
| Funil A ("os 50 contratos" do CEO) | — | N ("sem spec") | `FC:63,103` |

---

## 3. Regras de negócio que deveriam governar a navegação

Todas vêm de algum documento. O número entre colchetes é a prioridade sugerida: [1] vira contrato de toda tela, [2] vira regra por tipo de tela.

| # | Regra | Enunciado operável | De onde veio |
|---|---|---|---|
| R1 [1] | **Toda tela começa pela pergunta que responde** | O `<h1>` ou subtítulo é a pergunta de negócio ("A meta de setembro ainda fecha?"), não o nome do dado. O cabeçalho declara o universo medido (perímetro, período, unidade de contagem). | Padrão do Growth (`W/src/app/page.tsx:376`, `sdr:715`, `trafego:455`); `CP/PRD.md:23` ("O cabeçalho deve dizer qual universo está sendo medido"); `FC:69,1399` ("Se o CEO abrir /fila-cella e achar que está vendo os 50 contratos, a tela mentiu") |
| R2 [1] | **Todo número leva ao registro que o compõe, e o destino bate** | Clicar num agregado abre exatamente os registros com a mesma regra e fotografia. Se o destino não aceita o mesmo filtro, a tela avisa que o total difere. | `FM/docs/dev_notes/base-unica-pipefy/overview.md:84` (AC07 "cada número abre exatamente os registros que o compõem"); `CP/PRD.md:15,110`; `PU/.../roadmap-original F01` ("todo agregado abre seus registros"); folga conhecida em `D:2158-2160` |
| R3 [1] | **Todo número declara procedência e frescor** | Fonte, `apurado_em` e régua (DRE comp-caixa × fluxo recebido; saldo × fluxo) ficam ao lado do valor. Declarar a régua é informação, não alerta. | `CRM:302,304`; `F/produto/duas-reguas-dre-e-fluxo.md:618-637`; `F/produto/frescor-do-dado.md:23-53`; `D:2080` (a linha de procedência fica) |
| R4 [1] | **Ausência ≠ zero; sem permissão ≠ vazio** | São cinco estados distintos: valor, parcial, não apurado, fonte indisponível, acesso insuficiente. Nunca `0` carregando. Vazio por filtro diz o total ("Nenhuma conta com esses filtros. 57 no total."). | `CP/PRD.md:79,112`; `FC:1535-1540,1811`; `CRM:303,305`; `D:1209`; `F/produto/frescor-do-dado.md:163-167` |
| R5 [1] | **Toda lista operacional tem próxima ação por linha, e a ordem padrão é a ordem de trabalho** | A linha responde "vale a pena? posso? o que eu digo? onde parei?". O primeiro item é o próximo a trabalhar. A ação está na linha ou no Sheet lateral, sem trocar de tela. Próximo passo com data é obrigatório. | `FC:1385-1387,1442,1486-1496,1516`; `CRM:197` (card de ligação); `D:1826` (card de unidade tem "linha de ação") |
| R6 [1] | **Uma camada de navegação por área, no máximo 2 níveis** | Uma área por vez na lateral. Cada destino é item de menu com rota, nunca aba escondida em aba. Filtros da mesma tabela não viram abas. | `D:1071-1073` ("Tela escondida dentro de tela não aparece em busca, não é favoritável"); `D:2183-2194` ("um menu só"); `N:292-325` (NN/g 2-3 níveis; Atlassian) |
| R7 [1] | **Estado na URL e trabalho não se perde ao navegar** | Filtros, período e perímetro persistem na URL e entre telas. Seleção e rascunho de lista sobrevivem à troca de entrada. Descartar rascunho sempre pergunta. | `CP/PRD.md:98,109`; `D:2120-2146,2190`; `W/docs/plano-pessoas-comparar.md:21-22`; `N:292` (Linear: filtros na URL) |
| R8 [2] | **Sem permissão, degradar com motivo, nunca esconder dado sem dizer** | O item de menu só aparece com a chave. Dentro da tela, o botão sem permissão fica desabilitado com o motivo. A tela diz qual permissão falta. | `D:2154`, `D:1080` (`GuardaUnidades`); `FC:1540`; `F/src/components/layout/SemSessao.tsx:7-18` |
| R9 [2] | **Auditoria mora numa tela só; tela de trabalho não carrega alarme** | Lacuna de fonte vai para uma central de evidências. Na tela operacional fica a linha de procedência, não o selo âmbar. Alarme que não apaga ensina a ignorar. | `D:2074-2089`; `CP/PRD.md:79` ("central de evidências"); `F/produto/frescor-do-dado.md:131-145` |
| R10 [2] | **Não duplicar operação; o agregador direciona** | Cockpit e overviews agregam, explicam e mandam para a tela dona. Não montam lista nem executam. Proibido o "terceiro painel do mesmo dado". | `CP/PRD.md:38`; `CRM:54`; `FC:97`; `PU/spec-banco-unico.md:34` ("Banco Único lê, não reescreve") |
| R11 [2] | **Rótulo declara a unidade de contagem; o mesmo nome tem o mesmo denominador** | Conta, CNPJ, cliente ativo, contrato, negócio e evento são coisas distintas. Clientes únicos não são soma de ofertas. Dois números com o mesmo rótulo na mesma tela são defeito. | `CP/PRD.md:81-91,111`; `D:1817-1826`; `N:150-175` (4.731 × 2.356 "retroativas") |
| R12 [2] | **Primeira dobra executiva: ≤6 indicadores, comparação com plano, ≤3 decisões** | Detalhe técnico e tabela longa ficam em abertura contextual ou no destino operacional. | `CP/PRD.md:25`; `PU/.../roadmap-original:195` (linha por pilar: estado → próximo resultado → indicador → dono → próxima decisão) |
| R13 [2] | **Meta e realizado sempre juntos; meta nunca vira previsão** | KR1 e KR2 no mesmo cartão. "Os oito contratos continuam sendo meta, nunca previsão". R$ projetado não é apresentado como receita. | `FC:1434,1817,1819`; `D:1194`; `CP/PRD.md:91` |
| R14 [2] | **Rota aposentada explica, não some** | Tela aposentada mostra o motivo e o link da substituta. Redirect silencioso não basta. | `F/src/App.tsx:20-26,66-73`. O Ops hoje faz redirect silencioso (`/aquario`, `/auditoria`, `/rede`…) |

Três regras de governança sustentam essas 14:
- "Uma coluna, um escritor" (`CRM:301`; `PU/plano-execucao.md:188`).
- "Validação de página… herdada pelo caminho pai" (`D:1084`).
- Nenhuma tela é declarada entregue sem conferir a versão publicada (`CP/PRD.md:117`; `D:2192`).

---

## 4. Conflitos e lacunas entre specs

### 4.1 Objetivo e nome
1. **Três objetivos sucessivos, nenhum revogado formalmente:**
   - "big data, monetização adiada" (`PU/spec-banco-unico.md:18`, 20/08);
   - "uma query campanha → MRR → margem" (`PU/spec-arquitetura-dominios.md:775`, 27/08);
   - "cockpit do CEO rumo a R$ 1 bi" (`CP/PRD.md`, 22/09).
   A meta de R$ 1 bi não tem perímetro nem ano-alvo (`CP/PRD.md:11,121`).
2. **"Cockpit" tem três significados:**
   - o Cockpit do Brain Financeiro (`/financeiro/`);
   - o "Cockpit da base" em `/clientes` (`S`);
   - o Cockpit do CEO.
   Em 21/09 o dono descartou o nome "Cockpit" para a área nova, por colidir com o Financeiro, e ficou **Estratégia & Execução** (`D:1889`). No dia seguinte o PRD do piloto voltou a chamar o módulo de "Cockpit do CEO" (`CP/PRD.md:21`). **Decisão pendente:** o Cockpit do CEO é a área Estratégia & Execução, ou é outra coisa?

### 4.2 Telas duplicadas / mesmo job em várias casas
3. **Fila de ligação (S2) em três lugares:**
   - `/crm` no repo do Bodra (`CRM`);
   - `/fila-cella` no Ops (`FC:26`);
   - `/monetizacao` Operação.
   `CRM:54` e `FC:97` proíbem o "terceiro painel do mesmo dado".
4. **OKRs em dois apps** (Growth `/okrs` e Estratégia & Execução). É duplicação com prazo, e o passo 2 não foi executado (`D:1901-1907`).
5. **Pessoas/PDI em três lugares:** Growth `/pessoas` e `/pdi`, `/monetizacao?aba=pessoas` e Planning People `/gente`.
6. **Funil comercial em dois lugares:** Growth `/comercial/*` para o inbound e `/monetizacao?aba=funil` para a base. A fronteira não está documentada.
7. **Contratos e churn (Base) × Tratativas (`/painel-cs`) × `/contas-receber` × `/inadimplencia` (Financeiro).** São três réguas de "ativo" ou "inadimplente": "ATIVO = pagou nos últimos 90 dias" contra "não deu churn" (`D:2158-2160`).
8. **Contatos:** a view oculta de `/clientes` e `/base-contatos` (`N:90-98`).
9. **Distribuição:** Growth `/comercial/distribuicao` e `/monetizacao?aba=distribuicao`.

### 4.3 Navegação e permissão
10. **A Base de clientes tem três formas concorrentes:**
    - 4 blocos numa rolagem (`S:153`);
    - rotas irmãs com abas no menu lateral (`N:230-252`);
    - faixa única no topo, na mesma rota (implementado em 22/09, `D:2189`).
    As rotas irmãs seguem pendentes (`D:2210`).
11. **Guarda de "Produtos e listas":** a decisão é `view.aquario`, mas a entrada aparece para todos. O sócio regional aterrissa em bloco vazio sem aviso (`D:2154` × `D:2210`; `N:217`).
12. **Ops faz redirect silencioso, Financeiro explica a rota aposentada.** São duas doutrinas (R14).
13. **`/financeiro-partners` e `/pagamentos-unidades` estão vivas e fora do menu** desde que Partners foi dissolvida em 14/09. Ficaram sem dono de navegação.

### 4.4 Dado e régua
14. **Denominadores homônimos:**
    - "retroativa" 4.731 × 2.356;
    - KPIs repetidos em card e KPI (63/160/2.329) (`N:150-175`).
15. **"Cliente" tem três definições:**
    - a Base conta contas conciliadas;
    - Contratos conta "pagou em 90 dias";
    - o card da Rede conta "não deu churn".
    Soma-se a D-3/D-4 da arquitetura (`PU/spec-arquitetura-dominios.md:430-432`). O "cliente ativo por contexto" continua como decisão de negócio aberta (`CP/PRD.md:121`).
16. **A arquitetura de dados foi superada pela prática.** A spec de domínios manteve três bancos, um núcleo e telas que "nunca leem origem" (`PU/spec-arquitetura-dominios.md:464`). Na prática, Ops e Growth já estão no banco único, e o Financeiro ainda documenta o projeto antigo. As specs em `PU/` não foram atualizadas.
17. **Pergunta sem tela:** o Funil A ("os 50 contratos") e o S3 (anúncio → margem), que era o teste de sucesso original, não têm spec de tela.

### 4.5 Módulos sem dono claro
18. As telas abaixo não têm dono de produto nomeado nas fontes lidas:
    - `/auditoria-interna`;
    - `/rede-realizado`, `/rede-ltv` e `/rede-headcount`;
    - `/comissoes` e `/ebit-operacional`;
    - Recon, cujo lugar "segue pergunta aberta" (`D:2196`);
    - a fila "Validar origem" (494 contas sem destino);
    - Tratativas, que não tem caminho de escrita;
    - o ranking de vendedores da Fase 2.
19. **Não há telemetria de navegação.** `ops.acessos_log` tem 22 linhas e registra só ações administrativas (`N:54`). Não há como saber quais telas são usadas antes de cortar ou fundir.

---

## 5. Quem é dono de quê

### Commits por repo (`git log --format='%an' | sort | uniq -c`)

| Repo | Autores |
|---|---|
| `revenue-auditor-hub` (Ops, origin `victoreliezek/…`) | victoreliezek 231 · Victor Eliezek 34 · direcao-azb-collab 7 · pedro luca marques 2 · planningbrainbot 1 |
| `planning-brain-filtros-multi` (Ops, clone raso, origin `planningbrainbot/…`) | pedro luca marques 29 · Victor Eliezek 20 · victoreliezek 16 · planningbrainbot 7 · pedroluca-prog 5 · Pedro Luca 1 |
| `brain-web` (Growth; clone raso com 1 commit) | victoreliezek 1. A autoria real não é visível. Pelas specs, o decisor é o Mikael. |
| `brain-financeiro-planning` (origin `pedroluca-prog/…`) | Planning Brain Bot 65 · direcao-azb-collab 32 · Victor Eliezek 11 · planning-ds 4 · brain-baseline 1 |
| `monetizacao` | Pedro Luca 16 |
| Cockpit piloto (sem remote) | "Planning Cockpit Pilot" 22 |

### Dono por módulo (commits + docs)

| Pessoa | Dono de | Evidência |
|---|---|---|
| **Pedro Luca** ("o dono" no DECISIONS) | Decisões de produto e navegação da Base de clientes; Monetização (Caixa de Oportunidade, `/monetizacao`, `/fila-cella`); regras de origem e produto; Cockpit do CEO (piloto); Brain Financeiro (repo seu, commits por bot e pela conta AZB); specs do projeto unificado | Commits `feat(base\|cockpit\|listas\|aquario\|monetizacao)`; `D:1753,2148-2210`; `FC`/`CRM` (autor); `PU/spec-arquitetura-dominios.md:673-748` |
| **Victor Eliezek** | Repo e casca do Ops (lateral, áreas, `/inicio`); acessos, permissões, níveis, "ver como"; Rede/IDU/Indicadores; Receita e Repasses (royalties, CAC, split); Clientes/MRR/contratos; Planning People; Broker; NPS/CS; domínio `planningbrain.com.br` e Vercel; migração do Growth para o banco único | Commits `feat(acessos\|royalties\|cac\|people\|clientes\|idu\|broker)`; `PU/spec-ambiente-planningbrain.md:360,501`; `D:239` |
| **Mikael (Mika)** | Growth (produto e decisões de acesso, deploy em horário comercial, migração 14/09); auditoria de segurança do banco único (21/09); sequência do Financeiro Omie → paridade → preditivo | `W/docs/superpowers/specs/*` (aprovador); `W/AGENTS.md:29-30`; `D:1840-1856`; `F/specs/cockpit-financeiro-v1.md:23` |
| **Bodra (Gustavo/Silas)** | ECD/AWS e `new-business-explorer` (S1 clusterização, chat); rebuild ECD; credencial read-only | `CRM:325,338,342`; `PU/spec-arquitetura-dominios.md` (D-1, D-2, D-7). Ausente de DECISIONS e do Ops. |
| **CEO (Pedro Araújo)** | Sponsor do Financeiro; usuário do Cockpit; escolhe cluster piloto e "quem disca" | `F/README.md:3-5`; `CRM:435` |
| **Ana (controladoria)** | Regras de fechamento, orçamento, `admin_financeiro`. Os docs do Financeiro dizem "Ana Laura" e o DECISIONS diz "Ana Carvalhais". Confirmar se são a mesma pessoa. | `D:1482-1487`; `F/produto/duas-reguas…:11` |
| **Matheus / Jordana** | Operação comercial (Fila Cella, metas de setembro) | `FC:42,1787-1799`; `D:1194,1209` |
| **Mônica Sumaya / Amanda** | CS (Painel de Gestão à Vista); régua de preço S1 | `D:616`; `CRM:281,437` |

**Riscos de ownership:**
- A conta `planningbrainbot` controla repositórios sem dono pessoal declarado (`PU/spec-unificacao-repos.md:386,402`).
- A casca unificada foi construída pelo Eliezek "sem spec" (`PU/spec-ambiente-planningbrain.md:501`), enquanto as decisões de navegação da Base são do Pedro. Duas pessoas estão definindo a navegação do mesmo app sem uma regra comum, e é exatamente o que a seção 3 propõe resolver.

---

## 6. Próximos passos sugeridos (para a rodada de regras)

1. Adotar R1–R7 como **contrato de tela**, checável em `/admin/validacao`, que já existe como portão antes da main (`D:1084-1086`).
2. Decidir as quatro pendências abaixo. Cada uma tem dono e fonte citados.
   - Cockpit do CEO = Estratégia & Execução?
   - Qual é a casa única da fila de ligação (S2)?
   - "Cliente ativo" por contexto.
   - Forma final da Base de clientes: rotas irmãs ou faixa.
3. Instrumentar a navegação antes de cortar telas duplicadas: page view por rota e papel.
4. Para cada módulo da tabela 2 marcado P ou sem decisão, escrever a linha "pergunta → ação → métrica → dono" no formato de `CP/roadmap-original-20260918.md:195`.
