# Carga v6 — desempate de trocas simultâneas e hora de ganho/perda

## Contexto (1-2 frases)
Spec §4.3 e S1/S2 (§9). Corrige o defeito de ordenação do `crm.mjs` e passa a gravar `won_at`/`lost_at` com hora — base de dado para todo o funil e ciclo. É o primeiro passo da ordem de entrega (§11.1).

## O que precisa acontecer
- Inverter a lista do `/flow` do Pipedrive antes de ordenar por `log_time` (ou encadear `old_value → new_value` nos empates), com teste cobrindo o caso dos negócios 95211 e 95196.
- Copiar `won_time` e `lost_time` do negócio para `won_at` e `lost_at` no payload.
- Subir `metric_version` para 6 em `crm.mjs`; conferir que `index.ts` força a releitura de todos os negócios quando a versão muda (filtro `changed`).
- Adicionar `won_at` e `lost_at` opcionais em `Negocio` (`src/lib/monetizacao/types.ts`), mantendo a leitura da carga v5 (sem esses campos) funcionando.

## Dependências
- Nenhuma.
