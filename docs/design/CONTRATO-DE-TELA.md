# CONTRATO-DE-TELA.md · O que se escreve antes de construir ou alterar uma tela

O contrato é preenchido **antes** do código e revisado junto com ele. Ele é o "contrato de significado" que fez o dashboard do Conciliador sair bom (`diagnostico/conciliador.md` §1.6): o que cada número pergunta, qual data conta, quando é zero e quando é falta de dado, e para onde cada número leva.

Onde fica: no PR (colado na descrição) e, para tela nova ou refeita, em `docs/design/contratos/<rota>.md`. Campo sem resposta fica escrito "a decidir por <dono>", nunca em branco e nunca inventado.

---

## 1. Template

```markdown
# Contrato · <Nome da tela> (`/rota`)

**Dono de produto:** <pessoa>   **Dono do código:** <pessoa>   **Data:** <dd/mm/aaaa>

## Propósito
- **Pergunta que responde (vira o <h1>, N1):**
- **Público (papéis e pessoas):**
- **Decisão ou ação que provoca:**
- **Métrica de sucesso da tela:** (como saber que a tela cumpre o papel)
- **Arquétipo (ARQUETIPOS.md):** Visão geral | Fila de trabalho | Lista/Relatório | Ficha | Configuração
- **Universo medido (vira a `descricao` do PageHeader):** perímetro · período · unidade de contagem

## Números
| Número (rótulo exato) | Definição | Unidade de contagem | Fonte e régua | Frescor | Drill-down (destino) | O destino bate? |
|---|---|---|---|---|---|---|

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | | `Carregando variante=…` |
| Vazio (sem dado na fonte) | | `EstadoVazio` + motivo |
| Vazio por filtro | | `EstadoVazio total={n}` |
| Parcial / não apurado | | `KpiCard estado=…` |
| Fonte indisponível / erro | | `EstadoErro` + fonte |
| Sem acesso | | `EstadoSemAcesso oQueFalta="<chave ou área>"` |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|

## Permissões (N8)
- Área que abre a tela:
- Chaves dentro da tela (ver × editar):
- O que quem não tem a chave vê:

## Ações
| Ação | Quem pode | Confirmação | Retorno (toast / estado) |
|---|---|---|---|

## O que NÃO entra, e por quê
-

## Para onde manda (tela dona)
-

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem independente)
```

Regras do preenchimento:
- "O destino bate?" só aceita **sim**, **não, e a tela avisa** ou **não, defeito aberto**. Se o total do destino é outro, a tela diz (N2).
- Dois números com o mesmo rótulo na tabela de Números é defeito do contrato (N11).
- "O que NÃO entra" é obrigatório. Toda tela boa diz o que ela não é.

---

## 2. Exemplo · Fila Cella (`/fila-cella`)

> **Tela aposentada em 24/09/2026** (decisão do Pedro; `/fila-cella` hoje só avisa e manda para o Follow Day). O exemplo fica porque mostra bem como preencher um contrato de Fila. Para uma Fila em uso, veja `contratos/monetizacao-follow-day.md`.

Preenchido a partir de `src/routes/_authenticated/fila-cella.tsx`, `src/components/fila-cella/*`, DECISIONS 25/08 e `diagnostico/objetivos-e-modulos.md` (sigla `FC` = `PM Work/projeto-unificado/spec-tela-fila-cella.md`). Estado em `eea3d90`.

**Dono de produto:** Pedro Luca (Monetização). **Operação:** Matheus (escreve), daily das 13h30 (lê). **Código:** Pedro Luca / Eliezek aplica migration.

**Propósito**
- **Pergunta:** "Quem eu abordo agora na base instalada, e onde parei?" *(proposta; hoje o título é só "Fila Cella")*
- **Público:** Matheus (vendedor exclusivo do Cella); gestão comercial na daily.
- **Ação:** abrir a primeira linha desbloqueada e registrar o toque, com próximo passo e data (`FC:1385-1442`).
- **Métrica de sucesso:** KR1 ≥ 40 abordagens; KR2 ≥ 10% de reunião; KR3 ≥ 5 propostas; 100% de perda com motivo (`FC:44-49`).
- **Arquétipo:** Fila de trabalho.
- **Universo:** contas da base instalada (Growth `deals` ganhos, `org_id` distinto) · mês corrente para os KRs · unidade de contagem: conta.

