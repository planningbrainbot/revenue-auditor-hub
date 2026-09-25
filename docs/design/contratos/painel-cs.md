# Contrato · CS (`/painel-cs`)

**Dono de produto:** Eliezek (NPS/CS)   **Autor do contrato:** Pedro Luca (migração DS v2)   **Data:** 24/09/2026
Estado: **aplicado pelas propostas** (Pedro, 24/09). Fontes, fórmulas, RLS e permissões não mudam. Levantado em `b5c44d7` (`painel-cs.tsx`, `painel-cs/{onboarding,tratativas}-tab.tsx`). A aba Saúde da Carteira saiu em 23/09 (DECISIONS).

## Propósito
- **Pergunta (N1):** "Quais clientes estão travados no onboarding, e quanto perdemos em churn?"
- **Público:** CS (Mônica, Thais); sócio regional pela Minha Unidade (recorte `scopedToOwnUnit`).
- **Ação:** destravar o onboarding parado há 7+ dias e ler os motivos de perda. A tratativa em si é escrita no Pipefy (não há escrita no Ops).
- **Arquétipo:** Visão geral (KPIs + gargalos) com duas abas; as tabelas de gargalo funcionam como fila de leitura.
- **Universo (`descricao`):** "Cards do Pipefy de onboarding e da Central de Tratativas · unidades da rede · {unidade}".

## Abas na URL: `?aba=onboarding|tratativas`

## Onboarding
| Número | Definição | Unidade |
|---|---|---|
| Clientes em onboarding | cards não concluídos | card |
| Onboardings concluídos | cards concluídos | card |
| Parados há 7+ dias na fase | ativos com 7+ dias na fase atual; card sem data de entrada na fase conta à parte, na nota ("{n} sem data de fase") | card |
| Tempo médio de ciclo | média de dias da criação à entrada na fase final dos concluídos; `nao-apurado` sem amostra (já é assim) | dias |
| Funil por fase | ativos por fase; fases fora da ordem conhecida entram numa barra "Outras fases" (hoje somem e o funil não fecha) | card |

## Tratativas
| Número | Definição | Unidade |
|---|---|---|
| Total · Em aberto · Perdidos · Recuperados | cards filtrados por status | card |
| MRR perdido | Σ MRR dos perdidos; nota "{n} perdidos sem MRR" quando houver | R$ |
| Taxa de recuperação | recuperados ÷ (recuperados + perdidos); **"—" sem denominador** (hoje 0%) | % |
| Taxa de churn (blended) | churnados ÷ ativos; ignora busca, status e período: a nota passa a dizer isso; "—" sem denominador | % |
| Tempo médio até churn | ganho → churn; "sem dados suficientes" (já é assim) | dias |
| Gráficos e resumo por unidade | como hoje; % de recuperação "—" sem denominador | |

## Correções de exibição
1. KPIs durante a carga mostravam 0: passam a `Carregando variante="kpis"`. Erro de leitura era engolido: passa a `EstadoErro` com a fonte.
2. "Forçar atualização" aparece para todos e o servidor exige admin: fica desabilitado com o motivo "Só admin atualiza o Pipefy" para quem não é admin (N8).
3. Status da tratativa em `StatusBadge` (aberto = info, perdido = perigo, recuperado = sucesso).
4. Gráfico do onboarding: `eixoProps`/`gradeProps` (fonte 11 → 12, V4).
5. Filtros (busca, unidade, status, churn de/até) na URL.

## O que NÃO entra
Escrever tratativa no Ops; Saúde da Carteira (saiu em 23/09).

## Para onde manda
Cards no Pipefy; contratos e churn → `/clientes?view=contratos`.
