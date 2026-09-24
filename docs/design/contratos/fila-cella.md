# Contrato · Fila Cella (`/fila-cella`)

**Dono de produto:** Pedro Luca (Monetização)   **Operação:** Matheus (escreve), daily das 13h30 (lê)   **Dono do código:** Pedro Luca · Eliezek (migration, merge)   **Data:** 23/09/2026
Estado: **tela aposentada pelo Pedro em 24/09/2026** ("ela tá obsoleta"). A rota `/fila-cella` passou a explicar a saída e mandar para o Follow Day (N14); o item saiu do menu e o código da tela saiu do repositório. Tabelas `ops.fila_cella_*`, `ops.v_fila_cella`, migrations e chaves `*.fila_cella` ficam no banco. O contrato abaixo fica como registro do que a tela era.

Base: exemplo do `CONTRATO-DE-TELA.md` §2, código em `b5c44d7` (`src/routes/_authenticated/fila-cella.tsx`, `src/components/fila-cella/*`, `src/lib/fila-cella.functions.ts`), DECISIONS 25/08 (duas entradas) e medição no banco em 23/09.

**Medição de 23/09 (Management API, só leitura, projeto `npknehhyyzelmrbbxvtu`):** `ops.v_fila_cella` existe e tem **0 linhas** (fila e novos do mês); `fila_cella_toques` e `fila_cella_ciclos` têm **0 linhas, desde sempre**. Em produção a tela abre em "A fila ainda não foi sincronizada". O job de sync (Growth `deals` → `fila_cella_contas`) nunca rodou. Consequência para a migração: a captura da tela real só mostra o estado degradado; a tela cheia só aparece com dado sintético (ver "Captura").

