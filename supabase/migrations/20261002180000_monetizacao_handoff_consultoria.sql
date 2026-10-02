-- Handoff Consultoria (`/monetizacao?aba=handoff-consultoria`): clientes do onboarding da Expansão
-- que chegam à Consultoria, o que ela recebe deles e quanto repassar à Expansão.
-- Contrato: docs/design/contratos/monetizacao-handoff-consultoria.md. Pedido do Pedro em 02/10/2026.
--
-- Três fontes, todas espelhadas pela Edge Function `handoff-consultoria-sync` (agendada abaixo):
--   1. Pipefy 307173656 ([PTRS-CLI-01] Onboarding Cliente): um card por cliente, com a chave (CNPJ)
--      recuperada pelos conectores do card. `ops.cs_onboarding_cards` não serve: a sync dela lê dois
--      campos que saíram do pipe, e CNPJ e organização chegam vazios nos 206 cards (medido em 02/10).
--   2. Plataforma da Consultoria: `ops.consultoria_clientes` e `ops.consultoria_propostas`, que a
--      `consultoria-sync` já mantém. Nada muda nelas.
--   3. PAT no Financial Brain (a empresa que fatura a Consultoria): receita por CNPJ e mês.
-- As regras do repasse ficam em `ops.handoff_consultoria_regras`, nunca no código.

-- ── 1. Onboarding da Expansão, com a chave ──────────────────────────────────────────────────────
create table if not exists ops.handoff_consultoria_onboarding (
  pipefy_card_id text primary key,
  titulo text not null,
  unidade text,
  unidade_id integer,
  fase_atual text,
  criado_em timestamptz,
  venda_em date,
  kickoff_em date,
  -- "Será Encaminhado Para Consultoria Tributária?" (fase de kickoff, existe desde 16/09/2026).
  encaminhado text check (encaminhado in ('Sim', 'Não')),
  contrato_card_ids text[] not null default '{}',
  empresa_record_ids text[] not null default '{}',
  pipedrive_deal_id text,
  cnpj text check (cnpj ~ '^[0-9]{11}$|^[0-9]{14}$'),
  cnpj_fonte text,
  -- Faixa DECLARADA: "Faturamento anual" do negócio ganho no Pipedrive ou o mesmo rótulo no card.
  -- A estimativa da DataStone nunca entra aqui.
  faixa text,
  faixa_id integer,
  faixa_ordem integer,
  faixa_fonte text check (faixa_fonte in ('pipedrive_negocio', 'onboarding')),
  -- Última tentativa de resolver a chave e a faixa fora do banco (Pipefy e Pipedrive).
  chave_tentada_em timestamptz,
  sincronizado_em timestamptz not null,
  ausente_desde timestamptz
);
create index if not exists handoff_consultoria_onboarding_cnpj on ops.handoff_consultoria_onboarding (cnpj);
create index if not exists handoff_consultoria_onboarding_raiz on ops.handoff_consultoria_onboarding (left(cnpj, 8));
comment on table ops.handoff_consultoria_onboarding is
  'Cards do Pipefy 307173656 (Onboarding Cliente da Expansão) com o CNPJ recuperado pelos conectores '
  '(contrato, Data Base de empresas) ou pelo Pipedrive. Edge Function handoff-consultoria-sync.';

-- ── 2. Receita da PAT por CNPJ e mês (Financial Brain) ──────────────────────────────────────────
create table if not exists ops.handoff_consultoria_pat (
  cnpj text not null check (cnpj ~ '^[0-9]{11}$|^[0-9]{14}$'),
  mes date not null check (extract(day from mes) = 1),
  cliente_omie text not null,
  -- Receita bruta 1.1 por competência (fn_faturamento_mensal, a régua da tela de Faturamento).
  faturado numeric(14, 2) not null default 0,
  -- Só a categoria de créditos tributários (o êxito sobre o crédito recuperado).
  creditos numeric(14, 2) not null default 0,
  -- Títulos recebidos com crédito em caixa no mês (titulo_valor_pago, líquido de retenções).
  recebido numeric(14, 2) not null default 0,
  sincronizado_em timestamptz not null,
  primary key (cnpj, mes)
);
comment on table ops.handoff_consultoria_pat is
  'Receita da PAT (empresa da Consultoria) por CNPJ e mês, lida do Financial Brain: faturado e créditos '
  'por competência, recebido pela data de crédito. Cliente do lançamento casado pelo cadastro do Omie.';

