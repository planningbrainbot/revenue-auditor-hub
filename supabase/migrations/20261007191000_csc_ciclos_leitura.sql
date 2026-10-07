-- A apuração e a Visão geral de Receita e Repasses passam a ler o boleto de
-- contas fixas (ops.csc_ciclos). A tabela tinha RLS ligado e nenhuma policy:
-- só a service_role da Edge Function enxergava. Leitura com a mesma regra de
-- ops.royalties_apuracao (admin e diretor); escrita segue só pela função.
begin;

drop policy if exists "Admins e diretores leem csc_ciclos" on ops.csc_ciclos;
create policy "Admins e diretores leem csc_ciclos"
  on ops.csc_ciclos
  for select
  to authenticated
  using (
    tem_produto('ops')
    and (
      (select ops.has_role(auth.uid(), 'admin'::ops.app_role))
      or (select ops.has_role(auth.uid(), 'diretor'::ops.app_role))
    )
  );

commit;
