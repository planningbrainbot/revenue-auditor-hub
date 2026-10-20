-- Rollback de 20261020210000_portal_faturamento_jev_ledger.sql. As linhas de 'faturamento' saem antes, senão a
-- constraint antiga não volta (o ledger é append-only para authenticated; quem roda isto é o dono do banco).
delete from ops.cockpit_ia_consumo where cockpit = 'faturamento';
alter table ops.cockpit_ia_consumo drop constraint if exists cockpit_ia_consumo_cockpit_check;
alter table ops.cockpit_ia_consumo
  add constraint cockpit_ia_consumo_cockpit_check check (cockpit in ('ceo', 'coo'));
drop policy if exists cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo;
create policy cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and ((cockpit = 'ceo' and ops.tem_area('cockpit_ceo')) or (cockpit = 'coo' and ops.tem_area('cockpit_coo')))
  );
comment on column ops.cockpit_ia_consumo.cockpit is null;
