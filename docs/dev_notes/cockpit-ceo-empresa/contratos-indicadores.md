# Contratos dos indicadores do Cockpit do CEO (versão empresarial, 23/09/2026)

Estes contratos valem para o que está em `src/lib/cockpit-ceo/empresa.ts` (números novos) e em
`indicadores.ts` (os seis da primeira fatia). Cada número leva estes campos também na tela, na
composição (`Sheet`): definição, período, perímetro, fonte, data do dado, estado, composição e o que
falta.

Regras comuns a todos:
- Os estados são `disponivel`, `parcial`, `nao_apurado`, `fonte_indisponivel` e `acesso_insuficiente`. Nenhum deles vira 0.
- Fonte com carga acima de 2 dias da cadência declarada vira `parcial`, com a data da carga.
- O cache é por usuário, com 10 minutos de validade e sem nova tentativa automática.
- Nome de cliente e CNPJ não saem do servidor.
- Conciliação: `scripts/cockpit-ceo/homologar-empresa.mjs`, que confere cada número contra SQL independente. Resultado em `homologacao/resultado-*.json`.

## Primeira dobra (Visão executiva)

### `meta-bilhao` · Faturamento anual × meta de R$ 1 bi
Inalterado desde a rodada 2.
- **Pergunta:** R1.
- **Estado:** sempre `nao_apurado` enquanto o perímetro não for decidido.
- **Composição:** média dos meses fechados por leitura candidata (grupo e rede), nunca somadas.
- **Mudança de fonte:** a leitura do grupo passou a vir do Financial Brain.
- **Dono:** CEO + CFO.

### `faturamento-mes` · Faturamento de MM/AAAA
| Campo | Valor |
|---|---|
| Pergunta | R6 — de onde veio a variação do faturamento no último mês fechado? |
| Definição | Receita bruta de vendas (DRE 1.1) das empresas do grupo, pela emissão, como a tela de Faturamento: sem nota cancelada, sem as exclusões da controladoria, Finance e Negócios Estruturados fora por padrão |
| Fórmula | último mês fechado da série de `fn_faturamento_mensal`; composição = ponte por cliente |
| Unidade | reais |
| Granularidade | mês de competência da emissão |
| População | empresas do grupo com fechamento em `competencia_cobertura` |
| Fonte canônica | Financial Brain (`itpddzjfrgrbathcqbpo`) · `public.fn_faturamento_mensal` (a mesma função da tela) |
| Chave | nome do cliente no Financeiro (a mesma da tela de Faturamento); linha sem cliente vira parcela própria |
| Inclusões e exclusões | as da função; recortes padrão fora, com o valor declarado |
| Deduplicação | a função escolhe a fonte vigente por mês (planilha × Omie); o cockpit não soma lançamento nenhum |
| Nulos | mês sem lançamento = sem movimento para o cliente; mês sem fechamento não entra |
| Atualização | cron do Financeiro (diário; **parado desde 20/09** pela cobrança das GitHub Actions) |
| Dono | Controladoria / CFO |
| Permissão | área `cockpit_ceo` + `tem_produto('financeiro')` + `usuario_escopo.todas_empresas`, conferidos no servidor antes da chamada |
| Cobertura | jan/2026 em diante (começo do histórico do Financeiro); PARTNERS sem Omie desde jul/2026, AGRO sem credencial |
| Conciliação | série = a da função; ponte classificada em SQL contra o TypeScript, parcela a parcela e em clientes, nos 7 meses; cada mês fecha com a série da própria função |

### `faturamento-saiu` · Faturamento que saiu da base
- **Pergunta:** T1.
- **Fórmula:** −(sem faturamento no mês + contração) no último mês fechado.
- **Unidade:** reais.
- **Composição:** as duas parcelas, com o número de clientes.
- **Régua de emissão:** cliente sem nota no mês não é churn confirmado; churn contratual fica nas coortes (Central de Tratativas).
- **Comparação:** o que entrou no mesmo mês (novos, retornos e expansão).
- **Fonte, dono, permissão e conciliação:** os mesmos de `faturamento-mes`.

### `mrr-vendido` · MRR novo vendido (Inside Sales)
| Campo | Valor |
|---|---|
| Pergunta | A2 — a aquisição cumpre o plano do mês? (e A1, R7) |
| Definição | MRR dos contratos ganhos no pipe Inside Sales nos meses do período, pela série do Growth. Valor mensal contratado no CRM: não é faturamento e não entra na ponte |
| Fórmula | Σ `growth.serie_mensal.mrr` dos meses do período (meses inteiros) |
| Unidade | reais (MRR) |
| Evento | ganho no CRM (`won_time`, fuso de São Paulo), negócio arquivado fora (regra do Growth) |
| Comparações | plano do Growth (`growth.metas`, papel `funil`, `new_mrr_mes`) só quando todos os meses têm plano; no mês corrente, forecast pelo ritmo e pelo pipeline do modelo do Growth (`growth.mes_corrente`) |
| Fonte | Growth · `growth.serie_mensal`, `growth.metas`, `growth.mes_corrente` |
| Permissão | área + `tem_produto('growth')` + `growth.e_membro()` (a própria policy), com a sessão da pessoa |
| Cobertura | plano desde jun/2026; canal vazio em 86% dos negócios de 2026 |
| Dono | Diretoria de Growth |
| Conciliação | série = vendas e MRR (`mrr_efetivo`) contados direto em `growth.deals`, mês a mês, sem diferença |

