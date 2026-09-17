import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { KNOWN_PERMISSIONS } from "@/lib/permissions.functions";
import { gerarLinkDefinirSenha } from "@/lib/admin-users.functions";
import { enviarEmailAcesso as enviarEmail } from "@/lib/email-access.server";
import { emailBoasVindas } from "@/lib/email-templates";

// A tela de quem ADMINISTRA uma área: o admin nomeia sócios, o sócio convida a
// equipe e escolhe as páginas de cada um (Fase 3 do PLANO-ADMIN-DELEGADO).
//
// A REGRA NÃO MORA AQUI. Quem decide se pode é o banco, nas funções
// `ops.acesso_*`, chamadas com o cliente de quem está logado para que
// `auth.uid()` seja o ator. Esta camada só faz o que o banco não faz: criar a
// conta, abrir a porta do Ops, mandar o convite e buscar nomes.
//
// Nomes, e-mails e unidades vêm do cliente de serviço, mas SÓ para as pessoas
// que a RLS já devolveu ao ator. A lista nunca sai do recorte dele (furo 1).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

const ROTULO = new Map(KNOWN_PERMISSIONS.map((p) => [p.key, p.label]));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function rpc(db: Cliente, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  // As funções do banco já explicam o motivo em português.
  if (error) throw new Error(error.message || "Não foi possível salvar.");
  return data;
}

async function nivelNaArea(db: Cliente, userId: string, area: string): Promise<number> {
  const out = await rpc(db, "nivel_na_area", { _user: userId, _area: area });
  return Number(out ?? 0);
}

export type AreaAdministrada = {
  slug: string;
  nome: string;
  nivel: "admin" | "socio" | "super_admin";
  paginas: { key: string; label: string }[];
  unidades: { id: number; nome: string }[];
};

/** As áreas que eu administro, com as páginas e unidades que posso repassar. */
export const minhasAreasAdministradas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AreaAdministrada[]> => {
    const db = context.supabase as Cliente;
    const eu = context.userId;
    const superAdmin = Boolean(await rpc(db, "eh_super_admin", { _user: eu }));

    const [areasRes, meusRes, chavesRes, escopoRes, minhasUnRes, unidadesRes] = await Promise.all([
      db.from("areas").select("slug, nome, escopo, ordem").eq("ativa", true).order("ordem"),
      db.from("area_admins").select("area, nivel").eq("user_id", eu),
      db.from("area_chaves").select("area, permission_key"),
      db.from("usuario_escopo").select("todas_unidades").eq("user_id", eu).maybeSingle(),
      db.from("usuario_unidades").select("unidade_id").eq("user_id", eu),
      db.from("unidades").select("id, nome_da_praca").order("nome_da_praca"),
    ]);
    const nivelPorArea = new Map(
      ((meusRes.data ?? []) as { area: string; nivel: "admin" | "socio" }[]).map((r) => [r.area, r.nivel]),
    );
    const { data: minhasChaves } = await db.rpc("acesso_do_usuario", { _user: eu });
    const tenho = new Set<string>(((minhasChaves ?? {}) as { permissions?: string[] }).permissions ?? []);

    const todas = ((unidadesRes.data ?? []) as { id: number; nome_da_praca: string }[]).map((u) => ({
      id: u.id,
      nome: u.nome_da_praca,
    }));
    const minhas = new Set(((minhasUnRes.data ?? []) as { unidade_id: number }[]).map((u) => u.unidade_id));
    const todasAsMinhas = Boolean(escopoRes?.data?.todas_unidades);

    const chavesPorArea = new Map<string, string[]>();
    for (const c of (chavesRes.data ?? []) as { area: string; permission_key: string }[]) {
      const l = chavesPorArea.get(c.area) ?? [];
      l.push(c.permission_key);
      chavesPorArea.set(c.area, l);
    }

    return ((areasRes.data ?? []) as { slug: string; nome: string; escopo: string }[])
      .filter((a) => a.escopo === "unidade" && a.slug !== "admin")
      .filter((a) => superAdmin || nivelPorArea.has(a.slug))
      .map((a) => {
        const nivel = superAdmin ? "super_admin" : nivelPorArea.get(a.slug)!;
        return {
          slug: a.slug,
          nome: a.nome,
          nivel,
          paginas: (chavesPorArea.get(a.slug) ?? [])
            .filter((k) => k.startsWith("view.") && (superAdmin || tenho.has(k)))
            .map((k) => ({ key: k, label: ROTULO.get(k) ?? k }))
            .sort((x, y) => x.label.localeCompare(y.label, "pt-BR")),
          // Admin vê a rede toda (decisão 9); sócio só repassa as unidades dele.
          unidades: nivel === "socio" && !todasAsMinhas ? todas.filter((u) => minhas.has(u.id)) : todas,
        };
      });
  });

