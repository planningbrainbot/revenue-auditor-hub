-- ────────────────────────────────────────────────────────────────────────────────────────────
-- PARTE 1 — `ops.can` ganha uma irmã que aceita a pessoa explicitamente.
--
-- POR QUE: `ops.can(_key)` pergunta por `auth.uid()`. Isso funciona dentro de policy de RLS,
-- onde existe uma sessão. Não funciona no servidor do Ops, que fala com o banco como
-- `service_role` — ali `auth.uid()` é nulo e a resposta seria sempre falsa. É por isso que
-- `assertAdmin` no TypeScript usa `has_role(_user_id, _role)` com a pessoa explícita, e não
-- `can`. Para o admin delegado precisamos do mesmo, mas por CHAVE.
--
-- E ESCREVO UMA SÓ VEZ. `ops.can(_key)` passa a ser `select ops.can_user(auth.uid(), _key)`.
-- Duplicar a lógica nas duas seria criar a redundância que este trabalho veio evitar: a regra
-- do `data.scope.own_unit_only` é sutil (ela é NEGADA, lê `usuario_escopo.todas_unidades`) e
-- duas cópias divergem na primeira manutenção.
--
-- RISCO E COMO ELE É CONTIDO: 111 policies chamam `ops.can`. Trocar o corpo dela alcança o Ops
-- inteiro. Por isso o GATE compara o retrato de TODAS as 2.624 combinações (pessoa × chave)
-- guardado em `ops._can_antes_20260915` contra o resultado depois. Uma única diferença e a
-- migration aborta.
--
-- `create or replace` aqui É substituição de verdade: a assinatura `(_key text)` não muda.
-- (Fosse diferente, criaria sobrecarga — a armadilha que já custou caro nesta casa.)
--
-- REVERSÃO: reaplicar o corpo antigo de `ops.can`, que está inteiro no comentário abaixo.
--   select case when _key = 'data.scope.own_unit_only' then
--            not coalesce((select e.todas_unidades from ops.usuario_escopo e
--                           where e.user_id = auth.uid()), false)
--          else exists (select 1 from ops.user_roles ur
--                         join ops.role_areas ra on ra.role = ur.role and ra.allowed
--                         join ops.area_chaves ac on ac.area = ra.area
--                         join ops.areas a on a.slug = ra.area and a.ativa
--                        where ur.user_id = auth.uid() and ac.permission_key = _key) end
-- ────────────────────────────────────────────────────────────────────────────────────────────

create or replace function ops.can_user(_user_id uuid, _key text)
returns boolean
language sql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select case
    when _user_id is null then false
    -- Escopo, não permissão. As policies que perguntam isso querem saber "esta pessoa está
    -- limitada à própria unidade?", e a resposta mora em usuario_escopo. Mantido igualzinho
    -- ao corpo original de ops.can — inclusive o coalesce, que faz "sem linha" valer como
    -- "não tem todas as unidades", logo LIMITADA.
    when _key = 'data.scope.own_unit_only' then
      not coalesce(
        (select e.todas_unidades from ops.usuario_escopo e where e.user_id = _user_id),
        false
      )
    else exists (
      select 1
        from ops.user_roles ur
        join ops.role_areas  ra on ra.role = ur.role and ra.allowed
        join ops.area_chaves ac on ac.area = ra.area
        join ops.areas       a  on a.slug  = ra.area and a.ativa
       where ur.user_id = _user_id
         and ac.permission_key = _key
    )
  end
$function$;

create or replace function ops.can(_key text)
returns boolean
language sql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select ops.can_user(auth.uid(), _key)
$function$;

revoke execute on function ops.can_user(uuid, text) from public, anon;
grant  execute on function ops.can_user(uuid, text) to authenticated, service_role;

-- ── GATE · nenhuma das 2.624 combinações mudou de resposta ─────────────────────────────────
do $gate$
declare v_dif int; v_amostra text;
begin
  select count(*), coalesce(string_agg(x, ' ; '), '')
    into v_dif, v_amostra
    from (
      select a.user_id::text || '/' || a.permission_key || ': antes=' || a.pode::text
             || ' agora=' || ops.can_user(a.user_id, a.permission_key)::text as x
        from ops._can_antes_20260915 a
       where a.pode is distinct from ops.can_user(a.user_id, a.permission_key)
       limit 5
    ) d;
  if v_dif > 0 then
    raise exception 'GATE FALHOU: % combinação(ões) mudaram de resposta. Amostra: %', v_dif, v_amostra;
  end if;
  raise notice 'GATE ok · as 2.624 combinações (pessoa x chave) respondem igual. ops.can trocada com seguranca.';
