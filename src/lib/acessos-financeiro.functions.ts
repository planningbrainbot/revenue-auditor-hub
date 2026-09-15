// Server functions do painel "Acessos do Financeiro".
//
// POR QUE EXISTE: até 15/09/2026 não havia NENHUM caminho de tela para
// `public.produto_acesso` — a porta dos três produtos era concedida só por SQL
// na mão. E o QUE a pessoa via dentro do cockpit vinha das chaves
// `view.brain_financeiro_*` da matriz de PAPÉIS: as oito estavam marcadas para
// dois papéis, e o papel `financeiro` tem oito pessoas. As oito recebiam as
// oito unidades, idênticas, e não havia onde diferenciar.
//
// O pedido do dono, verbatim: "quero dar acesso só à partners para o eliezek.
// ou só à Marox para o roney. Daí administro certinho." E: "a ana consiga
// administra acesso só da parte do financeiro. E não de todos os outros
// modulos."
//
// AS DUAS FONTES, e por que são duas:
//   · `public.produto_acesso`   — a PORTA. Em que produtos a pessoa entra.
//   · `ops.usuario_empresas` +
//     `ops.usuario_escopo.todas_empresas` — o RECORTE. Quais empresas do grupo
//     ela abre, e portanto quais unidades do cockpit.
// Separadas porque respondem perguntas diferentes: tirar alguém do Financeiro
// inteiro não é a mesma coisa que tirar MAROX dela.
//
// O RECORTE É O MODELO DO OPS, NÃO UM MEU. Eu havia começado uma tabela
// `public.produto_escopo` para isto e joguei fora: o dono do Ops subiu, no
// mesmo dia, `ops.usuario_escopo`/`usuario_empresas` com o mesmo propósito e
// granularidade mais fina (empresa, não unidade). Duas tabelas para a mesma
// pergunta é exatamente a redundância que este trabalho veio evitar.
//
// A TELA FALA EM UNIDADE, O BANCO GUARDA EMPRESA. É de propósito: o dono pediu
// "só à Marox", e MAROX é unidade do cockpit, não empresa. A tradução acontece
// aqui, contra `unidades_navegacao` do banco do cockpit — que é onde a regra é
// verdade.
//
// A GUARDA NÃO É `ensureAdmin`. É a chave `admin.acessos.financeiro`, pela
// `ops.can`. Se fosse por papel, só os dois admins entrariam — e o pedido era
// exatamente o contrário. Molde: `assertAdminIntegracoes` em
// integracoes-segredos.functions.ts.
//
// TODA ESCRITA USA service_role e confere quantas linhas mudaram. `RLS ligada +
// zero policy de escrita` não devolve erro: afeta zero linhas e a tela mostra
// sucesso. É o bug que fez a casa escrever `supabase-assert.ts`.
//
// E TODA ESCRITA SINCRONIZA DEPOIS. Sem isso a mudança não chega em ninguém: o
// guard do cockpit lê `app_metadata`, que só é reescrito quando alguém manda.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAffected } from "@/lib/supabase-assert";
import { enviarEmail } from "@/lib/email.server";
import { emailAcessoFinanceiro } from "@/lib/email-templates";

const PRODUTO = "financeiro";

/** Quem pode administrar isto. Não é papel — é chave, e `ops.can` a resolve. */
async function exigirAdminDoFinanceiro(supabase: any) {
  const { data, error } = await supabase.rpc("can", { _key: "admin.acessos.financeiro" });
  if (error) {
    console.error("[acessos-financeiro] can() falhou:", error);
    throw new Error("Erro de autorização.");
  }
  if (!data) throw new Error("Acesso negado: você não administra os acessos do Financeiro.");
}

function appUrl() {
  return (process.env.APP_URL || "https://planningbrain.com.br").replace(/\/+$/, "");
}

async function emailDoAtor(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any)
    .schema("public")
    .from("profiles")
    .select("email, nome")
    .eq("id", userId)
    .maybeSingle();
  return (data?.nome || data?.email || "a administração") as string;
}

export interface UnidadeDoCockpit {
  id: string;
  rotulo: string;
  tipo: string | null;
  /** Empresas do grupo que compõem esta unidade. É o que de fato é gravado. */
  empresaIds: string[];
}

export interface PessoaComAcesso {
  userId: string;
  email: string;
  nome: string | null;
  unidades: string[];
  /** `true` quando a pessoa está marcada como "vê todas as empresas". */
  todas: boolean;
  papeis: string[];
}

/**
 * As unidades do cockpit, cada uma com as empresas que a compõem.
 *
 * Vem do BANCO DO COCKPIT, não daqui. Escrever a lista neste arquivo foi
 * exatamente o que criou o defeito do NEO: a unidade nasceu em
 * `unidades_navegacao` com nove telas habilitadas e nunca entrou nas cópias.
 *
 * `unidades_navegacao.grupos` casa com `empresas.grupo_apuracao`; a coluna
 * `empresas`, quando preenchida, RESTRINGE (é o caso da EXPANSÃO, que é o grupo
 * EXPANSÃO limitado à PARTNERS).
 */
