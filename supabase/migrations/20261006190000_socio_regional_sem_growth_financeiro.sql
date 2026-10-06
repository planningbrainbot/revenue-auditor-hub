-- Sócio de unidade não entra no Growth nem no Financeiro (06/10/2026).
--
-- Regra da rede: o sócio regional vê a própria unidade no Ops e nada além. O
-- menu já esconde os dois produtos para o papel `socio_regional` (inclusive no
-- "Ver como"), mas menu não é trava. A trava fica aqui, na porta: todo caminho
-- que concede produto (diálogo de admin, Acessos do Financeiro, botão do
-- Growth) grava em `public.produto_acesso`, e é dela que a sessão irmã do
-- Financeiro e o `tem_produto()` das policies leem.
--
-- As três travas recusam em vez de apagar: quem concede vê o erro e entende,
-- e nenhuma linha some em silêncio. O sócio da MATRIZ (papel `socio`) não é
-- atingido; ele segue entrando no Financeiro.
--
-- Estado no dia: nenhum dos 30 sócios regionais tinha porta no Growth ou no
-- Financeiro, nem linha em `growth.membros`. Nada a limpar.

create or replace function public.recusa_produto_de_socio_regional()
returns trigger
language plpgsql
security definer
set search_path = public, ops
as $$
begin
  if new.produto in ('growth', 'financeiro')
     and exists (select 1 from ops.user_roles r
                 where r.user_id = new.user_id and r.role = 'socio_regional') then
    raise exception 'Sócio de unidade não tem acesso ao %.', initcap(new.produto)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists produto_acesso_sem_socio_regional on public.produto_acesso;
create trigger produto_acesso_sem_socio_regional
  before insert or update on public.produto_acesso
  for each row execute function public.recusa_produto_de_socio_regional();

-- O caminho inverso: quem já tem Growth ou Financeiro não vira sócio regional
-- sem antes perder esses acessos.
create or replace function ops.recusa_socio_regional_com_produto()
returns trigger
language plpgsql
security definer
set search_path = public, ops
as $$
begin
  if new.role = 'socio_regional'
     and (exists (select 1 from public.produto_acesso p
                  where p.user_id = new.user_id and p.produto in ('growth', 'financeiro'))
          or exists (select 1 from growth.membros m where m.user_id = new.user_id)) then
    raise exception 'Tire o acesso ao Growth e ao Financeiro antes de dar o papel de sócio regional.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists user_roles_socio_regional_sem_produto on ops.user_roles;
create trigger user_roles_socio_regional_sem_produto
  before insert or update on ops.user_roles
  for each row execute function ops.recusa_socio_regional_com_produto();

-- O Growth também decide pelo `growth.membros`.
create or replace function growth.recusa_membro_socio_regional()
returns trigger
language plpgsql
security definer
set search_path = public, ops, growth
as $$
begin
  if exists (select 1 from ops.user_roles r
             where r.user_id = new.user_id and r.role = 'socio_regional') then
    raise exception 'Sócio de unidade não tem acesso ao Growth.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists membros_sem_socio_regional on growth.membros;
create trigger membros_sem_socio_regional
  before insert or update on growth.membros
  for each row execute function growth.recusa_membro_socio_regional();

revoke all on function public.recusa_produto_de_socio_regional() from public, anon, authenticated;
revoke all on function ops.recusa_socio_regional_com_produto() from public, anon, authenticated;
revoke all on function growth.recusa_membro_socio_regional() from public, anon, authenticated;
