-- Portal de Faturamento · a conferência das parcelas roda com o privilégio do dono (20/10/2026).
--
-- `receita.fat_parcelas_conferir()` é gatilho de constraint DEFERRABLE INITIALLY DEFERRED: dispara
-- no COMMIT, já fora da RPC `security definer` que mexeu no pedido. Nesse momento o papel da sessão
-- é `authenticated`, que não lê `receita.fat_pedidos`, e todo salvar/enviar pela tela morreria com
-- "permission denied for table fat_pedidos". O gate da T1b não pegava porque termina em rollback, e o
-- gatilho adiado nunca chega a disparar. Achado no teste de integração do conector (T2).
--
-- A função só lê `fat_pedidos` e `fat_pedido_parcelas` e levanta exceção quando a soma não fecha;
-- rodar como dono não abre nada a quem chama. `search_path` continua vazio (nomes qualificados).
alter function receita.fat_parcelas_conferir() security definer;
alter function receita.fat_parcelas_conferir() set search_path = '';
revoke all on function receita.fat_parcelas_conferir() from public, anon, authenticated;
