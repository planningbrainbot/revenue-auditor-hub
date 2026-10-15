-- Casos da regra de cliente (ops.base_conta_situacao, migration 20261015170000). Roda com a função em pg_temp
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
  ('lote da Matriz, CNPJ ativo', '{"prova":{"nivel":"so_tag","provas":[]},"omie":{"classe":"cliente","cliente_em":["Planning Partners (Matriz)"]}}', '{"situacao_receita":"ativa"}', 'a_confirmar', null),
  ('lote da Matriz, CNPJ baixado', '{"prova":{"nivel":"so_tag","provas":[]},"omie":{"classe":"cliente","cliente_em":["Planning Partners (Matriz)"]}}', '{"situacao_receita":"baixada"}', 'nao_cliente', null),
  ('lote da Matriz faturado pelo grupo', '{"prova":{"nivel":"comprovado","provas":["faturado_grupo"],"faturado_grupo_em":"2026-03-01"},"omie":{"classe":"cliente","cliente_em":["Planning Partners (Matriz)"]}}', '{"situacao_receita":"ativa"}', 'cliente', 3),
  ('só cadastro do Omie', '{"prova":{"nivel":"sem_prova","provas":[]},"omie":{"classe":"sem_tag"}}', '{}', 'nao_cliente', null)
)
select nome, s->>'estado' estado, (s->>'grau')::int grau,
       s->>'estado' = estado and (s->>'grau')::int is not distinct from grau ok
from c cross join lateral (select pg_temp.base_conta_situacao(ficha, perfil) s) x;
