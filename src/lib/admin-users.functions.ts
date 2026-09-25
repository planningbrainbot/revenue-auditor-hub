import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAffected } from "@/lib/supabase-assert";
import { enviarEmailAcesso as enviarEmail, accessEmailStatus } from "@/lib/email-access.server";
import { emailBoasVindas, emailRedefinicaoSenha } from "@/lib/email-templates";
import { passwordRecoveryLink } from "@/lib/password-recovery";
import { generatePassword } from "@/lib/password-utils";
import { MARCA_SENHA_PROVISORIA } from "@/lib/senha-provisoria";
import {
  contaPorEmail,
  exigirSuperAdmin,
  registrarAcesso,
  todasAsContasDoAuth,
} from "@/lib/acessos.server";

type Role = string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLE_PRECEDENCE = ["admin", "head", "auditor", "socio_regional", "socio", "diretor"];

/** Banimento que usamos para "desativada": longo e reversível. */
const BANIMENTO = "876000h";

// A checagem de admin mora em `acessos.server.ts` desde a auditoria de
// 24/09/2026: ela passou a exigir a conta ATIVA, e cada arquivo tinha a sua.
const ensureAdmin = exigirSuperAdmin;

function appUrl() {
  return (process.env.APP_URL || "https://planningbrain.com.br").replace(/\/+$/, "");
}

async function adminDb(): Promise<Cliente> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
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
 * O perfil principal, ou `null` quando a pessoa não tem nenhum. Só para
 * ordenar e rotular: a lista inteira vai junto em `papeis`, porque três pessoas
 * têm dois perfis e o acesso delas é a união dos dois.
 */
function pickPrimaryRole(roles: Role[]): Role | null {
  if (roles.length === 1) return roles[0];
  for (const r of ROLE_PRECEDENCE) {
    if (roles.includes(r)) return r;
  }
  return roles[0] ?? null;
}

async function areasDeUnidadeDosPerfis(db: Cliente, papeis: string[]): Promise<boolean> {
  if (!papeis.length) return false;
  const [{ data: ra }, { data: areas }] = await Promise.all([
    db.from("role_areas").select("area").in("role", papeis).eq("allowed", true),
    db.from("areas").select("slug").eq("ativa", true).eq("escopo", "unidade"),
  ]);
  const deUnidade = new Set(((areas ?? []) as { slug: string }[]).map((a) => a.slug));
  return ((ra ?? []) as { area: string }[]).some((r) => deUnidade.has(r.area));
}

// ─────────────────────────────────────────────────────────────────────────
// Lista de pessoas
// ─────────────────────────────────────────────────────────────────────────

export type PessoaNaLista = {
  user_id: string;
  nome: string | null;
  email: string;
  created_at: string;
  ativo: boolean;
  ultimoLogin: string | null;
  /** Todos os perfis. `role` é o principal, só para ordenar e rotular. */
  papeis: string[];
  role: string | null;
  unidade: string | null;
  produtos: string[];
  escopo: { todas: boolean; unidades: string[] };
  growth: { papel: string; departamento: string | null } | null;
  administra: { area: string; nivel: "admin" | "socio" }[];
  pedidoPendente: { unidade: string; confirmado: boolean } | null;
  genteVinculado: boolean;
  /** Banida no Auth com a conta ativa: resto do fluxo antigo de "tirar da área". */
  banida: boolean;
};

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PessoaNaLista[]> => {
    await ensureAdmin(context.userId);
    const db = await adminDb();

    const [
      profilesRes,
      rolesRes,
      portasRes,
      sociosRes,
      escopoRes,
      unidadesDoUsuarioRes,
      catalogoRes,
      membrosRes,
      adminsRes,
      pedidosRes,
      genteRes,
      contas,
    ] = await Promise.all([
      db.schema("public").from("profiles").select("user_id, nome, email, ativo, criado_em").order("criado_em", { ascending: false }),
      db.from("user_roles").select("user_id, role"),
      // A PORTA de cada produto: `public.produto_acesso` é a mesma fonte para
      // os três (é o que `tem_produto()` lê nas policies).
      db.schema("public").from("produto_acesso").select("user_id, produto"),
      db.from("socios").select("user_id, email, unidade, unidade_id"),
      db.from("usuario_escopo").select("user_id, todas_unidades"),
      db.from("usuario_unidades").select("user_id, unidade_id"),
      db.from("unidades").select("id, nome_da_praca"),
      db.schema("growth").from("membros").select("user_id, papel, departamento"),
      db.from("area_admins").select("user_id, area, nivel"),
      db.from("acesso_pedidos").select("user_id, confirmado_em, unidades(nome_da_praca)").eq("status", "pendente"),
      db.from("gente_pessoas").select("user_id").not("user_id", "is", null),
      todasAsContasDoAuth(db),
    ]);
    for (const r of [profilesRes, rolesRes, portasRes]) {
      if (r?.error) {
        console.error("[adminListUsers]", r.error);
        throw new Error("Erro ao listar usuários. Tente novamente.");
      }
    }

    const agrupar = <T,>(linhas: T[] | null, chave: (l: T) => string) => {
      const m = new Map<string, T[]>();
      for (const l of linhas ?? []) m.set(chave(l), [...(m.get(chave(l)) ?? []), l]);
      return m;
    };
    const papeisDe = agrupar(rolesRes.data as { user_id: string; role: string }[], (l) => l.user_id);
    const portasDe = agrupar(portasRes.data as { user_id: string; produto: string }[], (l) => l.user_id);
    const adminsDe = agrupar(
      adminsRes.data as { user_id: string; area: string; nivel: "admin" | "socio" }[],
      (l) => l.user_id,
    );
    const nomeDaUnidade = new Map(
      ((catalogoRes.data ?? []) as { id: number; nome_da_praca: string }[]).map((u) => [u.id, u.nome_da_praca]),
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
      if (nome) unidadesDe.set(l.user_id, [...(unidadesDe.get(l.user_id) ?? []), nome]);
    }
    // Unidade do SÓCIO, pelo cadastro de sócio: por user_id, e pelo e-mail só
    // para quem ainda não foi ligado. `unidade_id` manda quando existe.
    const socioPorUser = new Map<string, string>();
    const socioPorEmail = new Map<string, string>();
    for (const s of (sociosRes.data ?? []) as {
      user_id: string | null;
      email: string | null;
      unidade: string | null;
      unidade_id: number | null;
    }[]) {
      const nome = (s.unidade_id && nomeDaUnidade.get(s.unidade_id)) || s.unidade;
      if (!nome) continue;
      if (s.user_id) socioPorUser.set(s.user_id, nome);
      if (s.email) socioPorEmail.set(s.email.trim().toLowerCase(), nome);
    }
    const growthDe = new Map(
      ((membrosRes.data ?? []) as { user_id: string; papel: string; departamento: string | null }[]).map((m) => [
        m.user_id,
        { papel: m.papel, departamento: m.departamento },
      ]),
    );
    const pedidoDe = new Map(
      (
        (pedidosRes.data ?? []) as {
          user_id: string;
          confirmado_em: string | null;
          unidades: { nome_da_praca: string } | null;
        }[]
      ).map((p) => [p.user_id, { unidade: p.unidades?.nome_da_praca ?? "", confirmado: Boolean(p.confirmado_em) }]),
    );
    const comGente = new Set(((genteRes.data ?? []) as { user_id: string }[]).map((g) => g.user_id));
    const loginDe = new Map(contas.map((c) => [c.id, c.last_sign_in_at ?? null]));
    const agora = Date.now();
    const banidas = new Set(
      contas.filter((c) => c.banned_until && new Date(c.banned_until).getTime() > agora).map((c) => c.id),
    );

    return ((profilesRes.data ?? []) as {
      user_id: string;
      nome: string | null;
      email: string | null;
      ativo: boolean;
      criado_em: string;
    }[]).map((p) => {
      const papeis = (papeisDe.get(p.user_id) ?? []).map((r) => r.role);
      const role = pickPrimaryRole(papeis);
      const email = (p.email ?? "").trim().toLowerCase();
      return {
        user_id: p.user_id,
        nome: p.nome,
        email,
        created_at: p.criado_em,
        ativo: p.ativo !== false,
        ultimoLogin: loginDe.get(p.user_id) ?? null,
        papeis,
        role,
        unidade: socioPorUser.get(p.user_id) ?? socioPorEmail.get(email) ?? null,
        produtos: (portasDe.get(p.user_id) ?? []).map((l) => l.produto),
        escopo: {
          todas: todasDe.get(p.user_id) ?? false,
          unidades: (unidadesDe.get(p.user_id) ?? []).sort((a, b) => a.localeCompare(b, "pt-BR")),
        },
        growth: growthDe.get(p.user_id) ?? null,
        administra: (adminsDe.get(p.user_id) ?? []).map((a) => ({ area: a.area, nivel: a.nivel })),
        pedidoPendente: pedidoDe.get(p.user_id) ?? null,
        genteVinculado: comGente.has(p.user_id),
        banida: banidas.has(p.user_id),
      };
    });
  });

