# Lista de qualidade — título indica outro produto

## Contexto (1-2 frases)
Spec §4.2. A moldura de `/monetizacao` já lista negócios sem produto, sem organização ou sem histórico lido (`dashboard.tsx:461`) e ganha a linha dos negócios cujo título diverge do campo "Caixa · Produto".

## O que precisa acontecer
- Adicionar a linha "título indica outro produto: N" à lista de qualidade em `dashboard.tsx`, comparando o título com o campo `0646513e…` (Caixa · Produto).
- A tela não corrige nada: só abre a lista dos divergentes, para quem quiser ajustar no Pipedrive.
- Regra: o produto é sempre o campo, nunca o título (DECISIONS 15/09, item 5).

## Dependências
- `01-carga-v6-desempate-e-timestamps` (mesma leitura de `payload` da carga).
