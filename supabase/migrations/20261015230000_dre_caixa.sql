-- DRE e Caixa da Partners (/dre-caixa): o retrato que a tela lê.
--
-- Quem calcula é tools/dre_caixa_payload.py (repo ai-projects-scripts), depois de montar as abas
-- DRE e FCX da planilha "Financeiro - Planning Partners": grava o payload pronto numa linha só
-- (id = 1). Mesmo desenho de ops.reporte_ceo: RLS ligada e nenhuma policy, a leitura é pelo
-- service_role na server function, depois de conferir a área `receita`.
create table if not exists ops.dre_caixa (
  id         integer primary key default 1 check (id = 1),
  gerado_em  timestamptz not null default now(),
  payload    jsonb not null
);

alter table ops.dre_caixa enable row level security;

comment on table ops.dre_caixa is
  'Retrato da DRE x caixa da Partners para /dre-caixa. Cache de apresentação, sem histórico de propósito.';
