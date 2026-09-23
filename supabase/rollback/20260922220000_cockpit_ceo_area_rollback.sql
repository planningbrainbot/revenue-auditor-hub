-- Desfaz 20260922220000_cockpit_ceo_area.sql. Não há dado dependente: a área não tem chaves próprias.
delete from ops.usuario_areas where area = 'cockpit_ceo';
delete from ops.role_areas where area = 'cockpit_ceo';
delete from ops.areas where slug = 'cockpit_ceo';
