import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FiltrosSchema } from "./filtros";
import { VisaoDefinicaoSchema, executarVisao } from "./spec";
import type { BlocoResolvido, VisaoDefinicao } from "./spec";
import type { Filtros } from "./filtros";
import { criarEntrada } from "./metricas";

// Histórico privado e visões salvas do "Perguntar ao Brain". Tudo com a sessão da pessoa: a RLS
// "só o dono" (migration 20260925000000) decide o que existe, e a área é conferida antes de ler.
// Uma visão guarda a definição; abrir executa as consultas de novo com a permissão de agora.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
const Id = z.object({ id: z.string().uuid() });

async function comAcesso(context: { supabase: unknown; userId: string }) {
  const { conferirAcesso } = await import("./carga.server");
  const acesso = await conferirAcesso(context);
  return { db: context.supabase as Db, acesso };
}

export interface VisaoExecutada {
  definicao: VisaoDefinicao;
  blocos: BlocoResolvido[];
  filtros: Filtros;
  consultadoEm: string;
}

async function rodar(
  context: { supabase: unknown; userId: string },
  definicao: unknown,
  controles?: Filtros,
): Promise<VisaoExecutada> {
  const { acesso } = await comAcesso(context);
  const { fonteDaPessoa } = await import("./carga.server");
  const fonte = await fonteDaPessoa(context, acesso);
  const r = executarVisao(criarEntrada(fonte), definicao, controles);
  return { ...r, consultadoEm: fonte.agora };
}

export const listarConversas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await comAcesso(context);
    const { data, error } = await db
      .from("cockpit_conversas")
      .select("id, titulo, atualizada_em")
      .order("atualizada_em", { ascending: false })
      .limit(50);
    if (error) throw new Error("Não foi possível ler o histórico.");
    return (data ?? []) as { id: string; titulo: string; atualizada_em: string }[];
  });

export const lerConversa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(Id)
  .handler(async ({ context, data }) => {
    const { db } = await comAcesso(context);
    const conv = await db
      .from("cockpit_conversas")
      .select("id, titulo")
      .eq("id", data.id)
      .maybeSingle();
    if (conv.error || !conv.data) throw new Error("Conversa não encontrada.");
    const { data: msgs, error } = await db
      .from("cockpit_mensagens")
      .select("id, papel, texto, visao, metadados, criada_em")
      .eq("conversa_id", data.id)
      .order("criada_em", { ascending: true })
      .limit(200);
    if (error) throw new Error("Não foi possível ler a conversa.");
    return {
      id: conv.data.id as string,
      titulo: conv.data.titulo as string,
      mensagens: (msgs ?? []) as {
        id: string;
        papel: "usuario" | "assistente";
        texto: string;
        visao: VisaoDefinicao | null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON do banco
        metadados: Record<string, any>;
        criada_em: string;
      }[],
    };
  });

export const excluirConversa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(Id)
  .handler(async ({ context, data }) => {
    const { db } = await comAcesso(context);
    const { error, count } = await db
      .from("cockpit_conversas")
      .delete({ count: "exact" })
      .eq("id", data.id);
    if (error || !count) throw new Error("Conversa não encontrada.");
    return { ok: true };
  });

/** Refaz uma visão (do histórico, salva ou com controles alterados) com a permissão de agora. */
export const executarVisaoFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({ definicao: VisaoDefinicaoSchema, controles: FiltrosSchema.optional() }),
  )
  .handler(({ context, data }) => rodar(context, data.definicao, data.controles));

export const listarVisoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { db } = await comAcesso(context);
    const { data, error } = await db
      .from("cockpit_visoes")
      .select("id, nome, atualizada_em, conversa_id")
      .order("atualizada_em", { ascending: false })
      .limit(100);
    if (error) throw new Error("Não foi possível ler as visões salvas.");
    return (data ?? []) as {
      id: string;
      nome: string;
      atualizada_em: string;
      conversa_id: string | null;
    }[];
  });

export const salvarVisao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      nome: z.string().trim().min(1).max(120),
      definicao: VisaoDefinicaoSchema,
      conversaId: z.string().uuid().nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { db } = await comAcesso(context);
    const { data: linha, error } = await db
      .from("cockpit_visoes")
      .insert({ nome: data.nome, definicao: data.definicao, conversa_id: data.conversaId ?? null })
      .select("id, nome")
      .single();
    if (error) throw new Error("Não foi possível salvar a visão.");
    return linha as { id: string; nome: string };
  });

export const renomearVisao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), nome: z.string().trim().min(1).max(120) }))
  .handler(async ({ context, data }) => {
    const { db } = await comAcesso(context);
    const { error, count } = await db
      .from("cockpit_visoes")
      .update({ nome: data.nome, atualizada_em: new Date().toISOString() }, { count: "exact" })
      .eq("id", data.id);
    if (error || !count) throw new Error("Visão não encontrada.");
    return { ok: true };
  });

export const excluirVisao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(Id)
  .handler(async ({ context, data }) => {
    const { db } = await comAcesso(context);
    const { error, count } = await db
      .from("cockpit_visoes")
      .delete({ count: "exact" })
      .eq("id", data.id);
    if (error || !count) throw new Error("Visão não encontrada.");
    return { ok: true };
  });

/** Abre uma visão salva: lê a definição (RLS) e roda as consultas de novo, agora. */
export const abrirVisao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(Id)
  .handler(async ({ context, data }) => {
    const { db } = await comAcesso(context);
    const { data: v, error } = await db
      .from("cockpit_visoes")
      .select("id, nome, definicao, atualizada_em")
      .eq("id", data.id)
      .maybeSingle();
    if (error || !v) throw new Error("Visão não encontrada.");
    const executada = await rodar(context, v.definicao);
    return {
      id: v.id as string,
      nome: v.nome as string,
      salvaEm: v.atualizada_em as string,
      ...executada,
    };
  });
