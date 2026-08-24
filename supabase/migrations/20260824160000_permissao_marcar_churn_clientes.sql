-- "Marcar churn" na tela de Clientes (Base Nova) era admin-only (assertAdmin
-- em marcarChurnCliente, ver clientes.functions.ts). Vira permissão própria
-- pra poder ser ativada por papel/usuário em /admin/permissoes, mesmo padrão
-- de manage.repasses (checagem via can(), não has_role).
--
-- atualizarCliente (editar razão social/CNPJ) continua admin-only — não fazia
-- parte do pedido e mexe em dado que já vem de sync automático.
INSERT INTO public.role_permissions (role, permission_key, allowed) VALUES
  ('admin', 'manage.clientes_churn', true)
ON CONFLICT (role, permission_key) DO UPDATE SET allowed = EXCLUDED.allowed;
