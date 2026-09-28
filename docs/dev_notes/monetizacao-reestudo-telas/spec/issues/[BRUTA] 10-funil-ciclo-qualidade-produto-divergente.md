# Lista de qualidade — título indica outro produto

## Contexto (1-2 frases)
Spec §4.2. A moldura de `/monetizacao` já lista negócios sem produto, sem organização ou sem histórico lido (`dashboard.tsx:461`) e ganha a linha dos negócios cujo título diverge do campo "Caixa · Produto".

## O que precisa acontecer
- Adicionar a linha "título indica outro produto: N" à lista de qualidade em `dashboard.tsx`, comparando o título com o campo `0646513e…` (Caixa · Produto).
- A tela não corrige nada: só abre a lista dos divergentes, para quem quiser ajustar no Pipedrive.
- Regra: o produto é sempre o campo, nunca o título (DECISIONS 15/09, item 5).
- Contexto de 28/09: o lote de Consultoria enviado em 15/09 (26 negócios) foi trabalhado na prática como Finance, e um como Cella. O Matheus vai trocar o campo no Pipedrive. A carga relê o negócio quando o campo muda (`update_time`), então nada precisa ser feito no código; a linha de qualidade só pega os casos em que o título denuncia a troca.

## Dependências
- `01-carga-v6-desempate-e-timestamps` (mesma leitura de `payload` da carga).
