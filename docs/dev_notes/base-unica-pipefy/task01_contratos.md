# Task 01 — Contratos de domínio e inventário

Status: Contratos implementados; decisões Pipedrive/Curitiba explicitamente pendentes.

## Objetivo
Transformar as atividades do print em regras executáveis antes das mutações. Mapear as tabelas e produtores existentes sem criar outra base concorrente.

## Execução
1. Inventariar identidades, vínculos, campos de autoridade, RLS, triggers e funções implantadas no projeto unificado.
2. Confirmar o alcance Pipedrive e a exceção Curitiba; registrar incertezas até resposta.
3. Definir normalização de CNPJ, unidades, origem, datas e completude em módulo compartilhado.
4. Escrever primeiro cenários sintéticos de repetição, ambiguidades, aliases, pagamento ausente, CPF, múltiplos negócios e ECD por exercício.

## Arquivos previstos
`src/lib/clientes-base/`, módulo de domínio compartilhável pela função de sync e `tests/clientes-base.test.mjs`; PRD e DECISIONS.

## Contrato
Entradas com fonte/ID/data. Saída com identidade, classificação e motivo, nunca classificação inferida apenas por ausência de pagamento. Ambiguidade fica explícita. Sem acesso externo nos testes de domínio.

## Aceite
- [ ] Regras AC02–09 cobertas por testes sintéticos.
- [ ] Inventário identifica dependências de listas, contratos, contatos e ECD.
- [ ] Nenhuma alteração de classificação dependente de pergunta aberta.
- [ ] Evidências registradas em summary.md.
