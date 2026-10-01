# Monetização · Operação na régua cumulativa e visão "Hoje"

Data: 2026-10-01. Dono do produto: Pedro Luca. Frente 03 da call de 01/10
(`monetizacao/outputs/2026-10-01-prompts-call-operacao/03-acompanhamento-diario.md`).

Aprovado pelo Pedro em 01/10 (conversa): "pode sim. tu vai corrigir no painel direto no brain né? pode fazer." Os
parâmetros abaixo também foram aprovados nesse dia: 3 dias úteis, Conexão = qualquer resposta e todos os sócios da
unidade. Mockup aprovado: https://claude.ai/artifact/39RCh3RfopWzvb7KaLVLuJ.

## Problema

A aba Operação conta por evento, isto é, "entrou na etapa no período", pelo ator Matheus, e a conversão é uma
"passagem" (`src/lib/monetizacao/model.ts:724-830` `funil()`, `:424-481` `operacao()`). Em setembro isso mostra 33
reuniões realizadas e 40 oportunidades validadas, com contagens que não descem. Depois da edição do pipe em 01/10, as
etapas novas (Conexão e Reunião de proposta) aparecem com zero no meio do funil de setembro, e a Gatilho encerrada
fica entre Conexão e Levantamento agendado.

O Pedro reprovou essa leitura em 30/09: "De 103 pra 45 não dá 24%. Como ele fez 33 reuniões e validou 39?".

## Régua cumulativa (a única régua da Operação depois desta mudança)

A referência é `monetizacao/base/medir_funil_cumulativo.mjs`, no repo `monetizacao`, generalizada para o pipe de
01/10. A versão que já lê as etapas por nome e ordem está em
`/private/tmp/claude-502/-Users-pluca-Desktop-AI-Projects/ed0b4b56-83da-4dec-a98c-8d1b1c532527/scratchpad/f03/f03_medir.mjs`,
na seção "níveis lidos do pipe" e na função de nível. Porte essa lógica para TypeScript puro.

- **Níveis lidos do pipe, por nome e pela ordem em tempo de execução** (`data.stages`, campo `order`). Não fixe ids nem
  ordem no código. A frente 01 vai reordenar o pipe hoje e pôr Reunião de proposta antes de Em negociação.
  - Base elegível (`/base/i`) = nível 0, a fila.
  - As etapas que não são Base, Gatilho nem Stand by viram os níveis 1, 2, 3… na ordem do pipe. Hoje são: Abordagem
    iniciada, Conexão, Reunião de levantamento agendada, Reunião de levantamento realizada, Em negociação, Reunião de
    proposta e Proposta enviada.
  - Gatilho (`/gatilho/i`, encerrada) = o nível da Conexão: setembro usa o Gatilho como referência da Conexão.
  - Stand by (`/stand ?by/i`) = o nível da Reunião de levantamento realizada.
  - Ganho no período = nível acima de todos.
- **Coorte do período** = cards com evento `started` no período (`events.started`), saídos da fila, filtrados pelo
  dono e pelo produto do filtro da tela.
- **Nível de cada card** = a etapa mais adiantada alcançada no período, depois do primeiro `started` do período. Uma
  etapa conta como alcançada se o card ficou nela 30 minutos ou mais, avançou a partir dela ou terminou nela. Um toque
  desfeito em minutos não conta.
- **Contagem da etapa** = cards da coorte com nível maior ou igual ao dela.
- **Fila** = cards que estiveram na Base elegível em algum momento do período: já estavam lá no início ou entraram no
  período. O script de referência compara datas como texto em `naFila`, na linha 50; compare por instante (`Date.parse`).
- **Taxa** = contagem da etapa ÷ contagem da etapa de cima. As contagens só descem, e todas são inteiras.
- **Datas no fuso de São Paulo.**

### O que precisa bater (teste obrigatório)

Para setembro (01–30/09/2026, total, todos os produtos), com a carga real do Brain, os números são:
- Fila 313;
- Abordados 155;
- Conexão (Gatilho) 84;
- Levantamento agendado 49;
- Levantamento realizado 41;
- Em negociação 36;
- Reunião de proposta 25 (cumulativa: quem passou dela);
- Proposta enviada 25;
- Ganho 4.

