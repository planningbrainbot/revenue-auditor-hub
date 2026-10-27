-- Casos da regra de cliente (ops.base_conta_situacao, migrations 20261015170000, 20261015200000 e 20261027120000). Roda com a função em pg_temp
-- (scripts da sessão: um query só, `create function pg_temp...` + este select). Todas as linhas devem dar ok = true.
with c(nome, ficha, perfil, estado, grau) as (values
  ('distrato vence tudo', '{"distrato":{"estado":"concluido"},"prova":{"nivel":"comprovado","provas":["contrato"]},"empresa_ids":[1]}'::jsonb, '{}'::jsonb, 'ex_cliente', null::int),
  ('empresa do grupo', '{"prova":{"nivel":"grupo","motivo":"Grupo."}}', '{}', 'grupo', null),
  ('duas tags não conta', '{"prova":{"nivel":"comprovado","provas":["contrato"]},"omie":{"classe":"cliente_e_fornecedor"},"empresa_ids":[1]}', '{}', 'fornecedor', null),
  ('só tag fornecedor', '{"prova":{"nivel":"fornecedor"},"omie":{"classe":"fornecedor"}}', '{}', 'fornecedor', null),
  ('recebe pagamento sem prova', '{"prova":{"nivel":"fornecedor","motivo":"Fornecedor: recebe pagamento."}}', '{}', 'fornecedor', null),
  ('pagamento visto em 90 dias', ('{"prova":{"nivel":"comprovado","provas":["receber"],"recebido_em":"'||(current_date-10)||'"}}')::jsonb, '{}', 'cliente', 4),
  ('contrato ativo', '{"prova":{"nivel":"comprovado","provas":["contrato"],"contrato_ativo":true}}', '{}', 'cliente', 4),
  ('faturado pelo grupo no mês', ('{"prova":{"nivel":"comprovado","provas":["faturado_grupo"],"faturado_grupo_em":"'||date_trunc('month',current_date)::date||'"}}')::jsonb, '{}', 'cliente', 4),
  ('recebimento antigo', '{"prova":{"nivel":"comprovado","provas":["receber"],"recebido_em":"2024-01-10"}}', '{}', 'cliente', 3),
  ('ganho no Pipedrive', '{"prova":{"nivel":"comprovado","provas":["ganho_pipedrive"]}}', '{}', 'cliente', 3),
  ('Pipefy Base Antiga sem prova', '{"prova":{"nivel":"cadastrado","provas":[]},"empresa_ids":[7],"origin":"antiga"}', '{}', 'cliente', 2),
  ('Pipefy Base Nova sem prova', '{"prova":{"nivel":"cadastrado","provas":[]},"pipefy_ids":["9"],"origin":"nova"}', '{}', 'cliente', 1),
  ('tag Cliente de unidade', '{"prova":{"nivel":"so_tag","provas":[]},"omie":{"classe":"cliente","cliente_em":["Belém"]}}', '{}', 'cliente', 1),
  ('ECD com Pipefy é prova', '{"prova":{"nivel":"comprovado","provas":["ecd"]},"empresa_ids":[3],"origin":"antiga"}', '{}', 'cliente', 3),
  ('só ECD não faz cliente', '{"prova":{"nivel":"comprovado","provas":["ecd"]}}', '{}', 'nao_cliente', null),
  ('lote da Matriz, CNPJ ativo (cliente grau 1 desde 15/10 à tarde)', '{"prova":{"nivel":"so_tag","provas":[]},"omie":{"classe":"cliente","cliente_em":["Planning Partners (Matriz)"]}}', '{"situacao_receita":"ativa"}', 'cliente', 1),
  ('lote da Matriz, CNPJ baixado', '{"prova":{"nivel":"so_tag","provas":[]},"omie":{"classe":"cliente","cliente_em":["Planning Partners (Matriz)"]}}', '{"situacao_receita":"baixada"}', 'nao_cliente', null),
  ('lote da Matriz faturado pelo grupo', '{"prova":{"nivel":"comprovado","provas":["faturado_grupo"],"faturado_grupo_em":"2026-03-01"},"omie":{"classe":"cliente","cliente_em":["Planning Partners (Matriz)"]}}', '{"situacao_receita":"ativa"}', 'cliente', 3),
  ('só cadastro do Omie', '{"prova":{"nivel":"sem_prova","provas":[]},"omie":{"classe":"sem_tag"}}', '{}', 'nao_cliente', null),
  ('contrato cancelado sem pagamento vira ex-cliente (27/10)', '{"prova":{"nivel":"comprovado","provas":["contrato","receber"],"recebido_em":"2023-02-10","contrato_cancelado":true,"contrato_fim":"2023-02-28"},"empresa_ids":[1]}', '{}', 'ex_cliente', null),
  ('contrato cancelado sem título nenhum vira ex-cliente', '{"prova":{"nivel":"comprovado","provas":["contrato"],"contrato_cancelado":true,"contrato_fim":"2018-12-31"}}', '{}', 'ex_cliente', null),
  ('contrato cancelado com pagamento em 90 dias segue cliente', ('{"prova":{"nivel":"comprovado","provas":["contrato","receber"],"recebido_em":"'||(current_date-20)||'","contrato_cancelado":true,"contrato_fim":"2026-06-30"}}')::jsonb, '{}', 'cliente', 4),
  ('contrato cancelado com faturamento recente do grupo segue cliente', ('{"prova":{"nivel":"comprovado","provas":["contrato","faturado_grupo"],"faturado_grupo_em":"'||date_trunc('month',current_date)::date||'","contrato_cancelado":true}}')::jsonb, '{}', 'cliente', 4),
  ('contrato cancelado e ganho no Pipedrive vira ex-cliente', '{"prova":{"nivel":"comprovado","provas":["contrato","ganho_pipedrive"],"contrato_cancelado":true,"contrato_fim":"2025-11-30"}}', '{}', 'ex_cliente', null),
  ('fornecedor vence contrato cancelado', '{"prova":{"nivel":"comprovado","provas":["contrato"],"contrato_cancelado":true},"omie":{"classe":"fornecedor"}}', '{}', 'fornecedor', null)
)
select nome, s->>'estado' estado, (s->>'grau')::int grau,
       s->>'estado' = estado and (s->>'grau')::int is not distinct from grau ok
from c cross join lateral (select pg_temp.base_conta_situacao(ficha, perfil) s) x;
