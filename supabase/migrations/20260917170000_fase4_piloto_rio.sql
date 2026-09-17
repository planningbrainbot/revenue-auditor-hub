-- Fase 4 do PLANO-ADMIN-DELEGADO: piloto no Rio de Janeiro.
--
-- O sócio regional do Rio (conta b73f6a7c, unidade Rio de Janeiro) passa a
-- ser SÓCIO da área Minha Unidade. As páginas dele não mudam, porque o papel
-- `socio_regional` já dava a área inteira. O que muda: ele ganha "Minha
-- equipe" e pode convidar colaboradores do Rio e escolher as páginas de cada
-- um. Autorizado pelo dono em 17/09/2026.
--
-- Mesmo efeito de `ops.acesso_nomear`, gravado direto porque não há sessão de
-- super admin numa migration. O log registra a origem.

insert into ops.area_admins (user_id, area, nivel)
values ('b73f6a7c-db83-4a68-acc7-f2c7fde4caa4', 'minha_unidade', 'socio')
on conflict (user_id, area) do update set nivel = 'socio';

insert into ops.usuario_areas (user_id, area, allowed)
values ('b73f6a7c-db83-4a68-acc7-f2c7fde4caa4', 'minha_unidade', true)
on conflict (user_id, area) do update set allowed = true, atualizado_em = now();

insert into ops.acessos_log (ator, alvo, acao, area, detalhe)
values (null, 'b73f6a7c-db83-4a68-acc7-f2c7fde4caa4', 'nomear', 'minha_unidade',
        jsonb_build_object('nivel', 'socio', 'origem', 'migration 20260917170000, piloto do Rio autorizado pelo dono'));
