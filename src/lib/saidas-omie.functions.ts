import { createServerFn } from "@tanstack/react-start";
import { AREA_BI_FINANCEIRO } from "@/lib/bi-financeiro-acesso";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// Saídas da Planning Partners: os títulos a pagar do Omie pela data de vencimento.
//
// Quem monta é o `tools/saidas_omie.py` (repo ai-projects-scripts): baixa `ListarContasPagar`,
// `ListarCategorias`, `ListarClientes` e o a receber em aberto, e grava o payload em
// `ops.saidas_omie` (uma linha, id=1). A tela só lê essa linha, depois de conferir a área
// BI Financeiro, como a página que esta substituiu (22/10/2026).

/** [vencimento, emissão, status, valor, cat, forn, depto, cc, parcela, código do lançamento] */
export type LinhaSaida = [
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface SaidasOmie {
  meta: {
    conta: string;
    regua: string;
    gerado_em: string;
    hoje: string;
    titulos: number;
    linhas: number;
    de: string;
    ate: string;
    rateio_categoria: number;
    rateio_departamento: number;
    descartados: Record<string, number>;
    /** ["PAGO", "A VENCER", "VENCE HOJE", "ATRASADO"]: `LinhaSaida[2]` é índice daqui. */
    status: string[];
  };
  /** [código, descrição, grupo nível 2, nome do grupo, não operacional?] */
  cats: [string, string, string, string, boolean][];
  forn: string[];
  deptos: string[];
  ccs: number[];
  rows: LinhaSaida[];
  /** [dia, valor]: a receber em aberto (sem atrasado) por dia de vencimento. */
  receber?: [string, number][];
}

export const carregarSaidasOmie = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ payload: SaidasOmie; gravadoEm: string } | null> => {
    const acesso = await acessoDoUsuario(context.supabase, context.userId);
    if (!acesso.areas.includes(AREA_BI_FINANCEIRO))
      throw new Error("Acesso negado: sua conta não tem a área BI Financeiro.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("saidas_omie")
      .select("gerado_em, payload")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(`A leitura das saídas falhou (${error.code ?? error.message}).`);
    if (!data) return null;
    return { payload: data.payload as SaidasOmie, gravadoEm: data.gerado_em as string };
  });
