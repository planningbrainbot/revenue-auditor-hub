import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";
import { assertAffected } from "@/lib/supabase-assert";

function maskSecret(secret: string): string {
  return `••••••••${secret.slice(-4)}`;
}

export const listOmieCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("omie_credentials")
      .select("id, unidade, app_key, app_secret, ativo, updated_at")
      .order("unidade");
    if (error) {
      console.error("[listOmieCredentials] query failed:", error);
      throw new Error("Erro ao listar credenciais Omie.");
    }
    return (data ?? []).map((c) => ({
      id: c.id,
      unidade: c.unidade,
      app_key: c.app_key,
      app_secret_masked: maskSecret(c.app_secret),
      ativo: c.ativo,
      updated_at: c.updated_at,
    }));
  });

export const upsertOmieCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { unidade: string; app_key: string; app_secret: string; ativo: boolean }) => {
    const unidade = (input?.unidade ?? "").trim();
    const app_key = (input?.app_key ?? "").trim();
    const app_secret = (input?.app_secret ?? "").trim();
    if (!unidade) throw new Error("Unidade é obrigatória.");
    if (!app_key) throw new Error("APP_KEY é obrigatório.");
    if (!app_secret) throw new Error("APP_SECRET é obrigatório.");
    return { unidade, app_key, app_secret, ativo: input?.ativo ?? true };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("omie_credentials")
      .upsert(
        { unidade: data.unidade, app_key: data.app_key, app_secret: data.app_secret, ativo: data.ativo },
        { onConflict: "unidade" },
      );
    if (error) {
      console.error("[upsertOmieCredential] upsert failed:", error);
      throw new Error("Erro ao salvar credencial.");
    }
    return { ok: true };
  });

export const setOmieCredentialAtivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; ativo: boolean }) => {
    if (!input?.id) throw new Error("id obrigatório.");
    return { id: input.id, ativo: !!input.ativo };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await supabaseAdmin.from("omie_credentials").update({ ativo: data.ativo }).eq("id", data.id).select("id");
    if (result.error) {
      console.error("[setOmieCredentialAtivo] update failed:", result.error);
      throw new Error("Erro ao atualizar status.");
    }
    assertAffected(result, `Credencial ${data.id} não encontrada — nada foi atualizado.`);
    return { ok: true };
  });

export const deleteOmieCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id obrigatório.");
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("omie_credentials").delete().eq("id", data.id);
    if (error) {
      console.error("[deleteOmieCredential] delete failed:", error);
      throw new Error("Erro ao excluir credencial.");
    }
    return { ok: true };
  });
