-- Recorte por unidade nos ciclos do Planning People (30/09/2026).
--
-- Achado pelo RH de Maceió (Paula Rafaela, papel gente_gestao, unidade 8): a aba
-- Avaliação mostrava os três ciclos de Belém importados do Qulture, com 40, 21 e
-- 22 avaliados. Em sessão simulada dela apareceu coisa pior:
-- `v_gente_nine_box_sugerido` devolvia 66 linhas de outras unidades com média de
-- desempenho e potencial por pessoa_id. A view roda com o dono (sem
-- security_invoker, como todas do Ops) e o gate dela era só
-- `can('manage.gente.avaliacao')`, que o perfil de gestão de gente tem. Isso fura
-- a regra de 14/09: nota nominal não sai da unidade.
--
-- O que muda:
-- 1. A view ganha o mesmo recorte de unidade das policies RESTRICTIVE.
-- 2. `gente_ciclo_participantes` ganha a RESTRICTIVE que faltava (pessoa_id).
-- 3. `gente_ciclos` e `gente_pesquisas` ganham `unidade_id`. Nulo = ciclo da rede
--    inteira, visível para todos com a chave. Os importados recebem a unidade de
--    quem participou deles: avaliação 3, 5 e 6 são só de Belém; clima 5 e 6 são
--    de Curitiba pelo título; o modelo do Qulture (4) fica da rede.
-- 4. As tabelas de configuração do ciclo (tópicos, campos, competências,
--    perguntas) só aparecem se o ciclo pai aparecer.
--
-- Fica de fora de propósito: `gente_pdi_ciclos`. O único ciclo de PDI se chama
-- "PLANNING BELÉM 2026", mas tem PDI de quatro unidades, então é da rede. O PDI
-- em si já é recortado.

begin;

-- 1. Nine box sugerido -------------------------------------------------------
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
  -- gate de unidade DENTRO da view: ela não herda a RLS de gente_avaliacoes
  and ((not ops.can('data.scope.own_unit_only'))
       or coalesce(ops.gente_pessoa_unidade(a.avaliado_id) = any (ops.minhas_unidades_gente()), false))
group by a.ciclo_id, a.avaliado_id;

-- 2. Participantes do ciclo --------------------------------------------------
drop policy if exists gente_ciclo_part_escopo_unidade on ops.gente_ciclo_participantes;
create policy gente_ciclo_part_escopo_unidade on ops.gente_ciclo_participantes
  as restrictive for all to authenticated
  using ((not ops.can('data.scope.own_unit_only'))
         or coalesce(ops.gente_pessoa_unidade(pessoa_id) = any (ops.minhas_unidades_gente()), false));

-- 3. Unidade do ciclo --------------------------------------------------------
alter table ops.gente_ciclos add column if not exists unidade_id integer references ops.unidades(id);
alter table ops.gente_pesquisas add column if not exists unidade_id integer references ops.unidades(id);
comment on column ops.gente_ciclos.unidade_id is 'Nulo = ciclo da rede inteira. Recorte na policy gente_ciclos_escopo_unidade.';
comment on column ops.gente_pesquisas.unidade_id is 'Nulo = pesquisa da rede inteira. Recorte na policy gente_pesquisas_escopo_unidade.';

update ops.gente_ciclos set unidade_id = 3 where id in (3, 5, 6) and unidade_id is null;
update ops.gente_pesquisas set unidade_id = 1 where id in (5, 6) and unidade_id is null;

drop policy if exists gente_ciclos_escopo_unidade on ops.gente_ciclos;
create policy gente_ciclos_escopo_unidade on ops.gente_ciclos
  as restrictive for all to authenticated
  using (unidade_id is null
         or (not ops.can('data.scope.own_unit_only'))
         or unidade_id = any (ops.minhas_unidades_gente()));

drop policy if exists gente_pesquisas_escopo_unidade on ops.gente_pesquisas;
create policy gente_pesquisas_escopo_unidade on ops.gente_pesquisas
  as restrictive for all to authenticated
  using (unidade_id is null
         or (not ops.can('data.scope.own_unit_only'))
         or unidade_id = any (ops.minhas_unidades_gente()));

-- 4. Configuração segue o ciclo pai -----------------------------------------
-- O subselect passa pela RLS do pai, que é o que se quer. Só leitura: a escrita
-- dessas tabelas já exige manage.* e o pai visível para achar o id.
drop policy if exists gente_ciclo_topicos_escopo_ciclo on ops.gente_ciclo_topicos;
create policy gente_ciclo_topicos_escopo_ciclo on ops.gente_ciclo_topicos
  as restrictive for select to authenticated
  using (exists (select 1 from ops.gente_ciclos c where c.id = ciclo_id));

drop policy if exists gente_ciclo_campos_escopo_ciclo on ops.gente_ciclo_campos;
create policy gente_ciclo_campos_escopo_ciclo on ops.gente_ciclo_campos
  as restrictive for select to authenticated
  using (exists (select 1 from ops.gente_ciclos c where c.id = ciclo_id));

drop policy if exists gente_ciclo_comp_escopo_ciclo on ops.gente_ciclo_competencias;
create policy gente_ciclo_comp_escopo_ciclo on ops.gente_ciclo_competencias
  as restrictive for select to authenticated
  using (exists (select 1 from ops.gente_ciclos c where c.id = ciclo_id));

drop policy if exists gente_perguntas_escopo_pesquisa on ops.gente_pesquisa_perguntas;
create policy gente_perguntas_escopo_pesquisa on ops.gente_pesquisa_perguntas
  as restrictive for select to authenticated
  using (exists (select 1 from ops.gente_pesquisas p where p.id = pesquisa_id));

commit;
