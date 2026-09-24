-- Planning People para quem NÃO gere o cadastro (perfil colaborador).
--
-- Até 24/09/2026 só entrava no People quem tinha a área inteira pelo papel,
-- e aí `gente_pessoas` era legível na unidade toda. O colaborador lê só a
-- própria linha (`gente_pessoas_select`), e isso quebrava duas coisas:
--
-- 1. As 10 policies RESTRICTIVE de escopo conferiam a unidade com
--    `exists (select from gente_pessoas p where p.id = <coluna> ...)`. O
--    subselect roda com a RLS de quem pergunta, então o colega era invisível e
--    o feedback para ele era recusado. Agora a unidade sai de
--    `gente_pessoa_unidade()`, SECURITY DEFINER. Mesma regra, sem depender do
--    que a pessoa enxerga.
-- 2. As telas listam colegas e liderados lendo `gente_pessoas`. Abrir a tabela
--    para a unidade exporia CPF (169 de 216), telefone e nascimento. Em vez
--    disso, `gente_diretorio`: nome, cargo, departamento, unidade, gestor e
--    status. View sem RLS herdada, então o portão está no WHERE.
--
-- Rollback: supabase/rollback/20260924220000_gente_diretorio_rollback.sql

create or replace function ops.gente_pessoa_unidade(_pessoa_id bigint)
returns integer
language sql
stable security definer
set search_path to 'ops', 'public'
as $$ select unidade_id from ops.gente_pessoas where id = _pessoa_id $$;

revoke all on function ops.gente_pessoa_unidade(bigint) from public, anon;
grant execute on function ops.gente_pessoa_unidade(bigint) to authenticated;

create or replace view ops.gente_diretorio
with (security_barrier = true) as
select p.id,
       p.nome_completo,
       p.cargo,
       p.departamento,
       p.unidade_id,
       p.gestor_id,
       p.status,
       p.user_id is not null as tem_login
  from ops.gente_pessoas p
 where ops.can('view.gente')
   and (not ops.can('data.scope.own_unit_only')
        or p.unidade_id = any (ops.minhas_unidades_gente()));

revoke all on ops.gente_diretorio from public, anon;
grant select on ops.gente_diretorio to authenticated;

drop policy if exists gente_aval_escopo_unidade on ops.gente_avaliacoes;
create policy gente_aval_escopo_unidade on ops.gente_avaliacoes as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(avaliado_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_1a1_escopo_unidade on ops.gente_um_a_um;
create policy gente_1a1_escopo_unidade on ops.gente_um_a_um as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(liderado_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_feedback_escopo_unidade on ops.gente_feedback;
create policy gente_feedback_escopo_unidade on ops.gente_feedback as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(para_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_sentimentos_escopo_unidade on ops.gente_sentimentos;
create policy gente_sentimentos_escopo_unidade on ops.gente_sentimentos as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_prioridades_escopo_unidade on ops.gente_prioridades;
create policy gente_prioridades_escopo_unidade on ops.gente_prioridades as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_elogios_escopo_unidade on ops.gente_elogios;
create policy gente_elogios_escopo_unidade on ops.gente_elogios as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(de_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_ciclo_ind_escopo_unidade on ops.gente_ciclo_indicacoes;
create policy gente_ciclo_ind_escopo_unidade on ops.gente_ciclo_indicacoes as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(avaliado_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_1a1_cadencia_escopo_unidade on ops.gente_um_a_um_cadencia;
create policy gente_1a1_cadencia_escopo_unidade on ops.gente_um_a_um_cadencia as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(liderado_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_box_part_escopo_unidade on ops.gente_box_participacoes;
create policy gente_box_part_escopo_unidade on ops.gente_box_participacoes as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));

drop policy if exists gente_pdi_escopo_unidade on ops.gente_pdi;
create policy gente_pdi_escopo_unidade on ops.gente_pdi as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));
