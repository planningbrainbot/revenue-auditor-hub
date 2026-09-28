# Medições · reestudo das telas de Monetização (28/09/2026)

Tudo aqui foi medido só por leitura. No banco, a Management API do Supabase no projeto do Brain unificado (`npknehhyyzelmrbbxvtu`; o `project_id` do `supabase/config.toml` é outro, o `ulgiochewwpmmssksqlw`, e ele não tem as tabelas `monetizacao_*`), com `"read_only": true`. No Pipedrive, só GET com o token da API Ops Planning. Horário de São Paulo, salvo quando diz UTC. Nenhum dado individual além de ids e dos nomes já citados em DECISIONS fica neste arquivo.

Para remedir tudo e regenerar o mockup: `mockup/gerar_mockup.py` (lê os tokens do ambiente e grava o HTML fora do repositório).

---

## 1. Frescor por tabela e automação

```sql
select status, measured_at, catalog_at, count, error from ops.monetizacao_sync;
select count(*), max(updated_at), string_agg(distinct payload->>'metric_version', ',') from ops.monetizacao_deals;
select id, imported_at from ops.monetizacao_forecasts;
select month, owner_id, updated_at, payload from ops.monetizacao_planos;
select kind, count(*), min(updated_at), max(updated_at) from ops.monetizacao_registros group by kind;
select jobname, schedule, active from cron.job where command ilike '%monetiz%';
select j.jobname, count(*), max(d.start_time), sum((d.status='succeeded')::int)
  from cron.job_run_details d join cron.job j using (jobid)
  where j.command ilike '%monetiz%' and d.start_time > now() - interval '7 days' group by 1;
```

| Objeto | Resultado em 28/09 |
|---|---|
| `monetizacao_sync` | `ok`, `measured_at` 18:20:07 UTC (15h20), 194 negócios, sem erro |
| `monetizacao_deals` | 194 linhas, última escrita 15h20, `metric_version` 5 em todas |
| `cron` `monetizacao-crm-5min` (`*/5`, ativo) | 2.010 execuções em 7 dias, 2.010 com sucesso, última 15h20 |
| `cron` `monetizacao-cobertura-10min` (`*/10`, ativo) | 989 execuções em 7 dias, todas com sucesso |
| `monetizacao_forecasts` | 1 linha: `v10-2026-09-09`, importada em 15/09 às 12h30. `source_name` `v10-2026-09-09-aquarios.xlsx`; nota "Plano de referência anterior à revisão dos gates…" |
| `monetizacao_planos` | 1 linha: `2026-09`, dono 28381245 (Matheus), salva em 15/09 às 11h53. `capacity` 120, `daily_target` 7, `target_contracts` 8, `meetings_capacity` 60, `allocation` 0/0/0, `rates` nulas |
| `monetizacao_registros` | só `roteiro`: 4 linhas, criadas pelo Matheus em 23/09 das 11h29 às 11h44 (1 arquivada, 1 rascunho, Finance aprovada, Cella aprovada). **0 `pdi`, 0 `distribuicao`, 0 `followup`** |
| `monetizacao_contas` / `monetizacao_detalhes` | 10.314 linhas cada, atualizadas às 15h20 |
| `monetizacao_listas` / `envios` / `audit` | 14 / 69 / 129 linhas, última escrita 28/09 às 14h48 (Base, fora das nove abas) |
| `fila_cella_*` | 0 linhas |
| `ops.acessos_log` | 77 linhas, só ação administrativa (`adicionar_na_area` e parecidas); nenhuma página vista |

O `cron.schedule` da carga não está em migration: nasce em `scripts/monetizacao/bootstrap.py:98-116`. O da cobertura aparece só num comentário de `20260921190000_cobertura_materializada.sql:68-69`.

## 2. Funil e ciclo

### 2.1 O que cada negócio guarda (`payload`, carga v5)

Chaves presentes nos 194: `events` (`loaded`, `started`, `scheduled`, `meeting`, `validated`, `signed`, cada um com `at`, `date`, `actor_id`, `source`), `moves[]` (`stage_id`, `at`, `date`, `actor_id`), `stage_id`, `status`, `created_at`, `started_at`, `validated_at`, `won_on`, `lost_on`, `lost_reason`, `expected_close`, `expected_revenue`, `revenue`, `next_activity`, `last_activity_date`, `owner_id`, `creator_id`, `route`, `history_known` (todos `true`) e `metric_version`.

