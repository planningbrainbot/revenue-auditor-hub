# Contrato · IDU (`/idu`)

**Dono de produto:** Eliezek (Rede)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Revisão do Eliezek no PR. Método, pesos, metas, RPCs `idu_ranking`/`idu_apuracao` e RLS não mudam (DECISIONS 28/08 e 23/09).

## Propósito
- **Pergunta (N1):** "Qual unidade está abaixo do corte de 75 neste trimestre, e em qual pilar?"
- **Público:** diretoria (Rede); sócio regional pela Minha Unidade (`view.idu`, ranking aberto por decisão de 28/08).
- **Ação:** pactuar as metas do trimestre e montar o plano da unidade abaixo do corte, pelo pilar mais fraco.
- **Arquétipo:** Lista/Relatório (ranking) com a ficha da unidade na linha expandida; metas do trimestre como Configuração no topo.
- **Universo (`descricao`):** "{n} unidades · {trimestre} · nota 0–100 sobre a base efetiva de pesos; indicador sem meta ou sem dado sai do denominador".

## Números
Ranking: posição, curva (Madura/Ramp-up), IDU, faixa (`StatusBadge`: Crítico = perigo, Abaixo = atenção, Na meta = sucesso, Superação = info), % do forecast liberado, falta para 75, base efetiva, pilar mais fraco. Detalhe: indicador, pilar, peso, meta (com a origem unidade/tier/rede/fixa), realizado, atingimento, pontos. Fórmulas: `supabase/migrations/20260828120000…` e `20260923220000…` (sem mudança).

Drill-down: a linha expande o detalhe, e a soma bate com o IDU (mesma RPC). Realizado → fonte: **não, defeito aberto** (nenhum realizado abre os contratos, tratativas, NPS ou auditorias; é funcionalidade nova, fica para o Eliezek).

## Correções de exibição
1. Unidade "sem base" (IDU nulo) aparecia como **"cruzou"** o corte. Passa a "sem base".
2. "Base efetiva de 0 pontos" quando não há base → "sem base efetiva".
3. O selo "{n} indicador(es) sem meta" contava pares unidade × indicador: passa a contar indicadores, com as unidades na nota.
4. Erro ao salvar meta substituía a página inteira pelo card de erro: passa a `toast` de erro no campo, e a página fica.
5. "Voltar ao padrão" e apagar meta padrão pedem confirmação (`AlertDialog`), porque apagam valor.
6. Salvar meta da unidade dá `toast` de sucesso (hoje é silencioso; o quadro de metas padrão já dava).
7. Sem `edit.idu_metas`, o campo fica desabilitado com o motivo no tooltip.
8. Vazio e sem acesso separados: sem `view.idu` → `EstadoSemAcesso`; com acesso e sem apuração → `EstadoVazio`.
9. `<select>` cru → `Select`; `Skeleton` → `Carregando`; card vermelho → `EstadoErro`.

## Filtros na URL
`trimestre` (aaaa-Tn, padrão o último fechado) · `unidade` (linha aberta).

## Ações
Editar meta da unidade · Voltar ao padrão (confirma) · Editar meta padrão por escopo (campo vazio apaga: confirma) · Copiar metas de outro trimestre. Todas com `edit.idu_metas`. A ação principal é pactuar as metas do trimestre.

## O que NÃO entra
e-NPS (sem fonte); drill-down até a fonte de cada realizado (defeito aberto).

## Achados para o Eliezek
- `ops.idu_pode_ver()` é referenciada em `20260923220000:207` e não está definida em nenhum arquivo do repo.
- `edit.idu_metas` está em `area_chaves` da área `rede`: na prática, quem tem a área Rede edita metas, e DECISIONS 23/09 diz "admin e diretor". Confirmar.
- Churn sem card de tratativa dá 0% e pontuação cheia (decidido em 28/08; é o zero que pode ser falta de lançamento).
