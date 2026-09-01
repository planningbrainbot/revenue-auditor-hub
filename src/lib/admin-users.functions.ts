import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAffected } from "@/lib/supabase-assert";

type Role = string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_PRECEDENCE = ["admin", "head", "auditor", "socio_franqueado", "socio", "diretor"];

async function ensureAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) {
    console.error("[ensureAdmin] user_roles query failed:", error);
    throw new Error("Erro de autorização. Tente novamente.");
  }
  if (!data) throw new Error("Acesso negado: somente administradores.");
}

function pickPrimaryRole(roles: Role[]): Role {
  if (roles.length === 1) return roles[0];
  for (const r of ROLE_PRECEDENCE) {
    if (roles.includes(r)) return r;
  }
  return roles[0] ?? "diretor";
}


export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("user_id, nome, email, created_at")
      .order("created_at", { ascending: false });
    if (pErr) {
      console.error("[adminListUsers] profiles query failed:", pErr);
      throw new Error("Erro ao listar usuários. Tente novamente.");
    }
    const { data: roles, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role");
    if (rErr) {
      console.error("[adminListUsers] roles query failed:", rErr);
      throw new Error("Erro ao listar usuários. Tente novamente.");
    }
    const rolesByUser = new Map<string, Role[]>();
    for (const r of roles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as Role);
      rolesByUser.set(r.user_id, arr);
    }

    // For sócios, look up their unidade from socios table by email.
    const { data: socios } = await supabaseAdmin
      .from("socios")
      .select("email, unidade");
    const emailToUnidade = new Map<string, string>();
    for (const s of socios ?? []) {
      if (s.email && s.unidade) emailToUnidade.set(s.email.trim().toLowerCase(), s.unidade);
    }

    return (profiles ?? []).map((p) => {
      const userRoles = rolesByUser.get(p.user_id) ?? [];
      const role = pickPrimaryRole(userRoles);
      const isSocio = role === "socio" || role === "socio_franqueado";
      const unidade = isSocio ? emailToUnidade.get((p.email ?? "").trim().toLowerCase()) ?? null : null;
      return {
        user_id: p.user_id,
        nome: p.nome,
        email: p.email,
        created_at: p.created_at,
        role,
        unidade,
      };
    });

  });

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { nome: string; email: string; role: Role; password: string; unidade?: string }) => {
    const nome = (input?.nome ?? "").trim();
    const email = (input?.email ?? "").trim().toLowerCase();
    const role = input?.role;
    const password = input?.password ?? "";
    const unidade = (input?.unidade ?? "").trim() || undefined;
    if (!nome) throw new Error("Nome é obrigatório.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email inválido.");
    if (!role) throw new Error("Papel inválido.");
    if (password.length < 8) throw new Error("Senha deve ter pelo menos 8 caracteres.");
    if (role === "socio_franqueado" && !unidade) throw new Error("Selecione a unidade do sócio franqueado.");
    return { nome, email, role, password, unidade };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRow } = await supabaseAdmin.from("roles").select("key").eq("key", data.role).maybeSingle();
    if (!roleRow) throw new Error("Papel inválido.");

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (createErr || !created.user) {
      console.error("[adminCreateUser] createUser failed:", createErr);
      throw new Error("Falha ao criar usuário. Tente novamente.");
    }
    const userId = created.user.id;

    const { error: profileErr } = await supabaseAdmin
      .from("profiles")
      .upsert({ user_id: userId, nome: data.nome, email: data.email }, { onConflict: "user_id" });
    if (profileErr) console.error("[adminCreateUser] profile upsert failed:", profileErr);

    // Trigger insere 'diretor'. Ajustar conforme papel pedido:
    if (data.role !== "diretor") {
      // Remover 'diretor' default e inserir o papel correto
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userId).eq("role", "diretor");
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id,role" });
      if (roleErr) console.error("[adminCreateUser] role upsert failed:", roleErr);
    }

    // Para sócio (qualquer tipo), vincula a unidade em public.socios
    let unidade: string | null = null;
    if (data.role === "socio" || data.role === "socio_franqueado") {
      if (data.unidade) {
        // Unidade escolhida no formulário: cria ou atualiza o registro em socios
        const { data: existing } = await supabaseAdmin
          .from("socios")
          .select("id")
          .ilike("email", data.email)
          .maybeSingle();
        if (existing) {
          const result = await supabaseAdmin
            .from("socios")
            .update({ unidade: data.unidade, user_id: userId, nome_completo: data.nome })
            .eq("id", existing.id)
            .select("id");
          assertAffected(result, `Sócio ${existing.id} não foi atualizado.`);
        } else {
          await supabaseAdmin
            .from("socios")
            .insert({ email: data.email, unidade: data.unidade, user_id: userId, nome_completo: data.nome });
        }
        unidade = data.unidade;
      } else {
        const { data: socio } = await supabaseAdmin
          .from("socios")
          .select("unidade")
          .ilike("email", data.email)
          .maybeSingle();
        unidade = socio?.unidade ?? null;
      }
    }


    return { user_id: userId, email: data.email, unidade };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; password: string }) => {
    if (!input?.user_id) throw new Error("user_id obrigatório.");
    if (!UUID_RE.test(input.user_id)) throw new Error("user_id inválido.");
    const password = input?.password ?? "";
    if (password.length < 8) throw new Error("Senha deve ter pelo menos 8 caracteres.");
    return { user_id: input.user_id, password };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: updated, error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error || !updated.user) {
      console.error("[adminResetPassword] updateUserById failed:", error);
      throw new Error("Falha ao redefinir senha. Tente novamente.");
    }
    return { user_id: data.user_id, email: updated.user.email ?? "" };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) => {
    if (!input?.user_id) throw new Error("user_id obrigatório.");
    if (!UUID_RE.test(input.user_id)) throw new Error("user_id inválido.");
    return { user_id: input.user_id };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    if (data.user_id === context.userId) throw new Error("Você não pode excluir sua própria conta.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) {
      console.error("[adminDeleteUser] deleteUser failed:", error);
      throw new Error("Falha ao excluir usuário. Tente novamente.");
    }
    return { ok: true };
  });

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; nome: string }) => {
    if (!input?.user_id || !UUID_RE.test(input.user_id)) throw new Error("user_id inválido.");
    const nome = (input?.nome ?? "").trim();
    if (!nome) throw new Error("Nome é obrigatório.");
    return { user_id: input.user_id, nome };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pResult = await supabaseAdmin.from("profiles").update({ nome: data.nome }).eq("user_id", data.user_id).select("user_id");
    if (pResult.error) {
      console.error("[adminUpdateUser] profile update failed:", pResult.error);
      throw new Error("Falha ao atualizar nome.");
    }
    assertAffected(pResult, `Perfil do usuário ${data.user_id} não foi atualizado.`);
    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      user_metadata: { nome: data.nome },
    });
    if (aErr) console.error("[adminUpdateUser] auth metadata update failed:", aErr);
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Acesso ao Growth (projeto Supabase separado)
//
// O Growth autoriza por e-mail via public.membros — quem não tem linha lá não
// enxerga nada, independente de ter login. Então conceder acesso = garantir o
// usuário em auth.users + upsert em membros; revogar = apagar a linha de
// membros (o login continua existindo, mas deixa de dar acesso a qualquer dado).
// ---------------------------------------------------------------------------

