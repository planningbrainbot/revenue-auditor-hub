import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FichaBruta, IndicePlataforma } from "./consultoria-ficha";

// Leituras da aba "Buscar empresa" sobre o espelho da plataforma da Consultoria (migration 20261016120000), com a
// sessão da pessoa. Os dois RPCs conferem `view.monetizacao` e todas as unidades; a ficha só devolve faturas e
// recebimentos da Consultoria a quem passa na porta do Financeiro.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

function falha(rotulo: string, error: { code?: string; message?: string }) {
  if (error.code === "42501")
    return new Error(
      error.message?.startsWith("Seu acesso")
        ? error.message
        : "Seu acesso não inclui a Monetização (view.monetizacao).",
    );
  console.error(`[${rotulo}]`, error);
  return new Error(`A leitura da plataforma da Consultoria falhou${error.code ? ` (código ${error.code})` : ""}.`);
}

export interface PedidoFicha {
  clienteIds: string[];
  cnpjs: string[];
  nomes: string[];
}

export const carregarFichaConsultoria = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PedidoFicha) => ({
    clienteIds: (d?.clienteIds ?? []).map(String).slice(0, 20),
    cnpjs: (d?.cnpjs ?? []).map((c) => String(c).replace(/\D/g, "")).filter(Boolean).slice(0, 50),
    nomes: (d?.nomes ?? []).map((n) => String(n).slice(0, 200)).slice(0, 30),
  }))
  .handler(async ({ context, data }): Promise<FichaBruta> => {
    const db = context.supabase as DB;
    const { data: r, error } = await db.schema("ops").rpc("consultoria_empresa_ficha", {
      p_cliente_ids: data.clienteIds,
      p_cnpjs: data.cnpjs,
      p_nomes: data.nomes,
    });
    if (error) throw falha("consultoria-ficha", error);
    return r as FichaBruta;
  });

export const carregarIndicePlataforma = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<IndicePlataforma> => {
    const db = context.supabase as DB;
    const { data, error } = await db.schema("ops").rpc("consultoria_plataforma_indice");
    if (error) throw falha("consultoria-indice", error);
    return data as IndicePlataforma;
  });
