# Contrato · Indicadores do Trimestre (`/indicadores-trimestre`)

**Dono de produto:** Eliezek (Rede)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Revisão do Eliezek no PR. Régua, RPC `indicadores_trimestre` e permissões não mudam.

## Propósito
- **Pergunta (N1):** "Como cada unidade fechou o trimestre, em finanças e em vendas?"
- **Público:** diretoria e Expansão (substitui os dois slides do deck, DECISIONS 25/08).
- **Ação:** conferir os dois blocos da unidade e comparar com a rede quando houver `view.network.benchmarks`.
- **Arquétipo:** Visão geral de uma unidade + Lista (comparativo).
- **Universo (`descricao`):** "{unidade} · {trimestre} · faturamento e take rate da apuração de royalties confirmada; vendas pelos contratos ganhos no trimestre".

## Números (card = linha do comparativo, com o mesmo rótulo — N11)
| Rótulo único | Definição | Unidade | Fonte |
|---|---|---|---|
| Faturamento da base nova | Σ receita_base das apurações confirmadas | R$ caixa | `royalties_apuracao` |
| Inadimplência | ATRASADO ÷ não cancelado, por vencimento no trimestre | % | `contas_receber` |
| Royalties + CSC | Σ royalties + CSC | R$ | apuração |
| Take rate da unidade (era "Take rate da rede") | royalties + CSC ÷ base nova | % | apuração |
| Receita anualizada | MRR vendido × 12 | R$ | `contratos.ganho_em` |
| Receita bookada (MRR × 60) (era "Receita bookada (LTV)") | MRR vendido × 60 | R$ | idem |
| Novos contratos | contratos ganhos | contrato | idem |
| Ticket médio mensal | MRR ÷ novos | R$ | idem |
| MRR vendido no trimestre (era "Receita recorrente") | Σ MRR dos ganhos | R$ | idem |
| ROAS | valor 12m ÷ mídia da apuração | x | contratos + apuração |
| Churn de clientes · Churn de receita | Omie quando a unidade tem, senão Tratativas; a nota diz qual régua valeu | cliente/card, R$ | Omie ou Pipefy |
| Estoque em aberto · > 1 ano | Σ ATRASADO hoje, sem corte de período | R$, % | `contas_receber` |

Drill-down: nenhum hoje; fica "—" no contrato (a RPC não devolve linhas). **[apresentação]** Os blocos usam `KpiGrade`/`KpiCard` com `procedencia` ("Apuração confirmada" ou "Contratos") em cada card.

## Correções de exibição
1. Erro e vazio **não escondem o seletor de trimestre** (hoje a pessoa fica presa no trimestre sem dado).
2. Sem `view.indicadores_trimestre` → `EstadoSemAcesso` (hoje aparece como "sem dados", porque a RPC devolve zero linhas).
3. "Sem investimento de mídia registrado" só aparece quando há apuração confirmada; sem apuração, o ROAS fica `nao-apurado` com essa nota.
4. Unidade padrão: a do usuário quando ele é de uma unidade; senão a primeira.
5. `<select>` e botões crus → `Select`/`Button`; avisos em card âmbar → `Procedencia`/nota do card (N9); `h2` em caixa alta → `Secao` com pergunta.

## Estados
Carregando `Carregando variante="kpis"` sem apagar o seletor · erro `EstadoErro` (fonte: RPC `indicadores_trimestre`) · vazio `EstadoVazio` "Sem apuração confirmada neste trimestre" · sem acesso `EstadoSemAcesso oQueFalta="view.indicadores_trimestre"`.

## Filtros na URL
`trimestre` (aaaa-Tn, padrão o anterior ao corrente) · `unidade` · `comparativo` (aberto/fechado).

## O que NÃO entra
Série histórica (Overview da Rede); churn pela régua do IDU (só Tratativas).

## Achado para o Eliezek (não corrigido: permissão)
A RPC é `SECURITY DEFINER` e devolve as 8 regionais a quem tem `view.indicadores_trimestre`; o "comparativo fechado" esconde só a tabela, e os botões de unidade mostram os 12 cards de qualquer unidade. Se a regra for "sócio vê só a sua", o recorte precisa estar na RPC.
