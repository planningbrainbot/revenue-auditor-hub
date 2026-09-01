import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listWhatsappCustos, syncWhatsappCustos } from "@/lib/whatsapp-custos.functions";

export function useWhatsappCustos() {
  const fn = useServerFn(listWhatsappCustos);
  return useQuery({
    queryKey: ["whatsapp-custos"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function useSyncWhatsappCustos() {
  const fn = useServerFn(syncWhatsappCustos);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["whatsapp-custos"] });
    },
  });
}
