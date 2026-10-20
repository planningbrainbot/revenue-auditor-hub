-- Consultoria retroativa sem tributo próprio para recuperar (19/10/2026).
--
-- Caso de origem: ARCANJO PARTICIPACOES (Belém), holding aberta em 10/03/2026 com capital de R$ 10 mil, saiu como
-- Consultoria retroativa só por ser Base Antiga no Pipefy e não Simples, e foi abordada pela cadência do pipe 39.
-- A retroativa recupera imposto pago nos últimos anos; duas contas não têm esse histórico:
--   - aberta há menos de 1 ano (início de atividade na Receita);
--   - holding pura (todo CNAE principal em 64.62 ou 64.63) sem faixa de faturamento própria.
--
-- 1. `perfil.cadastro_receita` {inicio_atividade, cnaes, fonte}: copiado da ficha (ops.monetizacao_detalhes.fields,
--    gravada pela consulta em lote da Receita de 18/09). Conta fora da consulta fica sem o campo e segue a régua de antes.
-- 2. ops.monetizacao_consultoria_sem_historico(a, r): a regra, espelho de consultoriaSemTributoProprio()
--    (src/lib/monetizacao/model.ts), com os mesmos textos e a mesma ordem.
-- 3. ops.monetizacao_offer_issue_pre_base_unica recriada a partir da versão no ar (20260919120000) com a chamada nova
--    logo depois da origem retroativa e antes do Simples, como no cliente. Passa de IMMUTABLE para STABLE porque a
--    regra lê a data de hoje. Só o wrapper ops.monetizacao_offer_issue (STABLE) chama esta função.
-- Rollback: supabase/rollback/20261019240000_consultoria_sem_tributo_proprio_rollback.sql
begin;

create or replace function ops.receita_cadastro_da_ficha(_fields jsonb) returns jsonb
language sql immutable parallel safe set search_path=ops,public,extensions as $$
 -- "6462000 · Holdings ..." ou "<cnpj>: 6462000 · ...; <cnpj>: ..."; a descrição do CNAE pode ter "; ", por isso o
 -- código é lido pelo padrão "7 dígitos + ' ·'", não por separador. A data é o início mais antigo entre os CNPJs.
 with c as (
  select array(select distinct m[1] from regexp_matches(coalesce(_fields->'CNAE principal (Receita)'->>'value',''),'(\d{7}) ·','g') m order by 1) cnaes,
   (select min(make_date(m[3]::int,m[2]::int,m[1]::int)) from regexp_matches(coalesce(_fields->'Início de atividade (Receita)'->>'value',''),'(\d{2})/(\d{2})/(\d{4})','g') m) inicio,
   coalesce(_fields->'CNAE principal (Receita)'->>'source',_fields->'Início de atividade (Receita)'->>'source') fonte
 )
 select case when cardinality(cnaes)>0 or inicio is not null then
  jsonb_build_object('inicio_atividade',to_char(inicio,'YYYY-MM-DD'),'cnaes',to_jsonb(cnaes),'fonte',coalesce(fonte,'Receita Federal'))
 end from c
$$;

update ops.monetizacao_contas a
   set perfil=a.perfil||jsonb_build_object('cadastro_receita',x.c), updated_at=now()
  from (select d.account_key, ops.receita_cadastro_da_ficha(d.detalhe->'fields') c from ops.monetizacao_detalhes d) x
 where x.account_key=a.key and x.c is not null and a.perfil->'cadastro_receita' is distinct from x.c;

create or replace function ops.monetizacao_consultoria_sem_historico(a jsonb, r jsonb) returns text
language plpgsql stable set search_path=ops,public,extensions as $$
declare c jsonb:=a->'cadastro_receita'; inicio date; cnaes text[]; band text:=coalesce(nullif(r->>'band',''),nullif(a->>'band',''));
 hoje date:=(now() at time zone 'America/Sao_Paulo')::date;
begin
 if c is null or jsonb_typeof(c)<>'object' then return null; end if;
 inicio:=nullif(c->>'inicio_atividade','')::date;
 if inicio is not null and inicio>(hoje-interval '1 year')::date then
  return 'Aberta há menos de 1 ano na Receita (início de atividade em '||to_char(inicio,'DD/MM/YYYY')||'). Sem tributo antigo para a Consultoria retroativa recuperar.';
 end if;
 cnaes:=array(select jsonb_array_elements_text(coalesce(c->'cnaes','[]')));
 if cardinality(cnaes)>0 and not exists(select 1 from unnest(cnaes) x where left(x,4) not in ('6462','6463')) and band is null then
  return 'Holding sem operação própria (CNAE '||(select string_agg(substr(x,1,4)||'-'||substr(x,5,1)||'/'||substr(x,6,2),', ' order by ord) from unnest(cnaes) with ordinality u(x,ord))
   ||' na Receita) e sem faixa de faturamento declarada. Sem tributo próprio para a Consultoria retroativa recuperar.';
 end if;
 return null;
end $$;

create or replace function ops.monetizacao_offer_issue_pre_base_unica(a jsonb,p text,r jsonb) returns text
language plpgsql stable set search_path=ops,public,extensions as $$
declare regime text:=lower(coalesce(nullif(r->>'regime',''),a->>'regime',''));
 band text:=coalesce(nullif(r->>'band',''),a->>'band','');
 teto numeric:=case when nullif(band,'') is null then nullif(a->>'faturamento_teto','')::numeric end;
 situacao text:=coalesce(nullif(r->>'situacao_receita',''),a->>'situacao_receita','ativa');
 low boolean:=band in ('Até R$ 500 mil','R$ 500 mil até R$ 1 milhão','R$ 1 milhão até R$ 2 milhões','R$ 2 milhões até R$ 4,8 milhões','R$ 4,8 milhões até R$ 10 milhões','R$ 10 milhões até R$ 25 milhões')
  or coalesce(teto,1e9)<=25;  -- teto legal pelo porte na Receita (ME 0,36 / EPP 4,8) vale como faixa abaixo de R$ 25 mi
 high boolean:=band in ('R$ 25 milhões até R$ 50 milhões','R$ 50 milhões até R$ 78 milhões','Entre R$ 78 milhões e R$ 300 milhões','Acima de R$ 300 milhões','[ANTIGO] Acima de R$ 78 milhões');
 sem_tributo text;
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
  -- Holding sem operação ou aberta há menos de 1 ano (19/10/2026): sem tributo próprio para recuperar.
  sem_tributo:=ops.monetizacao_consultoria_sem_historico(a,r);
  if sem_tributo is not null then return sem_tributo; end if;
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
end $$;

commit;
