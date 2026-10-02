-- Trava da tela Gravações (migration 20261002180000): o closer vê só as reuniões dos próprios cards, o admin vê todas,
-- e a transcrição só sai da RPC da ficha depois da checagem.
--
-- É um bloco só, que termina sempre em exceção: 'TESTE_OK:{…}' quando tudo passa, 'FALHOU: …' quando não. A exceção
-- desfaz tudo (usuários, closers, reuniões e a gravação sintética), então roda contra a produção sem gravar nada.
-- Com a migration já aplicada, rode como está. Antes de aplicar, o ensaio de .local (ou o roteiro da spec) troca a
-- linha marcada com @migration pelo texto da migration, e o bloco testa a migration inteira sem gravar.
do $teste$
declare
  u_a uuid := gen_random_uuid();      -- closer A (Pipedrive 900000001)
  u_b uuid := gen_random_uuid();      -- closer B (Pipedrive 900000002)
  u_adm uuid := gen_random_uuid();    -- admin da Monetização (nível 3)
  u_fora uuid := gen_random_uuid();   -- vê a Monetização, mas não é closer nem admin
  ev_a text := 'pedido-monet-900000101-20261002T1500';
  ev_b text := 'pedido-monet-900000102-20261002T1600';
  grav uuid := gen_random_uuid();
  l jsonb;
  d jsonb;
  negado boolean;
  n integer;
  saida jsonb := '{}'::jsonb;