**Regras de cálculo, consultas, RLS e permissões não mudam.** Marcação: **[apresentação]**, **[lógica · aprovar]**, **[fluxo · aprovar]**, como na moldura de `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "Quem eu abordo agora na base instalada, e onde parei?"
- **Público:** Matheus (vendedor exclusivo do Cella); gestão comercial na daily.
- **Ação que provoca:** abrir a primeira linha desbloqueada e registrar o toque, com próximo passo e data (`FC:1385-1442`).
- **Métrica de sucesso:** KR1 ≥ 40 abordagens; KR2 ≥ 10% de reunião; KR3 ≥ 5 propostas; 100% de perda com motivo (`FC:44-49`).
- **Arquétipo:** **Fila de trabalho**, com a ficha da conta em `Sheet` (Ficha resumida).
- **Universo (`descricao`):** "{n} contas da base instalada acima do piso de R$ 25 mi · vendedor exclusivo: Matheus · KRs do mês corrente · contagem por conta". O texto atual sobre o Funil B continua, em segunda frase ("Esta tela cobre o Funil B; a cadeia contratos → Tiago → análise não está aqui.").

## Números
| Número (rótulo) | Definição | Unidade | Fonte e régua | Frescor | Drill-down | Bate? |
|---|---|---|---|---|---|---|
| Contas na fila | linhas de `v_fila_cella` com `lista='fila'` | conta | Growth `deals` won (org distinta) + ECD 2024 + base Receita + Ops | `sincronizadoEm` | a própria tabela | sim |
| KR1 · abordagens + KR2 · conversão | contas com toque no mês / meta 40; na nota do **mesmo cartão**: taxa de resposta (toques "Respondeu" ou "Reunião agendada" ÷ toques do mês) e nº de reuniões | conta; %; reunião | `fila_cella_toques` do mês | idem | **[apresentação]** filtro "abordadas no mês" na tabela (`abordadas=mes`) | sim |
| KR3 · propostas | contas em "6 Proposta enviada", "7 Em negociação" ou "8 Fechado" / meta 5 | conta | estágio da conta | idem | filtro por esses estágios | sim |
| Qualidade | 1 − (contas tocadas com alguma pendência de higiene ÷ contas tocadas) | % | playbook §5.6; definição provisória no código | idem | faixa de higiene | sim |
| Higiene (4 contadores) | sem próximo passo · parados > 15 dias · perdido sem motivo · próximo passo vencido | conta | fila | idem | filtra a tabela | sim |
| Cobertura ECD | sem CNPJ · com ECD (com sinal / sem plano de contas / sem sinal) · sem regime | conta | ECD 2024 | idem | filtra por `ecd` | sim |
| Novos do mês (aba) | contratos novos do mês, lista distinta da fila | conta | `v_fila_cella lista='novos_do_mes'` | idem | a própria tabela | sim |

**[lógica · aprovar] K1 · KR1 é do mês ou da semana?** O relatório de objetivos e a spec citam "≥ 40 abordagens/semana" (`FC:44`); o código conta "contas abordadas no mês" com meta 40. Decisão do Pedro: (a) manter mês e corrigir a spec; (b) passar para semana (muda `kpisDaily`, que é cálculo).

**[apresentação]** Faixa de ritmo com 3 `KpiCard` (já é `KpiCard`): passam a ter `procedencia` ("fila_cella_toques · sincronizado {hora}") e `abrir` (KR1 e KR3). Qualidade fica sem `abrir` (a faixa de higiene logo abaixo é o drill-down).

## A fila (N5)
- Ordem padrão: a da view (as 5 chaves do `build_planilha.py`, veto "Alerta aberto" na frente), já em ordem de trabalho (DECISIONS 25/08, item 4). Score é coluna e ordenação clicável; ordenar por ele mostra o aviso de não comparabilidade (já existe).
- 15 colunas, na ordem "vale a pena? posso? o que eu digo? onde parei?". A última é **Próximo passo com data**; sem passo mostra `StatusBadge tom="atencao"` "sem próximo passo".
- **[fluxo · aprovar] F6 · ação na linha.** Hoje a linha inteira abre o `Sheet` e o botão "Registrar toque" está no meio dele, na seção Cadência (quarta seção, depois de Identidade, Sinal da ECD e Camada operada). Proposta:
  1. coluna final com um botão por linha: "Registrar toque" quando há ciclo aberto e o toque não está bloqueado, "Abrir ciclo" quando não há ciclo, desabilitado com o motivo quando bloqueado (sem `manage.fila_cella`, ciclo com 4 toques, reentrada bloqueada até {data});
  2. no `Sheet`, a ação do ciclo sobe para o topo, logo abaixo do nome e dos bloqueios, e a Cadência vem antes da Identidade. A ordem de leitura vira: bloqueios → o que fazer agora → onde parei (toques) → quem é → evidência.
  O `Dialog` de registrar toque e as regras de bloqueio não mudam.
- Linha vetada (`FORA`) continua com opacidade reduzida, mas o selo sai de texto vermelho solto para `StatusBadge tom="perigo"` "Fora" (V7).
- Coluna "⚑" (bloqueios) ganha rótulo acessível "Bloqueios"; o cabeçalho não é só um emoji (V15).

## Ficha da conta (`Sheet`)
- `SheetHeader` com nome, CNPJ e `StatusBadge` do estágio.
- **[apresentação] Faixa de resumo com `KpiCard` compacto** (variante nova `densidade="compacta"` no `KpiCard`, que falta no design system: rótulo 12px, valor 20px, sem hover, para caber em 640px): Score (nota "comparável"/"teto 5"), MRR, Receita operacional ECD (`nao-apurado` quando nula, com o texto atual "não é o mesmo que receita zero"), Ciclo · toques.
- O resto são `Secao` com pergunta curta: "O que eu faço agora?" (cadência), "Onde parei?" (toques do ciclo), "Quem é?" (identidade), "Qual é o sinal?" (ECD), "O que a operação registrou?" (camada operada), "Posso falar?" (checklist §6.1).
- Checklist: ✓/○ em texto viram `StatusBadge` (`sucesso`/`atencao`) com ícone (V7).
- "Gerar handoff ao Cella" continua desabilitado com o motivo (fora da v1, fase F4).

## Estados
| Estado | Quando | Hoje | Alvo v2 |
|---|---|---|---|
| Carregando | query em curso | "Carregando a fila…" em card | `Carregando variante="tabela"` |
| `nao_migrado` | view ausente | aviso + quem aplica | `EstadoVazio` com o motivo e quem aplica |
| `nunca_sincronizado` | view vazia (**é o estado de produção em 23/09**) | aviso | `EstadoVazio` "A fila ainda não foi sincronizada" + o que falta (job de sync, fase F1); KPIs em `indisponivel` (já é assim) |
| Erro | falha ao ler `v_fila_cella` | card vermelho com a mensagem | `EstadoErro` com a fonte |
| Vazio por filtro | nenhum resultado | "Nenhuma conta com esses filtros. N no total." | `EstadoVazio total={n}` com "Limpar filtros" |
| Sem acesso | sem `view.fila_cella` | texto com a chave | `EstadoSemAcesso oQueFalta="view.fila_cella"` |

`Procedencia` no rodapé, visível em todos os estados (já é assim; passa a ser o componente `Procedencia`). O aviso de degradação vai nela, não num selo (N9).

## Filtros e aba na URL (N7)
Hoje nenhum está na URL (`useState`), nem a aba. **[apresentação]**
| Parâmetro | Valores | Padrão |
|---|---|---|
| `aba` | `fila`, `novos`, `log`, `dicionario` | `fila` |
| `busca`, `curva`, `segmento`, `ecd`, `forca`, `frente`, `estagio`, `relacionamento` | valores da fila | todos |
| `higiene` | `sem_proximo_passo`, `parados_15d`, `passo_vencido`, `perdido_sem_motivo` | nenhum |
| `abordadas` | `mes` | nenhum |
| `descartados` | `ocultar`, `mostrar` | `ocultar` |
| `conta` | id da conta (abre o `Sheet`; também escolhe a conta no Log) | nenhuma |
| `ordem` | `coluna:asc|desc` | ordem da view |

As quatro abas continuam abas (são quatro perguntas da mesma fila e a lateral tem um item só). **Alternativa, para decidir com o Eliezek depois:** Log e Dicionário viram itens da lateral (N6), o que mexe em `areas.ts`.

## Permissões (N8) — não mudam
`view.fila_cella` (ver); `manage.fila_cella` (escrita na ficha; sem ela os controles ficam desabilitados com o motivo, o que já cumpre N8); `manage.de_para_cnpj` (resolver CNPJ); `manage.fila_cella_override` (furar a reentrada com fato novo); `manage.fila_cella_sync` (só muda o texto do `nao_migrado`).

## Ações
| Ação | Quem | Confirmação | Retorno |
|---|---|---|---|
| **Registrar toque** (`default`, a ação principal) | `manage.fila_cella`, ciclo aberto, < 4 toques | `Dialog` (existente) | toast; a linha atualiza |
| Abrir ciclo {n} | `manage.fila_cella`, fora da reentrada | frente + motivo obrigatórios | toast |
| Encerrar ciclo | `manage.fila_cella` | `Dialog` com motivo (existente) | toast |
| Resolver CNPJ | `manage.de_para_cnpj` | `Dialog` (existente) | toast |
| Exportar XLSX | quem vê, estado `ok` | — | download |

## O que NÃO entra
- O Funil A ("os 50 contratos" do CEO) e a cadeia contratos → Tiago → análise: "se o CEO abrir /fila-cella e achar que está vendo os 50 contratos, a tela mentiu" (`FC:69,1399`).
- Previsão de receita: meta não vira previsão (N13).
- Negócios do Pipedrive (Operação diária e Follow Day). O handoff ao Cella (fase F4).

## Para onde manda
Ficha da conta no `Sheet`. Negócio no Pipedrive, quando existir. Evidência contábil: a ECD fica no próprio `Sheet`.

## Conflito aberto (PRODUCT §5.2) — decisão do Pedro
A mesma pergunta "com quem eu falo hoje" tem três casas: esta (por conta, só Cella), `/monetizacao` Operação/Follow Day (por negócio, todos os produtos) e `/crm` (S2, Bodra). As specs proíbem o terceiro painel. Proposta desta migração: migrar as duas que existem sem fundir e sem criar a terceira.

## Captura
A tela real só tem o estado `nunca_sincronizado`. Proposta: capturar a tela real (estado degradado, escuro e claro) **e** o arquétipo Fila da vitrine com a Fila Cella em dado sintético, marcado "dado sintético" na legenda. Nenhum dado de teste é gravado no banco.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [ ] Números conferidos na fonte (recontagem pela Management API quando a fila tiver linhas)
