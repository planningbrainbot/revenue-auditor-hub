-- "Ver como" a unidade: o super admin entra na visão do sócio regional.
--
-- Pedido do dono em 18/09/2026: "clico em Minha Unidade, seleciono a regional
-- e vejo a mesma tela que o sócio dela vê". Hoje isso não existe de jeito
-- nenhum — o perfil `admin` não tem sequer a área `minha_unidade`, então o
-- Painel da Unidade não abre pelo menu; e quando abrisse, todas as telas do
-- sócio recortam por `scopedToOwnUnit && unidade`, duas coisas que o super
-- admin não tem (ele enxerga a rede inteira, de propósito).
--
-- A simulação é de ACESSO E RECORTE, não de identidade: o app passa a montar
-- menu, chaves e unidade como se fosse um sócio daquela unidade. Quem grava
-- continua sendo o super admin — nenhuma escrita é feita "em nome de" ninguém,
-- e a RLS segue lendo o auth.uid() real. É de propósito: fingir identidade no
-- banco significaria emitir token de outra pessoa, e o preço disso não se paga
-- para responder "o que o sócio de Curitiba está vendo".
--
-- Consequência honesta, registrada aqui para quem ler depois: as telas do
-- sócio filtram no cliente por unidade, então a visão bate; uma tela que só
-- dependesse da RLS mostraria mais do que o sócio vê. Das 155 policies, só 4
-- isolam por unidade hoje.

-- ─────────────────────────────────────────────────────────────
-- 1. A sessão de simulação
-- ─────────────────────────────────────────────────────────────
-- Uma linha por pessoa: não existe "ver como duas unidades ao mesmo tempo".
-- Fica no banco, não num cookie, por três motivos: sobrevive ao F5 e à troca
-- de aba, o servidor confere quem pode antes de valer, e sai de graça no log
-- de acessos que já existe.
create table if not exists ops.ver_como (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  unidade_id  integer not null references ops.unidades(id) on delete cascade,
  papel       text not null default 'socio_regional',
  iniciado_em timestamptz not null default now(),
  -- Expira sozinha: esquecer a simulação ligada é o erro fácil aqui, e o
  -- sintoma ("sumiu metade do meu menu") não aponta para a causa.
  expira_em   timestamptz not null default now() + interval '8 hours'
);

comment on table ops.ver_como is
  'Simulação de visão: o super admin olhando a plataforma como o sócio de uma unidade. Não troca identidade — só menu, chaves e recorte de unidade.';

alter table ops.ver_como enable row level security;

-- Ler só a própria linha. Escrita nenhuma pela tabela: quem escreve são as
-- funções abaixo, que conferem o super admin.
drop policy if exists ver_como_propria on ops.ver_como;
create policy ver_como_propria on ops.ver_como
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on ops.ver_como from authenticated;
grant select on ops.ver_como to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. O acesso de um PERFIL, sem precisar de uma pessoa
-- ─────────────────────────────────────────────────────────────
-- `acesso_do_usuario` responde por gente; aqui a pergunta é outra: o que um
-- sócio regional alcança, em geral. Precisa ser assim porque 12 das 14
-- unidades ainda não têm sócio com login — simular "a pessoa" só funcionaria
-- no Rio e em Belém.
create or replace function ops.acesso_do_papel(_role text)
returns jsonb
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select jsonb_build_object(
    'areas', coalesce((
      select to_jsonb(array_agg(distinct ra.area order by ra.area))
        from ops.role_areas ra
        join ops.areas a on a.slug = ra.area and a.ativa
       where ra.role = _role and ra.allowed
    ), '[]'::jsonb),
    'permissions', coalesce((
      select to_jsonb(array_agg(distinct ac.permission_key order by ac.permission_key))
        from ops.role_areas ra
        join ops.areas a on a.slug = ra.area and a.ativa
        join ops.area_chaves ac on ac.area = ra.area
       where ra.role = _role and ra.allowed
    ), '[]'::jsonb)
  )