// ─────────────────────────────────────────────────────────────────────────
// Criar pessoa
// ─────────────────────────────────────────────────────────────────────────

export type NovaPessoaAdmin = {
  nome: string;
  email: string;
  /** `null`: a conta nasce sem entrar no Ops (só Growth ou Financeiro depois). */
  role: Role | null;
  /** O recorte de unidades. Obrigatório quando o perfil abre área de unidade. */
  escopo: { todas: boolean; unidades: number[] };
  /** Só para sócio regional: a unidade DELE, que vira também o recorte. */
  unidadeSocio?: number | null;
};

/**
 * Cria a pessoa inteira de uma vez: conta, perfil, porta do Ops, recorte de
 * unidades, cadastro de sócio e vínculo com o Gente.
 *
 * Até 24/09/2026 isto gravava só a conta, o perfil e a porta. O recorte era um
 * segundo passo que a tela não pedia, e sem ele a trava de unidade fecha: as
 * duas contas criadas naquele dia entravam e viam tudo vazio. E o perfil
 * "Diretor", que o formulário trazia marcado, não era gravado (o código contava
 * com um gatilho do banco antigo que o banco único não tem), então quem nascia
 * diretor nascia sem perfil nenhum.
 *
 * Se um passo essencial falha, a conta recém-criada é apagada: nada fica pela
 * metade.
 */
