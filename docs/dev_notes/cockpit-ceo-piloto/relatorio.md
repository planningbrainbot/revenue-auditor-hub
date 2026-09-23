# Cockpit do CEO — relatório do piloto (22/09/2026)

Piloto supervisionado numa cópia local do Planning Brain (`planning-brain-cockpit-piloto-20260922/app`,
branch `feat/cockpit-ceo-piloto`, sem remote, base `2a08621` = `aa16914`). Nada foi publicado,
nenhuma migration foi aplicada, nenhum banco foi consultado.

## 1. Como abrir

```bash
cd "PM Work/execution/planning-brain-cockpit-piloto-20260922/app"
./scripts/cockpit-ceo/preview.sh
# abrir http://127.0.0.1:8080/piloto/cockpit-ceo
```

O preview usa **fonte sintética** ("Empresa Sintética NNN", "Unidade Exemplo …"), não tem login e
aponta o Supabase para um endereço local morto — não alcança o banco único. Botões de destino
(Operação, Base de clientes) aparecem com o endereço, mas não navegam: exigem login e dado real. O
painel "Pergunte ao cockpit" chama o Jev de verdade enquanto houver chave no Keychain e orçamento
(7 de 10 requisições restantes).

A rota com dado real é `/cockpit-ceo`, dentro do app autenticado. Ela só aparece para quem tiver a
área `cockpit_ceo`, que **ainda não existe no banco** (proposta em
`supabase/proposals/20260922120000_cockpit_ceo_area.sql`, não aplicada). Não foi aberta com dado
real nesta rodada.

## 2. O que foi implementado

- **Visão executiva numa tela** (1440×900 e 1280×800, sem rolagem horizontal): seis indicadores,
  até três decisões, o que ameaça o resultado; abaixo, o que mudou no período e de onde vem o
  crescimento por produto; depois, as seis frentes.