**Números**
| Número | Definição | Unidade | Fonte e régua | Frescor | Drill-down | Bate? |
|---|---|---|---|---|---|---|
| Contas na fila | linhas de `v_fila_cella` | conta (`org_id`) | Growth `deals` won + ECD 2024 + base Receita + Ops | `sincronizadoEm` | a própria tabela | sim |
| KR1 · abordagens | contas abordadas no mês / meta (padrão 40) | conta | toques registrados | idem | filtro "abordadas" na tabela | a decidir por Pedro: não existe hoje |
| KR2 · conversão | taxa de resposta · nº de reuniões, **no mesmo cartão do KR1** | % e reunião | toques | idem | idem | a decidir |
| KR3 · propostas | contas em "6 Proposta enviada" ou além / meta (padrão 5) | conta | estágio da conta | idem | filtro por estágio | a decidir |
| Qualidade | fração das contas tocadas sem pendência de higiene | % | playbook §5.6 | idem | faixa de higiene | sim |
| Higiene (4 contadores) | sem próximo passo · parados 15d · passo vencido · perdido sem motivo | conta | fila | idem | filtra a tabela | sim |
| Cobertura ECD | contas por estado de ECD (com sinal, sem sinal, sem ECD, sem CNPJ) | conta | ECD 2024 | idem | filtra por `ecd` | sim |

**Inconsistência a resolver:** o relatório de objetivos cita "KR1 ≥ 40 abordagens/semana"; o código mostra "contas abordadas no mês" com meta 40. Dono: Pedro.

**Estados** — o código já separa quatro (`FilaTab`), e todo indicador não apurável mostra `—`, nunca `0`:
| Estado | Quando | Mostra hoje | Alvo v2 |
|---|---|---|---|
| Carregando | query em curso | "Carregando a fila…" em card | `Carregando variante="tabela"` |
| `nao_migrado` | migrations não aplicadas | aviso + quem aplica | `EstadoVazio` com motivo |
| `nunca_sincronizado` | sync nunca rodou | aviso | `EstadoVazio` com motivo |
| Erro | falha ao ler `v_fila_cella` | card vermelho cru | `EstadoErro` com a fonte |
| Vazio por filtro | nenhum resultado | "Nenhuma conta com esses filtros. N no total." | `EstadoVazio total` (já é o padrão) |
| Sem acesso | sem `view.fila_cella` | texto com a chave | `EstadoSemAcesso oQueFalta="view.fila_cella"` |

**Filtros na URL** — hoje **nenhum** está na URL (`useState`), nem a aba. Alvo:
| Parâmetro | Valores | Padrão |
|---|---|---|
| `aba` | fila, novos, log, dicionario | fila |
| `busca`, `curva`, `segmento`, `ecd`, `forca`, `frente`, `estagio`, `relacionamento` | valores da fila | todos |
| `higiene` | sem_proximo_passo, parados_15d, passo_vencido, perdido_sem_motivo | nenhum |
| `descartados` | ocultar, mostrar | ocultar |

**Permissões:** `view.fila_cella` (ver); `manage.fila_cella` (ações de escrita na ficha: sem ela os botões ficam desabilitados com o motivo "Você não tem manage.fila_cella.", o que já cumpre N8); `manage.fila_cella_override` (encerrar ciclo antes do prazo, só com fato novo); `manage.fila_cella_sync` (hoje só muda o texto do estado `nao_migrado`).

**Ações:** Registrar toque (dialog), Encerrar ciclo (dialog), Resolver CNPJ (dialog), Exportar XLSX (desabilitado fora do estado `ok`).

**O que NÃO entra:** o Funil A ("os 50 contratos" do CEO) e a cadeia contratos → Tiago → análise. "Se o CEO abrir /fila-cella e achar que está vendo os 50 contratos, a tela mentiu" (`FC:69,1399`). Também não entra previsão de receita: meta não vira previsão (N13).