export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: NovaPessoaAdmin) => {
    const nome = (input?.nome ?? "").trim();
    const email = (input?.email ?? "").trim().toLowerCase();
    const role = input?.role ? String(input.role).trim() : null;
    const unidadeSocio = input?.unidadeSocio == null ? null : Number(input.unidadeSocio);
    const todas = Boolean(input?.escopo?.todas);
    const unidades = Array.from(
      new Set((input?.escopo?.unidades ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0)),
    );
    if (!nome) throw new Error("Nome é obrigatório.");
    if (!EMAIL_RE.test(email)) throw new Error("E-mail inválido.");
    if (role === "socio_regional") {
      if (!unidadeSocio || !Number.isInteger(unidadeSocio)) {
        throw new Error("Escolha a unidade do sócio regional.");
      }
      // O sócio regional vê a unidade dele e só ela. O recorte sai daqui, e
      // não de uma segunda escolha que poderia discordar.
      return { nome, email, role, unidadeSocio, escopo: { todas: false, unidades: [unidadeSocio] } };
    }
    return { nome, email, role, unidadeSocio: null, escopo: { todas, unidades: todas ? [] : unidades } };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as Cliente;

    let roleLabel = "Sem acesso ao Ops";
    if (data.role) {
      const { data: roleRow } = await db.from("roles").select("key, label").eq("key", data.role).maybeSingle();
      if (!roleRow) throw new Error("Perfil inválido.");
      roleLabel = roleRow.label ?? data.role;
      if (
        !data.escopo.todas &&
        data.escopo.unidades.length === 0 &&
        (await areasDeUnidadeDosPerfis(db, [data.role]))
      ) {
        throw new Error(
          "Este perfil abre áreas recortadas por unidade: escolha as unidades que a pessoa vê, ou marque todas.",
        );
      }
    }

    if (await contaPorEmail(data.email)) {
      throw new Error("Já existe uma conta com este e-mail. Abra a ficha dela na lista.");
    }

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (createErr || !created.user) {
      console.error("[adminCreateUser] createUser failed:", createErr);
      throw new Error("Falha ao criar usuário. Tente novamente.");
    }
    const userId = created.user.id;

    const desfazer = async (motivo: string, erro: unknown) => {
      console.error(`[adminCreateUser] ${motivo}:`, erro);
      await supabaseAdmin.auth.admin.deleteUser(userId);
      throw new Error(`Não foi possível criar a pessoa (${motivo}). Nada foi gravado.`);
    };

    const { error: profileErr } = await db
      .schema("public")
      .from("profiles")
      .upsert({ user_id: userId, nome: data.nome, email: data.email }, { onConflict: "user_id" });
    if (profileErr) await desfazer("cadastro", profileErr);

    let unidadeSocioNome: string | null = null;
    if (data.role) {
      const { error: roleErr } = await db.from("user_roles").insert({ user_id: userId, role: data.role });
      if (roleErr) await desfazer("perfil", roleErr);

      // A porta do Ops. Sem ela `tem_produto('ops')` e `can_user` barram tudo.
      const { error: portaErr } = await db
        .schema("public")
        .from("produto_acesso")
        .upsert(
          { user_id: userId, produto: "ops", concedido_por: context.userId },
          { onConflict: "user_id,produto", ignoreDuplicates: true },
        );
      if (portaErr) await desfazer("porta do Ops", portaErr);

      const { error: escErr } = await db
        .from("usuario_escopo")
        .upsert(
          { user_id: userId, todas_unidades: data.escopo.todas, todas_empresas: false },
          { onConflict: "user_id" },
        );
      if (escErr) await desfazer("recorte", escErr);
      if (data.escopo.unidades.length) {
        const { error: unErr } = await db
          .from("usuario_unidades")
          .insert(data.escopo.unidades.map((unidade_id) => ({ user_id: userId, unidade_id })));
        if (unErr) await desfazer("unidades", unErr);
      }

      // Sócio regional: o cadastro de sócio aponta para a unidade por id
      // (DECISIONS 21/09). O nome em texto segue para quem ainda lê a coluna.
      if (data.role === "socio_regional" && data.unidadeSocio) {
        const { data: un } = await db
          .from("unidades")
          .select("nome_da_praca")
          .eq("id", data.unidadeSocio)
          .maybeSingle();
        unidadeSocioNome = un?.nome_da_praca ?? null;
        const { data: existente } = await db.from("socios").select("id").eq("email", data.email).maybeSingle();
        const linha = {
          unidade: unidadeSocioNome,
          unidade_id: data.unidadeSocio,
          user_id: userId,
          nome_completo: data.nome,
        };
        const res = existente
          ? await db.from("socios").update(linha).eq("id", existente.id).select("id")
          : await db.from("socios").insert({ email: data.email, ...linha }).select("id");
        if (res.error) await desfazer("cadastro de sócio", res.error);
      }
    }

    const { vincularCadastroDeGente } = await import("@/lib/gente-vinculo.server");
    await vincularCadastroDeGente(supabaseAdmin, userId, data.email, data.escopo);

    await registrarAcesso(context.userId, userId, "criar_pessoa", {
      perfil: data.role,
      todas_unidades: data.escopo.todas,
      unidades: data.escopo.unidades,
    });

    // E-mail de boas-vindas com link de definição de senha. Se o envio falhar,
    // o usuário já existe e o admin recebe o link em tela pra repassar na mão.
    let link: string | null = null;
    let emailEnviado = false;
    let emailErro: string | null = null;
    try {
      link = await gerarLinkDefinirSenha(data.email);
      const msg = emailBoasVindas({ nome: data.nome, email: data.email, link, papel: roleLabel });
      const envio = await enviarEmail({ to: data.email, ...msg });
      emailEnviado = envio.enviado;
      emailErro = envio.erro ?? null;
    } catch (err) {
      console.error("[adminCreateUser] envio do convite falhou:", err);
      emailErro = err instanceof Error ? err.message : "Falha ao gerar o link de acesso.";
    }

    return {
      user_id: userId,
      email: data.email,
      unidade: unidadeSocioNome,
      emailEnviado,
      emailErro,
      link,
    };
  });

// ─────────────────────────────────────────────────────────────────────────
// Senha
// ─────────────────────────────────────────────────────────────────────────

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

    const { data: profile } = await (supabaseAdmin as Cliente)
      .schema("public")
      .from("profiles")
      .select("nome")
      .eq("user_id", data.user_id)
      .maybeSingle();

    const link = await gerarLinkDefinirSenha(email);
    const msg = emailRedefinicaoSenha({ nome: profile?.nome ?? "", email, link });
    const envio = await enviarEmail({ to: email, ...msg });
    await registrarAcesso(context.userId, data.user_id, "senha_link", { enviado: envio.enviado });

    return {
      user_id: data.user_id,
      email,
      link,
      emailEnviado: envio.enviado,
      emailErro: envio.erro ?? null,
    };
  });

/**
 * Gera uma senha provisória, grava na conta e devolve em tela para o admin
 * repassar na mão. Ver DECISIONS 23/09/2026 e [[senha-provisoria.ts]].
 *
 * Não vale para a própria conta nem para outro super admin: trocar a senha de
 * um par por uma que passou pela sua mão é tomar a conta dele, e desde
 * 24/09/2026 isso é recusado (o caminho para um admin é o link por e-mail).
 */
export const adminGerarSenhaProvisoria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string }) => {
    if (!input?.user_id) throw new Error("user_id obrigatório.");
    if (!UUID_RE.test(input.user_id)) throw new Error("user_id inválido.");
    return { user_id: input.user_id };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    if (data.user_id === context.userId) {
      throw new Error("Para trocar a sua própria senha, use “Esqueci minha senha” na tela de login.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ehAdmin } = await (supabaseAdmin as Cliente)
      .from("user_roles")
      .select("user_id")
      .eq("user_id", data.user_id)
      .eq("role", "admin")
      .maybeSingle();
    if (ehAdmin) {
      throw new Error("Senha provisória não vale para super admin. Envie o link por e-mail.");
    }
    const { data: alvo, error } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    const email = alvo?.user?.email ?? "";
    if (error || !email) {
      console.error("[adminGerarSenhaProvisoria] getUserById failed:", error);
      throw new Error("Usuário não encontrado.");
    }

    const senha = generatePassword(12);
    const { error: upErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: senha,
      app_metadata: { [MARCA_SENHA_PROVISORIA]: true },
    });
    if (upErr) {
      console.error("[adminGerarSenhaProvisoria] updateUserById failed:", upErr);
      throw new Error("Falha ao gerar a senha provisória. Tente novamente.");
    }
    await registrarAcesso(context.userId, data.user_id, "senha_provisoria");

    return { user_id: data.user_id, email, senha };
  });

