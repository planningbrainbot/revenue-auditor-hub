-- Vincular filiais na apuração com a chave de edição de royalties.
--
-- `ops.contrato_omie_grupos` diz quais CNPJs de filial contam como recebimento
-- de um contrato, e só a apuração de royalties a usa. Na migration
-- 20261016120000 ela ficou só do admin por engano de leitura (parecia cadastro
-- do contrato). Decisão do usuário em 16/10/2026: entra na mesma chave
-- `edit.royalties.apuracao`. CNPJ do contrato, churn e emitir no Omie seguem
-- só do admin.

begin;

drop policy if exists editar_royalties_insert on ops.contrato_omie_grupos;
drop policy if exists editar_royalties_update on ops.contrato_omie_grupos;
drop policy if exists editar_royalties_delete on ops.contrato_omie_grupos;

create policy editar_royalties_insert on ops.contrato_omie_grupos for insert to authenticated
  with check (tem_produto('ops') and (select ops.can('edit.royalties.apuracao')));
create policy editar_royalties_update on ops.contrato_omie_grupos for update to authenticated
  using (tem_produto('ops') and (select ops.can('edit.royalties.apuracao')))
  with check (tem_produto('ops') and (select ops.can('edit.royalties.apuracao')));
create policy editar_royalties_delete on ops.contrato_omie_grupos for delete to authenticated
  using (tem_produto('ops') and (select ops.can('edit.royalties.apuracao')));

commit;
