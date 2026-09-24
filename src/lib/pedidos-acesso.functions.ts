import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { gerarLinkDefinirSenha } from "@/lib/admin-users.functions";
import { enviarEmailAcesso as enviarEmail } from "@/lib/email-access.server";
import { emailNovoPedidoParaLider, emailPedidoDecidido, emailPedidoRecebido } from "@/lib/email-templates";

// Pedido de acesso: o colaborador se cadastra em /cadastro e o sócio (ou admin)
// da unidade libera em /equipe. Decisão de 24/09/2026.
//
// Como no convite, A REGRA NÃO MORA AQUI. Quem aprova passa pela mesma
// `ops.acesso_adicionar_na_area` do convite, com o cliente de quem está logado,
// e o banco aplica a não escalada. A conta de quem pede nasce em branco, que é
// o caso que o sócio pode adotar dentro da unidade dele.
//
// `pedirCadastro` é a única função pública. Por isso ela responde sempre igual
// (não revela se o e-mail já tem conta) e só aceita os domínios do grupo.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

/** Domínios aceitos no autocadastro (pedido do usuário, 24/09/2026). */
export const DOMINIOS_CADASTRO = ["planning.com.br", "grupoplanning.com.br"];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REENVIO_MIN = 15;

function appUrl() {
  return (process.env.APP_URL || "https://planningbrain.com.br").replace(/\/+$/, "");
}

function dominioAceito(email: string) {
  const dominio = email.split("@")[1] ?? "";
  return DOMINIOS_CADASTRO.includes(dominio);
}

async function admin(): Promise<Cliente> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function nomeDaUnidade(adm: Cliente, id: number): Promise<string> {
  const { data } = await adm.from("unidades").select("nome_da_praca").eq("id", id).maybeSingle();
  return data?.nome_da_praca ?? `unidade ${id}`;
}

/**
 * Quem recebe o aviso de pedido novo. Primeiro os sócios da unidade; sem
 * nenhum, os admins das áreas de unidade; sem nenhum, os super admins. Assim o
 * pedido nunca fica sem ninguém avisado, e a caixa do super admin só enche
 * quando a unidade não tem quem responda por ela.
 */
async function lideresDaUnidade(adm: Cliente, unidadeId: number): Promise<{ nome: string; email: string }[]> {
  const { data: areas } = await adm.from("areas").select("slug").eq("ativa", true).eq("escopo", "unidade");
  const slugs = ((areas ?? []) as { slug: string }[]).map((a) => a.slug).filter((s) => s !== "admin");
  const { data: admins } = await adm.from("area_admins").select("user_id, nivel").in("area", slugs);
  const lista = (admins ?? []) as { user_id: string; nivel: string }[];

  const socios = Array.from(new Set(lista.filter((a) => a.nivel === "socio").map((a) => a.user_id)));
  let ids: string[] = [];
  if (socios.length) {
    const [un, esc] = await Promise.all([
      adm.from("usuario_unidades").select("user_id").eq("unidade_id", unidadeId).in("user_id", socios),
      adm.from("usuario_escopo").select("user_id").eq("todas_unidades", true).in("user_id", socios),
    ]);
    ids = Array.from(
      new Set([...(un.data ?? []), ...(esc.data ?? [])].map((r: { user_id: string }) => r.user_id)),
    );
  }
  if (!ids.length) ids = Array.from(new Set(lista.filter((a) => a.nivel === "admin").map((a) => a.user_id)));
  if (!ids.length) {
    const { data: supers } = await adm.from("user_roles").select("user_id").eq("role", "admin");
    ids = ((supers ?? []) as { user_id: string }[]).map((r) => r.user_id);
  }
  if (!ids.length) return [];
  const { data: perfis } = await adm.from("profiles").select("nome, email").in("user_id", ids);
  return ((perfis ?? []) as { nome: string | null; email: string | null }[])
    .filter((p) => p.email)
    .map((p) => ({ nome: p.nome ?? "", email: p.email! }));
}

/** Lista pública das unidades para o formulário de cadastro. Só id e nome. */
export const unidadesParaCadastro = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ id: number; nome: string }[]> => {
    const adm = await admin();
    const { data } = await adm.from("unidades").select("id, nome_da_praca").order("nome_da_praca");
    return ((data ?? []) as { id: number; nome_da_praca: string | null }[])
      .filter((u) => u.nome_da_praca)
      .map((u) => ({ id: u.id, nome: u.nome_da_praca! }));
  },
);

