-- `empresas.unidade` gravava id do Pipefy no lugar do nome (22/09/2026)
--
-- 490 linhas de `ops.empresas` têm um número onde deveria estar o nome da
-- unidade. Elas somem de todo recorte por unidade: da aba Contratos de
-- /clientes, dos totais por unidade e da própria RLS, cuja policy de escopo
-- compara `norm_unidade(unidade)` com as unidades da pessoa. Sorocaba, com 311
-- clientes, estava invisível.
--
-- A causa está em `pipefy-sync`, no trecho que trata o campo connector:
--
--     if (col === "unidade" && f.value.startsWith("[")) {
--       const p = JSON.parse(f.value); update[col] = Array.isArray(p) ? p[0] : f.value;
--     }
--
-- O `value` de um connector é um JSON com os **ids dos registros** ligados
-- (["1448470601"]), então `p[0]` é o id, nunca o nome. O sync grava o id como
-- se fosse o nome e nada reclama, porque a coluna é texto livre.
--
-- `ops.unidades` já tem a coluna certa para desfazer isso, `pipefy_id`, e ela
-- está preenchida para as unidades antigas. Estava vazia exatamente para as
-- que entraram depois — Recife, São Bernardo, Sorocaba — e para as internas.
-- É por isso que o problema aparece concentrado nas unidades novas.

set search_path to ops, public;

-- ─────────────────────────────────────────────────────────────
-- 1. Completar o de-para que já existia
-- ─────────────────────────────────────────────────────────────
-- Ids lidos da database "[PTRS-DB-02] Unidades" (307173431) em 22/09/2026.
-- Sorocaba confirmada pelo usuário; Goiânia casa com a própria `razao_social`
-- registrada aqui ("Planning Auditores e Contadores SS LTDA - Filial 1").
update unidades set pipefy_id = '1429415364' where nome_da_praca = 'Recife'          and pipefy_id is null;
update unidades set pipefy_id = '1429414599' where nome_da_praca = 'São Bernardo'    and pipefy_id is null;
update unidades set pipefy_id = '1448470601' where nome_da_praca = 'Sorocaba'        and pipefy_id is null;
update unidades set pipefy_id = '1436672162' where nome_da_praca = 'Goiânia'         and pipefy_id is null;
update unidades set pipefy_id = '1436672174' where nome_da_praca = 'Construção Civil' and pipefy_id is null;
update unidades set pipefy_id = '1436672185' where nome_da_praca = 'Consultoria'     and pipefy_id is null;

-- ─────────────────────────────────────────────────────────────
-- 2. Desfazer o estrago nas linhas já gravadas
-- ─────────────────────────────────────────────────────────────
-- `planning.pipefy_ingest` existe porque a trigger `sync_empresa_to_pipefy()`
-- bloqueia escrita direta em campo que pertence ao Pipefy, mandando usar a fila
-- de correção. A fila é para **discordar** do Pipefy, e não é o caso aqui: o
-- connector no Pipefy sempre apontou para a unidade certa. O que estava errado
-- era a leitura desse valor deste lado. Isto é ingestão corrigida, não correção
-- de origem — não há nada para empurrar de volta.
set local planning.pipefy_ingest = 'on';

-- Só troca onde o valor atual é puramente numérico e existe unidade com aquele
-- pipefy_id. Linha com id que não bate com unidade nenhuma fica como está, de
-- propósito: virar nome inventado seria pior que continuar visivelmente errada.
update empresas e
   set unidade = u.nome_da_praca
  from unidades u
 where e.unidade ~ '^[0-9]+$'
   and u.pipefy_id = e.unidade;

-- ─────────────────────────────────────────────────────────────
-- 3. Completar o que o id escondia: tipo_unidade
-- ─────────────────────────────────────────────────────────────
-- Devolver o nome não basta para a linha voltar à tela: /clientes filtra também
-- por `tipo_unidade = 'franquia'`. As 311 linhas de Sorocaba estavam com
-- `tipo_unidade` nulo justamente porque quem derivou esse campo na carga de
-- 17-21/09 casou pelo **nome** da unidade — e o nome delas era um id. As
-- linhas de São Bernardo e Recife, da mesma carga e com nome legível, saíram
-- com 'franquia'. Isto aqui só termina a mesma derivação para quem ficou de
-- fora por causa do bug.
--
-- Escopo deliberadamente estreito: só a carga do Pipefy, só onde `unidade` já
-- é uma regional de verdade. Há outras ~720 linhas sem `tipo_unidade` vindas
-- de `basenps_reconciliacao`, `Omie`, `pipefy_legado_reconciliado` e
-- `pipedrive_sync`, anteriores a tudo isso e com causas próprias — mexer nelas
-- aqui seria mudar o que a tela mostra para Belém, Rio e Curitiba de carona
-- numa correção de outro assunto.
update empresas e
   set tipo_unidade = 'franquia'
 where e.tipo_unidade is null
   and e.fonte_cadastro = 'Pipefy'
   and e.created_at >= '2026-09-17'
   and exists (
     select 1 from unidades u
      where u.tipo = 'regional' and u.nome_da_praca = e.unidade
   );

-- ─────────────────────────────────────────────────────────────
-- 4. Trava para não voltar em silêncio
-- ─────────────────────────────────────────────────────────────
-- A coluna é texto livre e vai continuar sendo (há nomes históricos que não
-- estão em `unidades`). O que não pode voltar é id numérico se passando por
-- nome — isso é sempre bug de sync, nunca dado legítimo.
alter table empresas drop constraint if exists empresas_unidade_nao_e_id;
alter table empresas
  add constraint empresas_unidade_nao_e_id
  check (unidade is null or unidade !~ '^[0-9]{3,}$')
  not valid;

comment on constraint empresas_unidade_nao_e_id on empresas is
  'Bloqueia id do Pipefy gravado no lugar do nome da unidade (bug do pipefy-sync corrigido em 22/09/2026). NOT VALID de proposito: as poucas linhas com id nao resolvivel seguem no banco, mas nenhuma nova entra.';

notify pgrst, 'reload schema';
