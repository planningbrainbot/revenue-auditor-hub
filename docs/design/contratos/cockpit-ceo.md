# Contrato · Cockpit do CEO (`/cockpit-ceo`)

**Dono de produto:** Pedro Luca   **Usuário:** CEO (Pedro Araújo)   **Dono do código:** Pedro Luca (tela) · Eliezek (casca, área, publicação)   **Data:** 23/09/2026

Estado: **aprovado pelo Pedro em 23/09/2026** (frentes na lateral, pergunta do título e correção dos destinos).

Base: piloto `feat/cockpit-ceo-piloto` (rodadas 1 e 2, relatório `docs/dev_notes/cockpit-ceo-piloto/relatorio-rodada-2.md`), PRD do cockpit e as entradas de 22/09 do `DECISIONS.md`. Regras de cálculo, consultas, `portas.ts`, RLS e homologação **não mudam** nesta etapa: o contrato descreve o que já existe e como ele passa a ser mostrado.

## Revisão de 23/09/2026 — escopo da empresa inteira

**Estado: revisão pedida pelo Pedro em 23/09.** Implementada na branch `feat/cockpit-ceo-empresa-20260923` sob instrução explícita dele ("implemente as mudanças em lotes"). **Falta o "contrato ok" formal** antes do merge (PROCESSO §4). As seções abaixo desta revisão descrevem a versão publicada em 23/09 e ficam como histórico.

**O que muda:**
- A meta é o faturamento anual da **empresa** (R$ 1 bi, 2030). Monetização vira uma frente e um motor.
- **Primeira dobra**, com seis números:
  1. Faturamento anual × meta (inalterado);
  2. Faturamento do último mês fechado;
  3. Faturamento que saiu da base;
  4. MRR novo vendido do Inside Sales contra o plano do Growth;
  5. Vencido e não recebido;
  6. Onboardings há mais de 30 dias na mesma fase.
- Contratos de cada número: `docs/dev_notes/cockpit-ceo-empresa/contratos-indicadores.md`.
- **Anatomia da Visão executiva**, nesta ordem:
  1. seis cartões;
  2. decisões (até 3, o perímetro sempre primeiro);
  3. ameaças (as 5 mais graves; da empresa antes das da Monetização);
  4. "De onde veio a variação do faturamento em MM/AAAA?", com a ponte do mês;
  5. "Quais motores sustentam o crescimento?", uma linha por motor, cada um na sua régua;
  6. navegação das frentes, com a contagem de perguntas respondidas, parciais e lacunas.
- A demanda por produto da Monetização saiu da Visão executiva e foi para a frente Portfólio.
- **Nove frentes na lateral.** As chaves antigas da URL foram mantidas.

| Chave | Título | Painéis |
|---|---|---|
| `receita` | Receita e trajetória | trajetória (grupo e rede lado a lado), ponte mês a mês, pipeline e previsão (camadas) |
| `comercial` | Aquisição e conversão | aquisição plano × realizado, funil do mês, forecast do Growth, pipeline |
| `clientes` | Clientes | réguas de cliente ativo |
| `retencao` | Retenção e expansão | coortes, ponte da base |
| `operacao` | Operação e capacidade | onboarding, cadeia venda → faturamento, capacidade como lacuna |
| `rede` | Unidades | rede por unidade, meta × vendido do trimestre |
| `portfolio` | Portfólio e monetização | os cinco números da Monetização, demanda por produto, eventos diários |
| `caixa` | Caixa e margem | caixa livre, emitido × recebido, vencido por faixa, margem por grupo |
| `capital` | Evidências e capital | frescor das fontes, pilares e as 11 exigências, matriz CSV |

- **Procedência do cabeçalho:** Financeiro, Growth, Ops e Monetização, com a data da última carga do Financeiro.
- **Permissões novas, todas conferidas no servidor antes de ler:**
  - Financeiro: produto Financeiro + todas as empresas;
  - Growth: produto Growth + membro;
  - Onboarding: `view.painel_cs` ou `view.fila_cella` + todas as unidades;
  - cadeia: portas de `contratos`, `empresas`, `cs_onboarding_cards`, `contas_receber` e `central_tratativas`.
- **O que continua fora:**
  - previsão empresarial de faturamento (não existe fonte);
  - receita por vertical;
  - capacidade e SLA;
  - aquisições;
  - satisfação dos sócios.

  Tudo isso aparece como lacuna com dono.

