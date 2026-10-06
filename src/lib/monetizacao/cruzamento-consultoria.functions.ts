import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CruzamentoBruto } from "./cruzamento-consultoria";

// Leitura da tela Cruzamento Consultoria: um RPC só, com a sessão da pessoa. O RPC confere `view.monetizacao` e
// o escopo de todas as unidades, e só devolve a PAT a quem passa na porta do Financeiro (migration
// 20261006180000). A conta é de src/lib/monetizacao/cruzamento-consultoria.ts, no cliente.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

export async function lerCruzamentoConsultoria(context: {
  supabase: unknown;
}): Promise<CruzamentoBruto> {
  const db = context.supabase as DB;
  const { data, error } = await db.schema("ops").rpc("cruzamento_consultoria_painel");
  if (error) {
    if (error.code === "42501")
      throw new Error(
        error.message?.startsWith("Seu acesso")
          ? error.message
          : "Seu acesso não inclui a Monetização (view.monetizacao).",
      );
    console.error("[cruzamento-consultoria]", error);
    throw new Error(
      `A leitura do cruzamento falhou${error.code ? ` (código ${error.code})` : ""}.`,
    );
  }
  return data as CruzamentoBruto;
}

export const carregarCruzamentoConsultoria = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerCruzamentoConsultoria(context));
