-- Pedido de acesso: o colaborador cria o próprio cadastro em /cadastro e o
-- sócio (ou admin) da unidade dele libera o acesso em /equipe.
--
-- A conta nasce EM BRANCO (sem papel, área, unidade nem porta do Ops), que é
-- exatamente o caso que `acesso_adicionar_na_area` já deixa o sócio adotar. A
-- aprovação, portanto, não inventa regra: passa pela mesma função do convite,
-- com a mesma não escalada. Esta tabela só guarda o pedido e quem decidiu.
--
-- Quem escreve o pedido é o servidor (cliente de serviço), depois de validar o
-- domínio do e-mail. Não existe policy de escrita de propósito: a decisão passa
-- por `acesso_decidir_pedido`, que confere quem decide.
--
-- Rollback:
--   drop function if exists ops.acesso_decidir_pedido(bigint, text, text, text);
--   drop table if exists ops.acesso_pedidos;
--   drop function if exists ops.pode_decidir_pedido(uuid, integer);

create table if not exists ops.acesso_pedidos (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  nome            text not null,
  -- Texto livre, como `gente_pessoas.cargo` (82 valores distintos em 24/09 e
  -- `gente_cargos` vazia): não há lista para escolher.
  cargo           text not null check (length(trim(cargo)) >= 2),
  email           text not null,
  unidade_id      integer not null references ops.unidades (id),
  observacao      text,
  -- Preenchido quando a pessoa entra pela primeira vez (definiu a senha pelo
  -- link do e-mail, logo é dona da caixa). Só então o pedido chega ao líder:
  -- sem isto, qualquer endereço inventado do domínio disparava e-mail a sócios.
  confirmado_em   timestamptz,
  status          text not null default 'pendente'
                  check (status in ('pendente', 'aprovado', 'recusado')),
  area_concedida  text,
  motivo          text,
  decidido_por    uuid references auth.users (id),
  decidido_em     timestamptz,
  criado_em       timestamptz not null default now()
);

-- Um pedido aberto por pessoa. Recusado ou aprovado, ela pode pedir de novo.
create unique index if not exists acesso_pedidos_um_pendente
  on ops.acesso_pedidos (user_id) where status = 'pendente';
create index if not exists acesso_pedidos_unidade_pendente
  on ops.acesso_pedidos (unidade_id) where status = 'pendente';

-- Quem decide o pedido de uma unidade: super admin, admin de qualquer área de
-- escopo unidade, ou sócio de área de escopo unidade com a unidade no escopo.
create or replace function ops.pode_decidir_pedido(_ator uuid, _unidade integer)
returns boolean
language sql
stable
security definer
set search_path to 'ops', 'public'
as $$
  select case
    when _ator is null then false
    when ops.eh_super_admin(_ator) then true
    else exists (
      select 1
        from ops.area_admins aa
        join ops.areas a on a.slug = aa.area and a.ativa and a.escopo = 'unidade'
       where aa.user_id = _ator
         and (
           aa.nivel = 'admin'
           or (aa.nivel = 'socio' and (
                 coalesce((select todas_unidades from ops.usuario_escopo where user_id = _ator), false)
                 or exists (select 1 from ops.usuario_unidades
                             where user_id = _ator and unidade_id = _unidade)))
         )
    )
  end
$$;

alter table ops.acesso_pedidos enable row level security;

drop policy if exists "acesso_pedidos_select" on ops.acesso_pedidos;
create policy "acesso_pedidos_select" on ops.acesso_pedidos
  for select to authenticated
  using (
    user_id = auth.uid()
    or (confirmado_em is not null and ops.pode_decidir_pedido(auth.uid(), unidade_id))
  );

grant select on ops.acesso_pedidos to authenticated;
grant all on ops.acesso_pedidos to service_role;

-- Fecha o pedido. Aprovar exige que o acesso já tenha sido dado na área
-- informada (o servidor chama `acesso_adicionar_na_area` antes): o pedido não
-- vira "aprovado" sem acesso de verdade por trás.
create or replace function ops.acesso_decidir_pedido(
  _pedido bigint, _status text, _area text default null, _motivo text default null
)
returns void
language plpgsql
security definer
set search_path to 'ops', 'public'
as $$
declare
  _ator uuid := auth.uid();
  _p ops.acesso_pedidos;
begin
  if _ator is null then raise exception 'Sessão ausente.' using errcode = '42501'; end if;
  if _status not in ('aprovado', 'recusado') then
    raise exception 'Decisão inválida.' using errcode = '22023';
  end if;

  select * into _p from ops.acesso_pedidos where id = _pedido for update;
  if not found then raise exception 'Pedido não encontrado.' using errcode = '22023'; end if;
  if _p.confirmado_em is null then
    raise exception 'A pessoa ainda não confirmou o e-mail.' using errcode = '22023';
  end if;
  if _p.status <> 'pendente' then
    raise exception 'Este pedido já foi decidido.' using errcode = '22023';
  end if;
  if not ops.pode_decidir_pedido(_ator, _p.unidade_id) then
    raise exception 'Você não decide pedidos desta unidade.' using errcode = '42501';
  end if;
  if _p.user_id = _ator then
    raise exception 'Você não pode decidir o próprio pedido.' using errcode = '42501';
  end if;

  if _status = 'aprovado' and not exists (
    select 1 from ops.usuario_areas
     where user_id = _p.user_id and area = _area and allowed
  ) then
    raise exception 'O acesso ainda não foi concedido nesta área.' using errcode = '22023';
  end if;

  update ops.acesso_pedidos
     set status = _status,
         area_concedida = case when _status = 'aprovado' then _area end,
         motivo = nullif(trim(coalesce(_motivo, '')), ''),
         decidido_por = _ator,
         decidido_em = now()
   where id = _pedido;

  perform ops._acesso_log(_p.user_id, 'pedido_' || _status, _area,
    jsonb_build_object('pedido', _pedido, 'unidade', _p.unidade_id, 'motivo', _motivo));
end
$$;

revoke all on function ops.pode_decidir_pedido(uuid, integer) from public;
revoke all on function ops.acesso_decidir_pedido(bigint, text, text, text) from public;
grant execute on function ops.pode_decidir_pedido(uuid, integer) to authenticated, service_role;
grant execute on function ops.acesso_decidir_pedido(bigint, text, text, text) to authenticated;
