-- Só a tag Cliente no Omie da Matriz sai das ofertas (06/10/2026).
--
-- A INTECH BOATING aparecia como "Cella · perfil aderente" com uma única prova: a tag Cliente no Omie da Planning
-- Partners (Matriz), cadastrada em 03/2025. É prospect, com negociação aberta no Inside Sales desde 19/08 (Jordana:
-- "estamos em negociação, deve virar cliente, mas não é ainda"). Em 01/10 já se sabia que a Matriz marca Cliente em
-- quem ela paga; agora também em prospect. Das 1.745 contas "só tag", 1.737 são da Matriz e 143 estavam nas ofertas
-- (138 Cella, 7 Consultoria). A tag no Omie de uma unidade (8 contas) continua valendo.
--
-- Recria ops.monetizacao_offer_issue a partir da versão no ar (20261002160000) com um bloco a mais, logo depois da
-- prova. Espelho no cliente: soTagDaMatriz() em src/lib/monetizacao/model.ts.
-- CREATE OR REPLACE mantém os privilégios da função. Reversão: a definição de 20261002160000_monetizacao_regiao_finance.sql.

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
 -- Só a tag Cliente no Omie da Matriz (06/10): a Matriz marca Cliente em quem ela paga e em prospect; sem contrato,
 -- recebimento, ECD ou ganho, sai como sem prova. A tag no Omie de uma unidade continua. Espelho de soTagDaMatriz().
 if pv->>'nivel'='so_tag' and exists(select 1 from ops.base_conta_omie_tags(b.cnpjs) t
   where jsonb_array_length(coalesce(t.omie->'cliente_em','[]'))>0
     and not exists(select 1 from jsonb_array_elements_text(t.omie->'cliente_em') u where u !~* 'matriz')) then
  return 'Só a tag Cliente no Omie da Matriz, sem contrato, recebimento, ECD nem ganho. A Matriz marca prospect e fornecedor como Cliente; fora das ofertas.';
 end if;
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
 -- Região do Finance (02/10): só age com ops.monetizacao_regras.finance_regiao ligada; desligada devolve null.
 if issue is null and p='finance' then issue:=ops.monetizacao_finance_regiao_issue(a->>'key');end if;
 -- sinais: a tratativa só segura o que o produto aceitaria (comTratativa no cliente); conta que já
 -- tem motivo fica com o motivo dela.
 return coalesce(issue,ops.base_distrato_bloqueio(s.distrato));
end $function$;
