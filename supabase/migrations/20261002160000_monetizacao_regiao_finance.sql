-- Regra de região do Finance (frente 02 da call de 01/10/2026). Anotação do Pedro, WhatsApp, 01/10 14:48: "Finance:
-- filtrar por região, o produto FCO do finance funciona só para centro-oeste". Duas leituras esperam o Dárcio:
--   so_centro_oeste       o Finance inteiro só em GO, MT, MS e DF;
--   regiao_escolhe_linha  o Finance em todo lugar, e a região escolhe a linha (FCO no Centro-Oeste; BNDES e FINAME
--                         nacionais; BASA e FNE desligadas até o Dárcio confirmar).
-- A chave nasce `desligada`: aplicar esta migration não muda nenhuma oferta. Ligar é um UPDATE em ops.monetizacao_regras.
-- UF da conta (ops.base_conta_uf): Receita via Consultoria, cadastro, ECD, Omie e, por último, o campo Estado dos
-- negócios da organização no Pipedrive (ops.base_pipedrive_estado, preenchida por
-- scripts/monetizacao/sincronizar-estado-pipedrive.mjs).
-- Espelho no cliente: src/lib/monetizacao/regiao.ts. Medição de 02/10: monetizacao/medicoes/2026-10-02-frentes-01-05/.
begin;

-- A função de conferência do envio é copiada da versão viva de 02/10 (PR #50). Se ela mudou desde então, para aqui
-- em vez de desfazer a mudança de outra sessão: refaça a cópia a partir de pg_get_functiondef.
do $guarda$
begin
  if md5(pg_get_functiondef('ops.monetizacao_offer_issue(jsonb,text,jsonb)'::regprocedure)) <> '87d38d00d53d89835c318b8983d375fd' then
    raise exception 'ops.monetizacao_offer_issue mudou desde 02/10: refaça a cópia desta migration antes de aplicar';
  end if;
end $guarda$;

create table if not exists ops.monetizacao_uf_regiao (
  uf char(2) primary key,
  regiao text not null check (regiao in ('Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'))
);
insert into ops.monetizacao_uf_regiao (uf, regiao) values
  ('AC','Norte'),('AP','Norte'),('AM','Norte'),('PA','Norte'),('RO','Norte'),('RR','Norte'),('TO','Norte'),
  ('AL','Nordeste'),('BA','Nordeste'),('CE','Nordeste'),('MA','Nordeste'),('PB','Nordeste'),('PE','Nordeste'),
  ('PI','Nordeste'),('RN','Nordeste'),('SE','Nordeste'),
  ('DF','Centro-Oeste'),('GO','Centro-Oeste'),('MT','Centro-Oeste'),('MS','Centro-Oeste'),
  ('ES','Sudeste'),('MG','Sudeste'),('RJ','Sudeste'),('SP','Sudeste'),
  ('PR','Sul'),('RS','Sul'),('SC','Sul')
on conflict (uf) do nothing;

create table if not exists ops.monetizacao_finance_linhas (
  linha text primary key,
  regioes text[],                 -- null = linha nacional
  ativa boolean not null,
  fonte text not null,
  atualizado_em timestamptz not null default now()
);
insert into ops.monetizacao_finance_linhas (linha, regioes, ativa, fonte) values
  ('BNDES', null, true, 'memoria/decisoes.md: linhas que o Finance capta'),
  ('FINAME', null, true, 'memoria/decisoes.md: linhas que o Finance capta'),
  ('FCO', array['Centro-Oeste'], true, 'anotação do Pedro, WhatsApp, 01/10 14:48'),
  ('BASA', array['Norte'], false, 'a confirmar com o Dárcio (02/10)'),
  ('FNE', array['Nordeste'], false, 'a confirmar com o Dárcio (02/10)')
on conflict (linha) do nothing;

create table if not exists ops.monetizacao_regras (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  constraint monetizacao_regras_finance_regiao check (
    chave <> 'finance_regiao' or valor in ('desligada', 'so_centro_oeste', 'regiao_escolhe_linha'))
);
insert into ops.monetizacao_regras (chave, valor) values ('finance_regiao', 'desligada')
on conflict (chave) do nothing;

-- Campo Estado dos negócios no Pipedrive, por organização (os dois campos de negócio de estado, já em sigla).
create table if not exists ops.base_pipedrive_estado (
  org_id bigint primary key,
  ufs text[] not null,
  negocios integer not null,
  lido_em timestamptz not null
);

alter table ops.monetizacao_uf_regiao enable row level security;
alter table ops.monetizacao_finance_linhas enable row level security;
alter table ops.monetizacao_regras enable row level security;
alter table ops.base_pipedrive_estado enable row level security;
revoke all on ops.monetizacao_uf_regiao, ops.monetizacao_finance_linhas, ops.monetizacao_regras, ops.base_pipedrive_estado
  from anon, authenticated;
grant all on ops.monetizacao_uf_regiao, ops.monetizacao_finance_linhas, ops.monetizacao_regras, ops.base_pipedrive_estado
  to service_role;

-- UF de cada conta. Ordem: Receita (via Consultoria) > cadastro > ECD > Omie > Pipedrive. `conflito` = fontes com UFs
-- diferentes; `ufs` = todas as UFs vistas.
create or replace function ops.base_conta_uf(_keys text[])
returns table (key text, uf text, fonte text, conflito boolean, ufs text[])
language sql stable security definer set search_path = ops, public as $$
  with c as (
    select cc.account_key as key, regexp_replace(cc.cnpj, '\D', '', 'g') as cnpj
    from ops.base_conta_cnpjs cc where cc.account_key = any(_keys)
  ),
  f as (
    select c.key, 1 as ordem, 'receita' as fonte, upper(trim(k.uf)) as uf
      from c join ops.consultoria_clientes k on regexp_replace(k.cnpj, '\D', '', 'g') = c.cnpj
    union all
    select c.key, 2, 'cadastro', upper(trim(m.uf))
      from c join ops.empresas m on regexp_replace(m.cnpj, '\D', '', 'g') = c.cnpj
    union all
    select c.key, 3, 'ecd', upper(trim(x.uf))
      from c join ops.ecd_empresa x on regexp_replace(x.cnpj, '\D', '', 'g') = c.cnpj
    union all
    select c.key, 4, 'omie', upper(trim(o.estado))
      from c join ops.omie_clientes o on regexp_replace(o.cnpj_cpf, '\D', '', 'g') = c.cnpj
    union all
    select e.key, 5, 'pipedrive', upper(trim(u.uf))
      from ops.base_conta_estado e
      cross join lateral unnest(e.org_ids) as org(id)
      join ops.base_pipedrive_estado pe on pe.org_id = org.id
      cross join lateral unnest(pe.ufs) as u(uf)
      where e.key = any(_keys)
  ),
  v as (select f.* from f join ops.monetizacao_uf_regiao r on r.uf = f.uf)
  select k.key,
         (array_agg(v.uf order by v.ordem) filter (where v.uf is not null))[1],
         (array_agg(v.fonte order by v.ordem) filter (where v.uf is not null))[1],
         count(distinct v.uf) > 1,
         coalesce(array_agg(distinct v.uf) filter (where v.uf is not null), '{}')
  from unnest(_keys) as k(key) left join v on v.key = k.key
  group by k.key;
$$;
revoke all on function ops.base_conta_uf(text[]) from public, anon, authenticated;

-- O que a tela recebe por página de contas: a leitura vigente, as linhas e a UF de cada conta.
create or replace function ops.monetizacao_regiao_contas(_keys text[])
returns jsonb language plpgsql stable security definer set search_path = ops, public as $$
begin
  if not (ops.monetizacao_can('view.aquario') or ops.monetizacao_can('view.monetizacao')
          or ops.monetizacao_can('view.clientes')) then
    raise exception 'Sem acesso à Base nem à Monetização' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'regra', (select valor from ops.monetizacao_regras where chave = 'finance_regiao'),
    'linhas', (select coalesce(jsonb_agg(jsonb_build_object('linha', l.linha, 'regioes', l.regioes, 'ativa', l.ativa)
                 order by l.regioes is not null desc, l.linha), '[]'::jsonb) from ops.monetizacao_finance_linhas l),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('key', u.key, 'uf', u.uf, 'regiao', r.regiao,
                 'fonte', u.fonte, 'conflito', u.conflito)), '[]'::jsonb)
               from ops.base_conta_uf(_keys) u left join ops.monetizacao_uf_regiao r on r.uf = u.uf));