Etapas do pipe 39, em `monetizacao_sync.stages` (abertos hoje entre parênteses): 274 Base elegível (8) · 276 Abordagem em curso (53) · 275 Gatilho identificado (11) · 277 Reunião agendada (4) · 287 Reunião realizada (0) · 279 Em negociação (8) · 278 Proposta enviada (13) · 288 Stand by (8).

Negócios por produto (campo) e situação: Cella 43 abertos, 18 perdidos e 3 ganhos; Consultoria 14 abertos e 15 perdidos; Finance 48 abertos e 43 perdidos; Sem produto 9 perdidos e 1 ganho (TECH MED). **189 dos 194 foram criados em setembro**, 4 em agosto (27 e 31/08, todos sem produto e perdidos) e 1 em março (TECH MED).

### 2.2 Produto: campo × título (Pipedrive, `GET /v1/deals/{id}` nos 194)

| Situação | Negócios |
|---|---|
| Título e campo concordam | 127 (87 Finance, 14 Cella, 26 Consultoria) |
| Produto só no campo (título sem produto) | 52 (50 Cella, 2 Finance) |
| Sem produto no campo nem no título | 10 |
| Nome da empresa contém "Consultoria", mas o sufixo confere com o campo | 2 (95179, 95183) |
| **Divergem** | **3**: 96070 (título CELLA, campo Consultoria, aberto), 96094 (FINANCE × Consultoria, perdido), 96110 (FINANCE × Consultoria, perdido) |

Os 3 divergentes estão em `ops.monetizacao_envios` com `product = 'consultoria'`, enviados em 15/09 às 13h21. No `/v1/deals/{id}/flow`, nenhum registra mudança do campo `0646513e…` nem do título depois do `add_time`.

### 2.3 Tempo por etapa: `moves` × Pipedrive

Para cada negócio, o tempo na etapa é a diferença entre a entrada nela e a entrada seguinte. Na última etapa, o fim é o `won_time` ou `lost_time` do Pipedrive, ou 28/09 às 15h20 se o negócio está aberto. O resultado foi comparado com `stay_in_pipeline_stages.times_in_stages`, que vem só no detalhe (`GET /v1/deals/{id}`); a listagem `v1/deals` não traz esse campo.

- 620 pares (negócio, etapa do pipe 39). A diferença média é de 0,33 dia. **614 ficam abaixo de 1 dia.**
- As 6 restantes vêm de 3 negócios:
  - **95211**: `/flow` com `274→275` e `275→276` às 12:02:06 de 14/09. A carga (`crm.mjs`, `sort` por `log_time`) manteve a ordem da API, do mais novo para o mais antigo. O resultado foi `moves` = 275 (criação, errado), 276, 275 (fim, errado; a etapa real é 276). Com a etapa inicial em 275, o `started` foi marcado em 11/09, e não em 14/09.
  - **95196**: o mesmo caso.
  - **78988** (TECH MED): ganho em 07/04 noutro pipe e movido para o 39 depois. Fica fora da coorte.

### 2.4 Negócio que saiu do pipe 39

```sql
select count(*) enviados, count(*) filter (where d.id is null) fora_da_carga
from ops.monetizacao_envios e left join ops.monetizacao_deals d on d.id = e.deal_id
where e.status = 'sent' and e.deal_id is not null;
```

Resultado: 66 enviados e 0 fora da carga. Nenhum caso conhecido. Rode esta consulta de novo se um negócio "sumir".

### 2.5 Perdas

Etapa em que o negócio foi perdido (`stage_id` quando `status = 'lost'`):

| Produto | Base elegível | Abordagem | Gatilho | Reunião agendada | Reunião realizada | Proposta |
|---|---|---|---|---|---|---|
| Cella (18) | — | 13 | 2 | — | — | 3 |
| Consultoria (15) | 7 | 3 | 5 | — | — | — |
| Finance (43) | 28 | 9 | 3 | 2 | 1 | — |
| Sem produto (9) | 9 | — | — | — | — | — |

Motivo (`lost_reason`): 85 perdas e 25 textos distintos. Os 5 motivos da lista do Pipedrive cobrem 64: "Cliente fora de perfil" 31, "Sem interesse no momento" 25, "Tentativa de contato esgotadas" 6, "Fechou com um concorrente" 1 e "Falta de budget" 1. Agrupados pela regra da spec §6.5:

