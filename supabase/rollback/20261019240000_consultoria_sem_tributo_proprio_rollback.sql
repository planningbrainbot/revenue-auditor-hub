-- Rollback de 20261019240000_consultoria_sem_tributo_proprio.sql: volta ops.monetizacao_offer_issue_pre_base_unica
-- para a versão no ar em 19/10/2026 (cópia de pg_get_functiondef, IMMUTABLE), apaga as duas funções novas e tira
-- `cadastro_receita` do perfil. A carteira em cache (ops.base_carteira) acompanha no próximo refresh.
begin;

CREATE OR REPLACE FUNCTION ops.monetizacao_offer_issue_pre_base_unica(a jsonb, p text, r jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$;
declare regime text:=lower(coalesce(nullif(r->>'regime',''),a->>'regime',''));
 band text:=coalesce(nullif(r->>'band',''),a->>'band','');
 teto numeric:=case when nullif(band,'') is null then nullif(a->>'faturamento_teto','')::numeric end;
 situacao text:=coalesce(nullif(r->>'situacao_receita',''),a->>'situacao_receita','ativa');
 low boolean:=band in ('Até R$ 500 mil','R$ 500 mil até R$ 1 milhão','R$ 1 milhão até R$ 2 milhões','R$ 2 milhões até R$ 4,8 milhões','R$ 4,8 milhões até R$ 10 milhões','R$ 10 milhões até R$ 25 milhões')
  or coalesce(teto,1e9)<=25;  -- teto legal pelo porte na Receita (ME 0,36 / EPP 4,8) vale como faixa abaixo de R$ 25 mi
 high boolean:=band in ('R$ 25 milhões até R$ 50 milhões','R$ 50 milhões até R$ 78 milhões','Entre R$ 78 milhões e R$ 300 milhões','Acima de R$ 300 milhões','[ANTIGO] Acima de R$ 78 milhões');
begin
 -- Empresa baixada, inapta ou suspensa na Receita fica fora das ofertas (decisão do dono, 18/09/2026).
 -- A revisão da lista ('situacao_receita' em r) é o caminho de volta quando a inscrição é regularizada.
 if situacao<>'ativa' then
  return 'Empresa '||situacao||' na Receita Federal; fora das ofertas';
 end if;
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
 if regime ~ '(simples|mei)' or (nullif(r->>'regime','') is null and a->>'non_simples_confirmed'='false') then return 'Simples Nacional ou MEI'; end if;
 if regime not in ('lucro real','lucro presumido','lucro arbitrado') and coalesce(a->>'non_simples_confirmed','')<>'true' then return 'Confirmar regime fora do Simples'; end if;
 if (coalesce((a->>'regime_conflict')::boolean,false) and nullif(r->>'regime','') is null)
 or (coalesce((a->>'band_conflict')::boolean,false) and nullif(r->>'band','') is null) then return 'Resolver divergência de regime ou faturamento'; end if;
 if p='finance' and not low then return 'Finance exige faixa inteiramente abaixo de R$ 25 milhões'; end if;
 if p='cella' and not high then return 'Cella exige faixa a partir de R$ 25 milhões'; end if;
 return null;
end $function$;


drop function if exists ops.monetizacao_consultoria_sem_historico(jsonb, jsonb);
drop function if exists ops.receita_cadastro_da_ficha(jsonb);

update ops.monetizacao_contas set perfil=perfil-'cadastro_receita', updated_at=now() where perfil ? 'cadastro_receita';

commit;
