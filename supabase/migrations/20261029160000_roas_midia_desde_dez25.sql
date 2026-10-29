-- Regra do dono (29/10/2026): o ROAS do mês usa a mídia do mês ANTERIOR (a mídia de um mês gera as
-- vendas do mês seguinte). A aba ROAS e assinaturas precisa da mídia de dez/25 para o ROAS de jan/26.
create or replace view ops.v_roas_midia_inside_sales as
select to_char(data, 'YYYY-MM') as mes, sum(investimento)::numeric(14,2) as midia
from growth.investimento_finalidade_dia
where finalidade = 'inside_sales' and data >= '2025-12-01'
group by 1;

revoke all on ops.v_roas_midia_inside_sales from public, anon, authenticated;
grant select on ops.v_roas_midia_inside_sales to service_role;

-- Rollback: recriar a view com data >= '2026-01-01' (migration 20261029120000).
