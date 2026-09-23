-- Minha Unidade · Auditorias: o sócio regional lê o resultado das auditorias da própria unidade.
--
-- Até aqui `ops.auditorias_internas` só era legível por admin, diretor, auditor e papéis
-- customizados (policies por `has_role`). O sócio regional é papel de sistema e não passava em
-- nenhuma, então a tela /minhas-auditorias nasceria vazia.
--
-- A chave nova mora SÓ em `minha_unidade`: quem tem a área lê, e o recorte por unidade quem faz é
-- a RESTRICTIVE `escopo_unidade` que a migration 63 já pôs na tabela (compara `norm_unidade(unidade)`
-- com `unidades_do_usuario()`). Por isso a policy abaixo não repete filtro de unidade. Linhas cuja
-- `unidade` não é unidade de verdade ("Comercial", "Contas Perdidas", "Reforma Tributária",
-- "Matriz") ficam fora da vista do sócio pela mesma trava.
--
-- Chave nova dentro de área existente precisa de linha em `ops.area_chaves`, senão `can()` devolve
-- false até para quem tem a área (lição das chaves do Planning People, migration 76).
--
-- Rollback:
--   drop policy if exists "minha_unidade_le_auditorias" on ops.auditorias_internas;
--   delete from ops.area_chaves where permission_key = 'view.minhas_auditorias';

insert into ops.area_chaves (area, permission_key) values
  ('minha_unidade', 'view.minhas_auditorias')
on conflict do nothing;

drop policy if exists "minha_unidade_le_auditorias" on ops.auditorias_internas;
create policy "minha_unidade_le_auditorias" on ops.auditorias_internas
  as permissive for select to authenticated
  using (tem_produto('ops') and (select can('view.minhas_auditorias')));
