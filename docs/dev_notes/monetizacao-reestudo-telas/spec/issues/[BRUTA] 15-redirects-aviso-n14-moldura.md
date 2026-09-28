# Redirects das abas antigas e aviso N14

## Contexto (1-2 frases)
Comportamento 11 do §8 e o mecanismo de migração do §11: nenhum link antigo pode quebrar. Só três abas saem (Temporal, Projetado × realizado, Capacidade); Follow Day, Pessoas e PDI e Distribuição ficam (Pedro, 28/09).

## O que precisa acontecer
- Atualizar `validarBuscaMonetizacao` (`busca.ts`) para mapear `?aba=temporal` → `?aba=previsao`, `?aba=forecast` → `?aba=previsao` (preservando `mes`) e `?aba=capacidade` → `?aba=previsao&plano=1`, acrescentando `origem=<aba antiga>`.
- `dashboard.tsx` mostra o aviso (`role="status"`) com o texto exato de cada linha da tabela do §11 e o botão "Entendi", que tira `origem` da URL.
- `?aba=funil` não redireciona: a tela nova ocupa o mesmo endereço.

## Dependências
- `11-previsao-pagina-kpis-atencao` (destino `?aba=previsao` precisa existir).
