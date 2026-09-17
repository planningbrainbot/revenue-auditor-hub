# Evidências de execução — Base única e Pipefy

## Resultado
- Status: banco, sincronizador e interface publicados; código reunido no PR #7. Convergência integral das fontes ainda possui pendências de dados e regra.
- Preparado: PRD, contratos de domínio, sincronizador de empresas/contatos, fila de correções, conciliação Omie/ECD, tela única de Clientes, visões de contatos/negócios/oportunidades e validação de origem.
- Aplicado: sete migrations, sincronizador de empresas/contatos, dois webhooks Planning e reconciliação agendada. Interface publicada em https://planningbrain.com.br/clientes. PR: https://github.com/planningbrainbot/revenue-auditor-hub/pull/7.
- Após a pergunta de autorização de produção, o usuário respondeu “continua”. Aplicação retomada com backup atualizado e teste transacional. A revisão automática barrou a invocação legada de Auditoria por exclusão de ausentes; foi preparado modo de validação somente leitura.

## Alterações
- Branch: `feat/base-unica-pipefy-sdd-20260916`, isolada da main Planning.
- As tabelas de contas, listas e envios são reutilizadas; as novas tabelas guardam estado técnico e validações.
- `/aquario` passa a abrir `/clientes` na visão Oportunidades. A antiga gestão financeira regional foi preservada como visão própria, sem legenda incorreta de Base Antiga.
- Páginas do catálogo via cursor evitam uma resposta única excessiva; a contagem só aparece após conferir o total. Cache varia por usuário e escopo.
- Nenhum e-mail, negócio CRM, consulta paga Driva ou preenchimento em massa no Pipefy foi executado nesta entrega.

## Verificação
| Critério | Evidência | Resultado |
|---|---|---|
| Identidade, origem, refinamento, produtos, filtros | 51 testes Node | Passaram |
| Ingestão e segurança do evento | Testes com fonte/HTTP simulados | Relê fonte, rejeita tabela externa, não confia no payload |
| Migração e ingestão SQL | Testes transacionais com rollback | Duplicação, atraso, limpeza, preservação, vínculos e privilégios passaram; aceite instalado também confirmou idempotência Omie/ECD, colisão Pipedrive e RLS de unidade |
| Bootstrap de campos vazios | Cenário SQL com rollback | Preserva evidência; repetição mantém pendência; confirmação na fonte resolve |
| Build | Vite/Nitro com preset Vercel | Passou na versão final da interface |
| Typecheck global | TypeScript | Apenas erros preexistentes em integrações/reconciliação/rede/reforma; nenhum nos arquivos alterados |
| Browser autenticado e domínio | CUA | Indisponível nesta sessão; ainda não validado |
| Endpoint de eventos | Produção | Duas chamadas autenticadas do mesmo evento releram o registro real e retornaram ok. Correção remota em massa não executada |
| Carga e desempenho | Produção | Ciclos de empresas/contatos concluídos; Omie/ECD carregados. Página de 400 contas abaixo do limite de resposta. Contagens e tempos no registro privado |

## Decisões pendentes
1. Pipedrive: qualquer cadastro/negócio ou apenas ganho comercial determina Base Nova? Casos não comprovados ficam pendentes.
2. Curitiba: qual evidência distingue antiga/nova? Nenhuma classificação é inferida a partir de pagamento.
3. Campos preenchidos no Brain e vazios no Pipefy: preparar preenchimento com evidência conferida ou manter revisão manual? A carga inicial conserva os dados.
4. Autorização de produção recebida na continuação; não há bloqueio pendente para publicar a interface.

## Próxima execução autorizada
Conferir o estado de integração no PR #7 e a versão final no domínio. Para dados pendentes, seguir `runbook.md`: revisão concreta dos campos e decisão de origem antes de escrever em massa na fonte.

## Ajustes encontrados na execução
- A tabela fiscal ECD exige campos de escrituração indisponíveis no resumo histórico. A evidência fica em `base_ecd_registros`, com CNPJ/exercício/fonte/conta; `base_ecd_evidencias` une metadados e cadastro fiscal existente. Nenhuma receita ou contagem contábil foi inventada.
- Colisão de ID Pipedrive entre empresas preserva o vínculo existente e registra pendência, sem abortar a página nem fundir por nome.
- A ficha retorna canais atuais do Omie e contatos vinculados, sujeitos à permissão de contatos. Cadastro Omie exclusivo acompanha mudanças posteriores de nome/unidade.
- Scripts de implantação recusam reaplicar o conjunto inicial em banco já iniciado. Retomadas exigem conferir a migration aplicada.

## Publicação verificada
- Primeiro deployment publicado: `dpl_3EgGpFfTUsRUMcqFNh5tSNwq5udV`, promovido para o domínio. `/clientes`, `/aquario` e `/login` responderam HTTP 200; asset novo de Clientes confirmado. HTTP não equivale a teste visual autenticado, que continua indisponível.
- Sincronizador `base-clientes-sync` versão 3. Dois webhooks Planning e job `base-clientes-reconcile` ativos. Contatos concluíram com sucesso; empresas concluíram com pendências de bootstrap explicitamente marcadas como parcial.
- Auditoria Interna versão 15: validação real somente leitura passou. A tentativa de invocação com possível remoção foi rejeitada pela revisão automática e não foi executada; o modo seguro retorna antes de qualquer gravação/exclusão.
- Listas e histórico de envios preservados. Nenhum negócio criado, mensagem enviada ou consulta paga realizada.
- Backups/evidências e chaves técnicas foram preservados em diretório privado Planning fora do repositório, com diretório 0700 e arquivos 0600. Não depender apenas de `/tmp`.

## Limites de conclusão
A tela e as rotinas estão entregues. Isso não significa que todos os campos das duas fontes já sejam iguais: conflitos e vazios históricos ficam pendentes, sem exclusão de informação e sem rótulo de sincronização plena. Curitiba, alcance de Pipedrive e preenchimento em massa dependem das definições já solicitadas. A cobertura do produtor Omie e o disparador externo de NPS/Tratativas continuam como itens de revisão, sem criar cron duplicado.

Divergência real de CNPJ suspende classificação e ofertas em todos os produtos. Campo vazio e diferença de máscara não são tratados como documento contraditório. A proteção foi verificada em SQL com rollback e em teste de produto.
