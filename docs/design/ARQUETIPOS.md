# ARQUETIPOS.md · Os cinco tipos de página do Brain

Toda tela nova ou alterada declara um arquétipo no seu contrato (`CONTRATO-DE-TELA.md`). O arquétipo fixa a anatomia, os componentes e as regras que mais pesam; a tela só escolhe o conteúdo. Fonte: spec §2.7; vocabulário adaptado dos floorplans do SAP Fiori (Overview Page, Worklist, List Report, Object Page) e dos padrões do Primer, conforme `diagnostico/pesquisa-referencias.md` §3.

Os cinco estão montados com dado sintético em `/vitrine#arquetipos` (T5). Quando houver dúvida de forma, a vitrine é a referência visual; este arquivo é a regra. **Os números dos wireframes são ilustrativos**, não medição.

| Arquétipo | Pergunta típica | Verbo da pessoa | Nexo |
|---|---|---|---|
| Visão geral | "Como estamos e o que pede atenção?" | entender, decidir para onde ir | manda para Lista, Fila ou Ficha |
| Fila de trabalho | "Quem eu trabalho agora e o que faço?" | agir, registrar | abre Ficha em `Sheet` |
| Lista/Relatório | "Quais registros atendem a este recorte?" | explorar, comparar, exportar | abre Ficha |
| Ficha | "Qual é a situação deste objeto?" | conferir, corrigir, fechar | volta à lista de origem |
| Configuração | "Quem vê o quê, com qual regra?" | configurar, conceder | nenhum drill-down de negócio |

Regra de escolha: se a tela tem próxima ação por linha, é **Fila**. Se agrega várias fontes e manda para outras telas, é **Visão geral**. Se é um objeto só, é **Ficha**. Se muda regra ou acesso, é **Configuração**. O resto é **Lista/Relatório**. Tela que parece ser dois arquétipos são duas telas (N6).

---

## 1. Visão geral

**Quando usar:** porta de uma área ou do produto. Agrega, compara com plano, aponta a pendência e manda para a tela dona. Não executa nada (N10).

**Pergunta típica:** "O mês de repasses fechou, a fatura saiu, a unidade pagou?" (Receita, DECISIONS 22/09).

