-- Avaliação de desempenho (AVD) e ajustes da avaliação de experiência (AVE), decididos pelo
-- RH da Expansão com o RH de Maceió em 29/10/2026:
--   1. AVE não tem graus: sai sempre autoavaliação e avaliação do gestor (sem par).
--   2. AVD tem dois graus: 180° (auto e gestor) e 360° (auto, gestor, pares e liderados).
--      O 360° fica travado até a Matriz liberar para a unidade (ops.gente_avd_liberacao_360).
--   3. Comentário obrigatório em todas as respostas da AVE e da AVD (gatilho na conclusão).
--   4. Modelos do documento "Avaliação de desempenho 2/2024", sem edição: Colaboradores e
--      especialistas (4 competências) e Liderança (6). Performance conta como desempenho e
--      Cultura como potencial no nine box.
--
-- AVD é por período (semestre): cada unidade tem um ciclo por modelo e período, com
-- `modelo` = 'avd_colab:2/2026' ou 'avd_lider:2/2026', copiado do molde por
-- ops.gente_avd_ciclo(). O índice único (modelo, unidade_id) continua valendo.

alter table ops.gente_ciclos add column if not exists comentario_obrigatorio boolean not null default false;
comment on column ops.gente_ciclos.comentario_obrigatorio is
  'Toda resposta precisa de comentário para a avaliação ser concluída (AVE e AVD, desde 29/10/2026).';

-- 1 e 3: AVE sem par e com comentário obrigatório, no molde e nas cópias das unidades.
update ops.gente_ciclos set tem_par = false, comentario_obrigatorio = true
 where modelo in ('ave45', 'ave90');

-- Cópia da AVE agora leva o comentário obrigatório.
create or replace function ops.gente_ave_ciclo(_unidade integer, _modelo text)
returns bigint
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $$
declare
  v_ciclo bigint;
  v_molde ops.gente_ciclos%rowtype;
  v_nome  text;
begin
  if not ops.can('manage.gente.avaliacao') then
    raise exception 'Sem permissão para conduzir avaliação.' using errcode = '42501';
  end if;
  if ops.can('data.scope.own_unit_only') and not (_unidade = any (ops.minhas_unidades_gente())) then
    raise exception 'Unidade fora do seu escopo.' using errcode = '42501';
  end if;

  select id into v_ciclo from ops.gente_ciclos
   where modelo = _modelo and unidade_id = _unidade and not e_modelo;
  if v_ciclo is not null then return v_ciclo; end if;

  select * into v_molde from ops.gente_ciclos where e_modelo and modelo = _modelo;
  if v_molde.id is null then
    raise exception 'Modelo de avaliação % não existe.', _modelo;
  end if;
  select nome_da_praca into v_nome from ops.unidades where id = _unidade;

  insert into ops.gente_ciclos (nome, status, origem, escala_min, escala_max, escala_rotulos,
    tem_auto, tem_gestor, tem_par, tem_liderado, modelo, e_modelo, instrucoes, unidade_id,
    periodo_inicio, comentario_obrigatorio)
  values (v_molde.nome || coalesce(' · ' || v_nome, ''), 'coleta', 'ops', v_molde.escala_min,
    v_molde.escala_max, v_molde.escala_rotulos, v_molde.tem_auto, v_molde.tem_gestor,
    v_molde.tem_par, v_molde.tem_liderado, _modelo, false, v_molde.instrucoes, _unidade, current_date,
    v_molde.comentario_obrigatorio)
  returning id into v_ciclo;

  insert into ops.gente_ciclo_topicos (ciclo_id, nome, descricao, ordem, tipos)
  select v_ciclo, nome, descricao, ordem, tipos from ops.gente_ciclo_topicos where ciclo_id = v_molde.id;

  insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
  select v_ciclo, cc.competencia_id, cc.ordem, cc.peso, novo.id, cc.opcoes, cc.titulo, cc.pergunta
    from ops.gente_ciclo_competencias cc
    left join ops.gente_ciclo_topicos velho on velho.id = cc.topico_id
    left join ops.gente_ciclo_topicos novo on novo.ciclo_id = v_ciclo and novo.nome = velho.nome
   where cc.ciclo_id = v_molde.id;

  return v_ciclo;
end $$;

revoke all on function ops.gente_ave_ciclo(integer, text) from public, anon;
grant execute on function ops.gente_ave_ciclo(integer, text) to authenticated;

-- 4. Modelos da AVD (gerados de scratchpad/gerar_avd.py a partir do documento) ----------
-- Avaliação de desempenho · Colaboradores e especialistas ---------------------------------------------------------------
insert into ops.gente_ciclos (nome, status, origem, escala_min, escala_max, escala_rotulos,
  tem_auto, tem_gestor, tem_par, tem_liderado, modelo, e_modelo, instrucoes, comentario_obrigatorio)
