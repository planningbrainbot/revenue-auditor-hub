-- Permissões por área (15/09/2026)
--
-- Dois níveis, conforme PLANO-PERMISSOES-POR-AREA.md:
--   1. o PAPEL abre ÁREAS;
--   2. o USUÁRIO enxerga UNIDADES (Ops) e EMPRESAS (Brain Financeiro).
--
-- As 96 policies que chamam ops.can('chave') NÃO são reescritas. A chave vira
-- detalhe de implementação: uma tabela de ponte diz a que área cada uma
-- pertence, e can() passa a perguntar pela área. Reescrever 96 policies num
-- banco com 24 pessoas trabalhando seria 96 chances de errar para um ganho que
-- ninguém vê.
--
-- ops.role_permissions fica INTACTA. Deixa de ser consultada, mas é o retrato
-- para rollback: basta restaurar a versão antiga de ops.can().

-- ─────────────────────────────────────────────────────────────
-- 1. Catálogo
-- ─────────────────────────────────────────────────────────────
create table if not exists ops.areas (
  slug       text primary key,
  nome       text not null,
  descricao  text not null default '',
  -- Qual filtro de nível 2 faz sentido dentro desta área.
  escopo     text not null default 'unidade'
             check (escopo in ('unidade', 'empresa', 'nenhum')),
  ordem      int  not null default 0,
  ativa      boolean not null default true
);

create table if not exists ops.area_chaves (
  area           text not null references ops.areas(slug) on delete cascade,
  permission_key text not null,
  primary key (area, permission_key)
);
-- can() entra por aqui: chave -> áreas que a contêm.
create index if not exists area_chaves_key_idx on ops.area_chaves (permission_key);

-- ─────────────────────────────────────────────────────────────
-- 2. Nível 1: papel -> áreas
-- ─────────────────────────────────────────────────────────────
create table if not exists ops.role_areas (
  role       text not null references ops.roles(key) on delete cascade,
  area       text not null references ops.areas(slug) on delete cascade,
  allowed    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (role, area)
);

-- ─────────────────────────────────────────────────────────────
-- 3. Nível 2: usuário -> escopo
-- ─────────────────────────────────────────────────────────────
-- "todas" é explícito, e não ausência de linhas. Sem a flag, um backfill que
-- esquecesse alguém deixaria a pessoa vendo tudo por omissão, que é o defeito
-- que se paga caro descobrir.
create table if not exists ops.usuario_escopo (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  todas_unidades  boolean not null default false,
  todas_empresas  boolean not null default false,
  updated_at      timestamptz not null default now()
);

create table if not exists ops.usuario_unidades (
  user_id    uuid not null references auth.users(id) on delete cascade,
  unidade_id int  not null references ops.unidades(id) on delete cascade,
  primary key (user_id, unidade_id)
);

-- empresa_id é financeiro.empresas(id). Sem FK entre schemas de propósito: o
-- Financeiro é outro produto e não deve travar um DELETE do Ops.
create table if not exists ops.usuario_empresas (
  user_id    uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null,
  primary key (user_id, empresa_id)
);

-- ─────────────────────────────────────────────────────────────
-- 4. As 10 áreas
-- ─────────────────────────────────────────────────────────────
insert into ops.areas (slug, nome, descricao, escopo, ordem) values
  ('rede',          'Rede',               'Como a rede está indo: overview, IDU, indicadores e realizado.', 'unidade', 10),
  ('clientes',      'Clientes',           'Carteira, CS, NPS, disparos e base de contatos.',                 'unidade', 20),
  ('receita',       'Receita e Repasses', 'Funil, contas a receber, repasses das unidades e comissões.',     'unidade', 30),
  ('people',        'Planning People',    'Pessoas das unidades: cadastro, 1:1, feedback, clima e avaliação.','unidade', 40),
  ('monetizacao',   'Monetização',        'Fila de oportunidades de receita na base que já é nossa.',        'unidade', 50),
  ('broker',        'Broker',             'A fila de oportunidades, que a unidade opera.',                   'unidade', 60),
  -- Separada de propósito: multiplicador e composição de CAC são camada
  -- interna e não circulam na rede. Juntar as duas faria "a área libera tudo"
  -- entregar o preço de custo a quem compra.
  ('broker_matriz', 'Broker · Matriz',    'Matriz do broker: multiplicador, carteira e custo apurado.',      'unidade', 65),
  -- O menu do sócio regional. Hoje é lista fixa em app-sidebar.tsx sem
  -- checagem nenhuma; vira área para ter dono e para que dar "Contas a Receber"
  -- ao sócio não signifique dar comissões e DRE junto.
  ('minha_unidade', 'Minha Unidade',      'O que o sócio regional vê da própria unidade.',                   'unidade', 70),
  ('admin',         'Administração',      'Usuários, papéis, permissões, integrações e qualidade da base.',  'nenhum',  80),
  ('financeiro',    'Brain Financeiro',   'Cockpit financeiro, em outro produto.',                           'empresa', 90)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem;

