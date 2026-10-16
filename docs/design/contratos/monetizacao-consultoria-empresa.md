# Contrato · Consultoria › Buscar empresa (`/monetizacao?aba=handoff-consultoria&visao=empresa`)

**Dono de produto:** Pedro Luca   **Dono do código:** Victor Eliezek (repo) · Pedro Luca (tela)   **Data:** 06/10/2026

Estado: **pedido do dono em 06/10/2026**: "Eu quero uma ferramenta de pesquisa na tela da consultoria pra poder
pesquisar CNPJ ou nome e ver o estado da empresa ali na consultoria". Terceira aba da tela **Consultoria**, ao lado de
"Handoff e repasse" e "Cruzamento com a call" (`consultoria.tsx`). A moldura comum (cabeçalho, estados, permissões)
segue `monetizacao.md`.

## Propósito
- **Pergunta (h1):** Qual é o estado desta empresa na Consultoria?
- **Público:** Pedro (dono), CEO, Pedro Siqueira (Consultoria), quem cobra o handoff.
- **Decisão ou ação que provoca:** responder na hora "essa empresa chegou? está parada em quê? já recuperou? a PAT
  faturou?", sem abrir a plataforma do Siqueira, o Pipefy e o Financeiro.
- **Métrica de sucesso:** com o nome ou o CNPJ, o dono chega à ficha em uma busca e um clique.
- **Arquétipo:** Ficha, com a busca à esquerda como porta de entrada. Lacuna registrada: a busca e a ficha dividem a
  tela (no celular, uma embaixo da outra) em vez de a ficha abrir a partir de uma Lista própria. É uma ficha por vez,
  aberta pela URL (`empresa`).
- **Universo (descrição):** empresas na plataforma da Consultoria (API do Pedro Siqueira, cópia de hora em hora) ·
  cards do onboarding (Pipefy) · negócios ganhos em 2026 · propostas da plataforma · receita da PAT (Financial Brain).

## Réguas
- **Uma empresa = um CNPJ.** Se o CNPJ do onboarding ou do negócio não estiver na plataforma, mas a raiz (8 primeiros
  números) estiver, ele cai na ficha da empresa da plataforma (a matriz, quando ela estiver lá). É a mesma régua do
  Handoff, que dá a empresa por chegada pelo CNPJ ou pela raiz. Duas filiais que estão na plataforma ficam em fichas
  separadas, ligadas por "Mesmo grupo".
- Sem CNPJ, a ficha é do card do onboarding (`card:`), do negócio (`deal:`) ou do cliente da plataforma (`cliente:`).
- **Proposta:** casa pelo CNPJ, depois pela raiz, depois pelo nome exato da empresa.
- **PAT:** o CNPJ exato (todos os da ficha); sem nenhum, a raiz. Mês com faturado e recebido zerados não aparece.
- **Situação** (a primeira que valer, nesta ordem):
  1. Crédito recuperado: a plataforma informa crédito recuperado;
  2. Diagnóstico entregue: projeto em Pós-entrega com valor identificado (a mesma régua do cartão das 305);
  3. Esperando documentos: o projeto aberto mais recente está em Fila de Processamento ou Fluxo de Documentos;
  4. Em diagnóstico: o projeto aberto mais recente está em outra etapa;
  5. Projetos encerrados: nenhum projeto aberto;
  6. Cadastrada, sem projeto;
  7. Encaminhada, fora da plataforma: o kickoff marcou "Sim" em encaminhado e o CNPJ (nem a raiz) não está na
     plataforma;
  8. No onboarding: card do onboarding, ainda não chegou;
  9. Vendida, fora da plataforma: só o negócio ganho.
- **Busca:** CNPJ com ou sem pontuação (exato, começo ou trecho) e nome sem acento (exato, começo ou todas as
  palavras). Pelo menos 2 letras ou 3 números. A raiz do CNPJ acha o grupo inteiro. Até 30 resultados.

## Números (da ficha)
| Número | Conta | Fonte |
|---|---|---|
| Valor identificado | soma do valor identificado dos projetos | plataforma |
| Crédito recuperado | o que a plataforma informa, com aprovado e saldo | plataforma |
| Faturado pela PAT | soma do faturado, com o recebido ao lado | Financial Brain |
| Projetos | projetos da empresa, com quantos estão em aberto | plataforma |

Abaixo: projetos (etapa, desde quando, cadastro, entrega, valor), propostas, "De onde veio" (negócio no Pipedrive,
card no Pipefy, parceiro), PAT mês a mês e "Mesmo grupo".

## Estados
| Estado | Quando | Mostra |
|---|---|---|
| Carregando | primeira leitura | `Carregando variante="kpis"` |
| Sem acesso | sem `view.monetizacao` ou sem todas as unidades | `EstadoSemAcesso` |
| Busca curta | menos de 2 letras ou 3 números | a dica de como buscar |
| Sem resultado | nada casa | "Nenhuma empresa com … na plataforma, no onboarding nem nos negócios de 2026" |
| Nenhuma aberta | busca sem clique | `EstadoVazio` "Escolha uma empresa" |
| Financeiro fechado | sem a porta do Financeiro | "PAT mês a mês" em `EstadoSemAcesso`, o resto segue |
| Erro | RPC falhou | `EstadoErro` com a fonte |

