# NAVEGACAO.md · Regras de navegação e mapa do Ops

As 14 regras abaixo são contrato de toda tela do Brain (spec §2.6). Nenhuma foi inventada aqui: cada uma consolida o que já estava escrito em DECISIONS, PRDs e specs, levantado em `diagnostico/objetivos-e-modulos.md` §3 (regras R1–R14). A coluna "Fonte" repete a fonte que o relatório cita; siglas: `D` = DECISIONS.md do worktree `planning-brain-filtros-multi` (as linhas não batem com o DECISIONS desta branch; use o título da entrada), `CP` = PRD do Cockpit do CEO, `FC` = spec da Fila Cella, `CRM` = spec das telas do CRM núcleo, `F` = Brain Financeiro, `W` = Growth, `N` = estudo de navegação da Base, `S` = spec do cockpit da base.

Prioridade: **[1]** vale para toda tela; **[2]** vale por arquétipo (ver `ARQUETIPOS.md`).

---

## 1. As regras

**N1 [1] · O título é a pergunta que a tela responde.**
Regra: o `PageHeader` recebe `pergunta` (vira o `<h1>`) e `descricao` com o universo medido: perímetro · período · unidade de contagem. O nome curto (`titulo`) vira eyebrow e é igual ao rótulo do menu.
Como verificar: na revisão, o `<h1>` termina em "?" ou é uma pergunta de negócio; `titulo` === `title` do item em `areas.ts`; `descricao` cita perímetro, período e unidade. Enquanto o dono do módulo não escrever a pergunta, fica `// TODO(design): pergunta da tela` (T8), e a tela não é "pronta".
Fonte: padrão do Growth (`W/src/app/page.tsx:376`, `sdr:715`, `trafego:455`); `CP/PRD.md:23`; `FC:69,1399`.

**N2 [1] · Todo número abre os registros que o compõem, e o total bate.**
Regra: agregado clicável (`KpiCard.abrir`, barra, linha) leva aos registros com a mesma regra e o mesmo recorte. Se o destino não aceita o mesmo filtro, a tela diz que o total difere.
Como verificar: na revisão, clicar em cada número e comparar o total do destino com o número clicado; o contrato da tela (`CONTRATO-DE-TELA.md`) declara o destino de cada número.
Fonte: `FM/docs/dev_notes/base-unica-pipefy/overview.md:84` (AC07); `CP/PRD.md:15,110`; folga conhecida em `D:2158-2160`.

**N3 [1] · Todo número declara procedência e frescor.**
Regra: fonte, data da última atualização e régua ficam ao lado do valor (`Procedencia`, `KpiCard.procedencia`, `PageHeader.procedencia`). Declarar a régua é informação, não alerta.
Como verificar: nenhum `KpiCard` de tela nova sem `procedencia` ou sem `procedencia` no `PageHeader`; revisão confere que a régua aparece quando há duas (competência × caixa).
Fonte: `CRM:302,304`; `F/produto/duas-reguas-dre-e-fluxo.md:618-637`; `F/produto/frescor-do-dado.md:23-53`; `D:2080`.

**N4 [1] · Ausência ≠ zero; sem permissão ≠ vazio.**
Regra: cinco estados distintos (`KpiCard.estado`: `ok`, `parcial`, `nao-apurado`, `indisponivel`, `sem-acesso`), mais carregando e erro. Nunca `0` enquanto carrega. Vazio por filtro diz o total: `EstadoVazio total={n}` ("Nenhuma conta com esses filtros. 57 no total.").
Como verificar: revisão força cada estado na vitrine ou com dado de teste; `grep` de `?? 0` em valores exibidos nas telas tocadas.
Fonte: `CP/PRD.md:79,112`; `FC:1535-1540,1811`; `CRM:303,305`; `D:1209`; `F/produto/frescor-do-dado.md:163-167`.

