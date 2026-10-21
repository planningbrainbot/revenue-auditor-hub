-- Rollback de 20261021120000_portal_faturamento_contas_correntes.sql: a conta corrente padrão das 16 empresas volta a
-- nula, com o evento de configuração de volta (fat_eventos é append-only: o evento da ida fica). Só mexe na empresa que
-- ainda tem o código gravado pela migration (se alguém mudou depois, fica como está).
begin;

do $volta$
declare
  _r record;
  g organizacao.empresas_grupo;
  n organizacao.empresas_grupo;
begin
  for _r in
    select v.* from (values
      ('PMC', 11505716373::bigint), ('MAROX', 2406503925::bigint), ('PAC', 9575010825::bigint),
      ('PAC SP', 11336517902::bigint), ('PRJ', 6964018974::bigint), ('DOC', 7037113322::bigint),
      ('PIS', 1808802208::bigint), ('PAT', 6718045126::bigint), ('PGE', 7400610229::bigint),
      ('PCC', 2769990301::bigint), ('BPO', 1808796467::bigint), ('PNE', 6039556786::bigint),
      ('NEO', 2114130305::bigint), ('ASCENDIA', 5520442101::bigint), ('CONCILIADOR', 4122845330::bigint),
      ('FINANCE', 4617488632::bigint)
    ) as v(apelido, conta)
  loop
    select * into g from organizacao.empresas_grupo e
     where e.apelido = _r.apelido and e.conta_corrente_padrao = _r.conta for update;
    continue when not found;
    update organizacao.empresas_grupo set conta_corrente_padrao = null where id = g.id returning * into n;
    insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
    values ('emissora', n.id, n.id, 'configurado', g.modo_omie, n.modo_omie,
            receita.fat_diff(to_jsonb(g), to_jsonb(n), array['conta_corrente_padrao'])
              || jsonb_build_object('procedencia', 'rollback de 20261021120000'),
            null);
  end loop;
end $volta$;

comment on column organizacao.empresas_grupo.conta_corrente_padrao is
  'Código da conta corrente no Omie desta emissora (nCodCC) usada quando o serviço não define outra. Nulo até a '
  'controladoria informar.';

commit;
