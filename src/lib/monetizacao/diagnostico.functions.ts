// Leitura da seção "Base nova" (pipe 40) com a sessão da pessoa: uma RPC só, com a mesma porta das outras abas da
// Monetização (ops.monetizacao_can('view.monetizacao')) e o recorte de unidade de ops.monetizacao_deals_leitura().
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizarPainelDiagnostico, type PainelDiag } from "./diagnostico";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

export const SEM_ACESSO_DIAG = "Seu acesso não inclui a Monetização (view.monetizacao).";

export async function lerDiagnostico(context: { supabase: unknown }): Promise<PainelDiag> {
  const { data, error } = await (context.supabase as DB)
    .schema("ops")
    .rpc("monetizacao_diagnostico_painel", {});
  if (error) {
    if (error.code === "42501") throw new Error(SEM_ACESSO_DIAG);
    if (error.code === "PGRST202" || error.code === "42883")
      throw new Error("A base nova ainda não foi ativada no banco (migration 20261016180000).");
    throw new Error("Não foi possível ler o pipe 40. Atualize para tentar de novo.");
  }
  if (data == null) throw new Error(SEM_ACESSO_DIAG);
  return normalizarPainelDiagnostico(data);
}

export const carregarDiagnostico = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerDiagnostico(context));