export type PessoaDaEquipe = {
  userId: string;
  nome: string;
  email: string;
  nivel: "socio" | "usuario";
  unidades: string[];
  paginas: string[];
  pendente: boolean;
};

/** Quem está na área e cabe no meu recorte. */
export const listEquipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { area: string }) => {
    const area = (input?.area ?? "").trim();
    if (!area) throw new Error("Área obrigatória.");
    return { area };
  })
  .handler(async ({ data, context }): Promise<PessoaDaEquipe[]> => {
    const db = context.supabase as Cliente;
    const eu = context.userId;
    if ((await nivelNaArea(db, eu, data.area)) < 2) throw new Error("Você não administra esta área.");

    // A RLS de usuario_areas já recorta por pode_administrar.
    const { data: membros, error } = await db
      .from("usuario_areas")
      .select("user_id")
      .eq("area", data.area)
      .eq("allowed", true);
    if (error) throw new Error("Erro ao carregar a equipe.");
    const ids = ((membros ?? []) as { user_id: string }[]).map((m) => m.user_id).filter((id) => id !== eu);
    if (!ids.length) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adm = supabaseAdmin as Cliente;
    const [perfis, admins, unidades, chaves, areaChaves] = await Promise.all([
      adm.from("profiles").select("user_id, nome, email").in("user_id", ids),
      adm.from("area_admins").select("user_id, nivel").eq("area", data.area).in("user_id", ids),
      adm.from("usuario_unidades").select("user_id, unidades(nome_da_praca)").in("user_id", ids),
      adm.from("usuario_chaves").select("user_id, permission_key").eq("allowed", true).in("user_id", ids),
      adm.from("area_chaves").select("permission_key").eq("area", data.area),
    ]);
    const daArea = new Set(((areaChaves.data ?? []) as { permission_key: string }[]).map((c) => c.permission_key));
    const nivel = new Map(((admins.data ?? []) as { user_id: string; nivel: string }[]).map((a) => [a.user_id, a.nivel]));

    const pendentes = new Set<string>();
    await Promise.all(
      ids.map(async (id) => {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
        if (!u?.user?.last_sign_in_at) pendentes.add(id);
      }),
    );

    return ((perfis.data ?? []) as { user_id: string; nome: string | null; email: string | null }[])
      .map((p) => ({
        userId: p.user_id,
        nome: p.nome || p.email || "Sem nome",
        email: p.email ?? "",
        nivel: (nivel.get(p.user_id) === "socio" ? "socio" : "usuario") as "socio" | "usuario",
        unidades: ((unidades.data ?? []) as { user_id: string; unidades: { nome_da_praca: string } | null }[])
          .filter((u) => u.user_id === p.user_id && u.unidades)
          .map((u) => u.unidades!.nome_da_praca)
          .sort(),
        paginas: ((chaves.data ?? []) as { user_id: string; permission_key: string }[])
          .filter((c) => c.user_id === p.user_id && daArea.has(c.permission_key))
          .map((c) => c.permission_key),
        pendente: pendentes.has(p.user_id),
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  });

/**
 * Convida alguém para a área. Se a conta não existe, cria sem senha e manda o
 * link de definir senha, o mesmo convite da Administração.
 */
export const convidarParaEquipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { area: string; nome: string; email: string; unidades: number[]; paginas: string[] }) => {
      const area = (input?.area ?? "").trim();
      const nome = (input?.nome ?? "").trim();
      const email = (input?.email ?? "").trim().toLowerCase();
      const unidades = Array.from(new Set((input?.unidades ?? []).map(Number).filter(Number.isInteger)));
      const paginas = Array.from(new Set((input?.paginas ?? []).map((p) => p.trim()).filter(Boolean)));
      if (!area) throw new Error("Área obrigatória.");
      if (!nome) throw new Error("Informe o nome.");
      if (!EMAIL_RE.test(email)) throw new Error("E-mail inválido.");
      if (!paginas.length) throw new Error("Marque pelo menos uma página.");
      return { area, nome, email, unidades, paginas };
    },
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as Cliente;
    const eu = context.userId;
    // Antes de criar qualquer conta: quem pede administra a área?
    if ((await nivelNaArea(db, eu, data.area)) < 2) throw new Error("Você não administra esta área.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adm = supabaseAdmin as Cliente;

    const { data: existente } = await adm.from("profiles").select("user_id").ilike("email", data.email).maybeSingle();
    let userId: string = existente?.user_id ?? "";
    let criou = false;
    if (!userId) {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        email_confirm: true,
        user_metadata: { nome: data.nome },
      });
      if (error || !created?.user) {
        console.error("[convidarParaEquipe] createUser falhou:", error);
        throw new Error("Não foi possível criar a conta. Confira se o e-mail já está cadastrado.");
      }
      userId = created.user.id;
      criou = true;
      await adm.from("profiles").upsert({ user_id: userId, nome: data.nome, email: data.email }, { onConflict: "user_id" });
    }

    try {
      await rpc(db, "acesso_adicionar_na_area", {
        _alvo: userId,
        _area: data.area,
        _unidades: data.unidades,
        _chaves: data.paginas,
      });
    } catch (e) {
      // O banco recusou: a conta recém-criada não pode ficar órfã.
      if (criou) await supabaseAdmin.auth.admin.deleteUser(userId);
      throw e;
    }

    // A porta do Ops. Sem ela as policies com tem_produto('ops') barram tudo.
    await adm
      .schema("public")
      .from("produto_acesso")
      .upsert({ user_id: userId, produto: "ops", concedido_por: eu }, { onConflict: "user_id,produto", ignoreDuplicates: true });

    let emailEnviado = false;
    let emailErro: string | null = null;
    let link: string | null = null;
    if (criou) {
      try {
        link = await gerarLinkDefinirSenha(data.email);
        const msg = emailBoasVindas({ nome: data.nome, email: data.email, link, papel: "Colaborador da unidade" });
        const envio = await enviarEmail({ to: data.email, ...msg });
        emailEnviado = envio.enviado;
        emailErro = envio.erro ?? null;
      } catch (err) {
        console.error("[convidarParaEquipe] convite falhou:", err);
        emailErro = err instanceof Error ? err.message : "Falha ao gerar o link de acesso.";
      }
    }
    return {
      userId,
      jaExistia: !criou,
      emailEnviado,
      emailErro,
      // Só devolve o link quando o e-mail não saiu, para repassar na mão.
      link: emailEnviado ? null : link,
    };
  });