$function$;

-- ─────────────────────────────────────────────────────────────
-- 3. Ligar, desligar e consultar
-- ─────────────────────────────────────────────────────────────
-- A consulta devolve tudo o que a tela precisa de uma vez: a unidade, o papel
-- simulado e o acesso desse papel. Duas chamadas separadas abririam a janela
-- em que o menu já é do sócio e o recorte ainda é do admin.
create or replace function ops.ver_como_atual()
returns jsonb
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select coalesce((
    select jsonb_build_object(
      'ativo', true,
      'unidade_id', v.unidade_id,
      'unidade', u.nome_da_praca,
      'papel', v.papel,
      'expira_em', v.expira_em,
      'acesso', ops.acesso_do_papel(v.papel)
    )
      from ops.ver_como v
      join ops.unidades u on u.id = v.unidade_id
     where v.user_id = auth.uid()
       and v.expira_em > now()
       -- Perder o super admin no meio da simulação derruba a simulação junto.
       and ops.eh_super_admin(v.user_id)
  ), jsonb_build_object('ativo', false))
$function$;

create or replace function ops.ver_como_iniciar(_unidade_id integer, _papel text default 'socio_regional')
returns jsonb
language plpgsql
security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
declare
  _eu uuid := auth.uid();
  _nome text;
begin
  if not ops.eh_super_admin(_eu) then
    raise exception 'Só o super admin pode ver como uma unidade.' using errcode = '42501';
  end if;
  -- Perfil que não existe viraria uma sessão de menu vazio, indistinguível de
  -- um bug de permissão.
  if not exists (select 1 from ops.roles where key = _papel) then
    raise exception 'Perfil % não existe.', _papel using errcode = '22023';
  end if;

  select u.nome_da_praca into _nome from ops.unidades u where u.id = _unidade_id;
  if _nome is null then
    raise exception 'Unidade % não existe.', _unidade_id using errcode = '22023';
  end if;

  insert into ops.ver_como (user_id, unidade_id, papel, iniciado_em, expira_em)
  values (_eu, _unidade_id, _papel, now(), now() + interval '8 hours')
  on conflict (user_id) do update
    set unidade_id = excluded.unidade_id,
        papel      = excluded.papel,
        iniciado_em = excluded.iniciado_em,
        expira_em   = excluded.expira_em;

  perform ops._acesso_log(_eu, 'ver_como_iniciar', null,
    jsonb_build_object('unidade_id', _unidade_id, 'unidade', _nome, 'papel', _papel));

  return ops.ver_como_atual();
end
$function$;

create or replace function ops.ver_como_encerrar()
returns jsonb
language plpgsql
security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
declare
  _eu uuid := auth.uid();
  _antes ops.ver_como;
begin
  select * into _antes from ops.ver_como where user_id = _eu;
  delete from ops.ver_como where user_id = _eu;
  if found then
    perform ops._acesso_log(_eu, 'ver_como_encerrar', null,
      jsonb_build_object('unidade_id', _antes.unidade_id, 'papel', _antes.papel));
  end if;
  return jsonb_build_object('ativo', false);
end
$function$;

revoke execute on function ops.ver_como_iniciar(integer, text) from public, anon;
revoke execute on function ops.ver_como_encerrar() from public, anon;
revoke execute on function ops.ver_como_atual() from public, anon;
revoke execute on function ops.acesso_do_papel(text) from public, anon;
grant execute on function ops.ver_como_iniciar(integer, text) to authenticated;
grant execute on function ops.ver_como_encerrar() to authenticated;
grant execute on function ops.ver_como_atual() to authenticated;
grant execute on function ops.acesso_do_papel(text) to authenticated;

-- O PostgREST guarda o catálogo em memória: sem isto a primeira chamada do app
-- responde "função não encontrada" até o cache virar sozinho.
notify pgrst, 'reload schema';
