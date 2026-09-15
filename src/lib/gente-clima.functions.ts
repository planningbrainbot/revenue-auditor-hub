import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enviarEmail } from "@/lib/email.server";

// Pesquisa de clima e eNPS (migration 55, no repo do wiki).
//
// O ANONIMATO É O PRODUTO, e ele é garantido pelo banco, não por esta camada:
// `gente_respostas` não tem vínculo com pessoa e sua policy de SELECT é
// `using (false)`. Nem o admin lê linha. Tudo que esta tela mostra sai das views
// agregadas, que suprimem qualquer corte com menos de 5 respostas.
//
// O TOKEN NUNCA VAI PARA O NAVEGADOR. O convite é montado e enviado aqui, no
// servidor, e o que volta para a tela é só quantos saíram. Quem administra a
// rodada não precisa (e não deve) poder abrir o link de ninguém.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

export interface PesquisaRow {
  id: number;
  titulo: string;
  rodada: string | null;
  status: string;
  criadaEm: string;
}

export interface PerguntaRow {
  id: number;
  ordem: number;
  enunciado: string;
  tipo: string;
  ehEnps: boolean;
}

export interface ResultadoRow {
  perguntaId: number;
  enunciado: string;
  ehEnps: boolean;
  respostas: number;
  media: number | null;
  promotores: number;
  detratores: number;
  enps: number | null;
}

export interface CoberturaRow {
  unidade: string | null;
  enviados: number;
  respondidos: number;
  taxa: number | null;
}

export interface UnidadeResultadoRow {
  unidade: string;
  perguntaId: number;
  enunciado: string;
  ehEnps: boolean;
  respostas: number;
  media: number | null;
  enps: number | null;
}

export interface ClimaResult {
  podeVer: boolean;
  podeGerir: boolean;
  pesquisas: PesquisaRow[];
  pesquisaId: number | null;
  perguntas: PerguntaRow[];
  resultado: ResultadoRow[];
  porUnidade: UnidadeResultadoRow[];
  cobertura: CoberturaRow[];
  comentarios: { perguntaId: number; enunciado: string; comentario: string }[];
}

async function chaves(supabase: Cliente, userId: string): Promise<string[]> {
  const r = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((r?.data ?? []) as { role: string }[]).map((x) => x.role);
  if (!roles.length) return [];
  const p = await supabase
    .from("role_permissions")
    .select("permission_key")
    .in("role", roles)
    .eq("allowed", true);
  return ((p?.data ?? []) as { permission_key: string }[]).map((x) => x.permission_key);
}

