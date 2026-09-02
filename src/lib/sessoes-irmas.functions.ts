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
/**
 * Emite a sessão do GROWTH para quem acabou de autenticar no Ops.
 *
 * Por que não usa `signInWithPassword` como antes: aquilo exigia a senha ser
 * idêntica nos dois bancos, e não é — verificado em 02/09/2026, o login do
 * Growth vinha falhando em silêncio desde sempre por isso. Emitir a sessão a
 * partir da identidade já verificada no Ops elimina a exigência de paridade
 * de senha, que era a fragilidade do desenho anterior.
 *
 * Diferença deliberada em relação ao Financial: aqui NÃO criamos usuário. O
 * Growth tem base própria (28 pessoas) e autoriza por e-mail em `membros` —
 * quem não existe lá não deve passar a existir só por ter logado no Ops.
 */
export const emitirSessaoGrowth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = (context.claims as { email?: string } | undefined)?.email;
    if (!email) return { ok: false as const, motivo: "sem-email" };

    const { getGrowthAdmin } = await import(
      "@/integrations/supabase/client.growth.server"
    );
    const admin = getGrowthAdmin();
    if (!admin) return { ok: false as const, motivo: "nao-configurado" };

    try {
      const { data: lista } = await admin.auth.admin.listUsers();
      const existe = lista?.users?.some(
        (u) => u.email?.toLowerCase() === email.toLowerCase(),
      );
      // Sem conta no Growth não há sessão a emitir — e isso não é erro.
      if (!existe) return { ok: false as const, motivo: "sem-conta-no-growth" };

      const r = await admin.auth.admin.generateLink({ type: "magiclink", email });
      const tokenHash = r.data?.properties?.hashed_token;
      if (r.error || !tokenHash) {
        console.warn("[growth] generateLink falhou:", r.error?.message);
        return { ok: false as const, motivo: "gerar-token" };
      }
      return { ok: true as const, tokenHash };
    } catch (err) {
      console.warn("[growth] emissão de sessão falhou:", err);
      return { ok: false as const, motivo: "excecao" };
    }
  });

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
      // Garante o usuário ANTES de gerar o token. `generateLink` cria sozinho
      // quando não existe, mas cria com e-mail NÃO confirmado — e depender do
      // verifyOtp para confirmar depois é frágil. Aqui a confirmação é
      // explícita: a identidade já foi verificada no Ops, então o e-mail é
      // confiável por construção.
      const criado = await admin.auth.admin.createUser({ email, email_confirm: true });
      const jaExistia =
        criado.error && /already|exists|registered/i.test(criado.error.message);

      if (criado.error && !jaExistia) {
        console.warn("[financeiro] criar usuário falhou:", criado.error.message);
        return { ok: false as const, motivo: "criar-usuario" };
      }

      // Usuário anterior pode ter sido criado sem confirmação (por um
      // generateLink de antes desta correção) — normaliza.
      if (jaExistia) {
        const { data: lista } = await admin.auth.admin.listUsers();
        const existente = lista?.users?.find(
          (u) => u.email?.toLowerCase() === email.toLowerCase(),
        );
        if (existente && !existente.email_confirmed_at) {
          await admin.auth.admin.updateUserById(existente.id, { email_confirm: true });
        }
      }

      const r = await admin.auth.admin.generateLink({ type: "magiclink", email });
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