async function unidadesComEmpresas(): Promise<UnidadeDoCockpit[]> {
  const { getFinanceiroAdmin } = await import(
    "@/integrations/supabase/client.financeiro.server"
  );
  const fin = getFinanceiroAdmin() as any;
  if (!fin) return [];

  const [navsRes, empsRes] = await Promise.all([
    fin.from("unidades_navegacao").select("id, rotulo, tipo, grupos, empresas, ordem")
      .eq("ativo", true).order("ordem", { ascending: true, nullsFirst: false }),
    fin.from("empresas").select("id, apelido, grupo_apuracao").eq("ativa", true),
  ]);
  const navs = (navsRes?.data ?? []) as any[];
  const emps = (empsRes?.data ?? []) as any[];

  return navs.map((u) => ({
    id: u.id as string,
    rotulo: (u.rotulo ?? u.id) as string,
    tipo: (u.tipo ?? null) as string | null,
    empresaIds: emps
      .filter(
        (e) =>
          (u.grupos ?? []).includes(e.grupo_apuracao ?? "") &&
          (!u.empresas?.length || u.empresas.includes(e.apelido)),
      )
      .map((e) => e.id as string),
  }));
}

export const listarAcessosFinanceiro = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdminDoFinanceiro(context.supabase as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const [unidades, acessosRes, escopoRes, empresasRes, perfisRes, papeisRes] =
      await Promise.all([
        unidadesComEmpresas(),
        db.schema("public").from("produto_acesso").select("user_id").eq("produto", PRODUTO),
        db.from("usuario_escopo").select("user_id, todas_empresas"),
        db.from("usuario_empresas").select("user_id, empresa_id"),
        db.schema("public").from("profiles").select("id, email, nome"),
        db.from("user_roles").select("user_id, role"),
      ]);

    const ids = new Set(((acessosRes?.data ?? []) as any[]).map((a) => a.user_id as string));
    const todasDe = new Map(
      ((escopoRes?.data ?? []) as any[]).map((e) => [e.user_id as string, Boolean(e.todas_empresas)]),
    );
    const empresasDe = new Map<string, Set<string>>();
    for (const l of (empresasRes?.data ?? []) as any[]) {
      const s = empresasDe.get(l.user_id) ?? new Set<string>();
      s.add(l.empresa_id);
      empresasDe.set(l.user_id, s);
    }
    const perfil = new Map(((perfisRes?.data ?? []) as any[]).map((p) => [p.id as string, p]));
    const papeis = new Map<string, string[]>();
    for (const r of (papeisRes?.data ?? []) as any[]) {
      papeis.set(r.user_id, [...(papeis.get(r.user_id) ?? []), r.role]);
    }

    const pessoas: PessoaComAcesso[] = [...ids].map((id) => {
      const todas = todasDe.get(id) ?? false;
      const minhas = empresasDe.get(id) ?? new Set<string>();
      // Uma unidade aparece quando a pessoa tem PELO MENOS UMA das empresas
      // dela — é o mesmo critério que o cockpit aplica ao emitir a sessão.
      const unids = todas
        ? unidades.map((u) => u.id)
        : unidades.filter((u) => u.empresaIds.some((e) => minhas.has(e))).map((u) => u.id);
      const p = perfil.get(id);
      return {
        userId: id,
        email: (p?.email ?? "(sem e-mail)") as string,
        nome: (p?.nome ?? null) as string | null,
        unidades: unids,
        todas,
        papeis: papeis.get(id) ?? [],
      };
    });
    pessoas.sort((a, b) => a.email.localeCompare(b.email));

    return { unidades, pessoas };
  });

/** Candidatas: quem tem conta no Ops e ainda NÃO entra no Financeiro. */
export const listarCandidatosFinanceiro = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await exigirAdminDoFinanceiro(context.supabase as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [perfis, acessos] = await Promise.all([
      db.schema("public").from("profiles").select("id, email, nome"),
      db.schema("public").from("produto_acesso").select("user_id").eq("produto", PRODUTO),
    ]);
    const jaTem = new Set(((acessos?.data ?? []) as any[]).map((a) => a.user_id as string));
    return {
      candidatos: ((perfis?.data ?? []) as any[])
        .filter((p) => !jaTem.has(p.id))
        .map((p) => ({ userId: p.id as string, email: p.email as string, nome: p.nome as string | null }))
        .sort((a, b) => (a.email ?? "").localeCompare(b.email ?? "")),
    };
  });

