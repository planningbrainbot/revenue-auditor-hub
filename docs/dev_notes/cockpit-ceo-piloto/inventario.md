# Inventário — perguntas, fontes e cobertura do Cockpit do CEO

22/09/2026. Fonte da lista: PRD do cockpit (seis frentes), mapa de investidores p. 25 (11
exigências, pela leitura registrada no roadmap de 18/09) e a pergunta transversal da trajetória
para R$ 1 bi. A matriz vive em código em `src/lib/cockpit-ceo/perguntas.ts`; este arquivo explica
as escolhas. **Nenhuma pergunta está "verificada"**: isso exige conferência com dado real e aceite
do responsável, fora desta rodada.

Vocabulário: o mapa fala em "franqueadora" e "franqueados". A plataforma aboliu esses termos em
09/09/2026 (`DECISIONS.md`), então a tela usa "matriz", "unidades" e "sócios das unidades".

## Cobertura

| Estado | Significado |
|---|---|
| implementada, não homologada | Há indicador calculado por código a partir de fonte existente do Brain; falta conferir com dado real e obter aceite. |
| depende de dado | A pergunta está representada, com responsável e ação, mas a fonte não existe ou não está conciliada. |
| depende de decisão | Falta uma definição de negócio (perímetro, cliente ativo, mandato) antes de qualquer cálculo. |

## Matriz

| Id | Frente | Pergunta | Fonte | Responsável sugerido | Cobertura | Roadmap / mapa |
|---|---|---|---|---|---|---|
| R1 | Receita | Qual é nossa trajetória para R$ 1 bi de faturamento anual? | Faturamento 12 meses conciliado do perímetro aprovado — inexistente | CEO + CFO | depende de decisão | F11, F02 |
| R2 | Receita | Quanto faturamos e quanto recebemos no período? | Brain Financeiro / Omie, sem conciliação por perímetro | Controladoria / CFO | depende de dado | F02, F07 |
| R3 | Receita | Quanto vem de cada produto e de cada cliente? | Contrato → item → faturamento → recebimento (F02) | Financeiro + Receitas | depende de dado | F02 · mapa 1 |
| R4 | Receita | De onde vem o próximo incremento? | Receita prevista declarada no CRM em oportunidades validadas abertas (Monetização) | Departamento de Receitas | implementada, não homologada | F11 |
| R5 | Receita | Qual produto compensa originar e entregar? | Custos atribuíveis e repasses por produto — inexistente | Produto + Financeiro | depende de dado | F04, F12 · mapa 3 |
| C1 | Clientes | Quantos clientes temos de verdade? | Nenhuma flag da base responde sozinha; procedência não é veredito | CEO + Receitas | depende de decisão | F01 |
| C2 | Clientes | Onde há oferta disponível para trabalhar agora? | Base de clientes: `oferta()` + `disponibilidade()` / `estadoProduto()` | Departamento de Receitas | implementada, não homologada | F03 |
| C3 | Clientes | Quantos clientes ativos consomem cada vertical? | Matriz cliente × vertical com ativação — inexistente | Donos das verticais + Receitas | depende de decisão | F03 · mapa 2 |
| E1 | Comercial | Quantos contratos ganhamos no período, e estamos no ritmo da meta? | Monetização: eventos do CRM (`operacao()`), plano mensal | Comercial + Receitas | implementada, não homologada | F05, F11 |
| E2 | Comercial | A demanda está sendo trabalhada? | Monetização: leads trabalhados e oportunidades validadas | Comercial | implementada, não homologada | F05 |
| E3 | Comercial | Qual produto e qual unidade convertem? | Monetização por produto; unidade só via conta vinculada | Comercial + Receitas | implementada, não homologada | F05 |
| E4 | Comercial | O que a matriz gerou, distribuiu e converteu para cada unidade? | Trilha lead → roteamento → unidade — inexistente | Comercial / Expansão | depende de dado | F05 · mapa 6 |
| N1 | Rede | Quais unidades crescem com margem? | DRE padronizada por unidade — inexistente | Controladoria | depende de dado | F07 · mapa 8 |
| N2 | Rede | O sócio da unidade está satisfeito? | Pesquisa própria dos sócios — inexistente | Relacionamento com unidades | depende de dado | F08 · mapa 9 |
| N3 | Rede | Como estão repasses e concentração por unidade? | Apuração de royalties existe; reconciliação por perímetro não comprovada | Controladoria | depende de dado | F07, F02 |
| T1 | Retenção | Quem permanece, expande ou sai, por coorte? | Datas de início/fim e eventos históricos — carteira atual não é histórico | CS + Financeiro | depende de dado | F06 · mapa 4 |
| T2 | Retenção | A entrega comporta crescer? | Ativação, prazo, retrabalho e horas — inexistente | Operações | depende de dado | F12 |
| K1 | Capital | O que podemos consolidar, com qual capital e em que ritmo? | Cadastro de alvos e cenários — hipótese, separado do realizado | CEO + CFO | depende de decisão | F10, F11 · mapa 10 |
| K2 | Capital | Conseguimos reproduzir as demonstrações consolidadas? | Fechamento versionado — inexistente | Controladoria / CFO | depende de dado | F07, F13 · mapa 11 |
| K3 | Capital | Podemos demonstrar origem e uso dos dados da base? | Inventário de tratamento de dados — inexistente | Jurídico / Privacidade | depende de dado | F09 · mapa 5 |
| K4 | Capital | A documentação da rede e o histórico de sócios estão completos? | COF, contratos e desligados — inexistente no Brain | Jurídico + Expansão | depende de dado | F09 · mapa 7 |

## Serviços existentes reaproveitados

| Serviço | Onde | Uso no cockpit |
|---|---|---|
| Carga da Base e Monetização | `carregarMonetizacao` + `carregarContasBase` via `useMonetizacao()` | Fonte real única; permissões e RLS já aplicadas por ela |
| Elegibilidade por produto | `oferta()` em `monetizacao/model.ts` | Perfil apto por produto (Consultoria retroativa, Finance, Cella) sem regra nova |
| Disponibilidade e situação | `estadoProduto()` em `monetizacao/portfolio.ts` | "Prontas para enviar" = aptas, livres e fora do grupo só-Omie |
| Procedência | `procedencia()` / `soNoOmie()` | Ameaça "aptas só pelo Omie" (cliente ou fornecedor) |
| Eventos comerciais | `operacao()` | Leads trabalhados, validadas, contratos ganhos, série diária |
| Receita prevista do CRM | `receitaSomada()` | Soma com moeda conferida; faltantes contados à parte |
| Plano mensal | `BaseMonetizacao.plans` | Meta de contratos, capacidade e alocação por produto |

Fora do escopo do piloto: Growth, Brain Financeiro, NPS/CS, Royalties. Aparecem como destino ou
como pendência, não como número calculado aqui.
