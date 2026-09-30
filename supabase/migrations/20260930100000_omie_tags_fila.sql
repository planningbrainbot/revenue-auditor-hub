-- Fila da omie-tags-sync (30/09). A escolha da unidade lia `sincronizado_em.min()` pelo PostgREST, que não tem
-- agregado ligado neste projeto: a leitura falhava calada e toda execução pegava a primeira credencial (Planning
-- CWB 01), das 01:13 às 13:13 de 30/09, e Maceió e São Luís nunca foram lidas. E uma unidade que sempre falha
-- (Sorocaba, sem o addon da API) ficaria para sempre na frente por nunca ter registro. A fila passa a ser a da
-- TENTATIVA, gravada antes de ler: quem tentou há mais tempo vai primeiro, dê certo ou não.
create table if not exists ops.base_omie_tags_leituras (
  unidade text primary key,
  tentativa_em timestamptz,
  concluida_em timestamptz,
  cadastros integer,
  erro text
);
comment on table ops.base_omie_tags_leituras is
  'Fila e resultado da omie-tags-sync por unidade: tentativa, conclusão, cadastros lidos e erro da última tentativa.';
alter table ops.base_omie_tags_leituras enable row level security;
revoke all on ops.base_omie_tags_leituras from public, anon, authenticated;
grant select, insert, update, delete on ops.base_omie_tags_leituras to service_role;

-- Semente: as unidades já lidas entram com a leitura que têm, e as nunca lidas (Maceió, São Luís, Sorocaba)
-- ficam sem registro e vão para a frente da fila.
insert into ops.base_omie_tags_leituras (unidade, tentativa_em, concluida_em, cadastros)
select unidade, min(sincronizado_em), max(sincronizado_em), count(*)::int from ops.base_omie_tags group by unidade
on conflict (unidade) do nothing;