// ─────────────────────────────────────────────────────────────────────────
// Desativar, reativar, excluir
// ─────────────────────────────────────────────────────────────────────────

/**
 * Desliga a pessoa dos três produtos de uma vez, sem apagar nada.
 *
 * É o botão que faltava (auditoria de 24/09/2026): antes, tirar alguém exigia
 * revogar Ops, Growth e Financeiro em duas páginas, e nenhuma das três
 * revogações derrubava a sessão aberta. Agora:
 *   1. o banco (`ops.acesso_desativar`) marca `profiles.ativo = false`, o que
 *      fecha todas as policies na hora, e apaga as sessões abertas;
 *   2. o Auth bane a conta, então ela não entra de novo;
 *   3. o cockpit do Financeiro recebe `financeiro: false`, que o guard de lá
 *      lê ao vivo.
 * Papel, áreas, recorte e portas ficam guardados: reativar devolve tudo.
 */
export const adminDesativarPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; motivo?: string }) => {
    if (!UUID_RE.test(input?.userId ?? "")) throw new Error("Pessoa inválida.");
    return { userId: input.userId, motivo: (input?.motivo ?? "").trim().slice(0, 300) || null };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    if (data.userId === context.userId) throw new Error("Você não pode desativar a sua própria conta.");
    // Com o cliente de quem está logado: o banco confere o super admin e grava
    // o ator certo no log.
    const { error } = await (context.supabase as Cliente).rpc("acesso_desativar", {
      _alvo: data.userId,
      _motivo: data.motivo,
    });
    if (error) throw new Error(error.message || "Não foi possível desativar.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u, error: banErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: BANIMENTO,
    });
    if (banErr) console.error("[adminDesativarPessoa] banimento falhou:", banErr);

    const email = u?.user?.email ?? "";
    let financeiro = false;
    if (email) {
      const { aplicarConcessaoNoFinanceiro } = await import("@/lib/sessoes-irmas.functions");
      financeiro = (await aplicarConcessaoNoFinanceiro(data.userId, email)).ok;
    }
    return { ok: true, banido: !banErr, financeiroSincronizado: financeiro };
  });

export const adminReativarPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!UUID_RE.test(input?.userId ?? "")) throw new Error("Pessoa inválida.");
    return { userId: input.userId };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { error } = await (context.supabase as Cliente).rpc("acesso_reativar", { _alvo: data.userId });
    if (error) throw new Error(error.message || "Não foi possível reativar.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u, error: banErr } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: "none",
    });
    if (banErr) console.error("[adminReativarPessoa] desbanir falhou:", banErr);

    const email = u?.user?.email ?? "";
    if (email) {
      const { aplicarConcessaoNoFinanceiro } = await import("@/lib/sessoes-irmas.functions");
      await aplicarConcessaoNoFinanceiro(data.userId, email);
    }
    return { ok: true, desbanido: !banErr };
  });

/**
 * Apaga a conta. Só para quem NUNCA entrou (convite errado, e-mail digitado
 * errado): quem já entrou deixou rastro (pedidos decididos, listas, log) e se
 * desativa. Antes a exclusão tentava de qualquer jeito e voltava "Falha ao
 * excluir" quando uma FK recusava.
 */
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
    const { data: alvo, error: eAlvo } = await supabaseAdmin.auth.admin.getUserById(data.user_id);
    // Sem a conta lida não dá para saber se ela já entrou: não apaga no escuro.
    if (eAlvo || !alvo?.user) throw new Error("Não foi possível ler a conta agora. Nada foi apagado.");
    if (alvo.user.last_sign_in_at) {
      throw new Error(
        "Esta pessoa já entrou no Brain. Desative a conta em vez de excluir: guarda o histórico e dá para desfazer.",
      );
    }
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) {
      console.error("[adminDeleteUser] deleteUser failed:", error);
      throw new Error(
        /foreign key|violates/i.test(error.message)
          ? "Esta conta tem registros no sistema e não pode ser apagada. Desative em vez de excluir."
          : "Falha ao excluir usuário. Tente novamente.",
      );
    }
    await registrarAcesso(context.userId, data.user_id, "excluir", { email: alvo.user.email ?? null });
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────────────
// Editar nome, e-mail e perfis
// ─────────────────────────────────────────────────────────────────────────

/**
 * Edita nome, e-mail e perfis de quem já existe.
 *
 * `papeis` ausente não mexe em nada; lista vazia tira todos (a pessoa segue
 * entrando pelas áreas, se tiver alguma). A lista SUBSTITUI a atual: até
 * 24/09/2026 o formulário mandava um perfil só e apagava o segundo de quem tem
 * dois (Jordana, Pedro Araújo, Ana Carvalhais) sem avisar.
 *
 * O e-mail existe para o caso real de 24/09/2026: uma conta criada como
 * `@planning.combr` não recebia convite nem redefinição.
 */