select 'Avaliação de desempenho · Colaboradores e especialistas', 'rascunho', 'ops', 1, 3,
  '{"1":"Abaixo do esperado","2":"Atende o esperado","3":"Supera o esperado"}'::jsonb,
  true, true, true, true, 'avd_colab', true, 'Olá! Esta é a Avaliação de desempenho da Planning.

Para cada competência, leia a descrição e marque a alternativa que melhor representa a atuação da pessoa no período: Abaixo do esperado, Atende o esperado ou Supera o esperado. O comentário é obrigatório em todas as respostas: é ele que vira feedback para quem é avaliado.

Em caso de dúvidas, contate o time de Gente e Gestão.', true
where not exists (select 1 from ops.gente_ciclos where e_modelo and modelo = 'avd_colab');

insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem)
select c.id, 'Performance', 0 from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'avd_colab'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Performance');

insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem)
select c.id, 'Cultura', 1 from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'avd_colab'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Cultura');

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Foco no cliente (AVD · colaboradores)', 'O colaborador assume o seu compromisso no atendimento e realização de todas as atividades que estão sob sua responsabilidade, cumprindo com todos os prazos acordados previamente, atende com qualidade as necessidades do cliente, contribui para o bom desempenho e clima da equipe e busca constantemente melhorar as suas entregas, aperfeiçoando o seu conhecimento técnico e reconhecendo a sua autorresponsabilidade no sucesso das entregas do time e na experiência do cliente.', 'avd_colab', 'desempenho', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Foco no cliente (AVD · colaboradores)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 1, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Cumpre parcialmente as suas responsabilidades dentro da função que está, é de costume perder prazos, oferece um atendimento tardio e sem resolução para o cliente, não contribui para um clima positivo na equipe, e não cumpre com o que lhe é proposto para melhorar as suas habilidades técnicas, não assumindo a sua responsabilidade no sucesso das entregas do time e dos clientes."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Cumpre suas responsabilidades, respeita os prazos, atende clientes com qualidade quando solicitado, contribui para um bom clima na equipe, busca melhorar suas habilidades técnicas sempre que orientado a respeito do que precisa desenvolver, visando uma melhor entrega e além de reconhecer sua responsabilidade no time e nos clientes."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Assume total responsabilidade por suas tarefas e apoia todos da equipe sempre que necessário, antecipa-se aos prazos, atende os clientes com altíssima qualidade e previsibilidade, é visto como uma pessoa chave por todo o time, por contribuir e influenciar um clima positivo, busca constantemente melhorar suas habilidades técnicas e interpessoais;"}]'::jsonb, 'Foco no cliente', 'O colaborador assume o seu compromisso no atendimento e realização de todas as atividades que estão sob sua responsabilidade, cumprindo com todos os prazos acordados previamente, atende com qualidade as necessidades do cliente, contribui para o bom desempenho e clima da equipe e busca constantemente melhorar as suas entregas, aperfeiçoando o seu conhecimento técnico e reconhecendo a sua autorresponsabilidade no sucesso das entregas do time e na experiência do cliente.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Foco no cliente (AVD · colaboradores)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Performance'
where c.e_modelo and c.modelo = 'avd_colab'
on conflict (ciclo_id, competencia_id) do nothing;

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Missão dada é missão cumprida (AVD · colaboradores)', 'O colaborador possui nível técnico suficiente para atender com qualidade todas as atividades que fazem parte do escopo da sua função, além de demonstrar interesse em absorver e resolver mais desafios na sua carreira, e em todas as missões que recebeu até o momento demonstrou autorresponsabilidade no sucesso das entregas do time, da empresa e do cliente, E, busca aperfeiçoar os seus conhecimentos técnicos para entregar com maior qualidade e se preparar para absorver novos desafios.', 'avd_colab', 'desempenho', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Missão dada é missão cumprida (AVD · colaboradores)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 2, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Seu nível técnico é insuficiente para atender com qualidade todas as suas atividades, não demonstra interesse em receber novos desafios, não assume autorresponsabilidade nas entregas e não busca aperfeiçoar seus conhecimentos técnicos para melhorar a qualidade dos seus entregáveis."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Possui o nível técnico necessário para realizar suas tarefas com qualidade, demonstra interesse em enfrentar novos desafios, assume responsabilidade pelas entregas e busca aprimorar seus conhecimentos técnicos quando orientado a respeito do que precisa ser feito para melhorar a qualidade dos seus entregáveis e se preparar para novos desafios."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Possui habilidades técnicas excepcionais, está sempre aberto a novos desafios e os enfrenta com entusiasmo, assume responsabilidade exemplar pelas entregas, e busca constantemente melhorar seus conhecimentos técnicos, entregando com alta qualidade além de ensinar e incentivar os colegas a fazerem o mesmo."}]'::jsonb, 'Missão dada é missão cumprida', 'O colaborador possui nível técnico suficiente para atender com qualidade todas as atividades que fazem parte do escopo da sua função, além de demonstrar interesse em absorver e resolver mais desafios na sua carreira, e em todas as missões que recebeu até o momento demonstrou autorresponsabilidade no sucesso das entregas do time, da empresa e do cliente, E, busca aperfeiçoar os seus conhecimentos técnicos para entregar com maior qualidade e se preparar para absorver novos desafios.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Missão dada é missão cumprida (AVD · colaboradores)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Performance'
where c.e_modelo and c.modelo = 'avd_colab'
on conflict (ciclo_id, competencia_id) do nothing;

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Visão de dono (AVD · colaboradores)', 'O colaborador atua como um verdadeiro dono, assumindo plena responsabilidade por suas entregas e pelas entregas do departamento. Possui uma postura proativa em resolver problemas e superar desafios, busca revisar e refinar continuamente o trabalho a fim de garantir excelência das suas entregas por ter consciência do impacto de sua atuação na empresa como um todo, além de promover um ambiente de trabalho colaborativo, demonstrando respeito e apoio aos colegas, facilitando a comunicação e cooperação, assim como, utiliza e aproveita os recursos e oportunidades oferecidas pela empresa para o desenvolvimento de sua carreira.', 'avd_colab', 'potencial', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Visão de dono (AVD · colaboradores)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 3, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Não assume plena responsabilidade por suas entregas, possui postura reativa e/ou resistente ao receber novos desafios, não demonstra interesse em se desenvolver tecnicamente, tem pouca consciência do impacto de suas ações, não contribui para um ambiente de trabalho colaborativo, e não utiliza adequadamente os recursos e oportunidades de desenvolvimento oferecidos pela empresa."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Assume responsabilidade por suas entregas, resolve os problemas que lhes são demandados, busca garantir a qualidade da entrega, tem consciência do impacto de suas ações e utiliza adequadamente os recursos e oportunidades de desenvolvimento oferecidos pela empresa quando solicitado."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Assume total responsabilidade pelas entregas do departamento, resolve problemas proativamente, busca continuamente a excelência, tem consciência do impacto de suas ações, promove um ambiente colaborativo, e utiliza plenamente os recursos e oportunidades de desenvolvimento oferecidos pela empresa."}]'::jsonb, 'Visão de dono', 'O colaborador atua como um verdadeiro dono, assumindo plena responsabilidade por suas entregas e pelas entregas do departamento. Possui uma postura proativa em resolver problemas e superar desafios, busca revisar e refinar continuamente o trabalho a fim de garantir excelência das suas entregas por ter consciência do impacto de sua atuação na empresa como um todo, além de promover um ambiente de trabalho colaborativo, demonstrando respeito e apoio aos colegas, facilitando a comunicação e cooperação, assim como, utiliza e aproveita os recursos e oportunidades oferecidas pela empresa para o desenvolvimento de sua carreira.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Visão de dono (AVD · colaboradores)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Cultura'
where c.e_modelo and c.modelo = 'avd_colab'
on conflict (ciclo_id, competencia_id) do nothing;

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Atuação pelo exemplo (AVD · colaboradores)', 'Colaborador transmite a cultura da empresa por meio de seus comportamentos, nas suas relações interpessoais em todas as interações e entregas, cumprindo com excelência todas as missões e responsabilidades que lhes são designadas, mostrando comprometimento e tempestividade diariamente, agindo como dono ao realizar entregas consistentes que reforçam o propósito da Planning, o que o torna uma pessoa que inspira, contagia, motiva e desenvolve os colegas.', 'avd_colab', 'potencial', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Atuação pelo exemplo (AVD · colaboradores)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 4, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "O colaborador não se identifica com a cultura da empresa, não demonstra foco no cliente, não cumpre com excelência as atividades designadas, falta comprometimento e tempestividade no que se propõe, não age como dono nas entregas e não inspira, contagia e motiva os colegas."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Se identifica com os valores da empresa, demonstra foco no cliente, cumpre com as atividades designadas a ele, apresenta comprometimento e tempestividade em suas entregas, além de inspirar, contagiar e motivar os colegas."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Transmite e identifica a cultura da empresa em suas relações interpessoais, demonstra foco no cliente, cumpre com excelência as entregas do departamento, mostra comprometimento e tempestividade, age como dono, além de inspirar, contagiar, motivar e desenvolver os colegas."}]'::jsonb, 'Atuação pelo exemplo', 'Colaborador transmite a cultura da empresa por meio de seus comportamentos, nas suas relações interpessoais em todas as interações e entregas, cumprindo com excelência todas as missões e responsabilidades que lhes são designadas, mostrando comprometimento e tempestividade diariamente, agindo como dono ao realizar entregas consistentes que reforçam o propósito da Planning, o que o torna uma pessoa que inspira, contagia, motiva e desenvolve os colegas.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Atuação pelo exemplo (AVD · colaboradores)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Cultura'
where c.e_modelo and c.modelo = 'avd_colab'
on conflict (ciclo_id, competencia_id) do nothing;

