-- contratos_documentos.pipedrive_deal_id
--
-- O sync do pipe "[PTRS-CLI-03] Central de Contratos" (307285170) só lia
-- campos que existem na fase "Vigente" — como quase nenhum card chega lá, a
-- tabela ficava sem nenhuma chave utilizável pra casar card com contrato.
-- O campo "Deal ID" (`deal_id_1`) é do Start Form e está preenchido em 100%
-- dos cards, então vira a chave de junção com contratos.pipedrive_deal_id.
--
-- Usado pelo gate de "contrato assinado" da apuração de CAC (/unidades):
-- um item só é considerado assinado quando o card correspondente está na
-- fase "Contrato Assinado" ou posterior. Decisão do usuário em 24/08/2026.

alter table public.contratos_documentos
  add column if not exists pipedrive_deal_id text;

create index if not exists contratos_documentos_pipedrive_deal_id_idx
  on public.contratos_documentos (pipedrive_deal_id);

comment on column public.contratos_documentos.pipedrive_deal_id is
  'ID do deal no Pipedrive, do campo "Deal ID" (deal_id_1) do Start Form do pipe 307285170. Chave de junção com contratos.pipedrive_deal_id.';
