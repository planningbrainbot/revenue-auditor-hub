-- A tela "Histórico de Royalties" (/unidades/historico) sai a pedido do usuário
-- em 22/09/2026. `view.royalties_historico` guardava só ela — some junto.
--
-- Conferido antes de apagar, no próprio banco: nenhuma policy de RLS e nenhuma
-- function citam a chave (`pg_policies` e `pg_get_functiondef` sem uma
-- ocorrência sequer). É a diferença para `view.reconciliacao`, que ficou quando
-- a página dela foi apagada em 17/09 porque contratos e contas_receber leem por
-- ela. Aqui não há leitor: a chave só abria a rota no front.
--
-- Onde ela estava: `ops.area_chaves` (área receita) e `ops.role_permissions`
-- (papéis admin e diretor, ambos allowed). Os dois modelos de concessão
-- convivem — `ops.can()` resolve por area_chaves, e role_permissions ainda
-- alimenta a tela de acessos —, então a chave precisa sair dos dois, senão ela
-- reaparece na gestão de acessos como permissão que não guarda nada.
--
-- Os dados de royalties não são tocados: `royalties_apuracao` e
-- `royalties_itens` seguem inteiros, e a série histórica continua sendo lida
-- por `listRoyaltiesHistoricoRede`, que alimenta o gráfico do /rede-overview.

delete from ops.area_chaves
where permission_key = 'view.royalties_historico';

delete from ops.role_permissions
where permission_key = 'view.royalties_historico';
