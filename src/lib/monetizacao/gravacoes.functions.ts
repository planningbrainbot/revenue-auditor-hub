// Leitura da tela Gravações com a sessão da pessoa. A trava mora nas RPCs (migration 20261002180000): a lista só traz
// as reuniões que a pessoa pode ver, e a ficha confere de novo antes de ler a transcrição. Nada aqui usa service role.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { DetalheGravacao, ListaGravacoes } from "./gravacoes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;
type ErroRpc = { code?: string; message?: string } | null;

/** Mensagem para a tela: sem acesso, migration pendente ou falha de leitura. */
function mensagem(erro: ErroRpc, oQue: string): string {
  if (erro?.code === "42501")
    return erro.message?.includes("reunião")
      ? "Esta reunião não está no seu acesso."
      : "Seu acesso não inclui a Monetização.";
  if (erro?.code === "PGRST202" || erro?.code === "42883")
    return "A tela Gravações ainda não foi ativada no banco (migration 20261002180000 pendente).";
  return `Não foi possível ler ${oQue}. Atualize para tentar de novo.`;
}

export async function lerGravacoes(context: { supabase: unknown }): Promise<ListaGravacoes> {
  const { data, error } = await (context.supabase as DB)
    .schema("ops")
    .rpc("monetizacao_gravacoes_lista");
  if (error) throw new Error(mensagem(error, "as gravações"));
  return {
    admin: data?.admin === true,
    closers: Array.isArray(data?.closers) ? data.closers.map(Number) : [],
    reunioes: Array.isArray(data?.reunioes) ? data.reunioes : [],
  };
}

export const carregarGravacoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerGravacoes(context));

/** A chave de uma reunião registrada: `pedido-monet-<deal>-<AAAAMMDDTHHMM UTC>` (agenda.ts, eventId). */
export const EVENTO = /^pedido-monet-\d{1,12}-\d{8}T\d{4}$/;

export async function lerGravacao(
  context: { supabase: unknown },
  eventId: string,
): Promise<DetalheGravacao> {
  const { data, error } = await (context.supabase as DB)
    .schema("ops")
    .rpc("monetizacao_gravacao", { _event_id: eventId });
  if (error) throw new Error(mensagem(error, "a reunião"));
  return {
    ...data,
    falas: Array.isArray(data?.falas) ? data.falas : [],
    nomes: data?.nomes && typeof data.nomes === "object" ? data.nomes : {},
  } as DetalheGravacao;
}

export const carregarGravacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ event_id: z.string().regex(EVENTO) }))
  .handler(({ context, data }) => lerGravacao(context, data.event_id));
