# Previsão — Sheet "Plano do mês" e Dialog "Ver o modelo"

## Contexto (1-2 frases)
Comportamento 10 do §8 e a ação "Ver o modelo" (§6.2, linhas S e M). Migra o editor hoje em Capacidade para dentro da Previsão, sem trocar de rota.

## O que precisa acontecer
- Abrir o `Sheet` "Plano do mês" (parâmetro `?plano=1`, destino do link antigo de Capacidade) com o formulário do editor atual e o resumo "Perfil aderente · Disponível no mês · Alocação" por produto no topo.
- Salvar via RPC `monetizacao_save_plan` (sem mudança de contrato), com `AlertDialog` de confirmação de efeito quando muda meta ou alocação.
- Permissão: `view.monetizacao` + escopo de todas as unidades, conferida de novo na RPC; sem escopo geral, "Salvar plano" fica desabilitado com o motivo no tooltip.
- Aderente e disponível abrem `/clientes?view=produtos&produto=`.
- Envolver `forecast-model.tsx` num `Dialog` "Ver o modelo", com exportar CSV (já existe).

## Dependências
- `11-previsao-pagina-kpis-atencao`.
