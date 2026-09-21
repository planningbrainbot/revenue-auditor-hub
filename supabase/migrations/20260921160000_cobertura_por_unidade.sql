-- SUPERSEDED em 21/09 pela migration 20260921190000_cobertura_materializada.sql:
-- esta versao era VIEW e custava 1,3 s em CADA carregamento da tela, porque depende de
-- ops.base_conta_cnpjs (DISTINCT + UNION com NOT EXISTS correlacionado, 2,5 s sozinha).
-- Mantida no historico; o objeto vivo e tabela com refresh por cron.
-- Cobertura por unidade: o que o card da carteira pode afirmar, e de onde vem.
-- O card mostrava "N contas" — número que mistura fontes e não responde "tamanho da unidade".
-- Aqui separamos: CNPJs distintos (empresas), contas conciliadas (unidade de trabalho) e a
-- procedência por fonte, para o card declarar cobertura parcial em vez de fingir censo.
-- O vínculo conta↔unidade reproduz exatamente o do cliente (use-monetizacao.ts): por unidade_id
-- quando existe, senão por rótulo/chave da unidade no perfil. Conferido linha a linha em 21/09/2026.
begin;
create or replace view ops.monetizacao_unidade_cobertura as
with vinculo as (
  select u.key, u.nome, u.unidade_id, a.key account_key
  from ops.monetizacao_unidades u
  join ops.monetizacao_contas a on
    case when u.unidade_id is not null then u.unidade_id = any(a.unidade_ids)
         else a.perfil->>'unit_label' = u.nome
           or u.key = any(coalesce(array(select jsonb_array_elements_text(a.perfil->'units')),'{}'::text[]))
    end
),
conciliado as (
  select v.key, count(distinct v.account_key) contas, count(distinct c.cnpj) cnpjs
  from vinculo v left join ops.base_conta_cnpjs c on c.account_key = v.account_key
  group by 1
),
-- Procedência: quantos CNPJs da unidade cada fonte conhece. Não somam entre si (há interseção).
no_pipefy as (
  -- Unidade sem unidade_id (São Bernardo, Recife) casa por nome, como o cliente já faz. Sem isso
  -- a linha de procedência diria "Pipefy 0" para uma carteira inteiramente vinda do Pipefy.
  select u.key, count(distinct regexp_replace(e.cnpj,'\D','','g')) n
  from ops.monetizacao_unidades u
  join ops.empresas e on case when u.unidade_id is not null then e.unidade_id = u.unidade_id
                              else ops.base_unidade(e.unidade) = ops.base_unidade(u.nome) end
  where coalesce(e.cnpj,'') <> '' group by 1
),
no_omie as (
  select u.key, count(distinct ops.base_cnpj(o.cnpj_cpf)) n
  from ops.monetizacao_unidades u
  join ops.unidades un on un.id = u.unidade_id
  join ops.omie_clientes o on ops.base_unidade(o.unidade) = ops.base_unidade(un.nome_da_praca)
  group by 1
)
select u.key, u.nome, u.unidade_id,
  coalesce(conciliado.contas,0) contas,
  coalesce(conciliado.cnpjs,0) cnpjs,
  coalesce(no_pipefy.n,0) cnpjs_pipefy,
  coalesce(no_omie.n,0) cnpjs_omie,
  -- Integrada é a unidade cujo Omie chega até aqui. O nome da credencial não serve de prova:
  -- Matriz e Partners respondem por Goiânia, e a string da credencial não bate com a praça.
  coalesce(no_omie.n,0) > 0 omie_integrado
from ops.monetizacao_unidades u
left join conciliado on conciliado.key = u.key
left join no_pipefy on no_pipefy.key = u.key
left join no_omie on no_omie.key = u.key;
grant select on ops.monetizacao_unidade_cobertura to authenticated;
commit;
