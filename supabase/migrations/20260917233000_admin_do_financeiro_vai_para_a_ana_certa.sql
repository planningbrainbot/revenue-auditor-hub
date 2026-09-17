-- O admin do Financeiro foi para a Ana errada.
--
-- Em 20260915170000 o papel `financeiro_admin` foi dado a ana.aguiar, com a justificativa
-- de que "das duas, só a aguiar já entrou no sistema". Errado: são duas pessoas. A Ana da
-- controladoria, que pediu para administrar os acessos, é a Ana Laura CARVALHAIS — usuária
-- do cockpit desde o começo, e quem entrou hoje (17/09, 14h23) procurando a Administração
-- sem achar. A ana.aguiar é uma das quatro colegas que ela pediu para incluir no
-- Financeiro, com o papel `financeiro` comum.
--
-- Conferido antes de trocar: a ana.aguiar nunca usou o papel — nenhuma linha em
-- `produto_acesso`, `usuario_areas`, `usuario_chaves` ou `acessos_log` com ela como autora.
-- Tirar dela não desfaz nada que alguém recebeu.
--
-- Rollback:
--   insert into ops.user_roles (user_id, role)
--   select id, 'financeiro_admin' from auth.users where email = 'ana.aguiar@planning.com.br';
--   delete from ops.user_roles where role = 'financeiro_admin'
--    and user_id = (select id from auth.users where email = 'ana.carvalhais@planning.com.br');

do $gate$
declare
  v_certa   uuid := (select id from auth.users where email = 'ana.carvalhais@planning.com.br');
  v_errada  uuid := (select id from auth.users where email = 'ana.aguiar@planning.com.br');
  v_usos    int;
begin
  if v_certa is null or v_errada is null then
    raise exception 'GATE 0: uma das duas contas não existe (carvalhais=%, aguiar=%)', v_certa, v_errada;
  end if;

  select (select count(*) from public.produto_acesso where concedido_por = v_errada)
       + (select count(*) from ops.usuario_areas  where concedido_por = v_errada)
       + (select count(*) from ops.usuario_chaves where concedido_por = v_errada)
       + (select count(*) from ops.acessos_log    where ator = v_errada)
    into v_usos;
  if v_usos > 0 then
    raise exception 'GATE 0: a ana.aguiar já concedeu % acesso(s) — revisar antes de tirar o papel', v_usos;
  end if;

  insert into ops.user_roles (user_id, role) values (v_certa, 'financeiro_admin')
  on conflict (user_id, role) do nothing;
  delete from ops.user_roles where user_id = v_errada and role = 'financeiro_admin';

  -- GATE 1: a certa abre a tela, e só ela entre as duas
  if not ops.can_user(v_certa, 'admin.acessos.financeiro') then
    raise exception 'GATE 1: ana.carvalhais continua sem admin.acessos.financeiro';
  end if;
  if ops.can_user(v_errada, 'admin.acessos.financeiro') then
    raise exception 'GATE 1: ana.aguiar continua com admin.acessos.financeiro';
  end if;

  -- GATE 2: nenhuma das duas perdeu o Financeiro, e a certa não ganhou o resto da Administração
  if not (ops.can_user(v_certa, 'view.brain_financeiro') and ops.can_user(v_errada, 'view.brain_financeiro')) then
    raise exception 'GATE 2: alguma das duas perdeu o Financeiro';
  end if;
  if ops.can_user(v_certa, 'view.admin.users') or ops.can_user(v_certa, 'view.admin.permissions') then
    raise exception 'GATE 2: ana.carvalhais ganhou mais Administração do que a do Financeiro';
  end if;
end
$gate$;
