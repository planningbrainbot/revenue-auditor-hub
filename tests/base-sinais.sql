-- Paridade cliente/servidor dos sinais de 28/09/2026: distrato (Central de Tratativas) e vínculo com
-- a Consultoria. Espelha tests/base-sinais.test.mjs (oferta / distratoForaDeOferta /
-- consultoriaForaDeOferta em src/lib/monetizacao/model.ts). Roda sobre as duas funções puras da
-- migration 20260928200000; toda linha precisa sair com ok = true.
-- Uso: psql -f tests/base-sinais.sql (ou pela Management API, num statement só).
with d(name, sinal, expected) as (
 values
  ('distrato concluído bloqueia', '{"estado":"concluido"}'::jsonb, 'Distrato concluído'),
  ('distrato em tratativa bloqueia', '{"estado":"tratativa"}'::jsonb, 'tratativa de distrato'),
  ('retido não bloqueia', '{"estado":"revertido"}'::jsonb, null),
  ('sem card não bloqueia', null::jsonb, null)
), c(name, sinal, expected) as (
 values
  ('cliente por CNPJ bloqueia', '{"cliente":{"casamento":"cnpj","ativo":true},"propostas":[]}'::jsonb, 'Já é cliente'),
  ('cliente pela raiz bloqueia', '{"cliente":{"casamento":"raiz","ativo":true},"propostas":[]}'::jsonb, 'raiz do CNPJ'),
  ('cliente sem campo ativo bloqueia', '{"cliente":{"casamento":"cnpj"},"propostas":[]}'::jsonb, 'Já é cliente'),
  ('ex-cliente não bloqueia', '{"cliente":{"casamento":"cnpj","ativo":false},"propostas":[]}'::jsonb, null),
  ('cliente nulo e sem proposta não bloqueia', '{"cliente":null,"propostas":[]}'::jsonb, null),
  ('contrato por CNPJ bloqueia', '{"cliente":null,"propostas":[{"casamento":"cnpj","categoria":"Contrato"}]}'::jsonb, 'Contrato da Consultoria'),
  ('contrato só pelo nome não bloqueia', '{"cliente":null,"propostas":[{"casamento":"nome","categoria":"Contrato"}]}'::jsonb, null),
  ('proposta aberta por CNPJ bloqueia', '{"cliente":null,"propostas":[{"casamento":"cnpj","categoria":"Proposta","status":null}]}'::jsonb, 'Proposta da Consultoria em aberto'),
  ('proposta aberta pela raiz bloqueia', '{"cliente":null,"propostas":[{"casamento":"raiz","categoria":"Proposta"}]}'::jsonb, 'Proposta da Consultoria em aberto'),
  ('proposta perdida não bloqueia', '{"cliente":null,"propostas":[{"casamento":"cnpj","categoria":"Proposta","status":"perdida"}]}'::jsonb, null),
  ('proposta só pelo nome não bloqueia', '{"cliente":null,"propostas":[{"casamento":"nome","categoria":"Proposta"}]}'::jsonb, null),
  ('sem sinal não bloqueia', null::jsonb, null)
), casos as (
 select 'distrato · ' || name as name, expected, ops.base_distrato_bloqueio(sinal) as motivo from d
 union all
 select 'consultoria · ' || name, expected, ops.base_consultoria_bloqueio(sinal) from c
)
select name,
       (motivo is not null) = (expected is not null) and (expected is null or motivo like '%' || expected || '%') as ok,
       motivo
  from casos order by name;
