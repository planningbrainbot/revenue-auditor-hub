# Envio de oportunidades prontas para trabalho

## Problema
O envio cria um negócio com organização, responsável, etapa e produto, mas não transporta o contexto comercial. Uma conta fora do perfil pode parecer falha de envio, e um erro em um item interrompe o lote inteiro.

## Resultado esperado
O closer escolhe o produto, vê o motivo por empresa e envia as aptas. O negócio chega com contato principal, participantes, dados da empresa, nota de preparação, histórico dos negócios vinculados e arquivos disponíveis. O resultado apresenta link do negócio e informa separadamente a conclusão do card e do preenchimento complementar.

## Contrato de comportamento
- Preservar as regras de produto. Finance continua abaixo de R$ 25 milhões; mostrar alternativas elegíveis sem trocar o produto automaticamente.
- Não exigir validação de sócio nem contato quando o produto não exige.
- Reusar organizações e pessoas por vínculo confirmado; nunca casar empresas apenas por nome nem inventar decisor.
- Preencher campos existentes de qualificação com opções válidas. Não copiar ticket, previsão, probabilidade ou valor do contrato anterior para a nova oferta.
- Levar dados associados à conta da Planning. Histórico traz negócio, fonte e data. Arquivos do CRM são copiados sem retirar o original; documentos externos ficam com link identificado. ECD permanece resumo, sem copiar demonstrações fiscais brutas.
- Manter um negócio por conta/produto e identificar cada nota/arquivo para retomadas sem duplicação.
- Falha complementar não apaga o negócio nem manda outro. Registrar pendência e permitir completar o mesmo card.
- Respeitar acesso, unidade, ator e leitura de contatos. Nada nominal ou secreto no repositório público.

## Aceite e execução
1. Diagnosticar o exemplo no banco e no CRM; preservar evidências privadas.
2. Implementar contexto autenticado, preenchimento idempotente e mensagens por item.
3. Testar divergência de produto, contatos, campos, notas, arquivos, falha parcial e reexecução.
4. Completar o negócio já criado no incidente; conferir contato, notas e arquivos por releitura.
5. Publicar e verificar o fluxo no painel; registrar limitações reais e links de conferência.

## Complemento solicitado: ganhos
- O indicador deve contar os negócios com status ganho na data do ganho no CRM, sem depender de assinatura ou receita preenchidas.
- Atribuição pelo ator do movimento; responsável atual continua visível separadamente.
- Data de assinatura documental é preservada, sem ser substituída pela data do ganho.
- A mesma regra alimenta operação, coortes, ciclo e realizado do forecasting. O modelo projetado original permanece preservado.

## Verificação
- 24 testes de regras, campos canônicos, preenchimento, resposta perdida, idempotência e ganhos aprovados.
- Migração aplicada no banco unificado; execução complementar restrita ao servidor.
- Caso real já enviado foi completado no mesmo negócio: contato principal, cinco notas de histórico e três arquivos, conferidos por releitura do CRM. Os originais foram preservados.
- Sincronização de produção confirmou o ganho sem assinatura no histórico atribuído ao closer.
- Evidências nominais e credenciais ficam exclusivamente na pasta privada de execução da Planning, fora deste repositório.
