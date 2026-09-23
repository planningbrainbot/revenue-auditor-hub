-- PROPOSTA — NÃO APLICADA. Fora de supabase/migrations/ de propósito.
--
-- Cockpit do CEO (piloto de 22/09/2026): cria a área que abre /cockpit-ceo no seletor.
--
-- O cockpit não tem RPC nem tabela própria: lê a mesma carga de Base de clientes e Monetização,
-- com as chaves e a RLS que já valem lá. A área decide só se a página aparece e abre. Por isso não
-- há chave nova em area_chaves: a página herda a área em que mora (regra de 15/09/2026).
--
-- Conservador: nasce só para o super admin (papel `admin`). Ampliar para diretoria é decisão do
-- dono, e vale lembrar que "ver a área" não dá a ninguém dado que ele já não leia em Base e
-- Monetização. Quando entrar financeiro consolidado (F02) ou evidência de M&A (F10), esses blocos
-- precisam de chave própria antes de subir.
--
-- Antes de aplicar: conferir colunas de ops.areas no banco (esta forma copia
-- 20260916100000_area_minha_unidade_financeiro.sql), escolher `ordem`, e decidir se o cockpit fica
-- em área própria ou dentro de `estrategia` (Estratégia & Execução, 21/09).

insert into ops.areas (slug, nome, descricao, escopo, ordem) values
  ('cockpit_ceo', 'Cockpit do CEO',
   'Plano, crescimento, ameaças e decisões, com a composição de cada número.',
   'nenhum', 4)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem;

insert into ops.role_areas (role, area, allowed) values
  ('admin', 'cockpit_ceo', true)
on conflict (role, area) do update
  set allowed = excluded.allowed, updated_at = now();

-- Reversão:
--   delete from ops.role_areas where area = 'cockpit_ceo';
--   delete from ops.areas where slug = 'cockpit_ceo';
