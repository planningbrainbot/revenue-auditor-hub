import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { AREA_BI_FINANCEIRO } from "@/lib/bi-financeiro-acesso";

// Aba "ROAS e assinaturas" do BI Financeiro (/bi-financeiro?aba=assinaturas).
// Contrato: docs/design/contratos/bi-financeiro.md §7.
//
// Lê ao vivo as views ops.v_roas_assinaturas (uma linha por venda do Inside Sales em 2026, com a
// data de assinatura do contrato) e ops.v_roas_midia_inside_sales (mídia por mês). As duas são só
// do service_role; a leitura acontece depois de conferir a área bi_financeiro.

export interface VendaAssinatura {
  deal_id: number;
  cliente: string;
  unidade: string | null;
  closer: string | null;
  sdr: string | null;
  /** `YYYY-MM-DD`, fuso de Brasília. */
  ganho: string;
  mrr: number;
  tem_contrato: boolean;
  /** `YYYY-MM-DD` ou null quando o contrato ainda não tem data de assinatura. */
  assinatura: string | null;
  fonte_assinatura: string | null;
  fase_contrato: string | null;
  pipefy_card_id: string | null;
}

export interface RoasAssinaturas {
  vendas: VendaAssinatura[];
  /** Mídia do Inside Sales por `YYYY-MM`. */
  midia: Record<string, number>;
  lidoEm: string;
}

const PAGINA = 1000; // teto do PostgREST: acima disso a resposta corta sem avisar

export const carregarRoasAssinaturas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RoasAssinaturas> => {
    const acesso = await acessoDoUsuario(context.supabase, context.userId);
    if (!acesso.areas.includes(AREA_BI_FINANCEIRO))
      throw new Error("Acesso negado: sua conta não tem a área BI Financeiro.");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const vendas: VendaAssinatura[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await db
        .from("v_roas_assinaturas")
        .select("*")
        .order("ganho")
        .order("deal_id")
        .range(de, de + PAGINA - 1);
      if (error) throw new Error(`Falha ao ler as vendas: ${error.message}`);
      for (const r of data ?? []) vendas.push({ ...r, mrr: Number(r.mrr) || 0 });
      if (!data || data.length < PAGINA) break;
    }
    const { data: md, error: em } = await db.from("v_roas_midia_inside_sales").select("mes, midia");
    if (em) throw new Error(`Falha ao ler a mídia: ${em.message}`);
    const midia: Record<string, number> = {};
    for (const r of md ?? []) midia[r.mes] = Number(r.midia) || 0;
    return { vendas, midia, lidoEm: new Date().toISOString() };
  });