**N5 [1] · Lista de trabalho tem próxima ação por linha e já vem em ordem de trabalho.**
Regra: a linha responde "vale a pena? posso? o que eu digo? onde parei?". O primeiro item é o próximo a trabalhar. A ação está na linha ou num `Sheet` lateral, sem trocar de tela. Próximo passo com data é obrigatório.
Como verificar: na revisão de telas do arquétipo Fila, a ordenação padrão não é alfabética nem por data de criação; existe coluna de próxima ação; abrir a linha não navega para outra rota.
Fonte: `FC:1385-1387,1442,1486-1496,1516`; `CRM:197`; `D:1826`.

**N6 [1] · No máximo dois níveis de navegação por área.**
Regra: área (seletor) → item do menu (rota). Cada destino é item com rota própria, nunca aba escondida em aba. Filtro da mesma tabela não vira aba.
Como verificar: nenhuma tela nova com `Tabs` que troque de assunto; um item de menu não repete como aba na página (`grep TabsTrigger` nas rotas cujo item já está em `areas.ts`).
Fonte: DECISIONS 14/09 "Receitas Partners vira cinco páginas irmãs" ("tela escondida dentro de tela não aparece em busca, não é favoritável"); `D:2183-2194`; `N:292-325`.

**N7 [1] · Filtro, período, perímetro e aba moram na URL.**
Regra: estado de tela sai de `validateSearch` / `useFiltroNaUrl` (`src/lib/planning/filtro-url.ts`). Recarregar ou compartilhar o link reproduz a tela. Rascunho e seleção sobrevivem à troca de visão; descartar rascunho sempre pergunta.
Como verificar: lint avisa `Tabs defaultValue` sem `value` ligado à URL; revisão copia o link com filtro aplicado e abre em aba nova.
Fonte: `CP/PRD.md:98,109`; `D:2120-2146,2190`; `W/docs/plano-pessoas-comparar.md:21-22`; `N:292`.

**N8 [2] · Sem permissão, a tela degrada com motivo.**
Regra: item de menu só aparece com a chave. Dentro da tela, botão sem permissão fica desabilitado com o motivo no tooltip; bloco ou tela sem acesso usa `EstadoSemAcesso oQueFalta="…"` dizendo qual permissão falta.
Como verificar: revisão com "ver como" (DECISIONS 18/09) num papel sem a chave; nenhuma tela em branco.
Fonte: `D:2154`; `D:1080` (`GuardaUnidades`); `FC:1540`; `F/src/components/layout/SemSessao.tsx:7-18`.

**N9 [2] · Auditoria mora numa tela só; tela de trabalho não carrega alarme.**
Regra: lacuna de fonte vai para uma central de evidências (hoje `/admin/validacao` e as telas de auditoria). Na tela operacional fica a linha de `Procedencia`, não selo laranja permanente.
Como verificar: revisão conta `StatusBadge tom="atencao"` fixos (que não dependem do dado da linha) em tela de Fila ou Lista: zero.
Fonte: `D:2074-2089`; `CP/PRD.md:79`; `F/produto/frescor-do-dado.md:131-145`.

**N10 [2] · Visão geral agrega e direciona; não duplica operação.**
Regra: cockpit e overviews mostram resumo, pendência e caminho, e mandam para a tela dona. Não montam lista nem executam ação. Proibido o terceiro painel do mesmo dado.
Como verificar: o contrato de uma Visão geral lista a "tela dona" de cada bloco; nenhuma tabela linha a linha que já exista na tela dona. Precedente: DECISIONS 22/09 "Receita e Repasses ganha uma porta".
Fonte: `CP/PRD.md:38`; `CRM:54`; `FC:97`; `PU/spec-banco-unico.md:34`.

**N11 [2] · O rótulo declara a unidade de contagem, e o mesmo nome tem o mesmo denominador.**
Regra: conta, CNPJ, cliente ativo, contrato, negócio e evento são coisas distintas. Clientes únicos não são soma de ofertas. Dois números com o mesmo rótulo na mesma tela são defeito.
Como verificar: contrato da tela tem "unidade de contagem" em cada número; revisão procura rótulos repetidos ou sinônimos na mesma tela.
Fonte: `CP/PRD.md:81-91,111`; DECISIONS 21/09 "O card da carteira para de afirmar censo"; `N:150-175`.

