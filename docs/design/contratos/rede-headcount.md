# Contrato · Headcount (`/rede-headcount`)

**Dono de produto:** sem dono nomeado (`PRODUCT.md` 5.14); Rede é do Eliezek   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Tabela, RLS e cálculo não mudam.

**Medição de 24/09:** `ops.headcount_mensal` tem **0 linhas** (DECISIONS 17/09: o lançamento é do super admin e ninguém lançou). Em produção a tela só mostra o estado vazio.

## Propósito
- **Pergunta (N1):** "Quantas pessoas cada unidade tem, e quanto o time gira?"
- **Público:** diretoria.
- **Ação:** achar a unidade com turnover alto e cobrar o sócio.
- **Arquétipo:** Lista/Relatório.
- **Universo (`descricao`):** "Unidades que lançaram headcount · {mês de referência} · pessoas, admissões e demissões lançadas à mão".

## Números
| Rótulo | Definição | Unidade |
|---|---|---|
| Headcount em {mês} | soma das unidades que lançaram o último mês; nota "{k} de {n} unidades lançaram" | pessoa |
| Turnover em {mês} | demissões ÷ headcount | % |
| Admissões em {mês} · Demissões em {mês} | soma do mês | pessoa |
| Resumo por unidade | HC, admissões, demissões, turnover **e o mês** da última linha de cada unidade | pessoa, % |
| MRR por pessoa (era "Receita / Headcount") | MRR contratado ÷ headcount | R$ |

## Correções de exibição
1. Vazio técnico ("insira registros na tabela `headcount_mensal`") → `EstadoVazio` "Nenhuma unidade lançou headcount ainda. O lançamento é feito pelo super admin." O ramo que mostrava o DDL SQL para o usuário (tabela inexistente) vira `EstadoErro`.
2. `fmtMes` com `new Date("aaaa-mm-01")` mostrava o mês anterior em São Paulo (UTC): passa a formatar a partir da string.
3. Chave do mês não casava com o `timestamptz` da view (MRR por pessoa vazio): normalizada.
4. Dois eixos Y (V8) → gráficos de um eixo; verde/vermelho pintando admissão/demissão como categoria (DESIGN §5.3) → séries `CORES_SERIE`.
5. Turnover com headcount 0 → `nao-apurado`, não 0%. Limite de 5% fixo em vermelho sai (não há régua declarada); fica o número.
6. KPIs em `Card` local → `KpiCard`.

## Estados · Filtros
DS. Filtro `mes` na URL (padrão: último mês lançado).

## O que NÃO entra
Lançamento de headcount pela tela (não existe; é decisão de produto).

## Achado para o Eliezek
RLS de leitura `using (true)`, fora das 15 tabelas com escopo de unidade; a chave `view.rede_headcount` existe e nenhuma policy a usa.
