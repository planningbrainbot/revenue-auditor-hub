# Task 03 — Identidade, origem, Omie, ECD e validação da unidade

Status: Catálogo Omie e metadados ECD carregados; fila de origem disponível.

## Objetivo
Reutilizar uma identidade única de empresa para o cadastro e a Monetização, incorporando Omie e os metadados ECD sem inflar clientes.

## Execução
1. Conciliar IDs e CNPJs exatos com o catálogo existente; não fundir por nome nem raiz.
2. Preservar CPF e identidade inválida na fila de refinamento apropriada; não fabricar pessoa jurídica.
3. Aplicar origem com regra versionada e prévia: Omie fora de Curitiba é Nova; exceções e alcance Pipedrive seguem confirmação.
4. Registrar propostas de correção de origem no Pipefy e aguardar confirmação antes de declarar espelho consistente.
5. Vincular ECD por CNPJ/exercício usando apenas dados já autorizados; separar presença de ECD, cobertura e receita estimada/declarada.
6. Gerar a lista da unidade para ausência de vínculos e para ambiguidades; gravar validação autenticada e procedência.

## Arquivos previstos
Migrations/vistas/RPCs de base única, importador reconciliável, modelo de domínio, testes SQL e relatório privado de prévia.

## Aceite
- [ ] AC01–09, AC12–14 testados.
- [ ] Segunda execução não cria empresas/vínculos novos sem mudança de fonte.
- [ ] Previews explicam cada mudança de origem sem pagamento como gate.
- [ ] Listas/envios existentes preservam IDs.
- [ ] CPF não entra na contagem de CNPJs; empresa não multiplica por contato/negócio.