/** E-mail do admin logado, pra registrar em admin_auditoria no Growth. */
async function actorEmail(userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.email ?? "desconhecido";
}

/** Procura o usuário do Growth por e-mail. O projeto tem ~25 usuários. */
async function findGrowthUser(growth: NonNullable<ReturnType<typeof import("@/integrations/supabase/client.growth.server").getGrowthAdmin>>, email: string) {
  const { data, error } = await growth.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.error("[growth] listUsers failed:", error);
    throw new Error("Falha ao consultar usuários do Growth.");
  }
  return data.users.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
}

export const adminListGrowthAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.userId);
    const { getGrowthAdmin } = await import("@/integrations/supabase/client.growth.server");
    const growth = getGrowthAdmin();
    if (!growth) return { configured: false as const, membros: [] };

    const { data, error } = await growth
      .from("membros")
      .select("email, papel, departamento, nome")
      .order("email");
    if (error) {
      console.error("[adminListGrowthAccess] membros query failed:", error);
      throw new Error("Erro ao listar acessos do Growth.");
    }
    return { configured: true as const, membros: data ?? [] };
  });

export const adminGrantGrowthAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; nome: string; papel: string; departamento: string; password?: string }) => {
    const email = (input?.email ?? "").trim().toLowerCase();
    const nome = (input?.nome ?? "").trim();
    const papel = (input?.papel ?? "").trim();
    const departamento = (input?.departamento ?? "").trim();
    const password = input?.password?.trim() || undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email inválido.");
    if (!nome) throw new Error("Nome é obrigatório.");
    if (!["admin", "gestao", "operacional"].includes(papel)) throw new Error("Papel do Growth inválido.");
    if (!["comercial", "diretoria", "marketing", "backoffice", "parcerias"].includes(departamento)) {
      throw new Error("Departamento do Growth inválido.");
    }
    if (password !== undefined && password.length < 8) {
      throw new Error("Senha deve ter pelo menos 8 caracteres.");
    }
    return { email, nome, papel, departamento, password };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { getGrowthAdmin } = await import("@/integrations/supabase/client.growth.server");
    const growth = getGrowthAdmin();
    if (!growth) throw new Error("Integração com o Growth não está configurada neste ambiente.");

    const existente = await findGrowthUser(growth, data.email);
    let loginCriado = false;

    if (!existente) {
      if (!data.password) {
        throw new Error("Esta pessoa ainda não tem login no Growth — defina uma senha inicial.");
      }
      const { error } = await growth.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { nome: data.nome },
      });
      if (error) {
        console.error("[adminGrantGrowthAccess] createUser failed:", error);
        throw new Error("Falha ao criar login no Growth.");
      }
      loginCriado = true;
    } else if (data.password) {
      const { error } = await growth.auth.admin.updateUserById(existente.id, { password: data.password });
      if (error) {
        console.error("[adminGrantGrowthAccess] updateUserById failed:", error);
        throw new Error("Falha ao atualizar a senha no Growth.");
      }
    }

    const { error: mErr } = await growth
      .from("membros")
      .upsert(
        { email: data.email, nome: data.nome, papel: data.papel, departamento: data.departamento },
        { onConflict: "email" },
      );
    if (mErr) {
      console.error("[adminGrantGrowthAccess] membros upsert failed:", mErr);
      throw new Error("Falha ao conceder acesso no Growth.");
    }

    // Mesmo padrão de auditoria que o próprio Growth já usa.
    await growth.from("admin_auditoria").insert({
      ator_email: await actorEmail(context.userId),
      acao: loginCriado ? "acesso_concedido_com_login" : "acesso_concedido",
      alvo_email: data.email,
      detalhe: { papel: data.papel, departamento: data.departamento, origem: "ops/admin-usuarios" },
    });

    return { email: data.email, loginCriado };
  });

export const adminRevokeGrowthAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => {
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!email) throw new Error("Email é obrigatório.");
    return { email };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { getGrowthAdmin } = await import("@/integrations/supabase/client.growth.server");
    const growth = getGrowthAdmin();
    if (!growth) throw new Error("Integração com o Growth não está configurada neste ambiente.");

    // Só remove a linha de membros: o login continua existindo, mas sem
    // acesso a dado nenhum (e_membro() é o portão de tudo no Growth).
    const { error } = await growth.from("membros").delete().eq("email", data.email);
    if (error) {
      console.error("[adminRevokeGrowthAccess] membros delete failed:", error);
      throw new Error("Falha ao revogar acesso no Growth.");
    }

    await growth.from("admin_auditoria").insert({
      ator_email: await actorEmail(context.userId),
      acao: "acesso_revogado",
      alvo_email: data.email,
      detalhe: { origem: "ops/admin-usuarios" },
    });

    return { email: data.email };
  });
