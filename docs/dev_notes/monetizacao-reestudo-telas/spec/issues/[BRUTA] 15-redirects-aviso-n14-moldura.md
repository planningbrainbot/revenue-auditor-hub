# Redirects das abas antigas e aviso N14

## Contexto (1-2 frases)
Comportamento 11 do §8 e o mecanismo de migração do §11: nenhum link antigo pode quebrar.

## O que precisa acontecer
- Atualizar `validarBuscaMonetizacao` (`busca.ts`) para mapear `?aba=follow-day`, `temporal`, `forecast`, `capacidade`, `distribuicao` para os destinos da tabela do §11, preservando `de`/`ate`/`produto`/`mes` quando fizer sentido, e acrescentando `origem=<aba antiga>`.
- `pessoas` sai do módulo: `beforeLoad` de `/monetizacao` redireciona para `/gente?tela=pdi&origem=monetizacao-pessoas`.
- `dashboard.tsx` mostra o aviso (`role="status"`) com o texto exato de cada linha da tabela do §11 e o botão "Entendi", que tira `origem` da URL.
- Remover os parâmetros aposentados `dias` e `sinal` (Follow Day) de `busca.ts`.

## Dependências
- `04-funil-ciclo-pagina-filtros-kpis` (destino `?aba=funil&secao=parados` precisa existir).
- `11-previsao-pagina-kpis-atencao` (destino `?aba=previsao` precisa existir).