**Anatomia, em ordem:**
1. `PageHeader` com pergunta, universo medido, `procedencia` e `filtros` (período, unidade).
2. `KpiGrade` com até 6 `KpiCard`, cada um com `meta` quando existir e `abrir` para a tela dona.
3. "O que pede atenção": até 3 pendências ou decisões, cada uma com botão de destino.
4. Uma ou duas `Secao` com gráfico de evolução ou comparação entre unidades, cada uma com "Ver detalhe" para a tela dona.
5. Nada de tabela linha a linha.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ◯ RECEITA E REPASSES ▍                           Fonte · atualizado em │
│ O mês de repasses fechou, a fatura saiu, a unidade pagou?              │
│ 11 unidades · ago/2026 · valores em R$, régua de caixa                 │
│ [Período ▾] [Unidade ▾]                                                │
├──────────┬──────────┬──────────┬──────────┬──────────┬────────────────┤
│ ROYALTIES│ TAKE RATE│ FATURADO │ RECEBIDO │ ...      │   (≤ 6 cards)  │
│ 245.100  │ 15,5 %   │ 7 de 11  │ 5 de 7   │          │                │
│ ▟ +4 %   │ meta 16 %│ ⚠ 4 sem  │          │          │                │
├──────────┴──────────┴──────────┴──────────┴──────────┴────────────────┤
│ O que pede atenção                                                    │
│  ⬣ Fechada sem fatura · 4 unidades · R$ 96 mil      [Abrir apuração →]│
│  ⚠ Faturado e não recebido · 2 · R$ 78 mil          [Abrir cobrança →]│
├───────────────────────────────────────────────────────────────────────┤
│ Como o repasse evoluiu nos últimos 12 meses?          [Ver detalhe →] │
│  ▇▇▆▇█▇▇█▇██▇  (≤3 séries empilhadas, 1 eixo)                         │
└───────────────────────────────────────────────────────────────────────┘
```

**Componentes:** `PageHeader`, `BarraFiltros`, `KpiGrade`, `KpiCard` (com `meta`, `delta`, `abrir`, `estado`, `procedencia`), `Degrau`, `StatusBadge`, `Secao`, tema de gráfico (`CORES_SERIE`, `eixoProps`…), `Carregando variante="kpis"`, `EstadoErro`, `EstadoSemAcesso` por bloco.

**Regras que mais pesam:** N1, N2, N3, N10, N12, N13; V8, V10, V11.

**Anti-padrões:**
- Copiar a tabela da tela dona para a abertura ("terceiro painel do mesmo dado").
- Quatro abas numa Visão geral (`/rede-overview` hoje): cada aba é outra pergunta, e aba sem URL some ao recarregar.
- Dois cards com o mesmo número e rótulos diferentes (`/rede-overview`: "Qtd Proj. Ativos" e "Qtd Clientes ativos" mostram o mesmo `clientesAtivos`).
- Card clicável que leva a um destino cujo total não bate (os dois acima abrem `/clientes` sem filtro de ativo).
- Mais de um número de 36px.

**Rotas atuais que deveriam seguir:** `/rede-overview`, `/receita-overview`, `/painel-unidade`, `/indicadores-trimestre`, `/painel-cs` (hoje mistura visão e fila de tratativas), Cockpit do CEO (piloto `/piloto/cockpit-ceo`, fora desta branch). Proposta: uma Visão geral para Monetização (ver `NAVEGACAO.md` §4, proposta).

---

## 2. Fila de trabalho

**Quando usar:** a pessoa entra para trabalhar uma lista de itens, um por vez, e registra o que fez. A ordem padrão é a ordem de trabalho (N5).

**Pergunta típica:** "Quem eu ligo agora, com qual argumento, e onde parei?" (Fila Cella, `FC:1385-1442`; tela aposentada em 24/09, hoje o exemplo vivo é o Follow Day).

**Anatomia, em ordem:**
1. `PageHeader` com pergunta, universo (quem opera, cadência), `procedencia`.
2. Faixa de ritmo: 2 a 4 `KpiCard` de meta × realizado do período (KRs que se leem juntos no mesmo cartão, N13).
3. Faixa de higiene: contadores clicáveis que filtram a fila ("sem próximo passo", "passo vencido").
4. `BarraFiltros` com filtros na URL e chips removíveis.
5. Tabela ordenada por prioridade de trabalho. Cada linha: identidade, por que vale a pena, se posso, o que digo, onde parei, **próxima ação com data**, botão de ação.
6. Clique na linha abre `Sheet` lateral com a ficha resumida e o registro de ação, sem trocar de rota.
7. `Procedencia` no rodapé, visível também nos estados degradados.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ◯ MONETIZAÇÃO ▍ Fila Cella                              Sincronizado … │
│ Quem eu abordo agora na base instalada?                               │
│ 312 contas · vendedor exclusivo: Matheus · daily 13h30                │
├───────────────────────────────┬──────────────┬────────────────────────┤
│ KR1 ABORDAGENS + KR2 CONVERSÃO│ KR3 PROPOSTAS│ QUALIDADE              │
│ 23 / 40   ·  8,7 % · 2 reuniões│ 1 / 5        │ 91 %                   │
├───────────────────────────────┴──────────────┴────────────────────────┤
│ Sem próximo passo (4) · Parados 15d (7) · Passo vencido (3)           │
│ [Busca] [Curva ▾] [Segmento ▾] [Estágio ▾]   chips ×   [Limpar]       │
├──┬───────────────┬──────┬─────────┬──────────────┬────────────┬───────┤
│# │ Empresa       │ Score│ Gatilho │ Onde parei   │ Próx. ação │       │
│1 │ Agro X LTDA   │ 87   │ ECD '24 │ 2 toques     │ Ligar 24/09│[Toque]│
│2 │ …             │      │         │              │ ⚠ vencido  │[Toque]│
└──┴───────────────┴──────┴─────────┴──────────────┴────────────┴───────┘
                                        ┌──── Sheet: ficha + registrar ───┐
```

**Componentes:** `PageHeader`, `KpiCard` (com `meta`), `StatusBadge`, `BarraFiltros` + `useFiltroNaUrl`, `Table` (shadcn reestilizada), `Sheet`, `Dialog` para registrar, `AlertDialog` para destrutivo, `EstadoVazio` com `total`, `EstadoErro`, `EstadoSemAcesso`, `Carregando variante="tabela"`, `Procedencia`.

**Regras que mais pesam:** N4, N5, N7, N8, N9, N13; V6, V7, V10.

**Anti-padrões:**
- Ordenar por nome ou por data de criação.
- Linha sem próxima ação, ou próxima ação sem data.
- Ação que navega para outra rota e perde filtro e posição.
- Alarme laranja fixo no topo (N9); o motivo da degradação vai na `Procedencia`.
- Botão sem permissão escondido em vez de desabilitado com motivo (N8).
- Abas "Fila / Novos / Log / Dicionário" sem URL (`/fila-cella` hoje).

**Rotas atuais que deveriam seguir:** `/broker` (Fila de oportunidades), `/monetizacao?aba=operacao` e `?aba=follow-day`, `/nps` (execução: disparar e registrar ligação), a visão "Validar origem" de `/clientes`, tratativas de `/painel-cs`, `/contas-receber` (hoje é consulta sem ação; a spec diz "cobrar").