end $$;
revoke all on function ops.monetizacao_regiao_contas(text[]) from public, anon;
grant execute on function ops.monetizacao_regiao_contas(text[]) to authenticated;

-- A mesma regra no servidor, para o envio não passar o que a tela barra. Mesmo texto de src/lib/monetizacao/regiao.ts.
create or replace function ops.monetizacao_finance_regiao_issue(_key text)
returns text language plpgsql stable security definer set search_path = ops, public as $$
declare regra text; u record;
begin
  select valor into regra from ops.monetizacao_regras where chave = 'finance_regiao';
  if coalesce(regra, 'desligada') <> 'so_centro_oeste' then return null; end if;
  select b.uf, r.regiao into u from ops.base_conta_uf(array[_key]) b left join ops.monetizacao_uf_regiao r on r.uf = b.uf;
  if u.uf is null then
    return 'Confirmar a UF da empresa: pela regra de região, o Finance só atende o Centro-Oeste (FCO).';
  end if;
  if u.regiao <> 'Centro-Oeste' then
    return 'Fora do Finance pela regra de região: só Centro-Oeste (FCO); a empresa é de ' || u.uf || '.';
  end if;
  return null;
end $$;
revoke all on function ops.monetizacao_finance_regiao_issue(text) from public, anon, authenticated;

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
 -- Região do Finance (02/10): só age com ops.monetizacao_regras.finance_regiao ligada; desligada devolve null.
 if issue is null and p='finance' then issue:=ops.monetizacao_finance_regiao_issue(a->>'key');end if;
 -- sinais: a tratativa só segura o que o produto aceitaria (comTratativa no cliente); conta que já
 -- tem motivo fica com o motivo dela.
 return coalesce(issue,ops.base_distrato_bloqueio(s.distrato));
end $function$;

commit;
