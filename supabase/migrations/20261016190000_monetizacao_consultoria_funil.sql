-- Consultoria › Funil e Fila de cobrança (`/monetizacao?aba=handoff-consultoria`, visões `funil` e `fila`).
--
-- Pedido do CEO na call de 16/10/2026 (7:45–10:11): "entrou 300 clientes esse ano... quantos que a consultoria
-- auditou... quantos tem dinheiro... quanto que ela monetizou... onde que está esse gelo que não me pagou?". Decisões do
-- Pedro Luca no mesmo dia (monetizacao/memoria/decisoes.md, 16/10):
--   1. a meta é o honorário FATURADO; o GARANTIDO (crédito aprovado × êxito) é a previsão; a expectativa nunca conta;
--   2. o universo é o ganho de 2026 no Pipedrive (Inside Sales e Sócios) mais a carteira de Goiânia (Base);
--   3. a origem fica no Brain; a chave é o CNPJ;
--   4. sem depender dos closers: o CNPJ que falta é achado pelo card do onboarding (cadastro da Isa) e pelo nome.
--
-- 1. ops.nome_empresa_chave(text): nome sem acento, pontuação nem sufixo societário, para casar empresa pelo nome.
-- 2. ops.consultoria_negocio_cnpj + ops.consultoria_resolver_cnpj(): o CNPJ dos negócios ganhos que não têm CNPJ no
--    contrato, na empresa nem no Pipedrive. Ordem: card do onboarding (alta) → nome idêntico com uma raiz só (alta) →
--    nome parecido, similaridade ≥ 0,70 e 0,15 acima do segundo candidato de outra raiz (média). Linha `manual` nunca
--    é apagada. Roda todo dia (job consultoria-resolver-cnpj-diario) e na migration.
-- 3. ops.consultoria_fila_registros + ops.consultoria_fila_registrar(): o contato da fila de cobrança, registrado no Brain.
-- 4. ops.consultoria_funil_painel(): uma linha por empresa, com tudo o que o funil e a fila precisam. Mesma porta das
--    outras abas da Consultoria; faturado e recebido só com a porta do Financeiro.

begin;

create or replace function ops.nome_empresa_chave(p text)
returns text
language sql
immutable
set search_path to 'ops', 'public', 'extensions'
as $$
  select nullif(trim(regexp_replace(regexp_replace(
           regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '\(.*?\)|\|.*$', ' ', 'g'),
           '[^a-z0-9]+', ' ', 'g'),
           '\m(ltda|ltd|me|epp|eireli|s a|sa|ss|cia|grupo|segunda oportunidade|holding|recupera|filial|matriz|\d{3})\M',
           ' ', 'g')), '')
$$;

create table if not exists ops.consultoria_negocio_cnpj (
  pipedrive_deal_id text primary key,
  cnpj text not null check (cnpj ~ '^\d{14}$'),
  fonte text not null check (fonte in ('onboarding', 'nome_exato', 'nome_parecido', 'manual')),
  confianca text not null check (confianca in ('alta', 'media')),
  nome_casado text,
  similaridade numeric,
  resolvido_em timestamptz not null default now()
);
comment on table ops.consultoria_negocio_cnpj is
  'CNPJ achado pelo Brain para negócio ganho sem CNPJ no contrato, na empresa e no Pipedrive (16/10/2026: 280 de 533). '
  'Gravado por ops.consultoria_resolver_cnpj(); linha manual nunca é apagada.';
alter table ops.consultoria_negocio_cnpj enable row level security;
revoke all on ops.consultoria_negocio_cnpj from public, anon, authenticated;
grant select, insert, update, delete on ops.consultoria_negocio_cnpj to service_role;

