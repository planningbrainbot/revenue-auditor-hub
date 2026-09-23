import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MARCA_SENHA_PROVISORIA } from "./senha-provisoria";

/**
 * Tira a marca de senha provisória de quem acabou de cadastrar a própria senha.
 *
 * Age sobre `context.userId` e mais ninguém: a função é aberta a qualquer
 * sessão válida (a pessoa marcada não é admin), então o alvo não pode vir do
 * corpo do pedido. Exige service role porque `app_metadata` não é escrita pelo
 * token do usuário.
 *
 * `null` no valor apaga a chave: o GoTrue mescla o `app_metadata` recebido no
 * que já existe e remove as chaves nulas. É o que preserva a concessão do
 * Financeiro (`brain`) e o `provider`, que moram no mesmo objeto.
 */
export const concluirSenhaProvisoria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      app_metadata: { [MARCA_SENHA_PROVISORIA]: null },
    });
    if (error) {
      console.error("[concluirSenhaProvisoria] updateUserById failed:", error);
      throw new Error("Não foi possível concluir a troca. Saia e entre de novo com a senha nova.");
    }
    return { ok: true };
  });