-- ── 3. Regras do repasse (tabela, nunca código) ─────────────────────────────────────────────────
create table if not exists ops.handoff_consultoria_regras (
  id bigint generated always as identity primary key,
  chave text not null check (chave in (
    'repasse_expansao',          -- fração do recebido que vai à Expansão
    'repasse_unidade',           -- dela, a parte da unidade que vendeu (informativo, já dentro da anterior)
    'fee_estimado',              -- fee sobre o crédito, para estimar o recuperado
    'exclui_cliente_previo_pat'  -- 1 = cliente que a PAT já faturava antes da chegada fica fora
  )),
  valor numeric not null check (valor >= 0 and valor <= 1),
  vigente_desde date not null,
  situacao text not null check (situacao in ('proposta', 'confirmada')),
  origem text not null,
  registrado_em timestamptz not null default now()
);
create unique index if not exists handoff_consultoria_regras_vigencia
  on ops.handoff_consultoria_regras (chave, vigente_desde);

insert into ops.handoff_consultoria_regras (chave, valor, vigente_desde, situacao, origem) values
  ('repasse_expansao', 0.50, '2026-07-01', 'proposta',
   'Decisão de 29/09/2026 (monetizacao/memoria/decisoes.md): a parte da Planning Partners na Consultoria é 50%. Recomendação de 02/10, aguardando o Pedro.'),
  ('repasse_unidade', 0.20, '2026-07-01', 'proposta',
   'Decisão de 29/09/2026: a unidade sócia fica com 40% da parte da Partners (40% × 50% = 20%). Recomendação de 02/10, aguardando o Pedro.'),
  ('fee_estimado', 0.25, '2026-07-01', 'proposta',
   'Fee da Consultoria no forecast v12 (crédito 600 mil × 25%), EM ABERTO. Só estima o recuperado até a plataforma enviar o valor real.'),
  ('exclui_cliente_previo_pat', 1, '2026-07-01', 'proposta',
   'Recomendação de 02/10: cliente que a PAT já faturava antes de chegar pelo onboarding não gera repasse.')
on conflict (chave, vigente_desde) do nothing;

-- ── RLS: leitura só pelo RPC abaixo (as regras também por select, para quem vê a Monetização) ───
alter table ops.handoff_consultoria_onboarding enable row level security;
alter table ops.handoff_consultoria_pat enable row level security;
alter table ops.handoff_consultoria_regras enable row level security;
revoke all on ops.handoff_consultoria_onboarding, ops.handoff_consultoria_pat, ops.handoff_consultoria_regras
  from public, anon, authenticated;
grant select, insert, update, delete on ops.handoff_consultoria_onboarding, ops.handoff_consultoria_pat
  to service_role;
grant select, insert, update, delete on ops.handoff_consultoria_regras to service_role;
grant select on ops.handoff_consultoria_regras to authenticated;
drop policy if exists handoff_consultoria_regras_read on ops.handoff_consultoria_regras;
create policy handoff_consultoria_regras_read on ops.handoff_consultoria_regras
  for select to authenticated using (ops.monetizacao_can('view.monetizacao'));

-- ── RPC da tela ─────────────────────────────────────────────────────────────────────────────────
-- Quem vê a Monetização vê as contagens; o sócio de unidade vê só os clientes da própria unidade.
-- Os valores em R$ (receita da PAT por cliente) exigem também a porta do Financeiro: produto
-- `financeiro` e escopo de todas as empresas — a mesma porta do Cockpit do CEO
-- (src/lib/cockpit-ceo/financeiro-porta.ts). Sem ela, `pat` vem nulo e `porta_financeiro` diz por quê.
create or replace function ops.handoff_consultoria_painel()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'ops', 'public', 'extensions'
as $$
declare
  _escopo record;
  _todas_unidades boolean;
  _financeiro boolean;
  _porta text;