create or replace function ops.consultoria_resolver_cnpj()
returns jsonb
language plpgsql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _r jsonb;
begin
  perform set_config('pg_trgm.similarity_threshold', '0.6', true);
  delete from ops.consultoria_negocio_cnpj where fonte <> 'manual';

  -- Os negócios ganhos em 2026 sem CNPJ no contrato, na empresa e no Pipedrive.
  drop table if exists _falta;
  create temp table _falta on commit drop as
  with neg as (
    select distinct on (c.pipedrive_deal_id) c.pipedrive_deal_id deal, c.titulo, c.empresa_id
      from ops.contratos c
     where c.ganho_em >= '2026-01-01' and c.pipedrive_deal_id is not null
       and c.origem_pipeline in ('inside_sales', 'socios')
     order by c.pipedrive_deal_id, c.ganho_em
  )
  select n.deal, n.titulo, h.organizacao, e.razao_social, e.titulo etitulo
    from neg n
    left join ops.empresas e on e.id = n.empresa_id
    left join ops.handoff_consultoria_negocios h on h.pipedrive_deal_id = n.deal
   where not exists (select 1 from ops.contratos c2 where c2.pipedrive_deal_id = n.deal
                       and length(regexp_replace(coalesce(c2.cnpj, ''), '\D', '', 'g')) = 14)
     and length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) <> 14
     and length(regexp_replace(coalesce(h.cnpj, ''), '\D', '', 'g')) <> 14
     and not exists (select 1 from ops.consultoria_negocio_cnpj m where m.pipedrive_deal_id = n.deal);

  -- Os nomes por que cada negócio aparece (título, organização, empresa, card do onboarding).
  drop table if exists _nomes;
  create temp table _nomes on commit drop as
  select distinct x.deal, x.k from (
    select f.deal, ops.nome_empresa_chave(n) k
      from _falta f
      left join ops.handoff_consultoria_onboarding o on o.pipedrive_deal_id = f.deal and o.ausente_desde is null,
      lateral unnest(array[f.titulo, f.organizacao, f.razao_social, f.etitulo, o.titulo]) n
  ) x where length(replace(coalesce(x.k, ''), ' ', '')) >= 4;

  -- Quem tem CNPJ: a plataforma da Consultoria, o Omie das unidades e as empresas do Brain.
  drop table if exists _cand;
  create temp table _cand on commit drop as
  select distinct y.k, y.cnpj, y.prio from (
    select ops.nome_empresa_chave(x.n) k, x.cnpj, x.prio from (
      select p.nome n, p.cnpj, 1 prio from ops.consultoria_plataforma p where p.tabela = 'clientes' and p.ausente_desde is null
      union all
      select p.dados->>'nome_fantasia', p.cnpj, 1 from ops.consultoria_plataforma p where p.tabela = 'clientes' and p.ausente_desde is null
      union all
      select o.razao_social, regexp_replace(o.cnpj_cpf, '\D', '', 'g'), 2 from ops.omie_clientes o
      union all
      select o.nome_fantasia, regexp_replace(o.cnpj_cpf, '\D', '', 'g'), 2 from ops.omie_clientes o
      union all
      select e.razao_social, regexp_replace(e.cnpj, '\D', '', 'g'), 3 from ops.empresas e
    ) x where length(coalesce(x.cnpj, '')) = 14
  ) y where length(replace(coalesce(y.k, ''), ' ', '')) >= 4;
  create index on _cand using gin (k extensions.gin_trgm_ops);
  create index on _cand (k);
  analyze _cand;

  with onb as (
    select distinct on (f.deal) f.deal, regexp_replace(o.cnpj, '\D', '', 'g') cnpj, o.titulo
      from _falta f join ops.handoff_consultoria_onboarding o on o.pipedrive_deal_id = f.deal and o.ausente_desde is null
     where length(regexp_replace(coalesce(o.cnpj, ''), '\D', '', 'g')) = 14
     order by f.deal, o.criado_em desc nulls last
  ),
  exato as (
    select n.deal, min(n.k) nome,
           count(distinct left(c.cnpj, 8)) raizes,
           (array_agg(c.cnpj order by c.prio, substr(c.cnpj, 9, 4) <> '0001', c.cnpj))[1] cnpj
      from _nomes n join _cand c on c.k = n.k
     group by n.deal
  ),
  par as (
    select n.deal, c.cnpj, c.k ck, c.prio, extensions.similarity(n.k, c.k) s
      from _nomes n join _cand c on c.k operator(extensions.%) n.k and c.k <> n.k
  ),
  topo as (
    select distinct on (deal) deal, cnpj, ck, s from par order by deal, s desc, prio
  ),
  parecido as (
    select t.deal, t.cnpj, t.ck, t.s,
           coalesce((select max(p.s) from par p where p.deal = t.deal and left(p.cnpj, 8) <> left(t.cnpj, 8)), 0) s2
      from topo t
  )
  insert into ops.consultoria_negocio_cnpj (pipedrive_deal_id, cnpj, fonte, confianca, nome_casado, similaridade)
  select deal, cnpj, 'onboarding', 'alta', titulo, null from onb
  union all
  select e.deal, e.cnpj, 'nome_exato', 'alta', e.nome, 1 from exato e
   where e.raizes = 1 and not exists (select 1 from onb where onb.deal = e.deal)
  union all
  select p.deal, p.cnpj, 'nome_parecido', 'media', p.ck, round(p.s::numeric, 2) from parecido p
   where p.s >= 0.70 and p.s - p.s2 >= 0.15
     and not exists (select 1 from onb where onb.deal = p.deal)
     and not exists (select 1 from exato e where e.deal = p.deal and e.raizes = 1)
  on conflict (pipedrive_deal_id) do nothing;

  select jsonb_object_agg(fonte, n) into _r from (select fonte, count(*) n from ops.consultoria_negocio_cnpj group by 1) x;
  return coalesce(_r, '{}'::jsonb);