---

## 3. Lista/Relatório

**Quando usar:** explorar um conjunto de registros por recorte, comparar, exportar. Não há "próximo item"; a pessoa escolhe o que abrir.

**Pergunta típica:** "Quais contas da unidade são aptas a Consultoria e ainda não estão no CRM?"

**Anatomia, em ordem:**
1. `PageHeader` com pergunta, universo, `procedencia`, `acoes` (Exportar).
2. `BarraFiltros` fixa no topo, estado na URL, chips removíveis, contagem "N de M".
3. Opcional: até 4 `KpiCard` que resumem o recorte e filtram a tabela ao clicar.
4. Opcional: um gráfico que responde a pergunta do recorte.
5. Tabela com ordenação, paginação ou virtualização acima de 100 linhas, colunas numéricas à direita.
6. Linha abre a Ficha (rota própria ou `Sheet`).

```
┌───────────────────────────────────────────────────────────────────────┐
│ ◯ BASE DE CLIENTES ▍ Base de clientes          Fonte · atualizado  [⤓]│
│ Quais contas atendem a este recorte?                                  │
│ 3.219 clientes · catálogo Pipefy + Omie · unidade: conta conciliada   │
│ [Unidade ▾] [Produto ▾] [Situação ▾]  Unidade: Belém ×   312 de 3.219 │
├────────────┬────────────┬────────────┬────────────────────────────────┤
│ EMPRESAS   │ APTAS      │ NO CRM     │                                │
│ 282        │ 41         │ 12         │                                │
├────────────┴────────────┴────────────┴────────────────────────────────┤
│ Empresa ▲        │ CNPJ           │ Unidade │ Produto   │   MRR (R$) │
│ …                │                │         │ ✓ Apta    │   1.250,00 │
│                                             ‹ 1 2 3 … 13 ›            │
└───────────────────────────────────────────────────────────────────────┘
```

**Componentes:** `PageHeader`, `BarraFiltros`, `KpiGrade`/`KpiCard` (opcional), `Secao` + gráfico (opcional), `Table`, paginação, `StatusBadge`, `EstadoVazio` com `total`, `EstadoErro`, `Carregando variante="tabela"`, `Procedencia`.

**Regras que mais pesam:** N2, N3, N4, N7, N11; V4, V9.

**Anti-padrões:**
- Filtro que não vai para a URL, ou `<select>` nativo ao lado de `Select` shadcn na mesma barra.
- Lista cortada em 1.000 linhas sem aviso (PostgREST, DECISIONS 22/09).
- KPI do topo com denominador diferente da tabela (N11: "contas" × "CNPJs" × "clientes").
- Menu interno de visões que repete a lateral.

**Rotas atuais que deveriam seguir:** `/clientes` (Base, Produtos e listas, Contratos e churn), `/base-contatos`, `/idu`, `/rede-realizado`, `/rede-ltv`, `/rede-headcount`, `/funil-receita`, `/unidades/royalties` (lista do mês que abre a Ficha), `/unidades/funil-cac`, `/unidades/split`, `/comissoes`, `/ebit-operacional`, `/auditoria-interna`, `/meus-royalties`, `/atividade`, `/monetizacao?aba=temporal|forecast|capacidade|funil`.

---

## 4. Ficha

**Quando usar:** um objeto só (cliente, unidade, apuração de um mês, pessoa, negócio). A pessoa confere, corrige e fecha.

**Pergunta típica:** "A apuração de Belém em agosto está pronta para fechar e faturar?"

**Anatomia, em ordem:**
1. Trilha de volta: Área › Lista de origem › Objeto (preserva os filtros da lista).
2. `PageHeader` com o nome do objeto como `titulo`, a pergunta, `StatusBadge` do estado do objeto e `acoes` do ciclo de vida (Fechar, Reabrir, Emitir) com **uma** ação `default`.
3. Faixa de resumo: 3 a 6 `KpiCard` do objeto.
4. `Secao` por assunto (itens, pendências, histórico), cada uma com sua pergunta.
5. Navegação entre irmãos quando fizer sentido (mês anterior/seguinte, unidade anterior/seguinte).
6. `Procedencia` do objeto.

```
┌───────────────────────────────────────────────────────────────────────┐
│ Receita e Repasses › Apuração de Royalties › Belém · ago/2026   ‹ ›   │
│ A apuração de Belém em agosto está pronta para fechar?  ⓘ Em revisão  │
│                     [Gerar PDF] [Excel] [Reabrir]  [ Fechar apuração ]│
├──────────┬──────────┬──────────┬──────────────────────────────────────┤
│ BASE     │ ROYALTIES│ CONFIRM. │                                      │
│ R$ 412 m │ R$ 41 m  │ 58 / 64  │                                      │
├──────────┴──────────┴──────────┴──────────────────────────────────────┤
│ Quais itens ainda não foram conferidos?   [Pendentes (6)] [Todos]     │
│  tabela de itens com situação (Matched / Só Omie / Só no Pipedrive)   │
├───────────────────────────────────────────────────────────────────────┤
│ Fonte: royalties_itens · Omie · Pipedrive · atualizado em …           │
└───────────────────────────────────────────────────────────────────────┘
```