-- Avaliação de desempenho · Liderança ---------------------------------------------------------------
insert into ops.gente_ciclos (nome, status, origem, escala_min, escala_max, escala_rotulos,
  tem_auto, tem_gestor, tem_par, tem_liderado, modelo, e_modelo, instrucoes, comentario_obrigatorio)
select 'Avaliação de desempenho · Liderança', 'rascunho', 'ops', 1, 3,
  '{"1":"Abaixo do esperado","2":"Atende o esperado","3":"Supera o esperado"}'::jsonb,
  true, true, true, true, 'avd_lider', true, 'Olá! Esta é a Avaliação de desempenho da Planning.

Para cada competência, leia a descrição e marque a alternativa que melhor representa a atuação da pessoa no período: Abaixo do esperado, Atende o esperado ou Supera o esperado. O comentário é obrigatório em todas as respostas: é ele que vira feedback para quem é avaliado.

Em caso de dúvidas, contate o time de Gente e Gestão.', true
where not exists (select 1 from ops.gente_ciclos where e_modelo and modelo = 'avd_lider');

insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem)
select c.id, 'Performance', 0 from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'avd_lider'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Performance');

insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem)
select c.id, 'Cultura', 1 from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'avd_lider'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Cultura');

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Visão de dono (AVD · liderança)', 'A liderança atua como um verdadeiro dono, assume plena responsabilidade por suas entregas e do departamento. Possui uma postura proativa ao resolver problemas e superar desafios, busca revisar e refinar continuamente o trabalho para garantir a excelência das entregas da equipe. Tem plena consciência do impacto de sua atuação na empresa como um todo. Além de promover um ambiente colaborativo, demonstrando respeito e apoio a todos os membros do time. Aproveita os recursos e oportunidades oferecidos pela empresa para o desenvolvimento de carreira de todos da sua equipe.', 'avd_lider', 'potencial', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Visão de dono (AVD · liderança)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 1, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Não assume plena responsabilidade pela equipe, possui postura reativa e/ou resistente ao receber feedbacks a respeito da sua atuação, não demonstra interesse em se desenvolver tecnicamente e em gestão de pessoas, tem pouca consciência do impacto de suas ações, não contribui para um ambiente de trabalho colaborativo, e não utiliza adequadamente os recursos e oportunidades de desenvolvimento oferecidos pela empresa, influenciando de forma negativa o time."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Assume responsabilidade pelo seu time, resolve os problemas quando surgem, busca por melhoria contínua, tem consciência do impacto de suas ações na equipe e no cliente, atua em busca de um ambiente colaborativo, utiliza os recursos e oportunidades oferecidos pela empresa e direciona a equipe a fazer o mesmo."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Assume total responsabilidade pelo seu time, previne o surgimento de problemas, busca a excelência contínua das entregas, tem consciência do impacto das suas ações e da sua equipe na Planning como um todo, atua em busca de um ambiente colaborativo, e utiliza plenamente os recursos e oportunidades oferecidos pela empresa além de acompanhar os impactos gerados por meio de uma gestão pautada em controle e resultados."}]'::jsonb, 'Visão de dono', 'A liderança atua como um verdadeiro dono, assume plena responsabilidade por suas entregas e do departamento. Possui uma postura proativa ao resolver problemas e superar desafios, busca revisar e refinar continuamente o trabalho para garantir a excelência das entregas da equipe. Tem plena consciência do impacto de sua atuação na empresa como um todo. Além de promover um ambiente colaborativo, demonstrando respeito e apoio a todos os membros do time. Aproveita os recursos e oportunidades oferecidos pela empresa para o desenvolvimento de carreira de todos da sua equipe.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Visão de dono (AVD · liderança)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Cultura'
where c.e_modelo and c.modelo = 'avd_lider'
on conflict (ciclo_id, competencia_id) do nothing;

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Atuação pelo exemplo (AVD · liderança)', 'A liderança transmite a cultura da empresa por meio de seus comportamentos, demonstrando foco no cliente em todas as interações e entregas. Cumpre com excelência todas as missões e responsabilidades designadas, mostrando comprometimento e tempestividade diariamente. Agindo como dono ao realizar entregas consistentes que reforçam o propósito da empresa. Sua postura inspira, contagia, motiva e desenvolve o time.', 'avd_lider', 'potencial', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Atuação pelo exemplo (AVD · liderança)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 2, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Resolve parcialmente os desafios que surgem, não atende plenamente os prazos definidos, demonstra pouco compromisso com o cliente e equipe. Sua postura não reflete senso de dono, entregando resultados inconsistentes, dificultando o desenvolvimento dos membros da equipe."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Resolve os desafios que surgem com boa qualidade e dentro dos prazos, demonstra um compromisso com o cliente e equipe. Age como dono, entregando resultados que reforçam o propósito da Planning. Promove um ambiente de trabalho colaborativo, desenvolvendo os membros da equipe."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Supera todos os desafios com excelência, se antecipando aos prazos, demonstra um compromisso excepcional com o foco no cliente e na equipe. Age como dono, entregando resultados consistentes para a Planning. Sua postura inspira e motiva o time, promovendo um ambiente de trabalho colaborativo, desenvolvendo continuamente os membros da equipe."}]'::jsonb, 'Atuação pelo exemplo', 'A liderança transmite a cultura da empresa por meio de seus comportamentos, demonstrando foco no cliente em todas as interações e entregas. Cumpre com excelência todas as missões e responsabilidades designadas, mostrando comprometimento e tempestividade diariamente. Agindo como dono ao realizar entregas consistentes que reforçam o propósito da empresa. Sua postura inspira, contagia, motiva e desenvolve o time.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Atuação pelo exemplo (AVD · liderança)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Cultura'
where c.e_modelo and c.modelo = 'avd_lider'
on conflict (ciclo_id, competencia_id) do nothing;

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Comprometimento e tempestividade (AVD · liderança)', 'A liderança possui capacidade de assumir responsabilidades pelas tarefas, projetos e prazos da equipe, demonstrando um compromisso com a entrega e os resultados de alta qualidade dentro dos prazos estabelecidos. Empenha-se ativamente para cumprir as metas com eficiência e pontualidade além de tomar decisões complexas e estratégicas que afetam o rumo da equipe e da empresa.', 'avd_lider', 'desempenho', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Comprometimento e tempestividade (AVD · liderança)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 3, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Não assume um compromisso com as tarefas e projetos, comprometendo os prazos e a qualidade dos entregáveis. Não contribui nas decisões estratégicas e prejudica os resultados da equipe, pois não busca melhorias que desempenham um papel importante na empresa."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Demonstra um compromisso e cumpre com as tarefas e projetos dentro dos prazos sem comprometer a qualidade dos entregáveis. Toma decisões relevantes e direcionam a equipe de maneira clara atingindo resultados que beneficiam a empresa. Além de buscar melhorias que desempenha um papel importante nas entregas da equipe."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Demonstra um compromisso excepcional além de cumprir com as tarefas e projetos, antecipa-se aos prazos sem comprometer a alta qualidade dos entregáveis, garantindo resultados eficientes. Toma decisões complexas e estratégicas que direcionam a equipe de maneira clara atingindo resultados que beneficiam significativamente a empresa. Além de buscar melhorias contínuas que elevam o desempenho da equipe e da empresa como um todo."}]'::jsonb, 'Comprometimento e tempestividade', 'A liderança possui capacidade de assumir responsabilidades pelas tarefas, projetos e prazos da equipe, demonstrando um compromisso com a entrega e os resultados de alta qualidade dentro dos prazos estabelecidos. Empenha-se ativamente para cumprir as metas com eficiência e pontualidade além de tomar decisões complexas e estratégicas que afetam o rumo da equipe e da empresa.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Comprometimento e tempestividade (AVD · liderança)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Performance'
where c.e_modelo and c.modelo = 'avd_lider'
on conflict (ciclo_id, competencia_id) do nothing;

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Foco no cliente (AVD · liderança)', 'Se preocupa com a experiência dos clientes, resolvendo problemas rapidamente, distribuindo os desafios de forma adequada entre os colaboradores e entende o impacto do trabalho da equipe. Atua de forma educada, mantem um bom relacionamento com o cliente, intermedia conflitos, e deixa a equipe a par das particularidades do cliente. Além disso, estabelece prazos realistas, inspira a equipe a manter um bom relacionamento com o cliente, desenvolve planos abrangentes para atingir as metas estabelecidas e acompanhando de perto o progresso.', 'avd_lider', 'desempenho', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Foco no cliente (AVD · liderança)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 4, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "se preocupa com a experiência do cliente, demonstra desorganização com os prazos combinados. Dificulta a comunicação entre o cliente e a equipe, o que prejudica no atendimento das necessidades do cliente."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Oferece uma boa experiência aos clientes, se organiza para cumprir com os prazos estabelecidos. Sempre que necessário se comunica com o cliente de forma clara, e mantem um bom alinhamento com a equipe a respeito das particularidades do cliente."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Proporciona uma experiência excepcional aos clientes, otimiza o uso do tempo para alcançar resultados eficazes, se antecipando aos prazos estabelecidos. Entende o impacto do trabalho da equipe, atua de forma educada e mantém uma comunicação efetiva entre o cliente e o colaborador, garantindo um excelente relacionamento, pelo fato da equipe possuir conhecimento a respeito das particularidades de cada cliente."}]'::jsonb, 'Foco no cliente', 'Se preocupa com a experiência dos clientes, resolvendo problemas rapidamente, distribuindo os desafios de forma adequada entre os colaboradores e entende o impacto do trabalho da equipe. Atua de forma educada, mantem um bom relacionamento com o cliente, intermedia conflitos, e deixa a equipe a par das particularidades do cliente. Além disso, estabelece prazos realistas, inspira a equipe a manter um bom relacionamento com o cliente, desenvolve planos abrangentes para atingir as metas estabelecidas e acompanhando de perto o progresso.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Foco no cliente (AVD · liderança)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Performance'
where c.e_modelo and c.modelo = 'avd_lider'
on conflict (ciclo_id, competencia_id) do nothing;

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Gestão de pessoas (AVD · liderança)', 'A liderança administra a equipe de forma eficaz, orientando para resultados e promovendo um ambiente de trabalho colaborativo, produtivo e motivador. Conecta as necessidades individuais do time, alinhando e direcionando os talentos com os objetivos da empresa. Desenvolve relacionamentos saudáveis e produtivos por meio do cumprimento dos rituais de gestão. Identifica as necessidades de desenvolvimento da equipe, fornece orientação, recursos e oportunidades de aprendizado para capacitar o time a atingir seu potencial máximo.', 'avd_lider', 'desempenho', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Gestão de pessoas (AVD · liderança)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 5, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Assume postura distante dos colaboradores, não promovendo um ambiente de trabalho colaborativo. Não traz clareza nos feedbacks realizados sendo inconstante na realização dos rituais de gestão, deixando a equipe sem clareza a respeito dos próximos passos em sua carreira."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Administra a sua equipe, atrai novos colaboradores de forma assertiva, além de reter e desenvolver todos para os desafios da empresa. Investe no crescimento profissional dos colaboradores, realiza os rituais de gestão, mantendo a equipe alinhada e com clareza de carreira."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Administra de forma excepcional a sua equipe, retendo e desenvolvendo todos para os desafios da empresa. Investe no crescimento profissional dos colaboradores, realiza constantemente os rituais de gestão de forma assertiva, promovendo um ambiente colaborativo e de aprendizado contínuo, que consequentemente contribui para o progresso individual e sucesso coletivo."}]'::jsonb, 'Gestão de pessoas', 'A liderança administra a equipe de forma eficaz, orientando para resultados e promovendo um ambiente de trabalho colaborativo, produtivo e motivador. Conecta as necessidades individuais do time, alinhando e direcionando os talentos com os objetivos da empresa. Desenvolve relacionamentos saudáveis e produtivos por meio do cumprimento dos rituais de gestão. Identifica as necessidades de desenvolvimento da equipe, fornece orientação, recursos e oportunidades de aprendizado para capacitar o time a atingir seu potencial máximo.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Gestão de pessoas (AVD · liderança)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Performance'
where c.e_modelo and c.modelo = 'avd_lider'
on conflict (ciclo_id, competencia_id) do nothing;

insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Missão dada é missão cumprida (AVD · liderança)', 'A liderança demonstra um apurado senso de responsabilidade, comprometendo-se com os objetivos da equipe e da empresa. Assume total responsabilidade por suas ações e decisões, garantindo que prazos sejam cumpridos de forma eficiente. Comunica-se claramente com todas as partes envolvidas, assegurando que todos estejam alinhados. Além disso, possui habilidades, competências e conhecimentos necessários para a execução bem-sucedida das tarefas e responsabilidades do seu cargo.', 'avd_lider', 'desempenho', true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Missão dada é missão cumprida (AVD · liderança)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 6, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Assume postura passiva ao receber novos desafios e mantém todas as atividades sob o seu controle apresentando dificuldade em delegar e alinhar as expectativas para o time, deixando-os sem direcionamento a respeito que é esperado para sua carreira."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Atende tudo o que lhe é proposto, mantendo a qualidade nas entregas com o apoio do time. Direciona e incentiva a equipe a se preparar para novos desafios utilizando o potencial de cada um, e os mantém alinhados por meio de uma comunicação clara a respeito da evolução da sua carreira."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Tem um senso apurado para identificar desafios e oportunidade, atendendo-as de forma tempestiva, e garante alto nível de qualidade das suas entregas, com o apoio e engajamento de todo o time, e constantemente se mostra aberto a receber novos desafios. É um exemplo de autorresponsabilidade e desenvolve essa competência na equipe mantendo todos alinhados, valorizando o papel de cada um nos projetos, além de promover ações de capacitação para todo o time."}]'::jsonb, 'Missão dada é missão cumprida', 'A liderança demonstra um apurado senso de responsabilidade, comprometendo-se com os objetivos da equipe e da empresa. Assume total responsabilidade por suas ações e decisões, garantindo que prazos sejam cumpridos de forma eficiente. Comunica-se claramente com todas as partes envolvidas, assegurando que todos estejam alinhados. Além disso, possui habilidades, competências e conhecimentos necessários para a execução bem-sucedida das tarefas e responsabilidades do seu cargo.'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Missão dada é missão cumprida (AVD · liderança)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Performance'
where c.e_modelo and c.modelo = 'avd_lider'
on conflict (ciclo_id, competencia_id) do nothing;