export const listClima = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input?: { pesquisaId?: number }) => ({ pesquisaId: input?.pesquisaId ?? null }))
  .handler(async ({ data, context }): Promise<ClimaResult> => {
    const supabase = context.supabase as Cliente;
    const ks = await chaves(supabase, context.userId);
    const base: ClimaResult = {
      podeVer: ks.includes("view.gente.clima"),
      podeGerir: ks.includes("manage.gente.clima"),
      pesquisas: [],
      pesquisaId: null,
      perguntas: [],
      resultado: [],
      porUnidade: [],
      cobertura: [],
      comentarios: [],
    };
    if (!base.podeVer) return base;

    const ps = await supabase
      .from("gente_pesquisas")
      .select("id,titulo,rodada,status,created_at")
      .order("created_at", { ascending: false });
    const pesquisas: PesquisaRow[] = (
      (ps?.data ?? []) as {
        id: number;
        titulo: string;
        rodada: string | null;
        status: string;
        created_at: string;
      }[]
    ).map((p) => ({
      id: p.id,
      titulo: p.titulo,
      rodada: p.rodada,
      status: p.status,
      criadaEm: p.created_at,
    }));

    const alvo = data.pesquisaId ?? pesquisas[0]?.id ?? null;
    if (!alvo) return { ...base, pesquisas };

    const [qs, res, uni, cob, com] = await Promise.all([
      supabase
        .from("gente_pesquisa_perguntas")
        .select("id,ordem,enunciado,tipo,eh_enps")
        .eq("pesquisa_id", alvo)
        .order("ordem"),
      supabase.from("v_gente_clima_por_pergunta").select("*").eq("pesquisa_id", alvo),
      supabase.from("v_gente_clima_por_unidade").select("*").eq("pesquisa_id", alvo),
      supabase.from("v_gente_clima_cobertura").select("*").eq("pesquisa_id", alvo),
      supabase.from("v_gente_clima_comentarios").select("*").eq("pesquisa_id", alvo),
    ]);

    return {
      ...base,
      pesquisas,
      pesquisaId: alvo,
      perguntas: (
        (qs?.data ?? []) as {
          id: number;
          ordem: number;
          enunciado: string;
          tipo: string;
          eh_enps: boolean;
        }[]
      ).map((q) => ({
        id: q.id,
        ordem: q.ordem,
        enunciado: q.enunciado,
        tipo: q.tipo,
        ehEnps: q.eh_enps,
      })),
      resultado: (
        (res?.data ?? []) as {
          pergunta_id: number;
          enunciado: string;
          eh_enps: boolean;
          respostas: number;
          media: number | null;
          promotores: number;
          detratores: number;
          enps: number | null;
        }[]
      ).map((r) => ({
        perguntaId: r.pergunta_id,
        enunciado: r.enunciado,
        ehEnps: r.eh_enps,
        respostas: Number(r.respostas ?? 0),
        media: r.media == null ? null : Number(r.media),
        promotores: Number(r.promotores ?? 0),
        detratores: Number(r.detratores ?? 0),
        enps: r.enps == null ? null : Number(r.enps),
      })),
      porUnidade: (
        (uni?.data ?? []) as {
          unidade: string;
          pergunta_id: number;
          enunciado: string;
          eh_enps: boolean;
          respostas: number;
          media: number | null;
          enps: number | null;
        }[]
      ).map((u) => ({
        unidade: u.unidade,
        perguntaId: u.pergunta_id,
        enunciado: u.enunciado,
        ehEnps: u.eh_enps,
        respostas: Number(u.respostas ?? 0),
        media: u.media == null ? null : Number(u.media),
        enps: u.enps == null ? null : Number(u.enps),
      })),
      cobertura: (
        (cob?.data ?? []) as {
          unidade: string | null;
          enviados: number;
          respondidos: number;
          taxa: number | null;
        }[]
      ).map((c) => ({
        unidade: c.unidade,
        enviados: Number(c.enviados ?? 0),
        respondidos: Number(c.respondidos ?? 0),
        taxa: c.taxa == null ? null : Number(c.taxa),
      })),
      comentarios: (
        (com?.data ?? []) as { pergunta_id: number; enunciado: string; comentario: string }[]
      ).map((c) => ({
        perguntaId: c.pergunta_id,
        enunciado: c.enunciado,
        comentario: c.comentario,
      })),
    };
  });

export const criarPesquisa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      titulo: string;
      rodada?: string;
      perguntas: { enunciado: string; tipo: string; ehEnps: boolean }[];
    }) => {
      const titulo = (input?.titulo ?? "").trim();
      if (titulo.length < 3) throw new Error("Dê um título à rodada.");
      const perguntas = (input?.perguntas ?? []).filter((p) => (p.enunciado ?? "").trim());
      if (!perguntas.length) throw new Error("Inclua ao menos uma pergunta.");
      if (perguntas.filter((p) => p.ehEnps).length > 1) {
        throw new Error("Só uma pergunta pode ser a de eNPS.");
      }
      return { titulo, rodada: input.rodada ?? null, perguntas };
    },
  )
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { data: criada, error } = await supabase
      .from("gente_pesquisas")
      .insert({ titulo: data.titulo, rodada: data.rodada, status: "rascunho" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const linhas = data.perguntas.map((p, i) => ({
      pesquisa_id: criada.id,
      ordem: i + 1,
      enunciado: p.enunciado.trim(),
      tipo: p.tipo,
      eh_enps: !!p.ehEnps,
    }));
    const { error: e2 } = await supabase.from("gente_pesquisa_perguntas").insert(linhas);
    if (e2) throw new Error(e2.message);
    return { id: criada.id as number };
  });