end $gate$;
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- PARTE 2 — ADMIN DELEGADO: administrar acesso do Financeiro deixa de exigir admin do mundo.
--
-- PEDIDO DO DONO, verbatim (15/09/2026):
--   "Preciso que faça essa gestão dentro do módulo de administração. Só que a ana por exemplo
--    consegue gerir admin só do módulo financeiro."
--   "Preciso a ana consiga administra acesso só da parte do financeiro por exemplo. E não de
--    todos os outros modulos."
--
-- O PROBLEMA HOJE, medido: `assertAdmin` é `has_role(user,'admin')` e nada mais. Existem DOIS
-- admins (pedro.luca e victor.eliezek). Dar admin à Ana daria a ela os três produtos inteiros,
-- mais escrita em repasses, royalties e sócios pelas policies de RLS. Não existe meio-termo.
--
-- POR QUE UM PAPEL NOVO E NÃO UMA CHAVE NO PAPEL `financeiro`: o papel `financeiro` tem OITO
-- pessoas. Marcar a chave nele faria as oito administrarem acesso. O dono pediu "a próxima ana
-- ou eu" — isso é um papel, não uma pessoa, e é por isso que ele se chama `financeiro_admin` e
-- não `ana`.
--
-- POR QUE UMA ÁREA NOVA E NÃO UMA CHAVE NA ÁREA `admin`: a área `admin` tem sete chaves e é
-- concedida em bloco — `role_areas` é (papel, área), não (papel, chave). Pendurar a chave nova
-- ali obrigaria a dar as outras seis junto, que são exatamente as que o dono quer negar.
--
-- REVERSÃO:
--   delete from ops.user_roles  where role = 'financeiro_admin';
--   delete from ops.role_areas  where area = 'admin_financeiro';
--   delete from ops.area_chaves where area = 'admin_financeiro';
--   delete from ops.areas       where slug = 'admin_financeiro';
--   delete from ops.roles       where key  = 'financeiro_admin';
-- ────────────────────────────────────────────────────────────────────────────────────────────

insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa)
values ('admin_financeiro', 'Acessos do Financeiro',
        'Conceder e tirar acesso ao Brain Financeiro, e escolher quais unidades cada pessoa abre. '
        'Não dá acesso a nenhuma outra tela de administração.',
        'nenhum', 85, true)
on conflict (slug) do update set nome = excluded.nome, descricao = excluded.descricao, ativa = true;

insert into ops.area_chaves (area, permission_key)
values ('admin_financeiro', 'admin.acessos.financeiro')
on conflict do nothing;

insert into ops.roles (key, label, description, is_system)
values ('financeiro_admin', 'Admin do Financeiro',
        'Administra QUEM entra no Brain Financeiro e QUAIS unidades cada pessoa abre. Não '
        'administra usuários, perfis nem permissões dos outros módulos.',
        false)
on conflict (key) do update set label = excluded.label, description = excluded.description;

-- O admin global continua podendo tudo: sem esta linha, trocar a checagem de `has_role('admin')`
-- para a chave nova tiraria a capacidade de quem já a tinha.
insert into ops.role_areas (role, area, allowed)
values ('admin', 'admin_financeiro', true),
       ('financeiro_admin', 'admin_financeiro', true)
on conflict (role, area) do update set allowed = true;

-- ── ANA ─────────────────────────────────────────────────────────────────────────────────────
-- ana.aguiar e não ana.carvalhais: das duas, só a aguiar já entrou no sistema (último acesso
-- 14/09/2026; a carvalhais está com `last_sign_in_at` nulo desde que foi criada). A Ana da
-- controladoria é quem vem usando.
insert into ops.user_roles (user_id, role)
select u.id, 'financeiro_admin' from auth.users u where u.email = 'ana.aguiar@planning.com.br'
on conflict (user_id, role) do nothing;