**N12 [2] · Primeira dobra executiva: até 6 indicadores, comparação com plano, até 3 decisões.**
Regra: na Visão geral, a primeira dobra (1440×900) tem no máximo seis `KpiCard`, cada um com meta ou referência quando existir, e no máximo três decisões com botão de destino. Tabela longa vai para o destino.
Como verificar: captura 1440×900 na vitrine ou na tela; contar cards acima da dobra.
Fonte: `CP/PRD.md:25`; `PU/.../roadmap-original:195`.

**N13 [2] · Meta e realizado sempre juntos; meta nunca vira previsão.**
Regra: `KpiCard.meta` ao lado do valor; KRs que se leem juntos ficam no mesmo cartão (KR1 + KR2). Valor projetado não aparece como receita.
Como verificar: revisão; nenhum KPI de meta sem o realizado ao lado; rótulo "previsto"/"meta" nunca somado a "realizado".
Fonte: `FC:1434,1817,1819`; DECISIONS 15/09 "Metas preservadas" ("Os oito contratos continuam sendo meta, nunca previsão"); `CP/PRD.md:91`.

**N14 [2] · Rota aposentada explica, não some.**
Regra: rota que sai mostra o motivo e o link da substituta (`EstadoVazio` com `acao`), ou redireciona e o destino avisa de onde a pessoa veio. Redirect silencioso não basta.
Como verificar: cada `redirect` em `beforeLoad` tem aviso no destino ou página de explicação; revisão abre as URLs legadas da seção 3.3.
Fonte: `F/src/App.tsx:20-26,66-73`. **Conflito com prática atual:** o Ops faz redirect silencioso por decisão (DECISIONS 22/09 "Histórico de Royalties sai": "link antigo não pode virar 404"). As duas doutrinas convivem; ver `PRODUCT.md` §5.

**Governança que sustenta as 14** (mesma fonte, §3 do relatório):
- Uma coluna, um escritor (`CRM:301`; `PU/plano-execucao.md:188`).
- Validação de página é herdada pelo caminho pai (DECISIONS 14/09, item 5).
- Nenhuma tela é declarada entregue sem conferir a versão publicada (`CP/PRD.md:117`; `D:2192`).

---

## 2. Mapa atual do Ops (fonte: `src/lib/areas.ts` em `eea3d90`)

Lateral mostra uma área por vez; Administração fica no rodapé (DECISIONS 16/09).

```
Rede (rede)
  Visão geral ........ Overview /rede-overview · IDU /idu · Indicadores do Trimestre /indicadores-trimestre
  Desempenho ......... Realizado Unidades /rede-realizado · LTV Estimado /rede-ltv · Headcount /rede-headcount
Base de clientes (clientes)
  Carteira ........... Base de clientes /clientes · CS /painel-cs · Auditoria Interna /auditoria-interna
                       · Reforma Tributária /reforma-tributaria
  Relacionamento ..... NPS /nps · Disparos de WhatsApp /disparos-whatsapp [área disparos_whatsapp]
                       · Base de Contatos /base-contatos
Receita e Repasses (receita)
  Visão geral ........ Visão geral /receita-overview
  Receita da rede .... Funil de Receita /funil-receita · Contas a Receber /contas-receber
  Repasses ........... Regras da Rede /unidades · Apuração de Royalties /unidades/royalties
                       · Funil de CAC /unidades/funil-cac · Split do Asaas /unidades/split
  Custos e comissões . Comissões /comissoes · EBIT Operacional /ebit-operacional
Planning People (people)
  Minha rotina ....... Minha vez · Meu time           (todas /gente?tela=…)
  Conversas .......... 1:1 · Sentimento e prioridades · Feedback · Elogios
  Desenvolvimento .... Avaliação · PDI
  A rede ............. Cadastro · Clima · Adoção por unidade
Monetização (monetizacao)
  Oportunidades ...... Operação diária · Temporal e previsão · Projetado × realizado
                       · Capacidade e alocação · Follow Day   (/monetizacao?aba=…)   [Fila Cella aposentada em 24/09]
  Desenv. comercial .. Funil comercial · Pessoas e PDI · Abordagens · Distribuição (/monetizacao?aba=…)
Broker (broker)
  Broker ............. Fila de oportunidades /broker · Matriz /broker/admin [área broker_matriz]
Minha Unidade (minha_unidade)
  Minha Unidade ...... Painel /painel-unidade · Base de clientes /clientes · CS /painel-cs · NPS /nps
                       · IDU /idu · Broker /broker
  Financeiro ......... Funil de Receita · Contas a Receber · Meus Royalties /meus-royalties
                       [área minha_unidade_financeiro]
Administração (admin, rodapé)
  Pessoas e acesso ... Usuários · Níveis de acesso · Equipes /equipe · Perfis · Permissões
                       · Acessos do Financeiro [área admin_financeiro]
  Sistema ............ Atividade do Sistema /atividade · Chaves de Integração · Integrações
                       · Validação de páginas
```

