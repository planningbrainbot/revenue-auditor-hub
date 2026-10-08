-- Rollback de 20261008160000_gente_revoga_public_funcoes: devolve EXECUTE a PUBLIC.
begin;
grant execute on function ops.minha_pessoa_id() to public;
grant execute on function ops.minhas_unidades_gente() to public;
grant execute on function ops.e_gestor_de(bigint) to public;
grant execute on function ops.gente_touch() to public;
grant execute on function ops.gente_fechar_afastamento() to public;
grant execute on function ops.gente_mov_numerar() to public;
grant execute on function ops.gente_pessoas_registrar_historico() to public;
commit;
