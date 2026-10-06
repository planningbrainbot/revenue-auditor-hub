-- Rollback de 20261006140000_gente_desfazer_cnpj. Movimentação "desfeita" volta a
-- ser bloqueada pelo check: passe-as para "cancelada" antes.
begin;
drop function if exists ops.gente_desfazer_movimentacao(bigint, text);
update ops.gente_movimentacoes set status = 'cancelada' where status = 'desfeita';
alter table ops.gente_movimentacoes drop constraint if exists gente_movimentacoes_status_check;
alter table ops.gente_movimentacoes add constraint gente_movimentacoes_status_check
  check (status in ('rascunho', 'enviada', 'cancelada'));
alter table ops.gente_movimentacoes
  drop column if exists motivo_desfazer, drop column if exists desfeita_por, drop column if exists desfeita_em;
alter table ops.gente_pessoas drop column if exists cnpj_empregador;
-- O trigger de histórico volta à versão de 20261002100000 reaplicando aquele trecho.
commit;
