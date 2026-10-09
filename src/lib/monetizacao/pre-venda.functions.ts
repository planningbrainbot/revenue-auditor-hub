// Leitura da tela Pré-venda com a sessão da pessoa: só as quatro RPCs do contrato de dados de 09/10/2026
// (`monetizacao/outputs/2026-10-09-pre-venda-v2/contrato-pre-venda.md`). Quem cria as funções e a migration é o agente de
// avaliação; aqui nada usa service role. Acesso (decisão 4B): todos que veem a Monetização veem tudo, sem trava por closer.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  mensagemDeErroPreVenda,
  normalizarAtrasados,
  normalizarAvaliacoes,
  normalizarFicha,
  normalizarRitmo,
  type Atrasado,
  type FichaLigacao,
  type LinhaAvaliacao,
  type LinhaRitmo,
} from "./pre-venda";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

const periodo = z.object({
  de: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

async function rpc(
  context: { supabase: unknown },
  nome: string,
  args: Record<string, unknown>,
  oQue: string,
) {
  const { data, error } = await (context.supabase as DB).schema("ops").rpc(nome, args);
  if (error) throw new Error(mensagemDeErroPreVenda(error, oQue));
  return data;
}

export async function lerRitmo(
  context: { supabase: unknown },
  p: { de: string; ate: string },
): Promise<LinhaRitmo[]> {
  const data = await rpc(
    context,
    "monetizacao_pre_venda_ritmo",
    { p_de: p.de, p_ate: p.ate },
    "o ritmo da pré-venda",
  );
  return normalizarRitmo(data);
}

export async function lerAtrasados(context: { supabase: unknown }): Promise<Atrasado[]> {
  const data = await rpc(
    context,
    "monetizacao_pre_venda_atrasados",
    {},
    "os atrasados da cadência",
  );
  return normalizarAtrasados(data);
}

export async function lerAvaliacoes(
  context: { supabase: unknown },
  p: { de: string; ate: string },
): Promise<LinhaAvaliacao[]> {
  const data = await rpc(
    context,
    "monetizacao_pre_venda_avaliacoes",
    { p_de: p.de, p_ate: p.ate },
    "as ligações avaliadas",
  );
  return normalizarAvaliacoes(data);
}

export async function lerAvaliacao(
  context: { supabase: unknown },
  deal: number,
): Promise<FichaLigacao> {
  const data = await rpc(
    context,
    "monetizacao_pre_venda_avaliacao",
    { p_deal: deal },
    "a ficha da ligação",
  );
  if (!data) throw new Error("Esta ligação não tem ficha.");
  return normalizarFicha(data);
}

export const carregarRitmoPreVenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(periodo)
  .handler(({ context, data }) => lerRitmo(context, data));

export const carregarAtrasadosPreVenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerAtrasados(context));

export const carregarAvaliacoesPreVenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(periodo)
  .handler(({ context, data }) => lerAvaliacoes(context, data));

export const carregarAvaliacaoPreVenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ deal: z.number().int().positive() }))
  .handler(({ context, data }) => lerAvaliacao(context, data.deal));