export const mudarStatusPesquisa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pesquisaId: number; status: string }) => {
    if (!["rascunho", "aberta", "encerrada"].includes(input?.status)) {
      throw new Error("Status inválido.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const { error } = await supabase
      .from("gente_pesquisas")
      .update({ status: data.status })
      .eq("id", data.pesquisaId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const dispararConvites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pesquisaId: number }) => {
    if (!input?.pesquisaId) throw new Error("Escolha a rodada.");
    return input;
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;

    const { data: pesquisa } = await supabase
      .from("gente_pesquisas")
      .select("id,titulo,status")
      .eq("id", data.pesquisaId)
      .maybeSingle();
    if (!pesquisa) throw new Error("Rodada não encontrada.");
    if (pesquisa.status !== "aberta") {
      throw new Error("Abra a rodada antes de disparar: fechada, ninguém consegue responder.");
    }

    const { data: pessoas } = await supabase
      .from("gente_pessoas")
      .select("id,nome_completo,email")
      .eq("status", "ativo");
    const elegiveis = (
      (pessoas ?? []) as { id: number; nome_completo: string; email: string | null }[]
    ).filter((p) => p.email);

    // Convite é por pessoa e por rodada: o unique da tabela impede duplicar,
    // então reenviar não cria um segundo token para a mesma pessoa.
    const { data: jaTem } = await supabase
      .from("gente_pesquisa_envios")
      .select("pessoa_id")
      .eq("pesquisa_id", data.pesquisaId);
    const existentes = new Set(((jaTem ?? []) as { pessoa_id: number }[]).map((e) => e.pessoa_id));

    const novos = elegiveis.filter((p) => !existentes.has(p.id));
    if (novos.length) {
      const { error } = await supabase
        .from("gente_pesquisa_envios")
        .insert(
          novos.map((p) => ({ pesquisa_id: data.pesquisaId, pessoa_id: p.id, canal: "email" })),
        );
      if (error) throw new Error(error.message);
    }

    // Relê para pegar o token gerado pelo banco. Ele fica aqui dentro: o que
    // volta para a tela é contagem, nunca link.
    const { data: envios } = await supabase
      .from("gente_pesquisa_envios")
      .select("id,pessoa_id,token,enviado_em,respondido_em")
      .eq("pesquisa_id", data.pesquisaId);

    const porPessoa = new Map(elegiveis.map((p) => [p.id, p]));
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    let enviados = 0;
    let falhas = 0;

    for (const e of (envios ?? []) as {
      id: number;
      pessoa_id: number;
      token: string;
      enviado_em: string | null;
      respondido_em: string | null;
    }[]) {
      if (e.enviado_em || e.respondido_em) continue;
      const pessoa = porPessoa.get(e.pessoa_id);
      if (!pessoa?.email) continue;

      const link = `${supabaseUrl}/functions/v1/gente-clima-responder?t=${e.token}`;
      const primeiroNome = pessoa.nome_completo.split(" ")[0];
      const r = await enviarEmail({
        to: pessoa.email,
        subject: `${pesquisa.titulo}`,
        text:
          `Oi, ${primeiroNome}.\n\n` +
          `Sua resposta é anônima: ela é gravada sem nenhum vínculo com o seu nome, e nem ` +
          `quem administra o sistema consegue ver resposta individual. O resultado só aparece ` +
          `agrupado, e qualquer recorte com menos de 5 respostas fica oculto.\n\n` +
          `O link abaixo é pessoal e aceita uma resposta só:\n${link}\n`,
        html:
          `<p>Oi, ${primeiroNome}.</p>` +
          `<p><b>Sua resposta é anônima.</b> Ela é gravada sem nenhum vínculo com o seu nome, e nem ` +
          `quem administra o sistema consegue ver resposta individual. O resultado só aparece ` +
          `agrupado, e qualquer recorte com menos de 5 respostas fica oculto.</p>` +
          `<p><a href="${link}">Responder a pesquisa</a></p>` +
          `<p style="color:#666;font-size:13px">O link é pessoal e aceita uma resposta só.</p>`,
      });

      if (r.enviado) {
        enviados++;
        await supabase
          .from("gente_pesquisa_envios")
          .update({ enviado_em: new Date().toISOString() })
          .eq("id", e.id);
      } else {
        falhas++;
      }
    }

    return {
      criados: novos.length,
      enviados,
      falhas,
      semEmail: ((pessoas ?? []) as unknown[]).length - elegiveis.length,
    };
  });
