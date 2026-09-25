# Contrato · NPS (`/nps`)

**Dono de produto:** Eliezek (NPS/CS)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Fórmulas e fontes não mudam. Levantado em `b5c44d7` (`nps.tsx`, `nps/nps-painel-tab.tsx`).

## Propósito
- **Pergunta (N1):** "O cliente recomenda a Planning, e quem está insatisfeito agora?"
- **Público:** CS; sócio pela Minha Unidade (recorte por unidade).
- **Ação:** abrir o card do detrator e tratar. O disparo e a ligação ficam em Disparos de WhatsApp.
- **Arquétipo:** Visão geral com abas (Resumo · Por unidade · Respostas).
- **Universo (`descricao`):** "Pesquisas NPS respondidas · {unidade} · {rodada} · nota 0–10, promotor 9–10, detrator 0–6".

## Números
| Número | Definição |
|---|---|
| NPS | (promotores − detratores) ÷ respondidas × 100; "—" sem resposta |
| Delta vs. mês anterior | entre os dois últimos meses com dado; suprimido com menos de 10 respondentes; a nota diz os dois meses comparados |
| Respostas | pesquisas respondidas |
| CSAT | notas ≥ 8 ÷ notas (fiscal + contábil + folha) |
| Evolução do NPS / CSAT | por mês de criação do card (a nota do gráfico diz isso) |
| NPS por unidade · detalhe | Matriz fica de fora do por unidade: a seção diz "sem a Matriz" |

## Correções de exibição
1. Filtrar por categoria mudava o próprio NPS (Promotores → 100): com filtro de categoria ativo, os cards NPS e CSAT ficam `nao-apurado` com a nota "o filtro de categoria altera o indicador; remova para ver o NPS"; a tabela continua filtrada.
2. "Detratores recentes" ordena por nota, não por data: rótulo "Detratores com a menor nota".
3. Carregando e erro apareciam sobre abas vazias: passam a `Carregando`/`EstadoErro` no lugar das abas.
4. KPIs locais ("statistics-card-7") → `KpiCard`; `opacity-90` nos cartões sai (contraste).
5. Pizza e distribuição de notas usavam cor de status como categoria (DESIGN §5.3): passam a `CORES_SERIE` com rótulo; eixo X com o mês legível ("jan/26").
6. Código morto (`taxaResposta`, `aguardando`, `semResposta`, `mediaFiscal`) sai. `colSpan` da tabela corrigido.
7. Abas e filtros (busca, unidade, segmento, categoria, fase, rodada) na URL.

## O que NÃO entra
Disparo e ligação (Disparos de WhatsApp); cobertura de contatos (Base de Contatos).

## Para onde manda
Card no Pipefy ("ver card").
