import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// Financeiro semanal da Partners (o "reporte do CEO").
//
// Quem calcula é a Edge Function `reporte-ceo`, chamada pelo n8n às 12h e às 18h: baixa o Omie da
// Partners e grava o payload pronto em `ops.reporte_ceo` (uma linha, id=1). A tela só lê essa
// linha. A tabela tem RLS ligada e nenhuma policy, então a leitura é pelo service_role, depois de
// conferir aqui a área `receita` (a mesma do item no menu).

export type SituacaoTitulo = "atrasado" | "em_dia" | "pago";

export interface ParteReceita {
  faturado: number;
  recebido: number;
  a_vencer: number;
  atrasado: number;
}

export interface ReporteCeo {
  hoje: string;
  gerado_em: string;
  corte: string;
  caixa: { ini: string; fim: string; conta: number; aplic: number; total: number; entrou: number };
  pagar: { vencido: number; ate: number; depois: number; ultimo: string };
  semanas: { ini: string; fim: string; rec: number; pag: number }[];
  vencido: {
    n: number;
    pct: number;
    total: number;
    top: { nome: string; valor: number; dias: number }[];
  };
  meses: Record<string, string>;
  titulos: {
    id: number;
    cat: string;
    mes: number;
    sit: SituacaoTitulo;
    forn: string;
    venc: string;
    ordem: string;
    valor: number;
  }[];
  evolucao: {
    mes: string;
    entradas: number;
    saidas: number;
    operacional: number;
    fora: number;
    variacao: number;
    aporte: number;
    faturado: number;
    fat_fonte: string;
    resultado_fat: number;
    aplicado: number;
    resgatado: number;
    rendimento: number;
    saldo_aplic: number;
  }[];
  /** Mês anterior e corrente, pela chave do mês (1 a 12). Ausente nos retratos anteriores a 07/10/2026. */
  receita_mes?: Record<
    string,
    ParteReceita & { mes: string; caixa: number; clientes: (ParteReceita & { nome: string })[] }
  >;
}

export const carregarReporteCeo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ payload: ReporteCeo; gravadoEm: string } | null> => {
    const acesso = await acessoDoUsuario(context.supabase, context.userId);
    if (!acesso.areas.includes("receita"))
      throw new Error("Acesso negado: sua conta não tem a área Receita e Repasses.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("reporte_ceo")
      .select("gerado_em, payload")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(`A leitura do reporte falhou (${error.code ?? error.message}).`);
    if (!data) return null;
    return { payload: data.payload as ReporteCeo, gravadoEm: data.gerado_em as string };
  });
