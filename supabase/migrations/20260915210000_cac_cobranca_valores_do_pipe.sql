-- O card do pipe passa a carregar o dinheiro (15/09/2026)
--
-- A migration de hoje de manhã (20260915160000) registrou que "o pipe não tem
-- campo de valor" e por isso o valor da cobrança seguia saindo de
-- `contratos.mrr_mensal`. Isso deixou de ser verdade no mesmo dia: o usuário
-- criou os campos de valor nas fases e o campo "Valor 1º Honorário" no start
-- form, e os 52 cards com cobrança foram preenchidos a partir das apurações de
-- royalties confirmadas.
--
-- Agora o card diz o que foi cobrado, quando, e sobre qual honorário. Isso é
-- melhor que derivar de `mrr_mensal` por dois motivos: é o valor que de fato
-- saiu na nota (já com as regras de rateio e os ajustes manuais da apuração), e
-- separa as duas parcelas, que `mrr_mensal` não sabe fazer.
--
-- Pares de campo por fase no Pipefy, e é de propósito que sejam dois pares:
--   Cobrar 50%   -> data_da_cobran_a   + valor_cobrado     (parcela 1)
--   Cobrar 100%  -> data_da_cobran_a_1 + valor_cobrado_1   (parcela 2)
--
-- Tudo aditivo: coluna nova entra nula e o código velho continua funcionando.
set search_path to ops, public;

alter table cac_cobranca_cards
  add column if not exists valor_1_honorario   numeric(12,2),
  add column if not exists data_cobranca_p1    date,
  add column if not exists valor_cobrado_p1    numeric(12,2),
  add column if not exists data_cobranca_p2    date,
  add column if not exists valor_cobrado_p2    numeric(12,2);

comment on column cac_cobranca_cards.valor_1_honorario is
  'Campo "Valor 1o Honorario" do start form: a receita do cliente sobre a qual o CAC incidiu. E a base, nao a cobranca.';
comment on column cac_cobranca_cards.valor_cobrado_p1 is
  'Campo "Valor Cobrado" da fase Cobrar 50%: a primeira parcela do CAC, como saiu na apuracao de royalties.';
comment on column cac_cobranca_cards.valor_cobrado_p2 is
  'Campo "Valor Cobrado" da fase Cobrar 100%: a segunda parcela. Cliente cobrado 100% de uma vez so usa este par, e o par da parcela 1 fica vazio.';
comment on column cac_cobranca_cards.data_cobranca_p1 is
  'Dia 15 do mes seguinte a competencia da apuracao que cobrou a parcela 1.';
comment on column cac_cobranca_cards.data_cobranca_p2 is
  'Dia 15 do mes seguinte a competencia da apuracao que cobrou a parcela 2.';

-- Uma leitura só para a tela: o que o pipe diz que foi cobrado de cada card,
-- sem a tela ter que somar parcela por parcela em três lugares diferentes.
create or replace view v_cac_cobranca_pipe as
select
  c.pipefy_card_id,
  c.cliente,
  c.unidade,
  c.fase_id,
  c.fase_atual,
  c.data_assinatura,
  c.valor_1_honorario,
  c.data_cobranca_p1,
  c.valor_cobrado_p1,
  c.data_cobranca_p2,
  c.valor_cobrado_p2,
  coalesce(c.valor_cobrado_p1, 0) + coalesce(c.valor_cobrado_p2, 0) as valor_cobrado_total,
  -- Quantas parcelas já têm valor lançado. Zero significa card aberto sem
  -- cobrança nenhuma, que é a maioria da fase "Nova Cobrança".
  (case when c.valor_cobrado_p1 is not null then 1 else 0 end)
  + (case when c.valor_cobrado_p2 is not null then 1 else 0 end) as parcelas_lancadas,
  -- Take rate do CAC sobre o honorário que o gerou. Null quando não dá para
  -- dividir, em vez de zero, que mentiria na média.
  case
    when coalesce(c.valor_1_honorario, 0) > 0
      then round(
        (coalesce(c.valor_cobrado_p1, 0) + coalesce(c.valor_cobrado_p2, 0))
        / c.valor_1_honorario * 100, 2)
    else null
  end as percentual_do_honorario,
  c.synced_at
from cac_cobranca_cards c;

comment on view v_cac_cobranca_pipe is
  'Cobranca de CAC como o pipe Pipefy enxerga: as duas parcelas, o total e o percentual sobre o 1o honorario. Fonte da tela /unidades/cac.';

grant select on v_cac_cobranca_pipe to authenticated;
