import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAffected } from "@/lib/supabase-assert";
import { enviarEmailAcesso as enviarEmail, accessEmailStatus } from "@/lib/email-access.server";
import { emailBoasVindas, emailRedefinicaoSenha } from "@/lib/email-templates";
import { passwordRecoveryLink } from "@/lib/password-recovery";

type Role = string;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_PRECEDENCE = ["admin", "head", "auditor", "socio_regional", "socio", "diretor"];

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

function appUrl() {
  return (process.env.APP_URL || "https://planningbrain.com.br").replace(/\/+$/, "");
}

export const adminAccessEmailStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.userId);
    return accessEmailStatus();
  });

/**
 * Gera o link de uso único que leva a pessoa direto pra tela de definir senha.
 * É o mesmo tipo de link do "esqueci minha senha", só que emitido pelo admin —
 * assim a senha nunca trafega por e-mail.
 */
export async function gerarLinkDefinirSenha(email: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl()}/redefinir-senha` },
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("[gerarLinkDefinirSenha] generateLink failed");
    throw new Error("Falha ao gerar o link de definição de senha.");
  }
  return passwordRecoveryLink(data.properties.hashed_token);
}

/**
 * O papel principal, ou `null` quando a pessoa não tem nenhum.
 *
 * Devolvia "diretor" quando a lista vinha vazia, de quando toda linha desta
 * tela era gente do Ops. Hoje a tela lista `profiles` inteiro, que inclui quem
 * só entra no Growth ou no Financeiro: em 21/09/2026 eram 19 de 45 pessoas
 * aparecendo como DIRETOR sem ter papel nenhum aqui. Numa tela onde se decide
 * acesso, inventar papel é pior do que admitir a ausência dele.
 */
function pickPrimaryRole(roles: Role[]): Role | null {
  if (roles.length === 1) return roles[0];
  for (const r of ROLE_PRECEDENCE) {
    if (roles.includes(r)) return r;
  }
  return roles[0] ?? null;
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

    // A PORTA de cada produto. `public.produto_acesso` é a mesma fonte para os
    // três: é ela que `public.tem_produto()` lê nas policies, que a sessão
    // irmã do Financeiro consulta e que o botão do Growth escreve. A tela
    // mostrava só o Growth porque ele era o único com cadastro próprio — o Ops
    // era implícito ("está na lista, logo entra"), o que deixou de ser verdade
    // quando a lista passou a ser `profiles` inteiro.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: portas, error: portaErr } = await (supabaseAdmin as any)
      .schema("public")
      .from("produto_acesso")
      .select("user_id, produto");
    if (portaErr) {
      console.error("[adminListUsers] produto_acesso query failed:", portaErr);
      throw new Error("Erro ao listar usuários. Tente novamente.");
    }
    const produtosByUser = new Map<string, string[]>();
    for (const l of (portas ?? []) as { user_id: string; produto: string }[]) {
      produtosByUser.set(l.user_id, [...(produtosByUser.get(l.user_id) ?? []), l.produto]);
    }

    // For sócios, look up their unidade from socios table by email.
    const { data: socios } = await supabaseAdmin
      .from("socios")
      .select("email, unidade");
    const emailToUnidade = new Map<string, string>();
    for (const s of socios ?? []) {
      if (s.email && s.unidade) emailToUnidade.set(s.email.trim().toLowerCase(), s.unidade);
    }

    // O ESCOPO de unidades, resumido para caber na coluna "Unidade" — é o que
    // a pessoa enxerga nas áreas do Ops, e é editado clicando ali mesmo. Não
    // confundir com a unidade de `socios`, logo acima: aquela é a unidade DA
    // pessoa (sócio da regional tal), esta é o recorte do que ela vê.
    // `as any`: `src/integrations/supabase/types.ts` não declara as tabelas de
    // escopo, como no resto do código que as consulta.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const [escopoRes, unidadesDoUsuarioRes, catalogoRes] = await Promise.all([
      db.from("usuario_escopo").select("user_id, todas_unidades"),
      db.from("usuario_unidades").select("user_id, unidade_id"),
      db.from("unidades").select("id, nome_da_praca"),
    ]);
    const nomeDaUnidade = new Map(
      ((catalogoRes.data ?? []) as { id: number; nome_da_praca: string }[]).map((u) => [
        u.id,
        u.nome_da_praca,
      ]),
    );
    const todasDe = new Map(
      ((escopoRes.data ?? []) as { user_id: string; todas_unidades: boolean }[]).map((e) => [
        e.user_id,
        Boolean(e.todas_unidades),
      ]),
    );
    const unidadesDe = new Map<string, string[]>();
    for (const l of (unidadesDoUsuarioRes.data ?? []) as { user_id: string; unidade_id: number }[]) {
      const nome = nomeDaUnidade.get(l.unidade_id);
      if (!nome) continue;
      unidadesDe.set(l.user_id, [...(unidadesDe.get(l.user_id) ?? []), nome]);
    }

    return (profiles ?? []).map((p) => {
      const userRoles = rolesByUser.get(p.user_id) ?? [];
      const role = pickPrimaryRole(userRoles);
      const isSocio = role === "socio" || role === "socio_regional";
      const unidade = isSocio ? emailToUnidade.get((p.email ?? "").trim().toLowerCase()) ?? null : null;
      return {
        user_id: p.user_id,
        nome: p.nome,
        email: p.email,
        created_at: p.created_at,
        role,
        unidade,
        produtos: produtosByUser.get(p.user_id) ?? [],
        escopo: {
          todas: todasDe.get(p.user_id) ?? false,
          unidades: (unidadesDe.get(p.user_id) ?? []).sort((a, b) => a.localeCompare(b, "pt-BR")),
        },
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
    if (role === "socio_regional" && !unidade) throw new Error("Selecione a unidade do sócio regional.");
    return { nome, email, role, password, unidade };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roleRow } = await supabaseAdmin.from("roles").select("key, label").eq("key", data.role).maybeSingle();
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

    // A porta do Ops. Sem esta linha as policies com `tem_produto('ops')`
    // barram a pessoa mesmo com papel certinho — foi o que aconteceu com três
    // contas criadas por aqui (raul.dantas, heloisa.araujo, brenda.patury),
    // porque só o convite da página de Equipe escrevia esta tabela.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: portaErr } = await (supabaseAdmin as any)
      .schema("public")
      .from("produto_acesso")
      .upsert(
        { user_id: userId, produto: "ops", concedido_por: context.userId },
        { onConflict: "user_id,produto", ignoreDuplicates: true },
      );
    if (portaErr) console.error("[adminCreateUser] produto_acesso upsert failed:", portaErr);

    // Para sócio (qualquer tipo), vincula a unidade em public.socios
    let unidade: string | null = null;
    if (data.role === "socio" || data.role === "socio_regional") {
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


    // E-mail de boas-vindas com link de definição de senha. Se o envio falhar,
    // o usuário já existe e o admin recebe o link em tela pra repassar na mão.
    let link: string | null = null;
    let emailEnviado = false;
    let emailErro: string | null = null;
    try {
      link = await gerarLinkDefinirSenha(data.email);
      const msg = emailBoasVindas({
        nome: data.nome,
        email: data.email,
        link,
        papel: roleRow.label ?? data.role,
      });
      const envio = await enviarEmail({ to: data.email, ...msg });
      emailEnviado = envio.enviado;
      emailErro = envio.erro ?? null;
    } catch (err) {
      console.error("[adminCreateUser] envio do convite falhou:", err);
      emailErro = err instanceof Error ? err.message : "Falha ao gerar o link de acesso.";
    }

    return { user_id: userId, email: data.email, unidade, emailEnviado, emailErro, link };
  });

/**
 * Dispara pro usuário um e-mail com link de redefinição de senha. Substitui o
 * antigo reset que sobrescrevia a senha e a mostrava em tela: a senha atual
 * segue valendo até a pessoa cadastrar a nova pelo link.
 */
export const adminEnviarRedefinicaoSenha = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) => {
    if (!input?.user_id) throw new Error("user_id obrigatório.");
    if (!UUID_RE.test(input.user_id)) throw new Error("user_id inválido.");
    return { user_id: input.user_id };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: alvo, error } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const email = alvo?.user?.email ?? "";
    if (error || !email) {
      console.error("[adminEnviarRedefinicaoSenha] getUserById failed:", error);
      throw new Error("Usuário não encontrado.");
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("nome")
      .eq("user_id", data.user_id)
      .maybeSingle();

    const link = await gerarLinkDefinirSenha(email);
    const msg = emailRedefinicaoSenha({ nome: profile?.nome ?? "", email, link });
    const envio = await enviarEmail({ to: email, ...msg });

    return {
      user_id: data.user_id,
      email,
      link,
      emailEnviado: envio.enviado,
      emailErro: envio.erro ?? null,
    };
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

// ─────────────────────────────────────────────────────────────
// Acesso ao Growth, pelo banco único (17/09/2026)
//
// Até a migração, estas funções falavam com o projeto antigo do Growth
// (wojgzfoeokgquxeobpwk): login próprio e allowlist por e-mail. Agora o Growth
// mora no schema `growth` do banco único, e a conta é a MESMA do Ops:
//   - a allowlist é `growth.membros`, por user_id;
//   - a porta do produto é `public.produto_acesso` (produto = 'growth');
//   - revogar tira as duas coisas e NUNCA apaga a conta.
// ─────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function growthDb(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (supabaseAdmin as any).schema("growth");
}

async function contaDoBancoUnico(email: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) {
    console.error("[growth] listUsers failed:", error);
    throw new Error("Falha ao consultar usuários.");
  }
  return data.users.find((u) => (u.email ?? "").toLowerCase() === email) ?? null;
}

export const adminListGrowthAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const growth = await growthDb();
    const { data: membros, error } = await growth
      .from("membros")
      .select("user_id, papel, departamento");
    if (error) {
      console.error("[adminListGrowthAccess] membros query failed:", error);
      throw new Error("Erro ao listar acessos do Growth.");
    }
    const ids = ((membros ?? []) as { user_id: string }[]).map((m) => m.user_id);
    const { data: perfis } = ids.length
      ? await supabaseAdmin.from("profiles").select("user_id, nome, email").in("user_id", ids)
      : { data: [] };
    const perfil = new Map(
      ((perfis ?? []) as { user_id: string; nome: string | null; email: string | null }[]).map((p) => [p.user_id, p]),
    );
    const lista = ((membros ?? []) as { user_id: string; papel: string; departamento: string | null }[])
      .map((m) => ({
        email: (perfil.get(m.user_id)?.email ?? "").toLowerCase(),
        nome: perfil.get(m.user_id)?.nome ?? null,
        papel: m.papel,
        departamento: m.departamento,
      }))
      .sort((x, y) => x.email.localeCompare(y.email));
    return { configured: true as const, membros: lista };
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const growth = await growthDb();

    // A conta é a mesma do Ops. Só cria quando a pessoa ainda não entra em
    // nada; a senha informada vale para todos os produtos.
    let conta = await contaDoBancoUnico(data.email);
    let loginCriado = false;
    if (!conta) {
      if (!data.password) {
        throw new Error("Esta pessoa ainda não tem login no Brain — defina uma senha inicial.");
      }
      const { data: criado, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { nome: data.nome, senha_definida: true },
      });
      if (error || !criado.user) {
        console.error("[adminGrantGrowthAccess] createUser failed:", error);
        throw new Error("Falha ao criar o login.");
      }
      conta = criado.user;
      loginCriado = true;
      await supabaseAdmin
        .from("profiles")
        .upsert({ user_id: conta.id, nome: data.nome, email: data.email }, { onConflict: "user_id" });
    } else if (data.password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(conta.id, { password: data.password });
      if (error) {
        console.error("[adminGrantGrowthAccess] updateUserById failed:", error);
        throw new Error("Falha ao atualizar a senha.");
      }
    }

    const { error: mErr } = await growth
      .from("membros")
      .upsert(
        { user_id: conta.id, papel: data.papel, departamento: data.departamento },
        { onConflict: "user_id" },
      );
    if (mErr) {
      console.error("[adminGrantGrowthAccess] membros upsert failed:", mErr);
      throw new Error("Falha ao conceder acesso no Growth.");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: pErr } = await (supabaseAdmin as any)
      .schema("public")
      .from("produto_acesso")
      .upsert(
        { user_id: conta.id, produto: "growth", concedido_por: context.userId },
        { onConflict: "user_id,produto", ignoreDuplicates: true },
      );
    if (pErr) console.error("[adminGrantGrowthAccess] produto_acesso upsert failed:", pErr);

    // Mesmo padrão de auditoria que o próprio Growth já usa.
    await growth.from("admin_auditoria").insert({
      ator_email: await actorEmail(context.userId),
      acao: loginCriado ? "acesso_concedido_com_login" : "acesso_concedido",
      alvo_email: data.email,
      detalhe: { papel: data.papel, departamento: data.departamento, origem: "ops/admin-usuarios" },
    });

    return { email: data.email, loginCriado };
  });

/**
 * Abre ou fecha a porta do Ops de alguém (`produto_acesso`, produto = 'ops').
 *
 * É o equivalente, para o Ops, do que o botão do Growth sempre fez: diz se a
 * pessoa ENTRA no produto. O que ela vê lá dentro continua em "Acessos"
 * (áreas) e "Escopo" (unidades e empresas) — fechar a porta não apaga nada
 * disso, então reabrir devolve a pessoa exatamente como estava.
 */
export const adminDefinirPortaOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; conceder: boolean }) => {
    const userId = (input?.userId ?? "").trim();
    if (!UUID_RE.test(userId)) throw new Error("Pessoa inválida.");
    return { userId, conceder: Boolean(input?.conceder) };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    // Fechar a própria porta derrubaria quem está administrando, e a tela de
    // conserto é justamente esta.
    if (!data.conceder && data.userId === context.userId) {
      throw new Error("Você não pode revogar o seu próprio acesso ao Ops.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const porta = (supabaseAdmin as any).schema("public").from("produto_acesso");

    if (data.conceder) {
      const { error } = await porta.upsert(
        { user_id: data.userId, produto: "ops", concedido_por: context.userId },
        { onConflict: "user_id,produto", ignoreDuplicates: true },
      );
      if (error) {
        console.error("[adminDefinirPortaOps] upsert failed:", error);
        throw new Error("Falha ao conceder o acesso ao Ops.");
      }
    } else {
      const { error } = await porta.delete().eq("user_id", data.userId).eq("produto", "ops");
      if (error) {
        console.error("[adminDefinirPortaOps] delete failed:", error);
        throw new Error("Falha ao revogar o acesso ao Ops.");
      }
    }
    return { userId: data.userId, conceder: data.conceder };
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const growth = await growthDb();
    const conta = await contaDoBancoUnico(data.email);
    if (!conta) throw new Error("Usuário não encontrado.");

    // Tira a allowlist e a porta do Growth. A conta continua: ela é a mesma
    // do Ops e do Financeiro.
    const { error } = await growth.from("membros").delete().eq("user_id", conta.id);
    if (error) {
      console.error("[adminRevokeGrowthAccess] membros delete failed:", error);
      throw new Error("Falha ao revogar acesso no Growth.");
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any)
      .schema("public")
      .from("produto_acesso")
      .delete()
      .eq("user_id", conta.id)
      .eq("produto", "growth");

    await growth.from("admin_auditoria").insert({
      ator_email: await actorEmail(context.userId),
      acao: "acesso_revogado",
      alvo_email: data.email,
      detalhe: { origem: "ops/admin-usuarios" },
    });

    return { email: data.email };
  });
