-- O saldo do aquario nao pode somar CAC.
--
-- Aplicar so no banco unico (npknehhyyzelmrbbxvtu):
--   set search_path to ops, public;
--
-- Depois da migration 58 o `broker_movimentos` passou a guardar duas moedas na
-- mesma tabela: o CashBrain do aquario (pre-pago, `origem` nula) e o CAC que a
-- unidade ja deve (`origem` começando em cac_). As views do broker somavam as
-- duas, entao a tela mostrava Maceio com DISPONIVEL -103.818 CB, como se ela
-- tivesse gasto isso comprando cliente no aquario. Nao tinha: e divida de CAC.
--
-- Corrigido no mesmo dia, antes de qualquer unidade ver a tela.

create or replace view broker_saldo as
  select u.id as unidade_id,
    u.nome_da_praca,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'credito'), 0) as credito_recebido,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'aporte'), 0) as credito_comprado,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'estorno'), 0) as estornado,
    coalesce(sum(m.valor_cb) filter (where m.tipo in ('credito','aporte','estorno')), 0) as creditado,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'reserva'), 0)
      - coalesce(sum(m.valor_cb) filter (where m.tipo = 'liberacao'), 0) as bloqueado,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'debito'), 0) as investido,
    coalesce(sum(m.valor_cb) filter (where m.tipo in ('credito','aporte','estorno')), 0)
      - coalesce(sum(m.valor_cb) filter (where m.tipo = 'debito'), 0)
      - (coalesce(sum(m.valor_cb) filter (where m.tipo = 'reserva'), 0)
         - coalesce(sum(m.valor_cb) filter (where m.tipo = 'liberacao'), 0)) as disponivel
  from unidades u
  left join broker_movimentos m on m.unidade_id = u.id and m.origem is null
  group by u.id, u.nome_da_praca;

create or replace view v_broker_meu_saldo as
  select u.id as unidade_id,
    u.nome_da_praca,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'credito'), 0) as credito_recebido,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'aporte'), 0) as credito_comprado,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'estorno'), 0) as estornado,
    coalesce(sum(m.valor_cb) filter (where m.tipo in ('credito','aporte','estorno')), 0) as creditado,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'reserva'), 0)
      - coalesce(sum(m.valor_cb) filter (where m.tipo = 'liberacao'), 0) as bloqueado,
    coalesce(sum(m.valor_cb) filter (where m.tipo = 'debito'), 0) as investido,
    coalesce(sum(m.valor_cb) filter (where m.tipo in ('credito','aporte','estorno')), 0)
      - coalesce(sum(m.valor_cb) filter (where m.tipo = 'debito'), 0)
      - (coalesce(sum(m.valor_cb) filter (where m.tipo = 'reserva'), 0)
         - coalesce(sum(m.valor_cb) filter (where m.tipo = 'liberacao'), 0)) as disponivel
  from unidades u
  left join broker_movimentos m on m.unidade_id = u.id and m.origem is null
  where can('view.broker') and u.id in (select minhas_unidades())
  group by u.id, u.nome_da_praca;

-- A aba "Movimentacoes" tambem nao pode misturar as duas moedas.
create or replace view v_broker_extrato as
  select id, unidade_id, tipo, valor_cb, oportunidade_id, mes_ref, observacao, criado_em
  from broker_movimentos m
  where origem is null
    and can('view.broker')
    and unidade_id in (select minhas_unidades());
