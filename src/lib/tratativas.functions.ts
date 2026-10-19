import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

// ============ syncTratativas ============
// Botão "Forçar atualização" da aba Tratativas: dispara a Edge Function
// pipefy-tratativas-sync, a mesma que o pg_cron roda a cada 15 min. Antes esta
// server fn tinha a própria cópia do mapeamento, que ficou para trás: id de
// fase de "Recuperado" errado (o card voltava a "open"), data de churn crua,
// MRR mal convertido e remoção sem a trava de leitura vazia. Agora a regra
// vive só em supabase/functions/pipefy-tratativas-sync/domain.mjs.
export const syncTratativas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ total: number; removidos: number }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.APP_SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase não configurado no servidor.");

    const res = await fetch(`${url}/functions/v1/pipefy-tratativas-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "manual" }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) {
      throw new Error(`Sync de tratativas falhou: ${body?.error ?? res.status}`);
    }
    return { total: body.cards ?? 0, removidos: body.removidos ?? 0 };
  });