export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { user_id: string; nome: string; email?: string; papeis?: string[] }) => {
    if (!input?.user_id || !UUID_RE.test(input.user_id)) throw new Error("user_id inválido.");
    const nome = (input?.nome ?? "").trim();
    if (!nome) throw new Error("Nome é obrigatório.");
    const email = input?.email === undefined ? undefined : String(input.email).trim().toLowerCase();
    if (email !== undefined && !EMAIL_RE.test(email)) throw new Error("E-mail inválido.");
    const papeis =
      input?.papeis === undefined
        ? undefined
        : Array.from(new Set(input.papeis.map((p) => String(p).trim()).filter(Boolean)));
    return { user_id: input.user_id, nome, email, papeis };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as Cliente;

    const { data: antes } = await db
      .schema("public")
      .from("profiles")
      .select("nome, email")
      .eq("user_id", data.user_id)
      .maybeSingle();
    if (!antes) throw new Error("Pessoa não encontrada.");

    const trocaEmail = data.email !== undefined && data.email !== antes.email;
    if (trocaEmail) {
      const outra = await contaPorEmail(data.email!);
      if (outra && outra.user_id !== data.user_id) throw new Error("Já existe outra conta com este e-mail.");
      const { error: eAuth } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
        email: data.email,
        email_confirm: true,
      });
      if (eAuth) {
        console.error("[adminUpdateUser] troca de e-mail no Auth falhou:", eAuth);
        throw new Error("Falha ao trocar o e-mail da conta.");
      }
    }

    const pResult = await db
      .schema("public")
      .from("profiles")
      .update({ nome: data.nome, ...(trocaEmail ? { email: data.email } : {}) })
      .eq("user_id", data.user_id)
      .select("user_id");
    if (pResult.error) {
      console.error("[adminUpdateUser] profile update failed:", pResult.error);
      throw new Error("Falha ao atualizar o cadastro.");
    }
    assertAffected(pResult, `Perfil do usuário ${data.user_id} não foi atualizado.`);
    const { error: aErr } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      user_metadata: { nome: data.nome },
    });
    if (aErr) console.error("[adminUpdateUser] auth metadata update failed:", aErr);

    let papeisAntes: string[] = [];
    if (data.papeis !== undefined) {
      // Tirar o próprio admin é o jeito mais rápido de se trancar do lado de
      // fora justamente desta tela.
      if (data.user_id === context.userId && !data.papeis.includes("admin")) {
        throw new Error("Você não pode tirar o seu próprio perfil de Super admin.");
      }
      if (data.papeis.length) {
        const { data: validos } = await db.from("roles").select("key").in("key", data.papeis);
        if ((validos ?? []).length !== data.papeis.length) throw new Error("Perfil inválido.");
      }
      const { data: atuais } = await db.from("user_roles").select("role").eq("user_id", data.user_id);
      papeisAntes = ((atuais ?? []) as { role: string }[]).map((r) => r.role);
      const sai = papeisAntes.filter((r) => !data.papeis!.includes(r));
      const entra = data.papeis.filter((r) => !papeisAntes.includes(r));
      if (sai.length) {
        const { error } = await db.from("user_roles").delete().eq("user_id", data.user_id).in("role", sai);
        if (error) throw new Error("Falha ao atualizar os perfis.");
      }
      if (entra.length) {
        const { error } = await db.from("user_roles").insert(entra.map((role) => ({ user_id: data.user_id, role })));
        if (error) throw new Error("Falha ao atualizar os perfis.");
      }
    }

    await registrarAcesso(context.userId, data.user_id, "editar_pessoa", {
      ...(data.nome !== antes.nome ? { nome: { de: antes.nome, para: data.nome } } : {}),
      ...(trocaEmail ? { email: { de: antes.email, para: data.email } } : {}),
      ...(data.papeis !== undefined ? { perfis: { de: papeisAntes, para: data.papeis } } : {}),
    });
    return { ok: true };
  });

// ─────────────────────────────────────────────────────────────────────────
// Growth
// ─────────────────────────────────────────────────────────────────────────

/** E-mail do admin logado, pra registrar em admin_auditoria no Growth. */
async function actorEmail(userId: string): Promise<string> {
  const db = await adminDb();
  const { data } = await db.schema("public").from("profiles").select("email").eq("user_id", userId).maybeSingle();
  return data?.email ?? "desconhecido";
}

// Acesso ao Growth pelo banco único (17/09/2026): a allowlist é
// `growth.membros` por user_id, a porta é `public.produto_acesso` e a conta é
// a MESMA do Ops. Revogar tira as duas coisas e nunca apaga a conta.
async function growthDb(): Promise<Cliente> {
  return (await adminDb()).schema("growth");
}

export const adminListGrowthAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ensureAdmin(context.userId);
    const db = await adminDb();
    const growth = await growthDb();
    const { data: membros, error } = await growth.from("membros").select("user_id, papel, departamento");
    if (error) {
      console.error("[adminListGrowthAccess] membros query failed:", error);
      throw new Error("Erro ao listar acessos do Growth.");
    }
    const ids = ((membros ?? []) as { user_id: string }[]).map((m) => m.user_id);
    const { data: perfis } = ids.length
      ? await db.schema("public").from("profiles").select("user_id, nome, email").in("user_id", ids)
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

/**
 * Dá ou ajusta o acesso ao Growth de quem JÁ tem conta.
 *
 * Não cria conta e não mexe em senha. Até 24/09/2026 aceitava uma senha e, para
 * conta existente, a sobrescrevia em silêncio: o mesmo login vale para os três
 * produtos, então dar acesso ao Growth trocava a senha do Ops e do Financeiro
 * de alguém, inclusive de outro admin. Conta nova nasce em "Novo usuário".
 */
