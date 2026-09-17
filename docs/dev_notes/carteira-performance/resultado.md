# Carregamento da carteira — 17/09/2026

## Diagnóstico e alteração

A carteira aguardava todas as páginas de 400 contas em sequência. Para 7.937 contas, eram 20 viagens do navegador ao servidor; cada uma fazia três checagens remotas, consulta de perfis e consulta de metadados. A visão de metadados materializava agregações sobre a base inteira em cada página.

A migração preserva as colunas e regras da visão canônica, mas calcula os agregados correlacionados às contas pedidas. Novas RPCs autenticadas fornecem um manifesto leve de limites por chave e perfis/metadados no mesmo snapshot. A página continua limitada a 400 contas. O carregador processa até quatro lotes em paralelo, preserva ordem e confere revisão, escopo, limites, quantidade e duplicatas antes de publicar o resultado completo. Dados em cache continuam sendo reutilizados apenas com versão, escopo e quantidade iguais.

O filtro de unidade passou de buscas repetidas em arrays para conjuntos de chaves. Filtros derivados e dados incorporados do Aquário são memorizados, evitando refazer a filtragem da carteira ao selecionar linhas.

Não muda perfil de produto, regra de origem, permissão, identidade, lista ou negócio. Não há cache compartilhado de dados entre usuários. Nenhum envio ao CRM.

## Evidências

- Comparação transacional antes/depois: **7.937 contas; zero contas com resultado alterado** na visão canônica.
- Mesmo teste, metadados de 400 contas: **1.242,194 ms → 239,34 ms**, redução de **80,7%**. Medida de SQL, não tempo total de abertura no navegador.
- Novas RPCs, carregamento completo em sequência dentro do teste SQL: 7.937 contas em 5.295 ms; escopo de unidade de 239 contas em 222 ms. Inclui verificações do teste; não equivale a latência de rede.
- Acesso anônimo recusado; manifesto, páginas e metadados respeitam o mesmo escopo das tabelas com RLS. Nenhuma conta omitida ou duplicada.
- 22 testes JavaScript passaram, incluindo limite de quatro requisições simultâneas, ordem, troca de revisão/escopo, lote parcial, duplicidade, cancelamento e interrupção após falha; regras de base, filtros e Recon preservadas.
- Build Vite/Nitro passou. TypeScript sem erros nos arquivos alterados; persistem erros anteriores de outras telas. Lint dos arquivos de carga e Aquário passou; `base-unica.tsx` já tinha o `no-explicit-any` da linha de auditoria, não alterado nesta correção.

A carga completa continua sendo conferida antes de mostrar totais. O ganho não foi obtido mostrando um recorte incompleto como se fosse toda a carteira. A abertura autenticada no navegador não foi cronometrada nesta sessão.

## Publicação e reversão

Aplicar `20260917140000_carteira_performance.sql` antes do frontend. As novas funções preservam os controles de usuário ativo, produto Ops, área e unidade. O endpoint aceita o cursor antigo sem limite superior, mantendo compatibilidade com a versão anterior durante a troca.

Em caso de reversão do frontend, a versão anterior continua compatível com a visão e as tabelas. A definição anterior da visão e as evidências de publicação ficam no diretório privado de execução da Planning. O PR e o deploy devem usar somente `planningbrainbot/revenue-auditor-hub` e `planning17/ops-brain`.
