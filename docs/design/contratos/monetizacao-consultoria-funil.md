# Contrato · Consultoria › Funil e Fila de cobrança (`/monetizacao?aba=handoff-consultoria`, visões padrão e `fila`)

**Dono de produto:** Pedro Luca   **Dono do código:** Victor Eliezek (repo) · Pedro Luca (tela)   **Data:** 16/10/2026

Estado: **pedido do dono em 16/10/2026.** Ele pediu "Pode executar os pontos e transforma a tela da consultoria pra ficar
sexy e didática a ponto do Pedro CEO entender o que ele quer e todo mundo entender". As decisões dele estão em
`monetizacao/memoria/decisoes.md`, com data de 16/10.
- O Funil vira a visão de abertura da tela Consultoria.
- A Fila de cobrança é a segunda visão.
- O "Cruzamento com a call" sai (PRD de 07/10, D3). O link antigo abre o Funil.
- Buscar empresa e Handoff e repasse continuam.

## Propósito
- **Pergunta do Funil (h1):** Do que vendemos, quanto já virou dinheiro, e onde está parado?
- **Pergunta da Fila (h1):** Quem a gente cobra hoje para o dinheiro da Consultoria sair?
- **Público:** CEO (Pedro Araújo), Paulo, Pedro Luca, Jordana (quem cobra), Pedro Siqueira.
- **Decisão que provoca:**
  - **CEO:** ver o funil do passado (call de 16/10, 7:45–10:11) e cobrar quem trava.
  - **Jordana:** cobrar o cliente com dinheiro parado e registrar o contato.
- **Métrica de sucesso:**
  - O CEO responde sozinho "dos que entraram, quantos a Consultoria auditou, quantos têm dinheiro e quanto virou
    honorário".
  - Cada empresa da fila tem contato registrado em 7 dias.
- **Arquétipos:** o Funil é Visão geral; a Fila é Fila de trabalho.

## Universo e chave
- **Universo (decisão de 16/10):**
  - os negócios ganhos em 2026 no Pipedrive (Inside Sales e Sócios), uma empresa por CNPJ e, sem CNPJ, uma por negócio;
  - mais a carteira de Goiânia: os clientes pela regra da Base. Não têm data de entrada, então entra a carteira inteira.
- **A Fila inclui também os clientes da plataforma de outras origens que têm dinheiro na mesa.**
- **Chave:** o CNPJ. Quando o contrato, a empresa, os documentos e o Pipedrive não têm CNPJ, o Brain procura em
  `ops.consultoria_negocio_cnpj` (rodada diária às 6h40):
  1. card do onboarding (cadastro da Isa);
  2. nome idêntico com uma raiz só;
  3. nome parecido (similaridade ≥ 0,70 e folga de 0,15 sobre o segundo candidato).
  - Em 16/10 a busca resolveu 141 dos 280 negócios sem CNPJ; 140 ficam "Sem CNPJ", à vista.

## Réguas
- **Nível de cada empresa:** a etapa mais adiantada a que chegou.
  1. Vendemos
  2. Sabemos o CNPJ
  3. Chegou à Consultoria (cliente na plataforma, pelo CNPJ ou pela raiz)
  4. Diagnóstico entregue
  5. Achou dinheiro (teses fora das declinadas e das baixadas)
  6. Cliente aceitou (tese "Sim" ou "Em operação", estoque de crédito ou proposta aceita)
  7. Faturamos (título no Omie da plataforma)
  8. Recebemos
- **Funil cumulativo:**
  - cada degrau conta quem chegou até ele ou além;
  - a taxa é o degrau dividido pelo de cima;
  - quem parou mais quem passou dá o degrau.
- **Por que parou** (o motivo do vazamento):
  - **Antes do CNPJ:** Sem CNPJ.
  - **Antes da Consultoria:**
    - venda recente (menos de 30 dias);
    - Lucro Real (furo do handoff);
    - Lucro Presumido;
    - Simples;
    - empresa pequena (teto de faturamento até R$ 4,8 mi);
    - regime desconhecido.
  - **Antes do diagnóstico:** esperando documentos, em diagnóstico ou sem projeto aberto.
  - **Depois do diagnóstico:** sem oportunidade.
  - **Com dinheiro sem aceite:** pela idade da entrega (menos de 30, 30 a 90, mais de 90 dias, sem data).
  - **Aceitou:** não faturamos.
  - **Faturado:** em atraso ou a vencer.
- **Dinheiro de verdade:**
  - recebido em 2026;
  - faturado em 2026 (é a meta);
  - garantido a faturar: saldo de estoque ativo × a alíquota de êxito de cada crédito, linha a linha. O painel da
    plataforma mostra R$ 25,8 mi porque usa a alíquota média simples; linha a linha são R$ 14,5 mi;
  - achado e parado: valor identificado de quem está no degrau 5.
