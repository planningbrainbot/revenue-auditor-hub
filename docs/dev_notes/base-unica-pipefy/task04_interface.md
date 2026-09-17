# Task 04 — Clientes único e funil de refinamento

Status: implementação local; validação final e publicação pendentes. Ver summary.md.

## Objetivo
Uma entrada Clientes com visões da mesma base e listas verificáveis por filtro.

## Execução
1. Substituir consultas concorrentes por uma camada única de leitura, com escopo e paginação.
2. Oferecer visões Empresas, Contatos, Negócios, Monetização e Pendências da unidade.
3. Mostrar o funil cumulativo Bruta → CNPJ → contato → ECD; clicar abre os mesmos registros contados.
4. Reaproveitar ficha, filtros e preparação/envio de listas, mantendo regras de produto e estado do CRM.
5. Transformar `/aquario` em compatibilidade para a visão de Monetização e remover a duplicidade do menu.
6. Mostrar sincronização e fonte por campo, correção aguardando confirmação e confirmação de origem por unidade.

## Arquivos previstos
`src/routes/_authenticated/clientes.tsx`, `aquario.tsx`, componentes Clientes/Monetização, navegação e server functions autenticadas.

## Aceite
- [ ] AC01, AC02, AC06–09, AC13 e AC14 verificados.
- [ ] Filtro de produto realmente restringe a lista; seleção oculta é descartada.
- [ ] Sem senha paralela nem nova aprovação de sócio obrigatória para enviar.
- [ ] Interface funciona no navegador e em viewport reduzida, sem vazamento de escopo.