Fora do `areas.ts` desta branch: **Estratégia & Execução** (OKRs), criada no banco em 21/09 (DECISIONS 21/09), sem item de menu aqui.

---

## 3. Problemas no mapa atual

### 3.1 Destinos duplicados
| Destino | Aparece em | Efeito |
|---|---|---|
| `/clientes`, `/painel-cs`, `/nps`, `/idu` | Base de clientes ou Rede **e** Minha Unidade | com as duas áreas, o grifo pode acender a área errada (`areaDaRota` pega a primeira; `telas-do-brain.md` §2.7) |
| `/funil-receita`, `/contas-receber` | Receita **e** Minha Unidade › Financeiro | idem |
| `/broker` | Broker **e** Minha Unidade | idem |
| Pessoas/PDI | Growth `/pessoas` `/pdi`, `/monetizacao?aba=pessoas`, `/gente?tela=pdi` | mesmo job em três casas (`objetivos-e-modulos.md` §4.2) |
| Distribuição | Growth `/comercial/distribuicao` e `/monetizacao?aba=distribuicao` | idem |
| Contatos | visão Contatos de `/clientes` e `/base-contatos` | idem |
| Fila de ligação | `/fila-cella`, `/monetizacao` Operação, `/crm` (S2, repo do Bodra) | `CRM:54` e `FC:97` proíbem o terceiro painel |

### 3.2 Abas dentro de tela
- Lateral repete as abas da página: Monetização (10 itens na lateral, as mesmas abas desenhadas à mão em `monetizacao/dashboard.tsx`); Planning People (itens `?tela=` e `TabsList` em `gente.tsx`); Base de clientes (item único na lateral, menu próprio de 5 visões em `base-unica.tsx`).
- `Tabs defaultValue` sem URL: 17 arquivos em `src/` (sem contar a vitrine), entre eles `/rede-overview` (4 abas), `/painel-cs` (3), `/fila-cella` (4), `/contas-receber`, `/rede-realizado`, `/auditoria-interna`, `/base-contatos` (viola N7).
- Três implementações de aba: `Tabs` shadcn, `<button role=tab>` com `border-b-2`, e a lateral fazendo papel de aba.

### 3.3 Rotas fora do menu
| Rota | Situação |
|---|---|
| `/financeiro-partners`, `/pagamentos-unidades` | órfãs vivas desde a dissolução de Partners (14/09): abrem por URL, nada leva até elas |
| `/operacao`, `/simulador-caixa` | desativadas por `beforeLoad`, código mantido |
| `/aquario`, `/auditoria`, `/auditoria-faturamento`, `/dre-partners`, `/rede`, `/royalties`, `/royalties/split` | redirects silenciosos (N14); Monetização ainda mostra "Clientes → Aquário ↗" |
| `/royalties/$unidadeId/$mes` | detalhe da apuração sem trilha de volta |
| `/admin/acessos-financeiro` | inalcançável pelo menu para o papel `financeiro_admin` (DECISIONS 16/09, "achado de caminho") |
| `/inicio`, `/equipe` | entrada e tela compartilhada; `/equipe` também no rodapé |