export const pedirCadastro = createServerFn({ method: "POST" })
  .inputValidator((input: { nome: string; email: string; cargo: string; unidadeId: number; observacao?: string }) => {
    const nome = (input?.nome ?? "").trim().slice(0, 120);
    const cargo = (input?.cargo ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
    const email = (input?.email ?? "").trim().toLowerCase();
    const unidadeId = Number(input?.unidadeId);
    const observacao = (input?.observacao ?? "").trim().slice(0, 500) || null;
    if (nome.length < 3) throw new Error("Informe seu nome completo.");
    if (cargo.length < 2) throw new Error("Informe seu cargo.");
    if (!EMAIL_RE.test(email)) throw new Error("E-mail inválido.");
    if (!dominioAceito(email)) {
      throw new Error(`Use seu e-mail corporativo (${DOMINIOS_CADASTRO.map((d) => "@" + d).join(" ou ")}).`);
    }
    if (!Number.isInteger(unidadeId) || unidadeId <= 0) throw new Error("Escolha sua unidade.");
    return { nome, email, cargo, unidadeId, observacao };
  })
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const adm = await admin();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: un } = await adm.from("unidades").select("id").eq("id", data.unidadeId).maybeSingle();
    if (!un) throw new Error("Escolha sua unidade.");

    const { data: perfil } = await adm.from("profiles").select("user_id").ilike("email", data.email).maybeSingle();
    let userId: string = perfil?.user_id ?? "";
    let jaTemSenha = false;

    if (userId) {
      // Já entra no Ops: não há o que pedir. Resposta igual, para não revelar.
      const { data: porta } = await adm
        .schema("public")
        .from("produto_acesso")
        .select("produto")
        .eq("user_id", userId)
        .eq("produto", "ops")
        .maybeSingle();
      if (porta) return { ok: true };

      const { data: u } = await supabaseAdmin.auth.admin.getUserById(userId);
      jaTemSenha = Boolean(u?.user?.last_sign_in_at);

      // Pedido aberto: não duplica, e só reenvia o e-mail depois de um tempo.
      const { data: aberto } = await adm
        .from("acesso_pedidos")
        .select("id, criado_em")
        .eq("user_id", userId)
        .eq("status", "pendente")
        .maybeSingle();
      if (aberto) {
        const minutos = (Date.now() - new Date(aberto.criado_em).getTime()) / 60000;
        if (minutos < REENVIO_MIN || jaTemSenha) return { ok: true };
        const link = await gerarLinkDefinirSenha(data.email);
        const unidade = await nomeDaUnidade(adm, data.unidadeId);
        await enviarEmail({ to: data.email, ...emailPedidoRecebido({ nome: data.nome, email: data.email, unidade, link }) });
        return { ok: true };
      }
    } else {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        email_confirm: true,
        user_metadata: { nome: data.nome, origem: "autocadastro" },
      });
      if (error || !created?.user) {
        console.error("[pedirCadastro] createUser falhou:", error?.message);
        throw new Error("Não foi possível registrar o pedido agora. Tente de novo em alguns minutos.");
      }
      userId = created.user.id;
      await adm.from("profiles").upsert({ user_id: userId, nome: data.nome, email: data.email }, { onConflict: "user_id" });
    }

    const { error: insErr } = await adm.from("acesso_pedidos").insert({
      user_id: userId,
      nome: data.nome,
      cargo: data.cargo,
      email: data.email,
      unidade_id: data.unidadeId,
      observacao: data.observacao,
      // Quem já tem senha já provou a caixa: o pedido vai direto ao líder.
      confirmado_em: jaTemSenha ? new Date().toISOString() : null,
    });
    // 23505: outro pedido aberto entrou ao mesmo tempo. O que importa já existe.
    if (insErr && insErr.code !== "23505") {
      console.error("[pedirCadastro] insert falhou:", insErr.message);
      throw new Error("Não foi possível registrar o pedido agora. Tente de novo em alguns minutos.");
    }
    if (insErr) return { ok: true };

    const unidade = await nomeDaUnidade(adm, data.unidadeId);
    let link: string | null = null;
    if (!jaTemSenha) {
      try {
        link = await gerarLinkDefinirSenha(data.email);
      } catch (e) {
        console.error("[pedirCadastro] link de senha falhou:", e);
      }
    }
    await enviarEmail({ to: data.email, ...emailPedidoRecebido({ nome: data.nome, email: data.email, unidade, link }) });
    if (jaTemSenha) {
      await avisarLideres(adm, {
        nome: data.nome,
        cargo: data.cargo,
        email: data.email,
        unidadeId: data.unidadeId,
        observacao: data.observacao,
      });
    }
    return { ok: true };
  });

