import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PainelBruto } from "./handoff-consultoria";

// Leitura da tela Handoff Consultoria: um RPC só, com a sessão da pessoa. O RPC confere
// `view.monetizacao`, recorta por unidade e só devolve R$ a quem passa na porta do Financeiro
// (migration 20261002180000). A conta é de src/lib/monetizacao/handoff-consultoria.ts, no cliente.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

export async function lerHandoffConsultoria(context: { supabase: unknown }): Promise<PainelBruto> {
  const db = context.supabase as DB;
  const { data, error } = await db.schema("ops").rpc("handoff_consultoria_painel");
  if (error) {
    if (error.code === "42501")
      throw new Error("Seu acesso não inclui a Monetização (view.monetizacao).");
    console.error("[handoff-consultoria]", error);
    throw new Error(`A leitura do handoff falhou${error.code ? ` (código ${error.code})` : ""}.`);
  }
  return data as PainelBruto;
}

export const carregarHandoffConsultoria = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerHandoffConsultoria(context));