### 3.4 Nomes inconsistentes (menu × título da página)
"Overview" × "Overview — Gestão da Rede"; "Realizado Unidades" × "Realizado por Unidade"; "Comissões" × "Apuração de Comissões"; "Usuários" × "Gerenciar usuários"; "Painel" × "Painel da Unidade"; "Operação diária" × aba "Operação"; Monetização sem título (logo "Caixa de Oportunidade"). O produto tem cinco nomes (Planning Brain, Planning, Planning Expansão, Ops Board, Planning Dashboard) e só 23 de 56 rotas definem `<title>`. Fonte: `telas-do-brain.md` §2.5–2.6.

Regra que resolve daqui em diante (N1): `PageHeader.titulo` = `title` do item em `areas.ts`; `<title>` = `"<titulo> · Planning Brain"`.

---

## 4. Estrutura ALVO — PROPOSTA para decisão do Pedro e do Eliezek

> **Isto é proposta, não decisão.** `areas.ts` e a casca são do Eliezek; as decisões de navegação da Base e da Monetização são do Pedro (`objetivos-e-modulos.md` §5). Nada abaixo deve ser implementado sem entrada no `DECISIONS.md` assinada por quem decide. Os conflitos de produto (§4.2 do relatório) ficam em `PRODUCT.md` §5 e não são resolvidos aqui.

### 4.1 Princípios da proposta
1. Toda área abre por uma **Visão geral** (arquétipo Visão geral) como primeiro item, como Receita já faz desde 22/09. Rede já tem (`/rede-overview`).
2. Uma pergunta, uma rota. Onde a lateral já lista `?aba=`/`?tela=`, a página não desenha as abas de novo; o seletor dentro da página some (resolve 3.2 sem mudar URL).
3. Nome do menu = título da página = `<title>`.
4. Minha Unidade continua reaproveitando as rotas da matriz (o recorte é da RLS), mas a casca passa a acender a área pelo `?area=` de origem ou pela preferência da pessoa, não pela primeira correspondência.

### 4.2 Nomes propostos (só onde há divergência hoje)
| Hoje (menu / título) | Proposta | Dono sugerido |
|---|---|---|
| Overview / "Overview — Gestão da Rede" | Visão geral da Rede | Eliezek |
| Realizado Unidades / "Realizado por Unidade" | Realizado por unidade | Eliezek |
| Comissões / "Apuração de Comissões" | Apuração de comissões | Eliezek |
| Usuários / "Gerenciar usuários" | Usuários | Eliezek |
| Painel / "Painel da Unidade" | Painel da unidade | Eliezek |
| Operação diária / aba "Operação" / logo | Operação diária (e `<h1>` com pergunta) | Pedro |
| Chaves de Integração + Integrações (mesmo ícone) | fundir ou diferenciar ícone (`KeyRound` × `Plug`) | Eliezek |

### 4.3 Estrutura proposta
```
Estratégia & Execução   Visão geral (Cockpit do CEO?) · OKRs          ← depende da decisão PRODUCT §5.1
Rede                    Visão geral · IDU · Indicadores do Trimestre · Realizado por unidade · LTV · Headcount
Base de clientes        Base de clientes (visões por URL) · CS · NPS · Base de Contatos* · Auditoria Interna
                        · Reforma Tributária · Disparos de WhatsApp
Receita e Repasses      (sem mudança de estrutura; aplicar nomes 4.2)
Monetização             Visão geral · Operação diária · Follow Day · Temporal e previsão
                        · Projetado × realizado · Capacidade e alocação · Funil comercial · Abordagens
                        · Distribuição* · Pessoas e PDI*
Broker, Minha Unidade, Planning People, Administração   (sem mudança de estrutura)
```
\* item marcado depende de decisão de casa única (`PRODUCT.md` §5): Contatos, Distribuição, Pessoas/PDI.

`/financeiro-partners` e `/pagamentos-unidades`: proposta de aposentar com página de explicação (N14) ou dar dono de menu. Decisão do Eliezek.

**Antes de cortar ou fundir qualquer tela:** instrumentar page view por rota e papel. Hoje `ops.acessos_log` tem 22 linhas e só registra ação administrativa (`objetivos-e-modulos.md` §4.5, item 19); cortar sem esse dado é adivinhar.
