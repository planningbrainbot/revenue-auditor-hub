import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
export const estadoSincronizacaoBase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).schema("ops").rpc("base_sync_status");
    if (error) throw new Error("Não foi possível consultar a sincronização da base.");
    return data;
  });
export const contatosBase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await (context.supabase as any).schema("ops").rpc("base_contatos");
    if (error) throw new Error("Não foi possível consultar os contatos no seu escopo.");
    return data as {
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
      role: string | null;
      accounts: string[];
    }[];
  });
export const validarOrigemBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      key: z.string().min(1).max(80),
      origin: z.enum(["antiga", "nova"]),
      responsible: z.string().trim().min(3),
      evidence: z.string().trim().min(10),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any)
      .schema("ops")
      .rpc("base_validar_origem", {
        _key: data.key,
        _origem: data.origin,
        _responsavel: data.responsible,
        _evidencia: data.evidence,
      });
    if (error) throw new Error(error.message);
    return result as { status: string; pending: number };
  });
