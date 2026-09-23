-- CAC pos-pago dentro do extrato do broker.
--
-- Aplicar so no banco unico (npknehhyyzelmrbbxvtu):
--   set search_path to ops, public;
--
-- O broker foi desenhado pre-pago: a unidade ganha Cota, reserva, compra e
-- debita. O que roda hoje e o inverso -- a matriz entrega o cliente e a unidade
-- paga depois. O extrato aguenta os dois, muda so a ordem: no pos-pago o debito
-- vem primeiro e o saldo negativo e a divida. Nada de tabela nova.
--
-- Decisoes do usuario em 16/09/2026:
--   1. O detalhe sai do pipe "Cobranca CAC Adiantado" (307316953) e a baixa no
--      Omie valida o total. Dupla validacao, nao fonte unica.
--   2. Divida e fila em colunas distintas: so o que foi cobrado vira debito. O
--      atribuido ainda nao cobrado fica fora do saldo, em v_broker_cac_fila.
--   3. Venda do proprio socio (pipeline 4) NAO gera CAC. So a maquina de growth.
--   4. Patos de Minas entra a partir de agosto/2026, com a verba de midia que
--      ele paga entrando como credito.
--
-- O que a conciliacao de 16/09/2026 achou e que esta migration congela:
--   - o CAC tem categoria propria no Omie (1.01.92), entao nas notas emitidas a
--     mao cada componente e um titulo separado e da para ler baixa de CAC sem
--     regra de rateio;
--   - Maceio tem R$ 78 mil cobrados no pipe que nunca viraram nota;
--   - Fortaleza fecha na casa do centavo somando um titulo de R$ 6.250 que saiu
--     na categoria Royalties por defeito de cadastro do servico.

-- ---------------------------------------------------------------------------
-- 1. O tipo que faltava
-- ---------------------------------------------------------------------------
-- `aporte` e a unidade comprando Cota no modelo pre-pago. Pagamento de divida e
-- outra coisa, e vai ter relatorio separando os dois quando os dois existirem
-- ao mesmo tempo no Q1/2027. Tipo proprio agora evita reescrever historico.
alter table broker_movimentos drop constraint if exists broker_movimentos_tipo_check;
alter table broker_movimentos add constraint broker_movimentos_tipo_check
  check (tipo in ('credito','aporte','reserva','liberacao','debito','estorno','pagamento'));

-- ---------------------------------------------------------------------------
-- 2. Procedencia de cada linha
-- ---------------------------------------------------------------------------
-- Sem isto o extrato do CAC se mistura com as 20 linhas de teste do broker
-- pre-pago (Curitiba e Rio) e com o que vier do aquario em 2027.
alter table broker_movimentos add column if not exists origem     text;
alter table broker_movimentos add column if not exists referencia text;
alter table broker_movimentos add column if not exists cliente    text;

comment on column broker_movimentos.origem is
  'cac_pipe | cac_contrato | cac_omie | cac_midia | null (broker pre-pago)';
comment on column broker_movimentos.referencia is
  'chave na origem: card:<id>:p1, contrato:<id>, omie:<codigo_omie>';

-- O extrato e append-only (nem update nem delete). O indice unico e o que
-- permite reprocessar a sincronia sem duplicar dinheiro.
create unique index if not exists broker_movimentos_origem_ref_uk
  on broker_movimentos (origem, referencia)
  where origem is not null and referencia is not null;

create index if not exists broker_movimentos_origem_idx
  on broker_movimentos (origem, unidade_id);

