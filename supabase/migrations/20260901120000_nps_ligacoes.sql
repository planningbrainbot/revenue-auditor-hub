-- Log de tentativas de ligação do CS pra quem recebeu a pesquisa de NPS —
-- pedido: acompanhar quantas ligações foram feitas, quem já foi ligado, e
-- quem pediu pra ser chamado de volta (com data de retorno). Registro
-- append-only (1 linha por tentativa), independente de "Registrar resposta
-- colhida por telefone" — dá pra logar uma ligação sem fechar a pesquisa.
create table public.nps_ligacoes (
  id bigint generated always as identity primary key,
  nps_pesquisa_id bigint references public.nps_pesquisas(id),
  telefone text not null,
  atendeu boolean not null,
  retornar_em date,
  observacao text,
  criado_por text,
  created_at timestamptz not null default now()
);

create index nps_ligacoes_telefone_idx on public.nps_ligacoes (telefone);
create index nps_ligacoes_pesquisa_idx on public.nps_ligacoes (nps_pesquisa_id);

alter table public.nps_ligacoes enable row level security;

create policy "Permission-based read" on public.nps_ligacoes
  for select using (can('view.disparos_whatsapp'));

create policy "Permission-based insert" on public.nps_ligacoes
  for insert with check (can('view.disparos_whatsapp'));
