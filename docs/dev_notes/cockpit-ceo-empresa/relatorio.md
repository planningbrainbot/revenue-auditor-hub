# Cockpit do CEO empresarial — relatório (23/09/2026)

Branch `feat/cockpit-ceo-empresa-20260923`, a partir da `main` `b5c44d7`. **Nada foi publicado nem
integrado.** Nada foi escrito em produção, CRM, e-mail ou automação. Toda leitura real foi feita em
transação só de leitura.

Documentos desta rodada:

| Arquivo | Conteúdo |
|---|---|
| `diagnostico.md` | cobertura por área e tipos de ausência |
| `prd-especificacao.md` | escopo, não objetivos, mapa de fontes, arquitetura, aceite e lotes |
| `contratos-indicadores.md` | contrato de cada número |
| `homologacao/resultado-*.json` | conferências com SQL, só agregados |
| `atualizacao-para-artifact.md` | gerado do registro único |

## Percurso de aceite por área

| Área | Pergunta | Onde responde | Resposta em 23/09 (dado real) | Lacuna exata e quem fecha |
|---|---|---|---|---|
| Financeiro | R6 · De onde veio a variação do último mês? | Visão executiva, cartão "Faturamento de 08/2026" e ponte | R$ 6,60 mi → R$ 7,46 mi. Expansão +R$ 1,56 mi em 105 clientes; novos +R$ 220 mil (64); retornos +R$ 74 mil (19); contração −R$ 595 mil (83); sem faturamento −R$ 404 mil (47). Fecha em centavos | Crons parados desde 20/09 (cobrança das GitHub Actions, dono da conta); linhas de unidade nova e monetização sem vínculo de receita (Controladoria + Receitas) |
| Financeiro | R2 / X1 / X2 · Faturamento vira caixa? Com que margem? | Caixa e margem | Margem bruta de 44,4% sobre R$ 58,8 mi no ano; caixa livre de R$ 1,90 mi (sem saldo: AGRO, NEO, PARTNERS); vencido de R$ 4,98 mi em 801 títulos | Foto de títulos em aberto parada em 01/06: recebido de jul e ago sem medida (Controladoria) |
| Growth | A1 / A2 · A aquisição cumpre o plano? | Visão executiva (MRR novo vendido) e Aquisição e conversão | Jun R$ 223 mil (plano R$ 245 mil); jul R$ 216 mil (R$ 220 mil); ago R$ 267 mil (R$ 230 mil); forecast do mês pelo modelo do Growth | Canal vazio em 86% dos negócios; custo completo de aquisição (Growth) |
| Comercial | R7 · Qual previsão sustenta os próximos meses? | Receita e trajetória, e Aquisição e conversão | 861 negócios abertos, R$ 1,41 mi de MRR sem ponderação | **Nenhum negócio tem data de fechamento esperada**; não existe previsão empresarial nem probabilidade por etapa (Comercial; CFO + RevOps) |
| Ops | O1 · Conseguimos ativar o que vendemos? | Visão executiva (cartão) e Operação e capacidade | 147 em onboarding, 71 há mais de 30 dias na fase (22 há mais de 60); card → conclusão em mediana de 27 dias (36 casos) | SLA não decidido (Operações propõe, CEO aprova); capacidade, horas e SLA sem fonte |
| Ops + comercial + Financeiro | O2 · A venda chega ao faturamento e fica? | Operação e capacidade, cadeia | Safra de 17/07 a 22/09: 139 ganhos → 27 com onboarding → 0 concluídos → 11 faturados (na unidade) → 4 pagos → 0 saídas | **96 contratos sem CNPJ** e 16 sem empresa (Comercial / Ops); recebimento do grupo por cliente não é lido |
| Unidades | N3 / N4 · Quais unidades crescem e cumprem a meta? | Unidades | Rede por unidade (rodada 2); T3/2026 com 13 unidades, meta de R$ 550 mil e R$ 748 mil vendidos | Custo por unidade (N1) e satisfação (N2) sem fonte ou sem leitura |
| Clientes/CS | C1 / T1 · Quantos clientes, quem fica? | Clientes; Retenção e expansão | Quatro réguas (rodada 2); coortes; saída de faturamento pela ponte | Definição de cliente ativo (CEO + Receitas); churn datado incompleto (CS) |
| Monetização | E1 / E2 / R4 / C2 · A monetização anda? | Portfólio e monetização | Os cinco números da primeira fatia, demanda por produto | Receita por vertical não separável no Financeiro; v10 × v11 sem decisão |
| Capital | K1–K4, G1 · O que demonstramos? | Evidências e capital | Frescor por fonte; pilares; 11 exigências (1 respondida em parte, as outras parciais ou lacunas); CSV | Consolidação sem mandato; COF, privacidade e fechamento versionado sem fonte |

## O que está e o que não está

| Onde | O quê |
|---|---|
| Local | branch com todos os lotes, preview sintético (`/piloto/cockpit-ceo`), capturas em `docs/design/capturas/cockpit-ceo/empresa/` |
| Preview na Vercel | não feito: o deploy do Ops é do Eliezek |
| Integrado à `main` | não |
| Publicado | não; em produção continua a versão de 23/09 (PR #18), que lê a cópia congelada do Financeiro |

## Verificações

- **Testes:** 209/209 (`node --test tests/*.test.mjs`), 20 deles novos (`cockpit-ceo-empresa.test.mjs`). Os valores esperados foram calculados à mão, não pela função testada.
- **`tsc`:** 7 erros, todos preexistentes, nenhum nos arquivos do cockpit.
- **`design:lint:changed`:** 0 violações no escopo. A catraca global acusa V4 em `idu-*.tsx`, que veio da `main`.
- **Homologação com dado real:** 10 de 10 conferências.
  - ponte em SQL × TypeScript;
  - fechamento da ponte com a série da fonte;
  - margem por grupo;
  - faixas de inadimplência;
  - série do Growth × `growth.deals`;
  - pipeline;
  - onboarding;
  - mediana do ganho à conclusão;
  - cadeia;
  - porta × RLS em 5 perfis.
- **Tempo:** a função de faturamento sem limite leva 2,6 s no banco (teto do service_role: 30 s). A primeira carga da frente de receita fica entre 3 e 6 s; depois o cache vale 10 minutos por usuário.
- **Capturas:** 10 vistas × 2 temas. A página executiva foi conferida contra a anatomia do arquétipo Visão geral.

## Pendências

| Pendência | Quem | Impacto |
|---|---|---|
| Perímetro da meta | CEO + CFO | sem gap único |
| Cobrança das GitHub Actions do Financeiro | dono da conta `pedroluca-prog` | Financeiro parado desde 20/09 |
| Migrar o Financeiro para o banco único (ou declarar o Financial Brain como fonte) | Eliezek + dono do Financeiro | define a fonte de longo prazo |
| "Contrato ok" da revisão de tela; publicação | Pedro; Eliezek | merge e deploy |
| Propostas de segurança (EXECUTE da cópia `financeiro`; `qb_clientes_ativos`) | Eliezek + dono do Financeiro | hoje um sócio regional lê faturamento pela cópia |
| CNPJ em todo contrato; data de fechamento esperada no CRM | Comercial / Growth | cadeia e previsão |
| SLA de onboarding | Operações + CEO | fila sem régua |
| Previsão empresarial; v10 × v11 | CFO + RevOps; Pedro | forecast só por recorte |
| Chave OpenRouter do piloto (rodada 2) | Pedro | revogar |
