import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Emite a sessão do Financial Brain para quem acabou de autenticar no Ops.
 *
 * Por que existe: o Financial nasceu sem login — ninguém tem senha lá. Então
 * `signInWithPassword` (o caminho usado com o Growth) não serve. Aqui o
 * servidor do Ops, que já verificou a identidade da pessoa, usa a service role
 * do Financial para gerar um token de acesso único; o navegador troca esse
 * token por uma sessão de verdade (verifyOtp) e a grava no cookie do domínio
 * raiz, como os outros dois produtos já fazem.
 *
 * SEGURANÇA — as duas travas que sustentam isto:
 *   1. O e-mail NUNCA vem do cliente. É lido das claims do token do Ops já
 *      validado pelo middleware. Sem isso, qualquer pessoa logada poderia
 *      pedir a sessão de outra.
 *   2. O usuário no Financial é criado com o e-mail já confirmado, porque a
 *      confirmação de identidade aconteceu no Ops. Nenhum e-mail é disparado.
 */
export const emitirSessaoFinanceiro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | undefined)?.email;
    if (!email) {
      // Sem e-mail na claim não há como identificar a pessoa do outro lado.
      return { ok: false as const, motivo: "sem-email" };
    }

    const { getFinanceiroAdmin } = await import(
      "@/integrations/supabase/client.financeiro.server"
    );
    const admin = getFinanceiroAdmin();
    if (!admin) return { ok: false as const, motivo: "nao-configurado" };

    try {
      // generateLink com type 'magiclink' exige usuário existente; 'invite'
      // cria. Tentamos o caminho de usuário existente e, se não existir,
      // criamos com e-mail já confirmado e repetimos.
      let r = await admin.auth.admin.generateLink({ type: "magiclink", email });

      if (r.error) {
        const criado = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
        });
        // Corrida com outra aba/sessão criando o mesmo usuário não é erro.
        if (criado.error && !/already|exists|registered/i.test(criado.error.message)) {
          console.warn("[financeiro] criar usuário falhou:", criado.error.message);
          return { ok: false as const, motivo: "criar-usuario" };
        }
        r = await admin.auth.admin.generateLink({ type: "magiclink", email });
      }

      const tokenHash = r.data?.properties?.hashed_token;
      if (r.error || !tokenHash) {
        console.warn("[financeiro] generateLink falhou:", r.error?.message);
        return { ok: false as const, motivo: "gerar-token" };
      }

      return { ok: true as const, tokenHash };
    } catch (err) {
      // Best-effort de propósito: o acesso ao Ops não pode cair porque o
      // Financial está fora do ar.
      console.warn("[financeiro] emissão de sessão falhou:", err);
      return { ok: false as const, motivo: "excecao" };
    }
  });