**Para onde manda:** ficha da conta em `Sheet` (`ContaDetalheSheet`); negócio no Pipedrive quando houver. **Conflito aberto:** a mesma fila de ligação existe em `/monetizacao` (Operação) e em `/crm` (S2); ver `PRODUCT.md` §5.

---

## 3. Exemplo · Overview da Rede (`/rede-overview`)

Preenchido a partir de `src/routes/_authenticated/rede-overview.tsx`, DECISIONS 11/08 ("Rede Overview reorganizado em abas") e 22/09 (Histórico de Royalties).

**Dono de produto:** a confirmar (casca e Rede são do Eliezek, `objetivos-e-modulos.md` §5). **Código:** Eliezek.

**Propósito**
- **Pergunta:** "Quais unidades estão fora da curva em receita, clientes e retenção?" *(proposta; hoje "Overview — Gestão da Rede")*
- **Público:** diretoria, CS; sócio regional vê só a própria unidade (`scopedToOwnUnit`).
- **Ação:** identificar a unidade ou métrica fora da curva e abrir o detalhe ("resumo aqui + Ver detalhe").
- **Métrica de sucesso:** a decidir pelo dono (o relatório só aponta NPS/ICS e ranking).
- **Arquétipo:** Visão geral.
- **Universo:** rede inteira ou unidade escolhida · período padrão = ano corrente (01/01–31/12) · unidades de contagem mistas (ver tabela).

**Números (aba Visão Geral)**
| Número | Definição | Unidade | Fonte e régua | Drill-down | Bate? |
|---|---|---|---|---|---|
| Receita Total | recebido no período × período anterior de mesma duração | R$, caixa | recebimentos por mês | nenhum | — |
| Booking Total | MRR novo × 12 no período | R$ | `contratos.ganho_em` | nenhum | — |
| Qtd Proj. Ativos | **mesmo valor** de Clientes ativos | empresa | idem abaixo | `/clientes` sem filtro | **não, defeito aberto** |
| Receita Média Cliente | MRR ÷ clientes ativos | R$ | contratos | nenhum | — |
| Qtd Clientes ativos | empresas cadastradas menos as com churn em `central_tratativas`; "de N cadastrados" | empresa | `empresas` + `central_tratativas` | `/clientes` sem filtro de status | **não, defeito aberto** |
| Lifetime (LTV) | ARPA ÷ churn mensal do período | R$ | contratos + tratativas | nenhum | — |

Defeitos que o contrato expõe:
1. Dois cards com o mesmo número e rótulos diferentes (viola N11).
2. Os dois abrem `/clientes` com `status: ""`, que mostra todos os cadastrados, não os ativos (viola N2). O terceiro atalho ("Ver contratos ativos", aba Vendas) usa `status: "ATIVO"`, que é outra régua: "ATIVO = pagou nos últimos 90 dias" contra "não deu churn" (`D:2158-2160`).
3. Nenhum card tem meta (N13) nem procedência (N3).
4. MRR e Clientes ativos são "estado atual" e não obedecem ao filtro de período, mas o filtro está no topo de todos (DECISIONS 11/08). A `descricao` precisa dizer isso.

**Estados:** carregando = card "Carregando dados…"; erro = card vermelho com a mensagem; `—` quando não há base de comparação. Falta: vazio, parcial e sem acesso por bloco (alvo: `KpiCard estado`, `EstadoSemAcesso`).

**Filtros na URL:** hoje nenhum (unidade em `Select`, datas em `<input type="date">`, aba em `Tabs defaultValue`). Alvo: `unidade`, `de`, `ate`, e as quatro abas viram seções ou páginas (N6, a decidir pelo dono).

**Permissões:** área `rede`; sócio regional recortado pela própria unidade (RLS + `scopedToOwnUnit`).

**O que NÃO entra:** a tabela de apuração cliente a cliente (fica em `/unidades/royalties`); NPS da Rede e NRR (removidos a pedido, DECISIONS 11/08).