-- ---------------------------------------------------------------------------
-- 3. A chave de nome
-- ---------------------------------------------------------------------------
-- O card do pipe nao tem CNPJ nem Deal ID, entao card x contrato casa pelo nome
-- normalizado dentro da unidade -- mesma regra de src/lib/cac.functions.ts.
-- Conferido em 16/09/2026: casou 59 de 59 dos cards com valor cobrado.
-- Sem search_path fixo estas duas quebram quando chamadas pelo usuario logado,
-- que nao tem `ops` no caminho: a v_broker_cac_fila estourava com
-- 'relation "contratos" does not exist'.
create or replace function cac_nome_chave(t text)
returns text language sql immutable
set search_path = ops, public as $$
  select btrim(regexp_replace(
    lower(translate(coalesce(t,''),
      'áàãâéêíóôõúüçÁÀÃÂÉÊÍÓÔÕÚÜÇ','aaaaeeiooouucAAAAEEIOOOUUC')),
    '[^a-z0-9]+',' ','g'))
$$;

-- Cliente cujo unico contrato na unidade veio do pipeline de socios. Por
-- decisao de 16/09/2026 nao gera CAC. Hoje isso e um caso so: GLOBAL PLP, em
-- Maceio, R$ 101,31.
-- security definer de proposito: se a regra lesse `contratos` sob a RLS de quem
-- pergunta, o mesmo cliente seria venda de socio para uns e nao para outros. A
-- origem da venda e fato, nao depende de quem olha.
create or replace function cac_e_venda_socio(_unidade text, _cliente text)
returns boolean language sql stable security definer
set search_path = ops, public as $$
  select exists (
      select 1 from ops.contratos c
      where c.unidade = _unidade
        and ops.cac_nome_chave(c.titulo) = ops.cac_nome_chave(_cliente)
        and c.origem_pipeline = 'socios')
     and not exists (
      select 1 from ops.contratos c
      where c.unidade = _unidade
        and ops.cac_nome_chave(c.titulo) = ops.cac_nome_chave(_cliente)
        and c.origem_pipeline is distinct from 'socios')
$$;

-- CNPJ da unidade, um por linha. Curitiba tem 4 entidades no mesmo campo.
create or replace view v_unidade_cnpj as
  select id unidade_id, nome_da_praca,
         regexp_replace(unnest(string_to_array(cnpj, E'\n')), '[^0-9]', '', 'g') cnpj
  from unidades where cnpj is not null;

