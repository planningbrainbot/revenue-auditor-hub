-- Rollback de 20260925200000_drop_page_validations.sql.
-- Gerado em 25/09/2026 a partir do npknehhyyzelmrbbxvtu antes do drop: tabela,
-- policies, grants e as 16 linhas que existiam.

create table ops.page_validations (
  page_key text not null,
  validated boolean default false not null,
  notes text,
  updated_by uuid,
  updated_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  constraint page_validations_pkey primary key (page_key)
);

alter table ops.page_validations enable row level security;
grant select, insert, update, delete on ops.page_validations to authenticated;
grant all on ops.page_validations to service_role;

create policy "Admins manage page validations"
  on ops.page_validations
  as permissive
  for all
  to authenticated
  using (public.tem_produto('ops') and (( select ops.has_role(auth.uid(), 'admin'::ops.app_role) as has_role)))
  with check (public.tem_produto('ops') and (( select ops.has_role(auth.uid(), 'admin'::ops.app_role) as has_role)));

create policy "Authenticated can read page validations"
  on ops.page_validations
  as permissive
  for select
  to authenticated
  using (public.tem_produto('ops'));

insert into ops.page_validations (page_key, validated, notes, updated_by, updated_at, created_at) values
  ('/roas', false, null, null, '2026-06-10T21:10:01.700964+00:00', '2026-06-10T21:10:01.700964+00:00'),
  ('/clientes', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-10T22:20:18.42+00:00', '2026-06-10T21:10:01.700964+00:00'),
  ('/operacao', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-10T22:20:22.634+00:00', '2026-06-10T21:10:01.700964+00:00'),
  ('/auditoria', false, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-12T18:26:56.67+00:00', '2026-06-10T21:10:01.700964+00:00'),
  ('/admin/permissoes', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-17T13:25:04.427+00:00', '2026-06-17T13:25:04.507967+00:00'),
  ('/admin/validacao', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-17T13:25:06.062+00:00', '2026-06-17T13:25:06.140192+00:00'),
  ('/admin/usuarios', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-17T13:25:07.86+00:00', '2026-06-17T13:25:07.938482+00:00'),
  ('/contas-receber', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-17T13:25:20.21+00:00', '2026-06-17T13:25:20.293701+00:00'),
  ('/funil-receita', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-17T13:25:24.417+00:00', '2026-06-17T13:25:24.527373+00:00'),
  ('/financeiro-partners', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-19T13:20:20.641+00:00', '2026-06-19T13:20:20.725506+00:00'),
  ('/meus-royalties', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-06-19T13:20:25.433+00:00', '2026-06-19T13:20:25.511805+00:00'),
  ('/unidades', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-07-10T23:28:08.678+00:00', '2026-06-10T21:10:01.700964+00:00'),
  ('/', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-07-21T15:15:34.214+00:00', '2026-06-10T21:10:01.700964+00:00'),
  ('/painel-unidade', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-07-21T15:15:35.929+00:00', '2026-07-21T15:15:35.974574+00:00'),
  ('/painel-cs', true, null, 'd5196616-6bc1-4911-9abe-79bf2cee2649', '2026-08-10T18:47:34.861+00:00', '2026-08-10T18:47:34.926092+00:00'),
  ('/ebit-operacional', true, null, '12fa2abb-058d-4467-86c5-93a7aefd9d98', '2026-09-25T18:53:33.284+00:00', '2026-09-25T18:53:33.882169+00:00');
