-- Desfaz o "can() veste o papel simulado" (23/09/2026).
--
-- Volta `ops.can()` ao texto que estava no banco antes: delegação pura para
-- `ops.can_user(auth.uid(), _key)`.
--
-- O que volta a acontecer: quem simula uma unidade sendo super admin volta a
-- carregar as próprias chaves no banco, então as views com porta de admin
-- (`v_broker_cac_saldo`, `v_broker_cac_extrato`, `v_broker_cac_fila`,
-- `v_cac_funil`) voltam a devolver a rede inteira durante a simulação, e a aba
-- CAC do broker volta a mostrar a primeira unidade da lista no lugar da
-- simulada.
--
-- Não mexe em `ops.can_user`, que esta migration não tocou.

set search_path = ops, public;

create or replace function ops.can(_key text)
returns boolean
language sql
stable security definer
set search_path to 'ops', 'public', 'extensions'
as $function$
  select ops.can_user(auth.uid(), _key)
$function$;

drop function if exists ops.papel_tem_chave(text, text);

notify pgrst, 'reload schema';
