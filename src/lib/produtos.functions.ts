import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Descobre se o usuário logado no Ops também tem acesso ao Growth.
 *
 * Desde 17/09/2026 o Growth mora no banco único (schema `growth`), então a
 * resposta sai de `growth.membros` pelo user_id da própria sessão, e não mais
 * do projeto antigo por e-mail. Serve para decidir se o seletor de produtos
 * mostra o Growth, sem oferecer um link que levaria a uma tela vazia.
 *
 * Vale para qualquer usuário autenticado: cada um só consulta o próprio acesso.
 */
export const meuAcessoGrowth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabaseAdmin as any)
      .schema("growth")
      .from("membros")
      .select("papel")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) {
      console.error("[meuAcessoGrowth] membros query failed:", error);
      return { configurado: true as const, temAcesso: false, papel: null as string | null };
    }
    return {
      configurado: true as const,
      temAcesso: Boolean(data),
      papel: ((data as { papel?: string } | null)?.papel ?? null) as string | null,
    };
  });

/**
 * Em quais produtos a pessoa entra, lido de `public.produto_acesso`.
 *
 * Esta é a fonte única a partir de 14/09/2026. Antes cada produto respondia de
 * um jeito: o Ops por papel + porta do produto, o Growth pela base dele, e o
 * Financeiro era DERIVADO de uma chave de permissão do Ops
 * (`view.brain_financeiro`) — ou seja, quem mandava no cockpit era a matriz de
 * papéis de outro produto, e não existia lugar para responder "em que sistemas
 * fulano entra".
 *
 * `.schema("public")` é obrigatório: o cliente do app aponta para o schema
 * `ops`, e `produto_acesso` mora no `public`, que é comum aos três.
 */
export const meusProdutos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // `as any` no schema: o `types.ts` gerado descreve o schema `ops`, e
    // `produto_acesso` mora no `public`, comum aos três produtos. Tipar isso de
    // verdade exige gerar tipos dos dois schemas, que é tarefa à parte.
    const { data, error } = await (supabaseAdmin as any)
      .schema("public")
      .from("produto_acesso")
      .select("produto")
      .eq("user_id", context.userId);

    if (error) {
      console.error("[meusProdutos] consulta falhou:", error);
      // Falha de leitura não pode virar "perdeu acesso": devolve o Ops, que é
      // onde a pessoa já está, e deixa os outros dois fora até a próxima carga.
      return { ops: true, growth: false, financeiro: false };
    }

    const produtos = new Set(((data ?? []) as { produto: string }[]).map((r) => r.produto));
    return {
      ops: produtos.has("ops"),
      growth: produtos.has("growth"),
      financeiro: produtos.has("financeiro"),
    };
  });
