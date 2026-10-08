-- Fecha o EXECUTE de PUBLIC em 7 funções do Planning People (08/10/2026),
-- pela auditoria de segurança (A-021: nada aberto além de quem precisa).
--
-- Levantamento antes de fechar: as 3 auxiliares (minha_pessoa_id,
-- minhas_unidades_gente, e_gestor_de) aparecem em 86 policies, todas do papel
-- `authenticated`, que tem grant próprio e continua com ele; e em 25 funções e
-- views que rodam como o dono. As 4 de gatilho sustentam 27 gatilhos, e o
-- Postgres não confere EXECUTE quando o gatilho dispara. Quem perde é só
-- `anon` (que não lê nenhuma tabela do Gente) e `broker_app` (que não usa
-- nenhuma delas). Revisão do legado registrada no PRD do Planning People v1.

begin;

revoke execute on function ops.minha_pessoa_id() from public, anon;
revoke execute on function ops.minhas_unidades_gente() from public, anon;
revoke execute on function ops.e_gestor_de(bigint) from public, anon;
revoke execute on function ops.gente_touch() from public, anon;
revoke execute on function ops.gente_fechar_afastamento() from public, anon;
revoke execute on function ops.gente_mov_numerar() from public, anon;
revoke execute on function ops.gente_pessoas_registrar_historico() from public, anon;

commit;
