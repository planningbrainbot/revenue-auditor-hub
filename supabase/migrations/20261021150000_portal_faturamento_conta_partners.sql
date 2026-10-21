-- Portal de Faturamento · conta corrente padrão da PARTNERS (21/10/2026).
--
-- A Ana indicou "PARTNERS – Itaú", mas o Omie da PARTNERS tem duas contas Itaú ativas na mesma agência:
-- 1868198302 "Itaú - Partners" e 2255763526 "Itaú - CS". O Pedro escolheu a "Itaú - Partners" em 21/10.
do $conta$
declare
  g organizacao.empresas_grupo;
  n organizacao.empresas_grupo;
begin
  select * into g from organizacao.empresas_grupo e where e.apelido = 'PARTNERS' for update;
  if not found then
    raise exception 'PARTNERS não está em organizacao.empresas_grupo.';
  end if;
  if g.conta_corrente_padrao is not distinct from 1868198302 then
    return;
  end if;
  update organizacao.empresas_grupo set conta_corrente_padrao = 1868198302 where id = g.id returning * into n;
  insert into receita.fat_eventos (entidade, entidade_id, emissora_id, evento, de, para, diff, autor_id)
  values ('emissora', n.id, n.id, 'configurado', g.modo_omie, n.modo_omie,
          receita.fat_diff(to_jsonb(g), to_jsonb(n), array['conta_corrente_padrao'])
            || jsonb_build_object(
                 'procedencia', 'Ana (controladoria) indicou Itaú; Pedro escolheu "Itaú - Partners" entre as duas contas Itaú, 21/10/2026',
                 'conta_omie', jsonb_build_object('banco', 'Itaú', 'codigo_banco', '341', 'descricao', 'Itaú - Partners')),
          null);
end $conta$;