-- Ciclo da AVD da unidade para o modelo e o período, criado do molde na primeira vez.
create or replace function ops.gente_avd_ciclo(_unidade integer, _modelo text, _periodo text)
returns bigint
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $$
declare
  v_ciclo bigint;
  v_molde ops.gente_ciclos%rowtype;
  v_nome  text;
  v_chave text := _modelo || ':' || _periodo;
begin
  if not ops.can('manage.gente.avaliacao') then
    raise exception 'Sem permissão para conduzir avaliação.' using errcode = '42501';
  end if;
  if ops.can('data.scope.own_unit_only') and not (_unidade = any (ops.minhas_unidades_gente())) then
    raise exception 'Unidade fora do seu escopo.' using errcode = '42501';
  end if;
  if _modelo not in ('avd_colab', 'avd_lider') then
    raise exception 'Modelo de AVD inválido.' using errcode = '22023';
  end if;
  if _periodo !~ '^[12]/20[0-9]{2}$' then
    raise exception 'Período no formato 1/2026 ou 2/2026.' using errcode = '22023';
  end if;

  select id into v_ciclo from ops.gente_ciclos
   where modelo = v_chave and unidade_id = _unidade and not e_modelo;
  if v_ciclo is not null then return v_ciclo; end if;

  select * into v_molde from ops.gente_ciclos where e_modelo and modelo = _modelo;
  if v_molde.id is null then
    raise exception 'Modelo de avaliação % não existe.', _modelo;
  end if;
  select nome_da_praca into v_nome from ops.unidades where id = _unidade;

  insert into ops.gente_ciclos (nome, status, origem, escala_min, escala_max, escala_rotulos,
    tem_auto, tem_gestor, tem_par, tem_liderado, modelo, e_modelo, instrucoes, unidade_id,
    periodo_inicio, comentario_obrigatorio)
  values (v_molde.nome || ' ' || _periodo || coalesce(' · ' || v_nome, ''), 'coleta', 'ops',
    v_molde.escala_min, v_molde.escala_max, v_molde.escala_rotulos, v_molde.tem_auto,
    v_molde.tem_gestor, v_molde.tem_par, v_molde.tem_liderado, v_chave, false, v_molde.instrucoes,
    _unidade, current_date, v_molde.comentario_obrigatorio)
  returning id into v_ciclo;

  insert into ops.gente_ciclo_topicos (ciclo_id, nome, descricao, ordem, tipos)
  select v_ciclo, nome, descricao, ordem, tipos from ops.gente_ciclo_topicos where ciclo_id = v_molde.id;

  insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
  select v_ciclo, cc.competencia_id, cc.ordem, cc.peso, novo.id, cc.opcoes, cc.titulo, cc.pergunta
    from ops.gente_ciclo_competencias cc
    left join ops.gente_ciclo_topicos velho on velho.id = cc.topico_id
    left join ops.gente_ciclo_topicos novo on novo.ciclo_id = v_ciclo and novo.nome = velho.nome
   where cc.ciclo_id = v_molde.id;

  return v_ciclo;
