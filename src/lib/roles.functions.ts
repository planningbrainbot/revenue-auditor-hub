import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";
import { assertAffected } from "@/lib/supabase-assert";

const KEY_RE = /^[a-z][a-z0-9_]{1,49}$/;

export function slugifyRoleKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

export const listRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const [rolesRes, pessoasRes, areasRes, nomesRes] = await Promise.all([
      db
        .from("roles")
        .select("id, key, label, description, is_system, created_at")
        .order("is_system", { ascending: false })
        .order("label", { ascending: true }),
      db.from("user_roles").select("role"),
      db.from("role_areas").select("role, area").eq("allowed", true),
      db.from("areas").select("slug, nome, ordem").eq("ativa", true).order("ordem"),
    ]);
    if (rolesRes.error) throw new Error("Erro ao listar perfis.");
    // Quantas pessoas e quais áreas: é o que responde "para que serve este
    // perfil" desde que ele virou modelo de acesso (17/09/2026).
    const pessoas = new Map<string, number>();
    for (const r of (pessoasRes.data ?? []) as { role: string }[]) pessoas.set(r.role, (pessoas.get(r.role) ?? 0) + 1);
    const ordem = new Map(((nomesRes.data ?? []) as { slug: string; nome: string; ordem: number }[]).map((a) => [a.slug, a]));
    const areas = new Map<string, string[]>();
    for (const r of (areasRes.data ?? []) as { role: string; area: string }[]) {
      if (!ordem.has(r.area)) continue;
      const l = areas.get(r.role) ?? [];
      l.push(r.area);
      areas.set(r.role, l);
    }
    return ((rolesRes.data ?? []) as {
      id: string; key: string; label: string; description: string | null; is_system: boolean; created_at: string;
    }[]).map((r) => ({
      ...r,
      pessoas: pessoas.get(r.key) ?? 0,
      areas: (areas.get(r.key) ?? [])
        .sort((a, b) => (ordem.get(a)!.ordem ?? 0) - (ordem.get(b)!.ordem ?? 0))
        .map((a) => ordem.get(a)!.nome),
    }));
  });

export const createRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { key: string; label: string; description?: string }) => {
    const label = (input?.label ?? "").trim();
    const key = (input?.key ?? "").trim().toLowerCase();
    const description = (input?.description ?? "").trim() || null;
    if (!label) throw new Error("Nome é obrigatório.");
    if (!KEY_RE.test(key)) {
      throw new Error("Chave inválida: use apenas letras minúsculas, números e _ (2-50 caracteres, começando com letra).");
    }
    return { key, label, description };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: created, error } = await context.supabase
      .from("roles")
      .insert({ key: data.key, label: data.label, description: data.description, is_system: false })
      .select("id, key, label, description, is_system, created_at")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error(`Já existe um perfil com a chave "${data.key}".`);
      throw new Error("Erro ao criar perfil.");
    }
    return created;
  });

export const updateRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; label: string; description?: string }) => {
    const label = (input?.label ?? "").trim();
    const description = (input?.description ?? "").trim() || null;
    if (!input?.id) throw new Error("id obrigatório.");
    if (!label) throw new Error("Nome é obrigatório.");
    return { id: input.id, label, description };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: role, error: fetchErr } = await context.supabase
      .from("roles")
      .select("is_system")
      .eq("id", data.id)
      .single();
    if (fetchErr || !role) throw new Error("Perfil não encontrado.");
    if (role.is_system) throw new Error("Perfis de sistema não podem ser editados por aqui.");
    const result = await context.supabase
      .from("roles")
      .update({ label: data.label, description: data.description })
      .eq("id", data.id)
      .select("id");
    assertAffected(result, "Perfil não foi atualizado — possível bloqueio de permissão (RLS).");
    return { ok: true };
  });

export const deleteRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => {
    if (!input?.id) throw new Error("id obrigatório.");
    return { id: input.id };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: role, error: fetchErr } = await context.supabase
      .from("roles")
      .select("key, is_system")
      .eq("id", data.id)
      .single();
    if (fetchErr || !role) throw new Error("Perfil não encontrado.");
    if (role.is_system) throw new Error("Perfis de sistema não podem ser excluídos.");
    const { count } = await context.supabase
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", role.key);
    if (count && count > 0) {
      throw new Error(`Existem ${count} usuário(s) com este perfil. Troque o perfil deles antes de excluir.`);
    }
    const { error } = await context.supabase.from("roles").delete().eq("id", data.id);
    if (error) throw new Error("Erro ao excluir perfil.");
    return { ok: true };
  });
