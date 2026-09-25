-- Rollback de 20260925000000_cockpit_ceo_conversa.sql. Apaga histórico, visões e consumo da
-- conversa do Cockpit do CEO (dado só dessas tabelas; nada mais depende delas).
drop function if exists ops.cockpit_ia_orcamento();
drop table if exists ops.cockpit_ia_consumo;
drop table if exists ops.cockpit_visoes;
drop table if exists ops.cockpit_mensagens;
drop table if exists ops.cockpit_conversas;