end $$;

revoke all on function ops.gente_avd_ciclo(integer, text, text) from public, anon;
grant execute on function ops.gente_avd_ciclo(integer, text, text) to authenticated;

-- 2. 360° da AVD liberado pela Matriz, por unidade ----------------------------------------
create table if not exists ops.gente_avd_liberacao_360 (
  unidade_id integer primary key references ops.unidades (id),
  liberado_por uuid default auth.uid(),
  liberado_em timestamptz not null default now()
);
alter table ops.gente_avd_liberacao_360 enable row level security;
revoke all on ops.gente_avd_liberacao_360 from public, anon, authenticated;
grant select, insert, delete on ops.gente_avd_liberacao_360 to authenticated;

-- Quem conduz avaliação vê; só a Matriz (sem recorte de unidade) libera ou trava.
drop policy if exists gente_avd_360_ler on ops.gente_avd_liberacao_360;
create policy gente_avd_360_ler on ops.gente_avd_liberacao_360
  for select to authenticated using (ops.can('manage.gente.avaliacao'));
drop policy if exists gente_avd_360_liberar on ops.gente_avd_liberacao_360;
create policy gente_avd_360_liberar on ops.gente_avd_liberacao_360
  for insert to authenticated
  with check (ops.can('manage.gente.avaliacao') and not ops.can('data.scope.own_unit_only'));
