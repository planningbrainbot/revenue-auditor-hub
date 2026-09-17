# Publicação e recuperação — Base única

## Pré-condições

- Autorização de produção após o bloqueio informado em `summary.md`.
- Manter a decisão sobre preencher vazios do Pipefy separada da ativação do espelho. A proteção inicial conserva a informação do Brain e sinaliza pendência.
- Conferir a main atual antes de integrar a branch; não sobrescrever mudanças paralelas.
- Confirmar projeto Supabase Planning (`npknehhyyzelmrbbxvtu`), schema `ops`, e Vercel `ops-brain` da Planning.
- Nunca usar credenciais de outro cliente/projeto. Não copiar backups, logs nominais nem chaves para o Git ou artefato público.

## Verificação anterior à aplicação

1. Rodar `node --test tests/clientes-base.test.mjs tests/clientes-webhook.test.mjs tests/clientes-catalog.test.mjs tests/monetizacao.test.mjs tests/portfolio.test.mjs tests/recon.test.mjs`.
2. Rodar build Vite/Nitro para Vercel. Conferir erros TypeScript novos separadamente dos preexistentes registrados no resumo.
3. Em staging ou transação explicitamente terminada em rollback, aplicar as migrations `base_clientes_sync`, `base_unica_catalogo` e complementos `base_ecd_metadata`, `base_vinculos_conflitantes`, `base_clientes_acesso`, `base_eventos_perdidos`, `base_identidade_pendente` e `tests/clientes-sync.sql`. Não enviar eventos remotos durante o teste. A versão final das migrations exige esta revalidação.
4. Testar a carga Omie e ECD, contagens antes/depois, repetição sem duplicatas, CNPJs múltiplos/ausentes, quantidade/tamanho das respostas de 400 contas e tempo de leitura. Distinguir cadastro, CNPJ, conta, contato e negócio no relatório.
5. Testar RPCs como usuário sem sessão, operador de uma unidade e administrador. Em particular: não expor contatos sem permissão e não reutilizar cache entre usuários/escopos.
6. Atualizar backup privado dos registros que serão alterados. Registrar revisão/horário para não reverter depois uma mudança legítima de outro operador.

## Aplicação por etapas

1. `scripts/base-unica/deploy.py schemas` aplica as migrations em uma instalação ainda não iniciada, com token administrativo no ambiente. Se já houver estado técnico, o script recusa reaplicar: conferir o estado e executar apenas o complemento ausente.
2. `scripts/base-unica/deploy.py edge --slug base-clientes-sync` publica o worker. Conferir o contrato GraphQL real e HTTP 401 para chamadas sem segredo.
3. `scripts/base-unica/configure.py --private <diretório-privado>` cria/reutiliza chaves técnicas, cadastra os dois webhooks Planning e agenda a reconciliação. O script preserva outros webhooks. Conferir que os handlers antigos dessas tabelas não continuam escrevendo de forma concorrente.
4. Acompanhar ciclos completos em `ops.base_sync_jobs` / `ops.base_sync_execucoes`. O snapshot é salvo em `ops.base_sync_registros`; pendência de bootstrap não é sucesso pleno. Não liberar origem em massa a partir de valores vazios.
5. Conferir a entrada Omie no catálogo existente e o vínculo de ECD por CNPJ/exercício. As rotinas são idempotentes; não criam registros no Pipefy ou negócios no Pipedrive.
6. Publicar a correção de Auditoria Interna apenas após comparar o handler implantado com o código versionado, incluindo schema e autenticação. Conferir uma execução real e os logs.
7. Publicar frontend revisado, preservando rewrites Growth/Financeiro. Verificar `/clientes`, compatibilidade `/aquario`, filtros, fichas, listas existentes, origem pendente e escopo de contatos. Sem login/browser, não declarar verificação visual concluída.
8. Fazer teste real de atualização em um registro autorizado: alteração na fonte → evento → releitura → espelho → painel. Para o caminho inverso, revisar a alteração concreta e confirmar o valor final no Pipefy. Não criar negócios fictícios para esse teste.
9. Integrar código à main com PR revisado e sem dados privados, para não perder a mudança no próximo deploy. Atualizar `summary.md` com URLs, versões e resultados reais.

## Correções de origem

- Omie fora de Curitiba define Nova com ou sem pagamento.
- Não inferir origem de Curitiba nem ampliar o alcance Pipedrive enquanto a regra estiver pendente.
- Sem vínculo suficiente, o operador registra confirmação da unidade e evidência. A origem só é declarada confirmada quando a fonte correspondente concorda ou não existe registro Pipefy vinculado.
- Primeira carga com documento/vínculo conflitante exige revisão; não unir por nome nem por raiz de CNPJ.
- Preenchimento em massa de vazios exige a decisão pendente e uma prévia dos campos/valores de destino. Não reaproveitar uma aprovação genérica para apagar informações.

## Recuperação

1. Pausar somente `base-clientes-reconcile` e os webhooks desta integração, preservando os demais disparadores.
2. Recolocar o último frontend funcional, se necessário. Não apagar contas, listas, envios ou logs para esconder falha.
3. Preservar snapshots, fila e histórico para analisar o incidente. As tabelas técnicas podem permanecer sem execução ativa.
4. Reverter funções a partir do backup privado revisado, sem imprimir segredos eventualmente presentes na definição legada do trigger.
5. Reverter dados apenas no recorte alterado e após comparar a revisão atual; nunca restaurar um dump inteiro por cima de edições feitas depois do backup.
6. Reconciliar primeiro a fonte e depois o espelho. Não repetir cegamente criação remota após timeout. O worker usa setter idempotente com comparação do valor anterior e releitura; conflitos reais exigem intervenção.

## Limitações ainda abertas

- Origem do disparador externo de algumas rotinas antigas não foi identificada. Não criar agendas duplicadas para essas funções.
- Cobertura e qualidade da automação Omie existente (incluindo Matriz e Curitiba) ainda precisam de validação da configuração real; esta entrega não deve anunciar que todos os produtores foram corrigidos.
- A massa de ECD referida é metadado histórico já presente no Brain; a associação ambígua não comprova ECD para cada CNPJ.

Preservar `automation-secrets.json` em diretório privado durável. Configuração já existente sem o arquivo original deve ser revisada; o configurador não rotaciona a chave por acidente.
