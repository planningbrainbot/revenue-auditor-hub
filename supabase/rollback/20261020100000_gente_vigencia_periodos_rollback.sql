-- Desfaz 20261020100000_gente_vigencia_periodos (apaga o registro de períodos).
begin;
drop trigger if exists gente_pessoas_periodo_vigencia on ops.gente_pessoas;
drop function if exists ops.gente_registrar_periodo_vigencia();
drop table if exists ops.gente_vigencia_periodos;
commit;