-- ── GATE 1 · a Ana pode a chave nova e NÃO pode as outras sete da administração ─────────────
do $gate$
declare v_ana uuid; v_pode boolean; v_indevidas text;
begin
  select id into v_ana from auth.users where email = 'ana.aguiar@planning.com.br';
  if v_ana is null then raise exception 'GATE 1 FALHOU: ana.aguiar não existe em auth.users.'; end if;

  v_pode := ops.can_user(v_ana, 'admin.acessos.financeiro');
  if not v_pode then raise exception 'GATE 1 FALHOU: ana não recebeu admin.acessos.financeiro.'; end if;

  select string_agg(ac.permission_key, ', ' order by ac.permission_key) into v_indevidas
    from ops.area_chaves ac
   where ac.area = 'admin'
     and ops.can_user(v_ana, ac.permission_key);
  if v_indevidas is not null then
    raise exception 'GATE 1 FALHOU: ana alcançou chave(s) da administração geral: %. '
                    'O admin delegado virou admin global.', v_indevidas;
  end if;
  raise notice 'GATE 1 ok · ana administra o Financeiro e nenhuma das 7 chaves da administração geral.';
end $gate$;

-- ── GATE 2 · ninguém MAIS ganhou a chave sem querer ────────────────────────────────────────
do $gate$
declare v_lista text; v_n int;
begin
  select count(*), string_agg(u.email, ', ' order by u.email) into v_n, v_lista
    from auth.users u where ops.can_user(u.id, 'admin.acessos.financeiro');
  if v_n > 3 then
    raise exception 'GATE 2 FALHOU: % pessoas com admin.acessos.financeiro (esperado: os 2 admins '
                    '+ ana). São elas: %', v_n, v_lista;
  end if;
  raise notice 'GATE 2 ok · % pessoa(s) administram acesso do Financeiro: %', v_n, v_lista;
end $gate$;

-- ── GATE 3 · o retrato do resto do mundo não se mexeu ──────────────────────────────────────
do $gate$
declare v int;
begin
  select count(*) into v from ops._can_antes_20260915 a
   where a.pode is distinct from ops.can_user(a.user_id, a.permission_key);
  if v > 0 then
    raise exception 'GATE 3 FALHOU: % combinação(ões) antigas mudaram de resposta.', v;
  end if;
  raise notice 'GATE 3 ok · as 2.624 combinações anteriores seguem idênticas.';
end $gate$;
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- PARTE 3 — O ESCOPO DO COCKPIT VIRA LINHA POR PESSOA.
--
-- PEDIDO DO DONO, verbatim: "Preciso modularizar os acessos também, por exemplo: quero dar
-- acesso só à partners para o eliezek. ou só à Marox para o roney. Daí administro certinho."
--
-- POR QUE NÃO DÁ HOJE, medido: as oito chaves `view.brain_financeiro_*` estão em
-- `ops.role_permissions`, que é (PAPEL, chave). As oito estão marcadas para exatamente dois
-- papéis — `admin` e `financeiro` — e o papel `financeiro` tem oito pessoas. Ou seja: as oito
-- pessoas recebem os oito escopos, idênticos, e não há onde diferenciar. Dar só MAROX ao Roney
-- exigiria um papel por pessoa, e aí a matriz vira uma grade ilegível.
--
-- MEDIDO TAMBÉM, e é o que decide o lugar desta tabela: `ops.can()` NÃO lê `role_permissions`.
-- Ela lê a cadeia `user_roles → role_areas → area_chaves → areas`. Das nove chaves do Financeiro,
-- só `view.brain_financeiro` (a porta) está em `area_chaves`; as oito de escopo não estão em
-- área nenhuma. Comparando os dois modelos: 18 pares (papel,chave) liberados só no modelo velho
-- — e DEZESSEIS deles são exatamente estas oito chaves nos dois papéis.
--
-- Quer dizer: as oito chaves de escopo são órfãs. Vivem numa tabela que o front lê para decidir
-- menu e que a RLS ignora. Não são permissão de página do Ops — são recorte de dado de OUTRO
-- produto. Enfiá-las em `area_chaves` seria empurrar vocabulário do Financeiro para dentro do
-- modelo de áreas do Ops. Por isso a casa nova é aqui, no `public`, ao lado de `produto_acesso`:
--   · `produto_acesso`  responde EM QUE produtos a pessoa entra.
--   · `produto_escopo`  responde QUAIS PEDAÇOS de cada produto ela abre.
-- Mesma chave (user_id, produto), mesmo `concedido_em`/`concedido_por`, mesmas policies.
--
-- O FALLBACK É DELIBERADO E TEMPORÁRIO. Quem não tiver NENHUMA linha aqui continua derivando do
-- papel, como hoje — assim ninguém perde acesso no minuto em que isto sobe. Mas o seed abaixo
-- escreve a linha explícita das dez pessoas que já entram, então na prática o fallback nasce sem
-- ninguém dentro. Ele existe para a pessoa NOVA que alguém cadastrar pelo caminho velho.
--
-- NEO ENTRA JUNTO, por decisão do dono ("ligar junto, como as outras 8"). NEO tem nove telas
-- habilitadas em `unidades_navegacao` do Financeiro e não tinha chave nenhuma — dava 403 para
-- todo mundo, inclusive para os dois admins.
--
-- REVERSÃO: `drop table public.produto_escopo;` e o cockpit volta a derivar do papel sozinho,
-- porque o fallback continua no código.
-- ────────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.produto_escopo (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  produto       text        not null references public.produtos(slug),
  escopo        text        not null,
  concedido_em  timestamptz not null default now(),
  -- Nulo quer dizer "semeado pela migração a partir do papel que a pessoa já tinha", não
  -- "ninguém sabe". Concessão feita pela tela sempre grava quem fez.
  concedido_por uuid        references auth.users(id),
  primary key (user_id, produto, escopo)
);