**Para onde manda:** `/clientes`, `/unidades/royalties`, `/painel-cs`, `/auditoria-interna` ("Ver detalhe").

---

## 4. Exemplo · Apuração de Royalties (`/unidades/royalties` → `/royalties/$unidadeId/$mes`)

Preenchido a partir de `unidades.royalties.tsx`, `components/royalties/apuracao-royalties-content.tsx`, `royalties.$unidadeId.$mes.tsx` e DECISIONS 10/07, 20/07, 14/09 e 22/09.

**Dono de produto:** Eliezek (Receita e Repasses, `objetivos-e-modulos.md` §5). **Operação:** controladoria/matriz.

**Propósito**
- **Pergunta (lista):** "Qual unidade ainda não fechou, faturou ou pagou o repasse deste mês?" *(proposta)*
- **Pergunta (ficha):** "A apuração desta unidade neste mês está pronta para fechar e faturar?" *(proposta)*
- **Público:** controladoria e matriz.
- **Ação:** apurar → confirmar itens → fechar → emitir faturas no Omie → gerar demonstrativo.
- **Métrica de sucesso:** unidades com apuração fechada e faturada no mês; zero fatura esquecida (em ago/26 foram 4, R$ 96.377, DECISIONS 22/09).
- **Arquétipo:** Lista/Relatório (o mês, todas as unidades) → Ficha (uma unidade, um mês).
- **Universo:** 11 unidades · competência mensal, abre no mês fechado por padrão (DECISIONS 10/07) · régua de **caixa**: royalties sobre valor líquido recebido (DECISIONS 20/07).

**Números (lista do mês)**
| Número | Definição | Unidade | Fonte | Drill-down | Bate? |
|---|---|---|---|---|---|
| Royalties, CSC, CAC, Mídia, Outras (por unidade) | campos da apuração | R$ | `royalties_apuracao` (pai) | ficha da unidade no mês | sim: a soma dos itens bate com o pai (conferido ago e jun/26, DECISIONS 22/09) |
| Total fatura | soma das colunas | R$ | idem | idem | sim |
| Status da apuração | Rascunho · Em revisão · Confirmado · Faturado | — | `royalties_apuracao.status` | idem | — |
| Fatura no Omie | criada / emitida à mão / OS sem boleto / erro | — | integração Omie | ficha | — |

**Números (ficha)**: Confirmados `N / M` itens ativos; base apurada; royalties; pendentes × confirmados como filtro da tabela de itens; situação de cada item (Matched, Só Omie, Só no Pipedrive).

**Estados:** "Carregando…" solto em três pontos da ficha (alvo: `Carregando variante="pagina"`); sem `view.unidades_rede` → `GuardaUnidades` diz qual permissão falta (já cumpre N8); mês em andamento não oferece "Emitir faturas". Falta: estado de erro padronizado e vazio de unidade sem apuração gerada.

**Filtros na URL:** mês navegável por setas (lista e ficha); na ficha, filtros de situação e de conferência ficam em `useState`. Alvo: `mes` e `situacao` na URL.

**Permissões:** área `receita`, chave `view.unidades_rede`. Fechar, reabrir, editar CNPJ e marcar churn têm checagem própria no código (não levantada neste contrato: a decidir por Eliezek ao revisar); o v2 não muda nenhuma.

**Ações:** Fechar apuração, Reabrir apuração (hoje `confirm()` nativo; alvo `AlertDialog`), Forçar atualização, Emitir faturas no Omie (com prévia do que vai e do que não vai), Gerar demonstrativo PDF e Excel.

**O que NÃO entra:** a série histórica cliente × mês (tela Histórico removida em 22/09; a série vive no gráfico do Overview da Rede); a receita da rede por competência (é do Funil de Receita, outra régua). Cabeçalho fixo da tabela: revertido em 10/07 e refeito em `de6810c`; manter como está.

**Para onde manda:** `/receita-overview` resume e aponta para cá; daqui, a ficha. Falta a trilha de volta da ficha para a lista com o mesmo mês (arquétipo Ficha).