-- ─────────────────────────────────────────────────────────────
-- 5. A ponte: 73 chaves (as 66 da tela + 7 que só existiam no banco)
-- ─────────────────────────────────────────────────────────────
-- As 7 órfãs (manage.gente.avaliacao, view.gente.avaliacao, manage.gente.clima,
-- view.gente.clima, view.csc_faturamento, edit.csc_faturamento,
-- view.qualidade_base) eram exigidas por policy e não existiam em
-- KNOWN_PERMISSIONS, então não havia como concedê-las pela tela. Quatro tabelas
-- estavam ilegíveis para todo mundo por causa disso.
insert into ops.area_chaves (area, permission_key) values
  ('rede','view.hub'), ('rede','view.painel_unidade'), ('rede','view.idu'),
  ('rede','edit.idu_metas'), ('rede','view.indicadores_trimestre'),
  ('rede','view.network.benchmarks'), ('rede','view.rede_realizado'),
  ('rede','view.rede_ltv'), ('rede','view.rede_headcount'),

  ('clientes','view.clientes'), ('clientes','view.painel_cs'),
  ('clientes','view.auditoria_interna'), ('clientes','view.reforma_tributaria'),
  ('clientes','view.nps'), ('clientes','view.disparos_whatsapp'),
  ('clientes','view.base_contatos'), ('clientes','view.contatos'),
  ('clientes','manage.clientes_churn'),

  ('receita','view.funil_receita'), ('receita','view.roas'),
  ('receita','view.reconciliacao'), ('receita','view.contas_receber'),
  ('receita','view.bi_vendas'), ('receita','view.unidades_rede'),
  ('receita','view.royalties_historico'), ('receita','view.royalties_split'),
  ('receita','view.despesas_partners'), ('receita','view.comissoes'),
  ('receita','view.ebit_operacional'), ('receita','view.financeiro_partners'),
  ('receita','view.meus_royalties'), ('receita','view.auditoria'),
  ('receita','view.auditoria.cac'), ('receita','view.auditoria.royalties'),
  ('receita','view.auditoria.unmapped'), ('receita','manage.repasses'),
  ('receita','view.csc_faturamento'), ('receita','edit.csc_faturamento'),

  ('people','view.gente'), ('people','view.gente.individual'),
  ('people','view.gente.agregado'), ('people','view.gente.um_a_um'),
  ('people','view.gente.feedback'), ('people','view.gente.clima'),
  ('people','manage.gente.clima'), ('people','view.gente.avaliacao'),
  ('people','manage.gente.avaliacao'), ('people','manage.gente'),

  ('monetizacao','view.fila_cella'), ('monetizacao','manage.fila_cella'),
  ('monetizacao','manage.fila_cella_sync'), ('monetizacao','manage.fila_cella_override'),
  ('monetizacao','manage.de_para_cnpj'),

  ('broker','view.broker'),
  ('broker_matriz','view.broker_admin'), ('broker_matriz','manage.broker'),

  -- minha_unidade repete chaves de outras áreas de propósito: a mesma página
  -- pode pertencer a mais de uma área, e can() pergunta se ALGUMA área
  -- concedida contém a chave.
  ('minha_unidade','view.painel_unidade'), ('minha_unidade','view.clientes'),
  ('minha_unidade','view.painel_cs'), ('minha_unidade','view.nps'),
  ('minha_unidade','view.contatos'), ('minha_unidade','view.broker'),
  ('minha_unidade','view.funil_receita'), ('minha_unidade','view.contas_receber'),
  ('minha_unidade','view.meus_royalties'), ('minha_unidade','view.idu'),

  ('admin','view.admin.users'), ('admin','view.admin.profiles'),
  ('admin','view.admin.permissions'), ('admin','view.admin.integracoes'),
  ('admin','view.admin.credenciais'), ('admin','view.atividade'),
  ('admin','view.qualidade_base'),

  ('financeiro','view.brain_financeiro')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────
