-- Rollback de 20260930150000_gente_ciclos_escopo_unidade.
-- Devolve o vazamento entre unidades descrito na migration: só usar se o
-- recorte quebrar a tela, e reaplicar corrigido logo depois.

begin;

drop policy if exists gente_perguntas_escopo_pesquisa on ops.gente_pesquisa_perguntas;
drop policy if exists gente_ciclo_comp_escopo_ciclo on ops.gente_ciclo_competencias;
drop policy if exists gente_ciclo_campos_escopo_ciclo on ops.gente_ciclo_campos;
drop policy if exists gente_ciclo_topicos_escopo_ciclo on ops.gente_ciclo_topicos;
drop policy if exists gente_pesquisas_escopo_unidade on ops.gente_pesquisas;
drop policy if exists gente_ciclos_escopo_unidade on ops.gente_ciclos;
drop policy if exists gente_ciclo_part_escopo_unidade on ops.gente_ciclo_participantes;

alter table ops.gente_pesquisas drop column if exists unidade_id;
alter table ops.gente_ciclos drop column if exists unidade_id;

create or replace view ops.v_gente_nine_box_sugerido as
select
  a.ciclo_id,
  a.avaliado_id as pessoa_id,
  round(avg(r.nota) filter (where c.eixo = 'desempenho'), 2) as desempenho,
  round(avg(r.nota) filter (where c.eixo = 'potencial'), 2) as potencial,
  count(distinct a.id) filter (where a.tipo <> 'auto') as avaliacoes_consideradas
from ops.gente_avaliacoes a
join ops.gente_avaliacao_respostas r on r.avaliacao_id = a.id
join ops.gente_competencias c on c.id = r.competencia_id
join ops.gente_ciclo_competencias cc on cc.ciclo_id = a.ciclo_id and cc.competencia_id = c.id
where a.status = 'concluida'
  and a.tipo <> 'auto'
  and ops.can('manage.gente.avaliacao')
group by a.ciclo_id, a.avaliado_id;

commit;
