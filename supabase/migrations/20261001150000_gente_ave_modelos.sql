-- Avaliação de experiência (AVE) de 45 e 90 dias, enviada pelo RH a partir do
-- radar (01/10/2026, pedido do RH de Maceió).
--
-- Até aqui o motor de avaliação tinha um único questionário por ciclo. A AVE
-- tem dois: a autoavaliação e a do líder fazem perguntas diferentes sobre a
-- mesma pessoa. E cada pergunta tem três respostas escritas, não uma nota
-- solta. Por isso:
--   - `gente_ciclo_topicos.tipos`: quais avaliadores respondem o tópico
--     (auto, gestor, par, liderado). Nulo = todos, como era antes.
--   - `gente_ciclo_competencias.opcoes`: as alternativas da pergunta, cada
--     uma com a nota que grava. Nulo = a régua numérica do ciclo.
--   - `gente_ciclos.instrucoes`: o texto de abertura do formulário.
--   - `gente_ciclos.modelo` + `e_modelo`: o ciclo-modelo (sem unidade, nunca
--     coletado) e a cópia de cada unidade, criada no primeiro envio por
--     `gente_ave_ciclo()`.
--
-- As perguntas são as dos modelos .docx do RH (Planning Expansão/Operação/
-- Gente & Gestão), transcritas por script, sem edição. Notas: Abaixo = 1,
-- Atende = 2, Supera = 3; na efetivação, Não efetivar = 1 e Efetivar = 2.
-- Competência da AVE não tem eixo, então não entra no nine box.

begin;

alter table ops.gente_ciclo_topicos add column if not exists tipos text[];
alter table ops.gente_ciclo_competencias add column if not exists opcoes jsonb;
-- Título curto e texto da pergunta no ciclo: o catálogo exige nome único na
-- rede inteira, e "Adaptação" já existe (veio do Qulture).
alter table ops.gente_ciclo_competencias add column if not exists titulo text;
alter table ops.gente_ciclo_competencias add column if not exists pergunta text;
alter table ops.gente_ciclos add column if not exists instrucoes text;
alter table ops.gente_ciclos add column if not exists modelo text;
alter table ops.gente_ciclos add column if not exists e_modelo boolean not null default false;

comment on column ops.gente_ciclo_topicos.tipos is 'Avaliadores que respondem o tópico (auto, gestor, par, liderado). Nulo = todos.';
comment on column ops.gente_ciclo_competencias.opcoes is 'Alternativas da pergunta: [{nota, rotulo, descricao}]. Nulo = régua numérica do ciclo.';
comment on column ops.gente_ciclos.modelo is 'Família do ciclo (ave45, ave90). Uma cópia por unidade, criada por gente_ave_ciclo().';
comment on column ops.gente_ciclos.e_modelo is 'Ciclo-modelo: só serve de molde, não coleta e não aparece na tela.';

-- Uma cópia aberta por unidade e modelo.
create unique index if not exists gente_ciclos_modelo_unidade
  on ops.gente_ciclos (modelo, unidade_id) where modelo is not null and not e_modelo;
create unique index if not exists gente_ciclos_modelo_molde
  on ops.gente_ciclos (modelo) where e_modelo;

-- O molde nunca aparece: nem na tela, nem pela API. Só `gente_ave_ciclo()`, que
-- é SECURITY DEFINER, lê. Tópicos e perguntas dele somem junto, pelas
-- RESTRICTIVE de 20260930150000 que exigem o ciclo pai visível.
drop policy if exists gente_ciclos_sem_molde on ops.gente_ciclos;
create policy gente_ciclos_sem_molde on ops.gente_ciclos
  as restrictive for all to authenticated
  using (not e_modelo);

-- Ciclo da unidade para o modelo, criado do molde na primeira vez.
-- SECURITY DEFINER porque o molde não tem unidade e a cópia precisa nascer com
-- tópicos e perguntas, que o sócio regional não teria como clonar pela RLS. A
-- autoridade é checada aqui dentro, com as mesmas funções das policies.
create or replace function ops.gente_ave_ciclo(_unidade integer, _modelo text)
returns bigint
language plpgsql
security definer
set search_path = ops, public
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
    tem_auto, tem_gestor, tem_par, tem_liderado, modelo, e_modelo, instrucoes, unidade_id, periodo_inicio)
  values (v_molde.nome || coalesce(' · ' || v_nome, ''), 'coleta', 'ops', v_molde.escala_min,
    v_molde.escala_max, v_molde.escala_rotulos, v_molde.tem_auto, v_molde.tem_gestor,
    v_molde.tem_par, v_molde.tem_liderado, _modelo, false, v_molde.instrucoes, _unidade, current_date)
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

