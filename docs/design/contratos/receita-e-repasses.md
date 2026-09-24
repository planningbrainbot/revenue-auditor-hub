# Contratos · Receita e Repasses (9 telas)

**Dono de produto:** Eliezek (Receita e Repasses)   **Operação:** controladoria/matriz   **Autor:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09: "padronizar e melhorar TODAS as telas"). Um arquivo para as nove telas porque dividem réguas, moldura e defeitos; cada seção é o contrato de uma rota. Levantado em `b5c44d7`. Substitui o rascunho do `CONTRATO-DE-TELA.md` §4 (Apuração de Royalties).

**Não muda:** queries, views, RPCs, `assertAdmin`, RLS, cálculo de apuração, emissão no Omie, régua de caixa × competência (DECISIONS 20/07, 22/09, 23/09).

## Moldura comum
- `AppShell` → `PageHeader` com `pergunta`, `descricao` (universo + **régua de data**: caixa ou competência) e `procedencia`; `titulo` = rótulo do menu. Remove os `TODO(design)`.
- Mês, unidade, aba e filtros na URL (hoje em `useState`; Contas a Receber lê a URL uma vez e não grava de volta).
- Estados do DS em todas: `Carregando`, `EstadoErro` (hoje o erro é ignorado em Funil, Contas a Receber, Regras, lista de Royalties, Funil de CAC, Split, EBIT e aparece como "vazio" ou R$ 0), `EstadoVazio`, `EstadoSemAcesso` com a chave.
- `brl(undefined)` = "R$ 0" → "—" quando o valor é ausente (N4).
- Gráficos: `fontSize: 11` e `hsl(...)` do cursor → tema de gráfico (V1, V4).
- `audit/kpi-card.tsx` (adaptador local) → `KpiCard` do DS direto.
- Emoji em título de seção (🔴 ⚠ 📊 ➕) → `StatusBadge`/ícone lucide (V15).

## 1. Visão geral (`/receita-overview`)
- **Pergunta:** "O mês de repasses fechou, a fatura saiu, a unidade pagou?" (DECISIONS 22/09). Visão geral.
- Números mantidos. **N11:** "Fechada sem fatura" soma o total do repasse e "Faturado e não recebido" soma o valor da fatura do Omie (que exclui CSC fixo e tráfego): as notas dizem cada base.
- Take rate: a ajuda diz "as duas pontas por caixa", e o CSC fixo é competência; o texto passa a dizer "royalties por caixa, CSC fixo por competência". A régua fica (achado).
- "Resolver" leva a `/unidades/royalties?mes=` **com o mês do seletor** (hoje abre no mês padrão e o total não bate).
- Quem tem a área mas nenhuma das chaves: `EstadoSemAcesso` com as duas chaves (hoje erro genérico).

## 2. Funil de Receita (`/funil-receita`)
- **Pergunta:** "Onde o MRR contratado deixa de virar faturado e recebido?" Lista/Relatório.
- Abas (`funil`, `esperado`) e mês/unidades na URL.
- **N11:** "Recebido" da aba Esperado × Recebido é por **data de emissão** em `partners_financeiro` — terceira régua com o mesmo nome; rótulo "Recebido (por emissão)".
- Mês padrão: o corrente (as outras telas abrem no anterior): a `descricao` diz "mês corrente, parcial".

## 3. Contas a Receber (`/contas-receber`)
- **Pergunta:** "Quais faturas estão em atraso, e de quem cobro?" Fila de trabalho (ARQUETIPOS cita "hoje é consulta sem ação").
- Filtros e aba na URL, gravando de volta. Sem filtro, os cards somam **todo o histórico**: a `descricao` diz isso.
- **[fluxo]** Ordem padrão da aba Faturas: em atraso primeiro, mais antigas no topo; linha abre o cliente (`/clientes`) como próxima ação. Não há ação de cobrança no Ops (não inventada).
- "Em atraso" tem outro universo que o da Visão geral: rótulo "Em atraso (filtro)".
- Tabela virtualizada ou paginada na tela (hoje renderiza ~29 mil linhas).

## 4. Regras da Rede (`/unidades`)
- **Pergunta:** "Qual é a regra de repasse de cada unidade?" Configuração (só leitura).
- "Mídia mensal (ativas)" soma inclusive onde "mídia = CAC": nota diz isso. Busca e status na URL.
- Colunas que faltam (`cac_desde`, piso do CAC, `split_ativo_desde`): fora; é dado novo na tela, fica para o dono.

