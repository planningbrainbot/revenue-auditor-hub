import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type DataFreshnessInfo = {
  omie: string | null;        // MAX(data_competencia) from contas_receber — período mais recente
  tratativas: string | null;  // MAX(update_time) from central_tratativas — atualização MANUAL pelo time
  contratos: string | null;   // MAX(created_at) from contratos — último contrato sincronizado (sync_pipedrive_contratos.py, diário 07:00)
};

export function useDataFreshness() {
  return useQuery({
    queryKey: ["data-freshness"],
    queryFn: async (): Promise<DataFreshnessInfo> => {
      const [omieRes, pdRes, contRes] = await Promise.all([
        supabase
          .from("contas_receber")
          .select("data_competencia")
          .order("data_competencia", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("central_tratativas")
          .select("update_time")
          .order("update_time", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("contratos")
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        omie: omieRes.data?.data_competencia ?? null,
        tratativas: pdRes.data?.update_time ?? null,
        contratos: contRes.data?.created_at ?? null,
      };
    },
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}