-- 6. A matriz de corte
-- ─────────────────────────────────────────────────────────────
-- Preserva o acesso de hoje (ninguém perde página) e alarga onde o modelo
-- obriga. O alargamento está listado no PLANO; corrige-se na tela.
insert into ops.role_areas (role, area) values
  ('admin','rede'),('admin','clientes'),('admin','receita'),('admin','people'),
  ('admin','monetizacao'),('admin','broker'),('admin','broker_matriz'),
  ('admin','minha_unidade'),('admin','admin'),('admin','financeiro'),

  ('diretor','rede'),('diretor','clientes'),('diretor','receita'),
  ('diretor','people'),('diretor','monetizacao'),('diretor','broker'),
  ('diretor','broker_matriz'),

  ('head','rede'),('head','clientes'),('head','receita'),('head','people'),

  ('auditor','rede'),('auditor','clientes'),('auditor','receita'),

  ('socio','rede'),('socio','clientes'),('socio','receita'),('socio','people'),

  ('socio_regional','minha_unidade'),('socio_regional','people'),

  ('cs','rede'),('cs','clientes'),('cs','receita'),

  ('diretoria_comercial','clientes'),

  ('financeiro','financeiro')
on conflict (role, area) do update set allowed = true, updated_at = now();

-- ─────────────────────────────────────────────────────────────
-- 7. Backfill do escopo
-- ─────────────────────────────────────────────────────────────
-- Quem hoje NÃO tem data.scope.own_unit_only enxerga a rede toda. Traduzir isso
-- em "todas as unidades" mantém o comportamento idêntico no corte.
insert into ops.usuario_escopo (user_id, todas_unidades, todas_empresas)
select ur.user_id,
       not bool_or(coalesce(rp.allowed, false)),
       true
  from ops.user_roles ur
  left join ops.role_permissions rp
         on rp.role = ur.role
        and rp.permission_key = 'data.scope.own_unit_only'
 group by ur.user_id
on conflict (user_id) do update
  set todas_unidades = excluded.todas_unidades,
      todas_empresas = excluded.todas_empresas,
      updated_at = now();

-- Para quem fica restrito, a unidade vem de socios.unidade, com os mesmos
-- apelidos que ops.unidades_do_usuario() já aplicava.
insert into ops.usuario_unidades (user_id, unidade_id)
select distinct e.user_id, u.id
  from ops.usuario_escopo e
  join ops.socios s on s.user_id = e.user_id
  join ops.unidades u
    on ops.norm_unidade(u.nome_da_praca) = ops.norm_unidade(s.unidade)
    or (ops.norm_unidade(s.unidade) in ('sudeste (rj)','rj')
        and ops.norm_unidade(u.nome_da_praca) = 'rio de janeiro')
    or (ops.norm_unidade(s.unidade) in ('goiania / matriz','goiania')
        and ops.norm_unidade(u.nome_da_praca) = 'matriz')
 where e.todas_unidades = false
on conflict do nothing;

-- Escopo de empresa: hoje é chave de PAPEL (view.brain_financeiro_*), o que faz
-- os 8 usuários do papel `financeiro` verem os 8 escopos. Até a Fase 3 ligar o
-- grant por pessoa, todo mundo segue com todas_empresas = true, que reproduz o
-- comportamento atual sem tirar acesso de ninguém no corte.

-- ─────────────────────────────────────────────────────────────
-- 8. can() passa a responder pela área
-- ─────────────────────────────────────────────────────────────
create or replace function ops.can(_key text)
returns boolean
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select case
    -- Escopo, não permissão. As 8 policies que perguntam isso querem saber
    -- "esta pessoa está limitada à própria unidade?", e a resposta agora mora
    -- em usuario_escopo. O nome da chave fica até a Fase 4 renomear nas policies.
    when _key = 'data.scope.own_unit_only' then
      not coalesce(
        (select e.todas_unidades from ops.usuario_escopo e where e.user_id = auth.uid()),
        false
      )
    else exists (
      select 1
        from ops.user_roles ur
        join ops.role_areas  ra  on ra.role = ur.role and ra.allowed
        join ops.area_chaves ac  on ac.area = ra.area
        join ops.areas       a   on a.slug  = ra.area and a.ativa
       where ur.user_id = auth.uid()
         and ac.permission_key = _key
    )
  end
$function$;

-- Nova: "esta pessoa tem esta ÁREA?". É o que o menu e as telas passam a usar.
create or replace function ops.tem_area(_area text)
returns boolean
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select exists (
    select 1
      from ops.user_roles ur
      join ops.role_areas ra on ra.role = ur.role and ra.allowed
      join ops.areas      a  on a.slug  = ra.area and a.ativa
     where ur.user_id = auth.uid()
       and ra.area = _area
  )
$function$;