## Filtros na URL (N7)
| Parâmetro | Valores | Padrão | Afeta |
|---|---|---|---|
| `visao` | empresa | — (Handoff e repasse) | qual aba da tela Consultoria está aberta |
| `q` | texto | — | a busca |
| `empresa` | CNPJ (11 ou 14 números), `card:`, `deal:` ou `cliente:` | — | a ficha aberta. O CNPJ de uma filial abre a ficha em que ela caiu |

## Permissões (N8)
As mesmas das outras duas abas: `view.monetizacao` **e** escopo de todas as unidades. A PAT exige também a porta do
Financeiro. A aba lê os dois RPCs que já existem (`ops.cruzamento_consultoria_painel()` e
`ops.handoff_consultoria_painel()`); a migration `20261006200000` só acrescenta ao primeiro a UF, o município, o CNAE,
a situação na Receita e o crédito aprovado, o saldo e a última recuperação, que já vinham na cópia da API.

## Ficha completa da plataforma (16/10/2026)

**Pedido do dono em 16/10/2026:** "Eu quero basicamente puxar todas as infos do cliente que eu pesquiso sem precisar
entrar na plataforma do Pedro. Garanta isso." Decisões do dono no mesmo dia: login técnico só de leitura na
plataforma e publicação direta depois de conferir.

**O que faltava.** A API `api-comercial` manda o cadastro, a etapa e o valor dos projetos, o crédito somado e só as
propostas em negociação. A plataforma tem mais, e nada disso aparecia: as teses uma a uma (332 empresas), os
gestores (404) e o canal (379) de cada projeto, as faturas e os recebimentos da Consultoria (132), o estoque de
crédito mês a mês (124), as propostas aceitas e perdidas (77), os follow-ups (61), o histórico de etapas, 77 projetos
sem CNPJ e 239 teses importadas sem projeto.

**Fonte nova.** `ops.consultoria_plataforma`, espelho de 23 tabelas da plataforma (Supabase do Pedro Siqueira),
lido a cada 15 min pela Edge Function `consultoria-plataforma-sync` com o login técnico
planning.brain.bot@gmail.com, papel Comercial (vê toda a PAT; não vê 4 lançamentos da PAC). A cópia da API
(`consultoria-sync`) passou de hora em hora para a cada 15 min.

**Leituras.**
- `ops.consultoria_plataforma_indice()`: o que a busca acrescenta. São os projetos sem cliente, as teses sem projeto
  (agrupadas pelo nome) e as propostas de todos os status.
- `ops.consultoria_empresa_ficha(cliente_ids, cnpjs, nomes)`: tudo da empresa aberta. Mesma porta das outras abas
  (`view.monetizacao` e todas as unidades). Faturas e recebimentos da Consultoria só com a porta do Financeiro.

**Réguas novas.**
- **Busca.** Proposta casa pelo cliente da plataforma; sem ele, pelo CNPJ, pela raiz e pelo nome. Se não casar,
  vira uma ficha própria (`empresa=proposta:<nome>`). Projeto sem cliente e tese sem projeto casam pelo nome
  normalizado (sem acento nem pontuação) com uma ficha que já existe; se não casarem, viram
  `projeto:<nome>` e `tese:<nome>`.
- **Situação.** Duas situações novas antes de "Encaminhada, fora da plataforma":
  - "Projeto sem CNPJ": um projeto da plataforma sem cliente casou pelo nome;
  - "Proposta da Consultoria" e "Teses sem projeto": só a proposta ou só as teses.
- **Ficha.** Projeto sem cliente e sem CNPJ entra na ficha cujo nome (razão ou fantasia) é igual ao nome ou ao
  apelido dele. Exemplo: o projeto "YELLOT" cai na Bouhid Brasil Engenharia, de fantasia Yellot. Estoque entra pelo
  cliente, pelo CNPJ ou pelo projeto. Fatura e recebimento entram pelo CNPJ ou pela proposta.
- **Valor identificado.** É a soma das teses dos projetos, fora as declinadas e as baixadas. É a mesma conta da API:
  bate em 642 de 642 projetos, conferido em 16/10. Tese sem projeto aparece na ficha, mas não entra nessa soma.

**Blocos novos da ficha** (abaixo dos quatro números):
- Projetos na Consultoria: etapa, prazo na etapa contra a meta, responsável, gestores, canal, parceiro, teses e
  expectativa por área. Projeto baixado fica recolhido.
- Teses identificadas: total por status e as teses sem projeto.
- Propostas de todos os status: valor, êxito, follow-up e motivo da perda.
- Crédito em estoque: aprovado, usado, saldo, êxito e compensações mês a mês.
- Faturas e recebimentos da Consultoria: faturado, recebido, a receber e em atraso.
- Follow-ups e histórico na plataforma.

Se a leitura completa falhar, a ficha avisa e mostra só o que a API manda, como antes.

**Conferência.** `monetizacao/medicoes/2026-10-16-consultoria-ficha/conferir.py` compara, cliente a cliente, o RPC
(como o dono) com a plataforma ao vivo. Em 16/10: 713 clientes, 7.133 checagens, 0 falhas.