-- ---------------------------------------------------------------------------
-- 4. A sincronia
-- ---------------------------------------------------------------------------
-- Idempotente: so insere o que ainda nao existe. Pode rodar de hora em hora sem
-- medo. Nao apaga nem corrige linha ja lancada -- correcao e estorno, nunca
-- update, porque isto aqui e dinheiro.
create or replace function broker_cac_sync()
returns table (debitos int, pagamentos int)
language plpgsql security definer set search_path = ops, public as $$
declare _d int; _p int;
begin
  -- 4.1 Debito: o que o pipe registra como cobrado, parcela a parcela.
  -- A fase NAO decide. Fortaleza prova: "Alfa Pecas" esta em "Cobrar 100%" e ja
  -- foi cobrada e paga -- a fase atrasa em relacao a realidade. O sinal e o
  -- valor lancado no campo da parcela.
  with cards as (
    select p.pipefy_card_id, u.id unidade_id, p.cliente,
           p.valor_cobrado_p1, p.data_cobranca_p1,
           p.valor_cobrado_p2, p.data_cobranca_p2
    from v_cac_cobranca_pipe p
    join unidades u on u.nome_da_praca = p.unidade
    -- Churn antes do 1o fee nao vira divida: Jd Rina, R$ 500 em Maceio, virou
    -- credito da unidade na decisao de 15/09/2026.
    where p.fase_atual not ilike 'Churn%'
      and not cac_e_venda_socio(p.unidade, p.cliente)
  ), parcelas as (
    select unidade_id, cliente, pipefy_card_id||':p1' ref,
           valor_cobrado_p1 valor, data_cobranca_p1 data
    from cards where coalesce(valor_cobrado_p1,0) > 0
    union all
    select unidade_id, cliente, pipefy_card_id||':p2',
           valor_cobrado_p2, data_cobranca_p2
    from cards where coalesce(valor_cobrado_p2,0) > 0
  )
  insert into broker_movimentos
    (unidade_id, tipo, valor_cb, mes_ref, origem, referencia, cliente, criado_por)
  select unidade_id, 'debito', valor, date_trunc('month', data)::date,
         'cac_pipe', ref, cliente, 'broker_cac_sync'
  from parcelas
  on conflict (origem, referencia) where origem is not null and referencia is not null
  do nothing;
  get diagnostics _d = row_count;

  -- 4.2 Debito de Patos de Minas, que nao tem card no pipe.
  -- A atribuicao sai do contrato ganho, pela regra geral: CAC = 100% do 1o
  -- honorario. So inside sales e so de agosto/2026 em diante.
  insert into broker_movimentos
    (unidade_id, tipo, valor_cb, mes_ref, origem, referencia, cliente, criado_por)
  select 2, 'debito', coalesce(c.mrr_override, c.mrr_mensal),
         date_trunc('month', c.ganho_em)::date,
         'cac_contrato', 'contrato:'||c.id, c.titulo, 'broker_cac_sync'
  from contratos c
  where c.unidade = 'Patos de Minas'
    and c.origem_pipeline = 'inside_sales'
    and c.ganho_em >= date '2026-08-01'
    and coalesce(c.mrr_override, c.mrr_mensal) > 0
  on conflict (origem, referencia) where origem is not null and referencia is not null
  do nothing;
  get diagnostics _p = row_count;
  _d := _d + _p;

  -- 4.3 Pagamento: a baixa no Omie da Partners.
  insert into broker_movimentos
    (unidade_id, tipo, valor_cb, mes_ref, origem, referencia, observacao, criado_por)
  select u.unidade_id, 'pagamento', cr.valor,
         date_trunc('month', cr.data_competencia)::date,
         case when cr.codigo_categoria = '1.03.96' then 'cac_midia' else 'cac_omie' end,
         'omie:'||cr.codigo_omie,
         case when cr.codigo_categoria = '1.03.96' then 'verba de midia'
              when cr.codigo_categoria <> '1.01.92' then 'titulo na categoria errada, conferido contra o pipe'
         end,
         'broker_cac_sync'
  from contas_receber cr
  join v_unidade_cnpj u on u.cnpj = regexp_replace(cr.cpf_cnpj,'[^0-9]','','g')
  where cr.unidade = 'Partners'
    and cr.data_pagamento is not null
    and coalesce(cr.status_pagamento,'') <> 'CANCELADO'
    and (
      -- 1.01.92 e a categoria CAC no plano de contas da Partners
      cr.codigo_categoria = '1.01.92'
      -- Fortaleza, 19/08: saiu como Royalties pelo defeito de cadastro do
      -- servico corrigido em 14/09. E CAC: com ele a unidade fecha com o pipe
      -- em R$ 0,63, sem ele sobra R$ 6.250 de divida que nao existe.
      or cr.codigo_omie = 2235059500
      -- Patos troca CAC por verba de midia (1.03.96), de agosto/2026 em diante
      or (u.unidade_id = 2 and cr.codigo_categoria = '1.03.96'
          and cr.data_competencia >= date '2026-08-01')
    )
  on conflict (origem, referencia) where origem is not null and referencia is not null
  do nothing;
  get diagnostics _p = row_count;

  return query select _d, _p;
end $$;

-- ---------------------------------------------------------------------------
-- 5. As leituras
-- ---------------------------------------------------------------------------
-- Filtro dentro da view, como no resto do broker: o admin ve a rede, a unidade
-- ve so a propria linha. Ver feedback sobre RLS seguir role_permissions.
create or replace view v_broker_cac_extrato as
  select m.id, m.unidade_id, u.nome_da_praca, m.tipo, m.valor_cb, m.cliente,
         m.mes_ref, m.origem, m.referencia, m.observacao, m.criado_em
  from broker_movimentos m
  join unidades u on u.id = m.unidade_id
  where m.origem in ('cac_pipe','cac_contrato','cac_omie','cac_midia')
    and (can('view.broker_admin')
         or (can('view.broker') and m.unidade_id in (select minhas_unidades())));