begin
  if not ops.monetizacao_can('view.monetizacao') then
    raise exception 'Seu acesso não inclui a Monetização (view.monetizacao).' using errcode = '42501';
  end if;
  select todas_unidades, todas_empresas into _escopo from ops.usuario_escopo where user_id = auth.uid();
  _todas_unidades := coalesce(_escopo.todas_unidades, false);
  _financeiro := coalesce(public.tem_produto('financeiro'), false);
  _porta := case
    when not _financeiro then 'Sua conta não tem acesso ao Brain Financeiro.'
    when not coalesce(_escopo.todas_empresas, false) then 'Os valores da PAT exigem ver todas as empresas no Financeiro; seu escopo é por empresa.'
  end;

  return jsonb_build_object(
    'lido_em', now(),
    'todas_unidades', _todas_unidades,
    'porta_financeiro', jsonb_build_object('aberta', _porta is null, 'motivo', _porta),
    'regras', coalesce((
      select jsonb_agg(jsonb_build_object('chave', chave, 'valor', valor, 'vigente_desde', vigente_desde,
               'situacao', situacao, 'origem', origem) order by chave, vigente_desde)
      from ops.handoff_consultoria_regras), '[]'::jsonb),
    'frescor', jsonb_build_object(
      'onboarding', (select max(executado_em) from ops.sync_log where fonte = 'handoff_consultoria' and status in ('sucesso', 'parcial')),
      'consultoria', (select max(executado_em) from ops.sync_log where fonte = 'consultoria' and status = 'sucesso'),
      'pat', (select max(sincronizado_em) from ops.handoff_consultoria_pat),
      'financeiro_carregado_em', (select detalhes->>'financeiro_carregado_em' from ops.sync_log
                                   where fonte = 'handoff_consultoria' and detalhes ? 'financeiro_carregado_em'
                                   order by executado_em desc limit 1)
    ),
    'clientes', coalesce((
      select jsonb_agg(c order by c->>'card')
      from (
        select jsonb_build_object(
          'card', o.pipefy_card_id,
          'titulo', o.titulo,
          'unidade', o.unidade,
          'unidade_id', o.unidade_id,
          'fase', o.fase_atual,
          'criado_em', o.criado_em,
          'venda_em', o.venda_em,
          'kickoff_em', o.kickoff_em,
          'encaminhado', o.encaminhado,
          'cnpj', o.cnpj,
          'cnpj_fonte', o.cnpj_fonte,
          'faixa', o.faixa,
          'faixa_ordem', o.faixa_ordem,
          'faixa_fonte', o.faixa_fonte,
          'consultoria', cons.j,
          'propostas', coalesce(prop.n, 0),
          'pat', case when _porta is null then pat.j end
        ) as c
        from ops.handoff_consultoria_onboarding o
        -- Chegou: o CNPJ, ou na falta dele a raiz (mesma pessoa jurídica), na plataforma.
        left join lateral (
          select jsonb_build_object('cadastrado_em', cc.cadastrado_em, 'via', x.via, 'ativo', cc.ativo,
                   'inativo_desde', cc.inativo_desde, 'valor_a_recuperar', cc.valor_a_recuperar,
                   'valor_a_recuperar_em', cc.valor_a_recuperar_em) as j
          from (
            select cc.id, 'cnpj' as via, 0 as ord from ops.consultoria_clientes cc
             where o.cnpj is not null and cc.cnpj = o.cnpj and cc.ausente_desde is null
            union all
            select cc.id, 'raiz', 1 from ops.consultoria_clientes cc
             where length(o.cnpj) = 14 and cc.cnpj_raiz = left(o.cnpj, 8) and cc.ausente_desde is null
          ) x join ops.consultoria_clientes cc on cc.id = x.id
          order by x.ord, cc.cadastrado_em
          limit 1
        ) cons on true
        left join lateral (
          select count(*) as n from ops.consultoria_propostas p
           where p.ausente_desde is null and o.cnpj is not null
             and (regexp_replace(p.cnpj, '\D', '', 'g') = o.cnpj
                  or (length(o.cnpj) = 14 and left(regexp_replace(p.cnpj, '\D', '', 'g'), 8) = left(o.cnpj, 8)))
        ) prop on true
        -- PAT: o CNPJ exato; sem ele, a raiz.
        left join lateral (
          select jsonb_agg(jsonb_build_object('mes', mes, 'faturado', faturado, 'creditos', creditos,
                   'recebido', recebido, 'cliente_omie', cliente_omie) order by mes) as j
          from (
            select p.mes, sum(p.faturado) faturado, sum(p.creditos) creditos, sum(p.recebido) recebido,
                   string_agg(distinct p.cliente_omie, ' · ') cliente_omie
            from ops.handoff_consultoria_pat p
            where o.cnpj is not null and (
              p.cnpj = o.cnpj
              or (length(o.cnpj) = 14 and left(p.cnpj, 8) = left(o.cnpj, 8)
                  and not exists (select 1 from ops.handoff_consultoria_pat e where e.cnpj = o.cnpj)))
            group by p.mes
          ) m
        ) pat on true
        where o.ausente_desde is null
          and (_todas_unidades or ops.monetizacao_scope(array[o.unidade_id]))
      ) linhas
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function ops.handoff_consultoria_painel() from public, anon;
grant execute on function ops.handoff_consultoria_painel() to authenticated;

-- ── Agenda: a cada 30 minutos, com o segredo dos sinais da Base ─────────────────────────────────
-- O segredo do cabeçalho mora no Vault (base_sinais_cron_secret) e na Edge Function
-- (SINAIS_CRON_SECRET), como a consultoria-sync e a pipefy-tratativas-sync.
select cron.unschedule('handoff-consultoria-sync-30min')
 where exists (select 1 from cron.job where jobname = 'handoff-consultoria-sync-30min');
select cron.schedule('handoff-consultoria-sync-30min', '5,35 * * * *', $cron$
 select net.http_post(url:='https://npknehhyyzelmrbbxvtu.supabase.co/functions/v1/handoff-consultoria-sync',headers:=jsonb_build_object('Content-Type','application/json','x-planning-sinais-cron',(select decrypted_secret from vault.decrypted_secrets where name='base_sinais_cron_secret')),body:='{"trigger":"cron"}'::jsonb,timeout_milliseconds:=150000);
$cron$);
