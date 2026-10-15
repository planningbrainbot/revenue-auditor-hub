-- Rollback do Portal de Faturamento · F1 (20261015150000_portal_faturamento_f1.sql).
-- Apaga as tabelas, as funções e os dois schemas, e tira do modelo de acesso as três áreas, as quatro chaves e os
-- dois papéis. Quem tinha fat_tesouraria ou fat_controladoria perde o papel (é o único acesso que ele dava), e as
-- concessões por pessoa às chaves do faturamento somem junto (usuario_areas e area_admins caem em cascata pela
-- área; usuario_chaves não tem FK e é apagada aqui).
-- ATENÇÃO: receita.fat_eventos e receita.fat_donos levam o histórico junto. Se F2 já estiver no ar, não rode isto
-- sem antes guardar uma cópia fora do banco.
-- Os schemas só caem se estiverem vazios (sem cascade): se F2 já criou tabela neles, o rollback para ali.

begin;

drop table if exists receita.fat_eventos;
drop table if exists receita.fat_servicos;
drop table if exists receita.fat_donos;
drop table if exists organizacao.empresas_grupo;

drop function if exists receita.fat_tem_papel(uuid, text[]);
drop function if exists receita.fat_ve_tudo(uuid);
drop function if exists receita.fat_controladoria(uuid);
drop function if exists receita.fat_tesouraria(uuid);
drop function if exists receita.fat_no_escopo(uuid);
drop function if exists receita.fat_porta();
drop function if exists receita.fat_donos_registrar_evento();
drop function if exists receita.fat_eventos_imutavel();
drop function if exists receita.tocar_updated_at();
drop function if exists organizacao.tocar_updated_at();

drop domain if exists receita.competencia;
drop domain if exists receita.dinheiro;

drop schema if exists receita;
drop schema if exists organizacao;

delete from ops.usuario_chaves
 where permission_key in ('view.faturamento', 'edit.faturamento_pedido',
                          'edit.faturamento_tesouraria', 'admin.faturamento');
delete from ops.user_roles where role in ('fat_tesouraria', 'fat_controladoria');
delete from ops.role_areas where role in ('fat_tesouraria', 'fat_controladoria')
                             or area in ('faturamento', 'faturamento_tesouraria', 'faturamento_controladoria');
delete from ops.roles where key in ('fat_tesouraria', 'fat_controladoria');
delete from ops.area_chaves where area in ('faturamento', 'faturamento_tesouraria', 'faturamento_controladoria');
delete from ops.areas where slug in ('faturamento', 'faturamento_tesouraria', 'faturamento_controladoria');

commit;