comment on table public.produto_escopo is
  'Quais pedaços de cada produto a pessoa abre. Irmã de produto_acesso, que diz em QUE produtos '
  'ela entra. Para o produto "financeiro" o escopo é o id de unidades_navegacao do cockpit '
  '(BPO, DOC, EXPANSÃO, MAROX, PAT, PIS, NEO, negocios-estruturados, finance).';

alter table public.produto_escopo enable row level security;

-- Mesmas duas policies de `produto_acesso`, palavra por palavra: quem administra acesso lê
-- todos; qualquer pessoa lê os próprios. Escrita não tem policy — só service_role grava, que é
-- o servidor do Ops depois de conferir quem pediu.
drop policy if exists "admin do financeiro le todos os escopos" on public.produto_escopo;
create policy "admin do financeiro le todos os escopos"
  on public.produto_escopo for select to authenticated
  using (ops.can('view.admin.users') or ops.can('admin.acessos.financeiro'));

drop policy if exists "le os proprios escopos" on public.produto_escopo;
create policy "le os proprios escopos"
  on public.produto_escopo for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.produto_escopo from anon;
grant select on public.produto_escopo to authenticated;
grant all    on public.produto_escopo to service_role;

-- ── A CHAVE DE NEO no caminho velho, para os dois modelos não discordarem enquanto convivem ──
insert into ops.role_permissions (role, permission_key, allowed)
select r, 'view.brain_financeiro_neo', true from unnest(array['admin','financeiro']) r
on conflict (role, permission_key) do update set allowed = true;

-- ── SEED · a linha explícita de quem já entra ───────────────────────────────────────────────
with mapa(sufixo, escopo) as (
  values ('bpo','BPO'), ('doc','DOC'), ('expansao','EXPANSÃO'), ('marox','MAROX'),
         ('pat','PAT'), ('pis','PIS'), ('neo','NEO'),
         ('negocios_estruturados','negocios-estruturados'), ('finance','finance')
), pessoas as (
  select pa.user_id from public.produto_acesso pa where pa.produto = 'financeiro'
), derivado as (
  select p.user_id, m.escopo
    from pessoas p
    join ops.user_roles ur on ur.user_id = p.user_id
    join ops.role_permissions rp on rp.role = ur.role and rp.allowed
    join mapa m on rp.permission_key = 'view.brain_financeiro_' || m.sufixo
)
insert into public.produto_escopo (user_id, produto, escopo)
select distinct user_id, 'financeiro', escopo from derivado
on conflict (user_id, produto, escopo) do nothing;

-- ── GATE 1 · NINGUÉM PERDEU NADA ────────────────────────────────────────────────────────────
-- Para cada pessoa que entra no Financeiro, o conjunto gravado tem de CONTER tudo que ela
-- derivava do papel. Uma diferença para menos é acesso sumindo em silêncio.
do $gate$
declare v_falta text;
begin
  with mapa(sufixo, escopo) as (
    values ('bpo','BPO'), ('doc','DOC'), ('expansao','EXPANSÃO'), ('marox','MAROX'),
           ('pat','PAT'), ('pis','PIS'), ('negocios_estruturados','negocios-estruturados'),
           ('finance','finance')
  ), derivado as (
    select pa.user_id, m.escopo
      from public.produto_acesso pa
      join ops.user_roles ur on ur.user_id = pa.user_id
      join ops.role_permissions rp on rp.role = ur.role and rp.allowed
      join mapa m on rp.permission_key = 'view.brain_financeiro_' || m.sufixo
     where pa.produto = 'financeiro'
  )
  select string_agg(u.email || ' perdeu ' || d.escopo, ' ; ')
    into v_falta
    from (select distinct user_id, escopo from derivado) d
    join auth.users u on u.id = d.user_id
   where not exists (
     select 1 from public.produto_escopo pe
      where pe.user_id = d.user_id and pe.produto = 'financeiro' and pe.escopo = d.escopo);
  if v_falta is not null then
    raise exception 'GATE 1 FALHOU: o seed não cobriu tudo que era derivado — %', v_falta;
  end if;
  raise notice 'GATE 1 ok · nenhuma pessoa perdeu escopo no seed.';
