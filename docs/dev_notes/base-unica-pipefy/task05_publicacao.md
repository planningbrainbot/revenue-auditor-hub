# Task 05 — Migração, testes de aceite e publicação

Status: implementação local; validação final e publicação pendentes. Ver summary.md.

## Objetivo
Entregar o fluxo no banco novo, no Pipefy e no domínio de produção, com evidência de convergência.

## Execução
1. Revisar prévia de classificação e vínculos, registrar backup privado e validar migrações com rollback.
2. Executar testes de domínio, RLS, paginação e idempotência; testar falha/parcial e evento perdido.
3. Aplicar migração aditiva e corrigir fontes em lotes auditáveis; conferir cada lote por leitura.
4. Build, revisão do diff e varredura de credenciais/dados individuais; deploy isolado com verificação do domínio.
5. Integrar a branch autorizada à main e verificar que próximas publicações preservam as rotas.
6. Preencher summary.md com resultados reais, números do recorte e limitações restantes.

## Aceite
- [ ] AC01–15 aprovados ou limitação explicitamente documentada; não marcar pronto com trabalho obrigatório pendente.
- [ ] Nenhuma credencial/dado individual no repositório público.
- [ ] Sem perda de listas, contatos, negócios ou permissões.
- [ ] Atualização origem → espelho → interface comprovada.
- [ ] Contagens das visões fecham no mesmo denominador/filtro.