export const adminGrantGrowthAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string; papel: string; departamento: string }) => {
    const email = (input?.email ?? "").trim().toLowerCase();
    const papel = (input?.papel ?? "").trim();
    const departamento = (input?.departamento ?? "").trim();
    if (!EMAIL_RE.test(email)) throw new Error("Email inválido.");
    if (!["admin", "gestao", "operacional"].includes(papel)) throw new Error("Papel do Growth inválido.");
    if (!["comercial", "diretoria", "marketing", "backoffice", "parcerias"].includes(departamento)) {
      throw new Error("Departamento do Growth inválido.");
    }
    return { email, papel, departamento };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const db = await adminDb();
    const growth = await growthDb();

    const conta = await contaPorEmail(data.email);
    if (!conta) throw new Error("Esta pessoa ainda não tem conta no Brain. Crie em “Novo usuário” primeiro.");

    const { error: mErr } = await growth
      .from("membros")
      .upsert({ user_id: conta.user_id, papel: data.papel, departamento: data.departamento }, { onConflict: "user_id" });
    if (mErr) {
      console.error("[adminGrantGrowthAccess] membros upsert failed:", mErr);
      throw new Error("Falha ao conceder acesso no Growth.");
    }
    const { error: pErr } = await db
      .schema("public")
      .from("produto_acesso")
      .upsert(
        { user_id: conta.user_id, produto: "growth", concedido_por: context.userId },
        { onConflict: "user_id,produto", ignoreDuplicates: true },
      );
    if (pErr) {
      console.error("[adminGrantGrowthAccess] produto_acesso upsert failed:", pErr);
      throw new Error("O papel no Growth foi gravado, mas a porta do produto não abriu. Tente de novo.");
    }

    // Mesmo padrão de auditoria que o próprio Growth já usa, e o log do Brain.
    await growth.from("admin_auditoria").insert({
      ator_email: await actorEmail(context.userId),
      acao: "acesso_concedido",
      alvo_email: data.email,
      detalhe: { papel: data.papel, departamento: data.departamento, origem: "ops/admin-usuarios" },
    });
    await registrarAcesso(context.userId, conta.user_id, "growth_conceder", {
      papel: data.papel,
      departamento: data.departamento,
    });

    return { email: data.email };
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
    const db = await adminDb();
    const growth = await growthDb();
    const conta = await contaPorEmail(data.email);
    if (!conta) throw new Error("Usuário não encontrado.");

    // Tira a allowlist e a porta do Growth. A conta continua: ela é a mesma
    // do Ops e do Financeiro.
    const { error } = await growth.from("membros").delete().eq("user_id", conta.user_id);
    if (error) {
      console.error("[adminRevokeGrowthAccess] membros delete failed:", error);
      throw new Error("Falha ao revogar acesso no Growth.");
    }
    const { error: pErr } = await db
      .schema("public")
      .from("produto_acesso")
      .delete()
      .eq("user_id", conta.user_id)
      .eq("produto", "growth");
    if (pErr) throw new Error("O papel no Growth saiu, mas a porta do produto não fechou. Tente de novo.");

    await growth.from("admin_auditoria").insert({
      ator_email: await actorEmail(context.userId),
      acao: "acesso_revogado",
      alvo_email: data.email,
      detalhe: { origem: "ops/admin-usuarios" },
    });
    await registrarAcesso(context.userId, conta.user_id, "growth_revogar");

    return { email: data.email };
  });

// ─────────────────────────────────────────────────────────────────────────
// Porta do Ops
// ─────────────────────────────────────────────────────────────────────────

/**
 * Abre ou fecha a porta do Ops de alguém (`produto_acesso`, produto = 'ops').
 *
 * Fechar a porta não apaga perfil, áreas nem recorte: reabrir devolve a pessoa
 * exatamente como estava. Desde a migration 20260925100000 fechar a porta
 * também fecha de verdade (`can_user` passou a olhar a porta); antes o menu
 * sumia mas os dados continuavam respondendo a quem chamasse direto.
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
    if (!data.conceder && data.userId === context.userId) {
      throw new Error("Você não pode revogar o seu próprio acesso ao Ops.");
    }
    const porta = (await adminDb()).schema("public").from("produto_acesso");
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
    await registrarAcesso(context.userId, data.userId, data.conceder ? "porta_ops_abrir" : "porta_ops_fechar");
    return { userId: data.userId, conceder: data.conceder };
  });

// ─────────────────────────────────────────────────────────────────────────
// Ficha da pessoa
// ─────────────────────────────────────────────────────────────────────────

export type OrigemDaArea = "perfil" | "pessoa" | "admin" | "socio";

export type AreaNaFicha = {
  slug: string;
  nome: string;
  escopo: "unidade" | "empresa" | "nenhum";
  /** A pessoa abre esta área agora (a mesma regra do menu e da RLS). */
  abre: boolean;
  /** De onde vem: pelo perfil, dada à pessoa, ou por administrar a área. */
  origens: OrigemDaArea[];
  bloqueada: boolean;
  /** Páginas liberadas pessoa a pessoa (quem entra só por delegação). */
  paginas: string[];
  /** Páginas negadas a esta pessoa. */
  negadas: string[];
  /** Quantas páginas de ver a área tem, para "3 de 8". */
  totalPaginas: number;
};

/** JSON que atravessa a server function (o `detalhe` do log é jsonb livre). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export type EventoDoHistorico = {
  quando: string;
  acao: string;
  area: string | null;
  ator: string | null;
  alvo: string | null;
  detalhe: { [k: string]: Json };
};

export type FichaDaPessoa = {
  userId: string;
  nome: string | null;
  email: string;
  ativo: boolean;
  criadoEm: string | null;
  ultimoLogin: string | null;
  convitePendente: boolean;
  senhaProvisoria: boolean;
  banida: boolean;
  souEu: boolean;
  superAdmin: boolean;
  papeis: { key: string; label: string }[];
  produtos: { ops: boolean; growth: boolean; financeiro: boolean };
  areas: AreaNaFicha[];
  totalChaves: number;
  escopo: {
    todasUnidades: boolean;
    unidades: { id: number; nome: string }[];
    todasEmpresas: boolean;
    empresas: string[];
  };
  growth: { papel: string; departamento: string | null } | null;
  socio: { unidade: string | null } | null;
  gente: { id: number; nome: string; cargo: string | null; unidade: string | null } | null;
  /** Cadastro do Gente com o mesmo e-mail e sem login ligado. */
  genteSemVinculo: { id: number; nome: string; manual: boolean; gestor: string | null; unidade: string | null } | null;
  pedido: { id: number; unidade: string; cargo: string; confirmado: boolean; criadoEm: string } | null;
  historico: EventoDoHistorico[];
};

const ORDEM_ORIGEM: Record<OrigemDaArea, number> = { admin: 0, socio: 1, pessoa: 2, perfil: 3 };

/**
 * Tudo o que uma pessoa acessa e por quê, numa resposta só.
 *
 * O que faltava para responder "o que a Fulana vê?" (auditoria de 24/09/2026):
 * a informação estava em seis telas e cinco diálogos. O ACESSO EFETIVO vem de
 * `ops.acesso_do_usuario`, a mesma função que monta o menu e que a RLS usa por
 * baixo (`can_user`). As ORIGENS são lidas das tabelas que a compõem, para a
 * tela dizer de onde cada área vem.
 */
