-- Paridade cliente/servidor da regra de 19/10/2026 (holding sem operação e empresa aberta há menos de 1 ano saem da
-- Consultoria retroativa). Espelha tests/consultoria-sem-tributo-proprio.test.mjs.
-- Roda sobre ops.monetizacao_offer_issue_pre_base_unica e ops.receita_cadastro_da_ficha (migration 20261019240000),
-- que não dependem de tabela. Uso: psql -f tests/consultoria-sem-tributo-proprio.sql — toda linha precisa sair com ok = true.
with base as (
 select '{"old_base":true,"new_commercial":false,"regime":null,"band":null,"consultoria_origin":{"status":"retroativa","non_simples_confirmed":true}}'::jsonb a,
  to_char((now() at time zone 'America/Sao_Paulo')::date - 30,'YYYY-MM-DD') recente
), cases as (
 select 'Arcanjo: holding aberta há 30 dias sai pela abertura' name,'consultoria' p,
  a||jsonb_build_object('cadastro_receita',jsonb_build_object('inicio_atividade',recente,'cnaes',jsonb_build_array('6462000'),'fonte','x')) acc,'{}'::jsonb review,'Aberta há menos de 1 ano%' expected from base
 union all select 'holding antiga sem faixa sai','consultoria',a||'{"cadastro_receita":{"inicio_atividade":"2015-05-05","cnaes":["6463800"],"fonte":"x"}}'::jsonb,'{}','Holding sem operação própria (CNAE 6463-8/00 na Receita)%' from base
 union all select 'holding com faixa fica','consultoria',a||'{"band":"R$ 4,8 milhões até R$ 10 milhões","cadastro_receita":{"inicio_atividade":"2015-05-05","cnaes":["6462000"],"fonte":"x"}}'::jsonb,'{}',null from base
 union all select 'holding com faixa revisada fica','consultoria',a||'{"cadastro_receita":{"inicio_atividade":"2015-05-05","cnaes":["6462000"],"fonte":"x"}}'::jsonb,'{"band":"R$ 2 milhões até R$ 4,8 milhões"}',null from base
 union all select 'holding + operacional fica','consultoria',a||'{"cadastro_receita":{"inicio_atividade":"2010-01-01","cnaes":["4711302","6462000"],"fonte":"x"}}'::jsonb,'{}',null from base
 union all select 'LUX (6810, 2020) fica','consultoria',a||'{"regime":"Lucro Presumido","cadastro_receita":{"inicio_atividade":"2020-07-29","cnaes":["6810201"],"fonte":"x"}}'::jsonb,'{}',null from base
 union all select 'sem cadastro_receita fica','consultoria',a,'{}',null from base
 union all select 'cadastro_receita nulo fica','consultoria',a||'{"cadastro_receita":null}'::jsonb,'{}',null from base
 union all select 'fechamento comercial mantém o motivo','consultoria',a||jsonb_build_object('new_commercial',true,'cadastro_receita',jsonb_build_object('inicio_atividade',recente,'cnaes',jsonb_build_array('6462000'),'fonte','x')),'{}','Fechamento pelo comercial%' from base
 union all select 'Simples vem depois da regra nova','consultoria',a||jsonb_build_object('regime','Simples Nacional','cadastro_receita',jsonb_build_object('inicio_atividade',recente,'cnaes',jsonb_build_array('4711302'),'fonte','x')),'{}','Aberta há menos de 1 ano%' from base
 union all select 'Cella não muda','cella',a||jsonb_build_object('regime','Lucro Real','band','R$ 50 milhões até R$ 78 milhões','non_simples_confirmed',true,'cadastro_receita',jsonb_build_object('inicio_atividade',recente,'cnaes',jsonb_build_array('6462000'),'fonte','x')),'{}',null from base
 union all select 'Finance não muda','finance',a||jsonb_build_object('regime','Lucro Real','band','Até R$ 500 mil','pipedrive_contract',true,'non_simples_confirmed',true,'cadastro_receita',jsonb_build_object('inicio_atividade',recente,'cnaes',jsonb_build_array('6462000'),'fonte','x')),'{}',null from base
 union all select 'exatamente 1 ano não é recente','consultoria',a||jsonb_build_object('cadastro_receita',jsonb_build_object('inicio_atividade',to_char(((now() at time zone 'America/Sao_Paulo')::date-interval '1 year')::date,'YYYY-MM-DD'),'cnaes',jsonb_build_array('4711302'),'fonte','x')),'{}',null from base
)
select name, p, ops.monetizacao_offer_issue_pre_base_unica(acc,p,review) issue,
 case when expected is null then ops.monetizacao_offer_issue_pre_base_unica(acc,p,review) is null
      else coalesce(ops.monetizacao_offer_issue_pre_base_unica(acc,p,review) like expected,false) end ok
from cases
union all
-- Leitura da ficha: código pelo padrão "7 dígitos + ' ·'" (a descrição do CNAE tem "; "), início mais antigo dos CNPJs.
select 'ficha de um CNPJ', '-', ops.receita_cadastro_da_ficha(f)::text,
 ops.receita_cadastro_da_ficha(f)='{"cnaes":["6462000"],"fonte":"F","inicio_atividade":"2026-03-10"}'::jsonb
from (select '{"CNAE principal (Receita)":{"value":"6462000 · Holdings de instituições não-financeiras","source":"F"},"Início de atividade (Receita)":{"value":"10/03/2026","source":"F"}}'::jsonb f) x
union all
select 'ficha de dois CNPJs com "; " na descrição', '-', ops.receita_cadastro_da_ficha(f)::text,
 ops.receita_cadastro_da_ficha(f)='{"cnaes":["4669999","6462000"],"fonte":"F","inicio_atividade":"2007-03-06"}'::jsonb
from (select '{"CNAE principal (Receita)":{"value":"11111111000111: 4669999 · Comércio atacadista de outras máquinas; partes e peças; 22222222000122: 6462000 · Holdings","source":"F"},"Início de atividade (Receita)":{"value":"11111111000111: 06/03/2007; 22222222000122: 10/03/2026","source":"F"}}'::jsonb f) x
union all
select 'ficha sem consulta', '-', coalesce(ops.receita_cadastro_da_ficha('{}')::text,'null'), ops.receita_cadastro_da_ficha('{}') is null;
