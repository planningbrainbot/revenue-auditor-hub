-- empresas só tinha GRANT SELECT / policies de leitura. A tela de Clientes
-- ganhou edição de razão social/CNPJ e "marcar churn" (atualizarCliente /
-- marcarChurnCliente em clientes.functions.ts) — sem isso o UPDATE roda e
-- afeta 0 linhas silenciosamente, como já aconteceu com contratos
-- (20260708180000_contratos_admin_update_policy.sql).
grant update on public.empresas to authenticated;

create policy "Admins can update empresas"
  on public.empresas
  for update
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));