Por produto, sem a fila:
- Cella: 67, 41, 30, 27, 26, 24, 24, 4;
- Finance: 68, 31, 19, 14, 10, 1, 1, 0;
- Consultoria: 20, 12, 0, 0, 0, 0, 0, 0.

A fila por produto mudou desde 01/10 de manhã porque houve trocas de produto. Não fixe esses três valores no teste;
compare-os com o script de referência rodado na mesma carga. Para outubro, até a carga das 17h25 de 01/10, o total dava
25 abordados → 6 Conexão → 5 levantamentos agendados. Os números mudam com a carga: confira contra o script na mesma
carga.

Escreva `scripts/monetizacao/conferir-funil-cumulativo.mjs`. Ele carrega a base real como
`scripts/cockpit-ceo/carga-real.mjs` faz e roda a função nova da `src/lib/monetizacao`, com
`node --experimental-strip-types` (Node 22). Depois compara com uma reimplementação independente da regra, ou com o
JSON do script de referência rodado na mesma carga. Ele precisa conferir:
- as contagens de setembro acima;
- que as contagens só descem;
- que validadas ≤ realizadas;
- que tudo é inteiro.

Se alguma checagem falhar, ele sai com código diferente de zero. As credenciais vêm do ambiente; não grave token em
arquivo.

## Mudanças na aba Operação (`src/components/monetizacao/operacao.tsx`, `dashboard.tsx`)

1. **O funil do mês** (`FunilOperacao`), **"Qual produto avança na base?"** (`PorProduto`) e **o lado a lado por produto**
   (`FunilLadoALado`) passam a usar a régua cumulativa. Saem as colunas "entraram" e a "passagem".
   - Cada linha mostra a contagem e a taxa sobre a linha de cima.
   - "Hoje na etapa" (o estoque atual) pode ficar como informação ao lado, sem entrar na taxa.
   - O texto "Como contamos" é reescrito para a régua nova, em uma frase por regra.
2. **Os quadros de meta** (`MetasFarmer`: trabalhados, marcadas, realizadas, validadas e ganhos) passam a contar pela
   mesma coorte. Assim validadas nunca passam de realizadas.
   - O ritmo por dia útil continua: abordados ÷ dias úteis.
   - Os dias úteis passam a excluir os feriados nacionais.
3. **Dias úteis com feriado.**
   - `uteis()` em `model.ts` passa a pular os feriados nacionais de 2026 e 2027, numa lista num lugar só (por exemplo,
     `src/lib/monetizacao/feriados.ts`).
   - Feriados nacionais de 2026: 01/01, 16/02, 17/02, 03/04, 21/04, 01/05, 04/06, 07/09, 12/10, 02/11, 15/11, 20/11 e
     25/12. Carnaval e Corpus Christi são pontos facultativos de uso geral; inclua-os e diga isso num comentário.
   - Feriados de 2027: 01/01, 08/02, 09/02, 26/03, 21/04, 01/05, 27/05, 07/09, 12/10, 02/11, 15/11, 20/11 e 25/12.

## Visão "Hoje" (nova seção, a primeira da aba Operação quando o período inclui hoje)

A pergunta da página é "O mês vai chegar a 50% de marcação?". O universo vem do filtro da tela: dono e produto. Siga
o mockup aprovado e `docs/design/ARQUETIPOS.md` (Visão geral): `PageHeader` ou título de seção com pergunta e universo,
`KpiCard` com meta, "O que pede atenção" com no máximo 3 itens em caixa com borda, uma linha por item, e nada de
tabela linha a linha na abertura. A lista de atenção abre num `Sheet` ou numa seção recolhida, como Fila de trabalho.

1. **Hoje e ontem (eventos do dia, fuso de São Paulo).**
   - Os indicadores são abordagens (`started`), conexões (entradas na etapa Conexão), levantamentos agendados,
     levantamentos realizados (`meeting`) e reuniões de proposta. Cada um mostra o número de hoje, o de ontem entre
     parênteses e a quebra por produto.
   - Movimento feito pelo usuário de integração "Ops Planning" (id 23984402) não conta como abordagem.
   - Toque desfeito em menos de 30 minutos não conta.
   - Uma linha de procedência diz que são eventos do dia, de qualquer mês de abordagem.
