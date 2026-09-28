# (Opcional) Restringir monetizacao_registros.kind a 'roteiro'

## Contexto (1-2 frases)
Spec §9, S4. Último passo, opcional, só depois das telas saírem — hoje há 0 registros com `kind` `pdi`, `distribuicao` e `followup`.

## O que precisa acontecer
- Migration nova restringindo `monetizacao_registros.kind` a `roteiro`.
- Antes de rodar, repetir a consulta de contagem por `kind` na hora do deploy (não confiar no número medido em 28/09 na spec) e confirmar 0 linhas fora de `roteiro`.

## Dependências
- `18-remocao-codigo-antigo`.
- `19-arquivamento-contratos-antigos`.
