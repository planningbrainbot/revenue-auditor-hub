import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listNps,
  listNpsCoverage,
  listNpsExecucao,
  listAudienciaPorUnidade,
  dispararCampanhaNps,
} from "@/lib/nps.functions";
import { listPlanoAcaoContatos } from "@/lib/contatos-cs.functions";

export function useNps() {
  const fn = useServerFn(listNps);
  return useQuery({
    queryKey: ["nps"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function useNpsCoverage() {
  const fn = useServerFn(listNpsCoverage);
  return useQuery({
    queryKey: ["nps-coverage"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function useNpsExecucao() {
  const fn = useServerFn(listNpsExecucao);
  return useQuery({
    queryKey: ["nps-execucao"],
    queryFn: () => fn(),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

export function usePlanoAcaoContatos() {
  const fn = useServerFn(listPlanoAcaoContatos);
  return useQuery({
    queryKey: ["nps-plano-acao-contatos"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });
}

export function useAudienciaPorUnidade() {
  const fn = useServerFn(listAudienciaPorUnidade);
  return useQuery({
    queryKey: ["nps-audiencia-por-unidade"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}

export function useDispararCampanha() {
  const fn = useServerFn(dispararCampanhaNps);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { unidade: string }) => fn({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["nps-execucao"] });
      qc.invalidateQueries({ queryKey: ["nps-audiencia-por-unidade"] });
    },
  });
}
