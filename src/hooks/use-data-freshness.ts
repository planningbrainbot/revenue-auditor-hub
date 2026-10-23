import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DataFreshnessInfo = {
  omie: string | null;        // última rodada com sucesso do sync do Omie (sync_log, fonte "omie", diário ~07:00)
  tratativas: string | null;  // MAX(update_time) from central_tratativas — atualização MANUAL pelo time
  contratos: string | null;   // última rodada com sucesso do sync do Pipedrive (sync_log, fonte "pipedrive_contratos")
};

// sync_log só é legível por admin e diretor. Para os demais, cai no carimbo da
// própria tabela: created_at da última linha gravada. Nunca MAX(data_competencia):
// é data de negócio (vai até meses à frente) e o order desc devolve os nulos primeiro.
function ultimaRodada(fonte: string) {
  return supabase
    .from("sync_log")
    .select("executado_em")
    .eq("fonte", fonte)
    .eq("status", "sucesso")
    .order("executado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
}

export function useDataFreshness() {
  return useQuery({
    queryKey: ["data-freshness"],
    queryFn: async (): Promise<DataFreshnessInfo> => {
      const [omieSync, omieRes, pdSync, pdRes, contRes] = await Promise.all([
        ultimaRodada("omie"),
        supabase
          .from("contas_receber")
          .select("created_at")
          .order("created_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        ultimaRodada("pipedrive_contratos"),
        supabase
          .from("central_tratativas")
          .select("update_time")
          .order("update_time", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("contratos")
          .select("created_at")
          .order("created_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        omie: omieSync.data?.executado_em ?? omieRes.data?.created_at ?? null,
        tratativas: pdRes.data?.update_time ?? null,
        contratos: pdSync.data?.executado_em ?? contRes.data?.created_at ?? null,
      };
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