2. **Mês até hoje (coorte cumulativa).** São quatro `KpiCard`, sem casa decimal nas contagens:
   - **Conexão**: Conexão ÷ abordados, alvo de 70%;
   - **Levantamento**: agendados ÷ Conexão, alvo de 72%;
   - **Marcação**: agendados ÷ abordados, meta de 50%;
   - **Faltam para 50%**: `max(0, ceil(0,5 × abordados) − agendados)`, um inteiro.

   Os alvos ficam em constantes num lugar só, com o comentário "DEFINIDO pelo Pedro em 01/10/2026". Uma nota diz que a
   abordagem de hoje ainda não teve tempo de resposta.
3. **Conexão por unidade.** Uma barra por unidade com "n de N" (Conexão de N abordados no mês) e o traço do alvo de 70%.
   - A unidade vem de `ops.monetizacao_deals.unidade_ids`, que a carga já preenche. Hoje o app só lê `id,payload` em
     `functions.ts:73`; acrescente `unidade_ids` e cruze com `monetizacao_unidades` (`unidade_id`, `nome`).
   - Card sem unidade entra como "Sem unidade".
   - Não infira a unidade pelo dono do card.
4. **Estoque e ritmo.**
   - Cards abertos na Base elegível, com a quebra por produto.
   - Dias úteis restantes no mês, contando hoje.
   - Abordagens por dia útil necessárias para a meta de abordagens do mês: a do plano do mês, se existir no
     `monetizacao_planos`, ou senão 120 por closer.
   - Se abordados + Base < meta, diga quantas contas faltam.
5. **O que pede atenção** (até 3 itens, com botão de destino):
   - abordados há 3 dias úteis ou mais sem Conexão, quantos são e quantos passam de 10. O botão abre a lista;
   - a Base não cobre a meta de abordagens, quando for o caso;
   - "Três produtos ainda não se mede": o campo de produto do card aceita um só. Esse item é fixo até a frente 01 mudar
     o campo.
6. **Lista de atenção** (Fila de trabalho num `Sheet`):
   - Entram os cards abertos cuja etapa atual é a Abordagem iniciada, que nunca chegaram ao nível da Conexão e cujo
     primeiro `started` foi há 3 dias úteis ou mais.
   - Colunas: empresa (link para o card no Pipedrive), produto, unidade, sócios da unidade (todos, por decisão do
     Pedro em 01/10: não há sócio de referência), abordado em e dias úteis.
   - Ordenada por dias úteis, do maior para o menor.
   - Os sócios vêm da tabela `socios` (veja como `src/components/page-content/rede-content.tsx:177` e
     `src/lib/admin-users.functions.ts:140` a leem). Se o usuário não tiver permissão de ler, mostre "sem acesso aos
     sócios" e não quebre a tela.
   - Unidade sem sócio cadastrado aparece como "sem sócio cadastrado".
   - Tem filtro "10 dias úteis ou mais" / "3 a 9" e exportação CSV pelo `downloadCsv` que a aba já usa.

## Regras de construção

- Leia `docs/design/README.md`, `DESIGN.md`, `ARQUETIPOS.md` e `CONTRATO-DE-TELA.md` antes de mexer na tela. Use os
  componentes de `src/components/planning` (KpiCard, StatusBadge e os demais) e os tokens. `npm run design:lint` tem de
  passar sem aumentar a catraca.
- `npx tsc --noEmit` (ou o equivalente do repo), `npm run lint` nos arquivos tocados e
  `NODE_OPTIONS=--max-old-space-size=8192 npm run build` têm de passar.
- Ausência não é zero: carregando, vazio e sem permissão têm aparência diferente de 0.
- Contagens sempre inteiras.
- Nada de mudar a Edge Function `monetizacao-crm` nem migrations: tudo isto é leitura do que já existe. Se faltar
  permissão de leitura de `unidade_ids` ou de `socios`, pare e relate; não crie policy.
- Commits pequenos na branch `feat/monetizacao-acompanhamento-20261001`, com mensagem em português e o trailer
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Sem push.
- Acrescente uma entrada no fim de `DECISIONS.md`, com a data, o que mudou e por quê, como as entradas anteriores
  fazem.