create or replace view v_broker_cac_saldo as
  select u.id unidade_id, u.nome_da_praca,
    coalesce(sum(m.valor_cb) filter (where m.tipo='debito'),0)    cobrado,
    coalesce(sum(m.valor_cb) filter (where m.tipo='pagamento'),0) pago,
    coalesce(sum(m.valor_cb) filter (where m.tipo='estorno'),0)   abatido,
    coalesce(sum(m.valor_cb) filter (where m.tipo='debito'),0)
      - coalesce(sum(m.valor_cb) filter (where m.tipo='pagamento'),0)
      - coalesce(sum(m.valor_cb) filter (where m.tipo='estorno'),0) a_pagar
  from unidades u
  left join broker_movimentos m
    on m.unidade_id = u.id
   and m.origem in ('cac_pipe','cac_contrato','cac_omie','cac_midia')
  where u.paga_cac
    and (can('view.broker_admin')
         or (can('view.broker') and u.id in (select minhas_unidades())))
  group by u.id, u.nome_da_praca;

-- A fila: atribuido que ainda nao foi cobrado. Nao e divida, e o que vem.
create or replace view v_broker_cac_fila as
  select u.id unidade_id, u.nome_da_praca, i.razao_social cliente,
         i.valor_cac_total valor, a.mes_referencia,
         i.status_parcela_1, i.status_parcela_2
  from cac_apuracao_itens i
  join cac_apuracao a on a.id = i.apuracao_id
  join unidades u on u.id = a.unidade_id
  where i.excluido_em is null
    and not cac_e_venda_socio(u.nome_da_praca, i.razao_social)
    and not exists (
      select 1 from broker_movimentos m
      where m.origem = 'cac_pipe' and m.unidade_id = u.id
        and cac_nome_chave(m.cliente) = cac_nome_chave(i.razao_social))
    and (can('view.broker_admin')
         or (can('view.broker') and u.id in (select minhas_unidades())));

-- O que esta cobrado, nao recebido, e nem nota tem. E a fila de emissao, nao a
-- de inadimplencia -- as duas exigem acao de gente diferente.
create or replace view v_broker_cac_pendencia_emissao as
  with cac_aberto as (
    select u.unidade_id, sum(cr.valor) valor
    from contas_receber cr
    join v_unidade_cnpj u on u.cnpj = regexp_replace(cr.cpf_cnpj,'[^0-9]','','g')
    where cr.unidade = 'Partners' and cr.codigo_categoria = '1.01.92'
      and cr.data_pagamento is null
      and coalesce(cr.status_pagamento,'') <> 'CANCELADO'
    group by 1
  ), misto_aberto as (
    -- a emissao nova (Edge Function, desde 14/09) manda um titulo so, com tudo
    -- dentro. Aqui o CAC vem da fatura, nao da categoria do titulo.
    select rf.unidade_id, sum(rf.valor_cac) valor
    from royalties_faturas rf
    where coalesce(rf.valor_cac,0) > 0 and rf.status = 'faturada'
    group by 1
  )
  select s.unidade_id, s.nome_da_praca, s.a_pagar,
         coalesce(c.valor,0) + coalesce(x.valor,0) as ja_tem_nota,
         s.a_pagar - coalesce(c.valor,0) - coalesce(x.valor,0) as sem_nota
  from v_broker_cac_saldo s
  left join cac_aberto   c on c.unidade_id = s.unidade_id
  left join misto_aberto x on x.unidade_id = s.unidade_id;

grant select on v_broker_cac_extrato, v_broker_cac_saldo, v_broker_cac_fila,
                v_broker_cac_pendencia_emissao, v_unidade_cnpj to authenticated;
grant execute on function broker_cac_sync() to service_role;
grant execute on function cac_nome_chave(text), cac_e_venda_socio(text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Backfill
-- ---------------------------------------------------------------------------
-- select * from broker_cac_sync();
-- Rodado em 16/09/2026: 83 debitos e 11 pagamentos. Segunda chamada devolveu
-- (0, 0), confirmando a idempotencia.