begin
  -- @migration

  -- Pessoas sintéticas: ativas, com o produto Ops e o papel que abre a Monetização.
  insert into auth.users (id, email) values
    (u_a, 'closer-a@teste-gravacoes.invalid'), (u_b, 'closer-b@teste-gravacoes.invalid'),
    (u_adm, 'admin@teste-gravacoes.invalid'), (u_fora, 'fora@teste-gravacoes.invalid');
  insert into public.profiles (user_id, nome, email, ativo) values
    (u_a, 'Closer A (teste)', 'closer-a@teste-gravacoes.invalid', true),
    (u_b, 'Closer B (teste)', 'closer-b@teste-gravacoes.invalid', true),
    (u_adm, 'Admin (teste)', 'admin@teste-gravacoes.invalid', true),
    (u_fora, 'Fora (teste)', 'fora@teste-gravacoes.invalid', true);
  insert into public.produto_acesso (user_id, produto)
    select x, 'ops' from unnest(array[u_a, u_b, u_adm, u_fora]) x;
  insert into ops.user_roles (user_id, role)
    select x, 'hunter_monetizacao' from unnest(array[u_a, u_b, u_adm, u_fora]) x;
  insert into ops.area_admins (user_id, area, nivel) values (u_adm, 'monetizacao', 'admin');
  insert into ops.monetizacao_closers (pipedrive_user_id, nome, email) values
    (900000001, 'Closer A (teste)', 'closer-a@teste-gravacoes.invalid'),
    (900000002, 'Closer B (teste)', 'closer-b@teste-gravacoes.invalid');

  -- Uma reunião de cada closer; a de B tem gravação pronta com duas falas sintéticas.
  insert into ops.monetizacao_reunioes (event_id, deal_id, tipo, inicio, closer_pipedrive_id, status, ofertado)
  values
    (ev_a, 900000101, 'levantamento', '2026-10-02 15:00+00', 900000001, 'na_fila', null),
    (ev_b, 900000102, 'levantamento', '2026-10-02 16:00+00', 900000002, 'avaliada',
     '{"cella":{"apresentado":"sim","evidencia":"trecho sintetico do teste da trava"}}'::jsonb),
    ('pedido-monet-900000103-20261001T1500', 900000103, 'levantamento', '2026-10-01 15:00+00', 900000002,
     'cancelada', null);
  insert into growth.reunioes_agendadas (event_id, titulo, inicio, fim, link, plataforma, status, joiner_status)
  values (ev_b, 'Teste da trava (sintético)', '2026-10-02 16:00+00', '2026-10-02 17:00+00',
          'https://teams.microsoft.com/l/meetup-join/teste', 'teams', 'concluida', 'concluida');
  insert into growth.gravacoes (id, event_id, audio_obj, audio_bytes, duracao_s, subida_em)
    values (grav, ev_b, 'teste-trava/sintetico.ogg', 1, 1200, now());
  insert into growth.gravacoes_transcricao (gravacao_id, status) values (grav, 'pronta');
  insert into growth.gravacoes_falas (gravacao_id, ordem, inicio_s, fim_s, falante, texto) values
    (grav, 0, 0, 5, 'Falante 1', 'Fala sintética um.'),
    (grav, 1, 6, 9, 'Falante 2', 'Fala sintética dois.');
  update ops.monetizacao_reunioes set gravacao_id = grav where event_id = ev_b;

  -- Daqui em diante, como a tela: papel authenticated, uma pessoa por vez.
  perform set_config('role', 'authenticated', true);

  -- Closer A: só a própria reunião, na lista, na tabela (RLS) e na ficha.
  perform set_config('request.jwt.claim.sub', u_a::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_a, 'role', 'authenticated')::text, true);
  l := ops.monetizacao_gravacoes_lista();
  if (l ->> 'admin')::boolean then raise exception 'FALHOU: closer A virou admin'; end if;
  if l -> 'closers' <> '[900000001]'::jsonb then raise exception 'FALHOU: closer A mapeado como %', l -> 'closers'; end if;
  if exists (select 1 from jsonb_array_elements(l -> 'reunioes') x where x ->> 'event_id' = ev_b) then
    raise exception 'FALHOU: closer A viu a reunião do closer B na lista';
  end if;
  if not exists (select 1 from jsonb_array_elements(l -> 'reunioes') x where x ->> 'event_id' = ev_a) then
    raise exception 'FALHOU: closer A não viu a própria reunião';
  end if;
  select count(*) into n from ops.monetizacao_reunioes where event_id = ev_b;
  if n <> 0 then raise exception 'FALHOU: a RLS deixou o closer A ler a linha do closer B'; end if;
  negado := false;
  begin
    d := ops.monetizacao_gravacao(ev_b);
  exception when insufficient_privilege then negado := true;
  end;
  if not negado then raise exception 'FALHOU: closer A abriu a ficha (e a transcrição) do closer B'; end if;
  d := ops.monetizacao_gravacao(ev_a);
  if d ->> 'event_id' <> ev_a then raise exception 'FALHOU: closer A não abriu a própria ficha'; end if;
  saida := saida || jsonb_build_object('closer_a_lista', jsonb_array_length(l -> 'reunioes'));

  -- Closer B: a própria ficha traz a transcrição; a cancelada não aparece.
  perform set_config('request.jwt.claim.sub', u_b::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_b, 'role', 'authenticated')::text, true);
  l := ops.monetizacao_gravacoes_lista();
  if exists (select 1 from jsonb_array_elements(l -> 'reunioes') x where x ->> 'event_id' = ev_a) then
    raise exception 'FALHOU: closer B viu a reunião do closer A';
  end if;
  if exists (select 1 from jsonb_array_elements(l -> 'reunioes') x where x ->> 'status' = 'cancelada') then
    raise exception 'FALHOU: reunião cancelada na lista';
  end if;
  if exists (select 1 from jsonb_array_elements(l -> 'reunioes') x where x::text like '%trecho sintetico%') then
    raise exception 'FALHOU: a lista levou o trecho do ofertado (só a ficha leva)';
  end if;
  d := ops.monetizacao_gravacao(ev_b);
  if jsonb_array_length(d -> 'falas') <> 2 then raise exception 'FALHOU: closer B sem a própria transcrição'; end if;
  if not coalesce((select ((x -> 'ofertado') ->> 'cella')::boolean from jsonb_array_elements(l -> 'reunioes') x
                    where x ->> 'event_id' = ev_b), false) then
    raise exception 'FALHOU: ofertado da lista não diz que a Cella foi apresentada';
  end if;
  saida := saida || jsonb_build_object('closer_b_falas', jsonb_array_length(d -> 'falas'));

  -- Admin: vê as duas e abre as duas fichas.
  perform set_config('request.jwt.claim.sub', u_adm::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_adm, 'role', 'authenticated')::text, true);
  l := ops.monetizacao_gravacoes_lista();
  if not (l ->> 'admin')::boolean then raise exception 'FALHOU: admin nível 3 não reconhecido'; end if;
  if (select count(*) from jsonb_array_elements(l -> 'reunioes') x where x ->> 'event_id' in (ev_a, ev_b)) <> 2 then
    raise exception 'FALHOU: admin não viu as duas reuniões';
  end if;
  select count(*) into n from ops.monetizacao_reunioes where event_id in (ev_a, ev_b);
  if n <> 2 then raise exception 'FALHOU: a RLS escondeu reunião do admin'; end if;
  d := ops.monetizacao_gravacao(ev_b);
  if jsonb_array_length(d -> 'falas') <> 2 then raise exception 'FALHOU: admin sem a transcrição'; end if;
  saida := saida || jsonb_build_object('admin_lista_sinteticas', 2);

  -- Quem vê a Monetização mas não é closer nem admin: nada.
  perform set_config('request.jwt.claim.sub', u_fora::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u_fora, 'role', 'authenticated')::text, true);
  l := ops.monetizacao_gravacoes_lista();
  if jsonb_array_length(l -> 'reunioes') <> 0 or (l ->> 'admin')::boolean or l -> 'closers' <> '[]'::jsonb then
    raise exception 'FALHOU: quem não é closer nem admin viu reunião';
  end if;
  select count(*) into n from ops.monetizacao_reunioes;
  if n <> 0 then raise exception 'FALHOU: a RLS deixou quem não é closer ler a tabela'; end if;
  negado := false;
  begin
    d := ops.monetizacao_gravacao(ev_a);
  exception when insufficient_privilege then negado := true;
  end;
  if not negado then raise exception 'FALHOU: quem não é closer abriu ficha'; end if;

  -- Sem login: a lista recusa.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  negado := false;
  begin
    l := ops.monetizacao_gravacoes_lista();
  exception when insufficient_privilege then negado := true;
  end;
  if not negado then raise exception 'FALHOU: lista sem login'; end if;

  raise exception 'TESTE_OK:%', saida::text;
end
$teste$;
