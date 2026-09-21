-- Paridade cliente/servidor das duas regras de 19/09/2026: situação cadastral na Receita e teto de
-- faturamento pelo porte. Espelha tests/portfolio.test.mjs e tests/recon.test.mjs.
-- Roda sobre ops.monetizacao_offer_issue_pre_base_unica, que é immutable e não depende de tabela.
-- Uso: psql -f tests/situacao-receita-teto.sql — toda linha precisa sair com ok = true.
with base as (
 select '{"old_base":true,"new_commercial":false,"regime":"Lucro Presumido","pipedrive_contract":true,"non_simples_confirmed":true,"consultoria_origin":{"status":"retroativa","non_simples_confirmed":true}}'::jsonb a
), cases as (
 -- Situação cadastral bloqueia os três produtos, qualquer que seja o resto do perfil.
 select 'ativa não bloqueia consultoria' name,'consultoria' p,a||'{"situacao_receita":"ativa"}'::jsonb acc,'{}'::jsonb review,true expected from base
 union all select 'sem campo de situação não bloqueia','consultoria',a,'{}',true from base
 union all select 'situação nula não bloqueia','consultoria',a||'{"situacao_receita":null}'::jsonb,'{}',true from base
 union all select 'baixada bloqueia consultoria','consultoria',a||'{"situacao_receita":"baixada"}'::jsonb,'{}',false from base
 union all select 'inapta bloqueia finance','finance',a||'{"situacao_receita":"inapta","band":"Até R$ 500 mil"}'::jsonb,'{}',false from base
 union all select 'suspensa bloqueia cella','cella',a||'{"situacao_receita":"suspensa","band":"R$ 25 milhões até R$ 50 milhões"}'::jsonb,'{}',false from base
 -- Revisão de faixa ou regime não reabre empresa fechada; a revisão da própria situação, sim.
 union all select 'revisão de faixa não libera baixada','finance',a||'{"situacao_receita":"baixada"}'::jsonb,'{"band":"Até R$ 500 mil"}',false from base
 union all select 'revisão de regime não libera baixada','consultoria',a||'{"situacao_receita":"baixada"}'::jsonb,'{"regime":"Lucro Real"}',false from base
 union all select 'revisão de situação para ativa libera','finance',a||'{"situacao_receita":"baixada","band":"Até R$ 500 mil"}'::jsonb,'{"situacao_receita":"ativa"}',true from base
 union all select 'revisão de situação para inapta bloqueia ativa','finance',a||'{"situacao_receita":"ativa","band":"Até R$ 500 mil"}'::jsonb,'{"situacao_receita":"inapta"}',false from base
 -- Teto pelo porte vale como faixa abaixo de R$ 25 mi em Finance e nunca torna Cella elegível.
 union all select 'teto EPP resolve o corte de Finance','finance',a||'{"faturamento_teto":4.8}'::jsonb,'{}',true from base
 union all select 'teto ME resolve o corte de Finance','finance',a||'{"faturamento_teto":0.36}'::jsonb,'{}',true from base
 union all select 'sem faixa e sem teto não passa em Finance','finance',a,'{}',false from base
 union all select 'teto não torna Cella elegível','cella',a||'{"faturamento_teto":4.8}'::jsonb,'{}',false from base
 -- Faixa declarada apaga o teto, venha do cadastro ou do editor de lista.
 union all select 'faixa declarada alta vence o teto em Finance','finance',a||'{"faturamento_teto":4.8,"band":"R$ 25 milhões até R$ 50 milhões"}'::jsonb,'{}',false from base
 union all select 'faixa declarada alta vence o teto em Cella','cella',a||'{"faturamento_teto":4.8,"band":"R$ 25 milhões até R$ 50 milhões"}'::jsonb,'{}',true from base
 union all select 'review.band alta apaga o teto em Finance','finance',a||'{"faturamento_teto":4.8}'::jsonb,'{"band":"R$ 25 milhões até R$ 50 milhões"}',false from base
 union all select 'review.band alta apaga o teto em Cella','cella',a||'{"faturamento_teto":4.8}'::jsonb,'{"band":"R$ 25 milhões até R$ 50 milhões"}',true from base
)
select name,p,expected,
 (ops.monetizacao_offer_issue_pre_base_unica(acc,p,review) is null) actual,
 (ops.monetizacao_offer_issue_pre_base_unica(acc,p,review) is null)=expected ok,
 ops.monetizacao_offer_issue_pre_base_unica(acc,p,review) motivo
from cases order by name;
