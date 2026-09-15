import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { carregarMonetizacao } from "@/lib/monetizacao/functions";
import { useAuth } from "./use-auth";

export function useMonetizacao() {
  const { user } = useAuth();
  const fn = useServerFn(carregarMonetizacao);
  return useQuery({
    queryKey: ["monetizacao", user?.id],
    queryFn: () => fn(),
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
}
export function useAtualizarMonetizacao() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["monetizacao"] });
}
