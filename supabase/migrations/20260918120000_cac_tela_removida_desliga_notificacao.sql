-- A tela /unidades/cac saiu (18/09/2026, decisão do usuário)
--
-- O único emissor de notificação in-app era o CAC: quando o Omie gravava o 1º
-- recebimento de um cliente com item de CAC em aberto, o trigger criava um
-- aviso no sininho dizendo "parcela 2 liberada" e mandava a pessoa para
-- /unidades/cac. Sem a tela, o aviso vira link morto — desliga-se o emissor.
--
-- O que NÃO sai, de propósito:
--   * `notificacoes` (tabela, RLS, realtime e o sininho no header) — é genérica
--     e fica de pé para o próximo emissor;
--   * `cac_apuracao`, `cac_apuracao_itens` e `cac_cobranca_cards` — histórico de
--     cobrança que já aconteceu (38 apurações, 117 itens, 84 cards);
--   * `trg_sync_cac_pago_via_recebimento` — dispara no pagamento de royalties,
--     não na tela, e some com ele mudaria o comportamento de uma página viva;
--   * o sync do pipe "Cobrança CAC Adiantado" — quem consome hoje é o extrato
--     do broker (`broker_cac_sync` lê `v_cac_cobranca_pipe`), não a tela.
set search_path to ops, public;

drop trigger if exists trg_contas_receber_notificar_cac on contas_receber;
drop function if exists notificar_cac_pagamento();
