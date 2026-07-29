-- O valor da parcela (valor_parcela_1/2) é pré-fixado no momento em que o
-- contrato é ganho (metade do MRR). Às vezes o repasse real não bate com
-- esse valor (acordo pontual, arredondamento, desconto). valor_pago_parcela_1/2
-- guarda o valor efetivamente repassado quando ele é marcado como pago —
-- null enquanto não paga, ou quando o valor pago é igual ao pré-fixado.
ALTER TABLE public.cac_apuracao_itens
  ADD COLUMN valor_pago_parcela_1 numeric,
  ADD COLUMN valor_pago_parcela_2 numeric;