drop policy if exists gente_avd_360_travar on ops.gente_avd_liberacao_360;
create policy gente_avd_360_travar on ops.gente_avd_liberacao_360
  for delete to authenticated
  using (ops.can('manage.gente.avaliacao') and not ops.can('data.scope.own_unit_only'));

-- O banco também barra par e liderado na AVD de unidade sem a liberação, e par na AVE.
create or replace function ops.gente_avaliacao_conferir_grau()
returns trigger
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $$
declare
  v_modelo text;
  v_unidade integer;
begin
  if new.tipo not in ('par', 'liderado') then return new; end if;
  select modelo, unidade_id into v_modelo, v_unidade from ops.gente_ciclos where id = new.ciclo_id;
  if v_modelo in ('ave45', 'ave90') then
    raise exception 'A avaliação de experiência é só autoavaliação e gestor.' using errcode = '23514';
  end if;
  if v_modelo like 'avd\_%' and not exists (
       select 1 from ops.gente_avd_liberacao_360 l where l.unidade_id = v_unidade) then
    raise exception 'O 360° da avaliação de desempenho precisa da liberação da Matriz.' using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function ops.gente_avaliacao_conferir_grau() from public, anon, authenticated;
drop trigger if exists gente_avaliacoes_conferir_grau on ops.gente_avaliacoes;
create trigger gente_avaliacoes_conferir_grau before insert on ops.gente_avaliacoes
  for each row execute function ops.gente_avaliacao_conferir_grau();

