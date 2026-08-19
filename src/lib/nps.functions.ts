import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface NpsRow {
  id: number;
  empresa: string | null;
  empresa_id: number | null;
  unidade: string | null;
  segmento: string | null;
  email_pesquisa: string | null;
  nome_contato: string | null;
  telefone_pesquisa: string | null;
  nps_recomendacao: string | null;
  avaliacao_fiscal: string | null;
  avaliacao_contabil: string | null;
  avaliacao_folha_pagamento: string | null;
  servicos_contratados: string[] | null;
  data_envio: string | null;
  fase: string | null;
  created_at: string | null;
  updated_at: string | null;
  // joined from empresas via empresa_id (when matched)
  empresa_cnpj: string | null;
  empresa_segmento: string | null;
  empresa_unidade: string | null;
  empresa_grupo_id: number | null;
}

type Joined = {
  id: number;
  empresa: string | null;
  empresa_id: number | null;
  unidade: string | null;
  segmento: string | null;
  email_pesquisa: string | null;
  nome_contato: string | null;
  telefone_pesquisa: string | null;
  nps_recomendacao: string | null;
  avaliacao_fiscal: string | null;
  avaliacao_contabil: string | null;
  avaliacao_folha_pagamento: string | null;
  servicos_contratados: string[] | null;
  data_envio: string | null;
  fase: string | null;
  created_at: string | null;
  updated_at: string | null;
  empresas: { cnpj: string | null; segmento: string | null; unidade: string | null; grupo_id: number | null } | null;
};

export const listNps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: NpsRow[] }> => {
    const { supabase } = context;
    const pageSize = 1000;
    let from = 0;
    const all: NpsRow[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("nps_pesquisas")
        .select(
          "id,empresa,empresa_id,unidade,segmento,email_pesquisa,nome_contato,telefone_pesquisa,nps_recomendacao,avaliacao_fiscal,avaliacao_contabil,avaliacao_folha_pagamento,servicos_contratados,data_envio,fase,created_at,updated_at,empresas:empresa_id(cnpj,segmento,unidade,grupo_id)",
        )
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as unknown as Joined[];
      for (const r of batch) {
        all.push({
          id: r.id,
          empresa: r.empresa,
          empresa_id: r.empresa_id,
          unidade: r.unidade,
          segmento: r.segmento,
          email_pesquisa: r.email_pesquisa,
          nome_contato: r.nome_contato,
          telefone_pesquisa: r.telefone_pesquisa,
          nps_recomendacao: r.nps_recomendacao,
          avaliacao_fiscal: r.avaliacao_fiscal,
          avaliacao_contabil: r.avaliacao_contabil,
          avaliacao_folha_pagamento: r.avaliacao_folha_pagamento,
          servicos_contratados: r.servicos_contratados,
          data_envio: r.data_envio,
          fase: r.fase,
          created_at: r.created_at,
          updated_at: r.updated_at,
          empresa_cnpj: r.empresas?.cnpj ?? null,
          empresa_segmento: r.empresas?.segmento ?? null,
          empresa_unidade: r.empresas?.unidade ?? null,
          empresa_grupo_id: r.empresas?.grupo_id ?? null,
        });
      }
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return { rows: all };
  });
