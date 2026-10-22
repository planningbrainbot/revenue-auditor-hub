-- Volta da integração com a Diehl & Cella (escolha do Pedro em 22/10/2026): o que está no funil 9 "Projeto Planning"
-- deles, um negócio por linha. O principal é o contrato ligado ao card da Planning; os outros do mesmo cliente são as
-- teses, com o valor que a Cella cadastrar. Lido pela Edge Function monetizacao-cella-envio a cada 5 minutos.
create table if not exists ops.monetizacao_cella_negocios (
  cella_deal_id bigint primary key,
  deal_id bigint,
  principal boolean not null default false,
  cella_org_id bigint,
  titulo text not null,
  status text not null,
  stage_id integer,
  valor numeric not null default 0,
  moeda text,
  data_contrato date,
  classificacao text[] not null default '{}',
  tipo_contrato text,
  tipo_trabalho text,
  lost_reason text,
  criado_deles_em timestamptz,
  atualizado_deles_em timestamptz,
  ganho_em timestamptz,
  perdido_em timestamptz,
  lido_em timestamptz not null default now(),
  -- O negócio sumiu do funil 9 (excluído ou movido de funil) desde esta data.
  ausente_desde timestamptz
);
create index if not exists monetizacao_cella_negocios_deal on ops.monetizacao_cella_negocios (deal_id);

alter table ops.monetizacao_cella_negocios enable row level security;
revoke all on table ops.monetizacao_cella_negocios from public, anon, authenticated;

-- Data do contrato já copiada para a "Caixa · Data de assinatura" do card (para não ler o card a cada rodada).
alter table ops.monetizacao_cella_envios add column if not exists assinatura date;
