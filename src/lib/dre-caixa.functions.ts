import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// DRE e Caixa da Partners (/dre-caixa). Contrato: docs/design/contratos/dre-caixa.md.
//
// Quem calcula é tools/dre_caixa_payload.py (repo ai-projects-scripts), depois de montar as abas
// DRE e FCX da planilha "Financeiro - Planning Partners": grava o retrato pronto em
// `ops.dre_caixa` (uma linha, id=1). Mesmo desenho do Financeiro semanal: RLS ligada sem policy,
// leitura pelo service_role depois de conferir a área `receita`.

/** Uma linha da DRE. `v` segue a ordem de `meses`. Despesa é negativa. */
export interface LinhaDre {
  k: string;
  /** 0 bloco, 1 grupo, 2 conta, 3 fornecedor ou unidade. */
  nivel: 0 | 1 | 2 | 3;
  bloco: string;
  grupo: string;
  conta: string;
  /** Linha de conferência: fica fora dos totais. */
  conferencia: boolean;
  pct: boolean;
  /** Acima do EBIT (entra na ponte do EBIT). */
  ebit: boolean;
  v: number[];
  acc: number;
}

export interface LinhaFcx {
  k: string;
  v: number[];
}

export interface Degrau {
  id: string;
  rotulo: string;
  explica: string;
  dre: number;
  caixa: number;
  /** caixa − DRE: o quanto este motivo leva da DRE ao caixa. */
  efeito: number;
}

export type TomConferencia = "atencao" | "perigo" | "info";

export interface Conferencia {
  tipo: string;
  titulo: string;
  valor: number;
  tom: TomConferencia;
  dono: string;
  itens: { nome: string; valor: number; obs: string }[];
}

export interface DreCaixa {
  gerado_em: string;
  /** `YYYY-MM`. */
  meses: string[];
  situacao: Record<string, string>;
  dre: LinhaDre[];
  notas: string[];
  fcx: { meses: string[]; resumo: LinhaFcx[]; entradas: LinhaFcx[]; saidas: LinhaFcx[] };
  ponte: Record<string, { resultado_dre: number; resultado_caixa: number; degraus: Degrau[] }>;
  conferencias: Record<string, Conferencia[]>;
  /**
   * CAC que as vendas de cada mês (`YYYY-MM` da venda) geraram: 1 honorário por venda
   * elegível sem churn. `estimado` usa o MRR quando o card ainda não tem honorário.
   * Ausente nos retratos anteriores a 16/10/2026.
   */
  cac?: Record<
    string,
    { vendas: number; cobrado: number; a_cobrar: number; estimado: number; churn: number }
  >;
}

export const carregarDreCaixa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ payload: DreCaixa; gravadoEm: string } | null> => {
    const acesso = await acessoDoUsuario(context.supabase, context.userId);
    if (!acesso.areas.includes("receita"))
      throw new Error("Acesso negado: sua conta não tem a área Receita e Repasses.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("dre_caixa")
      .select("gerado_em, payload")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(`A leitura da DRE falhou (${error.code ?? error.message}).`);
    if (!data) return null;
    return { payload: data.payload as DreCaixa, gravadoEm: data.gerado_em as string };
  });
