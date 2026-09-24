-- APLICADA em produção em 24/09/2026 (autorização do Pedro, dono do Financeiro). Era proposta de 23/09.
--
-- O schema `financeiro` do banco único é uma cópia do Brain Financeiro congelada no corte de 02/09:
-- a tela do Financeiro lê o projeto Financial Brain, e o cron grava lá. Aqui, as 115 funções do
-- schema são executáveis por qualquer usuário autenticado, 63 delas SECURITY DEFINER sem conferência
-- de acesso no corpo: um sócio regional sem Financeiro recebe série e linha por cliente de
-- `fn_faturamento_mensal` (medido em 22/09 com JWT simulado).
--
-- Depois de 23/09 nenhuma tela do Ops chama função desta cópia (o Cockpit do CEO passou a ler o
-- Financial Brain pelo servidor). O app só lê a TABELA `financeiro.empresas`
-- (permissions.functions.ts), que não é afetada. Nenhuma view depende das funções (pg_depend, 23/09).
-- Crons e service_role continuam executando.
--
-- Verificação antes/depois (só leitura): node scripts/cockpit-ceo/verificar-financeiro-execute.mjs
revoke execute on all functions in schema financeiro from public, anon, authenticated;
grant execute on all functions in schema financeiro to service_role;
alter default privileges in schema financeiro revoke execute on functions from public, anon, authenticated;
