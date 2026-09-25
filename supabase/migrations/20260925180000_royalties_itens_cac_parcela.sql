-- 82_royalties_itens_cac_parcela.sql
-- Separa, na apuracao, o CAC cobrado como adiantamento do CAC que segue o
-- caixa do cliente. Pedido do usuario em 25/09/2026.
--
-- A regra da rede (DATA-RULES, jul/2026 e 18/09/2026):
--   1 = 1a parcela, 50% de adiantamento, cobrada na assinatura do contrato,
--       mesmo sem o cliente ter pago nada
--   2 = 2a parcela, 50% em regime de caixa, so depois que a unidade recebe o
--       1o honorario do cliente
-- Ate aqui a distincao so existia no texto da observacao. Nulo = item que nao e
-- CAC, ou CAC antigo que ninguem classificou (SALGA de 06/2026 a 100%, por ex.).
--
-- Backfill so da apuracao 45 (Fortaleza 08/2026), a que vai virar nota agora.
-- O historico fica nulo de proposito: classificar pelo card do pipe exige
-- conferir parcela a parcela, e Campo Novo e Sao Luis lancaram tudo no campo
-- da 2a parcela (DATA-RULES, 16/09/2026).

set search_path = ops, public;

begin;

alter table ops.royalties_itens
  add column if not exists cac_parcela smallint
  check (cac_parcela in (1, 2));

comment on column ops.royalties_itens.cac_parcela is
  '1 = adiantamento de 50% na assinatura; 2 = 50% apos o recebimento do 1o honorario (caixa). Nulo fora do CAC ou nao classificado.';

update ops.royalties_itens
   set cac_parcela = case when contrato_id = 220 then 2 else 1 end
 where apuracao_id = 45 and is_cac and excluido_em is null;

commit;