**Componentes:** trilha da casca (T6), `PageHeader`, `StatusBadge`, `KpiGrade`/`KpiCard`, `Secao`, `Table`, `Dialog`, `AlertDialog` (Fechar/Reabrir), `EstadoVazio`, `EstadoErro`, `Carregando variante="pagina"`, `Procedencia`.

**Regras que mais pesam:** N2, N3, N4, N8, N13; V6, V7.

**Anti-padrões:**
- Detalhe sem caminho de volta (`/royalties/$unidadeId/$mes` hoje).
- `confirm()` nativo para fechar ou reabrir (hoje em `/royalties/$unidadeId/$mes`).
- Três botões `default` competindo.
- Ficha que recalcula o total de outro jeito que a lista de origem (DECISIONS 22/09: "uma abertura que discorda da tela de detalhe destrói a confiança nas duas").

**Rotas atuais que deveriam seguir:** `/royalties/$unidadeId/$mes`, ficha da empresa (hoje `Sheet` em `/clientes`), `/reforma-tributaria` (simulação para um cliente), `/gente?tela=pdi` e `?tela=avaliacao` quando abertos para uma pessoa.

---

## 5. Configuração

**Quando usar:** mudar regra, acesso, integração ou cadastro de referência. Público pequeno (admin, controladoria).

**Pergunta típica:** "Quem vê o quê, em qual área e com qual escopo?"

**Anatomia, em ordem:**
1. `PageHeader` com o que se configura e o efeito da mudança ("Mudanças valem no próximo login").
2. Lista ou matriz do que existe, com busca.
3. Edição em `Dialog` ou `Sheet` com formulário: rótulo acima do campo, ajuda abaixo, erro no campo.
4. Confirmação de efeito antes de salvar quando a mudança alarga ou tira acesso ("3 pessoas passam a ver Receita").
5. `toast` de sucesso ou erro (exige `<Toaster/>` montado, V19) e registro em `/atividade`.

```
┌───────────────────────────────────────────────────────────────────────┐
│ ◯ ADMINISTRAÇÃO ▍ Permissões                                          │
│ Quem vê o quê, em cada área?                                          │
│ 10 papéis · 10 áreas · mudança vale no próximo login                  │
│ [Buscar papel ou área]                                   [+ Novo papel]│
├──────────────┬─────────┬─────────┬─────────┬─────────┬────────────────┤
│ Papel        │ Rede    │ Clientes│ Receita │ People  │ …              │
│ cs           │ ✓       │ ✓       │ ✓       │ —       │        [Editar]│
└──────────────┴─────────┴─────────┴─────────┴─────────┴────────────────┘
          ┌── Dialog: editar · "Isto dá Receita a 3 pessoas" · [Salvar] ─┐
```

**Componentes:** `PageHeader`, `Table`, `Dialog`/`Sheet`, formulário shadcn (`input`, `select`, `checkbox`, `switch`), `AlertDialog`, `StatusBadge`, `EstadoVazio`, `EstadoErro`, `EstadoSemAcesso`.

**Regras que mais pesam:** N8, N14; V6, V12, V19.

**Anti-padrões:**
- Salvar sem retorno visível (hoje nenhum `toast` aparece: `<Toaster/>` não está montado).
- Matriz de caixinhas sem dizer o efeito ("o que o CS enxerga?" sem resposta, DECISIONS 15/09).
- Misturar configuração com tela de trabalho no mesmo seletor de área (DECISIONS 16/09 tirou a Administração do seletor por isso).

**Rotas atuais que deveriam seguir:** `/admin/usuarios`, `/admin/niveis`, `/admin/perfis`, `/admin/permissoes`, `/admin/acessos-financeiro`, `/admin/credenciais`, `/admin/integracoes`, `/admin/validacao`, `/equipe`, `/unidades` (Regras da Rede), `/broker/admin` (Matriz), `/disparos-whatsapp` (montagem de campanha; o envio é ação com confirmação).

---

## 6. Fora dos cinco

`/inicio` (porta de entrada, catálogo de produtos), `/auth`, `/redefinir-senha`, `/trust`, 404 e erro. Têm moldura própria e não declaram arquétipo, mas seguem o `DESIGN.md` (tokens, tipografia, `lang="pt-BR"`).
