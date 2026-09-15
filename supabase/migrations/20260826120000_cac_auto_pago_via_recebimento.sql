-- Fecha o ciclo inverso do vínculo CAC → Royalties criado em 24/08/2026
-- (vincularRoyaltiesCac, src/lib/cac.functions.ts): quando o analista
-- confirma manualmente na tela de Recebimentos (financeiro-partners?tab=
-- pagamentos) que a categoria "CAC + Tráfego pago" (cac_trafego) de uma
-- apuração de Royalties foi paga integralmente pelo cliente final da
-- unidade, a(s) parcela(s) de CAC vinculada(s) devem sair de "boleto
-- enviado" e virar "pago" sozinhas — sem precisar clicar de novo na tela
-- de CAC pra registrar o mesmo evento duas vezes.
--
-- Limitação de dado assumida com o usuário: cac_trafego é conferido no
-- agregado unidade+mês contra o Omie (que não abre título por cliente), CAC
-- e Tráfego pago somados. Não dá pra saber QUAL cliente pagou, só que o
-- total bateu — por isso a automação marca TODAS as parcelas is_cac
-- vinculadas àquela apuração de uma vez.
--
-- Decisão confirmada com o usuário em 26/08/2026:
--   1. Dispara automaticamente ao marcar status_validado='confirmado_pago'
--      manualmente na tela (não é um sync direto do Omie).
--   2. Se a confirmação for desfeita depois (correção), reverte sozinho —
--      mas só as parcelas que ESTA automação marcou (pago_auto_parcela_X),
--      nunca uma que já tinha sido marcada como paga manualmente antes.

ALTER TABLE public.cac_apuracao_itens
  ADD COLUMN pago_auto_parcela_1 boolean NOT NULL DEFAULT false,
  ADD COLUMN pago_auto_parcela_2 boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cac_apuracao_itens.pago_auto_parcela_1 IS
  'true quando data_pagamento_parcela_1 foi preenchida pelo trigger sync_cac_pago_via_recebimento (não por marcação manual) — permite reverter só o que a automação fez.';
COMMENT ON COLUMN public.cac_apuracao_itens.pago_auto_parcela_2 IS
  'Idem pago_auto_parcela_1, para a parcela 2.';

CREATE OR REPLACE FUNCTION public.sync_cac_pago_via_recebimento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_data_pgto date;
  v_ficou_confirmado boolean;
  v_deixou_de_confirmar boolean;
BEGIN
  IF NEW.categoria IS DISTINCT FROM 'cac_trafego' THEN
    RETURN NEW;
  END IF;

  v_ficou_confirmado :=
    NEW.status_validado = 'confirmado_pago'
    AND (TG_OP = 'INSERT' OR OLD.status_validado IS DISTINCT FROM 'confirmado_pago');

  v_deixou_de_confirmar :=
    TG_OP = 'UPDATE'
    AND OLD.status_validado = 'confirmado_pago'
    AND NEW.status_validado IS DISTINCT FROM 'confirmado_pago';

  IF NOT v_ficou_confirmado AND NOT v_deixou_de_confirmar THEN
    RETURN NEW;
  END IF;

  IF v_ficou_confirmado THEN
    v_data_pgto := coalesce(NEW.validado_em::date, current_date);

    UPDATE public.cac_apuracao_itens ci
       SET data_pagamento_parcela_1 = v_data_pgto,
           valor_pago_parcela_1 = ci.valor_parcela_1,
           pago_auto_parcela_1 = true
      FROM public.royalties_itens ri
     WHERE ri.id = ci.royalties_item_id_parcela_1
       AND ri.apuracao_id = NEW.apuracao_id
       AND ri.is_cac = true
       AND ri.excluido_em IS NULL
       AND ci.excluido_em IS NULL
       AND ci.data_pagamento_parcela_1 IS NULL;

    UPDATE public.cac_apuracao_itens ci
       SET data_pagamento_parcela_2 = v_data_pgto,
           valor_pago_parcela_2 = ci.valor_parcela_2,
           pago_auto_parcela_2 = true
      FROM public.royalties_itens ri
     WHERE ri.id = ci.royalties_item_id_parcela_2
       AND ri.apuracao_id = NEW.apuracao_id
       AND ri.is_cac = true
       AND ri.excluido_em IS NULL
       AND ci.excluido_em IS NULL
       AND ci.data_pagamento_parcela_2 IS NULL;

  ELSIF v_deixou_de_confirmar THEN
    UPDATE public.cac_apuracao_itens ci
       SET data_pagamento_parcela_1 = NULL,
           valor_pago_parcela_1 = NULL,
           pago_auto_parcela_1 = false
      FROM public.royalties_itens ri
     WHERE ri.id = ci.royalties_item_id_parcela_1
       AND ri.apuracao_id = NEW.apuracao_id
       AND ci.pago_auto_parcela_1 = true;

    UPDATE public.cac_apuracao_itens ci
       SET data_pagamento_parcela_2 = NULL,
           valor_pago_parcela_2 = NULL,
           pago_auto_parcela_2 = false
      FROM public.royalties_itens ri
     WHERE ri.id = ci.royalties_item_id_parcela_2
       AND ri.apuracao_id = NEW.apuracao_id
       AND ci.pago_auto_parcela_2 = true;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_cac_pago_via_recebimento
AFTER INSERT OR UPDATE OF status_validado ON public.royalties_apuracao_pagamentos
FOR EACH ROW EXECUTE FUNCTION public.sync_cac_pago_via_recebimento();
