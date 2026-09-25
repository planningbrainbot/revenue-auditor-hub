-- Churn antes do 1º pagamento, por card perdido da Central de Tratativas.
--
-- Uma linha por tratativa `lost`, com a resposta a "o cliente chegou a pagar
-- algum honorário antes de sair?". Três estados, nunca somados:
--   pagou      recebimento no Omie com data de pagamento até a data do churn
--              (recebido sem data também conta: Patos grava assim)
--   nao_pagou  títulos emitidos e nenhum pago até o churn, ou card do pipe
--              Cobrança CAC na fase "Churn antes do 1º Fee"
--   sem_dado   nenhum título achado: unidade sem Omie espelhado (Fortaleza,
--              São Luís), card sem CNPJ e sem nome que case, ou cliente que
--              nunca foi faturado. Ausência de título não prova que não pagou.
--
-- O cliente sai do CNPJ (contratos e empresas pelo deal do Pipedrive) e, sem
-- CNPJ, do nome na mesma unidade, por prefixo: "Lig Cargas" casa com
-- "LIG CARGAS - LOGISTICA EM TRANSPORTES LTDA". O sufixo "(Segunda
-- Oportunidade)" do card sai antes da comparação.
--
-- security_invoker: a view lê com as permissões de quem consulta, então o
-- escopo de unidade e o gate de contas_receber valem sem repetir aqui.

create or replace view ops.v_tratativas_primeiro_pagamento
with (security_invoker = true) as
with perdidos as materialized (
  select t.id, t.unidade, t.titulo, t.data_churn, t.pipedrive_deal_id::text as deal_id,
         replace(ops.cac_nome_chave(regexp_replace(t.titulo, '\(.*\)', '', 'g')), ' ', '') as nome_chave
  from ops.central_tratativas t
  where lower(t.status) = 'lost'
),
cnpjs as materialized (
  select p.id, regexp_replace(c.cnpj, '\D', '', 'g') as cnpj
  from perdidos p join ops.contratos c on c.pipedrive_deal_id = p.deal_id
  where nullif(regexp_replace(c.cnpj, '\D', '', 'g'), '') is not null
  union
  select p.id, regexp_replace(e.cnpj, '\D', '', 'g')
  from perdidos p join ops.empresas e on e.pipedrive_id = p.deal_id
  where nullif(regexp_replace(e.cnpj, '\D', '', 'g'), '') is not null
),
-- Chaves de contas_receber calculadas uma vez, e os CTEs materializados: sem
-- isso o planner refazia a regex por título para cada card e a consulta
-- passava de 30 s.
cr as materialized (
  select regexp_replace(cpf_cnpj, '\D', '', 'g') as cnpj,
         replace(ops.cac_nome_chave(cliente), ' ', '') as nome_chave,
         ops.norm_unidade(unidade) as unidade,
         status_pagamento, data_pagamento
  from ops.contas_receber
),
titulos as materialized (
  select c.id, cr.status_pagamento, cr.data_pagamento
  from (select distinct id, cnpj from cnpjs) c
  join cr on cr.cnpj = c.cnpj
  union all
  select p.id, cr.status_pagamento, cr.data_pagamento
  from perdidos p
  join cr
    on cr.unidade = ops.norm_unidade(p.unidade)
   and length(p.nome_chave) >= 5
   and left(cr.nome_chave, length(p.nome_chave)) = p.nome_chave
  where not exists (select 1 from cnpjs where cnpjs.id = p.id)
),
resumo as materialized (
  select p.id,
         count(tt.id) as titulos,
         count(tt.id) filter (
           where upper(tt.status_pagamento) = 'RECEBIDO'
             and (tt.data_pagamento is null or p.data_churn is null or tt.data_pagamento <= p.data_churn)
         ) as pagos_antes,
         min(tt.data_pagamento) filter (where upper(tt.status_pagamento) = 'RECEBIDO') as primeiro_pagamento
  from perdidos p
  left join titulos tt on tt.id = p.id
  group by p.id
)
select p.id, p.unidade, p.titulo, p.data_churn,
       r.titulos, r.pagos_antes, r.primeiro_pagamento,
       k.fase_atual = 'Churn antes do 1º Fee' as churn_antes_fee_no_pipe_cac,
       case
         when r.pagos_antes > 0 then 'pagou'
         when r.titulos > 0 or k.fase_atual = 'Churn antes do 1º Fee' then 'nao_pagou'
         else 'sem_dado'
       end as situacao
from perdidos p
join resumo r on r.id = p.id
left join lateral (
  select cc.fase_atual from ops.cac_cobranca_cards cc
  where ops.cac_nome_chave(coalesce(cc.cliente, cc.titulo)) = ops.cac_nome_chave(p.titulo)
    and ops.cac_unidade_chave(cc.unidade) = ops.cac_unidade_chave(p.unidade)
  order by (cc.fase_atual = 'Churn antes do 1º Fee') desc
  limit 1) k on true;

comment on view ops.v_tratativas_primeiro_pagamento is
  'Uma linha por tratativa perdida: pagou / nao_pagou / sem_dado antes do churn, pelo Omie (CNPJ ou nome na unidade) e pelo pipe Cobrança CAC. security_invoker.';

grant select on ops.v_tratativas_primeiro_pagamento to authenticated;
