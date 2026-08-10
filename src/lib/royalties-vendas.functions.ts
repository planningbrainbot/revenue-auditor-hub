import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

// ============ listVendasPorUnidadeRede ============
// MRR vendido (ganho no Pipedrive) por unidade × mês — pra comparar ao lado
// do "Resumo por unidade" de royalties e ver se o crescimento de vendas
// puxa o crescimento de royalties (ou se royalties está descolado de venda).
// Fonte: `contratos.ganho_em` (mês em que o deal foi ganho) × `mrr_mensal`
// (ou `mrr`/12 quando não tiver mrr_mensal). Mesmos meses da tabela de
// royalties (`meses`, passado pelo front) pra alinhar as colunas.

export interface VendasPorUnidade {
  unidade_id: number;
  unidade_nome: string;
  porMes: Record<string, number>; // key = "YYYY-MM"
}

export const listVendasPorUnidadeRede = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ unidades: VendasPorUnidade[] }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: unidadesRows, error: uErr } = await supabase
      .from("unidades")
      .select("id,nome_da_praca")
      .eq("tipo", "regional")
      .order("nome_da_praca");
    if (uErr) throw new Error(uErr.message);
    const unidades = (unidadesRows ?? []) as { id: number; nome_da_praca: string }[];
    if (unidades.length === 0) return { unidades: [] };

    const unidadeIdPorNome = new Map(unidades.map((u) => [u.nome_da_praca, u.id]));

    const contratos: {
      ganho_em: string | null;
      mrr_mensal: number | null;
      mrr: number | null;
      unidade: string | null;
    }[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data: pagina, error: cErr } = await supabase
        .from("contratos")
        .select("ganho_em,mrr_mensal,mrr,unidade")
        .not("ganho_em", "is", null)
        .in(
          "unidade",
          unidades.map((u) => u.nome_da_praca),
        )
        .range(offset, offset + PAGE - 1);
      if (cErr) throw new Error(cErr.message);
      contratos.push(...(pagina ?? []));
      if (!pagina || pagina.length < PAGE) break;
    }

    const porUnidade = new Map<number, VendasPorUnidade>(
      unidades.map((u) => [u.id, { unidade_id: u.id, unidade_nome: u.nome_da_praca, porMes: {} }]),
    );
    for (const c of contratos) {
      const uid = unidadeIdPorNome.get(c.unidade ?? "");
      if (uid == null || !c.ganho_em) continue;
      const mes = String(c.ganho_em).slice(0, 7);
      const mrrMensal =
        c.mrr_mensal != null ? Number(c.mrr_mensal) : c.mrr != null ? Number(c.mrr) / 12 : 0;
      if (mrrMensal <= 0) continue;
      const u = porUnidade.get(uid)!;
      u.porMes[mes] = Math.round(((u.porMes[mes] ?? 0) + mrrMensal) * 100) / 100;
    }

    return { unidades: Array.from(porUnidade.values()) };
  });