export const definirEscoposFinanceiro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; unidades: string[]; avisarPorEmail?: boolean }) => {
    const userId = (input?.userId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Pessoa inválida.");
    const unidades = Array.from(new Set((input?.unidades ?? []).map((e) => String(e).trim())))
      .filter(Boolean);
    return { userId, unidades, avisarPorEmail: Boolean(input?.avisarPorEmail) };
  })
  .handler(async ({ data, context }) => {
    await exigirAdminDoFinanceiro(context.supabase as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    const unidades = await unidadesComEmpresas();
    const validas = new Set(unidades.map((u) => u.id));
    const invalidas = data.unidades.filter((e) => !validas.has(e));
    if (invalidas.length) {
      throw new Error(
        `Unidade(s) que não existem no cockpit: ${invalidas.join(", ")}. ` +
          `As que existem hoje: ${[...validas].join(", ")}.`,
      );
    }

    // A porta primeiro: dar unidade a quem não entra no produto é conceder nada.
    const porta = await db.schema("public").from("produto_acesso")
      .upsert({ user_id: data.userId, produto: PRODUTO, concedido_por: context.userId },
              { onConflict: "user_id,produto" })
      .select("user_id");
    assertAffected(porta, "Não foi possível conceder a porta do Financeiro.");

    // TODAS as unidades vira a FLAG, não 16 linhas. É o que o modelo do Ops
    // manda: `todas_empresas` responde "vê tudo" numa linha só, e mantém a
    // resposta certa quando uma empresa nova é cadastrada amanhã. Gravar a
    // lista inteira faria a pessoa PERDER a empresa nova sem ninguém mexer.
    const tudo = data.unidades.length === unidades.length;
    const empresaIds = tudo
      ? []
      : Array.from(
          new Set(
            unidades.filter((u) => data.unidades.includes(u.id)).flatMap((u) => u.empresaIds),
          ),
        );

    const flag = await db.from("usuario_escopo")
      .upsert({ user_id: data.userId, todas_empresas: tudo }, { onConflict: "user_id" })
      .select("user_id");
    assertAffected(flag, "Não foi possível gravar o escopo da pessoa.");

    // Substituição inteira, não diferencial: um merge deixaria empresa antiga
    // sobrevivendo a um desmarque, que é a forma mais silenciosa de acesso
    // indevido.
    const { error: delErr } = await db.from("usuario_empresas").delete().eq("user_id", data.userId);
    if (delErr) throw new Error(delErr.message);
    if (empresaIds.length) {
      const { error: insErr } = await db.from("usuario_empresas")
        .insert(empresaIds.map((empresa_id) => ({ user_id: data.userId, empresa_id })));
      if (insErr) throw new Error(insErr.message);
    }

    const { data: perfil } = await db.schema("public").from("profiles")
      .select("email, nome").eq("id", data.userId).maybeSingle();

    let emailEnviado = false;
    if (data.avisarPorEmail && perfil?.email) {
      const rotulo = new Map(unidades.map((u) => [u.id, u.rotulo]));
      const msg = emailAcessoFinanceiro({
        nome: perfil.nome ?? perfil.email,
        email: perfil.email,
        link: `${appUrl()}/financeiro`,
        unidades: data.unidades.map((e) => rotulo.get(e) ?? e),
        concedidoPor: await emailDoAtor(context.userId),
      });
      emailEnviado = (await enviarEmail({ to: perfil.email, ...msg })).enviado;
    }

    // Empurra a concessão para o app_metadata do cockpit AGORA. Sem isto ela só
    // valeria na próxima navegação da pessoa pelo Ops — e quem acabou de
    // conceder ficaria olhando uma tela que não mudou.
    if (perfil?.email) {
      const { aplicarConcessaoNoFinanceiro } = await import("@/lib/sessoes-irmas.functions");
      await aplicarConcessaoNoFinanceiro(data.userId, perfil.email);
    }

    return { userId: data.userId, unidades: data.unidades, emailEnviado };
  });

export const revogarAcessoFinanceiro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => {
    const userId = (input?.userId ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Pessoa inválida.");
    return { userId };
  })
  .handler(async ({ data, context }) => {
    await exigirAdminDoFinanceiro(context.supabase as any);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    // NÃO mexo em `usuario_escopo.todas_empresas` nem em `usuario_unidades`:
    // eles valem para o OPS também, e zerá-los aqui tiraria da pessoa o acesso
    // à rede do Ops, que ninguém pediu. O que tiro é a PORTA do Financeiro.
    const { error } = await db.schema("public").from("produto_acesso")
      .delete().eq("user_id", data.userId).eq("produto", PRODUTO);
    if (error) throw new Error(error.message);

    // A revogação só vale quando o app_metadata do outro lado é reescrito — o
    // guard do cockpit lê ELE, não esta tabela. Sem esta chamada a pessoa
    // continuaria entrando por tempo indefinido.
    const { data: perfil } = await db.schema("public").from("profiles")
      .select("email").eq("id", data.userId).maybeSingle();
    const { aplicarConcessaoNoFinanceiro } = await import("@/lib/sessoes-irmas.functions");
    const sinc = perfil?.email
      ? await aplicarConcessaoNoFinanceiro(data.userId, perfil.email)
      : { ok: false as const };

    return { userId: data.userId, sincronizado: sinc.ok };
  });
