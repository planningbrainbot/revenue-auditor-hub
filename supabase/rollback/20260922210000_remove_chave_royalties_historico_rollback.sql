-- Devolve `view.royalties_historico` ao estado medido em 22/09/2026, antes da
-- remoção da tela: área `receita` em `ops.area_chaves`, e os papéis `admin` e
-- `diretor` com allowed = true em `ops.role_permissions`.
--
-- Só faz sentido rodar junto com a volta da rota /unidades/historico no front.
-- A chave sozinha não abre nada: nenhuma policy lê por ela.

insert into ops.area_chaves (area, permission_key) values
  ('receita', 'view.royalties_historico')
on conflict do nothing;

insert into ops.role_permissions (role, permission_key, allowed) values
  ('admin', 'view.royalties_historico', true),
  ('diretor', 'view.royalties_historico', true)
on conflict (role, permission_key) do update set allowed = true;
