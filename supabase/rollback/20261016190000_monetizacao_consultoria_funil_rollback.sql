-- Desfaz 20261016190000_monetizacao_consultoria_funil.sql. Rode antes o rollback de 20261016191000, que tira a leitura de
-- ops.consultoria_negocio_cnpj do RPC da busca. Os contatos registrados na fila se perdem: exporte antes, se houver.
begin;
select cron.unschedule('consultoria-resolver-cnpj-diario') where exists (select 1 from cron.job where jobname = 'consultoria-resolver-cnpj-diario');
drop function if exists ops.consultoria_funil_painel();
drop function if exists ops.consultoria_fila_registrar(text, text, text, date);
drop table if exists ops.consultoria_fila_registros;
drop function if exists ops.consultoria_resolver_cnpj();
drop table if exists ops.consultoria_negocio_cnpj;
drop function if exists ops.nome_empresa_chave(text);
commit;