-- ─────────────────────────────────────────────────────────────
-- 9. As funções de unidade passam a ler o escopo do usuário
-- ─────────────────────────────────────────────────────────────
-- Mesma assinatura e mesmo contrato de retorno das antigas, para que as 11
-- policies que as chamam não precisem mudar. O que muda é a fonte: tabela
-- explícita em vez de casamento de texto com socios.unidade.
create or replace function ops.minhas_unidades()
returns setof integer
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select uu.unidade_id from ops.usuario_unidades uu where uu.user_id = auth.uid()
$function$;

create or replace function ops.current_user_unidade()
returns text
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select u.nome_da_praca
    from ops.usuario_unidades uu
    join ops.unidades u on u.id = uu.unidade_id
   where uu.user_id = auth.uid()
   order by u.id
   limit 1
$function$;

create or replace function ops.unidades_do_usuario()
returns text[]
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  -- Os apelidos continuam: o dado gravado em contas_receber e omie_clientes diz
  -- 'Sudeste (RJ)' e 'Partners' onde a tabela de unidades diz outra coisa.
  with minhas as (
    select ops.norm_unidade(u.nome_da_praca) as u
      from ops.usuario_unidades uu
      join ops.unidades u on u.id = uu.unidade_id
     where uu.user_id = auth.uid()
  ),
  pares (a, b) as (
    values ('rio de janeiro',   'sudeste (rj)'),
           ('rio de janeiro',   'rj'),
           ('matriz',           'goiania / matriz'),
           ('matriz',           'goiania')
  )
  select case when not exists (select 1 from minhas) then null
         else array(
           select distinct v from (
                      select u from minhas
             union all select p.b from pares p join minhas m on p.a = m.u
             union all select p.a from pares p join minhas m on p.b = m.u
           ) t(v) where v is not null
         )
         end
$function$;

-- ─────────────────────────────────────────────────────────────
-- 10. RLS das tabelas novas
-- ─────────────────────────────────────────────────────────────
alter table ops.areas            enable row level security;
alter table ops.area_chaves      enable row level security;
alter table ops.role_areas       enable row level security;
alter table ops.usuario_escopo   enable row level security;
alter table ops.usuario_unidades enable row level security;
alter table ops.usuario_empresas enable row level security;

-- Catálogo é público para quem está logado: o menu precisa ler as áreas.
drop policy if exists areas_select on ops.areas;
create policy areas_select on ops.areas for select to authenticated using (true);

drop policy if exists area_chaves_select on ops.area_chaves;
create policy area_chaves_select on ops.area_chaves for select to authenticated using (true);

drop policy if exists role_areas_select on ops.role_areas;
create policy role_areas_select on ops.role_areas for select to authenticated using (true);

-- Escrever a matriz e o escopo é de quem administra permissão.
drop policy if exists role_areas_write on ops.role_areas;
create policy role_areas_write on ops.role_areas for all to authenticated
  using (ops.can('view.admin.permissions')) with check (ops.can('view.admin.permissions'));

drop policy if exists areas_write on ops.areas;
create policy areas_write on ops.areas for all to authenticated
  using (ops.can('view.admin.permissions')) with check (ops.can('view.admin.permissions'));

drop policy if exists area_chaves_write on ops.area_chaves;
create policy area_chaves_write on ops.area_chaves for all to authenticated
  using (ops.can('view.admin.permissions')) with check (ops.can('view.admin.permissions'));

-- Cada pessoa lê o próprio escopo (o app precisa saber o filtro); quem
-- administra usuários lê e escreve o de todo mundo.
drop policy if exists usuario_escopo_select on ops.usuario_escopo;
create policy usuario_escopo_select on ops.usuario_escopo for select to authenticated
  using (user_id = auth.uid() or ops.can('view.admin.users'));
drop policy if exists usuario_escopo_write on ops.usuario_escopo;
create policy usuario_escopo_write on ops.usuario_escopo for all to authenticated
  using (ops.can('view.admin.users')) with check (ops.can('view.admin.users'));

drop policy if exists usuario_unidades_select on ops.usuario_unidades;
create policy usuario_unidades_select on ops.usuario_unidades for select to authenticated
  using (user_id = auth.uid() or ops.can('view.admin.users'));
drop policy if exists usuario_unidades_write on ops.usuario_unidades;
create policy usuario_unidades_write on ops.usuario_unidades for all to authenticated
  using (ops.can('view.admin.users')) with check (ops.can('view.admin.users'));

drop policy if exists usuario_empresas_select on ops.usuario_empresas;
create policy usuario_empresas_select on ops.usuario_empresas for select to authenticated
  using (user_id = auth.uid() or ops.can('view.admin.users'));
drop policy if exists usuario_empresas_write on ops.usuario_empresas;
create policy usuario_empresas_write on ops.usuario_empresas for all to authenticated
  using (ops.can('view.admin.users')) with check (ops.can('view.admin.users'));
