// Leitura da tela Pré-venda com a sessão da pessoa: só as quatro RPCs do contrato de dados de 09/10/2026
// (`monetizacao/outputs/2026-10-09-pre-venda-v2/contrato-pre-venda.md`). Quem cria as funções e a migration é o agente de
// avaliação; aqui nada usa service role. Acesso (decisão 4B): todos que veem a Monetização veem tudo, sem trava por closer.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  mensagemDeErroPreVenda,
  normalizarAtividades,
  normalizarAtrasados,
  normalizarAvaliacoes,
  normalizarFicha,
  normalizarRitmo,
  todasAsPaginas,
  type Atrasado,
  type AtividadePreVenda,
  type FichaLigacao,
  type LinhaAvaliacao,
  type LinhaRitmo,
} from "./pre-venda";
import {
  normalizarCadencias,
  normalizarSugestoes,
  type AtividadeCadencia,
  type SugestaoJev,
} from "./hoje-pre-venda";

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

/** Cada atividade de cadência por trás dos números do Ritmo, para a aba lateral (28/10/2026). */
export async function lerAtividades(
  context: { supabase: unknown },
  p: { de: string; ate: string },
): Promise<AtividadePreVenda[]> {
  // Em páginas, ordenadas por todas as colunas que separam uma atividade da outra: o mesmo card pode estar em duas
  // cadências (voltou para a fila), então empresa + vencimento + atividade não basta, e a ordem tem de ser a mesma em
  // cada chamada para nenhuma linha cair nem se repetir entre as páginas.
  const linhas = await todasAsPaginas(async (de, ate) => {
    const { data, error } = await (context.supabase as DB)
      .schema("ops")
      .rpc("monetizacao_pre_venda_atividades", { p_de: p.de, p_ate: p.ate })
      .order("deal_id")
      .order("vence")
      .order("feita_em")
      .order("atividade")
      .order("user_id")
      .order("feita")
      .order("automatica")
      .order("cadencia_ativa")
      .range(de, ate);
    if (error) throw new Error(mensagemDeErroPreVenda(error, "as atividades da cadência"));
    return Array.isArray(data) ? data : [];
  });
  return normalizarAtividades(linhas);
}

/** As atividades das cadências ativas, para a visão Hoje (14/10/2026). */
export async function lerCadencias(context: { supabase: unknown }): Promise<AtividadeCadencia[]> {
  const data = await rpc(
    context,
    "monetizacao_pre_venda_cadencias",
    {},
    "as atividades da cadência",
  );
  return normalizarCadencias(data);
}

/** Próximo passo sugerido pelo Jev para os cards parados da reta final (14/10/2026). */
export async function lerSugestoes(context: { supabase: unknown }): Promise<SugestaoJev[]> {
  const data = await rpc(
    context,
    "monetizacao_pre_venda_proximo_passo",
    {},
    "as sugestões de próximo passo",
  );
  return normalizarSugestoes(data);
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

export const carregarAtividadesPreVenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(periodo)
  .handler(({ context, data }) => lerAtividades(context, data));

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

export const carregarCadenciasPreVenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerCadencias(context));

export const carregarSugestoesPreVenda = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerSugestoes(context));