| Grupo | Cella | Consultoria | Finance | Sem produto | Total |
|---|---|---|---|---|---|
| Fora de perfil | 2 | 5 | 28 | 1 | 36 |
| Sem interesse | 11 | 6 | 8 | 1 | 26 |
| Contato esgotado | 4 | — | 2 | — | 6 |
| Concorrente ou parceiro | 1 | — | — | 1 | 2 |
| Sem orçamento | — | — | 1 | — | 1 |
| Remanejado ou duplicado | — | 4 | 4 | 6 | 14 |

### 2.6 Funil de marcos (coorte criada de 30/06 a 28/09, 193 negócios; "chegou" = tem o marco ou um posterior)

| Marco | Geral | Cella | Consultoria | Finance |
|---|---|---|---|---|
| Criado | 193 | 64 | 29 | 91 |
| Trabalhado | 142 | 60 | 19 | 63 |
| Reunião agendada | 46 | 28 | 0 | 18 |
| Reunião realizada | 38 | 25 | 0 | 13 |
| Oportunidade validada | 36 | 25 | 0 | 11 |
| Ganho | 3 | 3 | 0 | 0 |

Os eventos pulados, contados na coorte inteira: 7 validadas sem reunião registrada, 4 reuniões realizadas sem agendamento e 4 validadas sem agendamento. Por isso a linha "Reunião realizada" do funil de marcos (Finance 13) é maior que o evento de reunião do mês na Operação (Finance 9). As duas réguas são diferentes (spec §4.4).

### 2.7 Tempo entre marcos (dias corridos; mediana · p75 · n)

| Intervalo | Geral | Cella | Finance |
|---|---|---|---|
| Criação → trabalhado | 5 · 8 · 142 | 3 · 8 · 60 | 5 · 6,5 · 63 |
| Trabalhado → agendada | 0 · 4 · 42 | 0 · 1 · 24 | 1,5 · 5,5 · 18 |
| Agendada → realizada | 2,5 · 6 · 26 | 6 · 7 · 18 | 1 · 2 · 8 |
| Realizada → validada | 0 · 1,2 · 28 | 0 · 1 · 21 | 0 · 1 · 7 |
| Validada → ganho | 15 · 18 · 3 | 15 · 18 · 3 | — |
| Criação → reunião realizada | 8 · 11 · 31 | 8 · 12,2 · 22 | 7 · 11 · 9 |
| Criação → ganho | 21 · 22,5 · 3 | 21 · 22,5 · 3 | — |

Consultoria: criação → trabalhado 6 · 8 · 19; nenhum marco depois.

Incidência acumulada, com perda como risco concorrente e a linha interrompida quando restam menos de 5 em observação:

| Produto | Reunião em 7 d | 14 d | Último dia com ≥5 | Validada no último dia | Ganho no último dia |
|---|---|---|---|---|---|
| Cella | 17% | 34% | 46% em 27 d | 47% | 6% |
| Finance | 6% | 15% | 15% em 17 d | 13% | 0% |
| Consultoria | 0% | — | 0% em 13 d | 0% | 0% |

## 3. Follow Day e Temporal

| Medida | Resultado |
|---|---|
| Abertos hoje | 105 |
| … sem próxima atividade (`next_activity` nulo) | 92 (88%) |
| … com atividade futura | 13 |
| … com atividade vencida | **0** |
| … sem movimento há 7+ dias (a régua do Follow Day, que conta criação, última atividade e eventos) | 46 |
| … há 7+ dias na etapa atual (a régua do envelhecimento) | 57: Finance em Abordagem 21, Cella em Proposta enviada 11, Cella em Abordagem 10, Cella em Stand by 4, Consultoria em Gatilho 4, outros 7 |
| Atividades do Matheus em setembro (`GET /v1/activities?user_id=28381245`) | 75, todas ligadas a negócio: 68 ligações concluídas, 7 abertas |
| Validadas em aberto | 30 (Cella 19, Finance 11) |
| … com `expected_close` | **0** |
| … com `expected_revenue` | **0** |

## 4. Mapa do código (base `4302f48`)