export const adminFichaPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    if (!UUID_RE.test(input?.userId ?? "")) throw new Error("Pessoa inválida.");
    return { userId: input.userId };
  })
  .handler(async ({ data, context }): Promise<FichaDaPessoa> => {
    await ensureAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as Cliente;
    const id = data.userId;

    const [
      profileRes,
      authRes,
      papeisRes,
      portasRes,
      areasRes,
      roleAreasRes,
      adminsRes,
      membrosRes,
      chavesPessoaRes,
      areaChavesRes,
      escopoRes,
      unidadesRes,
      empresasRes,
      growthRes,
      socioRes,
      genteRes,
      pedidoRes,
      logRes,
      efetivoRes,
    ] = await Promise.all([
      db.schema("public").from("profiles").select("nome, email, ativo, criado_em").eq("user_id", id).maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(id),
      db.from("user_roles").select("role").eq("user_id", id),
      db.schema("public").from("produto_acesso").select("produto").eq("user_id", id),
      db.from("areas").select("slug, nome, escopo, ordem").eq("ativa", true).order("ordem"),
      db.from("role_areas").select("role, area").eq("allowed", true),
      db.from("area_admins").select("area, nivel").eq("user_id", id),
      db.from("usuario_areas").select("area, allowed").eq("user_id", id),
      db.from("usuario_chaves").select("permission_key, allowed").eq("user_id", id),
      db.from("area_chaves").select("area, permission_key"),
      db.from("usuario_escopo").select("todas_unidades, todas_empresas").eq("user_id", id).maybeSingle(),
      db.from("usuario_unidades").select("unidade_id, unidades(nome_da_praca)").eq("user_id", id),
      db.from("usuario_empresas").select("empresa_id").eq("user_id", id),
      db.schema("growth").from("membros").select("papel, departamento").eq("user_id", id).maybeSingle(),
      db.from("socios").select("unidade, unidade_id, unidades(nome_da_praca)").eq("user_id", id).limit(1).maybeSingle(),
      db
        .from("gente_pessoas")
        .select("id, nome_completo, cargo, unidades(nome_da_praca)")
        .eq("user_id", id)
        .limit(1)
        .maybeSingle(),
      db
        .from("acesso_pedidos")
        .select("id, cargo, confirmado_em, criado_em, unidades(nome_da_praca)")
        .eq("user_id", id)
        .eq("status", "pendente")
        .maybeSingle(),
      db
        .from("acessos_log")
        .select("ator, alvo, acao, area, detalhe, criado_em")
        .or(`alvo.eq.${id},ator.eq.${id}`)
        .order("criado_em", { ascending: false })
        .limit(60),
      db.rpc("acesso_do_usuario", { _user: id }),
    ]);

    const profile = profileRes.data as
      | { nome: string | null; email: string | null; ativo: boolean; criado_em: string }
      | null;
    if (!profile) throw new Error("Pessoa não encontrada.");
    const email = (profile.email ?? "").toLowerCase();
    const authUser = authRes?.data?.user ?? null;

    const papeis = ((papeisRes.data ?? []) as { role: string }[]).map((r) => r.role);
    const { data: rotulos } = papeis.length
      ? await db.from("roles").select("key, label").in("key", papeis)
      : { data: [] };
    const rotulo = new Map(((rotulos ?? []) as { key: string; label: string }[]).map((r) => [r.key, r.label]));
    const portas = new Set(((portasRes.data ?? []) as { produto: string }[]).map((p) => p.produto));

    const efetivo = (efetivoRes.data ?? {}) as { areas?: string[]; permissions?: string[] };
    const abertas = new Set(efetivo.areas ?? []);

    const areasDoPerfil = new Set(
      ((roleAreasRes.data ?? []) as { role: string; area: string }[])
        .filter((r) => papeis.includes(r.role))
        .map((r) => r.area),
    );
    const nivelDe = new Map(
      ((adminsRes.data ?? []) as { area: string; nivel: "admin" | "socio" }[]).map((a) => [a.area, a.nivel]),
    );
    const membros = (membrosRes.data ?? []) as { area: string; allowed: boolean }[];
    const dadaA = new Set(membros.filter((m) => m.allowed).map((m) => m.area));
    const bloqueadas = new Set(membros.filter((m) => !m.allowed).map((m) => m.area));
    const chavesPessoa = (chavesPessoaRes.data ?? []) as { permission_key: string; allowed: boolean }[];
    const chavesDaArea = new Map<string, string[]>();
    for (const c of (areaChavesRes.data ?? []) as { area: string; permission_key: string }[]) {
      chavesDaArea.set(c.area, [...(chavesDaArea.get(c.area) ?? []), c.permission_key]);
    }

    const areas: AreaNaFicha[] = (
      (areasRes.data ?? []) as { slug: string; nome: string; escopo: "unidade" | "empresa" | "nenhum" }[]
    )
      .map((a) => {
        const origens: OrigemDaArea[] = [];
        const nivel = nivelDe.get(a.slug);
        if (nivel) origens.push(nivel);
        if (dadaA.has(a.slug) && !nivel) origens.push("pessoa");
        if (areasDoPerfil.has(a.slug)) origens.push("perfil");
        origens.sort((x, y) => ORDEM_ORIGEM[x] - ORDEM_ORIGEM[y]);
        const daArea = new Set(chavesDaArea.get(a.slug) ?? []);
        return {
          slug: a.slug,
          nome: a.nome,
          escopo: a.escopo,
          abre: abertas.has(a.slug),
          origens,
          bloqueada: bloqueadas.has(a.slug),
          paginas: chavesPessoa.filter((c) => c.allowed && daArea.has(c.permission_key)).map((c) => c.permission_key),
          negadas: chavesPessoa.filter((c) => !c.allowed && daArea.has(c.permission_key)).map((c) => c.permission_key),
          totalPaginas: [...daArea].filter((k) => k.startsWith("view.")).length,
        };
      })
      .filter((a) => a.abre || a.origens.length > 0 || a.bloqueada);

    // Empresas do Financeiro pelo apelido, lidas do schema `financeiro` do
    // banco único (o mesmo catálogo do diálogo antigo de escopo).
    const empresaIds = ((empresasRes.data ?? []) as { empresa_id: string }[]).map((e) => e.empresa_id);
    let empresas: string[] = [];
    if (empresaIds.length) {
      const { data: emps } = await db.schema("financeiro").from("empresas").select("id, apelido").in("id", empresaIds);
      empresas = ((emps ?? []) as { apelido: string }[]).map((e) => e.apelido).sort();
    }

    // Cadastro do Gente com o mesmo e-mail e sem login: o vínculo que a tela
    // oferece fazer, porque sem ele 1:1 e feedback barram em silêncio.
    let genteSemVinculo: FichaDaPessoa["genteSemVinculo"] = null;
    if (!genteRes.data && email) {
      const { data: g } = await db
        .from("gente_pessoas")
        .select("id, nome_completo, origem, gestor_id, unidades(nome_da_praca)")
        .eq("email", email)
        .is("user_id", null)
        .maybeSingle();
      if (g) {
        // O gestor é o que importa antes de ligar: quem liga dá a ele a leitura
        // dos 1:1 e PDIs desta pessoa.
        const { data: gestor } = g.gestor_id
          ? await db.from("gente_pessoas").select("nome_completo").eq("id", g.gestor_id).maybeSingle()
          : { data: null };
        genteSemVinculo = {
          id: g.id,
          nome: g.nome_completo,
          manual: g.origem === "manual",
          gestor: gestor?.nome_completo ?? null,
          unidade: g.unidades?.nome_da_praca ?? null,
        };
      }
    }

    // Nomes de quem aparece no histórico.
    const log = (logRes.data ?? []) as {
      ator: string | null;
      alvo: string | null;
      acao: string;
      area: string | null;
      detalhe: { [k: string]: Json } | null;
      criado_em: string;
    }[];
    const ids = Array.from(new Set(log.flatMap((l) => [l.ator, l.alvo]).filter(Boolean))) as string[];
    const { data: nomes } = ids.length
      ? await db.schema("public").from("profiles").select("user_id, nome, email").in("user_id", ids)
      : { data: [] };
    const nome = new Map(
      ((nomes ?? []) as { user_id: string; nome: string | null; email: string | null }[]).map((p) => [
        p.user_id,
        p.nome || p.email || "conta apagada",
      ]),
    );

    const socio = socioRes.data as { unidade: string | null; unidades: { nome_da_praca: string } | null } | null;
    const gente = genteRes.data as {
      id: number;
      nome_completo: string;
      cargo: string | null;
      unidades: { nome_da_praca: string } | null;
    } | null;
    const pedido = pedidoRes.data as {
      id: number;
      cargo: string;
      confirmado_em: string | null;
      criado_em: string;
      unidades: { nome_da_praca: string } | null;
    } | null;

    return {
      userId: id,
      nome: profile.nome,
      email,
      ativo: profile.ativo !== false,
      criadoEm: profile.criado_em ?? authUser?.created_at ?? null,
      ultimoLogin: authUser?.last_sign_in_at ?? null,
      convitePendente: !authUser?.last_sign_in_at,
      banida: Boolean(authUser?.banned_until && new Date(authUser.banned_until).getTime() > Date.now()),
      senhaProvisoria: Boolean(
        (authUser?.app_metadata as Record<string, unknown> | undefined)?.[MARCA_SENHA_PROVISORIA],
      ),
      souEu: id === context.userId,
      superAdmin: papeis.includes("admin"),
      papeis: papeis.map((key) => ({ key, label: rotulo.get(key) ?? key })),
      produtos: { ops: portas.has("ops"), growth: portas.has("growth"), financeiro: portas.has("financeiro") },
      areas,
      totalChaves: (efetivo.permissions ?? []).length,
      escopo: {
        todasUnidades: Boolean(escopoRes.data?.todas_unidades),
        unidades: ((unidadesRes.data ?? []) as { unidade_id: number; unidades: { nome_da_praca: string } | null }[])
          .map((u) => ({ id: u.unidade_id, nome: u.unidades?.nome_da_praca ?? `unidade ${u.unidade_id}` }))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
        todasEmpresas: Boolean(escopoRes.data?.todas_empresas),
        empresas,
      },
      growth: (growthRes.data as FichaDaPessoa["growth"]) ?? null,
      socio: socio ? { unidade: socio.unidades?.nome_da_praca ?? socio.unidade } : null,
      gente: gente
        ? { id: gente.id, nome: gente.nome_completo, cargo: gente.cargo, unidade: gente.unidades?.nome_da_praca ?? null }
        : null,
      genteSemVinculo,
      pedido: pedido
        ? {
            id: pedido.id,
            unidade: pedido.unidades?.nome_da_praca ?? "",
            cargo: pedido.cargo,
            confirmado: Boolean(pedido.confirmado_em),
            criadoEm: pedido.criado_em,
          }
        : null,
      historico: log.map((l) => ({
        quando: l.criado_em,
        acao: l.acao,
        area: l.area,
        ator: l.ator ? (nome.get(l.ator) ?? "conta apagada") : null,
        alvo: l.alvo ? (nome.get(l.alvo) ?? "conta apagada") : null,
        detalhe: l.detalhe ?? {},
      })),
    };
  });