async function avisarLideres(
  adm: Cliente,
  p: { nome: string; cargo: string; email: string; unidadeId: number; observacao: string | null },
) {
  const [unidade, lideres] = await Promise.all([nomeDaUnidade(adm, p.unidadeId), lideresDaUnidade(adm, p.unidadeId)]);
  await Promise.all(
    lideres.map((l) =>
      enviarEmail({
        to: l.email,
        ...emailNovoPedidoParaLider({
          nomeLider: l.nome,
          nome: p.nome,
          cargo: p.cargo,
          email: p.email,
          unidade,
          observacao: p.observacao,
          link: `${appUrl()}/equipe`,
        }),
      }),
    ),
  );
}

/**
 * Primeiro login de quem pediu: a pessoa abriu o link do e-mail e definiu a
 * senha, então é dona da caixa. Só aqui o pedido fica visível ao líder e ele é
 * avisado. Idempotente: a segunda chamada não acha pedido sem confirmação.
 */
export const confirmarMeuPedido = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const adm = await admin();
    const { data } = await adm
      .from("acesso_pedidos")
      .update({ confirmado_em: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("status", "pendente")
      .is("confirmado_em", null)
      .select("nome, cargo, email, unidade_id, observacao")
      .maybeSingle();
    if (data) {
      await avisarLideres(adm, {
        nome: data.nome,
        cargo: data.cargo,
        email: data.email,
        unidadeId: data.unidade_id,
        observacao: data.observacao,
      });
    }
    return { ok: true };
  });

export type PedidoDeAcesso = {
  id: number;
  userId: string;
  nome: string;
  cargo: string;
  email: string;
  unidadeId: number;
  unidade: string;
  observacao: string | null;
  criadoEm: string;
  senhaDefinida: boolean;
};

/** O meu pedido aberto, para o /inicio de quem ainda não entra em nada. */
export const meuPedidoDeAcesso = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ unidade: string; criadoEm: string } | null> => {
    const db = context.supabase as Cliente;
    const { data } = await db
      .from("acesso_pedidos")
      .select("criado_em, unidades(nome_da_praca)")
      .eq("user_id", context.userId)
      .eq("status", "pendente")
      .maybeSingle();
    if (!data) return null;
    return { unidade: data.unidades?.nome_da_praca ?? "", criadoEm: data.criado_em };
  });

/** Pedidos abertos que eu posso decidir. A RLS já recorta pela unidade. */
export const listPedidosAcesso = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PedidoDeAcesso[]> => {
    const db = context.supabase as Cliente;
    const { data, error } = await db
      .from("acesso_pedidos")
      .select("id, user_id, nome, cargo, email, unidade_id, observacao, criado_em, unidades(nome_da_praca)")
      .eq("status", "pendente")
      .neq("user_id", context.userId)
      .order("criado_em");
    if (error) throw new Error("Erro ao carregar os pedidos de acesso.");
    const linhas = (data ?? []) as {
      id: number;
      user_id: string;
      nome: string;
      cargo: string;
      email: string;
      unidade_id: number;
      observacao: string | null;
      criado_em: string;
      unidades: { nome_da_praca: string } | null;
    }[];
    if (!linhas.length) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const comSenha = new Set<string>();
    await Promise.all(
      linhas.map(async (l) => {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(l.user_id);
        if (u?.user?.last_sign_in_at) comSenha.add(l.user_id);
      }),
    );
    return linhas.map((l) => ({
      id: l.id,
      userId: l.user_id,
      nome: l.nome,
      cargo: l.cargo,
      email: l.email,
      unidadeId: l.unidade_id,
      unidade: l.unidades?.nome_da_praca ?? "",
      observacao: l.observacao,
      criadoEm: l.criado_em,
      senhaDefinida: comSenha.has(l.user_id),
    }));
  });

