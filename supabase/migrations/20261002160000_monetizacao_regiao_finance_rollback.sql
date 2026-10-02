-- Volta da 20261002160000: a função de conferência do envio na versão de 02/10 (PR #50) e as peças novas fora.
begin;
CREATE OR REPLACE FUNCTION ops.monetizacao_offer_issue(a jsonb, p text, r jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'ops', 'public', 'extensions'
AS $function$
declare b record; adjusted jsonb; situacao text; s record; issue text; rr jsonb; acima boolean; abaixo boolean; pv jsonb;
begin
 select * into b from ops.base_conta_estado where key=a->>'key';
 if b.key is null then return 'Conta ainda não conciliada na base única';end if;
 if b.identity_conflict then return 'CNPJ divergente entre fontes; revisar identidade antes de enviar';end if;
 situacao:=coalesce(nullif(r->>'situacao_receita',''),a->>'situacao_receita','ativa');
 if situacao<>'ativa' then return 'Empresa '||situacao||' na Receita Federal; fora das ofertas';end if;
 -- sinais: distrato concluído vale para todos os produtos, logo depois da situação cadastral
 -- (definitivo antes do que pede ação humana), na mesma ordem de oferta() no cliente.
 select * into s from ops.base_conta_sinais(array[a->>'key']);
 if s.distrato->>'estado'='concluido' then return ops.base_distrato_bloqueio(s.distrato);end if;
 -- Prova de cliente (01/10): empresa do grupo, fornecedor (recebe pagamento no Omie, ou só tag de fornecedor) e conta
 -- só do Omie sem prova saem de todas as ofertas, Recon inclusive. Mesma posição de fornecedorForaDeOferta() no cliente.
 pv:=ops.base_conta_prova(b.cnpjs, b.empresa_ids, b.ecd_registros, b.perfil, (select t.omie from ops.base_conta_omie_tags(b.cnpjs) t));
 if pv->>'nivel' in ('grupo','fornecedor','sem_prova') then return pv->>'motivo';end if;
 -- Só fornecedor no Omie (tags do cadastro, 29/09): fora de todas as ofertas, Recon inclusive, na mesma posição
 -- de fornecedorForaDeOferta() no cliente (src/lib/monetizacao/model.ts).
 if (select t.omie->>'classe' from ops.base_conta_omie_tags(b.cnpjs) t)='fornecedor' then
  return 'Só fornecedor no Omie, sem tag de cliente; fora das ofertas';
 end if;
 -- Recon (pipe 38 do Pipedrive, 29/09): o espelho de ofertaRecon (src/lib/monetizacao/recon.ts), na mesma
 -- ordem: identidade, situação e distrato concluído já passaram; o cadastro ausente no Pipefy não veta o Recon.
 if p='recon' then
  rr:=a->'recon';
  if rr is null or jsonb_typeof(rr)<>'object' then return 'Contrato e carteira BPO ainda não conferidos';end if;
  if rr->>'bpo_status'='bpo' then return coalesce(nullif(rr->>'reason',''),'Cliente com BPO contábil, fiscal, folha ou financeiro');end if;
  if coalesce((rr->>'revenue_conflict')::boolean,false) or coalesce((a->>'band_conflict')::boolean,false) then return 'Fontes divergem sobre o faturamento anual';end if;
  acima:=case when rr->>'revenue_exact' is not null then (rr->>'revenue_exact')::numeric>5000000 else coalesce((rr->>'revenue_min')::numeric>5000000,false) end;
  abaixo:=case when rr->>'revenue_exact' is not null then (rr->>'revenue_exact')::numeric<=5000000 else coalesce((rr->>'revenue_max')::numeric<=5000000,false) end;
  if abaixo then return 'Faturamento anual de até R$ 5 milhões';end if;
  if not acima then return 'Confirmar faturamento anual acima de R$ 5 milhões; a faixa atual não comprova o corte';end if;
  if coalesce(rr->>'bpo_status','')<>'fora_bpo' then return coalesce(nullif(rr->>'reason',''),'Confirmar que a empresa não tem BPO');end if;
  -- a tratativa em andamento segura a oferta, como comTratativa() no cliente
  return ops.base_distrato_bloqueio(s.distrato);
 end if;
 if b.ausente then return 'Cadastro ausente no Pipefy; revisar a origem antes de enviar';end if;
 if p='consultoria' and b.origem<>'antiga' then return b.motivo;end if;
 -- sinais: quem já é cliente (ou tem proposta aberta) da Consultoria não recebe Consultoria.
 if p='consultoria' then
  issue:=ops.base_consultoria_bloqueio(s.consultoria);
  if issue is not null then return issue;end if;
 end if;
 adjusted:=a||jsonb_build_object('non_simples_confirmed',b.tax_evidence->'non_simples',
  'regime_conflict',coalesce((a->>'regime_conflict')::boolean,false) or coalesce((b.tax_evidence->>'conflict')::boolean,false));
 if p='consultoria' then
  adjusted:=adjusted||jsonb_build_object('old_base',true,'consultoria_origin',coalesce(a->'consultoria_origin','{}')||jsonb_build_object('status','retroativa','reason',b.motivo,
   'non_simples_confirmed',coalesce(nullif(b.tax_evidence->'non_simples','null'::jsonb),a#>'{consultoria_origin,non_simples_confirmed}')));
 end if;
 issue:=ops.monetizacao_offer_issue_pre_base_unica(adjusted,p,r);
 -- sinais: a tratativa só segura o que o produto aceitaria (comTratativa no cliente); conta que já
 -- tem motivo fica com o motivo dela.
 return coalesce(issue,ops.base_distrato_bloqueio(s.distrato));
end $function$;
drop function if exists ops.monetizacao_finance_regiao_issue(text);
drop function if exists ops.monetizacao_regiao_contas(text[]);
drop function if exists ops.base_conta_uf(text[]);
drop table if exists ops.base_pipedrive_estado;
drop table if exists ops.monetizacao_regras;
drop table if exists ops.monetizacao_finance_linhas;
drop table if exists ops.monetizacao_uf_regiao;
commit;