-- Avaliação de experiência 45 dias ---------------------------------------------------------
insert into ops.gente_ciclos (nome, status, origem, escala_min, escala_max, escala_rotulos,
  tem_auto, tem_gestor, tem_par, tem_liderado, modelo, e_modelo, instrucoes)
select 'Avaliação de experiência 45 dias', 'rascunho', 'ops', 1, 3,
  '{"1":"Abaixo do esperado","2":"Atende o esperado","3":"Supera o esperado"}'::jsonb,
  true, true, true, false, 'ave45', true, 'Olá! Seja bem-vindo(a) à Avaliação do Período de Experiência 45 Dias! 👋

A presente avaliação é um processo que realizamos para analisar o desempenho e a adequação do(a) colaborador(a) durante os primeiros 45 dias de empresa. Avaliaremos as habilidades necessárias para a organização e o alinhamento com a cultura, o que permitirá identificar pontos fortes e áreas de melhoria para o seu desenvolvimento contínuo.

Para responder a avaliação, marque uma alternativa como resposta para cada pergunta e deixe seu comentário para justificar sua escolha. Simples e fácil.

Em caso de dúvidas, contate o time de Gente e Gestão.'
where not exists (select 1 from ops.gente_ciclos where e_modelo and modelo = 'ave45');

insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem, tipos)
select c.id, 'Autoavaliação', 0, array['auto']::text[] from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'ave45'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Autoavaliação');
insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem, tipos)
select c.id, 'Avaliação da empresa e do líder', 1, array['auto']::text[] from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'ave45'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Avaliação da empresa e do líder');
insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem, tipos)
select c.id, 'Avaliação do líder sobre o colaborador', 2, array['gestor','par']::text[] from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'ave45'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador');
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Adaptação (AVE 45 · autoavaliação)', 'Nesses primeiros 45 dias, você já teve oportunidade de conhecer melhor a empresa, sua rotina de trabalho, os processos da área e a forma como o time atua no dia a dia.