end $gate$;

-- ── GATE 2 · toda linha gravada aponta para unidade que EXISTE no cockpit ──────────────────
-- O banco do cockpit é outro projeto, então a lista vem escrita aqui. Se ela divergir de
-- `unidades_navegacao`, a tela concede escopo que não abre nada.
do $gate$
declare v_orfas text;
begin
  select string_agg(distinct escopo, ', ') into v_orfas
    from public.produto_escopo
   where produto = 'financeiro'
     and escopo not in ('BPO','DOC','EXPANSÃO','MAROX','PAT','PIS','NEO',
                        'negocios-estruturados','finance');
  if v_orfas is not null then
    raise exception 'GATE 2 FALHOU: escopo(s) que não existem no cockpit: %', v_orfas;
  end if;
  raise notice 'GATE 2 ok · todo escopo gravado existe em unidades_navegacao.';
end $gate$;

-- ── GATE 3 · anon não alcança a tabela nova ────────────────────────────────────────────────
do $gate$
begin
  if has_table_privilege('anon', 'public.produto_escopo', 'select') then
    raise exception 'GATE 3 FALHOU: a chave pública lê produto_escopo.';
  end if;
  raise notice 'GATE 3 ok · produto_escopo fechada para anon.';
end $gate$;
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- PARTE 4 — a chave nova também no caminho VELHO, porque a lateral lê o caminho velho.
--
-- ISTO É REDUNDÂNCIA, E ELA É CONSCIENTE. Medido em 15/09/2026: existem DOIS modelos de
-- permissão vivos no Ops e eles discordam em 198 pares (papel, chave).
--   · `getMyPermissions` (TypeScript) lê `ops.role_permissions` → decide o que a LATERAL mostra.
--   · `ops.can()` (SQL) lê `user_roles → role_areas → area_chaves → areas` → decide o que a RLS
--     DEIXA LER, e é o que os guardas novos usam.
-- Semear só num dos dois produz o pior par de desfechos: ou o item não aparece para quem pode
-- (semeado só em áreas), ou ele aparece e o clique é recusado (semeado só em role_permissions).
--
-- Então semeia-se nos dois, e fica escrito aqui que é provisório. A reconciliação — mover as
-- chaves de `role_permissions` para `area_chaves` e fazer `getMyPermissions` ler `ops.can` — é
-- trabalho separado, do dono do Ops, e não cabe carona nesta migration.
--
-- REVERSÃO: delete from ops.role_permissions where permission_key = 'admin.acessos.financeiro';
-- ────────────────────────────────────────────────────────────────────────────────────────────

insert into ops.role_permissions (role, permission_key, allowed)
values ('admin', 'admin.acessos.financeiro', true),
       ('financeiro_admin', 'admin.acessos.financeiro', true)
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- ── GATE · os DOIS modelos concordam sobre esta chave ───────────────────────────────────────
do $gate$
declare v_velho text; v_novo text;
begin
  select string_agg(role, ',' order by role) into v_velho
    from ops.role_permissions where permission_key = 'admin.acessos.financeiro' and allowed;
  select string_agg(ra.role, ',' order by ra.role) into v_novo
    from ops.role_areas ra join ops.area_chaves ac on ac.area = ra.area
   where ac.permission_key = 'admin.acessos.financeiro' and ra.allowed;
  if v_velho is distinct from v_novo then
    raise exception 'GATE FALHOU: a lateral libera para [%] e a guarda libera para [%]. '
                    'Um dos dois mente para quem clicar.', v_velho, v_novo;
  end if;
  raise notice 'GATE ok · os dois modelos liberam admin.acessos.financeiro para: %', v_velho;
end $gate$;
