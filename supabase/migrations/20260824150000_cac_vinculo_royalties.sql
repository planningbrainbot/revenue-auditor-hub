-- Rastreia o vínculo entre cada parcela de CAC (cac_apuracao_itens) e o item
-- de Royalties (royalties_itens, is_cac=true) criado/atualizado automaticamente
-- quando a parcela é marcada como "boleto enviado" ou "pago". Guardamos o mês
-- vinculado pra saber desvincular do item antigo se o evento seguinte (ex.:
-- pagamento) cair num mês diferente do evento anterior (ex.: envio de boleto)
-- — sem isso o mesmo valor poderia contar em duas faturas mensais diferentes.
alter table cac_apuracao_itens
  add column royalties_item_id_parcela_1 bigint references royalties_itens(id),
  add column royalties_mes_parcela_1 date,
  add column royalties_item_id_parcela_2 bigint references royalties_itens(id),
  add column royalties_mes_parcela_2 date;
