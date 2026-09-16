-- Minha Unidade · Financeiro
--
-- O bloco "Financeiro" do menu do sócio regional (Funil de Receita, Contas a
-- Receber e Meus Royalties) vinha junto com a área `minha_unidade`, porque a
-- regra é "quem tem a área tem todas as páginas dela". Resultado: não havia
-- como tirar o financeiro do sócio sem tirar também carteira, CS, NPS e IDU,
-- e a tela de permissões não oferecia esse corte.
--
-- Vira área própria, pelo mesmo motivo de `broker_matriz`: a fronteira do menu
-- e a fronteira de confiança não coincidem. Aqui o desenho é conservador de
-- propósito — a área nasce SEM o sócio regional, que é o corte pedido em
-- 16/09/2026. Religar é um clique em /admin/permissoes.

insert into ops.areas (slug, nome, descricao, escopo, ordem) values
  ('minha_unidade_financeiro', 'Minha Unidade · Financeiro',
   'O financeiro da unidade: funil, contas a receber e royalties devidos à matriz.',
   'unidade', 75)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem;

-- As três chaves saem de `minha_unidade` e passam para a área nova. Elas
-- continuam existindo em `receita`, que é quem as concede para a Matriz.
delete from ops.area_chaves
 where area = 'minha_unidade'
   and permission_key in ('view.funil_receita', 'view.contas_receber', 'view.meus_royalties');

insert into ops.area_chaves (area, permission_key) values
  ('minha_unidade_financeiro','view.funil_receita'),
  ('minha_unidade_financeiro','view.contas_receber'),
  ('minha_unidade_financeiro','view.meus_royalties')
on conflict do nothing;

-- Quem fica com a área: só admin, para conseguir abrir as telas pelo menu da
-- unidade. O sócio regional entra explicitamente como NÃO concedida, para que
-- a linha exista na tela em vez de depender de ausência de registro.
insert into ops.role_areas (role, area, allowed) values
  ('admin','minha_unidade_financeiro', true),
  ('socio_regional','minha_unidade_financeiro', false)
on conflict (role, area) do update
  set allowed = excluded.allowed, updated_at = now();