## Propósito
- **Pergunta que responde (vira o `<h1>`, N1):** "Estamos no plano para o bilhão, o que mudou e o que é decisão minha?" *(aprovada pelo Pedro em 23/09)*
- **Público:** CEO e sócios da matriz. Hoje só o papel `admin` tem a área `cockpit_ceo`.
- **Decisão ou ação que provoca:** escolher uma das até três decisões da primeira dobra e abrir a tela dona para agir. O cockpit não executa nada (N10).
- **Métrica de sucesso da tela:** o CEO responde às cinco perguntas do PRD em até um minuto, sem abrir outra tela: status contra o plano, o que mudou, de onde vem o crescimento, o que ameaça e o que ele decide. Todo número abre a composição e a tela dona.
- **Arquétipo:** Visão geral.
- **Universo medido (`descricao` do PageHeader):** rede inteira ou uma unidade · período selecionado · cada número declara a própria unidade de contagem (negócio, conta, CNPJ ou reais). A trajetória, os clientes ativos, as coortes e a rede por unidade valem para a rede inteira e ignoram o filtro de unidade, e cada painel diz isso.

## Onde mora (decidido pelo Pedro em 23/09)
- **Área própria "Cockpit do CEO"**, com card na tela `/inicio` ("Onde você quer entrar?"). Não entra em Estratégia & Execução. Isso resolve a pendência 5.1 do `PRODUCT.md`.
- **Rota final:** `/cockpit-ceo`. O `/piloto/cockpit-ceo` continua como preview sintético, só em desenvolvimento (`notFound` em produção sem `VITE_COCKPIT_PILOTO=1`).

## Menu da área (aprovado em 23/09 · N6)
No piloto as seis frentes eram abas dentro da página (`?frente=`), o que a N6 proíbe: aba que troca de assunto não é filtro. As frentes viraram itens da lateral da área, como Monetização faz com `?aba=`, e a página deixou de desenhar abas.

| Item do menu (`titulo` = rótulo) | URL | O que mostra |
|---|---|---|
| Visão executiva | `/cockpit-ceo` | primeira dobra: 6 números, até 3 decisões, ameaças; abaixo, o que mudou e de onde vem o crescimento por produto |
| Receita e crescimento | `/cockpit-ceo?frente=receita` | trajetória para R$ 1 bi em 2030 (leituras candidatas) + perguntas da frente |
| Clientes e produtos | `/cockpit-ceo?frente=clientes` | clientes ativos por definição, sobreposição e penetração ganha no CRM + perguntas |
| Execução comercial | `/cockpit-ceo?frente=comercial` | eventos por dia no período + perguntas |
| Saúde da rede | `/cockpit-ceo?frente=rede` | faturamento, royalties + CSC e concentração por unidade + perguntas |
| Retenção e entrega | `/cockpit-ceo?frente=retencao` | coortes de retenção por mês de ganho + perguntas |
| Capital e evidências | `/cockpit-ceo?frente=capital` | exportação da matriz de evidências + perguntas |


## Números da primeira dobra (Visão executiva)
| Número (rótulo exato) | Definição | Unidade de contagem | Fonte e régua | Frescor | Drill-down (destino) | O destino bate? |
|---|---|---|---|---|---|---|
| Faturamento anual × meta de R$ 1 bi | sempre **não apurado** enquanto não houver perímetro; mostra a meta (R$ 1 bi em 2030), a média mensal necessária (R$ 83,3 mi) e as leituras candidatas lado a lado, sem somar | reais | Faturamento do Brain Financeiro (`fn_faturamento_mensal`, DRE 1.1 por emissão) e apuração de royalties confirmada | hora da leitura das duas fontes | composição → Receita e crescimento; Brain Financeiro (`/financeiro`, externo) | não, e a tela avisa (o Financeiro abre por empresa, sem o recorte do cockpit) |
| Contratos ganhos | negócios do pipe de Monetização com evento de ganho no período (data do evento, fuso de São Paulo) | negócio | CRM via carga da Monetização; ritmo da meta do plano do mês ao lado (N13) | hora da carga da Monetização | composição por produto → Operação diária (`/monetizacao`) | não, e a tela avisa (a Operação abre com o filtro de responsável padrão) |
| Oportunidades validadas | negócios com evento de validação no período | negócio | idem | idem | idem | não, e a tela avisa |
| Leads trabalhados | negócios com evento de início de trabalho no período | negócio | idem | idem | idem | não, e a tela avisa |
| Receita prevista em oportunidades abertas | soma do campo de receita prevista dos negócios abertos já validados; negócio sem valor ou com moeda divergente fica fora e é contado à parte | reais | campo do CRM, valor declarado pelo comercial (não é faturamento nem recebimento) | idem | Temporal e previsão (`/monetizacao?aba=temporal`) | não, e a tela avisa |
| Contas prontas para trabalhar | contas da Base elegíveis e livres em pelo menos um produto; aptas que só existem no Omie e aptas já em trabalho ficam fora e aparecem na composição | conta | régua de oferta da Base (`oferta`, `estadoProduto`), cadastro conciliado | hora do catálogo da Base | Produtos e listas (`/clientes?view=produtos`) *(corrigido em 23/09; antes apontava para "Base de clientes")* | não, e a tela avisa |

