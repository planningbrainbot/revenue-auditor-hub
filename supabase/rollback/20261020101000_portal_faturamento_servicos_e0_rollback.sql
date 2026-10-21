-- Rollback da semente do catálogo de serviços do E0 (20261020101000_portal_faturamento_servicos_e0.sql).
-- Apaga só as linhas da foto de 15/10/2026 11:50. Se algum pedido já usa um desses serviços, a FK de
-- receita.fat_pedidos recusa e nada sai: é o comportamento certo.

begin;

delete from receita.fat_servicos where sincronizado_em = timestamptz '2026-10-15 11:50:00-03';

commit;
