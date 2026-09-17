# Entrega — 17/09/2026

Escopo: estudo de UX, protótipo sintético e renomeação da página/módulo para Base de clientes. Não altera banco, autorização, regras de perfil ou envio real.

- Build Vite/Nitro: passou.
- Smoke de sintaxe e estados do protótipo: passou para quatro produtos, filtros, seleção preservada fora do recorte, lista com pendência, ficha, destino Conciliador, envio simulado, bloqueio de repetição, independência entre produtos, vazio e reinício.
- HTML: IDs únicos e nenhuma chamada de API.
- Diff: somente rótulos da aplicação, documentação e protótipo sem dados reais.
- ESLint nos três arquivos da aplicação: único erro é o `no-explicit-any` preexistente em `base-unica.tsx:575`, confirmado na main de origem. Nenhum erro novo.
- Navegador autenticado/visual: indisponível pela ferramenta nesta sessão. A verificação dos estados em JavaScript não substitui uma rodada visual nem o teste com o hunter.
- Publicação: PR e estado final serão registrados após o deploy. Arquivo de proposta: `/estudos/base-clientes-listas.html`; aplicação: `/clientes`.
