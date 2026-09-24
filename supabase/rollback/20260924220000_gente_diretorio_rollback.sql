-- Volta as policies de escopo ao subselect em gente_pessoas e tira o diretório.
-- O app publicado depois da migration lê `gente_diretorio`: voltar o código antes.

drop policy if exists gente_aval_escopo_unidade on ops.gente_avaliacoes;
create policy gente_aval_escopo_unidade on ops.gente_avaliacoes as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_avaliacoes.avaliado_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_1a1_escopo_unidade on ops.gente_um_a_um;
create policy gente_1a1_escopo_unidade on ops.gente_um_a_um as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_um_a_um.liderado_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_feedback_escopo_unidade on ops.gente_feedback;
create policy gente_feedback_escopo_unidade on ops.gente_feedback as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_feedback.para_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_sentimentos_escopo_unidade on ops.gente_sentimentos;
create policy gente_sentimentos_escopo_unidade on ops.gente_sentimentos as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_sentimentos.pessoa_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_prioridades_escopo_unidade on ops.gente_prioridades;
create policy gente_prioridades_escopo_unidade on ops.gente_prioridades as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_prioridades.pessoa_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_elogios_escopo_unidade on ops.gente_elogios;
create policy gente_elogios_escopo_unidade on ops.gente_elogios as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_elogios.de_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_ciclo_ind_escopo_unidade on ops.gente_ciclo_indicacoes;
create policy gente_ciclo_ind_escopo_unidade on ops.gente_ciclo_indicacoes as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_ciclo_indicacoes.avaliado_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_1a1_cadencia_escopo_unidade on ops.gente_um_a_um_cadencia;
create policy gente_1a1_cadencia_escopo_unidade on ops.gente_um_a_um_cadencia as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_um_a_um_cadencia.liderado_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_box_part_escopo_unidade on ops.gente_box_participacoes;
create policy gente_box_part_escopo_unidade on ops.gente_box_participacoes as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_box_participacoes.pessoa_id and p.unidade_id = any (ops.minhas_unidades_gente())));
drop policy if exists gente_pdi_escopo_unidade on ops.gente_pdi;
create policy gente_pdi_escopo_unidade on ops.gente_pdi as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only')) or exists (
    select 1 from ops.gente_pessoas p
     where p.id = gente_pdi.pessoa_id and p.unidade_id = any (ops.minhas_unidades_gente())));

drop view if exists ops.gente_diretorio;
drop function if exists ops.gente_pessoa_unidade(bigint);
