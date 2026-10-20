-- =================================================================================================================
-- Portal de Faturamento, T5 (o Jev no Novo pedido): o consumo do Jev entra no mesmo ledger dos cockpits.
--
-- `ops.cockpit_ia_consumo` só aceitava cockpit 'ceo' e 'coo'. O portal grava com cockpit = 'faturamento', com a
-- sessão da pessoa (como o Cockpit do COO): a policy de inserção passa a aceitar essa linha para quem tem a porta
-- do portal (`view.faturamento`). Ler continua só as próprias linhas; ninguém altera nem apaga (o teto não zera).
-- Plano: PM Work/execution/portal-faturamento-prd-20261013/e1/PLANO-E1.md (T5).
-- =================================================================================================================

alter table ops.cockpit_ia_consumo drop constraint if exists cockpit_ia_consumo_cockpit_check;
alter table ops.cockpit_ia_consumo
  add constraint cockpit_ia_consumo_cockpit_check check (cockpit in ('ceo', 'coo', 'faturamento'));

drop policy if exists cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo;
create policy cockpit_ia_consumo_gravar on ops.cockpit_ia_consumo
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and (
      (cockpit = 'ceo' and ops.tem_area('cockpit_ceo'))
      or (cockpit = 'coo' and ops.tem_area('cockpit_coo'))
      or (cockpit = 'faturamento' and ops.can('view.faturamento'))
    )
  );

comment on column ops.cockpit_ia_consumo.cockpit is
  'Quem gastou: ceo e coo (cockpits) ou faturamento (o Jev no Novo pedido do Portal de Faturamento, T5).';
