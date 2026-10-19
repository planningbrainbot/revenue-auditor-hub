-- Desfaz 20261019120000_bi_financeiro_area.sql. Não há dado dependente: a área não tem chaves próprias.
delete from ops.usuario_areas where area = 'bi_financeiro';
delete from ops.role_areas where area = 'bi_financeiro';
delete from ops.areas where slug = 'bi_financeiro';