### `vencido-em-aberto` · Vencido e não recebido
- **Pergunta:** R2.
- **Definição:** títulos a receber em aberto com previsão já passada, no Omie ao vivo. É a régua "Valores Atrasados (Previsão)" do Financeiro; não é a foto do fechamento.
- **Fonte:** `public.fn_inadimplencia_live`.
- **Composição:** faixas de atraso.
- **Comparação:** total em aberto.
- **Período:** fotografia de agora.
- **Cobertura:** empresas sem sincronização de títulos ficam nomeadas.
- **Dono:** Controladoria.
- **Conciliação:** faixas somam o vencido (R$ 4.983.455,20 em 23/09).

### `onboarding-parado` · Onboardings há mais de 30 dias na mesma fase
| Campo | Valor |
|---|---|
| Pergunta | O1 — conseguimos ativar o que vendemos? |
| Definição | cards do pipe de Onboarding fora de "Concluído" e "Churn no Onboarding" há mais de 30 dias na fase atual |
| Unidade | clientes (cards) |
| Período | fotografia |
| Fonte | Ops · `ops.cs_onboarding_cards` (Pipefy espelhado a cada 15 min), idade = agora − `entrou_fase_atual_em` |
| Faixas | 30 e 60 dias são **faixas de leitura, não SLA**: nenhum prazo foi decidido |
| Permissão | área + chave `view.painel_cs` ou `view.fila_cella` (a policy) + todas as unidades (policy restritiva por unidade) |
| Dono | Operações + CS |
| Conciliação | em curso, >30, >60 e concluídos contados em SQL: iguais |

## Frentes: os seis da primeira fatia
São contratos-ganhos, oportunidades-validadas, leads-trabalhados, receita-prevista-aberta e contas-prontas. Os contratos não mudaram (rodada 2 e `docs/design/contratos/cockpit-ceo.md`); agora ficam na frente **Portfólio e monetização**.

## Painéis de frente

| Painel | Medida | Fonte | Conciliação |
|---|---|---|---|
| Ponte mensal (Receita, Retenção) | novos, retornos, expansão, contração, sem faturamento, sem cliente, por mês fechado | `fn_faturamento_mensal` sem limite | SQL independente, 7 de 7 meses |
| Pipeline aberto (Receita, Aquisição) | MRR aberto não ponderado por mês de fechamento esperado, sem data, vencidos | `growth.deals` Inside Sales abertos | SQL: 861 negócios, R$ 1,41 mi, **todos sem data** |
| Aquisição | funil do último mês fechado, plano × realizado, forecast do mês | `growth.*` | série × deals |
| Metas por unidade (Unidades) | meta × vendido no trimestre | `growth.dist_metas` (leitura restrita à diretoria comercial) | soma por trimestre |
| Caixa | caixa livre (saldo bancário), emitido × recebido por mês de emissão, vencido por faixa | `fn_cockpit_indicadores`, `fn_receita_emitido_recebido`, `fn_inadimplencia_live` | faixas = vencido; mês depois da foto de títulos (01/06) sem recebido |
| Margem por grupo (Caixa) | receita bruta, lucro bruto e margem por grupo de apuração, meses fechados do ano | `fn_cockpit_indicadores.por_empresa` | SQL por grupo = TS |
| Onboarding (Operação) | fila por fase e idade, concluídos, churn, ganho → conclusão, card → conclusão | `cs_onboarding_cards` + `contratos` | SQL: contagens e mediana iguais |
| Cadeia (Operação) | mesma safra: ganho → onboarding iniciado → concluído → faturado (unidade ou grupo) → pago na unidade → saída | `contratos`, `empresas` (CNPJ de reserva), `cs_onboarding_cards`, `contas_receber` das unidades, Financial Brain (nome normalizado), `central_tratativas` | SQL independente, todos os elos |
| Frescor (Evidências) | última carga por fonte | `dado_frescor` (Financeiro), `growth.deals.updated_at`, `cs_onboarding_cards.synced_at` | leitura direta |

### Regras de vínculo da cadeia
- **Venda → onboarding:** `empresa_id`.
- **Venda → faturamento:**
  - CNPJ do contrato (14 dígitos) e, na falta, o CNPJ da empresa.
  - Na unidade: título no contas a receber com vencimento a partir do ganho.
  - No grupo: CNPJ → cadastro de contrapartes do Omie → nome normalizado (`fn_norm_contraparte`, portada e conferida em 7.067 de 7.067 nomes) → faturamento a partir do mês do ganho.
  - Nome que aponta para mais de um documento não conta.
- **Card → venda de origem:** último ganho da empresa até a criação do card.
- **Sem uma das duas fontes de faturamento:** o total "faturadas" sai `null`, nunca como piso.
