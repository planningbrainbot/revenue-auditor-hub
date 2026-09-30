-- Rollback de 20260930100000_omie_tags_fila (a função volta a precisar da versão anterior).
drop table if exists ops.base_omie_tags_leituras;
