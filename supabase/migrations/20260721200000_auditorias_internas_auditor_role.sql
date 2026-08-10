-- Fix: perfil de sistema "auditor" via a tela /auditoria-interna (chave
-- view.auditoria_interna liberada) mas os dados nunca carregavam — a
-- policy RLS criada em 20260721180000_auditorias_internas.sql só cobria
-- admin/diretor (has_role) e perfis CUSTOM (is_custom_role, que por
-- definição exclui papéis is_system = true). "auditor" é um papel de
-- sistema (roles.is_system = true, ver 20260703190000_dynamic_roles.sql),
-- então ficou sem nenhuma policy de leitura — mesmo padrão de bug já
-- corrigido antes em central_tratativas (20260617141401), que tem policy
-- explícita has_role(auth.uid(), 'auditor').
CREATE POLICY "Auditors can read auditorias_internas"
  ON public.auditorias_internas FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'auditor'::app_role));