Considerando esse período, como você avalia sua adaptação até o momento?', 'ave45:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Adaptação (AVE 45 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 1, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda estou com dificuldades relevantes para me adaptar à rotina, aos processos ou à dinâmica da equipe."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Estou me adaptando bem, compreendo a maior parte da rotina e me sinto cada vez mais confortável no dia a dia."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Estou muito bem adaptado(a), atuo com segurança na rotina e me sinto plenamente integrado(a) ao contexto da área."}]'::jsonb, 'Adaptação', 'Nesses primeiros 45 dias, você já teve oportunidade de conhecer melhor a empresa, sua rotina de trabalho, os processos da área e a forma como o time atua no dia a dia.

Considerando esse período, como você avalia sua adaptação até o momento?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Adaptação (AVE 45 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Relacionamento Interpessoal (AVE 45 · autoavaliação)', 'O relacionamento interpessoal está relacionado à forma como você se conecta, se comunica e constrói relações no ambiente de trabalho, contribuindo para uma convivência respeitosa, colaborativa e produtiva.

Com base na sua experiência até aqui, como você avalia seu relacionamento interpessoal na empresa?', 'ave45:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Relacionamento Interpessoal (AVE 45 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 2, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda encontro dificuldades para me comunicar ou me relacionar com pessoas e equipes no dia a dia."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Tenho um bom relacionamento com o time e consigo me comunicar de forma respeitosa e colaborativa."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Construí relações positivas, colaboro ativamente com outras pessoas e contribuo para um ambiente saudável e produtivo."}]'::jsonb, 'Relacionamento Interpessoal', 'O relacionamento interpessoal está relacionado à forma como você se conecta, se comunica e constrói relações no ambiente de trabalho, contribuindo para uma convivência respeitosa, colaborativa e produtiva.

Com base na sua experiência até aqui, como você avalia seu relacionamento interpessoal na empresa?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Relacionamento Interpessoal (AVE 45 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Engajamento (AVE 45 · autoavaliação)', 'Engajamento e motivação dizem respeito ao seu envolvimento com as atividades, interesse em aprender, disposição para contribuir e conexão com o trabalho realizado.

Levando isso em consideração, como você avalia seu nível de engajamento e motivação nesses 45 dias?', 'ave45:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Engajamento (AVE 45 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 3, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda me sinto pouco envolvido(a) com as atividades ou com dificuldade para encontrar motivação na rotina."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Estou engajado(a), motivado(a) e comprometido(a) com minhas atividades e com o aprendizado nesse início."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Estou muito engajado(a), participo ativamente da rotina, demonstro iniciativa e tenho vontade de contribuir cada vez mais."}]'::jsonb, 'Engajamento', 'Engajamento e motivação dizem respeito ao seu envolvimento com as atividades, interesse em aprender, disposição para contribuir e conexão com o trabalho realizado.

Levando isso em consideração, como você avalia seu nível de engajamento e motivação nesses 45 dias?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Engajamento (AVE 45 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Missão dada é missão cumprida (AVE 45 · autoavaliação)', 'Esse valor está relacionado ao compromisso com as entregas assumidas, à responsabilidade com prazos e à qualidade do que é executado, sempre considerando o momento de adaptação e aprendizagem.

Pensando nas demandas que já assumiu até aqui, como você avalia sua postura em relação às entregas?', 'ave45:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Missão dada é missão cumprida (AVE 45 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 4, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda tenho dificuldade para conduzir minhas entregas e preciso de apoio frequente para cumprir o que foi solicitado."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Tenho conseguido realizar as entregas sob minha responsabilidade com qualidade e dentro do esperado para esse momento."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Além de cumprir bem minhas entregas, demonstro autonomia, organização e responsabilidade diante das demandas."}]'::jsonb, 'Missão dada é missão cumprida', 'Esse valor está relacionado ao compromisso com as entregas assumidas, à responsabilidade com prazos e à qualidade do que é executado, sempre considerando o momento de adaptação e aprendizagem.

Pensando nas demandas que já assumiu até aqui, como você avalia sua postura em relação às entregas?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Missão dada é missão cumprida (AVE 45 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Clareza (AVE 45 · autoavaliação)', 'Ao longo desses 45 dias, você já teve contato com atividades, direcionamentos e interações que ajudam a compreender melhor seu papel, suas prioridades e seu desenvolvimento dentro da empresa.

Como você avalia sua clareza sobre seu papel e seus próximos passos na empresa?', 'ave45:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Clareza (AVE 45 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 5, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda tenho dúvidas relevantes sobre minhas responsabilidades, prioridades ou sobre como posso evoluir na empresa."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Tenho uma boa compreensão do meu papel, das prioridades da função e dos pontos que preciso desenvolver."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Tenho clareza sobre minha atuação, entendo meus próximos passos e busco meu desenvolvimento de forma ativa e consistente."}]'::jsonb, 'Clareza', 'Ao longo desses 45 dias, você já teve contato com atividades, direcionamentos e interações que ajudam a compreender melhor seu papel, suas prioridades e seu desenvolvimento dentro da empresa.

Como você avalia sua clareza sobre seu papel e seus próximos passos na empresa?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Clareza (AVE 45 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Integração (AVE 45 · autoavaliação)', 'Pensando na sua experiência com acolhimento, ambiente de trabalho, integração ao time e suporte recebido pela empresa nesse período.

Como você avalia sua experiência geral nesses primeiros 45 dias na empresa?', 'ave45:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Integração (AVE 45 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 6, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Minha experiência até aqui teve dificuldades importantes que impactaram minha integração ou meu bem-estar."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Minha experiência tem sido positiva, com acolhimento, suporte e ambiente adequado para minha adaptação."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Minha experiência tem sido muito positiva, me sinto acolhido(a), valorizado(a) e bem integrado(a) à empresa."}]'::jsonb, 'Integração', 'Pensando na sua experiência com acolhimento, ambiente de trabalho, integração ao time e suporte recebido pela empresa nesse período.

Como você avalia sua experiência geral nesses primeiros 45 dias na empresa?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Integração (AVE 45 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação da empresa e do líder'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Liderança (AVE 45 · autoavaliação)', 'A liderança direta tem papel importante no alinhamento das expectativas, no direcionamento das atividades, no apoio à adaptação e no desenvolvimento inicial.

Como você avalia o apoio da sua liderança direta nesses primeiros 45 dias?', 'ave45:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Liderança (AVE 45 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 7, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Senti pouca presença, direcionamento ou apoio da liderança nesse período."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Recebi apoio, alinhamentos e direcionamentos adequados da minha liderança."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Minha liderança tem sido muito presente, acessível, clara e importante para minha adaptação e desenvolvimento."}]'::jsonb, 'Liderança', 'A liderança direta tem papel importante no alinhamento das expectativas, no direcionamento das atividades, no apoio à adaptação e no desenvolvimento inicial.

Como você avalia o apoio da sua liderança direta nesses primeiros 45 dias?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Liderança (AVE 45 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação da empresa e do líder'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Adaptação (AVE 45 · líder)', 'Sabemos que a adaptação de um(a) novo(a) colaborador(a) envolve compreender a cultura da empresa, se integrar à equipe, entender os processos e se sentir seguro(a) nas responsabilidades do cargo.

Com base na sua percepção, como você avalia o processo de adaptação deste(a) colaborador(a) até o momento?', 'ave45:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Adaptação (AVE 45 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 8, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda demonstra dificuldades para entender o funcionamento da empresa ou para se integrar à equipe."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Já está integrado(a), demonstra segurança com os processos e boa relação com o time."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Adaptou-se rapidamente, entende bem o contexto, mostra fluidez nas entregas e já contribui com consistência."}]'::jsonb, 'Adaptação', 'Sabemos que a adaptação de um(a) novo(a) colaborador(a) envolve compreender a cultura da empresa, se integrar à equipe, entender os processos e se sentir seguro(a) nas responsabilidades do cargo.

Com base na sua percepção, como você avalia o processo de adaptação deste(a) colaborador(a) até o momento?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Adaptação (AVE 45 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Relacionamento Interpessoal (AVE 45 · líder)', 'O relacionamento interpessoal diz respeito à forma como o(a) colaborador(a) se comunica e se conecta com as pessoas no ambiente de trabalho, de maneira respeitosa, colaborativa e positiva, tanto com colegas quanto com lideranças.

Com base na sua percepção, como você avalia o relacionamento interpessoal deste(a) colaborador(a) até agora?', 'ave45:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Relacionamento Interpessoal (AVE 45 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 9, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Demonstra dificuldades para se relacionar com algumas pessoas ou equipes."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Se comunica e colabora de forma adequada com todos."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Construiu boas conexões, colabora ativamente e contribui para um ambiente positivo."}]'::jsonb, 'Relacionamento Interpessoal', 'O relacionamento interpessoal diz respeito à forma como o(a) colaborador(a) se comunica e se conecta com as pessoas no ambiente de trabalho, de maneira respeitosa, colaborativa e positiva, tanto com colegas quanto com lideranças.

Com base na sua percepção, como você avalia o relacionamento interpessoal deste(a) colaborador(a) até agora?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Relacionamento Interpessoal (AVE 45 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Engajamento (AVE 45 · líder)', 'Engajamento e motivação dizem respeito ao interesse demonstrado pelo(a) colaborador(a) nas atividades, sua disposição em aprender, vontade de contribuir e percepção de propósito no trabalho do dia a dia.

Com base na sua percepção, como você avalia o nível de engajamento e motivação deste(a) colaborador(a) neste início?', 'ave45:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Engajamento (AVE 45 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 10, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Tem demonstrado pouco envolvimento ou dificuldade em se manter motivado(a) nas atividades."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Mantém-se engajado(a) e motivado(a) com as demandas e rotinas do cargo."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Está muito envolvido(a) com as atividades, demonstra iniciativa, curiosidade e entusiasmo pelos desafios."}]'::jsonb, 'Engajamento', 'Engajamento e motivação dizem respeito ao interesse demonstrado pelo(a) colaborador(a) nas atividades, sua disposição em aprender, vontade de contribuir e percepção de propósito no trabalho do dia a dia.

Com base na sua percepção, como você avalia o nível de engajamento e motivação deste(a) colaborador(a) neste início?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Engajamento (AVE 45 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Missão dada é missão cumprida (AVE 45 · líder)', 'Esse valor representa a responsabilidade do(a) colaborador(a) com as entregas assumidas: cumprir o que foi combinado, finalizar tarefas com qualidade e dentro dos prazos estabelecidos.

Sabemos que o(a) colaborador(a) ainda tem pouco tempo de empresa, então considere as atividades de forma geral.

Com base nisso, como você avalia a postura dele(a) em relação às demandas que têm sido atribuídas até agora?', 'ave45:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Missão dada é missão cumprida (AVE 45 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 11, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Demonstra dificuldades em cumprir o que é solicitado ou precisa de apoio frequente para finalizar as tarefas."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Entrega o que é solicitado, dentro dos prazos e com a qualidade esperada."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Entrega com qualidade, se antecipa às demandas e assume responsabilidades com autonomia."}]'::jsonb, 'Missão dada é missão cumprida', 'Esse valor representa a responsabilidade do(a) colaborador(a) com as entregas assumidas: cumprir o que foi combinado, finalizar tarefas com qualidade e dentro dos prazos estabelecidos.

Sabemos que o(a) colaborador(a) ainda tem pouco tempo de empresa, então considere as atividades de forma geral.

Com base nisso, como você avalia a postura dele(a) em relação às demandas que têm sido atribuídas até agora?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Missão dada é missão cumprida (AVE 45 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Clareza (AVE 45 · líder)', 'Ao longo desses primeiros 45 dias, o(a) colaborador(a) teve contato com atividades, orientações e vivências que contribuem para compreender melhor seu papel, suas prioridades e seu desenvolvimento dentro da empresa.

Com base na sua percepção, como você avalia o nível de clareza deste(a) colaborador(a) sobre sua atuação e próximos passos?', 'ave45:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Clareza (AVE 45 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 12, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda demonstra dúvidas frequentes sobre seu papel, prioridades ou sobre como evoluir na função."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Demonstra boa compreensão sobre sua atuação, prioridades e pontos que precisa desenvolver."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Tem clareza sobre seu papel, entende seus próximos passos e demonstra postura ativa em seu desenvolvimento."}]'::jsonb, 'Clareza', 'Ao longo desses primeiros 45 dias, o(a) colaborador(a) teve contato com atividades, orientações e vivências que contribuem para compreender melhor seu papel, suas prioridades e seu desenvolvimento dentro da empresa.

Com base na sua percepção, como você avalia o nível de clareza deste(a) colaborador(a) sobre sua atuação e próximos passos?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Clareza (AVE 45 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Integração (AVE 45 · líder)', 'Pensando em acolhimento, integração ao time, ambiente de trabalho e adaptação à empresa como um todo.

Como você avalia a experiência de integração deste(a) colaborador(a) nesses primeiros 45 dias?', 'ave45:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Integração (AVE 45 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 13, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "O processo de integração apresentou dificuldades importantes que impactaram sua adaptação."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "O(a) colaborador(a) demonstra estar bem integrado(a), com adaptação adequada ao ambiente e à rotina."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "O processo de integração foi muito positivo, e o(a) colaborador(a) demonstra forte conexão com a equipe e com a empresa."}]'::jsonb, 'Integração', 'Pensando em acolhimento, integração ao time, ambiente de trabalho e adaptação à empresa como um todo.

Como você avalia a experiência de integração deste(a) colaborador(a) nesses primeiros 45 dias?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Integração (AVE 45 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Liderança (AVE 45 · líder)', 'Este item considera a forma como o(a) colaborador(a) responde aos alinhamentos, orientações e acompanhamentos realizados pela liderança direta nesse período inicial.

Com base na sua percepção, como tem sido a relação de trabalho e acompanhamento com este(a) colaborador(a) até aqui?', 'ave45:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Liderança (AVE 45 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 14, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Há dificuldades recorrentes de alinhamento, acompanhamento ou resposta aos direcionamentos."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "O(a) colaborador(a) responde bem aos alinhamentos, recebe orientações de forma adequada e mantém boa relação com a liderança."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "O(a) colaborador(a) demonstra maturidade, abertura aos feedbacks, boa capacidade de alinhamento e evolução consistente com apoio da liderança."}]'::jsonb, 'Liderança', 'Este item considera a forma como o(a) colaborador(a) responde aos alinhamentos, orientações e acompanhamentos realizados pela liderança direta nesse período inicial.

Com base na sua percepção, como tem sido a relação de trabalho e acompanhamento com este(a) colaborador(a) até aqui?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Liderança (AVE 45 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave45'
on conflict (ciclo_id, competencia_id) do nothing;

-- Avaliação de experiência 90 dias ---------------------------------------------------------
insert into ops.gente_ciclos (nome, status, origem, escala_min, escala_max, escala_rotulos,
  tem_auto, tem_gestor, tem_par, tem_liderado, modelo, e_modelo, instrucoes)
select 'Avaliação de experiência 90 dias', 'rascunho', 'ops', 1, 3,
  '{"1":"Abaixo do esperado","2":"Atende o esperado","3":"Supera o esperado"}'::jsonb,
  true, true, true, false, 'ave90', true, 'Olá! Seja bem-vindo(a) à Avaliação do Período de Experiência - 90 Dias 👋

A presente avaliação é um processo que realizamos para analisar o desempenho e a adequação do(a) colaborador(a) durante os primeiros meses na empresa. Avaliaremos o alinhamento cultural e performance, o que permitirá compreender a satisfação do(a) colaborador(a) para auxiliar no seu desenvolvimento contínuo.

Para responder a avaliação, marque uma alternativa como resposta para cada pergunta e deixe seu comentário para justificar sua escolha. Simples e fácil.

Em caso de dúvidas, contate o time de Gente e Gestão.'
where not exists (select 1 from ops.gente_ciclos where e_modelo and modelo = 'ave90');

insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem, tipos)
select c.id, 'Autoavaliação', 0, array['auto']::text[] from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'ave90'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Autoavaliação');
insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem, tipos)
select c.id, 'Avaliação do líder sobre o colaborador', 1, array['gestor','par']::text[] from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'ave90'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador');
insert into ops.gente_ciclo_topicos (ciclo_id, nome, ordem, tipos)
select c.id, 'Decisão de efetivação', 2, array['gestor']::text[] from ops.gente_ciclos c
where c.e_modelo and c.modelo = 'ave90'
  and not exists (select 1 from ops.gente_ciclo_topicos t where t.ciclo_id = c.id and t.nome = 'Decisão de efetivação');
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Desempenho e Entregas (AVE 90 · autoavaliação)', 'Este tópico avalia sua capacidade de cumprir prazos, entregar com qualidade e assumir responsabilidades com autonomia.

Considerando sua rotina até aqui, como você avalia sua entrega nas atividades e demandas que foram atribuídas a você?', 'ave90:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Desempenho e Entregas (AVE 90 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 1, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Enfrento dificuldades para entregar com qualidade ou dentro dos prazos."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Entrego o que me é solicitado, com qualidade e no tempo certo."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Entrego com autonomia, constância e agrego valor além do solicitado."}]'::jsonb, 'Desempenho e Entregas', 'Este tópico avalia sua capacidade de cumprir prazos, entregar com qualidade e assumir responsabilidades com autonomia.

Considerando sua rotina até aqui, como você avalia sua entrega nas atividades e demandas que foram atribuídas a você?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Desempenho e Entregas (AVE 90 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Adaptação às mudanças (AVE 90 · autoavaliação)', 'A mudança é uma constante na Planning. Mudamos caminhos, processos e decisões sempre que necessário para atender às necessidades do negócio e seguir em evolução.

Considerando seu processo de integração até aqui, como você avalia sua adaptação a esse ambiente dinâmico?', 'ave90:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Adaptação às mudanças (AVE 90 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 2, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Tenho dificuldades para me adaptar às mudanças de rota ou ajustes de prioridades."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Consigo lidar com mudanças de forma natural, mesmo que algumas ainda exijam esforço."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Me adapto com facilidade, lido bem com mudanças e mantenho o foco mesmo diante de redirecionamentos."}]'::jsonb, 'Adaptação às mudanças', 'A mudança é uma constante na Planning. Mudamos caminhos, processos e decisões sempre que necessário para atender às necessidades do negócio e seguir em evolução.

Considerando seu processo de integração até aqui, como você avalia sua adaptação a esse ambiente dinâmico?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Adaptação às mudanças (AVE 90 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Foco no cliente – Culture Code (AVE 90 · autoavaliação)', 'Todos os colaboradores devem estar comprometidos com a excelência nas entregas e com o atendimento às necessidades dos nossos clientes, sejam eles internos ou externos.

Considerando o seu período de 90 dias, como você avalia a qualidade do seu trabalho e sua atenção ao cliente?', 'ave90:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Foco no cliente – Culture Code (AVE 90 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 3, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda estou me ajustando e nem sempre consigo entregar com o nível de qualidade ou foco no cliente que a Planning espera."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Entrego com responsabilidade, me esforço para manter a qualidade e priorizo o cliente nas minhas decisões."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Entrego com excelência, penso no impacto das minhas ações para o cliente e procuro superar as expectativas sempre que possível."}]'::jsonb, 'Foco no cliente – Culture Code', 'Todos os colaboradores devem estar comprometidos com a excelência nas entregas e com o atendimento às necessidades dos nossos clientes, sejam eles internos ou externos.

Considerando o seu período de 90 dias, como você avalia a qualidade do seu trabalho e sua atenção ao cliente?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Foco no cliente – Culture Code (AVE 90 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Clareza (AVE 90 · autoavaliação)', 'Saber o que se espera de você desde o início é fundamental para um bom desempenho e adaptação.

Como você avalia a clareza que a Planning te ofereceu em relação ao seu papel, às responsabilidades e às expectativas sobre sua função nesses primeiros 90 dias?', 'ave90:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Clareza (AVE 90 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 4, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda tenho dúvidas sobre meu papel ou senti falta de direcionamento claro."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Recebi orientações claras e entendo bem minhas responsabilidades."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Tive total clareza desde o início e me sinto seguro(a) sobre o que se espera de mim."}]'::jsonb, 'Clareza', 'Saber o que se espera de você desde o início é fundamental para um bom desempenho e adaptação.

Como você avalia a clareza que a Planning te ofereceu em relação ao seu papel, às responsabilidades e às expectativas sobre sua função nesses primeiros 90 dias?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Clareza (AVE 90 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Liderança (AVE 90 · autoavaliação)', 'A liderança tem um papel fundamental no desenvolvimento e na experiência do colaborador.

Considerando seus primeiros 90 dias, como você avalia o apoio da sua liderança direta em relação à presença, orientação, feedbacks e acompanhamento do seu desenvolvimento?', 'ave90:auto', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Liderança (AVE 90 · autoavaliação)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 5, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Senti falta de direcionamento, presença ou suporte consistente por parte da liderança."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Recebi os direcionamentos e feedbacks necessários, com presença adequada da liderança."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "A liderança é próxima, disponível e estratégica, contribuindo diretamente para meu desenvolvimento e confiança no dia a dia."}]'::jsonb, 'Liderança', 'A liderança tem um papel fundamental no desenvolvimento e na experiência do colaborador.

Considerando seus primeiros 90 dias, como você avalia o apoio da sua liderança direta em relação à presença, orientação, feedbacks e acompanhamento do seu desenvolvimento?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Liderança (AVE 90 · autoavaliação)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Autoavaliação'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Desempenho e Entregas (AVE 90 · líder)', 'Este tópico avalia a capacidade da pessoa colaboradora de cumprir prazos, entregar com qualidade e assumir responsabilidades com autonomia.

Com base nos últimos 90 dias, como você avalia a entrega deste(a) colaborador(a) nas atividades e demandas atribuídas?', 'ave90:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Desempenho e Entregas (AVE 90 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 6, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Apresenta dificuldades para entregar com qualidade ou dentro dos prazos definidos."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Entrega o que é solicitado com qualidade e no tempo certo."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Entrega com autonomia, constância e agrega valor além do que foi solicitado."}]'::jsonb, 'Desempenho e Entregas', 'Este tópico avalia a capacidade da pessoa colaboradora de cumprir prazos, entregar com qualidade e assumir responsabilidades com autonomia.

Com base nos últimos 90 dias, como você avalia a entrega deste(a) colaborador(a) nas atividades e demandas atribuídas?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Desempenho e Entregas (AVE 90 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Adaptação às mudanças (AVE 90 · líder)', 'A mudança é uma constante na Planning. Mudamos caminhos, processos e decisões sempre que necessário para atender às necessidades do negócio e seguir em evolução.

Considerando os primeiros 90 dias deste(a) colaborador(a), como você avalia sua adaptação a esse ambiente dinâmico e em constante transformação?', 'ave90:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Adaptação às mudanças (AVE 90 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 7, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Demonstra dificuldades em lidar com mudanças de rota ou ajustes de prioridades."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Lida com mudanças de forma adequada, mesmo que algumas ainda exijam mais tempo de adaptação."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Adapta-se com facilidade, mantém o foco diante de mudanças e contribui positivamente durante transições ou redirecionamentos."}]'::jsonb, 'Adaptação às mudanças', 'A mudança é uma constante na Planning. Mudamos caminhos, processos e decisões sempre que necessário para atender às necessidades do negócio e seguir em evolução.

Considerando os primeiros 90 dias deste(a) colaborador(a), como você avalia sua adaptação a esse ambiente dinâmico e em constante transformação?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Adaptação às mudanças (AVE 90 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Foco no cliente – Culture Code (AVE 90 · líder)', 'Todos os colaboradores devem estar comprometidos com a excelência nas entregas e com o atendimento às necessidades dos nossos clientes, sejam eles internos ou externos.

Considerando os primeiros 90 dias deste(a) colaborador(a), como você avalia a qualidade do seu trabalho e sua atenção ao cliente?', 'ave90:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Foco no cliente – Culture Code (AVE 90 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 8, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda demonstra dificuldade em manter a qualidade nas entregas ou em priorizar as necessidades do cliente."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Entrega com responsabilidade, mantém a qualidade e considera o cliente em suas decisões."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Entrega com excelência, tem visão clara do impacto no cliente e busca constantemente superar as expectativas."}]'::jsonb, 'Foco no cliente – Culture Code', 'Todos os colaboradores devem estar comprometidos com a excelência nas entregas e com o atendimento às necessidades dos nossos clientes, sejam eles internos ou externos.

Considerando os primeiros 90 dias deste(a) colaborador(a), como você avalia a qualidade do seu trabalho e sua atenção ao cliente?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Foco no cliente – Culture Code (AVE 90 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Clareza (AVE 90 · líder)', 'Saber o que se espera desde o início é fundamental para o bom desempenho e adaptação de um(a) novo(a) colaborador(a).

Com base nos primeiros 90 dias, como você avalia o nível de compreensão que este(a) colaborador(a) demonstra sobre seu papel, responsabilidades e expectativas da função?', 'ave90:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Clareza (AVE 90 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 9, 1, t.id, '[{"nota": 1, "rotulo": "Abaixo do esperado", "descricao": "Ainda apresenta dúvidas frequentes sobre o que se espera dele(a) ou mostra falta de segurança nas entregas."}, {"nota": 2, "rotulo": "Atende o esperado", "descricao": "Demonstra boa compreensão sobre seu papel e entrega de acordo com o que foi orientado."}, {"nota": 3, "rotulo": "Supera o esperado", "descricao": "Tem total clareza do seu papel, age com segurança e autonomia, e demonstra entendimento estratégico das suas responsabilidades."}]'::jsonb, 'Clareza', 'Saber o que se espera desde o início é fundamental para o bom desempenho e adaptação de um(a) novo(a) colaborador(a).

Com base nos primeiros 90 dias, como você avalia o nível de compreensão que este(a) colaborador(a) demonstra sobre seu papel, responsabilidades e expectativas da função?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Clareza (AVE 90 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Avaliação do líder sobre o colaborador'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;
insert into ops.gente_competencias (nome, descricao, categoria, eixo, ativa)
select 'Efetivação (AVE 90 · líder)', 'Com base no desempenho apresentado até aqui, indique sua recomendação em relação à efetivação deste(a) colaborador(a) ao final do período de experiência.

Qual é a sua decisão sobre a efetivação deste(a) colaborador(a)?', 'ave90:lider', null, true
where not exists (select 1 from ops.gente_competencias where lower(btrim(nome)) = lower(btrim('Efetivação (AVE 90 · líder)')));
insert into ops.gente_ciclo_competencias (ciclo_id, competencia_id, ordem, peso, topico_id, opcoes, titulo, pergunta)
select c.id, g.id, 10, 1, t.id, '[{"nota": 2, "rotulo": "Efetivar", "descricao": null}, {"nota": 1, "rotulo": "Não efetivar", "descricao": null}]'::jsonb, 'Efetivação', 'Com base no desempenho apresentado até aqui, indique sua recomendação em relação à efetivação deste(a) colaborador(a) ao final do período de experiência.

Qual é a sua decisão sobre a efetivação deste(a) colaborador(a)?'
from ops.gente_ciclos c
join ops.gente_competencias g on lower(btrim(g.nome)) = lower(btrim('Efetivação (AVE 90 · líder)'))
join ops.gente_ciclo_topicos t on t.ciclo_id = c.id and t.nome = 'Decisão de efetivação'
where c.e_modelo and c.modelo = 'ave90'
on conflict (ciclo_id, competencia_id) do nothing;

commit;
