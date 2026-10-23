-- Pipe 40 (Diagnóstico de Oportunidades), 23/10/2026: 33 clientes concluíram o onboarding sem a venda ligada no
-- espelho do Handoff, e a entrada (que lê o cliente pela venda) não enxergava nenhum deles. A entrada passa a procurar a
-- venda pelo CNPJ (na venda ou na organização) e, sem resultado, pelo nome; esta tabela guarda o que achou, para a
-- rodada de 5 em 5 minutos não procurar de novo. Decisão do Pedro: "pode fazer e ligar".
create table if not exists ops.monetizacao_diagnostico_vinculos (
  pipefy_card_id text primary key,
  venda_id bigint,
  como text not null check (como in ('cnpj', 'nome', 'nenhum', 'ambiguo')),
  candidatos jsonb not null default '[]'::jsonb check (jsonb_typeof(candidatos) = 'array'),
  tentado_em timestamptz not null default now()
);

comment on table ops.monetizacao_diagnostico_vinculos is
  'Venda achada para o card do onboarding que o Handoff não liga a uma venda (pipe 40, 23/10/2026). '
  'Escrita só pela Edge Function monetizacao-diagnostico (service role).';
comment on column ops.monetizacao_diagnostico_vinculos.como is
  'cnpj ou nome: achou uma conta só (venda_id é a venda mais recente dela). nenhum: não achou. ambiguo: achou vendas '
  'de mais de uma conta, e nada entra. nenhum e ambiguo são procurados de novo um dia depois.';

alter table ops.monetizacao_diagnostico_vinculos enable row level security;
revoke all on ops.monetizacao_diagnostico_vinculos from public, anon, authenticated;
grant all on ops.monetizacao_diagnostico_vinculos to service_role;
