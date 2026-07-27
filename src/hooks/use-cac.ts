import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  addItemManualCac,
  deleteItemCac,
  excluirItemMesCac,
  listCacItensTodasUnidades,
  reincluirItemMesCac,
  updateItemCac,
} from "@/lib/cac.functions";
// Reaproveitado de royalties — atualizarCnpjContrato só atualiza contratos.cnpj,
// não tem nada específico de royalties, não faz sentido duplicar.
import { atualizarCnpjContrato } from "@/lib/royalties.functions";

const CAC_QUERY_KEY = ["cac", "todas-unidades"];

const defaultOnError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : "Erro inesperado";
  toast.error(msg);
};

// ============ Tela única de CAC (todas as unidades, filtro no front) ============

export function useCacTodasUnidades() {
  const fn = useServerFn(listCacItensTodasUnidades);
  return useQuery({
    queryKey: CAC_QUERY_KEY,
    queryFn: () => fn({ data: {} }),
    staleTime: 10_000,
  });
}

export function useForcarAtualizacaoCac() {
  const fn = useServerFn(listCacItensTodasUnidades);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => fn({ data: { force: true } }),
    onSuccess: (res) => qc.setQueryData(CAC_QUERY_KEY, res),
    onError: defaultOnError,
  });
}

export function useUpdateItemCac() {
  const fn = useServerFn(updateItemCac);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof updateItemCac>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAC_QUERY_KEY }),
    onError: defaultOnError,
  });
}

export function useAddItemCac() {
  const fn = useServerFn(addItemManualCac);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof addItemManualCac>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAC_QUERY_KEY }),
    onError: defaultOnError,
  });
}

export function useDeleteItemCac() {
  const fn = useServerFn(deleteItemCac);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number }) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAC_QUERY_KEY }),
    onError: defaultOnError,
  });
}

export function useExcluirItemCac() {
  const fn = useServerFn(excluirItemMesCac);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { item_id: number; motivo: string }) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAC_QUERY_KEY }),
    onError: defaultOnError,
  });
}

export function useReincluirItemCac() {
  const fn = useServerFn(reincluirItemMesCac);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { item_id: number }) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAC_QUERY_KEY }),
    onError: defaultOnError,
  });
}

export function useAtualizarCnpjContratoCac() {
  const fn = useServerFn(atualizarCnpjContrato);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: Parameters<typeof atualizarCnpjContrato>[0]["data"]) => fn({ data: vars }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CAC_QUERY_KEY }),
    onError: defaultOnError,
  });
}