async function carregarPedido(db: Cliente, id: number) {
  // Com o cliente de quem decide: se a RLS não devolve, não é da conta dele.
  const { data } = await db
    .from("acesso_pedidos")
    .select("id, user_id, nome, cargo, email, status")
    .eq("id", id)
    .maybeSingle();
  if (!data || data.status !== "pendente") throw new Error("Pedido não encontrado ou já decidido.");
  return data as { id: number; user_id: string; nome: string; cargo: string; email: string };
}

export const aprovarPedidoAcesso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pedidoId: number; area: string; unidades: number[]; paginas: string[] }) => {
    const pedidoId = Number(input?.pedidoId);
    const area = (input?.area ?? "").trim();
    const unidades = Array.from(new Set((input?.unidades ?? []).map(Number).filter(Number.isInteger)));
    const paginas = Array.from(new Set((input?.paginas ?? []).map((p) => p.trim()).filter(Boolean)));
    if (!Number.isInteger(pedidoId)) throw new Error("Pedido inválido.");
    if (!area) throw new Error("Área obrigatória.");
    if (!unidades.length) throw new Error("Escolha a unidade.");
    if (!paginas.length) throw new Error("Marque pelo menos uma página.");
    return { pedidoId, area, unidades, paginas };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as Cliente;
    const pedido = await carregarPedido(db, data.pedidoId);

    // O banco decide se pode: nível na área, unidade do sócio, conta em branco.
    const { error: addErr } = await db.rpc("acesso_adicionar_na_area", {
      _alvo: pedido.user_id,
      _area: data.area,
      _unidades: data.unidades,
      _chaves: data.paginas,
    });
    if (addErr) throw new Error(addErr.message || "Não foi possível liberar o acesso.");

    const adm = await admin();
    await adm
      .schema("public")
      .from("produto_acesso")
      .upsert(
        { user_id: pedido.user_id, produto: "ops", concedido_por: context.userId },
        { onConflict: "user_id,produto", ignoreDuplicates: true },
      );

    const { error: decErr } = await db.rpc("acesso_decidir_pedido", {
      _pedido: pedido.id,
      _status: "aprovado",
      _area: data.area,
      _motivo: null,
    });
    if (decErr) throw new Error(decErr.message || "O acesso foi dado, mas o pedido não fechou.");

    // Cadastro do Gente com o mesmo e-mail e sem login: liga agora, senão 1:1 e
    // feedback barram a pessoa em silêncio (ver memória do vínculo user_id).
    await adm
      .from("gente_pessoas")
      .update({ user_id: pedido.user_id })
      .ilike("email", pedido.email)
      .is("user_id", null);
    // O cargo informado só preenche o que o Gente não tem. Nunca sobrescreve
    // o cadastro do RH.
    await adm
      .from("gente_pessoas")
      .update({ cargo: pedido.cargo })
      .ilike("email", pedido.email)
      .is("cargo", null);

    const { data: areaRow } = await adm.from("areas").select("nome").eq("slug", data.area).maybeSingle();
    const envio = await enviarEmail({
      to: pedido.email,
      ...emailPedidoDecidido({
        nome: pedido.nome,
        aprovado: true,
        area: areaRow?.nome ?? null,
        motivo: null,
        link: `${appUrl()}/auth`,
      }),
    });
    return { ok: true, emailEnviado: envio.enviado };
  });

export const recusarPedidoAcesso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pedidoId: number; motivo?: string }) => {
    const pedidoId = Number(input?.pedidoId);
    if (!Number.isInteger(pedidoId)) throw new Error("Pedido inválido.");
    return { pedidoId, motivo: (input?.motivo ?? "").trim().slice(0, 500) || null };
  })
  .handler(async ({ data, context }) => {
    const db = context.supabase as Cliente;
    const pedido = await carregarPedido(db, data.pedidoId);
    const { error } = await db.rpc("acesso_decidir_pedido", {
      _pedido: pedido.id,
      _status: "recusado",
      _area: null,
      _motivo: data.motivo,
    });
    if (error) throw new Error(error.message || "Não foi possível recusar o pedido.");

    // A conta fica em branco (não entra em nada) e pode pedir de novo.
    await enviarEmail({
      to: pedido.email,
      ...emailPedidoDecidido({ nome: pedido.nome, aprovado: false, area: null, motivo: data.motivo, link: `${appUrl()}/auth` }),
    });
    return { ok: true };
  });
