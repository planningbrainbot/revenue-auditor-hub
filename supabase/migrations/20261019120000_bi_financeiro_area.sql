-- BI Financeiro: a área que abre /bi-financeiro e /financeiro-semanal (19/10/2026, contrato
-- docs/design/contratos/bi-financeiro.md). As duas telas moravam em Receita e Repasses.
--
-- Quem recebe: exatamente quem já tinha `receita` (papéis e concessões por pessoa), para ninguém
-- perder acesso na mudança. O dono enxuga depois pela tela de acessos. Copiar e não fixar a lista
-- de propósito: a matriz é a de hoje, qualquer que seja.
--
-- Sem chave em area_chaves: as telas só leem e herdam a área (regra de 15/09/2026), como os
-- cockpits. `ordem` 31: logo depois de Receita e Repasses (30), a mesma posição de areas.ts.

insert into ops.areas (slug, nome, descricao, escopo, ordem, ativa) values
  ('bi_financeiro', 'BI Financeiro',
   'Resultado contra o plano, caixa e fôlego da Partners, todo dia.',
   'nenhum', 31, true)
on conflict (slug) do update
  set nome = excluded.nome, descricao = excluded.descricao,
      escopo = excluded.escopo, ordem = excluded.ordem, ativa = excluded.ativa;

insert into ops.role_areas (role, area, allowed)
select role, 'bi_financeiro', allowed from ops.role_areas where area = 'receita'
on conflict (role, area) do update
  set allowed = excluded.allowed, updated_at = now();

insert into ops.usuario_areas (user_id, area, allowed)
select user_id, 'bi_financeiro', allowed from ops.usuario_areas where area = 'receita'
on conflict do nothing;
