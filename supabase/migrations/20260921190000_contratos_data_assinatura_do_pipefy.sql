-- Data de assinatura volta a ser preenchida (21/09/2026)
--
-- `contratos.entrada_contrato_assinado_em` parou em 29/07/2026. Ela nunca saiu
-- do sync principal: quem preenchia era um backfill à parte do script local
-- `~/sync_pipedrive_contratos.py`, que casava o contrato com seu deal-cópia no
-- pipeline 28 e lia no /flow a data de entrada no stage 170. Quando as
-- automações foram para a nuvem, a Edge Function que substituiu o script
-- deixou esse trecho de fora de propósito, por custar uma chamada /flow por
-- deal. O LaunchAgent foi arquivado em 31/08 e desde então ninguém preenche:
-- 630 dos 770 contratos estão sem data, incluindo 100% dos ganhos de agosto e
-- setembro.
--
-- Agora existem duas fontes, nesta ordem:
--   1. Pipefy, campo "Data de assinatura do contrato" do pipe 307285170. É a
--      data que a própria operação registra ao mover o card.
--   2. Pipedrive, entrada no stage 170 via /flow, feita pela Edge Function
--      `pipedrive-contrato-assinado-backfill` para o que o Pipefy não cobre.
--
-- "Data da Venda" NÃO entra: decisão do usuário em 21/09/2026 de só aceitar
-- data de assinatura real, mesmo custando cobertura (195 contratos a menos).

set search_path to ops, public;

create or replace function contratos_propagar_data_assinatura_pipefy()
returns integer
language plpgsql
security definer
set search_path = ops, public
as $$
declare
  alterados integer;
begin
  -- Só preenche o que está vazio. Contrato que já tem data não é sobrescrito:
  -- pode ter vindo do backfill do Pipedrive ou de correção manual, e o card do
  -- Pipefy não é mais confiável que nenhum dos dois.
  with fonte as (
    select
      d.pipedrive_deal_id,
      min(d.data_assinatura) as data_assinatura
    from contratos_documentos d
    where d.data_assinatura is not null
      and d.pipedrive_deal_id is not null
      and coalesce(d.tipo, '') <> 'Distrato'
    group by d.pipedrive_deal_id
  )
  update contratos c
     set entrada_contrato_assinado_em = f.data_assinatura
    from fonte f
   where c.pipedrive_deal_id = f.pipedrive_deal_id
     and c.entrada_contrato_assinado_em is null;
  get diagnostics alterados = row_count;
  return alterados;
end $$;

comment on function contratos_propagar_data_assinatura_pipefy() is
  'Copia a data de assinatura dos cards do pipe de Contratos para contratos.entrada_contrato_assinado_em, so onde esta nula. Chamada pela Edge Function pipedrive-contrato-assinado-backfill antes do caminho caro (/flow do Pipedrive).';

revoke all on function contratos_propagar_data_assinatura_pipefy() from public, anon, authenticated;
grant execute on function contratos_propagar_data_assinatura_pipefy() to service_role;

notify pgrst, 'reload schema';
