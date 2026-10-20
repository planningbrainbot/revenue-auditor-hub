-- 110_cac_parcela_integral.sql
-- CAC integral vira uma linha so. Pedido do usuario em 20/10/2026: duplicar a
-- linha (1a parcela 50% + copia como 2a parcela 50%) ficava estranho na tela.
--
--   3 = integral: 1a e 2a parcela cobradas juntas na mesma apuracao, 100% sobre
--       o 1o honorario, porque a unidade ja recebeu o 1o honorario
--
-- Junta os pares abertos da apuracao 51 (Campo Novo 09/2026), lancados pela
-- migration 102 e pela opcao Integral da tela: Camianski, Sementes Oliveira e
-- OTP Auto Pecas (sem contrato vinculado, casa pelo CNPJ). A
-- linha da 1a parcela vira a integral a 100% e a da 2a sai do mes. O total da
-- apuracao nao muda (50 + 50 = 100), entao os totais ficam como estao.
-- A apuracao 64 (Sao Luis, Epura) esta fechada e fica como foi cobrada.
set search_path = ops, public;

begin;

alter table ops.royalties_itens drop constraint if exists royalties_itens_cac_parcela_check;
alter table ops.royalties_itens
  add constraint royalties_itens_cac_parcela_check check (cac_parcela in (1, 2, 3));

comment on column ops.royalties_itens.cac_parcela is
  '1 = adiantamento de 50% na assinatura; 2 = 50% apos o recebimento do 1o honorario (caixa); 3 = integral, as duas juntas a 100%. Nulo fora do CAC ou nao classificado.';

with pares as (
  select i1.id as id1, i2.id as id2
    from ops.royalties_itens i1
    join ops.royalties_itens i2
      on i2.apuracao_id = i1.apuracao_id
     and coalesce(i2.contrato_id::text, i2.cnpj) = coalesce(i1.contrato_id::text, i1.cnpj)
     and i2.is_cac and i2.cac_parcela = 2 and i2.excluido_em is null
   where i1.apuracao_id = 51 and i1.id in (8404, 7440, 7950)
     and i1.is_cac and i1.cac_parcela = 1 and i1.excluido_em is null
), segunda as (
  update ops.royalties_itens i
     set excluido_em = now(), excluido_por = 'migration 110',
         motivo_exclusao = 'Coberto pelo CAC integral', confirmado = false
    from pares p where i.id = p.id2
  returning i.id
)
update ops.royalties_itens i
   set cac_parcela = 3,
       royalties_percentual_override = 100,
       royalties_item = round(i.valor_confirmado, 2),
       observacao = 'CAC integral (1a + 2a parcela, 100%) sobre o 1o honorario de R$ '
                    || to_char(i.valor_confirmado, 'FM999G999D00')
                    || ', ja recebido. Migration 110 juntou as duas linhas.'
  from pares p where i.id = p.id1;

commit;
