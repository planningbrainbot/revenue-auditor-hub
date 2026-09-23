-- Cockpit do CEO: a área que abre /cockpit-ceo.
--
-- Aplicada em 22/09/2026 no banco único (npknehhyyzelmrbbxvtu) por autorização explícita do dono,
-- SÓ para o papel `admin` (super admin). Nasceu como proposta em supabase/proposals/ no piloto.
--
-- O cockpit não tem RPC nem tabela própria: lê a mesma carga de Base de clientes e Monetização, com
-- as chaves e a RLS que já valem lá. A área decide só se a página aparece e abre; não há chave nova
-- em area_chaves, a página herda a área em que mora (regra de 15/09/2026). Enquanto o app publicado
-- não tiver o código do cockpit, a linha não muda nada para ninguém além da matriz de permissões.
--
-- Quando entrar financeiro consolidado (F02) ou evidência de M&A (F10), esses blocos precisam de
-- chave própria antes de subir. Ampliar a área para diretoria é decisão do dono.
--
-- `ordem` 67: depois de Broker · Matriz (65) e antes de Minha Unidade (70), a mesma posição que o
-- item tem em src/lib/areas.ts — não vira a área padrão de ninguém.

insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa) values
  ('cockpit_ceo', 'Cockpit do CEO',
   'Plano, crescimento, ameaças e decisões, com a composição de cada número.',
   'nenhum', 67, true)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem, ativa = excluded.ativa;

insert into ops.role_areas (role, area, allowed) values
  ('admin', 'cockpit_ceo', true)
on conflict (role, area) do update
  set allowed = excluded.allowed, updated_at = now();