Seis cards na primeira dobra, até três decisões (N12). Cada card tem `procedencia` e `abrir`. Nenhum mostra 0 no lugar de dado ausente (N4).

## Números das frentes
| Painel | Números | Unidade | Fonte e régua | Destino | Bate? |
|---|---|---|---|---|---|
| Trajetória (Receita) | média mensal dos meses fechados contíguos, múltiplo necessário até R$ 83,3 mi/mês, 12 meses fechados, crescimento anual necessário (só com 12 meses) — por leitura: **grupo** e **rede**, nunca somadas | reais | grupo: `fn_faturamento_mensal`; rede: apuração de royalties confirmada (`receita_base + receita_base_antiga`); mês corrente e mês parcial na fonte fora | `/financeiro` (grupo), Apuração de Royalties `/unidades/royalties` (rede) *(corrigido em 23/09; antes apontava `/royalties`)* | não, e a tela avisa |
| Clientes ativos (Clientes) | CNPJs por definição candidata (contrato no Omie · pagou em 90 dias · cadastro · MRR > 0), contas na Base, sem conta, sobreposição par a par, união e interseção; penetração por produto **ganha no CRM** | CNPJ, conta, % | `omie_contratos_servico`, `contas_receber`, `qb_clientes_ativos`, `v_cliente_mrr`; penetração pelo vínculo de organização da Monetização | Contratos e churn `/clientes?view=contratos` | não, e a tela avisa (cada definição é uma régua diferente) |
| Eventos por dia (Comercial) | leads trabalhados, reuniões marcadas, reuniões realizadas por dia do período | evento | CRM | Operação diária | não, e a tela avisa |
| Rede por unidade (Rede) | faturamento, participação, royalties + CSC, royalties sobre faturamento, maior unidade, três maiores, HHI — na janela de meses completos | reais, % | apuração de royalties confirmada, centavo por apuração | Apuração de Royalties `/unidades/royalties` | sim (mesma apuração), exceto recebido, que não entra |
| Coortes (Retenção) | retidos por mês de ganho, denominador fixo, M0–M12 | contrato | `contratos` (ganho de venda, unidade regional) × churn datado da Central de Tratativas | Contratos e churn `/clientes?view=contratos` | não, e a tela avisa |
| Matriz de evidências (Capital) | CSV: pergunta, cobertura, fonte, responsável, pendência, estado dos números | — | catálogo + estados da tela | download | — |

## Estados
| Estado | Quando acontece | O que a tela mostra |
|---|---|---|
| Carregando | carga da Monetização/Base ou de uma leitura de frente em curso | `Carregando variante="kpis"` na primeira dobra; `Carregando` no painel da frente |
| Vazio (sem dado na fonte) | fonte respondeu sem registro (ex.: nenhuma coorte fechada) | `EstadoVazio` com o motivo |
| Vazio por filtro | período ou unidade sem evento | `KpiCard` com valor 0 **só** quando a fonte foi lida e contou zero; a nota diz o recorte |
| Parcial / não apurado | meta sem perímetro; comparação sem histórico; mês parcial na fonte; definição com registro sem documento | `KpiCard estado="parcial"` ou `"nao-apurado"` com a lacuna e o responsável; `StatusBadge` no painel |
| Fonte indisponível / erro | carga falhou, leitura da fonte falhou, escopo não lido | `KpiCard estado="indisponivel"`; `EstadoErro` no painel com a fonte |
| Sem acesso | sem a área `cockpit_ceo`; sem chave de Base/Monetização; sem Financeiro; sem todas as unidades; porta da fonte fechada (`portas.ts`) | tela inteira: `EstadoSemAcesso oQueFalta="área Cockpit do CEO"`; por número ou painel: `KpiCard estado="sem-acesso"` / `EstadoSemAcesso` dizendo qual fonte ou chave falta |