## 5. Apuração de Royalties (`/unidades/royalties`) e ficha (`/royalties/$unidadeId/$mes`)
- **Pergunta (lista):** "Qual unidade ainda não fechou, faturou ou pagou o repasse deste mês?" Lista com próxima ação por linha (já existe: Iniciar/Continuar/Ver).
- **Pergunta (ficha):** "A apuração desta unidade neste mês está pronta para fechar e faturar?" Ficha.
- Lista: mês na URL; a seta para frente para no mês corrente (como na Visão geral); depois de emitir faturas, a lista se atualiza (invalida a consulta; hoje a coluna "Fatura no Omie" fica velha); botão "Emitir" desabilitado diz o motivo.
- **N11:** na lista o CSC é `fixo ?? base antiga` e na Visão geral é a soma: rótulo "CSC (fixo ou base antiga)" e achado abaixo. "Mídia" na lista = "Tráfego pago" na ficha: um nome só, "Mídia (tráfego pago)".
- Ficha:
  - `PageHeader` com o nome da unidade e o mês, `StatusBadge` do estado da apuração, uma ação `default` por estado (Fechar ou Emitir); trilha "Receita e Repasses › Apuração de Royalties › {unidade} · {mês}" e botão de volta **com o mês** (hoje volta sem o mês).
  - `confirm()` nativo em Fechar, Reabrir, Mover para Base Antiga e Cobrar royalties → `AlertDialog` com o efeito. Excluir item manual (hoje sem confirmação) → `AlertDialog`.
  - A seta "›" para no mês corrente: abrir a ficha **cria a apuração no banco**, e hoje navegar para meses futuros cria apurações vazias.
  - Reabrir apuração já faturada: o `AlertDialog` avisa "a fatura já saiu no Omie; reabrir não cancela a fatura" (a regra do servidor não muda).
  - Fechar em mês em andamento: o `AlertDialog` avisa "o mês ainda não terminou".
  - Os sete "Carregando…" soltos → `Carregando variante="pagina"`; `indigo`/`purple` → `StatusBadge`.

## 6. Funil de CAC (`/unidades/funil-cac`)
- **Pergunta:** "Quanto de CAC a rede já cobrou, e quanto falta cobrar?" Lista/Relatório.
- **N11:** "Já cobrado" = "Recebido:" e "A cobrar" = "Falta receber:" na mesma tela; um nome só para cada ("Cobrado", "A cobrar"). "Recebido" do funil exclui card em outra unidade: rótulo "Cobrado (unidade do card)".
- Período fixo desde 01/02/2026 (na view): dito na `descricao`. Filtros na URL. Erro do resumo → `EstadoErro`.

## 7. Split do Asaas (`/unidades/split`)
- **Pergunta:** "Quanto de royalty o Asaas reteve e creditou?" Lista.
- Erro de `v_split_resumo` deixava os cards em R$ 0,00: `indisponivel`. Filtros na URL.

## 8. Apuração de Comissões (`/comissoes`)
- **Pergunta:** "Quais vendas já pagaram e têm closer e SDR para comissionar?" Lista.
- Título único "Apuração de comissões" (menu, cabeçalho; o `h2` repetido sai).
- `<select>`/`<input>` nativos → `Select`/`Input`; filtros na URL.
- **Aviso na tela (N2):** enquanto o defeito de dado abaixo não for corrigido, a `procedencia` diz "os recebimentos são lidos em até 1.000 títulos; 'Sem pagamento' pode estar errado". É o "não, e a tela avisa".

## 9. EBIT Operacional (`/ebit-operacional`)
- **Pergunta:** "O que foi vendido cobre o custo operacional do mês?" Visão geral.
- Custo 0 por falta de dado aparecia como "EBIT zerado" em verde: `nao-apurado` com a nota "sem custo lançado para {mês}". Erros → `EstadoErro`.

## Defeitos de dado encontrados (não corrigidos: são query/cálculo; PR separado para o Eliezek)
1. **Comissões e aba Mensalidades de Contas a Receber:** o `DataProvider` (`audit/data-context.tsx:255-276`) lê `contas_receber` com `limit(50000)`, cortado em 1.000 pelo PostgREST: "Sem recebimento" falso.
2. **Contas a Receber:** paginação ordenada por `data_vencimento` (repete) pula e duplica linhas entre páginas (DECISIONS 22/09 proíbe; ordenar por `id` como desempate).
3. **Ficha de royalties:** abrir cria apuração (`getOrCreate` + `gerarItens` no `useEffect`); reabrir não confere fatura emitida; fechar é permitido em mês em andamento. A tela agora avisa; a trava é do servidor.
4. **CSC:** lista usa `fixo ?? base antiga`, Visão geral soma os dois; e a ficha recalcula o CSC pela regra atual da unidade, enquanto `fecharApuracao` grava pelo campo da apuração.
5. **Geração de itens** lê `contas_receber`, `omie_clientes_cadastro` e `central_tratativas` sem `range` (corte de 1.000).
6. **Meus Royalties** (Minha Unidade) mostra o previsto do `billing_esperado`, não a apuração que a matriz fatura.
7. `partners_financeiro` com `.limit(20000)` na aba Esperado × Recebido (corte de 1.000).
8. `carregarReceitaRepasses` preenche zeros em meses sem dado (repasse e receita): a tela não distingue zero de ausência. A Visão geral contorna na exibição (repasse sem apuração aberta e receita com os cinco campos zerados viram "não apurado"); a correção é o servidor devolver ausência.
