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
