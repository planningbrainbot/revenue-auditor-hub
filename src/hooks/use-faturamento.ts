import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { desembrulhar, valeTentarDeNovo } from "@/lib/faturamento/erros";
import {
  carregarContextoFaturamento,
  carregarPedidosFaturamento,
  carregarResumoFaturamento,
} from "@/lib/faturamento/faturamento.functions";
import type { FiltroPedidos } from "@/lib/faturamento/tipos";

// Consultas das telas do Portal de Faturamento. Todas começam por ["faturamento", …], para uma ação
// (OK, devolver, faturar) invalidar a área inteira com uma chave só.
//
// `retry` só em falha passageira: acesso negado, validação e "a função ainda não existe" não mudam numa
// segunda tentativa, e o retry pausado em aba oculta deixaria a tela em "Carregando" para sempre.

export const CHAVE_FATURAMENTO = ["faturamento"] as const;

/** `ops.fat_contexto`: papéis, empresas do recorte e pendências. Abre toda tela da área. */
export function useContextoFaturamento(habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarContextoFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "contexto", user?.id],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn()),
    staleTime: 60_000,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_resumo`: os quatro números e as etapas de Meu faturamento. */
export function useResumoFaturamento(
  periodo: string | null,
  emissoras: string[] | null,
  habilitado = true,
) {
  const { user } = useAuth();
  const fn = useServerFn(carregarResumoFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "resumo", user?.id, periodo, emissoras],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn({ data: { periodo, emissoras } })),
    staleTime: 60_000,
    retry: valeTentarDeNovo,
  });
}

/** `ops.fat_pedidos`: a página pedida e os totais do recorte (servidor). Mantém a página anterior na troca. */
export function usePedidosFaturamento(filtro: FiltroPedidos, habilitado = true) {
  const { user } = useAuth();
  const fn = useServerFn(carregarPedidosFaturamento);
  return useQuery({
    queryKey: [...CHAVE_FATURAMENTO, "pedidos", user?.id, filtro],
    enabled: habilitado && !!user?.id,
    queryFn: async () => desembrulhar(await fn({ data: { filtro } })),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: valeTentarDeNovo,
  });
}
