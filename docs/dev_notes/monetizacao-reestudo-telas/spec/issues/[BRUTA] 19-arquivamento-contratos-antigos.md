# Arquivamento dos contratos de tela antigos

## Contexto (1-2 frases)
Spec §10: documentação, separada do código — os contratos das telas apagadas ou fundidas vão para `aposentados/`.

## O que precisa acontecer
- Mover `monetizacao-{temporal,forecast,capacidade,follow-day,pessoas,distribuicao}.md` e `monetizacao-funil.md` para `docs/design/contratos/aposentados/`.
- Anotar no topo de cada um a data do arquivamento e o destino novo (ex.: "substituído por `monetizacao-previsao.md` em dd/mm").
- Não editar os contratos novos (`monetizacao-funil-ciclo.md`, `monetizacao-previsao.md`) além do que já dizem.

## Dependências
- `18-remocao-codigo-antigo` (o código já não referencia os contratos antigos).