export const definirPaginasEquipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; area: string; paginas: string[] }) => {
    if (!UUID_RE.test(input?.userId ?? "")) throw new Error("Pessoa inválida.");
    const paginas = Array.from(new Set((input?.paginas ?? []).map((p) => p.trim()).filter(Boolean)));
    if (!paginas.length) throw new Error("Marque pelo menos uma página, ou remova a pessoa da área.");
    return { userId: input.userId, area: (input?.area ?? "").trim(), paginas };
  })
  .handler(async ({ data, context }) => {
    await rpc(context.supabase, "acesso_definir_paginas", {
      _alvo: data.userId,
      _area: data.area,
      _chaves: data.paginas,
    });
    return { ok: true };
  });

/**
 * Tira a pessoa da área. A conta só é desativada quando ela não entra em mais
 * nada: nem outra área do Ops, nem Growth, nem Financeiro (furo 2).
 */
export const removerDaEquipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; area: string }) => {
    if (!UUID_RE.test(input?.userId ?? "")) throw new Error("Pessoa inválida.");
    return { userId: input.userId, area: (input?.area ?? "").trim() };
  })
  .handler(async ({ data, context }) => {
    const semArea = Boolean(
      await rpc(context.supabase, "acesso_remover_da_area", { _alvo: data.userId, _area: data.area }),
    );
    if (!semArea) return { ok: true, contaDesativada: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const adm = supabaseAdmin as Cliente;
    await adm.schema("public").from("produto_acesso").delete().eq("user_id", data.userId).eq("produto", "ops");
    const { data: outros } = await adm.schema("public").from("produto_acesso").select("produto").eq("user_id", data.userId);
    if ((outros ?? []).length > 0) return { ok: true, contaDesativada: false };

    // Desativar é reversível: banimento longo, não exclusão.
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, { ban_duration: "876000h" });
    if (error) console.error("[removerDaEquipe] desativar conta falhou:", error);
    return { ok: true, contaDesativada: !error };
  });

/** Só o admin da área: transforma um membro em sócio. */
export const nomearSocioDaArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; area: string }) => {
    if (!UUID_RE.test(input?.userId ?? "")) throw new Error("Pessoa inválida.");
    return { userId: input.userId, area: (input?.area ?? "").trim() };
  })
  .handler(async ({ data, context }) => {
    await rpc(context.supabase, "acesso_nomear", { _alvo: data.userId, _area: data.area, _nivel: "socio" });
    return { ok: true };
  });

/** Só o admin: as unidades de alguém da equipe. */
export const definirUnidadesEquipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; unidades: number[] }) => {
    if (!UUID_RE.test(input?.userId ?? "")) throw new Error("Pessoa inválida.");
    const unidades = Array.from(new Set((input?.unidades ?? []).map(Number).filter(Number.isInteger)));
    if (!unidades.length) throw new Error("Escolha pelo menos uma unidade.");
    return { userId: input.userId, unidades };
  })
  .handler(async ({ data, context }) => {
    await rpc(context.supabase, "acesso_definir_unidades", { _alvo: data.userId, _unidades: data.unidades });
    return { ok: true };
  });
