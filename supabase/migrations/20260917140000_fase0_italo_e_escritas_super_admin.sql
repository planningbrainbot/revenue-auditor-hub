-- Fase 0 do PLANO-ADMIN-DELEGADO, e dois achados do levantamento da Fase 1.
--
-- 1. Italo Amaral é sócio regional de BELÉM (confirmado pelo dono em 17/09).
--    Ele tinha papel `socio_regional`, `todas_unidades = false` e nenhuma
--    unidade: escopo vazio. Também não tinha linha em `ops.socios`, que é de
--    onde as funções antigas tiram a unidade por texto. Cargo e área ficam em
--    branco de propósito: não foram informados.
--
-- 2. `headcount_mensal` e `comite_correcoes` aceitavam escrita de qualquer
--    pessoa com a porta do Ops, sem chave nenhuma. Nenhuma tela do app grava
--    nelas (headcount está vazia; correções tem 1 linha). Decisão do dono em
--    17/09: só o super admin grava, por enquanto. Leitura não muda.

insert into ops.socios (nome_completo, unidade, email, user_id)
select 'Italo Amaral', 'Belém', 'italo.amaral@grupoplanning.com.br', '9bb70b7c-196f-4ef3-82df-07adfcba9c01'
 where not exists (select 1 from ops.socios where user_id = '9bb70b7c-196f-4ef3-82df-07adfcba9c01');

insert into ops.usuario_unidades (user_id, unidade_id)
select '9bb70b7c-196f-4ef3-82df-07adfcba9c01', u.id from ops.unidades u where u.nome_da_praca = 'Belém'
on conflict do nothing;

drop policy if exists headcount_mensal_insert_authenticated on ops.headcount_mensal;
create policy headcount_mensal_insert_authenticated on ops.headcount_mensal
  for insert to authenticated
  with check (tem_produto('ops') and ops.eh_super_admin((select auth.uid())));

drop policy if exists headcount_mensal_update_authenticated on ops.headcount_mensal;
create policy headcount_mensal_update_authenticated on ops.headcount_mensal
  for update to authenticated
  using (tem_produto('ops') and ops.eh_super_admin((select auth.uid())))
  with check (tem_produto('ops') and ops.eh_super_admin((select auth.uid())));

drop policy if exists insert_publico_comite_correcoes on ops.comite_correcoes;
create policy insert_publico_comite_correcoes on ops.comite_correcoes
  for insert to authenticated
  with check (tem_produto('ops') and ops.eh_super_admin((select auth.uid())));