- **Cabeçalho com o universo medido** (perímetro, período, contas, negócios, "Financeiro fora deste
  recorte"). Filtros de período (mês, mês anterior, trimestre, ano, personalizado) e perímetro
  (rede ou unidade) ficam na URL; período inválido ou desconhecido volta ao mês atual com aviso.
- **Cadeia completa pergunta → indicador → composição → destino.** Cada número abre definição,
  unidade de contagem, período, perímetro, filtros, fonte, versão da regra, data do dado, data da
  apuração, comparações, composição com soma conferida (∑ ✓), lacuna com responsável e tela de
  origem — dizendo quando o destino não recebe o mesmo recorte.
- **Indicadores:**
  - Meta de R$ 1 bi: sempre "não apurado", com responsável CEO + CFO. Não é valuation, volume, rede
    nem Partners.
  - Contratos ganhos no CRM, oportunidades validadas, leads trabalhados: eventos do período, período
    anterior de mesma duração, meta e capacidade do plano mensal e ritmo por dias úteis.
  - Receita prevista declarada no CRM em oportunidades abertas validadas: parcial quando falta valor;
    declarada como não faturamento.
  - Contas prontas: contas únicas, com a sobreposição de produtos declarada.
- **Estados distintos:** disponível, parcial (carga com falha ou com mais de 30 minutos, com a data
  do dado), não apurado, fonte indisponível, acesso insuficiente. Nulo nunca vira zero.
- **Regras reaproveitadas, nenhuma redefinida:** `oferta()`, `estadoProduto()`, `operacao()`,
  `receitaSomada()`, `uteis()`, procedência "só no Omie", origem, Curitiba e elegibilidade por
  produto. Decisões e ameaças saem de regras fixas sobre os mesmos números, não de IA.
- **Seis frentes com as perguntas do PRD e do mapa de investidores**, cada uma com fonte,
  responsável, pendência e cobertura; as 11 exigências da p. 25 estão rastreadas.
- **Jev real** atrás de adaptador de servidor (ver seção 3 e `jev.md`).

## 3. Jev real

| Chamada | Resultado | Modelo | Duração | Custo informado |
|---|---|---|---:|---:|
| E-mail fictício, 3 perguntas | intenção `conhecer` (conf. 1,00); interesse 1,0 = exploratório (conf. 1,00); pede pessoa `noul` 0,92 | typesafe/jev-1.13-20260917 | 873 ms | US$ 0,000025368 |
| CEO: ritmo de contratos | Execução comercial (0,92), conf. 0,90 | idem | 711 ms | US$ 0,00002919 |
| CEO: evidência de retenção | Retenção e entrega (0,99), conf. 0,98 | idem | 429 ms | US$ 0,000029232 |

Total: 3 de 10 requisições e US$ 0,00008379 informados. Isso prova conectividade, contrato e custo,
não qualidade. A chave foi colada no chat: **revogar no OpenRouter ao fim do piloto** e removê-la do
Keychain (comando em `jev.md`).

## 4. Testes e verificações

| Verificação | Resultado |
|---|---|
| `node --test tests/*.test.mjs` | **146/146** (95 anteriores + 51 novos, com mocks para o Jev) |
| `npx tsc --noEmit` | 7 erros, **os mesmos 7 anteriores** (nenhum em arquivo do cockpit) |
| `npx eslint` nos arquivos tocados | 0 erros; avisos de *fast refresh* no mesmo padrão já existente |
| `vite build` (8 GB de heap) | verde; no bundle, o preview compila para `throw notFound()` |
| `scripts/cockpit-ceo/capturas.mjs` (Chrome por CDP) | **16/16**: primeira dobra, composição, voltar, filtros na URL, gráfico diário, meta não apurada, período inválido, 1280 px e só 127.0.0.1 + fonte do Google na rede |
| Revisão independente da branch | 0 críticos, 6 importantes e 10 menores de efeito visível corrigidos com teste; 1 menor diferido |

Falhas preexistentes: os 7 erros de tipo acima e o aviso de hidratação do `<html>` (script de tema
do layout raiz), que aparece em qualquer página.

**Não verificado:** tela com dado real, RLS com sessão real, perfis diferentes logados, desempenho de
carga (meta proposta: 3 s), regressão visual em Base de clientes e Operação (não há como abri-las
sem login). Base e Operação não foram alteradas; houve mudanças mínimas em código compartilhado:
`LIMITE_CARGA_PARADA_MS` em `model.ts`, usado também pela barra de frescor de `common.tsx`, e uma
entrada nova em `areas.ts`.

## 5. Fictício × verificado em fonte real

- **Fictício:** todos os números do preview; os textos enviados ao Jev.
- **Verificado em fonte real:** o contrato do OpenRouter Decisions e da TypeSafe (documentação
  oficial de 22/09) e as três respostas reais do Jev. Nenhum número do negócio foi lido ou exibido.
  As regras de negócio são as do código do app, sem homologação nova.

## 6. Perguntas: respondidas × representadas

Nenhuma das 21 perguntas do catálogo está "verificada". Cinco têm cálculo implementado sobre fonte
existente e falta homologar: próximo incremento (R4), oferta disponível (C2), contratos e ritmo
(E1), demanda trabalhada (E2), conversão por produto e unidade (E3). As outras dezesseis estão
representadas com fonte, responsável e o que falta: 12 dependem de dado e 4 de decisão (trajetória
para R$ 1 bi, cliente ativo, penetração por vertical, consolidação). A meta de R$ 1 bi aparece como
indicador "não apurado", com lacuna e responsável.

## 7. Decisões que continuam com você

1. Perímetro e ano-alvo da meta de R$ 1 bi.
2. Definição de cliente ativo por contexto.
3. Onde o módulo mora: área própria "Cockpit do CEO" ou item de "Estratégia & Execução" (o nome
   "Cockpit" foi recusado para aquela área em 21/09).
4. Quem recebe a área além do super admin.
5. Política de receita, rateio e parcela Partners para a ponte de faturamento.

## 8. Próximos lotes

| Lote | Entrega | Depende de | Aceite |
|---|---|---|---|
| 1. Homologar a fatia | Rota `/cockpit-ceo` com dado real, em ambiente autorizado | Decisões 3 e 4; área aplicada; sessão de admin; ambiente de homologação | Cada número bate com Base de clientes e Operação no mesmo recorte; estados certos para admin, "só Clientes" e sem chaves; tempo frio/quente medido |
| 2. Integrar com a main | Rebase sobre `origin/main`; destinos que aceitam período e responsável na URL (Operação) | Lote 1; revisão do dono da Monetização | Destino com "mesmo recorte" verdadeiro e totais iguais; sem regressão em Base e Operação |
| 3. Receita conciliada (F02) | Contrato → faturamento → recebimento, 1 unidade × 1 mês fechado | Financeiro/Controladoria; decisão 5 | Fecha com a fonte financeira; o não classificado aparece; nada duplicado entre entidades |
| 4. Trajetória para R$ 1 bi (F11) | Gap e ponte de crescimento por produto e unidade | Decisão 1 e Lote 3 | O gap reconcilia com o Financeiro; o plano fica preservado em snapshot |
| 5. Clientes e penetração (F03) | Clientes ativos, penetração por vertical, com dois denominadores | Decisão 2 | Ganho no CRM não conta como consumo; sobreposição explícita |
| 6. Retenção, rede e capital (F06–F10, F13) | Coortes, DRE por unidade, satisfação dos sócios, pacote de evidências | Dado histórico e donos de cada área | Denominador fixo de coorte; documento ausente vira pendência, nunca selo |
| Jev | Avaliação rotulada em português (claros, ambíguos, contraditórios, fora de escopo) | Conjunto rotulado; autorização antes de qualquer texto real | Acerto por classe, falsos positivos, p50/p95, custo por mil; uso automático só com vantagem demonstrada |

## 9. Controles antes de uma execução prolongada

Esta sessão **não era isolada**: começou pelo chat, sem o `start.py`, com MCPs de escrita, CLIs de
Supabase e Vercel e rede aberta. As restrições valeram por disciplina, não por barreira. Para uma
noite sem supervisão:

- runner com sandbox obrigatório (o `settings.json` do piloto) ou VM dedicada, sem MCP e com rede
  só para registry e fornecedor de IA;
- teto de tempo e de gasto controlado fora do agente, e chave nova com teto de crédito;
- um lote por vez, com plano finito e aceite;
- ledger e commit por tarefa;
- regra de parada depois de duas tentativas sem progresso;
- proibição de push, deploy, migration e escrita em CRM;
- revisão humana de manhã antes de integrar.

## 10. Commits

`b6be941` plano e ambiente · `b44be0a` contrato e período · `38e2495` catálogo · `bb54714`
indicadores · `a472e60` fonte sintética e adaptador · `fe52283` interface e navegação ·
`dcbafd3` adaptador Jev · `e6c9fb1` decisões e script do teste real · `ad843ae` correções da
revisão · commit final com o resultado do Jev e este relatório.

Superpowers: a cópia 6.4.1 foi usada como instrução lida do disco (`writing-plans`,
`executing-plans`, TDD, verificação e revisão final). O plugin não estava carregado. Plano em
`docs/superpowers/plans/2026-09-22-cockpit-ceo-piloto.md`; ledger em
`.superpowers/sdd/2026-09-22-cockpit-ceo-piloto/progress.md`, fora do Git.
