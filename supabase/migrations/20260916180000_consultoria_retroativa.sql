begin;

-- Origem é comprovada pelo cadastro; uma confirmação de reoferta não transforma
-- carteira comercial em base retroativa. Nenhum dado de cliente está nesta migration.
create or replace function ops.monetizacao_offer_issue(a jsonb,p text,r jsonb) returns text
language plpgsql immutable set search_path=ops,public,extensions as $$
declare regime text:=lower(coalesce(nullif(r->>'regime',''),a->>'regime',''));
 band text:=coalesce(nullif(r->>'band',''),a->>'band','');
 low boolean:=band in ('Até R$ 500 mil','R$ 500 mil até R$ 1 milhão','R$ 1 milhão até R$ 2 milhões','R$ 2 milhões até R$ 4,8 milhões','R$ 4,8 milhões até R$ 10 milhões','R$ 10 milhões até R$ 25 milhões');
 high boolean:=band in ('R$ 25 milhões até R$ 50 milhões','R$ 50 milhões até R$ 78 milhões','Entre R$ 78 milhões e R$ 300 milhões','Acima de R$ 300 milhões','[ANTIGO] Acima de R$ 78 milhões');
begin
 if p='consultoria' then
  if coalesce((a->>'new_commercial')::boolean,false) or a->'consultoria_origin'->>'status'='comercial' then
   return 'Fechamento pelo comercial identificado; não pertence à base retroativa de Consultoria';
  end if;
  if not coalesce((a->>'old_base')::boolean,false) or coalesce(a->'consultoria_origin'->>'status','')<>'retroativa' then
   return 'Origem Base Antiga das unidades não comprovada';
  end if;
  if regime ~ '(simples|mei)' or (nullif(r->>'regime','') is null and a->'consultoria_origin'->>'non_simples_confirmed'='false') then
   return 'Simples Nacional ou MEI';
  end if;
  if coalesce((a->>'regime_conflict')::boolean,false) and nullif(r->>'regime','') is null then
   return 'Resolver divergência de regime tributário';
  end if;
  if regime not in ('lucro real','lucro presumido','lucro arbitrado') and coalesce(a->'consultoria_origin'->>'non_simples_confirmed','')<>'true' then
   return 'Base retroativa confirmada; comprovar regime fora do Simples';
  end if;
  return null;
 end if;
 if p='finance' and not coalesce((a->>'pipedrive_contract')::boolean,false) then return 'Sem contrato ganho no Pipedrive'; end if;
 if regime ~ '(simples|mei)' then return 'Simples Nacional ou MEI'; end if;
 if regime not in ('lucro real','lucro presumido','lucro arbitrado') then return 'Confirmar regime fora do Simples'; end if;
 if (coalesce((a->>'regime_conflict')::boolean,false) and nullif(r->>'regime','') is null)
 or (coalesce((a->>'band_conflict')::boolean,false) and nullif(r->>'band','') is null) then return 'Resolver divergência de regime ou faturamento'; end if;
 if p='finance' and not low then return 'Finance exige faixa inteiramente abaixo de R$ 25 milhões'; end if;
 if p='cella' and not high then return 'Cella exige faixa a partir de R$ 25 milhões'; end if;
 return null;
end $$;

notify pgrst,'reload schema';
commit;
