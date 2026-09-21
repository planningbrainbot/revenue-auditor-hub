-- Situação cadastral na Receita e teto de faturamento pelo porte na validação de oferta do servidor.
-- Acompanha a mudança equivalente em src/lib/monetizacao/model.ts (oferta) e recon.ts (ofertaRecon).
-- Os dois campos vivem no perfil da conta (ops.monetizacao_contas.perfil): situacao_receita e faturamento_teto.
-- A checagem de situação entra no wrapper logo depois da identidade e ANTES de cadastro ausente e da
-- origem de Consultoria, na mesma ordem do cliente: o motivo gravado na auditoria precisa bater com o
-- que a tela mostra. Empresa baixada é definitiva; cadastro ausente e origem ainda pedem ação humana.
begin;
create or replace function ops.monetizacao_offer_issue_pre_base_unica(a jsonb,p text,r jsonb) returns text
language plpgsql immutable set search_path=ops,public,extensions as $$
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
end $$;

create or replace function ops.monetizacao_offer_issue(a jsonb,p text,r jsonb) returns text
language plpgsql stable security definer set search_path=ops,public,extensions as $$
declare b record; adjusted jsonb; situacao text;
begin
 select * into b from ops.base_conta_estado where key=a->>'key';
 if b.key is null then return 'Conta ainda não conciliada na base única';end if;
 if b.identity_conflict then return 'CNPJ divergente entre fontes; revisar identidade antes de enviar';end if;
 situacao:=coalesce(nullif(r->>'situacao_receita',''),a->>'situacao_receita','ativa');
 if situacao<>'ativa' then return 'Empresa '||situacao||' na Receita Federal; fora das ofertas';end if;
 if b.ausente then return 'Cadastro ausente no Pipefy; revisar a origem antes de enviar';end if;
 if p='consultoria' and b.origem<>'antiga' then return b.motivo;end if;
 adjusted:=a||jsonb_build_object('non_simples_confirmed',b.tax_evidence->'non_simples',
  'regime_conflict',coalesce((a->>'regime_conflict')::boolean,false) or coalesce((b.tax_evidence->>'conflict')::boolean,false));
 if p='consultoria' then
  adjusted:=adjusted||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo,
   'non_simples_confirmed',coalesce(nullif(b.tax_evidence->'non_simples','null'::jsonb),a#>'{consultoria_origin,non_simples_confirmed}')));
 end if;
 return ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
end $$;
commit;
