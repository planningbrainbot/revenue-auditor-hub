# Task 02 — Sincronização autoritativa e observabilidade

Status: implementação local; validação final e publicação pendentes. Ver summary.md.

## Objetivo
Fazer Pipefy, espelho cadastral e visões convergirem com idempotência e erro visível.

## Execução
1. Versionar as funções necessárias, preservar a configuração implantada e inventariar os disparadores ativos.
2. Receber evento autenticado, reler o registro e aplicar mapeamento validado, incluindo campos esvaziados.
3. Reconciliar por ID estável; registrar eventos, resultado e divergência. Proteger contra reordenação, duplicação e ciclos.
4. Encaminhar correções do Brain ao Pipefy com fila auditável e releitura antes de confirmar.
5. Reparar parsing de datas e distinguir sucesso parcial; revisar rotinas atrasadas sem duplicar agentes agendados.

## Arquivos previstos
Funções em `supabase/functions/`, migration de estado de sync e fila, scripts operacionais, testes de domínio e SQL.

## Contrato
Campos compartilhados convergem para a leitura confirmada do Pipefy. Indisponibilidade gera pendência/erro; não perde histórico nem anuncia gravação não confirmada. Nenhum dado do cliente vai para log público.

## Aceite
- [ ] AC09–13 e AC15 testados.
- [ ] Evento repetido e fora de ordem não alteram resultado correto.
- [ ] Reconciliação cobre falha de entrega.
- [ ] Teste real com operação autorizada e verificação de antes/depois.
- [ ] Estado e cadência visíveis.
