# Ampliação da base apta à prospecção

## Resultado esperado
Classificar origem com evidência, reaproveitar dados existentes e liberar ofertas comprovadas, preservando a identidade das contas, listas e negócios.

## Regras confirmadas em 17/09/2026
- Fora de Curitiba, qualquer vínculo identificado no Omie ou Pipedrive determina Base Nova. Pagamento e status ganho não são requisitos da origem.
- Curitiba usa `cabecalho.dVigInicial` de Contratos de Serviço do Omie. Antes de abril de 2025 é Base Antiga; depois de abril é Base Nova. Abril permanece pendente até definição expressa do corte.
- A primeira vigência por CNPJ comprova quando o relacionamento começou; uma renovação não transforma cliente antigo em novo. Documentos com coortes diferentes na mesma conta exigem revisão.
- Os aplicativos Curitiba, Planning CWB 01 e Planning CWB 02 têm espaços próprios de códigos. O vínculo entre aplicativos e Brain é por CNPJ completo válido, nunca por nome ou código sem aplicativo.
- Sem contrato suficiente em Curitiba, sem vínculo nas outras unidades ou com identidade/unidade ambígua, conservar a pendência. Não inventar validação de sócio.
- Consultoria: origem antiga comprovada, sem fechamento comercial, fora do Simples/MEI. Contato, ECD, faturamento e segmento não bloqueiam.
- Finance, Cella e Recon mantêm seus critérios. Estimativa Driva não substitui faturamento declarado. Recon continua no Aquário, sem criação automática no CRM.
- Corrigir origem no Pipefy por fila auditada com comparação anterior, releitura e confirmação. Não sobrescrever uma edição concorrente.

## Execução SDD
1. Snapshot privado das evidências, funções e dados afetados.
2. Contrato de dados e testes de fronteiras: corte temporal, CNPJ, unidade, conflito e ausência.
3. Migração incremental e ensaio com rollback; carregar evidências Omie.
4. Comparar contagens e enfileirar correções comprovadas no Pipefy.
5. Reaproveitar enriquecimento; consultar piloto Driva de até 50 CNPJs e medir retorno antes de expandir.
6. Recalcular ofertas e separar listas de pendências por motivo/unidade. Consultoria sem contato continua trabalhável.
7. Validar escopo de acesso, idempotência, desempenho e publicação.

## Critérios de aceite
- Base única preserva chaves e contagem de contas, salvo intake de registros novos reais.
- Nenhum contrato recebe data de cadastro/pagamento no lugar da vigência inicial.
- Origem apresenta motivo e data/fonte consultável; abril não é classificado por suposição.
- Qualquer vínculo Pipedrive fora da exceção é Nova, inclusive negócio não ganho.
- Evidência tributária ausente permanece desconhecida; divergência não libera oferta.
- Correções externas só contam como concluídas após confirmação no Pipefy.
- Nenhum envio de negócio ou mensagem para sócio é disparado pelo enriquecimento.
- Segredos, cadastros e respostas individuais ficam fora do Git e de páginas públicas.

## Estado da execução

- Carga de vigências, classificação, evidência tributária, correções confirmadas no Pipefy e exibição no painel: publicadas no PR #11.
- Atualização diária Omie: ativada após a autorização de continuação de 17/09. Migration `20260917174200_base_vigencias_sync.sql`, worker versão 5 e job `base-omie-vigencias` ativos. Primeiro ciclo completo nos três aplicativos, com pausa de 24 horas validada.
- Consulta adicional ao cadastro de clientes Omie e revisão dos campos de unidade do Pipedrive: realizadas. Ausências não foram convertidas em comprovação de regime ou identidade.
- Listas de origem, regime e vínculos a revisar: evidências nominais em diretório privado Planning, fora deste repositório público. Disponibilidade no painel respeita produto, reservas e negócios existentes.
- Pendências externas: resposta sobre o mês de abril/2025, evidências das unidades e saldo da Driva para novas consultas. Convites GitHub aguardam o aceite dos destinatários. Não declarar essas etapas concluídas por ter terminado a parte técnica.

## Acompanhamento da rotina Omie

Conferir `ops.base_omie_jobs`: página, última atualização, próxima execução, lease e erro por aplicativo. O agendador roda a cada dois minutos, mas não consulta Omie quando todos os aplicativos estão no intervalo de 24 horas. Erros registram a causa e adiam a tentativa em 15 minutos; o lease impede dois trabalhadores de usar simultaneamente o mesmo checkpoint.

Conferir o cron `base-omie-vigencias` e confirmar o resultado no worker/banco; a execução SQL do cron apenas enfileira a chamada HTTP. As correções de origem geradas ao concluir cada aplicativo continuam na outbox existente e só contam como concluídas depois da releitura no Pipefy.

Para suspender somente esta atualização, desativar o job `base-omie-vigencias`; preservar `base-clientes-reconcile`, dados, checkpoints e histórico de alterações. Reativar após corrigir a causa, sem recriar a base ou reenviar negócios ao CRM.
