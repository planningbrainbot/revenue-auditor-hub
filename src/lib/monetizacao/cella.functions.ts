import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CellaBruto } from "./cella";

// Leitura da aba Cella (migration 20261022190000), com a sessão da pessoa. O RPC confere `view.monetizacao` e o escopo
// de unidades; a conta fica em src/lib/monetizacao/cella.ts.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

export const carregarCella = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CellaBruto> => {
    const db = context.supabase as DB;
    const { data, error } = await db.schema("ops").rpc("monetizacao_cella_painel");
    if (error) {
      if (error.code === "42501")
        throw new Error("Seu acesso não inclui a Monetização (view.monetizacao).");
      console.error("[monetizacao-cella]", error);
      throw new Error(`A leitura da Cella falhou${error.code ? ` (código ${error.code})` : ""}.`);
    }
    return data as CellaBruto;
  });