| Aba | Componente | Cálculo | Grava |
|---|---|---|---|
| Operação | `dashboard.tsx:440-476` + `operacao.tsx` | `model.ts` `operacao()` `:239-287`, `metasOperacao()` `:549-605`, `funil()` `:434-506` | — |
| Projetado × realizado | `forecast.tsx:86-423`, `forecast-model.tsx:44-240` | `forecast.ts` `forecastComparison()` `:4-47` (linhas fixas da planilha em `:27-35`) | — |
| Temporal | `analysis.tsx:178-462` | `model.ts` `temporal()` `:295-323`, `receitaSomada()` `:324-348` | — |
| Capacidade | `analysis.tsx:513-937` | `model.ts` `capacidade()` `:349-381` | `monetizacao_save_plan` → `monetizacao_planos` |
| Follow Day | `analysis.tsx:939-1139` | inline `:952-982` | — |
| Funil comercial | `analysis.tsx:1195-1375` | inline, sobre `operacao()` | — |
| Pessoas e PDI | `analysis.tsx:1388-1577`, `RecordList` `:2247-2418` | média inline | `monetizacao_save_record` (`kind='pdi'`) |
| Abordagens | `analysis.tsx:1596-1975` | — | `monetizacao_save_record` (`kind='roteiro'`) |
| Distribuição | `analysis.tsx:1982-2235` | `operacao()` por dono | `monetizacao_save_record` (`kind='distribuicao'`) |

**Leitura.**

- `use-monetizacao.ts` relê a cada 60 s e chama as funções de servidor:
  - `lerMonetizacao` (`functions.ts:49-124`) lê deals, sync, planos, registros, envios, forecasts e unidades;
  - `lerContasBase` (`:140-166`) lê a Base pelas RPCs `base_carteira_manifesto` e `base_carteira_pagina`.
- A aba vem de `busca.ts:11-21` (`ABAS`) e `:73-89` (`validarBuscaMonetizacao`).
- `filtroDaBusca` (`:108-116`) fixa `owner = FARMER` (Matheus).

**Fora do módulo, mas dependente dele.**

- **Cockpit do CEO:**
  - `src/lib/cockpit-ceo/indicadores.ts` importa `operacao`, `receitaSomada` e `uteis`;
  - aponta para `?aba=operacao` (`:339-345`), `?aba=temporal` (`:608-614`) e `?aba=capacidade` (`:897-921`);
  - `conversa/carga.server.ts:12` lê `lerMonetizacao`;
  - testes em `tests/cockpit-ceo.test.mjs:419-420` e `:666-681`.
- **Rota aposentada `/fila-cella`:** `src/routes/_authenticated/fila-cella.tsx:10-22` tem o botão "Abrir o Follow Day".
- **Vitrine:** `src/routes/vitrine.tsx:1418+` usa a rota `follow-day` no exemplo de Fila.
- **Gráficos em uso no módulo:** 2 `ComposedChart` do recharts, na Operação (`operacao.tsx:466-516`) e em Projetado × realizado (`forecast.tsx:247-271`). As outras 7 abas não têm gráfico. O `src/components/ui/chart.tsx` não é importado por ninguém.
- **Helpers de gráfico do DS** (`src/lib/planning/grafico.ts`): `CORES_SERIE` `:50-57`, `COR_NEUTRA` `:59`, `COR_NEGATIVO` `:60`, `eixoProps` `:63-68`, `gradeProps` `:71-75`, `tooltipProps` `:78-90`, `legendaProps` `:96-102`, `linhaMetaProps` `:105-109` e `linhaZeroProps` `:112-115`. Tokens `--chart-1..6` em `src/styles.css:211-217` (tema claro) e `:273-279` (tema escuro). Não existe token `--viz-*` na `main`.

## 5. Recontagem de setembro (01 a 28/09, qualquer ator) contra o briefing

| Produto | Briefing | Recontado | Diferença |
|---|---|---|---|
| Consultoria | 29 criados, 19 trabalhados, 0 reuniões, 15 perdidos, 14 abertos | 29 · 19 · 0 · 15 · 14 | nenhuma |
| Finance | 91 criados, 63 trabalhados, 18 agendadas, 8 realizadas, 4 stand by, 11 validadas, 43 perdidos | 91 · 63 · 18 · 8 entradas em "Reunião realizada" e 4 em Stand by (9 eventos de reunião pela regra de 28/09) · 11 · 43 | nenhuma; os 9 são os 8 mais 1 Stand by que não tinha reunião |
| Cella | 59 trabalhados, 24 agendadas, 22 realizadas, 6 stand by, 25 validadas, 3 ganhos | 60 · 24 · 22 · 6 · 25 · 3 | +1 trabalhado (os 60 têm o Matheus como ator; provavelmente um movimento posterior à medição do briefing) |