/**
 * Liga o cadastro do Gente (mesmo e-mail, sem login) a esta conta. É o passo
 * que a ficha oferece quando acha o cadastro solto: sem ele `minha_pessoa_id()`
 * volta nulo e 1:1, feedback e PDI barram a pessoa sem explicar.
 */
export const adminVincularGente = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; pessoaId: number }) => {
    if (!UUID_RE.test(input?.userId ?? "")) throw new Error("Pessoa inválida.");
    if (!Number.isInteger(input?.pessoaId)) throw new Error("Cadastro inválido.");
    return { userId: input.userId, pessoaId: input.pessoaId };
  })
  .handler(async ({ data, context }) => {
    await ensureAdmin(context.userId);
    const db = await adminDb();
    const { data: conta } = await db
      .schema("public")
      .from("profiles")
      .select("email")
      .eq("user_id", data.userId)
      .maybeSingle();
    const res = await db
      .from("gente_pessoas")
      .update({ user_id: data.userId })
      .eq("id", data.pessoaId)
      .eq("email", (conta?.email ?? "").toLowerCase())
      .is("user_id", null)
      .select("id");
    if (res.error) throw new Error("Falha ao ligar o cadastro do Gente.");
    assertAffected(res, "O cadastro do Gente não é desta pessoa ou já foi ligado.");
    await registrarAcesso(context.userId, data.userId, "gente_vincular", { pessoa_id: data.pessoaId });
    return { ok: true };
  });
