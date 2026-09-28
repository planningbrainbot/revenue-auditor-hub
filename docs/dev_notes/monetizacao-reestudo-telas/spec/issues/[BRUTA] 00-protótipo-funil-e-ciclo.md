# Protótipo · Funil e ciclo

## Contexto (1-2 frases)
Cobre a tela nova `/monetizacao?aba=funil` (spec §7, contrato `docs/design/contratos/monetizacao-funil-ciclo.md`). É o primeiro passo visual, antes de qualquer trabalho funcional ou de dado real.

## O que precisa acontecer
- Montar o layout completo da tela só com dado de exemplo: `PageHeader`, `BarraFiltros`, `KpiGrade` com 4 `KpiCard`, e as 5 `Secao` na ordem do contrato (até onde chega → quanto tempo → onde para → por que perde → está melhorando).
- Seguir o arquétipo "Lista/Relatório, variante relatório analítico" (5 seções com um gráfico cada, nenhuma tabela linha a linha na página).
- Incluir o bloco `details` "Como contamos", recolhido.
- Sem drill-down real, sem RPC, sem leitura da carga — placeholders e dado sintético bastam.
- Capturar claro e escuro para validar a hierarquia antes de começar a versão funcional.

## Dependências
- Só pode ser aberta depois do **"contrato ok" do Pedro** para `docs/design/contratos/monetizacao-funil-ciclo.md` (PROCESSO §4). Sem dependência técnica.