end;
$$;
revoke execute on function ops.consultoria_resolver_cnpj() from public, anon, authenticated;
grant execute on function ops.consultoria_resolver_cnpj() to service_role;

create table if not exists ops.consultoria_fila_registros (
  id uuid primary key default gen_random_uuid(),
  cliente_id text not null,
  resultado text not null check (resultado in ('vai_seguir', 'pediu_tempo', 'sem_resposta', 'nao_quer', 'ja_resolvido')),
  nota text,
  proximo_contato_em date,
  registrado_por uuid not null,
  autor_nome text,
  registrado_em timestamptz not null default now()
);
create index if not exists consultoria_fila_registros_cliente on ops.consultoria_fila_registros (cliente_id, registrado_em desc);
comment on table ops.consultoria_fila_registros is
  'Contato da fila de cobrança da Consultoria (cliente da plataforma com dinheiro parado). Gravado só por '
  'ops.consultoria_fila_registrar(); lido pelo ops.consultoria_funil_painel().';
alter table ops.consultoria_fila_registros enable row level security;
revoke all on ops.consultoria_fila_registros from public, anon, authenticated;

create or replace function ops.consultoria_fila_registrar(p_cliente_id text, p_resultado text, p_nota text,
                                                          p_proximo_contato_em date)
returns jsonb
language plpgsql
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _id uuid;
begin
  perform ops.consultoria_porta_leitura();
  if not exists (select 1 from ops.consultoria_plataforma where tabela = 'clientes' and id = p_cliente_id) then
    raise exception 'Cliente da plataforma não encontrado.' using errcode = '22023';
  end if;
  insert into ops.consultoria_fila_registros (cliente_id, resultado, nota, proximo_contato_em, registrado_por, autor_nome)
  values (p_cliente_id, p_resultado, nullif(trim(coalesce(p_nota, '')), ''), p_proximo_contato_em, auth.uid(),
          coalesce((select nome from ops.profiles where user_id = auth.uid()),
                   (select email from auth.users where id = auth.uid())))
  returning id into _id;
  return jsonb_build_object('id', _id);
end;
$$;
revoke execute on function ops.consultoria_fila_registrar(text, text, text, date) from public, anon;
grant execute on function ops.consultoria_fila_registrar(text, text, text, date) to authenticated;

