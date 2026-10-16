import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { FunilBruto, Resultado } from "./consultoria-funil";

// Leituras e gravação das visões Funil e Fila de cobrança da tela Consultoria (migration 20261016190000), com a sessão
// da pessoa. O RPC confere `view.monetizacao` e todas as unidades; faturado e recebido só saem com a porta do Financeiro.

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
  return new Error(`A leitura da Consultoria falhou${error.code ? ` (código ${error.code})` : ""}.`);
}

export const carregarFunilConsultoria = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FunilBruto> => {
    const db = context.supabase as DB;
    const { data, error } = await db.schema("ops").rpc("consultoria_funil_painel");
    if (error) throw falha("consultoria-funil", error);
    return data as FunilBruto;
  });

export interface RegistroContato {
  clienteId: string;
  resultado: Resultado;
  nota: string;
  proximo: string | null;
}

export const registrarContatoFila = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: RegistroContato) => ({
    clienteId: String(d?.clienteId ?? "").slice(0, 60),
    resultado: d?.resultado,
    nota: String(d?.nota ?? "").slice(0, 2000),
    proximo: typeof d?.proximo === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.proximo) ? d.proximo : null,
  }))
  .handler(async ({ context, data }): Promise<{ id: string }> => {
    const db = context.supabase as DB;
    const { data: r, error } = await db.schema("ops").rpc("consultoria_fila_registrar", {
      p_cliente_id: data.clienteId,
      p_resultado: data.resultado,
      p_nota: data.nota,
      p_proximo_contato_em: data.proximo,
    });
    if (error) {
      if (error.code === "42501" || error.code === "22023") throw new Error(error.message);
      console.error("[consultoria-fila]", error);
      throw new Error(`O registro não foi salvo${error.code ? ` (código ${error.code})` : ""}.`);
    }
    return r as { id: string };
  });
