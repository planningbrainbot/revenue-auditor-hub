-- Rollback do Portal de Faturamento · T1a (20261020100000_portal_faturamento_t1a.sql).
-- Volta ao estado da F1: apaga o schema integracoes (filas, vínculo e a função de credencial), os pedidos e as
-- parcelas, a numeração, as colunas novas de empresas_grupo e de fat_servicos; tira as 4 empresas que a T1a trouxe,
-- devolve AGRO, ROIT e PNC a ativa = true e fatura_por a nulo.
-- Rode antes o rollback da semente (20261020101000_portal_faturamento_servicos_e0_rollback.sql) se ela foi aplicada.
-- ATENÇÃO: pedidos, parcelas e filas vão junto. Se o portal já estiver em uso, guarde uma cópia fora do banco antes.
-- Os segredos omie_* do Vault NÃO saem aqui (são dado, não esquema, e a F1 já os nomeava). Para tirá-los também:
--   delete from vault.secrets where name like 'omie\_%';

begin;

drop function if exists integracoes.omie_credencial(uuid);
drop table if exists integracoes.omie_vinculo_cliente;
drop table if exists integracoes.pipefy_envios;
drop table if exists integracoes.omie_envios;
drop function if exists integracoes.tocar_updated_at();
drop schema if exists integracoes;

drop table if exists receita.fat_pedido_parcelas;
drop table if exists receita.fat_pedidos;
drop function if exists receita.fat_parcelas_conferir();
drop function if exists receita.fat_pedido_numero();
drop function if exists receita.fat_pedido_numero_formatar(bigint, timestamptz);
drop sequence if exists receita.fat_pedidos_numero_seq;

alter table receita.fat_servicos
  drop constraint if exists fat_servicos_id_emissora_key,
  drop column if exists tem_tributacao,
  drop column if exists id_tributacao,
  drop column if exists codigo;

comment on column receita.fat_servicos.categoria_padrao is null;

delete from organizacao.empresas_grupo
 where id in ('c2f915ce-960c-40a4-a659-2c8bb3580c75',   -- ASCENDIA
              'ead599c5-8491-46a9-889e-461e165db9b6',   -- CONCILIADOR
              'a601d0e7-f23f-4f1b-a65d-bff5c0b6b449',   -- FINANCE
              '3bac1e6e-bd25-4071-84ea-07ac26bef99f');  -- PNE

update organizacao.empresas_grupo set ativa = true
 where id in ('59028b02-f52f-4a64-a933-ad4b5028c985',   -- AGRO
              '45fcc16a-d2c1-44cc-9924-5c5f817c3f6b',   -- ROIT
              '4828f6a0-7f4e-42b6-8f3e-3fa45fe7d539');  -- PNC

update organizacao.empresas_grupo set fatura_por = null where fatura_por is not null;

alter table organizacao.empresas_grupo
  drop column if exists conta_corrente_padrao,
  drop column if exists pipefy_sync,
  drop column if exists modo_omie;

comment on table organizacao.empresas_grupo is
  'Domínio Rede e Organização. Empresas do Grupo Planning que emitem nota, cada uma com o seu Omie. '
  'Dono provisório: Controladoria (Ana Carvalhais), pelo Portal de Faturamento, até o domínio Rede e Organização '
  'assumir. Semeada em 15/10/2026 com as 18 empresas de public.empresas do Financial Brain (itpddzjfrgrbathcqbpo). '
  'O id é o mesmo uuid de lá e de ops.usuario_empresas.empresa_id. ATENÇÃO: o apelido segue as siglas do Pipefy '
  'de Contas a Receber, não o do Financial Brain. MAROX aqui é a Marox Serviços (55.950.467); a Planning Marox '
  'Consultoria (apelido MAROX no Financial Brain) é PMC. O elo entre os sistemas é o id ou o CNPJ, nunca o apelido. '
  'Escrita: service role; a controladoria só altera fatura_por.';
comment on column organizacao.empresas_grupo.fatura_por is
  'os, contrato ou ambos: vem do mapeamento da Ana. Nulo até ela responder.';
comment on column organizacao.empresas_grupo.ativa is null;
comment on column organizacao.empresas_grupo.omie_credencial_ref is
  'Nome do segredo no Vault do banco único (vault.secrets.name) com a credencial do Omie desta empresa. Nunca a '
  'chave. Nulo = empresa sem Omie (PAI e PMN em 15/10/2026). O segredo ainda não existe: as chaves estão no '
  'BRAIN_OPS_ENV do Financeiro (nome em public.empresas.omie_env_ref de lá) e vêm para o Vault no E0.';

commit;