-- 3. Comentário obrigatório na conclusão ------------------------------------------------
create or replace function ops.gente_avaliacao_conferir_comentarios()
returns trigger
language plpgsql
security definer
set search_path = ops, public, pg_temp
as $$
declare
  v_faltam integer;
begin
  if new.status <> 'concluida' or old.status = 'concluida' then return new; end if;
  if not coalesce((select comentario_obrigatorio from ops.gente_ciclos where id = new.ciclo_id), false) then
    return new;
  end if;
  select count(*) into v_faltam
    from ops.gente_ciclo_competencias cc
    left join ops.gente_ciclo_topicos t on t.id = cc.topico_id
    left join ops.gente_avaliacao_respostas r
      on r.avaliacao_id = new.id and r.competencia_id = cc.competencia_id
   where cc.ciclo_id = new.ciclo_id
     and (t.tipos is null or new.tipo = any (t.tipos))
     and not coalesce(r.nao_se_aplica, false)
     and (r.nota is null or nullif(btrim(r.comentario), '') is null);
  if v_faltam > 0 then
    raise exception 'Responda e comente todas as perguntas antes de concluir (faltam %).', v_faltam
      using errcode = '23514';
  end if;
  return new;
end $$;

revoke all on function ops.gente_avaliacao_conferir_comentarios() from public, anon, authenticated;
drop trigger if exists gente_avaliacoes_conferir_comentarios on ops.gente_avaliacoes;
create trigger gente_avaliacoes_conferir_comentarios before update of status on ops.gente_avaliacoes
  for each row execute function ops.gente_avaliacao_conferir_comentarios();
