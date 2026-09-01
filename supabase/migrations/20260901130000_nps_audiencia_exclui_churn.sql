-- Achado: nps_audiencia (view usada pelo disparo em massa via n8n e pelo
-- seletor "Disparar campanha") não excluía cliente com churn — 8 contatos de
-- 30 empresas já com card em Tratativas/Perdido estavam elegíveis pra
-- receber pesquisa de novo. Mesma régua de churn já usada em
-- listPlanoAcaoContatos/listNpsCoverage/clientes.functions.ts: card em
-- central_tratativas com status='lost' (vem do id da fase, não do nome).
create or replace view public.nps_audiencia as
select distinct on (c.whatsapp)
  c.id,
  c.nome_completo,
  c.whatsapp,
  c.email,
  c.empresa_id,
  e.titulo as empresa_titulo,
  e.unidade,
  e.origem_da_base
from contatos c
  left join empresas e on e.id = c.empresa_id
  left join central_tratativas ct
    on ct.status = 'lost' and ct.pipedrive_deal_id::text = e.pipedrive_id
where c.whatsapp is not null
  and length(regexp_replace(c.whatsapp, '\D', '', 'g')) >= 10
  and ct.pipedrive_deal_id is null
order by c.whatsapp, (c.email is not null) desc, c.id desc;
