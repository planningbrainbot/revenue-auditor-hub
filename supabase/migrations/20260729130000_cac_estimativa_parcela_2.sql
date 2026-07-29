-- Enquanto o cliente não paga a unidade (status "aguardando_cliente"), a
-- parcela 2 não tem prazo — some do gráfico de projeção sem deixar rastro
-- dos próximos meses. estimativa_parcela_2 guarda um override manual da
-- data provável de recebimento; sem override, o front calcula uma
-- estimativa a partir da mediana histórica de dias entre assinatura e
-- primeiro pagamento do cliente (por unidade, com fallback pra rede).
ALTER TABLE public.cac_apuracao_itens
  ADD COLUMN estimativa_parcela_2 date;
