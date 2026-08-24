import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Descobre se o usuário logado no Ops também tem acesso ao Growth.
 *
 * O Growth autoriza por e-mail em public.membros — quem não tem linha lá não
 * enxerga nada. Serve pra decidir se o seletor de produtos mostra o Growth,
 * pra não oferecer um link que só levaria a uma tela vazia.
 *
 * Diferente das funções de /admin/usuarios, esta vale pra qualquer usuário
 * autenticado (cada um só consulta o próprio acesso).
 */
export const meuAcessoGrowth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getGrowthAdmin } = await import("@/integrations/supabase/client.growth.server");
    const growth = getGrowthAdmin();
    if (!growth) return { configurado: false as const, temAcesso: false, papel: null as string | null };

    const claims = context.claims as { email?: string } | undefined;
    let email = (claims?.email ?? "").toLowerCase();

    if (!email) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("user_id", context.userId)
        .maybeSingle();
      email = (data?.email ?? "").toLowerCase();
    }
    if (!email) return { configurado: true as const, temAcesso: false, papel: null };

    const { data, error } = await growth
      .from("membros")
      .select("papel")
      .eq("email", email)
      .maybeSingle();
    if (error) {
      console.error("[meuAcessoGrowth] membros query failed:", error);
      return { configurado: true as const, temAcesso: false, papel: null };
    }

    return {
      configurado: true as const,
      temAcesso: Boolean(data),
      papel: (data?.papel as string | undefined) ?? null,
    };
  });