- **Ordem da Fila:**
  1. disse sim e não faturamos;
  2. faturado em atraso;
  3. dinheiro parado há mais de 90 dias;
  4. de 30 a 90 dias;
  5. recente.
  - Dentro de cada grupo, o maior valor primeiro.
  - O último contato é o mais recente entre o registro no Brain e o follow-up escrito na plataforma.

## Estados
| Estado | Quando | Mostra |
|---|---|---|
| Carregando | primeira leitura | `Carregando` (kpis no Funil, tabela na Fila) |
| Sem acesso | sem `view.monetizacao` ou sem todas as unidades | `EstadoSemAcesso` |
| Financeiro fechado | sem a porta do Financeiro | Recebido e Faturado em "sem acesso"; o resto segue |
| Nenhuma origem | todos os filtros de origem desligados | `EstadoVazio` |
| Erro | RPC falhou | `EstadoErro` com a fonte |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `visao` | fila, empresa, handoff | — (Funil) | a visão aberta |
| `origem` | inside_sales, socios, goiania, outra (vírgula) | Funil: as três primeiras; Fila: todas | o recorte |
| `unidade` | nome da unidade | — (todas) | Funil |
| `passo` | `1`–`8` ou `<n>-<motivo>` (inclui `3-atrasado`, `5-parado`, `6-garantido`) | — | a gaveta aberta à direita do Funil |
| `grupo` | aceitou, atraso, 90, 30_90, recente | — | Fila |
| `empresa` | CNPJ, `deal:<id>`, `cliente:<id>` ou `card:<id>` | — | a ficha aberta por cima da gaveta (Funil, Handoff) ou sozinha (Fila) |

## Gaveta navegável (pedido do dono em 20/10/2026)
- **Pedido:** "quando eu clico nos indicadores, ele rola a tela pra mostrar uma lista embaixo. Quero que siga o padrão de
  abrir numa aba lateral à direita que é navegável" e que, dentro dela, o clique no cliente abra "sobreposta uma segunda
  aba que me permita retornar para a anterior sem perder o fluxo".
- **Funil:** todo número clicável abre a lista numa gaveta à direita (`Sheet`): os quatro cartões de "Dinheiro de
  verdade" (Recebido → `8`, Faturado → `7`, Garantido → `6-garantido`, Achado e parado → `5-parado`), cada degrau, cada
  motivo e cada cartão de "Onde agir agora". A lista embaixo do funil saiu.
  - O topo da gaveta soma a lista (crédito achado, aceito ou garantido, faturado e empresas). Quando a lista tem grupo na
    Fila, a gaveta oferece "Cobrar na Fila de cobrança".
  - "Achado e parado" abre as 42 empresas que ele soma (`5-parado`, quem parou no degrau 5); antes abria o degrau 5 ou
    além (151), um número diferente do cartão.
- **Ficha por cima:** a empresa clicada abre a ficha da Buscar empresa numa segunda gaveta, um pouco mais estreita, por
  cima da lista. "Voltar para…", Esc ou o clique na lista escurecida fecham só a ficha. A lista guarda a rolagem e marca
  a última empresa aberta.
- **Fila:** o nome da empresa abre a ficha na gaveta, sem trocar de aba.
- **Handoff e repasse:** a gaveta que já existia ganha o mesmo comportamento: o cliente da lista abre a ficha por cima
  (o ícone ao lado do nome continua abrindo o card no Pipefy).
- **Sem chave:** empresa sem CNPJ, sem negócio e sem cliente da plataforma (118 da carteira de Goiânia em 20/10) aparece
  sem link.

## Permissões (N8)
- **Leitura:** a mesma das outras abas, `view.monetizacao` **e** todas as unidades
  (`ops.consultoria_porta_leitura()`).
- **Faturado e recebido:** exigem a porta do Financeiro. Em 16/10 o Paulo ganhou todas as empresas no Financeiro (decisão
  do dono), pela tela Acessos do Financeiro.
- **Registro de contato:** quem passa na porta de leitura; fica `registrado_por` e `autor_nome`.

## Conferência
`monetizacao/medicoes/2026-10-16-consultoria-funil/conferir.py`. Em 16/10 passou nas 6 checagens:
- os degraus da tela batem com o recálculo em Python;
- os degraus só descem;
- cada taxa é o degrau dividido pelo de cima;
- quem parou mais quem passou dá o degrau;
- 533 de 533 negócios estão no funil;
- o faturado bate com a plataforma, empresa por empresa.