Dado sintético (preview): selo "Dados sintéticos" no `PageHeader`; toda fonte começa com "SINTÉTICO".

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `periodo` | `mes`, `mes_anterior`, `trimestre`, `ano`, `personalizado` (+ `de`, `ate`) | `mes` | números comerciais, receita prevista, decisões e ameaças; não afeta trajetória, clientes ativos, coortes nem rede |
| `perimetro` | chave da unidade ou vazio (rede) | rede | idem |
| `frente` | `receita`, `clientes`, `comercial`, `rede`, `retencao`, `capital` | nenhuma (Visão executiva) | qual item do menu está aberto |
| `indicador` | id do número | nenhum | abre a composição em `Sheet`; voltar do navegador fecha |

Período inválido volta para o mês atual com aviso (já é assim).

## Permissões (N8)
- **Área que abre a tela:** `cockpit_ceo` (aplicada em produção só para `admin`, migration `20260922220000`). Liberar para o CEO se ele não for admin: a decidir por Pedro + Eliezek.
- **Dentro da tela (só leitura):** números comerciais exigem `view.aquario` ou `view.monetizacao`; contas prontas exigem `view.aquario` ou `view.clientes`; leitura do grupo exige o produto Financeiro **e** todas as empresas; rede, clientes ativos e coortes exigem todas as unidades **e** a porta de cada fonte (`portas.ts`, conferida contra a RLS real em 8 perfis).
- **Quem não tem:** vê o estado "sem acesso" no número ou no painel, com o motivo. Nunca 0.

## Ações
| Ação | Quem pode | Confirmação | Retorno |
|---|---|---|---|
| Abrir composição de um número | todos com a área | — | `Sheet` lateral, URL com `indicador=` |
| Abrir a tela dona | todos com a área | — | navega; destino externo (Financeiro) abre no mesmo separador |
| Exportar matriz de evidências (CSV) | todos com a área | — | download no navegador |
| Encaminhar pergunta com Jev | **desligado em produção** (flag); só no preview do piloto | — | — |

## O que NÃO entra, e por quê
- **Valuation, volume transacionado, receita Partners isolada:** a meta é faturamento anual.
- **Gap único para o bilhão:** o perímetro não está escolhido (pendência 5.12). As leituras grupo e rede aparecem lado a lado e nunca se somam, porque os royalties das unidades são receita do grupo.
- **Lista de contas, negócios ou clientes:** a Visão geral agrega e manda para a tela dona (N10). CNPJs não aparecem na tela; só contagens.
- **Recebido por unidade:** a única série mensal agrupa por data de competência, régua que a casa declarou não confiável (26/08).
- **Satisfação dos sócios:** a tabela não tem política de leitura; o painel diz isso até alguém decidir quem lê.
- **Jev em produção:** a chave mora no Keychain local; fica desligado por flag até Pedro e Eliezek decidirem configurar a chave na Vercel.
- **Escrita em CRM, disparo ou qualquer ação operacional.**

## Para onde manda (tela dona)
- Operação diária, Temporal e previsão, Capacidade e alocação (`/monetizacao`, `?aba=temporal`, `?aba=capacidade`).
- Base de clientes: Produtos e listas (`/clientes?view=produtos`) e Contratos e churn (`/clientes?view=contratos`).
- Apuração de Royalties (`/unidades/royalties`).
- Brain Financeiro (`/financeiro`).

## Pendências (a decidir, não inventadas)
1. Perímetro da meta de R$ 1 bi — CEO + Pedro (pendência 5.12).
2. Qual definição de cliente ativo vale em cada contexto — Pedro + Eliezek (pendência 5.3).
3. Liberar a área para o CEO, se ele não for `admin` — Pedro + Eliezek.

## Checagem
- [ ] Definição de pronto de `docs/design/README.md` cumprida
- [x] Números conferidos na fonte (recontagem independente — homologação da rodada 2)
