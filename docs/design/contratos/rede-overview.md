# Contrato · Overview da Rede (`/rede-overview`)

**Dono de produto:** Eliezek (Rede)   **Dono do código:** Eliezek   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09: "pode seguir conforme suas propostas; depois eu mudo"). Revisão do Eliezek no PR.

Levantado em `b5c44d7` (`src/routes/_authenticated/rede-overview.tsx`, 1.476 linhas). Substitui o rascunho do `CONTRATO-DE-TELA.md` §3. **Regra de cálculo, fonte, RLS e permissão não mudam.** Marcação: **[apresentação]** e **[correção de exibição]** (defeito de tela que não muda régua).

## Propósito
- **Pergunta (N1):** "Quais unidades estão fora da curva em receita, clientes e retenção?"
- **Público:** diretoria, CS. O sócio regional não entra (a área `rede` é da matriz; DECISIONS 23/09 "Tela em duas áreas").
- **Ação:** achar a unidade ou a métrica fora da curva e abrir o detalhe na tela dona.
- **Métrica de sucesso:** a unidade que pede atenção aparece em um minuto, e todo card leva à tela que confere o número.
- **Arquétipo:** Visão geral.
- **Universo (`descricao`):** "{rede inteira | unidade} · {de}–{até} · receita pelo mês de competência; MRR e clientes são a foto de hoje e ignoram o período".

## Abas (N6, N7)
As quatro abas continuam (Visão geral · Vendas e unidades · Financeiro · Qualidade e CS), agora em `?aba=`. **[apresentação]** Transformar em páginas irmãs mexe em `areas.ts` e fica para o Eliezek.

## Números da aba Visão geral
| Número (rótulo) | Definição | Unidade | Fonte e régua | Drill-down | Bate? |
|---|---|---|---|---|---|
| Recebido no período (era "Receita Total") | Σ recebido dos meses do período; delta contra período anterior de mesma duração | R$, competência | `v_reconciliacao_mensal` (títulos RECEBIDO do Omie pelo mês de competência, DECISIONS 23/09) | Funil de Receita (`/funil-receita`) | não, e a tela avisa |
| Booking | Σ MRR novo dos contratos ganhos no período × 12 | R$ | `contratos.ganho_em` | — | — |
| Clientes ativos (empresas) | empresas franquia sem churn em `central_tratativas`; nota "de N cadastradas" | empresa | `empresas` + `central_tratativas` | Contratos e churn | não, e a tela avisa (outra régua, DECISIONS 22/09 item 4) |
| Receita média por empresa | MRR ÷ clientes ativos (empresas) | R$ | idem | — | — |
| Lifetime (ARPA ÷ churn) | ARPA × 1/churn mensal do período; subnúmeros de vida útil | R$, meses | contratos + tratativas | — | — |

- **[apresentação] N11.** "Qtd Proj. Ativos" sai: é o mesmo número de "Clientes ativos" com outro rótulo. Ficam cinco cards (N12).
- **[apresentação] N11.** "Clientes Ativos (série temporal)" conta **contratos**: o título vira "Contratos ativos por mês". "Clientes iniciaram" vira "Contratos iniciados".
- "Lifetime" declara a régua no rótulo, porque o mesmo nome existe com outras duas fórmulas (`/indicadores-trimestre` MRR × 60; `/rede-ltv` ARPA × LT).

## Números das outras abas
- **Vendas:** MRR (foto de hoje; nota "x% do recebido do mês corrente") → `/clientes?status=ATIVO` (não, e a tela avisa: lá ATIVO é "pagou em 90 dias"). Ranking de unidades (MRR Hunter), que ignora o filtro de unidade: a `descricao` da seção diz isso.
- **Financeiro:** gráfico MRR novo × royalties recebidos; tabela Resumo por unidade (foto de hoje, ignora o período: dito na seção). "Clientes" da tabela vira "Contratos ativos"; "ARPA" vira "ARPA por contrato".
- **Qualidade e CS:** Churn de receita, Churn de logo (base de todos os tempos, dito na nota), Auditoria interna (oportunidade e contingência). Churn → `/painel-cs` (não, e a tela avisa: abre sem a unidade).

## Correções de exibição (não mudam régua)
1. **Zero durante a carga e com erro.** Hoje os cards mostram R$ 0 enquanto carregam e quando uma fonte falha. Passam a `Carregando` e, com erro, `estado="indisponivel"` com a fonte que falhou.
2. **Unidade sem dado de Omie** (São Luís, Fortaleza): recebido 0 vira `nao-apurado` com nota "sem títulos do Omie no período" quando a unidade não tem nenhum título na série inteira.
3. **Churn com `tom="atencao"` fixo** sai (N9): o tom só aparece quando o dado pede, e não há régua de churn declarada nesta tela, então fica sem tom.
4. **Gráfico Financeiro com três eixos Y** (V8) vira dois gráficos: "MRR novo e royalties recebidos por mês" (R$, um eixo) e "MRR acumulado" (R$, um eixo).
5. **Variação do booking:** as cores das barras iteravam a série inteira, não a filtrada, e saíam desalinhadas. Corrigido.
6. Cores `hsl(...)` cruas → `CORES_SERIE`; `fontSize={11}` → `eixoProps` (V4); código morto `BookingVariacaoLabel` sai; card local de Auditoria → `KpiCard`.

## Estados
Carregando `Carregando variante="kpis"` (sem números atrás) · erro por fonte `EstadoErro` com o nome da fonte e "Tentar de novo" · vazio de gráfico `EstadoVazio` ("Sem meses no período") · sem acesso: portão da casca + `SemAcessoArea` (já existe) · royalties sem acesso: `EstadoSemAcesso oQueFalta="view.unidades_rede"` no bloco.

## Filtros na URL (N7)
`aba` (geral, vendas, financeiro, qualidade) · `unidade` · `de`, `ate` (padrão: ano corrente) · início depois do fim cai no padrão.

## O que NÃO entra
A tabela de apuração cliente a cliente (`/unidades/royalties`); NPS da Rede e NRR (removidos, DECISIONS 11/08); Carteira Saudável (saiu em 23/09).

## Para onde manda
`/funil-receita`, `/clientes?view=contratos`, `/unidades/royalties`, `/painel-cs`, `/auditoria-interna`.

## Achados para o Eliezek (não corrigidos: são permissão/RLS)
- Com `scopedToOwnUnit` e `perms.unidade` nulo, `scopeRows` devolve a rede inteira (`rede-overview.tsx:260`).
- A série de royalties casa a unidade por nome exato (`:506`); nome que não bate devolve a série da **rede**. Só a RLS de `royalties_*` protege.
- As leituras têm `limit` 2000/5000 sem aviso de corte.
