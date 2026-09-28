# Contrato · Projetado × realizado (`/monetizacao?aba=forecast`)

**Dono de produto:** Pedro Luca   **Dono do código:** Pedro Luca · Eliezek (merge)   **Data:** 23/09/2026
Estado: **aprovado pelas propostas** (Pedro, 24/09: "pode seguir conforme suas propostas"). Moldura comum: `monetizacao.md`.

## Propósito
- **Pergunta (N1, proposta):** "O mês está acima ou abaixo do que a planilha projetou?"
- **Público:** Pedro, diretoria.
- **Ação que provoca:** achar o degrau do funil que descolou do projetado e ajustar alocação ou hipótese em Capacidade.
- **Métrica de sucesso:** diferença por degrau lida em um minuto; o modelo inteiro consultável sem abrir o Drive.
- **Arquétipo:** **Lista/Relatório** (comparação com plano + grade do modelo).
- **Universo (`descricao`):** "Toda a frente · {mês} · projetado: planilha {versão} de {data da fonte} · realizado: CRM até {corte}".
- **Fonte (28/09):** forecast v12 (`v12-2026-09-28-cella-por-faixa.xlsx`), três cenários importados como três fontes em `ops.monetizacao_forecasts` (`v12-2026-09-28` = Estimado, padrão; `-conservador`; `-otimista`). A v10 continua na tabela como histórico e aparece no seletor.

## Números
| Número | Definição | Unidade | Fonte | Drill-down | Bate? |
|---|---|---|---|---|---|
| Ofertas trabalhadas · Reuniões realizadas · Oportunidades validadas · Contratos ganhos | realizado (eventos do mês até o corte, toda a frente) com `meta` = projetado da planilha | negócio × nº da planilha | `ops.monetizacao_forecasts` (linhas 29, 35, 37, 41) × carga do CRM | detalhe do realizado; mês futuro não abre | sim |
| Contratos por mês (gráfico) | projetado × realizado, 12 meses | contratos | idem | — | — |
| Diferença para o plano mensal | realizado · projetado · diferença; mês parcial compara com a meta cheia (aviso) | negócio | idem | realizado abre o detalhe | sim |
| Produto por produto | trabalho projetado/realizado, contratos projetados/ganhos, validadas com data no mês, disponíveis agora | negócio; **conta** em "disponíveis" | planilha + CRM + Base (`oferta`, `disponibilidade`) | validadas abrem o detalhe | sim |
| Modelo completo | grade da planilha, 12 meses × blocos, com fórmula de origem no `title` | misto | planilha | — | — |

- **N11.** "Ofertas trabalhadas" é o mesmo evento que "Leads trabalhados" na Operação e "Trabalho realizado" em Capacidade. **[apresentação · aprovar o nome]** um rótulo só nas três visões. Proposta: "Leads trabalhados", que é o nome da meta no plano.
- **N11.** "Disponíveis agora" conta **conta**, não negócio, na mesma tabela de negócios: o cabeçalho da coluna passa a dizer "Contas disponíveis".
- `KpiCard.meta` com o projetado (hoje o valor é a string "real / projetado").

## Correções de apresentação (sem mudar cálculo)
- `<h2>` repetindo o título da página sai (`forecast.tsx:83`).
- Rótulo "Projetado · v10" fixo → versão da fonte (`source.version`).
- Período "Set/26 a ago/27" fixo em `forecast-model.tsx:49` → meses da fonte.
- Gráfico: `fontSize={10}` (V4) → `eixoProps`; grade e tooltip → `gradeProps`/`tooltipProps`; projetado em tracejado neutro rotulado "Meta" (DESIGN §5.2), realizado em `--chart-1`.
- Cabeçalho do bloco sem `backdrop-blur` (DESIGN §1: sem vidro).

## Zeros (N4)
- **[lógica · aprovar] Z4.** "Disponíveis agora" dá 0 quando a Base não carregou ou quando o usuário não tem escopo geral. Proposta: base vazia → "—" com motivo no `title`.
- Sem forecast importado ou sem escopo geral: `EstadoVazio` com o motivo (texto atual).

## Ações
Planilha no Drive (link externo) · Exportar valores (CSV) · filtro de blocos e "Só totais" **[apresentação]** para a URL (`blocos`, `totais`).
- **Cenário (28/09, Pedro: "seletor de cenário se couber sem redesenhar a tela ... mudança de UI mínima"):** um `select` a mais na barra de filtros, antes do mês. Lista versão e cenário (`opcoesDoForecast`); o padrão é o cenário marcado `default` da versão mais recente (`escolherForecast`) e não vai para a URL; a escolha vai para `cenario` (id da fonte). Id desconhecido cai no padrão. O cabeçalho usa a mesma fonte.
- **Bloco "Cella · parceria"** (linhas 69–72 da v12): honorários da parceria assinados e recuperação estimada para os clientes. Só aparece quando a fonte tem essas linhas (a v10 não tem).

## O que NÃO entra
Previsão operacional a partir do mix da planilha: o forecast é referência de plano, não previsão do CRM (DECISIONS 15/09; vale para a v12). Caixa por ano além da janela de 12 meses (o êxito da Cella cai em 2028–2029): fica no Resumo da planilha, não na tela. Filtro de responsável e produto (a comparação é da frente inteira, de propósito).

## Para onde manda
Ajustar alocação e hipóteses → Capacidade e alocação (link já existe).
