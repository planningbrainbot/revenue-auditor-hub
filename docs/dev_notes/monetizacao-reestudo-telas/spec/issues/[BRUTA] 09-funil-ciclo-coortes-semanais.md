# Funil e ciclo — coortes semanais

## Contexto (1-2 frases)
Comportamento 6 do §8, Seção 5 do contrato (`MapaCalor`): as coortes mais novas avançam mais que as antigas?

## O que precisa acontecer
- Implementar `coortesSemanais(coorte)` em `model.ts`: linhas = semana de criação (segunda-feira), colunas = marco, célula = % da semana que chegou ao marco com "n de N"; marca "amadurecendo" para semana com menos de 14 dias.
- Desenhar o `MapaCalor` com a rampa sequencial `--chart-seq-1..5`.
- Célula abre quem chegou àquele marco naquela semana.

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis`.
- `03-componentes-svg-ds-grafico` (`MapaCalor`).
