-- Desfaz a simulação de unidade ("ver como") de 18/09/2026.
--
-- Seguro a qualquer momento: nada do modelo de acesso passou a depender destes
-- objetos. `getMyPermissions` chama `ver_como_atual` dentro de um Promise.all e
-- trata erro como "nenhuma simulação" — sem as funções, o app volta a entregar
-- a visão real de cada um, sem tela quebrada.
--
-- O que se perde: as simulações em curso (quem estiver com uma ligada volta à
-- própria visão no próximo carregamento) e as linhas de `ops.acessos_log` NÃO
-- são apagadas, de propósito: o histórico de quem simulou o quê é registro de
-- auditoria, não estado da feature.

drop function if exists ops.ver_como_encerrar();
drop function if exists ops.ver_como_iniciar(integer, text);
drop function if exists ops.ver_como_atual();
drop function if exists ops.acesso_do_papel(text);
drop table if exists ops.ver_como;

notify pgrst, 'reload schema';
