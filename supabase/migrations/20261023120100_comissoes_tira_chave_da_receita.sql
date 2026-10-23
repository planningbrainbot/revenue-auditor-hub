-- Comissões, D-05 do PRD wiki/prds/2026-10-comissoes-v1.md: a área Comissões substitui a Apuração de
-- comissões (/comissoes, área Receita). A chave view.comissoes deixa de vir da área `receita`; as
-- concessões individuais continuam. Aplicar junto com o deploy do código, não antes: até lá a tela
-- antiga está no ar e precisa da chave.
-- Reversão: insert into ops.area_chaves (area, permission_key) values ('receita', 'view.comissoes');
delete from ops.area_chaves where area = 'receita' and permission_key = 'view.comissoes';