-- Uma linha por empresa: os negócios ganhos em 2026 (um por CNPJ; sem CNPJ, um por negócio), a carteira de Goiânia
-- (clientes pela regra da Base, sem os que já vieram por negócio) e os demais clientes da plataforma (origem "outra",
-- só para a fila). Os dados da plataforma vêm do espelho (ops.consultoria_plataforma).
create or replace function ops.consultoria_funil_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _porta text;
begin
  _porta := ops.consultoria_porta_leitura();
  return (
  with
  neg as (
    select distinct on (c.pipedrive_deal_id) c.pipedrive_deal_id deal, c.titulo, c.ganho_em, c.origem_pipeline,
           c.unidade, c.closer, coalesce(c.mrr_mensal, c.mrr) mrr,
           nullif(regexp_replace(coalesce(c.cnpj, ''), '\D', '', 'g'), '') c_cnpj, c.empresa_id
      from ops.contratos c
     where c.ganho_em >= '2026-01-01' and c.pipedrive_deal_id is not null and c.origem_pipeline in ('inside_sales', 'socios')
     order by c.pipedrive_deal_id, c.ganho_em
  ),
  neg_cnpj as (
    select n.*,
      case
        when length(n.c_cnpj) = 14 then n.c_cnpj
        when d.cnpj is not null then d.cnpj
        when length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14 then regexp_replace(e.cnpj, '\D', '', 'g')
        when length(regexp_replace(coalesce(h.cnpj, ''), '\D', '', 'g')) = 14 then regexp_replace(h.cnpj, '\D', '', 'g')
        else r.cnpj end cnpj,
      case
        when length(n.c_cnpj) = 14 then 'contrato'
        when d.cnpj is not null then 'documento'
        when length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14 then 'empresa'
        when length(regexp_replace(coalesce(h.cnpj, ''), '\D', '', 'g')) = 14 then 'pipedrive'
        else r.fonte end cnpj_fonte,
      h.organizacao
    from neg n
    left join ops.empresas e on e.id = n.empresa_id
    left join ops.handoff_consultoria_negocios h on h.pipedrive_deal_id = n.deal
    left join ops.consultoria_negocio_cnpj r on r.pipedrive_deal_id = n.deal
    -- O CNPJ dos documentos do contrato (o próprio ou o da empresa do documento), como no RPC da busca.
    left join lateral (
      select x.cnpj from (
        select regexp_replace(coalesce(cd.cnpj, ''), '\D', '', 'g') cnpj, 1 o from ops.contratos_documentos cd
         where cd.pipedrive_deal_id = n.deal
        union all
        select regexp_replace(coalesce(e2.cnpj, ''), '\D', '', 'g'), 2 from ops.contratos_documentos cd
          join ops.empresas e2 on e2.id = cd.empresa_id where cd.pipedrive_deal_id = n.deal
      ) x where length(x.cnpj) = 14 order by x.o limit 1
    ) d on true
  ),
  vendas as (
    -- Uma empresa por CNPJ: o primeiro ganho dá a origem, a unidade e a data; os demais negócios somam.
    select coalesce(cnpj, 'deal:' || deal) chave, cnpj,
           (array_agg(titulo order by ganho_em, deal))[1] nome,
           (array_agg(origem_pipeline order by ganho_em, deal))[1] origem,
           (array_agg(unidade order by ganho_em, deal))[1] unidade,
           (array_agg(closer order by ganho_em, deal))[1] closer,
           min(ganho_em) ganho_em, sum(mrr) mrr, count(*) negocios,
           (array_agg(deal order by ganho_em, deal))[1] deal,
           (array_agg(cnpj_fonte order by ganho_em, deal))[1] cnpj_fonte,
           array[cnpj] cnpjs
      from neg_cnpj group by coalesce(cnpj, 'deal:' || deal), cnpj
  ),
  goiania as (
    select 'base:' || b.key chave, (b.base->'cnpjs'->>0) cnpj, b.perfil->>'name' nome, 'goiania' origem, 'Goiânia' unidade,
           null::text closer, null::date ganho_em, null::numeric mrr, 0::bigint negocios, null::text deal,
           'base' cnpj_fonte, array(select jsonb_array_elements_text(b.base->'cnpjs')) cnpjs
      from ops.base_carteira b
     where 9 = any(b.unidade_ids) and b.base->'situacao'->>'estado' = 'cliente'
       and not (b.base->'cnpjs' ?| coalesce((select array_agg(cnpj) from vendas where cnpj is not null), '{}'))
  ),
  universo as (select * from vendas union all select * from goiania),
  cli as (
    select id, cnpj, left(cnpj, 8) raiz, nome, dados from ops.consultoria_plataforma
     where tabela = 'clientes' and ausente_desde is null
  ),
  u_cnpj as (select u.chave, x cnpj from universo u, unnest(u.cnpjs) x where length(x) = 14),
  liga_exata as (
    select distinct on (uc.chave) uc.chave, c.id from u_cnpj uc join cli c on c.cnpj = uc.cnpj order by uc.chave, c.cnpj
  ),
  liga_raiz as (
    select distinct on (uc.chave) uc.chave, c.id from u_cnpj uc join cli c on c.raiz = left(uc.cnpj, 8)
     order by uc.chave, substr(c.cnpj, 9, 4) <> '0001', c.cnpj
  ),
  liga as (
    -- O cliente da plataforma de cada empresa: CNPJ exato; sem ele, a raiz (a matriz primeiro).
    select u.chave, coalesce(e.id, r.id) cliente_id
      from universo u left join liga_exata e on e.chave = u.chave left join liga_raiz r on r.chave = u.chave
  ),
  canal as (select id, dados->>'nome' nome from ops.consultoria_plataforma where tabela = 'canais_venda' and ausente_desde is null),
  pj as (
    select p.id, p.cliente_id, p.dados, (p.dados->>'baixado')::boolean baixado,
           nullif(p.dados->>'data_entrega', '') entrega, p.dados->>'etapa_atual' etapa, p.dados->>'data_entrada' entrada,
           k.nome canal
      from ops.consultoria_plataforma p left join canal k on k.id = p.dados->>'canal_venda_id'
     where p.tabela = 'projetos_gestao' and p.ausente_desde is null and p.cliente_id is not null
  ),
  pz as (select projeto_id, dados from ops.consultoria_plataforma where tabela = 'v_painel_prazo_card' and ausente_desde is null),
  tese as (
    select x.projeto_id, x.dados->>'convertido_status' st, coalesce((x.dados->>'oportunidade')::numeric, 0) v
      from ops.consultoria_plataforma x where x.tabela = 'oportunidades' and x.ausente_desde is null and x.projeto_id is not null
  ),
  por_cli_pj as (
    select pj.cliente_id,
      count(*) projetos, count(*) filter (where not coalesce(pj.baixado, false)) abertos,
      bool_or(pj.entrega is not null or pj.etapa = 'pos_entrega') auditado,
      min(pj.entrega) entregue_em, min(pj.entrada) entrada,
      array_remove(array_agg(distinct pj.canal), null) canais
    from pj group by 1
  ),
  aberto as (
    select distinct on (pj.cliente_id) pj.cliente_id, pj.etapa, pj.dados->>'produto' produto,
           (pz.dados->>'dias_na_etapa')::int dias_na_etapa, (pz.dados->>'meta_dias')::int meta_dias,
           (pz.dados->>'dias_alem_da_meta')::int dias_alem
      from pj left join pz on pz.projeto_id = pj.id
     where not coalesce(pj.baixado, false)
     order by pj.cliente_id, pj.entrada desc nulls last
  ),
  por_cli_tese as (
    select pj.cliente_id,
      sum(t.v) filter (where coalesce(t.st, '') not in ('Declinado', 'Baixada')) identificado,
      sum(t.v) filter (where t.st in ('Sim', 'Em operação')) aceito,
      sum(t.v) filter (where t.st = 'Em Negociação') negociacao
    from pj join tese t on t.projeto_id = pj.id group by 1
  ),
  por_cli_est as (
    select e.cliente_id,
      sum(coalesce((e.dados->>'valor_total_aprovado')::numeric, 0)) aprovado,
      sum(coalesce((s.dados->>'saldo_atual')::numeric, 0) * coalesce((e.dados->>'aliquota_exito')::numeric, 0))
        filter (where e.dados->>'status' = 'ativo') garantido,
      sum(coalesce((s.dados->>'total_utilizado')::numeric, 0)) utilizado
    from ops.consultoria_plataforma e
    left join ops.consultoria_plataforma s on s.tabela = 'estoque_saldos' and s.id = e.id and s.ausente_desde is null
    where e.tabela = 'estoque_credito' and e.ausente_desde is null group by 1
  ),
  por_cli_prop as (
    select cliente_id, count(*) filter (where dados->>'status' = 'aceita') aceitas
      from ops.consultoria_plataforma where tabela = 'propostas' and ausente_desde is null and cliente_id is not null group by 1
  ),
  por_cli_rec as (
    select c.id cliente_id,
      sum(coalesce((r.dados->>'valor_conta')::numeric, 0)) faturado,
      sum(coalesce((r.dados->>'valor_conta')::numeric, 0))
        filter (where coalesce(r.dados->>'data_emissao', r.dados->>'data_vencimento') >= '2026-01-01') faturado_2026,
      sum(coalesce((r.dados->>'valor_recebido')::numeric, 0)) recebido,
      sum(coalesce((r.dados->>'valor_recebido')::numeric, 0)) filter (where r.dados->>'data_credito' >= '2026-01-01') recebido_2026,
      sum(coalesce((r.dados->>'valor_a_receber')::numeric, 0)) a_receber,
      sum(coalesce((r.dados->>'valor_a_receber')::numeric, 0))
        filter (where r.dados->>'data_vencimento' < to_char(current_date, 'YYYY-MM-DD')) em_atraso
    from cli c join ops.consultoria_plataforma r on r.tabela = 'recebimentos' and r.ausente_desde is null and r.cnpj = c.cnpj
    where coalesce((r.dados->>'cancelado')::boolean, false) = false
    group by 1
  ),
  fup as (
    select pj.cliente_id, max(f.dados->>'created_at') ultimo_fup
      from pj join ops.consultoria_plataforma f on f.tabela = 'projeto_fups' and f.ausente_desde is null and f.projeto_id = pj.id
     group by 1
  ),
  reg as (
    select distinct on (cliente_id) cliente_id, resultado, nota, proximo_contato_em, autor_nome, registrado_em
      from ops.consultoria_fila_registros order by cliente_id, registrado_em desc
  ),
  regn as (select cliente_id, count(*) n from ops.consultoria_fila_registros group by 1),
  perfil as (
    -- Regime e teto de faturamento da Base, pelo CNPJ (para explicar quem não chegou: Simples, porte).
    -- Lido direto da carteira (a view base_conta_cnpjs custa segundos), só para os CNPJs do universo.
    select distinct on (x.cnpj) x.cnpj, b.perfil->>'regime' regime, (b.perfil->>'faturamento_teto')::numeric teto
      from ops.base_carteira b, jsonb_array_elements_text(b.base->'cnpjs') x(cnpj)
     where b.base->'cnpjs' ?| coalesce((select array_agg(distinct cnpj) from u_cnpj), '{}')
       and x.cnpj in (select cnpj from u_cnpj)
     order by x.cnpj, b.atualizado_em desc
  ),
  linhas as (
    select u.chave, u.cnpj, u.nome, u.origem, u.unidade, u.closer, u.ganho_em, u.mrr, u.negocios, u.deal, u.cnpj_fonte,
           l.cliente_id
      from universo u join liga l on l.chave = u.chave
    union all
    -- Os demais clientes da plataforma: só a fila usa.
    select 'cliente:' || c.id, c.cnpj, c.nome, 'outra', null, null, null, null, 0, null, 'plataforma', c.id
      from cli c where not exists (select 1 from liga l where l.cliente_id = c.id)
  )
  select jsonb_build_object(
    'lido_em', now(),
    'porta_financeiro', jsonb_build_object('aberta', _porta is null, 'motivo', _porta),
    'frescor', jsonb_build_object(
      'plataforma', (select max(executado_em) from ops.sync_log where fonte = 'consultoria_plataforma' and status in ('sucesso', 'parcial')),
      'cnpj_resolvido', (select max(resolvido_em) from ops.consultoria_negocio_cnpj)),
    'empresas', coalesce(jsonb_agg(jsonb_build_object(
      'chave', x.chave, 'cnpj', x.cnpj, 'nome', coalesce(c.nome, x.nome), 'origem', x.origem, 'unidade', x.unidade,
      'closer', x.closer, 'ganho_em', x.ganho_em, 'mrr', x.mrr, 'negocios', x.negocios, 'deal', x.deal,
      'cnpj_fonte', x.cnpj_fonte,
      'regime', coalesce(c.dados->>'regime', pf.regime), 'faturamento_teto', pf.teto,
      'cliente_id', x.cliente_id, 'cadastrado_em', c.dados->>'created_at',
      'canais', coalesce(to_jsonb(p.canais), '[]'::jsonb), 'projetos', coalesce(p.projetos, 0), 'abertos', coalesce(p.abertos, 0),
      'auditado', coalesce(p.auditado, false), 'entregue_em', p.entregue_em,
      'etapa', a.etapa, 'produto', a.produto, 'dias_na_etapa', a.dias_na_etapa, 'meta_dias', a.meta_dias, 'dias_alem', a.dias_alem,
      'identificado', coalesce(t.identificado, 0), 'aceito', coalesce(t.aceito, 0), 'negociacao', coalesce(t.negociacao, 0),
      'aprovado', coalesce(es.aprovado, 0), 'garantido', coalesce(es.garantido, 0), 'tem_estoque', es.cliente_id is not null,
      'propostas_aceitas', coalesce(pr.aceitas, 0),
      'faturado', case when _porta is null then coalesce(rc.faturado, 0) end,
      'faturado_2026', case when _porta is null then coalesce(rc.faturado_2026, 0) end,
      'recebido', case when _porta is null then coalesce(rc.recebido, 0) end,
      'recebido_2026', case when _porta is null then coalesce(rc.recebido_2026, 0) end,
      'a_receber', case when _porta is null then coalesce(rc.a_receber, 0) end,
      'em_atraso', case when _porta is null then coalesce(rc.em_atraso, 0) end,
      'tem_fatura', rc.cliente_id is not null and coalesce(rc.faturado, 0) > 0,
      'ultimo_fup', fu.ultimo_fup,
      'registro', case when rg.cliente_id is null then null else jsonb_build_object(
        'resultado', rg.resultado, 'nota', rg.nota, 'proximo', rg.proximo_contato_em, 'autor', rg.autor_nome,
        'em', rg.registrado_em, 'total', rn.n) end
    ) order by x.origem, x.ganho_em desc nulls last, x.chave), '[]'::jsonb)
  )
  from linhas x
  left join cli c on c.id = x.cliente_id
  left join por_cli_pj p on p.cliente_id = x.cliente_id
  left join aberto a on a.cliente_id = x.cliente_id
  left join por_cli_tese t on t.cliente_id = x.cliente_id
  left join por_cli_est es on es.cliente_id = x.cliente_id
  left join por_cli_prop pr on pr.cliente_id = x.cliente_id
  left join por_cli_rec rc on rc.cliente_id = x.cliente_id
  left join fup fu on fu.cliente_id = x.cliente_id
  left join reg rg on rg.cliente_id = x.cliente_id
  left join regn rn on rn.cliente_id = x.cliente_id
  left join perfil pf on pf.cnpj = x.cnpj
  -- Os clientes de outras origens só entram com dinheiro na mesa (a fila); o funil é dos vendidos e de Goiânia.
  where x.origem <> 'outra' or coalesce(t.identificado, 0) > 0 or coalesce(t.aceito, 0) > 0 or es.cliente_id is not null
     or coalesce(rc.a_receber, 0) > 0
  );
end;
$$;
revoke execute on function ops.consultoria_funil_painel() from public, anon;
grant execute on function ops.consultoria_funil_painel() to authenticated;

select ops.consultoria_resolver_cnpj();
select cron.schedule('consultoria-resolver-cnpj-diario', '40 9 * * *', $cron$ select ops.consultoria_resolver_cnpj(); $cron$);

commit;
